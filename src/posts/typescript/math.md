---
description: TS-Math
title: TS-Math
readingTime: true
tag:
  - TypeScript
outline: [2, 3]
# article: false
---


# Math series
<!-- more -->
### Simple Add
```ts
const _mod_map = {
  0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
  2: [2, 3, 4, 5, 6, 7, 8, 9, 0, 1],
  3: [3, 4, 5, 6, 7, 8, 9, 0, 1, 2],
  4: [4, 5, 6, 7, 8, 9, 0, 1, 2, 3],
  5: [5, 6, 7, 8, 9, 0, 1, 2, 3, 4],
  6: [6, 7, 8, 9, 0, 1, 2, 3, 4, 5],
  7: [7, 8, 9, 0, 1, 2, 3, 4, 5, 6],
  8: [8, 9, 0, 1, 2, 3, 4, 5, 6, 7],
  9: [9, 0, 1, 2, 3, 4, 5, 6, 7, 8],
} as const

const _carry_map = {
  0: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  2: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  3: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
  4: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
  5: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  6: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
  7: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
  8: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
  9: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
} as const
type $CARRY = 0
type $MODULO = 1
type MOD_MAP = typeof _mod_map
type CARRY_MAP = typeof _carry_map

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type DigitStr = `${Digit}`
type StrAdd1d<P, Q> = P extends `${infer p extends Digit}` ?
  Q extends `${infer q extends Digit}` ? [`${CARRY_MAP[p][q]}`, `${MOD_MAP[p][q]}`] : never : never

type StrAdd1dCarry<P extends string, Q extends string, C extends string> = readonly [
  StrAdd1d<StrAdd1d<P, Q>[$CARRY], StrAdd1d<C, StrAdd1d<P, Q>[$MODULO]>[$CARRY]>[$MODULO],
  StrAdd1d<StrAdd1d<C, Q>[$MODULO], P>[$MODULO]
]

type ReverseString<S extends string> = S extends `${infer First}${infer Rest}` ? `${ReverseString<Rest>}${First}` : ''

type StrAddMid<_P extends string, _Q extends string, P = ReverseString<_P>, Q = ReverseString<_Q>, Carry extends string = "0"> =
  [P, Q] extends [`${infer Fp}${infer Rp}`, `${infer Fq}${infer Rq}`] ?
  [StrAdd1dCarry<Fp, Fq, Carry>[$MODULO], ...StrAddMid<"0", "0", Rp, Rq, StrAdd1dCarry<Fp, Fq, Carry>[$CARRY]>] : []

// pad 0 to front if exceeded
type StrAdd<P extends string, Q extends string> = ReverseString<Join<StrAddMid<P, Q>, ''>>

type Join<
  TElements,
  TSeparator extends string,
> = TElements extends Readonly<[infer First, ...infer Rest]>
  ? Rest extends ReadonlyArray<string>
  ? First extends string
  ? `${First}${Rest extends [] ? '' : TSeparator}${Join<Rest, TSeparator>}`
  : never
  : never
  : ''

type s = StrAdd<"0999999999999999999999999999999999999999999", "0999999999999999999999999999999999999999999">
```

TO BE CONTINUED...