---
date: 2026-03-29
description: TypeChallenge - 3376
title: Inorder Traversal
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Inorder Traversal
[Problem Link](https://tsch.js.org/3376)

## Problem

Implement type-level in-order traversal of a binary tree.

```ts
const tree1 = {
  val: 1,
  left: null,
  right: {
    val: 2,
    left: {
      val: 3,
      left: null,
      right: null,
    },
    right: null,
  },
} as const

type A = InorderTraversal<typeof tree1> // [1, 3, 2]
```

## Solution

### Approach: Recursive Conditional Type

In-order traversal visits left subtree, then root, then right subtree.

```ts
interface TreeNode {
  val: number
  left: TreeNode | null
  right: TreeNode | null
}

type InorderTraversal<T extends TreeNode | null> =
  T extends TreeNode
    ? [
        ...InorderTraversal<T['left']>,
        T['val'],
        ...InorderTraversal<T['right']>
      ]
    : []
```

**How it works:**
1. If `T` is `null`, return `[]` (base case).
2. Otherwise, recursively traverse `left`, collect `val`, then traverse `right`.
3. Spread all three into a single tuple.

## Key Takeaways

- Recursive conditional types naturally model tree recursion.
- Tuple spreading (`[...A, B, ...C]`) assembles results from multiple branches.
- The base case `T extends TreeNode` handles the `null` union automatically.
