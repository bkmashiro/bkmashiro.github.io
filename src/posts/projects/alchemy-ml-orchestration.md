---
date: 2026-04-25
description: "I built Alchemy to fix a problem I kept running into: ML training code that's 80% infrastructure noise. Here's how it works — code-first experiments, managed values via Python descriptors, and a file-system-based agent protocol for communicating with jobs on SLURM."
title: "Alchemy: Rethinking How ML Experiments Are Orchestrated"
readingTime: true
tag:
  - Machine Learning
  - Systems Design
  - HPC
  - Python
  - SLURM
outline: [2, 3]
---

I've spent a fair amount of time running ML experiments on remote GPU clusters, and I kept running into the same frustration: the code that actually matters — the training logic — drowns in infrastructure noise.

A typical training script looks something like this:

```python
parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float, default=1e-3)
args = parser.parse_args()

if args.resume:
    ckpt = torch.load(args.resume)
    model.load_state_dict(ckpt["model"])
    optimizer.load_state_dict(ckpt["optimizer"])
    start_step = ckpt["step"]
else:
    start_step = 0

for step in range(start_step, total_steps):
    loss = train_step(batch)
    wandb.log({"loss": loss})
    if step % 1000 == 0:
        torch.save({...}, f"ckpt_{step}.pt")
```

Out of maybe 30 lines, one actually describes the training: `loss = train_step(batch)`. The rest is plumbing — argument parsing, checkpoint handling, logging — all of it scattered uniformly through the logic, all of it needing to be rewritten for every new project.

