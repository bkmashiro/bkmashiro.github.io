---
date: 2026-04-15
description: "Can numerical methods from scientific computing make diffusion model sampling faster? Exploring exponential integrators, Richardson extrapolation, Chebyshev schedules, and Triton-fused kernels as alternatives to DPM-Solver++."
title: "Faster Diffusion Sampling: Numerical Methods Meet Score-Based Models"
readingTime: true
tag:
  - Machine Learning
  - Diffusion Models
  - Numerical Methods
  - CUDA
outline: [2, 3]
---

Diffusion models generate stunning images, but they're slow. A single image requires dozens of sequential neural network evaluations — each one a full forward pass through a U-Net. DPM-Solver++ brought that down to 10-20 steps with reasonable quality, and it's the current state of the art. But what if we could do better by borrowing techniques that the scientific computing community has used for decades?

I've been building a framework to test exactly this. The experiments haven't run yet (waiting for GPU cluster time), but the code is written, the baselines are set up, and I want to walk through what I'm trying and why I think some of these ideas have a real shot.

## The ODE Hiding Inside Every Diffusion Model

Sampling from a diffusion model is, mathematically, solving an ordinary differential equation. The probability flow ODE from Song et al. (2021) takes the form:

$$\frac{dx}{dt} = -\frac{1}{2}\beta(t)\,x + \frac{1}{2}\frac{\beta(t)}{\sigma_t}\,\epsilon_\theta(x, t)$$

where $\epsilon_\theta$ is the neural network predicting noise, $\beta(t)$ is the noise schedule, and $\sigma_t$ is the noise level at time $t$. You start from pure Gaussian noise at $t=1$ and integrate down to $t \approx 0$ to get a clean image.

The standard approach — DDIM, Euler, Heun — treats this as a generic ODE and throws a general-purpose integrator at it. That works, but it ignores something critical about the structure of this particular equation.

### The linear-nonlinear split

Look at the ODE again. It decomposes cleanly into two parts:

$$\frac{dx}{dt} = \underbrace{-\frac{1}{2}\beta(t)\,x}_{\text{linear}} + \underbrace{\frac{1}{2}\frac{\beta(t)}{\sigma_t}\,\epsilon_\theta(x,t)}_{\text{nonlinear}}$$

The linear part $A(t)\,x$ where $A(t) = -\frac{1}{2}\beta(t)$ is a scalar coefficient times the state. It has an exact analytical solution — no approximation needed. The nonlinear part $N(x,t)$ is where the neural network lives, and it's the expensive part.

DPM-Solver++ already exploits this to some degree. In log-SNR coordinates $\lambda = \log(\alpha_t / \sigma_t)$, the exact solution from time $s$ to $t$ is:

$$x_t = \frac{\sigma_t}{\sigma_s}\,x_s + \sigma_t \int_{\lambda_s}^{\lambda_t} e^\lambda\,\hat{x}_\theta(x_\lambda, \lambda)\,d\lambda$$

The first term solves the linear part exactly. All numerical error comes from approximating that integral over the nonlinear part. The question is: can we approximate it better?

## Exponential Integrators: Let the Math Do the Work

Exponential time differencing (ETD) methods come from the fluid dynamics and stiff ODE literature (Cox & Matthews 2002, Hochbruck & Ostermann 2010). The core idea: if your ODE has the form $dx/dt = Ax + N(x,t)$, don't approximate $A$ — solve it exactly and only approximate $N$.

### ETD1: First-order exponential integrator

The simplest version evaluates the network once per step and uses the $\phi$-functions from exponential integrator theory. In log-SNR coordinates, the update is:

$$x_{n+1} = \underbrace{e^h \cdot \frac{\alpha_{n+1}}{\alpha_n}}_{\text{exact decay}} \cdot x_n + \underbrace{\alpha_{n+1}(1 - e^h)}_{\text{integral coefficient}} \cdot \hat{x}_0^{(n)}$$

where $h = \lambda_{n+1} - \lambda_n$ is the step in log-SNR space and $\hat{x}_0^{(n)}$ is the data prediction from the network at step $n$. The exponential decay handles the linear part analytically. Only the integral of the nonlinear part gets approximated, and even that uses the structure of the exponential — it's not a naive rectangle rule.

One network evaluation per step. Same cost as DDIM. But the error is concentrated purely in the nonlinear approximation, not spread across both linear and nonlinear terms.

### ETD2: Predictor-corrector for more accuracy

ETD2 uses the current and previous data predictions to build a better quadrature for the integral term:

$$x_{n+1} = \text{decay} \cdot x_n + \text{integral\_coeff} \cdot \left(\frac{3}{4}\,\hat{x}_0^{(n)} + \frac{1}{4}\,\hat{x}_0^{(n-1)}\right)$$

This is a weighted combination — trapezoidal-like quadrature over the nonlinear part, while the linear part remains exact. The local truncation error drops from $O(h^2)$ to $O(h^3)$. For 10-step sampling where $h$ is large, that difference matters: $h^3$ vs $h^2$ at $h = 0.1$ is a factor of 10.

