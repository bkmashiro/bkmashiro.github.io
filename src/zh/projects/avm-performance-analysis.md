---
description: AVM（AI 虚拟记忆）的多智能体基准测试：如何通过模型缓存实现 60 倍性能提升，以及记忆系统对 AI Agent 的真正价值。
title: "AVM 多智能体基准测试：60倍性能提升与记忆系统的真正价值"
readingTime: true
tag:
  - AI
  - 系统设计
  - 性能优化
  - 基准测试
date: 2026-03-23
outline: [2, 3]
---

AVM 的设计目标很明确：感知 token 的检索、多智能体隔离、追加式语义。但没有数据支撑的设计只是假说。这篇文章对 AVM 进行了系统性的性能评估，涵盖延迟分布、可扩展性、缓存行为、多智能体竞争等多个维度——目标是搞清楚它在哪里表现优秀，瓶颈又在哪里。

所有基准测试在 Apple M2 Pro、16GB RAM、macOS 24.6.0、Python 3.13.12、SQLite 3.45.0（WAL 模式）、`all-MiniLM-L6-v2` 嵌入模型下运行。

## 执行摘要

| 指标 | 数值 | 备注 |
|------|------|------|
| 写入吞吐量 | 468 ops/s | WAL + 异步嵌入 |
| 读取吞吐量（热缓存） | 724,000 ops/s | LRU 命中 |
| 读取吞吐量（冷缓存） | 3,300 ops/s | 缓存未命中 → SQLite |
| 搜索吞吐量 | 2,000 ops/s | FTS5 全文检索 |
| 缓存命中率 | 95% | Zipf 访问模式 |
| Token 节省 | 97%+ | 对比加载全部记忆 |

最核心的优化是 **LRU 热缓存**，读取吞吐量提升了 **420 倍**。

---

## 1. 延迟分布

尾延迟对交互式 Agent 系统至关重要。p99 达到 100ms，意味着每 100 次操作就有 1 次感觉卡顿。

### 读取延迟：热缓存 vs 冷缓存

```
       热缓存读取               冷缓存读取
p50:   0.001 ms                 0.032 ms    （慢 32 倍）
p90:   0.001 ms                 0.049 ms
p99:   0.002 ms                 0.103 ms
```

热缓存读取几乎没有开销——本质上只是内存访问。冷缓存需要走 SQLite，但 p99 仍在 0.1ms 以内。

### 写入延迟

写入延迟出奇地稳定：

```
p50:   0.72 ms
p90:   1.01 ms
p99:   1.78 ms
```

这种稳定性来自异步嵌入——向量化在后台线程完成，写入延迟只反映 SQLite WAL 追加的开销。

<figure>
<img src="/images/avm/latency-cdf.png" alt="读写操作延迟 CDF" />
<figcaption>操作延迟的累积分布。热缓存读取集中在接近零的区域；写入分布在 0.8ms 附近，非常集中。</figcaption>
</figure>

---

## 2. 可扩展性分析

随着记忆数量增长，AVM 表现如何？

### 吞吐量 vs 记忆数量

| 记忆数 | 写入 (ops/s) | 读取 (ops/s) | 搜索 (ops/s) |
|--------|-------------|-------------|-------------|
| 10 | 1,317 | 1,247,000 | 3,025 |
| 50 | 1,327 | 1,672,000 | 2,479 |
| 100 | 1,283 | 1,691,000 | 2,209 |
| 500 | 1,180 | 1,420,000 | 1,200 |
| 1000 | 1,050 | 1,350,000 | 850 |

**观察：**
- 写入吞吐量优雅降级（1000 条记忆时下降约 20%）
- 读取吞吐量初期随缓存预热**上升**，随后趋于稳定
- 搜索吞吐量与数据集大小反比（FTS 的预期行为）

<figure>
<img src="/images/avm/scalability.png" alt="吞吐量随记忆数量的变化" />
<figcaption>写入吞吐量保持稳定，搜索吞吐量呈亚线性降级。</figcaption>
</figure>

---

## 3. 缓存分析

缓存是影响最大的单一优化。下面深入分析它的行为。

### 缓存大小敏感性

500 条记忆、Zipf 分布访问（α=1.5）：

| 缓存大小 | 命中率 | 平均延迟 |
|---------|--------|---------|
| 10 | 95.4% | 0.015 ms |
| 50 | 97.7% | 0.008 ms |
| 100 | 97.1% | 0.010 ms |
| 200 | 97.5% | 0.009 ms |

**cache_size=50 之后收益递减。** Zipf 访问模式下，大部分读取集中在少量热点记忆——缓存再大也没用。

### 不同访问模式的命中率

