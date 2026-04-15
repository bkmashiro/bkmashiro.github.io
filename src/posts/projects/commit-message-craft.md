---
date: 2026-04-15
description: "What makes a commit message good? A look at real commit history patterns, common anti-patterns, and the philosophy behind writing commits that future-you will thank you for."
title: "Commit Message Craft: What Your Git Log Says About You"
readingTime: true
tag:
  - Git
  - Dev Tools
  - Software Engineering
outline: [2, 3]
---

Consider two commit messages for the same change — a fix for a race condition in a test suite:

```
Fixed wait condition in test worker kill process
```

```
fix: replace sleep-based sync with process.Wait() in worker kill test
```

The first tells you something changed. The second tells you *what* was wrong, *what* replaced it, and *where*. Six months from now, when `git bisect` drops you on this commit, one of these messages will save you twenty minutes. The other will send you reading the diff.

I went through the commit history of about fifteen repositories I've worked on or maintained — ranging from small CLI tools to a full-stack app with hundreds of commits — and categorized what I found. The patterns are consistent enough to be worth writing about.

## Why Commit Messages Matter (The Archaeology Argument)

The commit log is your codebase's archaeology layer. When you run `git blame` on a confusing line and find "update" as the commit message, you learn nothing. When you find "fix: silent fallback to zero for unresolved identifiers in MIR lowering," you immediately understand the intent and can decide whether the current code still serves that purpose.

Three tools make commit messages load-bearing:

- **`git blame`** — "why does this line exist?" Only useful if the commit message answers the question.
- **`git bisect`** — binary search for the commit that introduced a bug. Good messages let you skip obviously-irrelevant commits at a glance.
- **`git log --oneline`** — the changelog nobody has to maintain. If your messages are good, this *is* your changelog.

The audience for a commit message is not the reviewer approving your PR today. It's the developer (possibly you) debugging a production issue at 2 AM six months from now.

## The Anti-Pattern Zoo

Here are real patterns I found, organized by how much damage they do.

### The One-Word Void

```
logging
logging cleanup
debugging
proc
fix adapter
```

These are from a real repository. Five consecutive commits, and the log tells you nothing about what changed or why. "logging cleanup" — which logging? What was dirty about it? "proc" — what about processes? "debugging" — you committed your debug code? Or you fixed a bug you were debugging?

The fix is simple: spend ten seconds. "Remove verbose stdout logging from worker lifecycle" takes ten seconds to write and saves ten minutes to understand later.

### The Verb Without an Object

```
update readme
use tmp subfolder
fix file adapter
```

"Update readme" is the most common commit message in the world and the least informative. What did you update *about* the readme? "Add installation instructions to README" is a message. "update readme" is a shrug.

"Fix file adapter" — which file adapter? What was broken? Compare with a message from another repository: "fix: silent TOML config parse failures to surface errors to users." Same word count, vastly more information.

### The Repeated Hammering

One repository contained this sequence:

```
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker cancel
```

Four identical messages followed by a slight variant. This is the "maybe this time it'll work" pattern — pushing fix attempts one by one instead of understanding the problem first. Each commit is a guess, not a solution.

This is a workflow problem, not a message problem. These should have been a single commit: "fix: race condition in worker termination tests — replace polling with synchronous Wait()." If you're iterating on a fix, use `git commit --amend` or squash before merging.

### The Past Tense Trap

```
Implemented healthcheck command
Implemented preview unit tests from BaseEvalFnLayer
Refactored eval only aspects to own function
Created unit test for single feedback case
Wrote test to confirm that exceptions are caught as warnings
```

These are grammatically fine and reasonably descriptive — much better than "update" or "fix." But they use past tense where convention expects imperative. The standard (established by the Linux kernel and adopted by Conventional Commits, Angular, and most major open-source projects) is imperative mood: "Add healthcheck command," not "Added healthcheck command."

Why? A commit message should complete the sentence "If applied, this commit will ___." "If applied, this commit will *implement healthcheck command*" reads naturally. "If applied, this commit will *implemented healthcheck command*" does not.