The cost is still one network evaluation per step (it reuses the previous prediction), so ETD2 gets higher-order accuracy essentially for free compared to ETD1. The first step falls back to ETD1 since there's no previous prediction to reuse.

## Chebyshev Time Schedules: Where You Step Matters as Much as How

Here's something that surprised me when I started digging into this. The choice of timestep placement — which $t$ values you evaluate the network at — can matter as much as the integration method itself.

The diffusion ODE is not equally difficult everywhere. Near $t=1$ (pure noise), the score function is smooth and nearly Gaussian. Large steps are safe. Near $t=0$ (clean data), the score encodes fine image details and changes rapidly. The ODE becomes stiff, and small steps are necessary. Most of the error budget gets spent in that last stretch near $t=0$.

The Karras/EDM schedule addresses this with a power-law spacing ($\rho=7$) that clusters steps near the clean-data end. DPM-Solver++ uses uniform spacing in log-SNR. Both are heuristic.

Chebyshev nodes are something different. In approximation theory, they're the provably optimal interpolation points on an interval — they minimize the Lebesgue constant and avoid Runge's phenomenon (the catastrophic oscillation you get with uniformly-spaced polynomial interpolation). The nodes are:

$$t_k = \frac{t_{\text{start}} + t_{\text{end}}}{2} + \frac{t_{\text{start}} - t_{\text{end}}}{2}\cos\left(\frac{\pi k}{n}\right)$$

They cluster at both endpoints of the interval, which aligns well with the diffusion ODE's structure: the integration is tricky both at the very start (where you're leaving the Gaussian prior) and at the very end (where you're resolving fine details).

No extra neural network evaluations. No extra compute. Just a smarter placement of the steps you were already going to take. The Karras schedule was designed by intuition and validated empirically. Chebyshev nodes come from a theorem. I'm curious which one wins in practice — my suspicion is that Chebyshev will do well at very low NFE (5-7 steps) where step placement dominates the error.

## Richardson Extrapolation: Run Twice, Cancel Error

Richardson extrapolation is one of the oldest tricks in numerical analysis, and I'm a little surprised it hasn't been applied to diffusion sampling. The idea is disarmingly simple.

Suppose you run a $p$-th order method with $N$ steps and get result $x_N$. The error is approximately $C \cdot h^p$ for some unknown constant $C$. Now run the same method with $2N$ steps (step size $h/2$). The error is approximately $C \cdot (h/2)^p$. You have two equations and two unknowns ($x_{\text{exact}}$ and $C$), so you can solve for the exact answer:

$$x_{\text{extrap}} = \frac{2^p \cdot x_{2N} - x_N}{2^p - 1}$$

For DDIM ($p=1$): $x_{\text{extrap}} = 2\,x_{2N} - x_N$. For ETD2 ($p=2$): $x_{\text{extrap}} = \frac{4\,x_{2N} - x_N}{3}$. The extrapolated result has error $O(h^{p+1})$ — you've gained an order of accuracy.

The cost is $3N$ total network evaluations ($N$ for the coarse run, $2N$ for the fine run). That's 3x the cost for one extra order. Not always worth it — but there's a bonus: if the coarse and fine results already agree (their relative difference is below some tolerance), you know the coarse result is converged. You can skip the extrapolation and save those $2N$ evaluations entirely. This gives you adaptive quality control with a bounded cost.

In the implementation, I added an early-exit check: if $\|x_{2N} - x_N\| / \|x_N\| < \tau$, return $x_N$ immediately. At high NFE this fires reliably and the Richardson sampler becomes a convergence detector rather than an extrapolator.

## Engineering: Triton Kernels and Mixed Precision

Algorithmic improvements are one axis. Raw engineering is another. I want to measure both, but separately — conflating them is how you end up with papers that claim "2x faster" when it's really "1.1x better algorithm + 1.8x from CUDA tricks."

### Fused Triton kernels

The ETD update step involves several element-wise operations:

```
out = decay * x + coeff * x0          # ETD1
out = decay * x + c0 * x0 + c1 * x0p  # ETD2
out = (scale * fine - coarse) / (scale - 1)  # Richardson combine
```

In vanilla PyTorch, each operation creates an intermediate tensor, reads from and writes to global GPU memory. For a 32x32 CIFAR image that's negligible, but for 512x512 or 1024x1024 latent diffusion, the memory traffic adds up.

Fusing these into single Triton kernels eliminates the intermediate allocations. One kernel reads all inputs, computes the result, and writes once. The ETD1 kernel goes from 2 loads + 1 intermediate + 1 store to 2 loads + 1 store. For ETD2, 3 loads + 2 intermediates + 1 store becomes 3 loads + 1 store.

These kernels fall back gracefully to PyTorch if Triton isn't available — the public API returns `None` and the caller uses the unfused path.

### Mixed precision

The diffusion ODE has different precision requirements at different times. Near $t=1$, the signal-to-noise ratio is low and the score is smooth — FP16 is fine. Near $t=0$, you're resolving fine details and the ODE is stiff — FP32 matters. A simple threshold ($t > 0.3$ uses FP16, otherwise FP32) should capture most of the speedup with minimal quality loss.

### torch.compile

The compiled DDIM sampler wraps the model call with `torch.compile` for kernel fusion and graph optimization. This is orthogonal to the algorithmic choice and should stack with any sampler.

## Fair Comparison: The Two-Table Strategy

This is the part I care most about getting right. ML papers routinely mix algorithmic and engineering improvements in a single benchmark, making it impossible to tell what's actually helping.

I'm using two separate evaluation tables:

**Table 1: Algorithmic fairness (FID vs NFE).** All methods use the same PyTorch code path, no Triton, no compile, no mixed precision. The only variable is the sampling algorithm and schedule. This answers: "at a fixed budget of $K$ neural network evaluations, which method produces the best images?"

**Table 2: Engineering performance (FID vs wall-clock time).** Every method gets all the CUDA tricks — Triton kernels, `torch.compile`, mixed precision. This answers: "in practice, on real hardware, what's fastest?"

The baseline for both tables is DPM-Solver++ (2M) via the `diffusers` library, which is the most widely-used SOTA sampler. Published FID on CIFAR-10 32x32: ~5.0 at 5 NFE, ~3.5 at 10 NFE, ~3.0 at 20 NFE.

Every method I'm testing gets evaluated at the same NFE values (5, 10, 20) against this baseline. No cherry-picking the NFE that makes your method look best.

## What I Expect to Find

I'll be honest about my predictions.

**Best algorithmic bet: Chebyshev schedule + ETD2.** ETD2 gets higher-order accuracy for free (reuses previous predictions), and Chebyshev nodes should give near-optimal step placement. At NFE=5, I'd guess this combination beats DPM-Solver++ by 0.5-1.0 FID points. The theoretical justification is clean: exact linear integration (ETD) + optimal interpolation nodes (Chebyshev) + higher-order quadrature (ETD2's trapezoidal rule). Each piece attacks a different source of error.

