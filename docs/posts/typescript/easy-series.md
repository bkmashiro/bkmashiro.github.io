---
description: TypeChallenge - Easy series
title: 类型体操 - 简单系列
readingTime: false
tag:
  - TypeScript
    - TypeChallenge
outline: [2, 3]
---

# TypeChallenge - Easy series

## 前言

在本章内, 俺们将快速的完成所有的 easy 系列的 TypeChallenge.

俺将会分享俺的思路与代码, 以及一些补充的内容.

## 热身运动

先通过这道被标记 `warm` 难度的题目来热热身.

### 013 - hello world

[013 - Hello world](https://github.com/type-challenges/type-challenges/blob/main/questions/00013-warm-hello-world/README.md)

```ts
/* _____________ 俺的代码 _____________ */
type HelloWorld = string; // expected to be a string

/* _____________ 测试用例 _____________ */
import type { Equal, Expect, NotAny } from "@type-challenges/utils";

type cases = [Expect<NotAny<HelloWorld>>, Expect<Equal<HelloWorld, string>>];
```

TypeChallenge 要求俺们写一个类型, 来满足某个要求. 其中对俺们写的代码的正确性, 会通过一些测试用例来验证.

本题要求俺写一个类型 `HelloWorld`, 使得这个类型是一个字符串.

这里俺写了

```ts
type HelloWorld = string;
```

这样就完成了这道题目.

在测试用例中, 有两个断言:

1. `Expect<NotAny<HelloWorld>>` 期望 `HelloWorld` 不是 `any` 类型.
2. `Expect<Equal<HelloWorld, string>>` 期望 `HelloWorld` 是一个字符串.

TypeScript 推断其是对的, 在俺的编辑器中, 没有报错. 证明俺对了.

::: tip
在之后的内容中, 俺不会再重复这些原题与测试用例, 但是会在每道题目中给出链接.
:::

## 简单系列

接下来是 easy 系列的题目.

他们分别是:

- 004 - 实现 Pick
- 014 - 第一个元素
- 189 - Awaited
- 898 - Includes
- 3312 - Parameters
- 7 - 对象属性值的类型
- 18 - 获取元组长度
- 268 - If
- 57 - Push
- 43 - 实现 Exclude
- 533 - Concat
- 3060 - Unshift

---

### 004 - 实现 Pick

[004 - Pick](https://github.com/type-challenges/type-challenges/blob/main/questions/00004-easy-pick/README.md)

俺们要实现一个 `Pick` 类型, 使得 `Pick<T, K>` 从 `T` 中选取 `K` 的属性.

俺们在这要用到 [Mapped Type](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html) 的知识.

> Mapped Type 是 TypeScript 中的一种高级类型, 通过映射现有类型的属性来创建新类型.

自然的, 俺想到了 `for in` 循环.

只要是 `K` 中的属性, 就从 `T` 中取出来.

于是俺写了这样的代码:

```ts
type MyPick<T, K> = { [P in K]: T[P] };
```

但是, TypeScript 提示 `P` 不能用于索引类型 `T`. 这是怎么回事呢?

设想这样的场景:

```ts
type T = {
  a: string;
  b: number;
};

type K = "c" | "d";
```

`K` 中的属性 `c` 和 `d` 在 `T` 中是不存在的, 但是我们尝试在 `P` 中取到这两个属性, 这是不安全的.

于是俺们需要约束 `K` 为 `T` 的键.

即 `K extends keyof T`.

于是俺写出了这样的代码:

```ts
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
```

这样就完成了这道题目.

---

### 014 - 第一个元素

[014 - First](https://github.com/type-challenges/type-challenges/blob/main/questions/00014-easy-first/README.md)

这道题目要求俺写一个类型 `First<T>`, 使得 `First<[1, 2, 3]>` 的结果是 `1`.

很多读者可能会想到用索引访问数组的第一个元素.

```ts
type First<T extends any[]> = T[0];
```

这在大多数情况下是没问题的, 但是当数组为空时, 会提取出 `undefined`. 然而俺们期望的是 `never`.

俺在这给出这样的写法:

```ts
type First<T extends any[]> = T extends [] ? never : T[0];
```

当 `T` 是空数组时, 返回 `never`, 否则返回第一个元素.

或者, 俺们可以用 `infer` 关键字来解决这个问题. (`infer` 关键字可能有些难懂, 俺在这放一个例子)

<details>
<summary>点击查看 infer 例子</summary>

```ts
type Infer<T> = T extends Promise<infer R> ? R : never;
```

> infer 关键字用于在条件类型语句中引入一个新的类型变量, 并尝试对它进行类型推断.
> 这是啥意思呢? 咱们假设 T 是一个`Promise<number>`, 那么`R`就是`number`.

因为 T 是`Promise<number>`, 当 R 是`number`时, `Promise<number>`就是`Promise<R>`, 所以`T extends Promise<infer R>`是成立的.

TS 帮助俺们推断出了`R`是`number`. 于是俺们在后面也可以使用`R`了.

这就是`infer`的作用.

在这里, 如果 TS 无法推断出`R`, 那么`T`便不是`Promise`类型, 于是返回`never`.

</details>

如果读者对于`extends ? :`语法不太了解, 可以查看 [条件类型](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) 的文档.

俺简单说说:

- `T extends [] ? never : T[0]` 是一个条件类型.
- `T extends []` 是一个条件, 如果 `T` 是一个空数组, 那么返回 `never`, 否则返回 `T[0]`.

于是这样的写法也是可以的:

```ts
type First<T extends readonly any[]> = T extends [infer F, ...infer R]
  ? F
  : never;
```

当 `T` 是一个非空数组时, 返回第一个元素, 否则返回 `never`.

这里俺用`readonly any[]`来表示数组, 这里的`T`既可以是数组(`any[]`)也可以是元组(`readonly any[]`).

::: tip
`readonly` 是一个只读数组类型, 用于约束数组的不可变性.
:::

::: warning
一个事实: readonly 数组 与 普通数组, 谁是谁的子类型?

答案是: 普通数组 是 readonly 数组 的子类型.

因为 readonly 数组是只读的, 不能修改, 但是普通数组可以读也可以写, 所以普通数组的行为比 readonly 数组更多, 也就是说普通数组是 readonly 数组的子类型.

子类型比父类型的行为更多.
:::

这样就完成了这道题目.

---

### 189 - Awaited

[189 - Awaited](https://github.com/type-challenges/type-challenges/blob/main/questions/00189-easy-awaited/README.zh-CN.md)

这道题目要求俺写一个类型 `Awaited<T>`, 使得 `Awaited<Promise<number>>` 的结果是 `number`.

值得注意的是, 如果 `T` 不是一个 `Promise`, 那么返回 `T`.
如果 `T` 是一个 `Promise`, 那么返回 `Promise` 的结果.
如果 `T` 是一个 `Promise<Promise<number>>`, 那么返回 `number`.(即递归地解包)

这里俺用到了之前提及的`infer`关键字来提取`Promise<?>`的结果.

于是俺写:

```ts
type MyAwaited<T extends PromiseLike<any>> = T extends PromiseLike<infer V>
  ? V extends PromiseLike<any>
    ? MyAwaited<V>
    : V
  : never;
```

这里用到的一个工具类型是`PromiseLike`, 它是一个泛型接口, 用于约束`Promise`类型.

```ts
interface PromiseLike<T> {
  /**
   * Attaches callbacks for the resolution and/or rejection of the Promise.
   * @param onfulfilled The callback to execute when the Promise is resolved.
   * @param onrejected The callback to execute when the Promise is rejected.
   * @returns A Promise for the completion of which ever callback is executed.
   */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): PromiseLike<TResult1 | TResult2>;
}
```

只要是长得像`Promise`的类型, 就是`Promise`类型. `PromiseLike`是一个泛型接口, 用于约束`Promise`类型.

设想这样的场景:

```ts
MyAwaited<V>;
```

对于这个`V`, 我们讨论下面的 2 种情况:

- (recursive) 如果`V`是`PromiseLike<any>`, 那么我们继续解包.
- (base) 如果`V`不是`PromiseLike<any>`, 那么我们返回`V`.

于是俺们写:

- `V` 是 `PromiseLike<U>`, 那么返回 `MyAwaited<U>`. (递归条件,继续递归解包)

  比如`V = Promise<Promise<number>>`, 那么`U = Promise<number>`, 我们应该返回`MyAwaited<U>`. 而`MyAwaited<U>`又匹配了递归条件, 于是我们继续解包, 直到`V`不再是`PromiseLike<any>`. `MyAwaited<U> = MyAwaited<Promise<number>>`的结果是`number`.

- `V` 不是 `PromiseLike<U>`, 那么返回 `V`. (基线条件,离开递归)

这样就完成了这道题目.

---

### 898 - Includes

[898 - Includes](https://github.com/type-challenges/type-challenges/blob/main/questions/00898-easy-includes/README.zh-CN.md)

这道题目要求俺写一个类型 `Includes<T, U>`, 使得 `U` 在 `T` 中. 比如 `Includes<[1, 2, 3], 3>` 的结果是 `true`. 因为 `3` 在 `[1, 2, 3]` 中.

这里俺想到了"递归"来实现遍历, 比较的方法.

俺将`U`在`T`中这个问题分解为 2 个子问题:

- (base case) `U`是`T`的第 1 个元素 (T=U[0])
- (recursive case) `U`在`T`的剩余元素中 (T in U[1..])

于是俺写下下面的伪代码

```ts
type Includes<T, U> =
  如果T是空数组, 返回false
  如果T的第一个元素是U, 返回true
  否则, 返回Includes<T的剩余元素, U>
```

俺将这个伪代码转化为 TypeScript 代码:

```ts
type Includes<T extends any[], U> = T extends []
  ? false // 如果T是空数组, 返回false
  : T extends [infer F, ...infer R] //第一个元素是F, 剩余元素是R
  ? IsEqual<F, U> extends true // 如果F和U相等
    ? true // 如果F和U相等 返回true
    : Includes<R, U> // 否则, 检查剩余的元素
  : false; // T不是数组
```

这里用到了`IsEqual`工具类型, 用于比较两个类型是否严格相等.
```ts
export type IsEqual<X, Y> = (<T>() => T extends X ? 1 : 2) extends <
  T
>() => T extends Y ? 1 : 2
  ? true
  : false;
```
关于`IsEqual`为啥这么写,俺在这先不展开讲,读者可以自行查阅资料.
注意: 
```ts
U extends V && V extends U
```
这样的关系不能说明U和V是严格相等的.
关于这个辩论, 请参考 [这里](https://github.com/microsoft/TypeScript/issues/27024#issuecomment-421529650).

这样就完成了这道题目.

---

TO BE CONTINUED...