Is this the most important thing? No. But it's free, and consistency in a log matters.

## When Convention Helps

The best-maintained repository I examined used a consistent prefix convention:

```
feat: add lens expressions, pattern classifier, and path pinning
fix: correct AI-generated test expectations to match implementation
perf: delta compression + ring buffer storage (no silent drops)
design: fix hardcoded color literals — use design tokens throughout
i18n: tamper detection strings EN/ZH/JP
```

The prefixes (`feat`, `fix`, `perf`, `design`, `i18n`) let you scan the log at speed. Looking for what broke? Scan for `fix:`. Want to know what shipped in this release? Scan for `feat:`. Need to review security changes? Search for `fix:` near authentication code.

Another repository used a custom convention — `burn(type):` with a ticket ID suffix:

```
burn(bug): Fix ne/inequality operator in cmpToMC() for if-score contexts [9GH3DD]
burn(test): Add tests for break/continue label error paths in MIR lowering [D628K0]
burn(docs): Add JSDoc to flattenExecute() and emit() helper functions [HB6X9N]
```

The ticket IDs (`[9GH3DD]`) link each commit to a tracking system. The category (`bug`, `test`, `docs`) makes the log scannable. It's more verbose than standard Conventional Commits, but it works because it's *consistent*.

### When Convention Is Overkill

For a personal project with three commits:

```
Initial implementation of Tempo: adaptive rate limiter with rhythm detection
Add .gitignore and remove cached/generated files from tracking
Remove cached/generated files from git tracking
```

Nobody needs `feat:` prefixes here. The messages are clear, descriptive, and tell the story. Prefixes add value when a log has hundreds of entries and you need to filter. For a repository with five commits, they're ceremony.

## Messages That Aged Well

The best messages I found share a pattern: they explain the *problem*, not just the *solution*.

```
fix: per-cardKey phase map so leaving card holds answer state during slide
```

This doesn't just say "fix card state" — it tells you the mechanism (per-cardKey phase map) and the symptom (leaving card lost answer state during slide animation). A year from now, if someone touches the card animation code, this message is a warning sign: "be careful, the phase map exists for a reason."

```
feat: detect pre-git timestamp tampering (<2005-04-07); block leaderboard enrollment + show roast banner
```

This is almost too detailed for a subject line, but it packs in the detection threshold, the consequence, and the user-facing result. You can understand the entire feature from the commit message without reading the diff.

Compare with:

```
fix adapter
```

One of these will make sense in 2028. The other already doesn't.

## The Heuristic

Before you hit enter on a commit message, apply this test:

**If someone reads only `git log --oneline` for this file, will they understand why this change exists?**

Not *what* changed — the diff shows that. *Why* it changed. What was broken, what was missing, what was the goal.

A secondary test: **Will `git bisect` benefit from this message?** If you're binary-searching for a regression and you land on this commit, can you tell in five seconds whether it's relevant?

If the answer to both is yes, your message is good enough. If not, add the one clause that's missing — usually the "because" or "so that" part.

## When to Break the Rules

Rules exist for mainline history. They don't apply everywhere:

- **WIP commits on a feature branch** that you'll squash before merging: write whatever you want. "WIP stuff" is fine if it never hits `main`.
- **Automated commits**: `chore: auto-bump vscode extension to 1.3.93 [skip ci]` is mechanical and should look mechanical. Don't dress it up.
- **Initial commits**: `Initial implementation of Strata: Environment Archaeology Tool` is perfectly good. No prefix needed. You're writing the first sentence of the project's history — make it count.
- **Revert commits**: git generates the message for you. Let it.

The goal isn't rule-following. The goal is a `git log` that tells a story — one that future developers can read, search, and trust. Every commit message is a tiny act of documentation. Most of them will never be read. The ones that are will be read at the worst possible time: during an outage, during a bisect, during a "who wrote this and why" moment at midnight.

Spend the ten seconds. Future-you is the audience, and future-you will not remember what "fix adapter" meant.