**Richardson extrapolation: useful but expensive.** At low NFE (5-7), the 3x cost makes it impractical. At NFE=15-20, the convergence detection might let it exit early and effectively verify that 10 steps was enough. I see it more as a quality assurance tool than a speed tool.

**Karras schedule will be hard to beat.** The $\rho=7$ schedule was tuned empirically on exactly this kind of model. Chebyshev has theoretical backing but wasn't designed for this specific problem. My honest expectation is that Chebyshev wins at very low NFE (5 steps) where the theoretical optimality of interpolation nodes matters most, and Karras wins at moderate NFE (10-20) where the empirical tuning pays off.

**Triton kernels: marginal on CIFAR, meaningful on larger images.** For 32x32 images, the network forward pass dominates so completely that fusing the update step barely registers. But the kernels are written for the day I test on Stable Diffusion with 64x64 latents.

**The combination will matter more than any single technique.** The best result will likely be something like: Chebyshev schedule + ETD2 + early stopping at $t_{\text{end}}=0.05$ + `torch.compile`. Each piece contributes a modest improvement, but they're orthogonal and they stack.

**Where I might be wrong:** DPM-Solver++ already does exact linear integration in log-SNR space (their Proposition 4.1). The gap between what it does and what ETD methods do might be smaller than I think. The multistep reuse in DPM-Solver++ is also more sophisticated than ETD2's simple two-point quadrature. If the DPM-Solver++ baseline turns out to be within 0.2 FID of ETD2+Chebyshev at all NFE values, the story becomes "DPM-Solver++ already found most of the juice" rather than "numerical methods beat ML methods." That's a valid finding too.

## What This Is Really About

The deeper question isn't whether ETD2 beats DPM-Solver++ by 0.3 FID points. It's whether the ODE solver community and the diffusion model community are leaving performance on the table by not talking to each other enough.

DPM-Solver++ was derived from first principles in the diffusion model framework. Exponential integrators were derived from first principles in the stiff ODE framework. They arrive at remarkably similar update rules — both solve the linear part exactly, both approximate the nonlinear integral. But they come from different intellectual traditions and make different choices about step placement, error estimation, and order selection.

If the experiments show that a well-chosen schedule + exponential integrator matches or beats DPM-Solver++ at low NFE, that validates the cross-pollination. If they don't, it tells us that DPM-Solver++'s model-specific design choices (data prediction parameterization, dynamic thresholding, multistep reuse) are doing more heavy lifting than the generic numerical framework.

Either way, we learn something. The GPU cluster queue is the only thing between me and finding out.

---

Code: [github.com/bkmashiro/diffusion-sampler-exp](https://github.com/bkmashiro/diffusion-sampler-exp)