| 访问模式 | 命中率 |
|---------|--------|
| Zipf（幂律）| 94.8% |
| 工作集 | 78.8% |
| 时间局部性 | 67.2% |
| 均匀随机 | 64.0% |

真实 Agent 工作负载服从 Zipf 分布：Agent 会反复引用其当前工作上下文。这正是缓存在实际中表现如此出色的原因。

<figure>
<img src="/images/avm/cache-heatmap.png" alt="缓存命中率热力图" />
<figcaption>当访问服从幂律分布时，即使很小的缓存也能保持高命中率。</figcaption>
</figure>

---

## 🚀 今日更新：60倍性能提升（2026-03-23）

> 这是本文最重要的部分。今天（2026-03-23）我们完成了 AVM 有史以来最大的性能优化，**Recall 速度提升了 43–70 倍，最高接近 60x**。

### 背景：冷启动问题

之前每次 `avm recall` 都要重新加载嵌入模型（`all-MiniLM-L6-v2`），导致：

- **Recall 基线延迟：~4300ms**（是的，4 秒多）
- 对于任何交互式 Agent 场景，这都是不可接受的

根本原因：CLI 进程每次调用都是一个独立进程，嵌入模型没有任何缓存，每次都要从磁盘重新加载权重。

### 解决方案：三层缓存架构（commit 95cf790）

**1. 类级别模型缓存（跨实例持久化）**

```python
class EmbeddingModel:
    _instance_cache: dict[str, 'EmbeddingModel'] = {}  # 类变量
    
    @classmethod
    def get_or_create(cls, model_name: str) -> 'EmbeddingModel':
        if model_name not in cls._instance_cache:
            cls._instance_cache[model_name] = cls(model_name)
        return cls._instance_cache[model_name]
```

同一进程内的所有 AVM 实例共享模型，消除重复加载。

**2. 查询嵌入 LRU 缓存（100 条）**

```python
@lru_cache(maxsize=100)
def embed_query(self, text: str) -> np.ndarray:
    return self.model.encode(text)
```

相同查询文本直接返回缓存的向量，跳过模型推理。

**3. warmup() 方法 + `avm warmup` CLI 命令**

```bash
# 服务启动时预热，消除冷启动延迟
avm warmup
```

### 性能对比：优化前 vs 优化后

| 操作 | 优化前 | 优化后 | **提升倍数** |
|------|--------|--------|-------------|
| Write | 84ms | 4–8ms | **10–20x** |
| **Recall** | **4300ms** | **62–100ms** | **🔥 43–70x** |
| List | 50ms | 0.6ms | **83x** |
| Stats | 71ms | 1.4–2.7ms | **26–50x** |

**Recall 从 4.3 秒降到 62–100ms，提升幅度最高接近 70 倍。** 这才是真正让 AVM 可以在生产 Agent 系统中使用的关键。

### batch_remember：批量写入接口（commit 3ba6bde）

除了读取优化，我们还加了批量写入接口：

```python
# 之前：逐条写入
for memory in memories:
    avm.remember(memory)

# 现在：批量写入
avm.batch_remember(memories, batch_size=50)
```

**配置项：**

```yaml
batch_size: 50  # 默认值，可调整
```

批量写入减少了事务开销，对于初始化时需要写入大量记忆的场景（如从旧对话恢复上下文）特别有用。同时，我们在这个 commit 中建立了基线 benchmark——这就是上面 "优化前" 数据的来源。

### smart recall：相关性过滤（commit 3a0b12d）

```python
# 只返回相关性超过阈值的结果
results = avm.recall(query, min_relevance=0.7)
```

低质量结果不再被返回，减少了 Agent 处理无关信息的认知负担，同时节省了 token。

---

## 4. 多智能体竞争

AVM 支持多个 Agent 写入共享命名空间。高并发下会发生什么？

### 并发写入吞吐量

| Agent 数 | 总计 (ops/s) | 每 Agent | p99 延迟 |
|---------|-------------|---------|---------|
| 1 | 454 | 454 | 4.3 ms |
| 2 | 421 | 211 | 47.7 ms |
| 4 | 362 | 90 | 120.6 ms |
| 8 | 298 | 37 | 245.2 ms |
| 16 | 210 | 13 | 512.8 ms |

**SQLite 的写锁使所有写入串行化。** WAL 模式允许并发读取，但不允许并发写入。每 Agent 吞吐量随 Agent 数线性下降。

### 含义

- 读多写少的工作负载（典型场景）：多智能体扩展性很好
- 写多的工作负载：考虑使用 batch_remember 批量写入
- 订阅系统（限流模式）通过聚合通知来缓解写入压力

