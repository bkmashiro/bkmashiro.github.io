---
title: "AI 驱动的游戏设计：从协议文档到排行榜一步到位"
description: "我们如何在 Leverage OJ 上构建 MCP 服务器，让 AI 自主设计、测试、发布 Bot 对战游戏——并用它端到端生成了四个完整游戏。"
date: 2026-03-11
readingTime: true
tag:
  - AI
  - MCP
  - 游戏设计
  - NestJS
  - Systems
outline: [2, 3]
---

Leverage OJ 重写完成后，下一个问题是：AI 能不能自主使用这个平台——不只是调 API，而是从头设计一整个游戏？

答案是可以。关键要素只有两个：一份机器可读的协议文档，和一个 MCP 服务器。

---

## GET /ai：写给机器看的文档

我们在后端加了一个公开端点 `GET /ai`，返回完整的平台上下文纯文本：

- 裁判/Bot 的 stdin/stdout 协议
- 支持的语言
- REST API 快速参考
- MCP 工具列表和 Claude Desktop 配置模板

大约 3KB，结构清晰。粘到任何 AI 的上下文里，它就有了设计游戏所需的全部信息。

---

## MCP 服务器：13 个工具

```bash
LEVERAGE_TOKEN=<jwt> pnpm run mcp
```

| 工具 | 功能 |
|------|------|
| `list_games` | 浏览现有游戏 |
| `test_judge` | 运行裁判+Bot，返回逐回合结果 |
| `test_bot` | 测试 Bot 对战 |
| `get_leaderboard` | 游戏 ELO 排行榜 |
| `list_gamers` | 列出游戏的所有 Bot |
| `get_match_result` | 完整对局数据（含 debug） |
| `submit_judge` | 上传裁判程序 |
| `submit_bot` | 注册新 Bot |
| `submit_renderer` | 上传 HTML 渲染器 |
| `get_judge` | 获取当前裁判代码 |
| `list_matches` | 按 gameId/gamerId/status 查找对局 |
| `get_gamer` | 读取 Bot 源码和元数据 |
| `analyze_match` | 提取对局 `debugHighlights`，高效 AI 调试 |

最后两个专为 AI 调试设计：`list_matches` 找到失败对局，`analyze_match` 只提取有 debug 输出的回合——不用让 AI 扫描 30 轮 JSON 找那一行出错的。

---

## 工作流

AI Agent 连上 MCP 服务器后，可以自主跑完整个游戏设计周期：

1. 读 `/ai` 文档，理解协议
2. `list_games()` 参考现有游戏
3. 写裁判代码
4. 写测试 Bot（够简单能验证裁判逻辑就行）
5. `test_judge()` 运行对局
6. `analyze_match()` 看 `debugHighlights`，只看有问题的回合
7. 修 bug，重测，直到 `verdict=finish` 且分数正确
8. `submit_judge` + `submit_bot` 上线

---

## 端到端：一个 session 生成四个游戏

我们用 Codex 跑了完整流程，生成了四个游戏：

**囚徒困境** — 2人，15轮。标准博弈矩阵（T=5, R=3, P=1, S=0）。Bot：永远合作、永远背叛、针锋相对（Python + JS）。

**廿一点** — 4人，裁判=庄家。管理发牌、补牌/停牌、庄家手牌、结算。Bot：保守（≥15停）、激进（≤17打）、基础策略（Python + JS）。

**骰子游戏（Liar's Dice）** — 4人。骰子管理、出价验证、质疑、生命值追踪。Bot：随机、保守、虚张声势（Python + JS）。

**数字拍卖** — 4人机制设计。每轮揭示数字牌，Bot 匿名出价，最高唯一价格获胜。Bot：按比例、随机、激进（Python + JS）。

每个游戏包含 Python 裁判、3-4 个 Bot（Python + JS）、HTML 渲染器、README。全程只需把 `/ai` URL 粘到 Codex 上下文，其余自动完成。

---

## 踩坑记录

**`display` 字段在顶层，不在 `judgeCmd` 里。** `judgeCmd` 是各玩家的命令字典 `{"0": cmd, "1": null, ...}`；`display` 是该回合的可视化数据，存在 round 对象顶层。Renderer 读 `round.judgeCmd.display` 永远是 undefined。

**null command 不能发给 Bot。** 回合制游戏中，非活跃玩家收到 null 命令。`JSON.stringify(null)` = `"null"`，Bot 执行 `json.loads("null")` = `None`，然后 `None.get(...)` crash。botzone-neo 现在过滤掉 null 命令，只跑有命令的 Bot。

**JavaScript 语言需要注册。** botzone-neo 最初只有 Python/C++/TypeScript。JS Bot 静默 CE 失败。加了 `JavaScriptLanguage`（`node --check` 语法检查 + `node` 运行）后修复。

**`??` 和 `||` 不能混用不加括号。** `a ?? b || null` 在某些 JS 解析上下文是语法错误。改成 `(a ?? b) || null` 或 `a ?? b ?? null`。

---

平台现在到了一个节点：设计新游戏是一个下午的事——写规则，用 AI 生成裁判+Bot+渲染器，MCP 端到端验证，推到平台。后续有意思的问题是运营层面的：生产部署、真实流量，以及更远处的研究用途（强化学习环境、LLM 能力基准、机制设计实验）。

*系列相关文章：*
- [从零重建 OJ 系统](/zh/projects/leverage-oj-full-rewrite)
- [构建生产级代码评测平台：Botzone Neo 技术复盘](/zh/projects/botzone-neo-judge-engine)
- [Leverage OJ 前端重写：Nuxt 4 + Naive UI SPA](/zh/projects/leverage-frontend-refactor)
