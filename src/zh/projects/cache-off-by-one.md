---
title: "看了两遍相同行情的交易机器人"
description: "4小时定时任务连续上报相同的加密货币价格——罪魁祸首是缓存新鲜度判断里一个比较符号写偏了一个周期。"
date: 2026-03-05
readingTime: true
tag:
  - Python
  - 调试
  - 交易
  - 系统设计
outline: [2, 3]
---

我的加密货币交易机器人每 4 小时运行一次：分析 BTC 和 ETH，把报告发到 Discord。某天我注意到一个异常：连续两次报告，相隔整整 4 小时，价格**完全相同**。

```
2026-03-04T20:02  BTC=$73,644.29  ETH=$2,176.69
2026-03-05T00:02  BTC=$73,644.29  ETH=$2,176.69
```

4 小时内 BTC 连一分钱都没动。不是四舍五入误差，不是近似值——是完全一样的数字。这不是市场行情，是 bug。

## 顺藤摸瓜

机器人从 Binance 拉取 OHLCV K 线数据，并在本地用 SQLite 缓存以避免频繁调用 API。缓存逻辑乍看很合理：

```python
now = datetime.now(timezone.utc)
tf_ms = TF_MINUTES[timeframe] * 60 * 1000  # 4h = 240 * 60 * 1000

# 当前正在形成的 4h K 线的起始时间
current_candle_start = int(now.timestamp() * 1000) // tf_ms * tf_ms

cache_min, cache_max = self._get_cached_range(symbol, timeframe)

# 如果缓存里有上一根完整K线，认为是新鲜的
cache_is_fresh = cache_max >= current_candle_start - tf_ms

if cache_is_fresh:
    return self._load_from_cache(...)
```

注释写着"有上一根完整K线就算新鲜"。听起来没问题。但这里埋了个坑。

## 时间上的差一格

跟着代码走一遍，假设 cron 在 16:03 UTC 触发：

- `current_candle_start` = 16:00:00（当前正在形成的K线）
- `current_candle_start - tf_ms` = 12:00:00（上一根完整K线）
- 上次 12:03 的运行从 Binance 拉取了数据，把 12:00 那根K线存进了缓存
- 所以 `cache_max` = 12:00:00
- 判断：`12:00 >= 12:00` → ✅ **缓存"新鲜"**

于是机器人直接读缓存，返回的是上一次运行的数据，而不是从 Binance 拉取新数据。价格永远相同。

阈值宽松了整整一个周期。逻辑在问"我们有没有上一根K线？"，而正确的问法是"我们有没有**当前这根**K线？"——而当前K线还在形成中，永远不可能在缓存里。

## 修复

比较符号改一下，去掉那个 `- tf_ms`：

```python
# 改前：有上一根完整K线就算新鲜
cache_is_fresh = cache_max >= current_candle_start - tf_ms

# 改后：必须有当前周期的K线才算新鲜
cache_is_fresh = cache_max >= current_candle_start
```

当前 4h K 线还没收盘，`cache_max` 永远追不上 `current_candle_start`，条件永远为 `False`——永远从 Binance 拉新数据。

第二处修复：报告里显示的价格来自 `indicators['close']`（缓存K线的收盘价）。换成 `get_latest_price()` 直接调 ticker 接口：

```python
# 改前
prices[symbol] = indicators['close']

# 改后：实时 ticker，不走K线缓存
live_price = fetcher.get_latest_price(symbol)
prices[symbol] = live_price
```

## 为什么容易忽略

原来的阈值对**历史数据**场景是合理的："我要算技术指标，需要200根K线的历史——只要我有最近一根完整K线，这段历史序列就足够用了。"这个逻辑用在回测上是对的。

但在实时交易中它失效了，因为：

1. cron 周期和 K 线周期完全相同（4h cron 拉 4h K 线）
2. 每次运行，阈值恰好推进一格
3. 缓存永远满足条件——因为上一次运行刚好填满了它

如果周期不对齐（比如 1h cron 拉 4h K 线），这个 bug 会被掩盖——4次中有3次用缓存，而不是4次全用。

## 教训

**当缓存更新频率和 job 运行频率相同时，"宽松一个周期"的新鲜度阈值会成为一个无形的 bug**。`cache_max >= current_candle_start - tf_ms` 看起来像是留了一格容错余量，但当 job 恰好在周期边界运行时，它反而保证了每次都返回旧数据。

缓存周期和 job 周期一致时，"历史数据够用" ≠ "实时价格够新"。根本解法是把价格来源（ticker API）从 OHLCV 缓存中彻底解耦。