<figure>
<img src="/images/avm/contention.png" alt="多智能体竞争曲线" />
<figcaption>总吞吐量对数降级，每 Agent 吞吐量线性降级。</figcaption>
</figure>

---

## 5. Token 效率

AVM 的核心价值就是节省 token。实际效果如何？

### 召回质量 vs Token 预算

| 预算 | 已返回 | 相关结果 | 覆盖率 |
|------|--------|---------|--------|
| 100 | 98 | 3/50 | 6% |
| 500 | 490 | 15/50 | 30% |
| 1000 | 980 | 28/50 | 56% |
| 2000 | 1950 | 42/50 | 84% |
| 4000 | 3900 | 50/50 | 100% |

**~1000 token 可以达到 50%+ 的召回率**，这是大多数 Agent 上下文的最优区间。

### 规模化的 Token 节省

| 场景 | 总可用 | 预算 | 节省 |
|------|--------|------|------|
| 100 条记忆 | 30,000 | 2,000 | 93.3% |
| 500 条记忆 | 150,000 | 4,000 | 97.3% |
| 1000 条记忆 | 300,000 | 4,000 | 98.7% |

规模化后，AVM 能提供 **97%+ 的 Token 节省**，直接转化为 LLM API 成本降低。

---

## 6. 消融研究

哪些优化真正有效？我们逐一测试。

### 配置矩阵

| 配置 | WAL | 缓存 | 异步嵌入 |
|------|-----|------|---------|
| baseline | ❌ | ❌ | ❌ |
| +wal | ✅ | ❌ | ❌ |
| +cache | ❌ | ✅ | ❌ |
| +async | ❌ | ❌ | ✅ |
| all_on | ✅ | ✅ | ✅ |

### 结果

| 配置 | 写入 (ops/s) | 读取 (ops/s) | 读取提升 |
|------|-------------|-------------|--------|
| baseline | 1,293 | 3,339 | — |
| +wal | 1,354 | 3,256 | -2% |
| +cache | 1,281 | 1,318,704 | **+39,390%** |
| +async | 1,300 | 3,135 | -6% |
| all_on | 1,327 | 1,401,896 | **+41,881%** |

**缓存是最主要的因素。** WAL 带来了小幅写入提升（+5%）。异步嵌入不直接影响读写延迟（影响的是嵌入查询质量，不是吞吐量）。

<figure>
<img src="/images/avm/ablation.png" alt="消融研究柱状图" />
<figcaption>LRU 缓存带来 420 倍读性能提升。其他优化的直接影响相对有限。</figcaption>
</figure>

---

## 7. 操作跳数

每个操作需要多少次 I/O？

| 操作 | 跳数 | 分解 |
|------|------|------|
| 读取（热） | 1 | cache_check |
| 读取（冷） | 2 | cache_check → sqlite |
| 写入 | 1 | sqlite（嵌入异步） |
| 搜索 | 2 | fts → batch_read |
| 召回（冷） | 4 | embed → fts → graph → batch |

**召回是瓶颈，需要 4 跳。** ~~未来优化：主题级索引将冷召回降至 1–2 跳。~~ **更新：** TopicIndex 已实现（见第 8.1 节）。

---

## 8. Librarian：多智能体知识路由器

*新增于 2026-03-22*

Librarian 是一个特权服务，能看到所有 Agent 的元数据，但返回内容时尊重隐私。它解决了"Agent 不知道自己不知道什么"的问题。

### 跳数减少

| 方式 | 跳数 | 说明 |
|------|------|------|
| 传统方式 | 20 | 4 跳 × 5 个 Agent（每个分别搜索） |
| Librarian | 1 | 单次查询发现所有相关 Agent |
| **减少** | **95%** | |

### 延迟

| 操作 | p50 | p99 |
|------|-----|-----|
| 传统（5 Agent） | 3.57ms | 11.5ms |
| Librarian 查询 | 1.67ms | 63.1ms |
| 知识归属查询 | 0.45ms | 3.4ms |

### 隐私开销

| 模式 | p50 | 开销 |
|------|-----|------|
| 无隐私（全量） | 1.79ms | — |
| 带隐私（归属者） | 2.82ms | +57.8% |

隐私保护增加约 1ms 开销，但实现了正确的多智能体隔离，值得的。

### 可扩展性

| Agent 数 | p50 |
|---------|-----|
| 2 | 0.41ms |
| 4 | 0.43ms |
| 8 | 0.40ms |
| 16 | 0.51ms |

**Librarian 以 O(1) 复杂度随 Agent 数扩展** ——注册表查询是常数时间。

### 核心发现

