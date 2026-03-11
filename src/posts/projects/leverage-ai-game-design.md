---
title: "AI-Driven Game Design: From Protocol Spec to Leaderboard in One Shot"
description: "How we built an MCP server on top of Leverage OJ so that AI agents can autonomously design, test, and deploy bot competition games — and used it to generate four complete games end-to-end."
date: 2026-03-11
readingTime: true
tag:
  - AI
  - MCP
  - Game Design
  - NestJS
  - Systems
outline: [2, 3]
---

The Leverage OJ rewrite ended with a working platform: backend, frontend, judge engine, ELO system, real-time human-vs-bot matches. The natural next question was whether an AI agent could use it autonomously — not just run code against an API, but design an entire game from scratch.

The answer turned out to be yes, with one key ingredient: a machine-readable protocol document and an MCP server.

---

## The Problem with AI + Structured APIs

LLMs can call REST APIs. The hard part is that a typical API has dozens of endpoints with subtle interdependencies, validation rules that only appear at runtime, and domain-specific protocols (like a judge's stdin/stdout contract) that aren't obvious from an OpenAPI schema.

You can prompt your way around this, but it doesn't scale. What works better is giving the AI a single plaintext document — dense, structured, written for machines — and letting it navigate from there.

We added `GET /ai` to the backend: a public, no-auth endpoint that returns the full platform context as plain text.

```
# Leverage OJ — AI Context

Leverage is a competitive programming platform where you write judges (game rules) 
and bots (AI players). Share this document with any AI agent to let it design 
and submit games autonomously.

## Judge Protocol
...
## Bot Protocol  
...
## REST API Quickref
...
## MCP Tools
...
```

The document is ~3KB. It includes the judge/bot stdin/stdout protocol, available languages, API endpoints with auth requirements, and a Claude Desktop config template for the MCP server. Paste it into any AI client's context and it has everything it needs.

---

## The MCP Server

The platform ships with a 13-tool MCP (Model Context Protocol) server:

```bash
LEVERAGE_TOKEN=<jwt> pnpm run mcp
```

| Tool | What it does |
|------|-------------|
| `list_games` | Browse existing games |
| `test_judge` | Run judge + bots, get full round-by-round results |
| `test_bot` | Test a bot against existing opponents |
| `get_leaderboard` | ELO rankings for a game |
| `list_gamers` | List bots registered for a game |
| `get_match_result` | Full match result with rounds, scores, debug |
| `submit_judge` | Upload a judge program to a game |
| `submit_bot` | Register a new bot on the leaderboard |
| `submit_renderer` | Upload an HTML renderer |
| `get_judge` | Fetch current judge source |
| `list_matches` | Find matches by gameId/gamerId/status |
| `get_gamer` | Read a bot's source and metadata |
| `analyze_match` | Pre-process match into `debugHighlights` for efficient debugging |

The last two were added specifically for AI debugging: `list_matches` lets the agent find a failed match, and `analyze_match` extracts non-empty debug entries across rounds — instead of the agent having to scan a 30-round JSON blob for the one line that went wrong.

---

## The Workflow

An AI agent connected to this MCP server can run the full game design cycle autonomously:

1. **Read the spec** — `GET /ai` gives the complete protocol
2. **Browse context** — `list_games()` to see existing games for reference
3. **Write a judge** — using the protocol from step 1
4. **Write test bots** — simple enough to verify judge logic, not smart enough to win
5. **Test** — `test_judge(gameId, judgerCode, bot0Code, bot1Code)`
6. **Debug** — `analyze_match(matchId)` returns `debugHighlights`: only the rounds where something interesting happened
7. **Iterate** — fix the judge, re-test, repeat until `verdict=finish` and scores look right
8. **Ship** — `submit_judge`, then `submit_bot` for each bot

The key insight in step 6: a 30-round game might have only 3 rounds with debug output. `analyze_match` filters to those, letting the agent skip 90% of the JSON without summarizing it.

---

## End-to-End: Four Games in One Session

We used this pipeline with Codex to generate four complete games:

**囚徒困境 (Prisoner's Dilemma)** — 2-player, 15 rounds. Judge tracks cooperation/defection history, implements the standard payoff matrix (T=5, R=3, P=1, S=0). Bots: AlwaysCooperate, AlwaysDefect, TitForTat (Python + JS).

**廿一点 (Blackjack)** — 4-player, dealer-as-judge. Judge deals cards, manages hit/stand, computes dealer hand, pays out. Bots: Conservative (stand ≥ 15), Aggressive (hit ≤ 17), BasicStrategy, Stand17+ (JS).

**骰子游戏 (Liar's Dice)** — 4-player. Judge manages dice rolls, bid validation, liar calls, life tracking. Bots: RandomBot, Conservative, Bluffer (Python + JS).

**数字拍卖 (Number Auction)** — 4-player mechanism design game. Judge reveals number cards each round, bots bid anonymously, highest unique bid wins. Bots: Proportional, Random, Aggressive (Python + JS).

Each game includes:
- A Python judge (~150-300 lines)
- 3-4 bots in Python + 1 in JavaScript
- An HTML renderer with game-specific visualization
- A README with rules and strategy notes

The entire pipeline — prompt, generate, test, debug, inject to DB — ran end-to-end. The only human intervention was copy-pasting the `/ai` endpoint URL into the context.

---

## Implementation Notes

### Judge Protocol in Practice

The judge receives bot responses and emits commands each round:

```python
# Round 1: judge sends initial game state to all bots
round_data = json.loads(sys.stdin.readline())
# round_data = {"round": 1, "responses": {}}

# For turn-based games, inactive players get null commands
commands = {str(i): None for i in range(player_count)}
commands[str(active_player)] = build_command(state, active_player)

print(json.dumps({
    "commands": commands,
    "display": build_display(state),
    "verdict": "continue"
}))
```

Crucially, `commands` values can be `null` for inactive players. botzone-neo filters out null entries and doesn't invoke those bots that round — essential for turn-based games like Blackjack where only the current player acts.

### The JavaScript Language Gap

During testing, we discovered that `javascript` wasn't a registered language in botzone-neo's compile service. Python bots would succeed; JS bots would silently fail with a Compile Error. The fix was a `JavaScriptLanguage` class that uses `node --check` for syntax validation and `node` for execution — straightforward once the gap was found, but subtle enough that it only shows up when you have mixed-language test suites.

### Renderer Protocol

Each game's visual replay is an HTML file loaded in a sandboxed iframe. Communication happens via `postMessage`:

```javascript
// Host → iframe (on round navigation)
iframe.contentWindow.postMessage({
  type: 'gameLog',
  gameLog: { rounds: [...], finalResult: {...} },
  round: currentRoundIndex  // 0-indexed
}, '*')

// Renderer reads round.display (top-level field) for that round's visual state
window.addEventListener('message', (event) => {
  if (event.data.type !== 'gameLog') return
  const display = event.data.gameLog.rounds[event.data.round]?.display
  render(display)
})
```

The `display` field is at the top level of each round object, not inside `judgeCmd`. A subtle point that bit our initial renderers — they were reading `round.judgeCmd.display` (which is the per-bot commands dict, not the display data).

---

## Multi-Player Support

The judge protocol is N-player by design — `commands` and `responses` are dicts keyed by player index. The main work for multi-player is in the auto-match scheduler:

```typescript
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 1) return arr.map(x => [x])
  return arr.flatMap((x, i) =>
    combinations(arr.slice(i + 1), k - 1).map(rest => [x, ...rest])
  )
}

// Sample k bots from top-N by ELO, generate C(n,k) match combinations
// Cap at 20 matches per tick to avoid queue bursts
```

ELO for N-player games uses pairwise comparison — rank players by final score, apply standard ELO adjustments for each pair. This is an approximation (not game-theory optimal) but works well in practice for the 4-player games we tested.

---

## What Surprised Us

**The protocol document matters more than the API.** REST endpoints are discoverable; the judge/bot stdin/stdout contract is not. Every AI hallucination we saw was about the judge protocol, not the API. The `/ai` document fixed this.

**`analyze_match` pays for itself immediately.** Without it, debugging a failed 30-round game meant reading 30 JSON objects. With it, the agent gets 3 highlighted rounds with non-empty debug output. The time-to-fix dropped noticeably.

**Mixed-language test suites catch silent failures.** A pure-Python test of the judge passes. A mixed Python + JS test reveals compile-time gaps in the sandbox. Always test with every language variant.

**Renderers are fragile at the JS edge.** The `??` (nullish coalescing) operator cannot be mixed with `||` without parentheses in some JS parser contexts. A renderer using `a ?? b || null` fails silently; `(a ?? b) || null` works.

---

The platform is now at a point where designing a new game is genuinely an afternoon project: write the rules, generate the judge + bots + renderer with an AI agent, test end-to-end via MCP, push to the platform. The infrastructure handles the rest — sandboxed execution, ELO tracking, match replay, auto-match scheduling, multi-player combinatorics.

The interesting problems from here are operational: production deployment, real traffic, and eventually the research uses (RL environments, LLM benchmarks, mechanism design experiments).

*Related posts in this series:*
- [Rebuilding an Online Judge from Scratch](/posts/projects/leverage-oj-full-rewrite)
- [Building a Production Code Judge: botzone-neo Technical Deep Dive](/posts/projects/botzone-neo-judge-engine)
- [Leverage OJ Frontend Rewrite: Nuxt 4 + Naive UI SPA](/posts/projects/leverage-frontend-refactor)
