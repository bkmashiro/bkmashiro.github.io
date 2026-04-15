---
date: 2026-04-15
description: "Code review findings from two recent projects: Strata (environment snapshots) and branchfs (AI branching filesystem). Bugs found, design lessons, and what I'd do differently."
title: "Code Review: Strata & branchfs — What I Found"
readingTime: true
tag:
  - Code Review
  - Python
  - Systems
outline: [2, 3]
---

Reviewing your own code a few weeks after writing it is a particular kind of experience. The decisions that felt obvious at the time now look questionable. The "temporary" shortcuts are still there. And some things you were sure were correct turn out to have bugs that you can trace directly to an assumption you made at 2am.

I did a deep review of two projects I wrote recently: **Strata**, an environment archaeology tool that snapshots dev environment state, and **branchfs**, an AI-optimized branching filesystem with copy-on-write semantics. Both are Python, both under 2000 lines, both written quickly. Here's what I found.

## Strata: The CLI Didn't Know About Half Its Own Collectors

The most embarrassing bug was in `cli.py`. Strata has 13 collectors — modules that gather different slices of environment state: env vars, running processes, network listeners, disk usage, Docker containers, installed packages, git repos, crontabs, SSH keys, cloud configs, and systemd services.

The CLI defines a `COLLECTOR_NAMES` list that powers the `--collector` filter flag and the `search` / `bisect` commands:

```python
COLLECTOR_NAMES = [
    "envvars", "processes", "network", "files",
    "disk", "system", "docker", "packages",
]
```

Eight names. Thirteen collectors. The five newer collectors — `gitrepos`, `crontab`, `ssh_keys`, `cloud_config`, `systemd` — were registered in `ALL_COLLECTORS` and ran fine during full snapshots, but the CLI's Choice validator didn't know they existed. You couldn't filter snapshots to just git repos, couldn't search crontab entries, couldn't bisect systemd service changes across commits.

This is the kind of bug that happens when you add features in two places and forget to update the third. The collector registry (`__init__.py`) and the snapshot logic (`snapshot.py`) both reference `ALL_COLLECTORS` dynamically. The CLI hardcodes a list. The fix is trivial — add the missing names — but the pattern is worth noting: **if you have a registry, derive everything from it. Don't maintain parallel lists.**

## The File Watcher That Watched Too Much

Strata's file collector monitors config files for changes — `.env`, `Dockerfile`, `pyproject.toml`, and similar. The matching logic looked like this:

```python
def _should_watch(self, path: Path) -> bool:
    name = path.name
    for pattern in _DEFAULT_WATCH_PATTERNS:
        if "*" in pattern:
            prefix, suffix = pattern.split("*", 1)
            if name.startswith(prefix) and name.endswith(suffix):
                return True
        elif name == pattern or name.startswith(pattern):
            return True
    return False
```

The problem is in the `else` branch. For a pattern like `.env`, `name.startswith(pattern)` matches `.envrc`, `.env.example`, `.environment`, and anything else starting with `.env`. The glob pattern `.env.*` already handles the dotfile variants (`.env.local`, `.env.production`). The `startswith` fallback just causes false positives.

This means Strata was checksumming files it shouldn't have been tracking — `.envrc` files, `.environment` directories' contents if they happened to match, anything with the right prefix. In practice, the impact was minor (extra entries in the snapshot), but the intent was clearly wrong. The fix: strict equality only in the non-glob branch.

This is a pattern I see often in hand-rolled glob matching. It's tempting to be "generous" with matching. But generous matching in a file watcher means noisy diffs and false change detection, which undermines the whole point of the tool.

## branchfs: The Race Condition in the Content Store

branchfs uses a content-addressable blob store — files are stored by their SHA-256 hash, giving automatic deduplication. The write path was supposed to be atomic:

```python
def put_bytes(self, data: bytes) -> str:
    blob_hash = self.hash_bytes(data)
    dest = self._blob_path(blob_hash)
    if not dest.exists():
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.rename(dest)
    return blob_hash
```

The pattern is correct in concept: write to a temp file, then rename atomically. But the temp path is deterministic — `{hash}.tmp`. If two processes (or two threads in a FUSE mount) try to store the same blob simultaneously, they both write to the same `.tmp` file. One write stomps the other. In the best case, you get a correct blob because the content is identical. In the worst case, you get a partial write if one process is mid-write when the other starts.

The fix is `tempfile.mkstemp`, which guarantees a unique filename:

```python
fd, tmp_path = tempfile.mkstemp(dir=self.objects_dir)
try:
    os.write(fd, data)
finally:
    os.close(fd)
os.rename(tmp_path, dest)
```

This is the kind of bug you'd never hit in single-threaded testing but that would manifest as silent data corruption under concurrent FUSE access. Content-addressable stores make this especially insidious because the corruption is content-dependent — you'd only see it when two agents write the same file at the same time.

## The FUSE Layer Reads Entire Files Just to Stat Them

This one isn't a correctness bug, but it's the kind of performance issue that would make branchfs unusable on large files. In `fuse_fs.py`:

```python
def getattr(self, path, fh=None):
    # ...
    if rel in tree:
        data = self._read_blob(tree[rel])
        return {**self._default_stat, "st_size": len(data)}
```

Every `getattr` call — which happens on every `ls`, every `stat`, every time anything touches a file — reads the entire blob from disk into memory just to return its size. For a 100MB file, that's 100MB of I/O to answer "how big is this file?"

The blob store doesn't track sizes separately. The tree maps paths to hashes, and the only way to know the size is to read the blob. The proper fix would be to store `(hash, size)` tuples in the tree, or add a size index to the blob store. I didn't fix this one because it's a design change, not a bug fix — but it's the first thing I'd address before anyone tried to use FUSE mode on a real project.

## Design Observations

### Strata's Collector Architecture Is Good

Despite the CLI bug, the collector pattern in Strata is well-designed. Each collector is a class with three methods: `collect()`, `is_available()`, and `diff_entry()`. The base class provides sensible defaults. Adding a new collector means writing one file and adding one import. The diff logic is completely generic — it just compares dictionaries.

The `diff_entry` class method is a particularly nice touch. Each collector knows how to format its own changes for human consumption. The disk collector shows percentage deltas. The process collector shows PIDs. The package collector counts additions and removals. The diff engine doesn't need to know any of this.

### branchfs's Fallback Mode Is the Real Product

branchfs has two modes: FUSE (transparent filesystem overlay) and fallback (materialize files with shutil). I wrote FUSE mode first because it's cooler. But fallback mode is what actually works everywhere — in Docker, in CI, on systems without FUSE support. The `FallbackBranch` context manager is clean:

```python
with fs.branch_context(snap_id) as fb:
    (fb.workdir / "file.txt").write_text("data")
    fb.merge()  # or let it auto-discard
```

If I were starting over, I'd build fallback mode first and treat FUSE as an optional acceleration layer. The API would be the same either way — the `BranchFS` class already abstracts over both modes. I just happened to build them in the wrong order.

### The Sensitivity Filter Casts a Wide Net

Strata's env var collector masks values for keys containing `SECRET`, `PASSWORD`, `TOKEN`, `KEY`, `CREDENTIAL`, or `PRIVATE`. The substring match on `KEY` means `KEYBOARD_LAYOUT`, `KEYRING_BACKEND`, and `XAUTHORITY_KEY` all get masked. This is arguably correct — better to over-mask than to leak a credential — but it produces noisy diffs when non-sensitive `KEY`-containing variables change. A smarter approach would be suffix matching (`_KEY`, `_SECRET`) rather than substring matching.

## What I'd Do Differently

**Derive CLI choices from the registry.** The `COLLECTOR_NAMES` bug was entirely preventable. If the CLI had done `[cls.name for cls in ALL_COLLECTORS]`, the list would always be correct. Hardcoded lists that mirror dynamic registries are a maintenance hazard.

**Test the blob store under concurrency.** The `.tmp` race condition is the kind of bug that only shows up in production. A simple test with `concurrent.futures.ThreadPoolExecutor` storing the same blob from 10 threads would have caught it immediately.

**Store blob sizes in the tree.** The `getattr` performance issue is a fundamental design problem, not a bug. The tree should map `path -> (hash, size)` instead of `path -> hash`. This would make stat calls O(1) instead of O(filesize) and is a prerequisite for FUSE mode being usable on any non-trivial project.

**Use `fnmatch` instead of hand-rolled glob matching.** Python's standard library has `fnmatch.fnmatch`. My hand-rolled version had a bug on the first try. The stdlib version wouldn't have.

---

Three bugs fixed, two design issues identified, one blog post written. The total time from "I should review this code" to "done" was about two hours. The bugs were all in code I wrote myself, within the last month. Code review works even — especially — on your own code, if you approach it with fresh eyes and a willingness to be embarrassed.
