---
date: 2026-03-21
title: "kaku-yaku：我做了一个日语学习浏览器插件"
description: 从零开发浏览器插件的踩坑记录
readingTime: true
tag:
  - 浏览器扩展
  - 日语学习
  - NestJS
outline: [2, 3]
---

# kaku-yaku：我做了一个日语学习浏览器插件

- GitHub: [bkmashiro/kaku-yaku-ext](https://github.com/bkmashiro/kaku-yaku-ext) | [bkmashiro/kaku-yaku-api](https://github.com/bkmashiro/kaku-yaku-api)

---

## 为什么做这个

我在看日语技术文档的时候总会碰到生词。碰到生词的标准流程是：选中 → 右键 → 搜索，或者切到另一个标签页查 Jisho。每次这样做都会打断阅读节奏，查完词还得找回之前读到哪里。

用 Yomichan 试了一阵，确实比手动查好，但我想要更多：不只是查词，还要能看到假名注音、看语法分析、把生词存下来复习。市面上的工具各自做了一部分，没有哪个组合让我满意。

最后想法很简单：自己做一个。

---

## 技术选型

### 书签脚本还是扩展？

最初想用 Bookmarklet，门槛低，不用走 Chrome Web Store 审核。写了一个能在页面上注入脚本、遍历文本节点的版本，勉强跑起来了。

问题很快暴露：Bookmarklet 没有持久化存储，每次刷新页面就消失，生词本功能根本没法做。而且 Content Security Policy 比较严的网站（比如 GitHub）会直接拦掉 `eval()`，脚本无法注入。

切到浏览器扩展是必然的。

### MV2 还是 MV3？

Chrome 在 Manifest V3 上的立场越来越明确：V2 扩展的支持会逐步退出。既然要做，直接上 MV3。

MV3 的最大变化是 background page 变成了 service worker。传统的 V2 扩展可以在后台常驻一个页面维持状态，V3 的 service worker 会被浏览器随时 kill 掉，再次需要时才重新激活。

这个改变带来了很多麻烦，后面会细说。

---

## 最难的部分：furigana overlay

furigana（假名标注）这个功能看起来简单：在汉字上方显示读音。但真正实现起来，DOM 操作的约束非常多。

### 不能破坏文本可选中性

最直觉的方案是在汉字上方叠一个 `position: absolute` 的 `<div>`，用绝对定位显示读音。问题是叠上去的 div 会遮住下面的文字，用户选中文字时会选到读音 span 而不是汉字本身。

用 `<ruby>` 标签是更合适的语义方案：

```html
<ruby>食<rt>た</rt></ruby>べている
```

但直接把整个段落换成 `<ruby>` 标签串起来会破坏原有的 DOM 结构——原来的 `<a>`、`<strong>`、`<code>` 嵌套关系全都乱了，React/Vue 渲染出来的组件也会出问题。

### 只替换文本节点

最终的方案是只操作叶节点的文本节点（`Node.TEXT_NODE`），不碰元素节点。遍历 DOM 时用 TreeWalker，跳过 `<script>`、`<style>`、`<textarea>` 等不该碰的节点：

```ts
const walker = document.createTreeWalker(
  root,
  NodeFilter.SHOW_TEXT,
  {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName.toLowerCase()
      if (['script', 'style', 'textarea', 'input'].includes(tag))
        return NodeFilter.FILTER_REJECT
      // 已经处理过的节点跳过
      if (parent.closest('.kaku-yaku-processed'))
        return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  }
)
```

找到文本节点后，把它替换成一组 `<span>` 包裹的 token，每个 token 内部用 `<ruby>` 标注读音：

```ts
const fragment = document.createDocumentFragment()
for (const token of tokens) {
  const span = document.createElement('span')
  span.className = `ky-token ky-${token.pos}`
  if (token.reading && token.reading !== token.surface) {
    const ruby = document.createElement('ruby')
    ruby.textContent = token.surface
    const rt = document.createElement('rt')
    rt.textContent = token.reading
    ruby.appendChild(rt)
    span.appendChild(ruby)
  } else {
    span.textContent = token.surface
  }
  fragment.appendChild(span)
}
node.parentNode!.replaceChild(fragment, node)
```

这样原有元素节点一个都没动，只是文本节点被替换成了等价的结构，文字选中、复制、搜索都正常工作。

---

## 分词的坑

后端用 Sudachi 做日语分词，运行在 NestJS 里。Sudachi 的精度很高，但它的分词粒度在学习场景下不总是对的。

### 活用形被切碎了

「食べている」在 Sudachi 的默认模式下被切成三个 token：`食べ`、`て`、`いる`。对于分析用途没问题，但对于学习者来说，这是一个完整的语法单元（进行体），应该作为整体显示。

合并规则写起来不复杂，但边界情况很多：

- `動詞` + `助動詞*` → 合并（食べている、食べた、食べられた）
- `サ変名詞` + `する` + `助動詞*` → 合并（参加している、制圧した）
- `形容詞` + `助動詞*` → 合并（美しかった、楽しかった）
- `て` 后面跟 `いる`/`おく`/`しまう` 等补助动词 → 合并

每加一条规则都要测一批例句，确认合并结果不会把不该合并的东西并在一起。比如「食べて帰る」里的「て」不应该和「帰る」合并，因为「帰る」是独立动词，不是助动词。

区分的方法是看词性细分：`posDetail[0]` 是 `非自立可能` 才算可以合并的补助用法。

### 读音不是总有

Sudachi 对于片假名词汇有时不提供 `reading` 字段（因为表面形式本身就是读音），有时又提供一个和表面形式一样的 reading。要在前端做一次过滤：reading 存在且和 surface 不同才显示 `<ruby>` 标注，否则直接渲染文字。

---

## MV3 service worker 的坑

Content Script 发消息给 background 是正常的通信方式：

```ts
chrome.runtime.sendMessage({ action: 'analyze', text })
```

但 MV3 的 service worker 会休眠，休眠中的 worker 在收到消息前可能还没有完全激活。表现是 `sendMessage` 有时成功，有时抛：

```
Error: Could not establish connection. Receiving end does not exist.
```

或者：

```
Error: The message port closed before a response was received.
```

两种错误原因不同，但都和 service worker 生命周期有关。

解法一：background 里每个消息处理分支都显式 `return true`（告诉 Chrome 这个 listener 会异步响应），不能依赖 async 函数的隐式行为：

```ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'analyze') {
    handleAnalyze(msg.text).then(sendResponse)
    return true  // 必须显式返回 true
  }
})
```

解法二：Content Script 发消息前先 ping 一次 background，如果失败就等待重试，而不是直接失败。

---

## 生词本设计

生词本用 `chrome.storage.local` 存，结构很简单：

```ts
interface WordEntry {
  surface: string
  reading: string
  meaning: string
  addedAt: number
  reviewCount: number
  lastReviewedAt?: number
}
```

双击高亮词就加入生词本，Side Panel 里显示列表。

关于复习功能，我想过几个方向：

**方案一：直接对接 Anki**。Anki 有 AnkiConnect 插件，可以通过 HTTP API 操作牌组。优点是复习质量高，算法成熟；缺点是依赖用户装 Anki + AnkiConnect，门槛相对高。

**方案二：内置简单间隔复习**。在插件里实现一个简化版的 SM-2，根据 `reviewCount` 和 `lastReviewedAt` 计算下次复习时间。优点是零依赖，打开插件就能用；缺点是功能没有 Anki 深。

**方案三：导出 CSV**。最轻量，把生词本导出成 Anki 可以导入的 CSV 格式，让用户自己处理。

目前做到了方案三的基础——生词本数据存储好了，导出还没接。复习功能是下一步要做的，大概率先做导出 Anki 这条路，因为不想重复造复习算法。

---

## 下一步

现在这个插件自己用是够的，主要还缺两件事：

**Anki 导出**：把 `WordEntry` 格式化成 Anki 的 Basic 牌组 CSV，一键导出，用户自己导入。或者直接对接 AnkiConnect，但后者需要用户配置。

**Chrome Web Store 发布**：审核流程比较麻烦，需要隐私政策页面、截图、描述文案。插件本身调用了远程 API（kaku-yaku-api），审核会关注数据处理这块。准备把 API 的数据流写清楚，应该没什么大问题。

Firefox 适配也在考虑中——WebExtension API 大部分兼容，主要差异在 `browser.sidePanel` 和 `chrome.sidePanel` 之间的调用方式。

---

用起来确实顺手。看日语资料不再需要切标签页，hover 就能看读音和词义，碰到不熟的语法结构点一下就有 AI 解析。做这个的主要动力就是"自己用"——够用了才会想打磨发布。
