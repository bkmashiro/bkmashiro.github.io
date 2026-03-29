---
date: 2024-08-18
description: TypeChallenge - 30430
title: Tower of Hanoi
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Tower of Hanoi
[Problem Link](https://tsch.js.org/30430)

## Problem

Simulate the Tower of Hanoi puzzle. Given `N` disks, return the sequence of moves as a tuple of `[from, to]` pairs.

```ts
type Hanoi1 = TowerOfHanoi<1>
// [['A', 'C']]

type Hanoi2 = TowerOfHanoi<2>
// [['A', 'B'], ['A', 'C'], ['B', 'C']]

type Hanoi3 = TowerOfHanoi<3>
// [['A', 'C'], ['A', 'B'], ['C', 'B'], ['A', 'C'], ['B', 'A'], ['B', 'C'], ['A', 'C']]
```

## Solution

```ts
type Peg = 'A' | 'B' | 'C'

type TowerOfHanoi<
  N extends number,
  From extends Peg = 'A',
  To extends Peg = 'C',
  Via extends Peg = 'B',
  Count extends unknown[] = []
> =
  Count['length'] extends N
    ? []
    : [
        ...TowerOfHanoi<N, From, Via, To, [...Count, unknown]>,
        [From, To],
        ...TowerOfHanoi<N, Via, To, From, [...Count, unknown]>
      ]
```

**How it works:**
1. Classic Tower of Hanoi recursion:
   - Move `N-1` disks from `From` to `Via` using `To` as buffer.
   - Move the largest disk directly from `From` to `To`.
   - Move `N-1` disks from `Via` to `To` using `From` as buffer.
2. `Count` tracks recursion depth — when `Count['length'] === N` we've reached the base case (0 disks = no moves).
3. Results are concatenated with spread into a flat tuple of `[from, to]` pairs.

## Key Takeaways

- Using `Count` as a depth counter is the standard technique for implementing "decrement N" recursion in TypeScript types.
- The algorithm structure is identical to the runtime Tower of Hanoi: the type system just evaluates it statically.
- Result tuples are assembled by spreading three pieces: left recursive result + current move + right recursive result.