1. **95% 跳数减少** ——5 Agent 系统从 20 跳降至 1 跳
2. **亚 2ms 延迟** ——足够快，满足交互式 Agent 需求
3. **O(1) 扩展** ——性能不随 Agent 数增加
4. **隐私代价低** ——约 1ms 开销，换来正确的隔离

### 8.1 TopicIndex：O(1) 召回

*新增于 2026-03-22*

TopicIndex 在写入时预计算主题→路径映射，对已知主题实现 O(1) 召回。

**工作原理：**

```python
# 写入时：提取并索引主题
def index_path(path, content):
    topics = extract_topics(content)  # 标签、专有名词、词频
    for topic in topics:
        topic_to_paths[topic].add(path)
    
# 召回时：优先查询主题索引
def recall(query):
    # 第一步：主题索引（O(1)）
    topic_results = topic_index.query(query)
    if len(topic_results) >= k // 2:
        return topic_results  # 1 跳搞定！
    
    # 第二步：降级到 FTS + 嵌入（4 跳）
    return fts_retrieve(query)
```

**主题提取策略：**
- 标签：`#trading` → `trading`
- 专有名词：`NVDA`、`Bitcoin` → 小写化
- 词频：频率最高的 10 个有意义词
- 标题词：权重更高

**性能：**

| 场景 | 跳数 | 备注 |
|------|------|------|
| 已知主题 | 1 | 直接索引查找 |
| 未知主题 | 4 | 降级到 FTS+嵌入 |
| 混合 | 1–2 | 索引 + 部分 FTS |

**特异性评分：**

路径数越少的主题评分越高（越具体）：

```
score = 1.0 / (len(paths_for_topic) + 1)
```

"NVDA RSI" 比 "市场分析" 评分更高，因为它更具体。

### 8.2 Gossip 协议：去中心化发现

*新增于 2026-03-23*

Librarian 的替代方案：Agent 在没有中央协调器的情况下互相发现。

**架构：**

```
  Agent A              Agent B              Agent C
  ┌──────┐            ┌──────┐            ┌──────┐
  │Digest│◀──gossip──▶│Digest│◀──gossip──▶│Digest│
  │bloom │            │bloom │            │bloom │
  └──────┘            └──────┘            └──────┘
```

**布隆过滤器摘要：**

每个 Agent 维护一个 1024 位的布隆过滤器，编码其主题集合：

```python
# 将 "bitcoin" 插入布隆过滤器
hash1("bitcoin") % 1024 → bit 42  → 置 1
hash2("bitcoin") % 1024 → bit 317 → 置 1
hash3("bitcoin") % 1024 → bit 891 → 置 1

# 查询 "bitcoin"
if bits[42] && bits[317] && bits[891]:
    return "可能知道"  # 可能假阳性
else:
    return "肯定不知道"  # 永不假阴性
```

**属性：**

| 属性 | 值 |
|------|-----|
| 每 Agent 空间 | 128 字节 |
| 假阳性率 | <15% |
| 假阴性率 | 0% |
| 查询时间 | O(1) |

**Gossip vs Librarian：**

| 维度 | Librarian | Gossip |
|------|-----------|--------|
| 架构 | 中心化 | 去中心化 |
| 单点故障 | 有 | 无 |
| 一致性 | 强一致 | 最终一致 |
| 隐私 | 看到元数据 | 只知道主题归属 |
| 复杂度 | 简单 | 有协议开销 |

**选择建议：**
- **Librarian**：需要精确结果，接受单点依赖
- **Gossip**：需要高可用、更强隐私或离线能力
- **两者结合**：Gossip 处理快速本地查询，Librarian 处理跨域查询

---

## 9. 可视化代码

所有图表均使用以下 Python 代码生成：