This is [Alchemy](https://github.com/bkmashiro/alchemy) — my attempt to fix this.

## The Framework Boundary Problem

The tools most people reach for — W&B, argparse, PyTorch Lightning — all draw their boundaries at the *call site*. You want to log something, you call `wandb.log()` there. You want a checkpoint, you write `torch.save()` there. The user decides when, where, and how.

The consequence: infrastructure code is uniformly spread through training logic. Switch monitoring platforms, rewrite everything. Change checkpoint strategy, rewrite everything. Add a new metric, grep through all your files to find the right call sites.

The boundary is in the wrong place. Alchemy flips it: the framework owns the lifecycle, and you write training logic *inside* it.

```python
@al.managed(total_steps=500_000, checkpoint_every=50_000)
def train(ctx):
    ctx.model = MyModel(hidden=ctx.param("hidden"))
    ctx.optimizer = Adam(ctx.model.parameters(), lr=ctx.param("lr"))

    for step in ctx.steps():
        loss = train_step(ctx.model, batch)
        ctx.log(loss=loss)
```

No argparse. No checkpoint resume logic. No `torch.save()`. No `wandb.log()`. The code describes *how to train*. Everything else is the framework's problem.

## Code First: Three Layers

"Code First" sounds like a buzzword, but in Alchemy it has three distinct, progressively deeper meanings.

### Layer 1: Code as configuration

Traditional approach: write a YAML that lists which objects to checkpoint, then have your training code read that YAML.

```yaml
# config.yaml
checkpoint_objects: [model, optimizer]
checkpoint_every: 50000
```

Alchemy's approach: the Python class declaration *is* the configuration.

```python
ctx.model     = managed.Torch()
ctx.optimizer = managed.Torch()
```

`managed.Torch()` says "this object uses PyTorch serialization." The type system enforces it at declaration time. No runtime guessing, no string-based lookups, no desync between config and code.

### Layer 2: Convention over configuration

`ctx.steps()` isn't a wrapper around `range(total_steps)`. It's a contract. Use it, and the framework owns: which step you start from (might be mid-run after a crash), when to stop, how step counts sync to disk. `ctx.save()` isn't a wrapper around `torch.save()`. It knows which objects are managed, what format they use, where to store them, how many historical versions to keep.

You don't choose. The framework decides. That sounds like a restriction, but the choice of checkpoint format is genuinely meaningless for ML experiments — there are a hundred equivalent ways and none of them matter. Eliminating that choice removes cognitive overhead without removing anything real.

### Layer 3: Experiments as hypotheses

This is the deepest shift. Traditional training scripts are *imperative* — they describe what to do, step by step. Alchemy experiments are *declarative* — they describe what to verify.

```python
exp = al.experiment("ctx_scaling",
    criteria={
        "silhouette": "> 0.3",
        "nmi": "> 0.1",
    },
    matrix={
        "ctx_len": [16, 32, 64, 128, 256, 512],
        "seed":    [42, 123, 789],
    }
)

@exp.task(total_steps=500_000, eval_every=10_000)
def train(ctx):
    ctx.model = JEMAModel(ctx_len=ctx.param("ctx_len"))
    ctx.optimizer = Adam(ctx.model.parameters())

    for step in ctx.steps():
        loss = train_step(ctx.model, batch)
        ctx.log(loss=loss)
        if ctx.should_eval():
            ctx.log_eval(evaluate(ctx.model))
```

One file. That's it. The hypothesis (criteria), the variable space (matrix, auto-expanded to 6×3=18 trials), and the training logic. Submit with `alchemy submit ctx_scaling.py`. The framework handles the rest: scheduling, parameter injection, result validation against criteria.

This is possible because the scope is narrow. General-purpose languages can't have many conventions because you can do anything in them. But "ML experiment" has known structure: steps, checkpoints, evals, hyperparameters, success criteria. Encode that structure as convention, and a lot of boilerplate disappears.

## Managed Values and the Descriptor Protocol

The assignment trick deserves more explanation. When you write:

```python
ctx.model = MyModel(hidden=ctx.param("hidden"))
```

This looks like ordinary assignment but Python's descriptor protocol intercepts it. `__set__` fires when you assign to the attribute, `__set_name__` fires at class definition time to inject the attribute name. Two things happen immediately:

1. **Registration** — the object is added to the managed table. When `ctx.save()` runs, the framework knows to serialize it and how.
2. **Restoration** — if a checkpoint exists for this run, `load_state_dict()` is called immediately. The object comes back to its saved state before control returns to user code.

You write zero resume logic. The assignment moment is where the framework decides whether this is a new run or a continuation.

### Zero-Invasive Parameters

The same philosophy applies to hyperparameters:

```python
lr = al.param("lr", default=1e-3)
```

Three behaviors from one line:
- **Local run** (no `ALCHEMY_TASK_ID` env var): all SDK calls are no-ops, returns `default`. Code runs with no framework dependency.
- **Managed run**: framework injects a JSON blob into `ALCHEMY_PARAMS` at submission. `al.param()` reads from there. Training code doesn't know this happened.
- **Hyperparameter search**: framework injects different parameters for each trial. Same training code, different values.

The asymmetric error handling is intentional. `al.param("lr")` with no default crashes immediately if not found — you declared this value *must* come from the framework, so framework misconfiguration is a fatal error. `al.param("lr", 1e-3)` degrades gracefully — local runs are valid. The rule: configuration errors are fatal, observation data loss is acceptable. A wrong learning rate running silently for three days is a disaster. Missing a few log points is fine.

## The NFS Agent Protocol

Once jobs are running on a SLURM cluster, you have a new problem: how do you communicate with them?

The naive approaches break in practice. Sockets require compute nodes to accept connections, which they often don't. SSH tunnels to arbitrary compute nodes are fragile and hard to manage. Webhooks require outbound internet, which is frequently blocked on cluster compute nodes. Polling job logs with `tail` tells you what already happened, not what's happening.

There's one thing every SLURM node can reliably access: the NFS shared filesystem.

Each running job gets a directory in the shared mount:

```
jobs/<job-id>/
  heartbeat.json    ← written every 15s by the training process
  progress.json     ← loss, step, ETA, GPU utilization
  commands/         ← you drop files here to send commands
  ack/              ← processed commands get moved here
```

To save a checkpoint: write `save_checkpoint.json` into `commands/`. Training process polls the directory, reads the file, runs the save, moves the file to `ack/`. To gracefully stop: write `graceful_stop.json`. To change learning rate mid-run: write `update_params.json` with the new values.

Every write is atomic. The agent writes to a `.tmp` file and calls `os.rename()`. Rename is atomic on POSIX filesystems. The reader always gets either nothing or a complete JSON — never a half-written file.

The Python agent is stdlib-only and zero-dependency:

```python
from alchemy_agent import report_progress, check_commands

# In your training loop:
report_progress(step=1000, total=50000, metrics={"loss": 0.3})
check_commands()  # reads commands/, executes, writes to ack/
```

Or, if you don't want to touch your training code at all, wrap it:

```bash
python alchemy_agent.py -- python train.py
```

The agent runs as the parent process and handles all communication. `train.py` is just a subprocess. Maximum invasiveness: zero lines changed in your training code.

On the server side, `AgentPoller` — a TypeScript service — polls the job directories over SSH every 10 seconds. It reads heartbeat/progress/status, feeds data to the dashboard, and exposes REST endpoints:

- `POST /api/jobs/:id/command` — sends a command to a job
- `GET /api/jobs/:id/agent` — returns current agent state

The "job is dead" problem is handled by the heartbeat: if `heartbeat.json` isn't updated within a configurable window, the job is marked as lost contact. Unknown status requires three consecutive misses (debounce threshold) before escalating — avoiding false alarms from momentary NFS hiccups.

## The Orchestration Layer

All of this runs on top of a more conventional orchestration layer: SSH tunneling through jump hosts to private compute clusters, SLURM job submission via `sbatch`, webhook callbacks injected into sbatch scripts for completion notification.

Job chains let you express multi-stage experiments:

```python
@exp.task(name="train", ...)
def train(ctx): ...

@exp.task(name="eval", depends_on="train")
def eval(ctx):
    ctx.model = managed.Input("train.model")  # reference the trained model
    ...
```

The `managed.Input("train.model")` line deserializes the output from the `train` task. The dependency DAG is in the code; the framework handles scheduling order and checkpoint passing between stages.

The live dashboard shows job tables, chain progress bars, and log viewers. Discord notifications fire on job start, completion, and failure — including traceback excerpts so you don't have to SSH in immediately when something breaks at 2am.

## Design Constraints

Two constraints shaped everything:

**Training code must run without the framework.** If `ALCHEMY_TASK_ID` is absent, all SDK calls are no-ops. `matrix` runs only the first configuration. The experiment trains locally as if Alchemy doesn't exist. This constraint is why the framework boundary stayed clean — any leakage would have broken local execution.

**All writes are atomic.** This is a distributed systems property showing up in an ML tool. NFS doesn't give you transactions, so you get atomicity from the filesystem itself. `tmp + rename` is a pattern borrowed from databases and package managers. It feels like overkill until the first time a half-written heartbeat crashes your monitoring.

## Why This Matters

The deeper point isn't about Alchemy specifically. It's about where complexity lives in ML engineering.

When you scatter infrastructure code through training logic, you're choosing to put complexity at every call site — spread thin, hard to change. When you push it to a framework boundary, you concentrate it in one place. The training code gets simpler. The framework gets more complex. But framework complexity is *localized* — you can understand it, test it, replace it. Scattered complexity is just technical debt.

ML research moves fast enough that experiment infrastructure shouldn't be a tax on every new project. The goal is: write the hypothesis, define the search space, implement the training logic. Everything else should disappear.

---

Code: [github.com/bkmashiro/alchemy](https://github.com/bkmashiro/alchemy)
