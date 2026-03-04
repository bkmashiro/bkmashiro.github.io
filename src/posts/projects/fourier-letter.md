---
description: Using Fourier epicycles to draw letters — the math, the traps, and how I fixed them
title: Drawing Letters with Fourier Epicycles
readingTime: true
date: 2026-03-04
tag:
  - Math
  - Canvas
  - JavaScript
  - Visualization
outline: [2, 3]
---

# Drawing Letters with Fourier Epicycles

I spent a few days building an interactive demo where spinning circles — called *epicycles* — trace out the letters of my name. Here's the math behind it, the traps I fell into, and how I climbed out.

<!-- more -->

## What's a Fourier Epicycle?

The Discrete Fourier Transform (DFT) of a sequence of 2D points gives you a set of rotating vectors. Stack them tip-to-tail, spin each one at its own frequency and amplitude, and the tip of the last vector traces out any closed curve you want.

Given N complex sample points $z_k = x_k + i y_k$:

$$X_n = \sum_{k=0}^{N-1} z_k \cdot e^{-2\pi i \cdot kn / N}$$

Each $X_n$ is a complex number encoding the **amplitude**, **phase**, and **frequency** of one epicycle. At render time, the pen position at time $t \in [0,1]$ is:

$$z(t) = \sum_{n} X_n \cdot e^{2\pi i \cdot n \cdot t}$$

In canvas terms: each frame, sum up all the rotating vectors, draw the chain, and plot a trail.

## Sampling the Letter Path

The first challenge is getting a clean, ordered set of 2D points that traces the letter outline.

My first attempt: render the letter to a canvas, read back pixel data, and use **Moore neighborhood contour tracing** to order the edge pixels. It works in theory — but for thin strokes and sharp corners, the tracer gets trapped in 2-step loops at 1-pixel-wide tips and never terminates.

**Second attempt**: polar-angle sort — collect all edge pixels and sort by angle from the centroid. Sounds elegant, collapses immediately for non-convex shapes. The letter Y has three arms; a polar sweep sees each arm twice, producing a star-shaped mess instead of a Y.

**What actually works**: SVG `path.getPointAtLength()`.

Every letter can be defined as an SVG path (or a polyline of keypoints). Then:

```js
const N = 512
const total = path.getTotalLength()
const pts = Array.from({ length: N }, (_, i) => {
  const p = path.getPointAtLength(i / N * total)
  return { x: p.x, y: p.y }
})
```

This gives evenly-spaced points in path order — no tracing, no sorting, no topology issues. The DFT then does its job cleanly.

## The U Problem

The letter U is open at the top. But the DFT needs a **closed** path — it loops $z(t)$ from $t=0$ back to $t=0$, so the start and end must be the same point.

Naively closing U by connecting the two top corners draws a horizontal bar across the opening. That's not a U, that's a square bracket.

**Attempt 1: Start at top-left, retrace.**

Path: `(top-left) → down left → curve → up right → (top-right) → retrace back → (top-left)`

Closure is zero-length. No cap. But the animation starts at the top-left corner, and the first thing it draws is a stroke going *down*. At the end of each cycle the pen is at top-left, and the next cycle immediately goes down again — a very visible straight stroke from corner to bottom on every loop.

**Attempt 2: Start at bottom center.**

Path:
1. `(bottom-center)` → up left arm → `(top-left)` → retrace back → `(bottom-center)`
2. `(bottom-center)` → up right arm → `(top-right)` → retrace back → `(bottom-center)`

Start = End = bottom of the curve. The "seam" between cycles is buried in the middle of the curve — visually invisible. Each arm is traced out and back independently.

```js
U: [
  {x:.5,  y:1},
  {x:.35, y:.97}, {x:.2, y:.87}, {x:.15, y:.68}, {x:.15, y:0},  // left arm up
  {x:.15, y:.68}, {x:.2, y:.87}, {x:.35, y:.97},                 // retrace
  {x:.5,  y:1},
  {x:.65, y:.97}, {x:.8, y:.87}, {x:.85, y:.68}, {x:.85, y:0},  // right arm up
  {x:.85, y:.68}, {x:.8, y:.87}, {x:.65, y:.97},                 // retrace
  {x:.5,  y:1},                                                   // zero closure
]
```

Clean U, no artifacts.

## Math.min Trap

One more subtle issue: when spreading thousands of points into `Math.min()`/`Math.max()` for normalization:

```js
const minX = Math.min(...points.map(p => p.x)) // 💥 RangeError on large arrays
```

JavaScript expands the spread into function arguments. Past a few thousand elements, this overflows the call stack. Use reduce:

```js
const minX = points.reduce((m, p) => Math.min(m, p.x), Infinity)
```

## Harmonic Count

How many epicycles do you need? Each harmonic adds one more spinning circle. Too few and letters lose their corners. Too many and you faithfully reproduce every pixel-level noise in the sample path.

For my 512-point letter paths, **80–100 harmonics** give clean sharp corners without amplifying noise. The sorted-by-amplitude rendering (largest circles first, smallest last) also keeps the visual clear — you watch the big structure appear before the fine details.

## Live Demo

The full demo is [here](/demos/fourier) — all five letters animating simultaneously, each in its own color.

Source: ~200 lines of vanilla JS, no libraries, pure canvas. The DFT is just a nested loop over the sample points.

---

*Next: I'm experimenting with DLA (Diffusion-Limited Aggregation) crystal growth seeded from the same letters. Particles random-walk until they touch the crystal — a different kind of emergence.*
