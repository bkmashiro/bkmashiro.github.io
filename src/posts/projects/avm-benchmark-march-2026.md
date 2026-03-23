---
title: "AVM Multi-Agent Benchmark: 60x Performance Gain & Memory's Real Value"
description: "Comprehensive benchmark results showing AVM's impact on multi-agent collaboration. Context overflow scenarios see 38% accuracy improvement, recall latency drops from 4.3s to 62ms with model caching."
date: 2026-03-23
readingTime: true
tag:
  - AI
  - Benchmark
  - Multi-Agent
  - Performance
  - LLM
outline: [2, 3]
---

Today we ran comprehensive benchmarks to measure AVM's impact on multi-agent collaboration. The results demonstrate both where persistent memory provides the most value and where we achieved significant performance optimizations.

## TL;DR

**Multi-Agent Accuracy:**
| Scenario | Baseline | AVM | Improvement |
|----------|----------|-----|-------------|
| Context Overflow | 50% | **88%** | **+38%** |
| Knowledge Retrieval | 47% | **67%** | **+20%** |
| Full Collaboration | 100% | 100% | — |

**Performance (after optimizations):**
| Operation | Before | After | Speedup |
|-----------|--------|-------|---------|
| Recall | 4,300ms | **62ms** | **70x** |
| Write | 84ms | **4-8ms** | **10-20x** |
| List | 50ms | **0.6ms** | **83x** |

---

## 1. Multi-Agent Benchmark Design

### Scenarios Tested

We created **48 scenarios** across 5 categories:

1. **Collaborative Coding** (10) — Multi-agent software development
2. **Knowledge Retrieval** (15) — Cross-agent knowledge lookup
3. **Information Sync** (10) — Real-time data propagation
4. **Real-World Cases** (5) — End-to-end workflows (trading, support, DevOps)
5. **Context Overflow** (8) — Beyond-context-limit recall

### Methodology

Each scenario runs twice:
- **Baseline**: Agents only see accumulated conversation context
- **AVM**: Agents can `recall` from AVM and `remember` outputs

We used **Claude Opus** for agent execution, with 4-thread parallel execution for efficiency.

---

## 2. Results: Where AVM Matters Most

### Context Overflow: +38% Accuracy

The highest-value scenario. When agents are "compacted" (lost detailed context), AVM enables recall of specific details.

```
Scenario: Long Conversation Recall
Question: "What email for password resets?"

Baseline: "I don't have information about email addresses..."
AVM: "security@company.com" ✓ (recalled from /decisions/security.md)
```

| Scenario | Baseline | AVM |
|----------|----------|-----|
| Long Conversation | ✗ | ✓ |
| Multi-Session Project | ✓ | ✓ |
| Interruption Recovery | ✓ | ✗ |
| Thread Context | ✗ | ✓ |
| Temporal Reasoning | ✗ | ✓ |
| Contradiction Resolution | ✗ | ✓ |

**Result: 4/8 → 7/8 correct (+38%)**

### Knowledge Retrieval: +20% Assertions

Cross-agent knowledge sharing shows clear improvement:

```
Scenario: Architecture Decision Records
Task: "Should we split the monolith? Team grew from 10 to 25."

Baseline: Generic advice about microservices
AVM: Recalls ADR-007 (original monolith decision), notes team size change,
     provides contextualized recommendation ✓
```

**Result: 24/51 → 34/51 assertions passed (+20%)**

### When AVM Doesn't Help

For scenarios where all context fits in conversation, both approaches succeed equally. AVM adds overhead but provides knowledge persistence for future sessions.

---

## 3. Performance Optimizations

### The Problem: 4.3 Second Recalls

Initial benchmarks showed recall taking **4.3 seconds per operation**. The bottleneck: loading the embedding model on every CLI invocation.

```
$ time avm recall -a test "data analysis"
# 4.2 seconds (!)
```

### Solution 1: Model Caching

We implemented class-level model caching that persists across instances within the same process:

```python
class LocalEmbedding(EmbeddingBackend):
    # Class-level cache (persists across instances)
    _model_cache: Dict[str, Any] = {}
    
    def _load_model(self):
        if self.model_name in LocalEmbedding._model_cache:
            self._model = LocalEmbedding._model_cache[self.model_name]
        else:
            self._model = SentenceTransformer(self.model_name)
            LocalEmbedding._model_cache[self.model_name] = self._model
```

### Solution 2: Query Embedding Cache

Added LRU cache for query embeddings (repeated queries skip embedding computation):

```python
def embed(self, text: str) -> List[float]:
    cache_key = text[:200]
    if cache_key in self._query_cache:
        return self._query_cache[cache_key]
    
    result = self._model.encode(text).tolist()
    self._query_cache[cache_key] = result
    return result
```

### Solution 3: Smart Recall Filter

Added `min_relevance` threshold (default 0.3) to filter low-quality results:

```python
# Filter before returning results
if min_relevance > 0:
    scored = [s for s in scored if s.relevance_score >= min_relevance]

# Early return if no relevant results
if not scored:
    return ""  # Zero tokens wasted
```

### Results: 70x Faster

| Operation | CLI (subprocess) | In-Process | Speedup |
|-----------|-----------------|------------|---------|
| Write | 84ms | 4-8ms | 10-20x |
| Recall (cold) | 4,300ms | 100ms | 43x |
| Recall (warm) | — | 62ms | **70x** |
| List | 50ms | 0.6ms | 83x |
| Stats | 71ms | 1.4ms | 50x |

The `warmup` command pre-loads the model:
```bash
$ avm warmup
✓ Embedding model loaded in 3779ms
  Model: all-MiniLM-L6-v2
  Dimension: 384
```

---

## 4. Recommendations

### When to Use AVM

✅ **High Value**:
- Long conversations (>50 turns)
- Multi-session projects
- Cross-agent knowledge sharing
- Historical incident analysis
- Regulatory/compliance lookups

⚠️ **Moderate Value**:
- Complex multi-step tasks
- Code review with context
- Meeting synthesis

❌ **Low Value** (use baseline):
- Simple one-shot tasks
- Self-contained conversations
- No knowledge reuse needed

### Optimization Tips

1. **Use Python API directly** for high-throughput scenarios (avoids CLI subprocess overhead)
2. **Call `warmup` once** at process start
3. **Set appropriate `min_relevance`** — higher (0.5+) for precision, lower (0.2) for recall
4. **Use batch operations** — `batch_remember()` for bulk writes

---

## 5. Conclusion

AVM's value is context-dependent:
- **+38% accuracy** for context overflow scenarios
- **+20% assertions** for knowledge retrieval
- **Zero improvement** for simple tasks (expected)

The performance optimizations make AVM practical for production use:
- **62ms recall** (down from 4.3s)
- **160 writes/s** batch throughput
- **1,600 list ops/s**

The benchmark validates AVM's core thesis: **persistent memory matters when LLM context limits become constraints**.

---

## Reproduce

```bash
git clone https://github.com/aivmem/avm
cd avm/benchmarks

# Install dependencies
pip install tiktoken sentence-transformers

# Run unit benchmarks (no LLM needed)
python run_unit_benchmark.py

# Run multi-agent benchmarks (requires Claude API)
python run_parallel.py
python run_context_overflow.py
python run_knowledge_retrieval.py
```

Results saved to `results/*.json`.

---

*Benchmark conducted March 23, 2026 on Apple M2 Pro, using Claude Opus for agent execution. 48 scenarios, 150+ agent invocations, 80+ parallel jobs.*
