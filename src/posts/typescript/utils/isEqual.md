---
description: 在TS中判断类型严格相等
title: IsEqual
readingTime: true
tag:
  - TypeScript
outline: [2, 3]
article: false
publish: false
---

# IsEqual
## 定义

俺们对于严格相等的定义是: 两个类型必须完全相同.

::: warning
俺们这里说的不是"可分配性", 而是"完全相同".

例如, `string`和`string`是相同的, `string`和`'sometext'`是不同的.
:::


## 引入

对于判断两个类型是否相等, 很多读者可能会想到使用`extends`操作符, 通过两个类型互相可分配来描述其相等, 但是这种方式并不严格, 例如:

```ts
type IsEqual<T, U> = T extends U ? U extends T ? true : false : false
```

这种方式在很多情况下是可以工作的, 但是在一些特殊情况下, 它并不能很好的工作, 例如:

```ts
type X = IsEqual<{ x: any }, { x: number }>
```

这里`X`的结果是`true`, 但是这两个类型并不相等. 

也就是说, 
> **互可分配并不代表相等**.

> Mutually assignable does not mean equal.

因为 `any`是特殊的. 在TypeScript中, `any`是一个特殊的类型, 它可以被分配给任何类型, 也可以接受任何类型. (除了`never`)

::: tip
#### 扩展阅读
`any`还有一个亲戚, 那就是`unknown`. `unknown`是一个安全的类型, 它可以接受任何类型, 但是它不能被分配给任何类型. (除了`any`)
:::

另外, 对于联合类型, 这里还会出现问题, 例如:

```ts
type A = 1 | 2
type B = 1 | 2
type X = IsEqual<A, B> // boolean
```

这里错误的推导出了`X`是`boolean`, 但是`A`和`B`是相等的, 俺们期待的结果是`true`. 这与TypeScript的`extends`对于联合类型的分发特性有关.

更加进阶的读者可能会想到使用下面的方式:
```ts
type IsEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false
```
俺们把`T`, `U`放进元组, 由于元组是不可变的, 这样就可以避免联合类型的分发特性. 但是这种方式并不完美, 只有一个问题, 即在这个情况下, `any`会与任何类型相等(除了`never`), 这并不是俺们想要的, 比如:

```ts
type s = IsEqual<any, number> // true
```
俺们期望的结果是`false`, 因为`any`和`number`并不严格的相等.

## 解答
俺们使用
```ts
type Equals<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends
    (<T>() => T extends Y ? 1 : 2) ? true : false;
```

这里利用了`extends`在检查函数签名时的特性, 他们将在所有的`T`下相等, 这要求`X`和`Y`严格相等(identical).

设想这样的场景:

```ts
type X = any
type Y = number

type s = 
  (<T>() => T extends X ? 1 : 2) extends 
  (<T>() => T extends Y ? 1 : 2) ? true : false
```

对于任意的`T`, `(<T>() => T extends X ? 1 : 2)`是否总是 `extends` `(<T>() => T extends Y ? 1 : 2)`呢?

设想以下情形:

```ts
// T is any
() => any extends X ? 1 : 2 extends () => any extends Y ? 1 : 2 is true

// T is number
() => number extends X ? 1 : 2 extends () => number extends Y ? 1 : 2 is true

// T is string, counter example
() => string extends X ? 1 : 2 extends () => string extends Y ? 1 : 2 is false
```

存在这样的`T`, 使得`(<T>() => T extends X ? 1 : 2)`不等于`(<T>() => T extends Y ? 1 : 2)`, 所以`X`和`Y`不相等.

```ts
// 让俺们仔细观察这个反例
// 让俺们代入 T is string, X is any, Y is number

// 俺们求解第二个extends左右两项的类型
() => string extends any ? 1 : 2 is 1
() => string extends number ? 1 : 2 is 2

// 求解第二个extends的结果
1 extends 2 is false
```

那么是否当且仅当`X`和`Y`严格相等时, `(<T>() => T extends X ? 1 : 2)`才等于`(<T>() => T extends Y ? 1 : 2)`呢?

#### 数学证明
为了便于书写, 俺们约定以下的写法:
$$
a \in b \text{ 表示 } a \text{ extends } b
$$
```ts
Eq<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
// 等价于
declare let x: <T>() => (T extends number ? 1 : 2)
declare let y: <T>() => (T extends number ? 1 : 2)

y = x // x是否能够安全的赋值给y?
```
上面的问题又等价于:

假设$\Omega$是所有类型的集合, 

$T,X, Y \in \Omega$, 下面的等式是否成立:
$$
\
\forall T, (T \in X \Rightarrow 1) \land (T \notin X \Rightarrow 2) = (T \in Y \Rightarrow 1) \land (T \notin Y \Rightarrow 2)
$$

Proof:

$$
\begin{aligned}
&\text{if} \quad X = Y \quad \text{then} \\

&\quad \text{Obviously,}\ \forall T, (T \in X \Rightarrow 1) \land (T \notin X \Rightarrow 2) = (T \in Y \Rightarrow 1) \land (T \notin Y \Rightarrow 2) \\

&\text{if} \quad X \neq Y \quad \text{then} \\
&\quad \exists t, t \in X \neq t \in Y \\
&\therefore \exists T, (T \in X \Rightarrow 1) \land (T \notin X \Rightarrow 2) \neq (T \in Y \Rightarrow 1) \land (T \notin Y \Rightarrow 2) \\
&\therefore \mathrm{Eq}<X, Y> = \text{false} \\
&\therefore \forall X, Y, \mathrm{Eq}<X, Y> \text{ is true if and only if } X = Y
\end{aligned}
$$

于是俺们得到了结论, `Equals`可以判断两个类型是否严格相等.

这对于`any`和联合类型都是有效的.
```ts
type s = Equals<any, number> // false
```

## 参考

https://github.com/microsoft/TypeScript/issues/27024#issuecomment-421529650

https://stackoverflow.com/questions/68961864/how-does-the-equals-work-in-typescript/68963796#68963796