---
title: "KakuYaku：从零搭一个日语划词插件"
date: 2026-03-20
description: "用 Chrome 扩展 + NestJS + Sudachi + PostgreSQL/PGroonga + DeepSeek 做了一个日语阅读助手——分词、词典查询、假名注音、AI 语法解析，全栈从零到可用。"
readingTime: true
tag:
  - Chrome 扩展
  - 日语
  - NLP
  - NestJS
  - TypeScript
  - AI
outline: [2, 3]
---

我在看日文资料时总有查词的需求。现有的工具要么太重（需要手动划词+查词典），要么太轻（只有汉字读音，没有语法解析）。所以自己做了一个。

- GitHub: [bkmashiro/kaku-yaku-ext](https://github.com/bkmashiro/kaku-yaku-ext) | [bkmashiro/kaku-yaku-api](https://github.com/bkmashiro/kaku-yaku-api)

---

## 技术选型

### 分词：Sudachi

日语分词不像中文，有专门的工具。Sudachi 是 WorksApplications 开源的分词器，有 Python/Java/Rust 绑定，我用了 Node.js native module 版本。

Sudachi 的输出很丰富：

```json
{
  "surface": "食べて",
  "dictionaryForm": "食べる",
  "reading": "タベテ",
  "pos": "動詞",
  "posDetail": ["一般", "*", "*", "*", "*"]
}
```

### 词典：JMDict + KANJIDIC2 + PostgreSQL/PGroonga

词典数据用 EDRDG 的开放数据：
- **JMDict** — 20 万+ 日英词条
- **KANJIDIC2** — 13,000+ 汉字
- **Tatoeba** — 24 万+ 例句

存 PostgreSQL，装 [PGroonga](https://pgroonga.github.io/) 扩展做全文搜索。PGroonga 是专门为日语/中文优化的 FTS 方案，比 `pg_trgm` 对日文更友好。

JMDict 的实体定义（词性标注）存为真正的 `text[]` 数组，查询时用 `= ANY()`。

### 前端：Chrome Extension Manifest V3 + Vue 3

用 [vite-vue3-browser-extension-v3](https://github.com/mubaidr/vite-vue3-browser-extension-v3) 模板。Manifest V3 的 service worker 架构有点烦——background page 不再常驻，每次都要重连，需要注意 message channel 的生命周期。

### LLM：DeepSeek

语法解析和翻译用 LLM。最初用 Gemini Flash 2.0（免费额度 1500 req/day），开发调试用完了一天额度后切到 DeepSeek（`deepseek-chat`，兼容 OpenAI API，约 $0.14/Mtok）。

---

## 核心实现

### 分词 + 高亮

内容脚本遍历页面文本节点，发送给 API 分词，然后把原始文本节点替换成高亮 span：

```ts
const response = await sendToBackground({ action: 'analyze', text: node.textContent })
const tokens = response.tokens

// 替换文本节点为 span 序列
const fragment = document.createDocumentFragment()
for (const token of mergedTokens) {
  const span = document.createElement('span')
  span.className = `kaku-yaku-highlight kaku-yaku-${token.pos}`
  span.dataset.surface = token.surface
  fragment.appendChild(span)
}
node.parentNode.replaceChild(fragment, node)
```

### 动词活用形合并

Sudachi 把「食べている」切成三个 token：食べ、て、いる。但对于学习者来说，这是一个语法单元。

合并规则：
- 動詞 + 助動詞\* → 整体合并（食べている、落成した）
- サ変名詞 + する + 助動詞\* → 合并（制圧する、参加している）
- 形容詞 + 助動詞\* → 合并（美しかった）

```ts
// posDetail[1] === 'サ変可能' 判断サ変名詞
const isSahenNoun = (t: Token) =>
  t.pos === '名詞' && t.posDetail?.[1] === 'サ変可能'
```

### Popup 词典卡片

点击高亮词，弹出浮动卡片，显示：
- surface + reading（如果与 surface 不同）
- 词性 badge + JLPT level badge
- 释义列表
- 例句

定位用 `position: absolute`，坐标取 span 的 `getBoundingClientRect()` + `scrollY`，这样 popup 跟随页面滚动不会错位。

### AI 语法解析

调用 DeepSeek 的 OpenAI 兼容接口，使用 `response_format: { type: 'json_object' }` 强制 JSON 输出（不需要 regex 去剥 markdown 代码块）：

```ts
const res = await client.chat.completions.create({
  model: 'deepseek-chat',
  messages: [
    { role: 'system', content: `JSON schema: { role, function, rule, example, exampleTrans }` },
    { role: 'user', content: `Sentence: "${sentence}"\nExplain: "${targetWord}"` },
  ],
  response_format: { type: 'json_object' },
  max_tokens: 300,
})
```

结果缓存在 `Map<paragraphText, { grammar?, translation? }>`，同一段落内的词共享缓存。已分析的段落加左侧青色边框提示。

---

## 踩的坑

**Manifest V3 service worker 生命周期**

Service worker 随时可能被 kill。内容脚本发消息给 background 时，如果 worker 已经休眠，`sendMessage` 会抛 "message channel closed before response"。

解法：每个 case 分支显式返回 Promise，不依赖 `async/await` 的隐式保持。

**JMDict 字段名**

API 返回的结构里，释义字段叫 `gloss: string[]`，不是 `meanings[0].glosses`。文档不清楚，调试时发现的。

**sshfs-win 远程开发**

在 Windows 上开发，代码在 Mac Mini（Tailscale `100.73.231.27`）上运行。CRXJS 的 HMR dev server 用 `localhost:3303`，远程访问不到。改成 production watch build + sshfs-win 挂载 `dist/chrome` 目录，Chrome 加载 unpacked 扩展。

**Gemini API baseURL**

正确的是 `https://generativelanguage.googleapis.com/v1beta/openai/`，不是 `/openai/v1/`。文档里不明显。

---

## 现在的功能

- [x] 分词 + 高亮（按词性染色）
- [x] 动词/形容词活用形合并
- [x] 浮动词典卡片（reading、词性、JLPT、释义、例句）
- [x] 假名注音（hover / always 模式）
- [x] AI 语法解析（DeepSeek，支持多语言输出）
- [x] AI 翻译（句子级别，不翻整段）
- [x] 生词本（storage.local，状态追踪）
- [x] LLM 结果缓存（段落粒度）
- [x] 设置页（语言、furigana 开关，storage.sync 跨设备同步）

---

做这个的主要动力是用起来确实方便。之后想加的是 Anki 一键导出——生词本数据导入 Anki 复习。
