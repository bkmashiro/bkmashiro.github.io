---
description: Building an AI-powered paper trading system with multi-agent debate, ATR position sizing, and smart money tracking — from scratch in a weekend.
title: "AI Trading System: Bull vs Bear Before Every Trade"
readingTime: true
tag:
  - Python
  - AI
  - Trading
  - Multi-Agent
  - Quantitative Finance
date: 2026-03-03
outline: [2, 3]
---

# AI Trading System: Bull vs Bear Before Every Trade

> TL;DR: A paper trading system where two AI agents debate every trade before it executes — Bull argues for it, Bear tears it apart, an Arbitrator decides. Built on Alpaca, driven by research from ArXiv quant finance papers.

## Why I Built This

Most retail trading systems are single-threaded: one signal fires, one order goes out. That's fine until it isn't.

I wanted a system that could challenge its own decisions — something closer to how an investment committee works, where you *have* to defend your thesis before deploying capital.

The other motivation was academic: a recent ArXiv paper ([2602.23330](https://arxiv.org/abs/2602.23330)) showed that fine-grained multi-agent LLM systems with adversarial sub-tasks significantly outperform coarse single-agent approaches on trading decisions. That seemed worth testing.

## Architecture

The system has three layers:

```
[ Signal Layer ]     Technical indicators, smart money, news
        ↓
[ Debate Layer ]     Bull ↔ Bear adversarial argument
        ↓
[ Execution Layer ]  Arbitrator verdict → Alpaca order + stop-loss
```

### Signal Layer

Three sub-systems generate signals independently:

**Technical (short-term, every 2h)**
- RSI, MACD, ATR-based trend following on SPY/QQQ/NVDA/AAPL/TSLA
- Only fires when RSI crosses 30/70 or MACD crosses — not on every tick

**Smart Money (pre-market daily)**
- 13F filings: Berkshire, Bridgewater, Renaissance, Citadel, Two Sigma
- Congressional trades via QuiverQuant
- Form 4 insider purchases — filtered to CEO/CFO/President, P-type (open market), $100k+

**News (medium-term, post-close)**
- Sector rotation signals from Alpaca news feed
- Cross-references with active positions

### Debate Layer

Every candidate trade gets put through a three-agent process:

**Bull Agent** — argues *for* the trade. Required to give concrete technical and fundamental reasons, not vague optimism.

**Bear Agent** — reads Bull's argument and attacks it. Finds the weakest assumption. Points out what could go wrong.

**Arbitrator** — synthesizes both sides, checks:
- Risk/reward ratio (minimum 1:2 required)
- Position sizing vs portfolio limits (hard cap at 15% per ticker)
- Data integrity (won't trade on missing/zero price data)
- Returns `GO` / `NO_GO` with confidence score

Here's what an actual NO-GO looked like during testing:

```
⚖️  Verdict: ❌ NO-GO (95% confidence)
Reason: Bear argument decisive — current price shows $0.00,
RSI N/A. Bull's RSI=29 claim is unverifiable. No trade on
broken data.
Risk flags:
  - DATA_INTEGRITY_FAILURE: price $0.00
  - UNVERIFIABLE_THESIS: RSI mismatch with source data
  - MOMENTUM_TRAP_RISK: TSLA is a momentum stock, not mean-reversion
```

The system caught a data pipeline failure and refused to trade. That's exactly the behavior you want.

### Position Sizing

Based on the paper [2603.01298](https://arxiv.org/abs/2603.01298) on adaptive volatility control, position sizes are ATR-driven:

```python
position_pct = (risk_per_trade_pct) / (atr_pct * atr_multiplier)
```

In practice:
- SPY (ATR ~1.3%) → ~77% max position (capped at 15%)
- NVDA (ATR ~3.6%) → ~28% max position
- TSLA (ATR ~3.7%) → ~27% max position

High volatility = smaller position. Simple, but it works.

## Backtest Results

Before deploying, I ran 5-year backtests (2020–2025) on SPY to validate strategy selection:

| Strategy | Annual Return | Sharpe | vs Buy&Hold |
|----------|--------------|--------|-------------|
| ATR Trend Following | **113%** | **0.68** | **+14pp** |
| RSI Mean Reversion | 67% | 0.41 | -32pp |
| MACD Momentum | 71% | 0.44 | -28pp |
| Buy & Hold SPY | 99% | 0.61 | baseline |

Only ATR trend-following beat passive SPY over 5 years. RSI and MACD — the two most popular retail indicators — both underperformed doing nothing.

The recommended allocation based on this:
- 40% core Buy & Hold (SPY/QQQ)
- 40% ATR trend strategy
- 20% cash (opportunistic + smart money plays)

## Stack

- **Trading API**: [Alpaca](https://alpaca.markets) (paper trading, $100k virtual)
- **Data**: yfinance for historical, Alpaca data API for live bars
- **Analysis**: pandas, numpy, ta (technical analysis library)
- **Backtesting**: vectorbt, backtrader
- **LLM debate**: Claude CLI (falls back to rules engine if unavailable)
- **Infra**: OpenClaw cron jobs, Discord channel notifications
- **Language**: Python 3.11 (mamba conda env)

## Lessons Learned

**Data integrity first.** The system refused its first simulated trade because price data returned $0. That's a feature, not a bug. Never let a bad data pipeline move real money.

**RSI is overrated for momentum stocks.** TSLA at RSI 29 doesn't mean it's about to bounce — it might just be starting a real downtrend. The backtest confirmed this: RSI mean reversion consistently underperformed.

**The debate adds latency but catches things.** Running two LLM calls before every trade adds ~10 seconds. In exchange, you get a written record of *why* each decision was made. For a paper trading experiment, that's valuable.

**13F and congressional filings are the cleanest signals.** Form 4 is noisy (too many option exercises and RSU grants). Congressional trades are weird but real — members of Congress have historically outperformed the market significantly. Make of that what you will.

## What's Next

- [ ] Fix data pipeline so ATR analysis actually works in live mode
- [ ] One month of paper trading before touching real capital
- [ ] Evaluate VSN+LSTM model ([arXiv 2603.01820](https://arxiv.org/abs/2603.01820)) as a signal layer replacement — current SOTA for financial time series
- [ ] Real options flow data (Unusual Whales) once paper results look promising

Source code is private for now — might open-source the non-trading-logic pieces later.
