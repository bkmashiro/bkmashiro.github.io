---
title: "The Trading Bot That Saw the Same Market Twice"
description: "A 4-hour cron job silently reporting identical crypto prices — turns out one wrong comparison operator in a cache freshness check was the culprit."
date: 2026-03-05
readingTime: true
tag:
  - Python
  - Debugging
  - Trading
  - System Design
outline: [2, 3]
---

Every 4 hours, my crypto trading bot wakes up, analyzes BTC and ETH, and posts a report to Discord. One day I noticed something off: two consecutive reports, 4 hours apart, showed the **exact same prices**.

```
2026-03-04T20:02  BTC=$73,644.29  ETH=$2,176.69
2026-03-05T00:02  BTC=$73,644.29  ETH=$2,176.69
```

In 4 hours, BTC didn't move a single cent. Not a rounding difference. Not a near-miss. _Exactly_ the same number. That's not a market condition — that's a bug.

## Following the Data Trail

The bot fetches OHLCV candles from Binance with a local SQLite cache to avoid hammering the API. The cache logic looked reasonable at first glance:

```python
now = datetime.now(timezone.utc)
tf_ms = TF_MINUTES[timeframe] * 60 * 1000  # e.g. 240 * 60 * 1000 for 4h

# Start of the current (still-forming) 4h candle
current_candle_start = int(now.timestamp() * 1000) // tf_ms * tf_ms

cache_min, cache_max = self._get_cached_range(symbol, timeframe)

# Cache is "fresh" if it has the previous complete candle
cache_is_fresh = cache_max >= current_candle_start - tf_ms

if cache_is_fresh:
    return self._load_from_cache(...)
```

The comment says _"Cache is fresh if it has the previous complete candle."_ Sounds fine. But there's a subtle trap.

## The Off-by-One (in Time)

Let's trace through what actually happens when the cron fires at 16:03 UTC:

- `current_candle_start` = 16:00:00 (the candle currently forming)
- `current_candle_start - tf_ms` = 12:00:00 (the previous complete candle)
- The previous run at 12:03 fetched data from Binance and cached everything up to the 12:00 candle
- So `cache_max` = 12:00:00
- Check: `12:00 >= 12:00` → ✅ **cache is "fresh"**

The bot loads from cache and returns the data from _the last run_, not from Binance. Same prices. Every. Single. Time.

The threshold was one period too lenient. The logic was asking "do we have the previous candle?" when it should have asked "do we have the **current** candle?" — which, being still in progress, will _never_ be in cache.

## The Fix

One character change in the comparison:

```python
# Before: fresh if we have previous complete candle
cache_is_fresh = cache_max >= current_candle_start - tf_ms

# After: fresh only if we have data from the current period
cache_is_fresh = cache_max >= current_candle_start
```

Since the current 4h candle is still forming, `cache_max` will always be behind `current_candle_start`. The condition is always `False` → always fetch from Binance → always fresh data.

The second fix: the price displayed in reports was `indicators['close']` (last cached candle's close price). Replaced with `fetcher.get_latest_price()` which calls the ticker endpoint directly:

```python
# Before
prices[symbol] = indicators['close']

# After: real-time ticker, not last candle close
live_price = fetcher.get_latest_price(symbol)
prices[symbol] = live_price
```

## Why It's Easy to Miss

The original threshold makes intuitive sense for _historical data_ use cases: "I want 200 candles for indicator calculation — as long as I have the last complete candle, the historical series is valid enough." That reasoning is correct for backtesting.

It breaks for _live trading_ because:

1. The cron interval exactly matches the candle interval (4h cron → 4h candles)
2. Each run the threshold advances by exactly one period
3. The cache always satisfies the condition because it was just filled by the previous run

A period mismatch (e.g., 1h cron fetching 4h candles) would have masked the bug — you'd get 3 stale runs out of 4, not 4 out of 4.

## The Lesson

**Cache freshness thresholds that match your update interval are invisible bugs.** The condition `cache_max >= current_candle_start - tf_ms` looks like it adds a safety margin (one full period of tolerance), but when your job runs exactly at period boundaries, it becomes a guarantee of stale data.

When the cache period and the job period are the same, "fresh enough for history" ≠ "fresh enough for live prices." The fix is to make the price source (ticker API) independent of the OHLCV cache entirely.