```python
import seaborn as sns
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

# 论文级别样式
plt.style.use('seaborn-v0_8-whitegrid')
sns.set_palette("husl")
plt.rcParams['figure.dpi'] = 150
plt.rcParams['font.family'] = 'serif'

# 1. 延迟 CDF
def plot_latency_cdf(data):
    fig, ax = plt.subplots(figsize=(8, 5))
    
    for op, latencies in data.items():
        sorted_lat = np.sort(latencies)
        cdf = np.arange(1, len(sorted_lat) + 1) / len(sorted_lat)
        ax.plot(sorted_lat, cdf, label=op, linewidth=2)
    
    ax.set_xlabel('延迟 (ms)')
    ax.set_ylabel('CDF')
    ax.set_title('操作延迟分布')
    ax.legend()
    ax.set_xscale('log')
    plt.tight_layout()
    plt.savefig('latency-cdf.png')

# 2. 可扩展性
def plot_scalability(df):
    fig, axes = plt.subplots(1, 3, figsize=(14, 4))
    
    metrics = ['write_throughput', 'read_throughput', 'search_throughput']
    titles = ['写入吞吐量', '读取吞吐量', '搜索吞吐量']
    
    for ax, metric, title in zip(axes, metrics, titles):
        sns.lineplot(data=df, x='memory_count', y=metric, ax=ax, marker='o')
        ax.set_xlabel('记忆数量')
        ax.set_ylabel('ops/sec')
        ax.set_title(title)
        ax.set_xscale('log')
        ax.set_yscale('log')
    
    plt.tight_layout()
    plt.savefig('scalability.png')

# 3. 缓存热力图
def plot_cache_heatmap(df):
    pivot = df.pivot(index='access_pattern', columns='cache_size', values='hit_rate')
    
    fig, ax = plt.subplots(figsize=(8, 5))
    sns.heatmap(pivot, annot=True, fmt='.1%', cmap='YlGnBu', ax=ax)
    ax.set_title('缓存命中率：访问模式 × 缓存大小')
    plt.tight_layout()
    plt.savefig('cache-heatmap.png')

# 4. 竞争分析
def plot_contention(df):
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    
    ax1 = axes[0]
    ax1.plot(df['n_agents'], df['throughput'], 'b-o', label='总计')
    ax1.plot(df['n_agents'], df['throughput_per_agent'], 'r--o', label='每 Agent')
    ax1.set_xlabel('Agent 数量')
    ax1.set_ylabel('吞吐量 (ops/s)')
    ax1.set_title('竞争下的写入吞吐量')
    ax1.legend()
    
    ax2 = axes[1]
    ax2.plot(df['n_agents'], df['p99_latency_ms'], 'g-o')
    ax2.set_xlabel('Agent 数量')
    ax2.set_ylabel('p99 延迟 (ms)')
    ax2.set_title('竞争下的尾延迟')
    
    plt.tight_layout()
    plt.savefig('contention.png')

# 5. 消融研究
def plot_ablation(df):
    fig, ax = plt.subplots(figsize=(10, 6))
    
    x = np.arange(len(df))
    width = 0.35
    
    ax.bar(x - width/2, df['write_ops'], width, label='写入', color='steelblue')
    ax.bar(x + width/2, df['read_ops'] / 1000, width, label='读取 (÷1000)', color='coral')
    
    ax.set_xlabel('配置')
    ax.set_ylabel('吞吐量 (ops/s)')
    ax.set_title('消融研究：各优化项的独立影响')
    ax.set_xticks(x)
    ax.set_xticklabels(df['config'])
    ax.legend()
    ax.set_yscale('log')
    
    plt.tight_layout()
    plt.savefig('ablation.png')
```

---

## 10. 结论

1. **缓存为王。** LRU 热缓存带来 420 倍读取提升。对于读多写少的 Agent 工作负载，这一项优化远超其他所有项之和。

2. **60x 召回加速是游戏规则改变者。** 从 4.3 秒降到 62–100ms，让 AVM 真正可以用于生产环境的交互式 Agent 系统。

3. **Token 效率极高。** 规模化后节省 97%+ 的 token，直接降低 LLM API 成本。

4. **多智能体写入竞争是瓶颈。** SQLite 写锁使并发写入串行化。写多场景建议用 batch_remember 或考虑其他存储后端。

5. **冷启动影响真实。** 首次查询延迟约高 6 倍（嵌入模型初始化）。生产部署建议使用 `avm warmup` 预热。

6. **TopicIndex 优化了召回路径。** ~~冷召回需要 4 跳，是最贵的操作。~~ TopicIndex 将已知主题的召回降至 1 跳。未知主题仍走 FTS（4 跳）。

7. **Librarian 解决了多智能体发现问题。** 95% 跳数减少，亚 2ms 延迟，O(1) Agent 数扩展。

8. **Gossip 协议支持去中心化发现。** 布隆过滤器摘要实现 O(1) 本地查询，假阳性率 <15%，无单点故障。

---

## 11. 可复现性

所有基准测试代码均在 AVM 仓库中提供：

```bash
git clone https://github.com/bkmashiro/avm
cd avm

# 运行全部基准测试
python benchmarks/bench_paper.py --all --output results/

# 运行消融研究
python benchmarks/bench_ablation.py

# 运行 Agent 效率基准测试
python benchmarks/bench_agent_efficiency.py
```

---

*AVM 开源在 [github.com/bkmashiro/avm](https://github.com/bkmashiro/avm)。基准测试于 2026-03-22 进行，性能优化更新于 2026-03-23。*