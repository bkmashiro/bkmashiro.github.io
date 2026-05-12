---
title: "移植 WASI Wheels：wasi-sdk-33 + CPython 3.14 踩坑全记录"
date: 2026-05-12
readingTime: true
outline: [2, 3]
tag:
  - WebAssembly
  - WASI
  - Python
  - Rust
  - CI/CD
description: "把 dicej/wasi-wheels 从 wasi-sdk-24 + CPython 3.12 迁移到 wasi-sdk-33 + CPython 3.14 的过程中遭遇的所有问题、根本原因与解决方案。"
---

# 移植 WASI Wheels：wasi-sdk-33 + CPython 3.14 踩坑全记录

[dicej/wasi-wheels](https://github.com/dicej/wasi-wheels) 是一个把 numpy、pydantic_core、regex 等带有 C/Rust 原生扩展的 Python 包交叉编译为 `wasm32-wasip1` 目标的项目，可配合 [componentize-py](https://github.com/bytecodealliance/componentize-py) 在 WASI 运行时中使用。

原仓库基于 wasi-sdk-24 + CPython 3.12，已经很久没有更新。我 fork 了一份，把工具链升级到 **wasi-sdk-33（LLVM 20）+ CPython 3.14.0**，并全程通过 GitHub Actions CI 验证。整个过程踩了将近 20 个不同的坑，这篇文章把所有问题的起因和解法完整记录下来。

> 最终产物：[bkmashiro/wasi-wheels](https://github.com/bkmashiro/wasi-wheels)，三个包（numpy / pydantic_core / regex）均能在 CI 中成功构建并发布到 GitHub Releases。

---

## 背景：为什么要升级

- wasi-sdk-24 的 wasm-ld 版本已经很旧，部分链接标志在新版中行为不同
- CPython 3.14 对 WASI 的支持更完善，也是 componentize-py 下一步要对齐的版本
- pydantic v2 持续演进，原仓库锁定的 pydantic-core 2.14.5 基于 pyo3 0.20，不支持 Python 3.14

---

## 问题一：`build-details.json` 格式不兼容

### 现象

maturin（≥1.7）在构建 pydantic_core 时报错：

```
missing field `extension_suffix` at line 32 column 3
```

### 根本原因

CPython 3.14 WASI 交叉编译会在 sysconfig 目录下生成一个 `build-details.json`，但格式是**扁平**的 sysconfig 变量 JSON：

```json
{
  "extension_suffix": ".cpython-314-wasm32-wasi.so",
  "version": "3.14",
  ...
}
```

而 maturin ≥1.7 期望的是**嵌套结构**：

```json
{
  "language": { "version": "3.14" },
  "implementation": { "name": "CPython" },
  "abi": {
    "flags": [],
    "extension_suffix": ".cpython-314-wasm32-wasi.so"
  }
}
```

`extension_suffix` 必须在 `abi` 子对象内，而不是顶层字段。仅仅在原有文件里追加字段无效——整个文件必须替换。

### 解决方案

在 Makefile 的 CPython 构建步骤末尾，以及 `pydantic-core/build.sh` 中，都强制覆写这个文件：

**Makefile（CPython 目标末尾）：**

```makefile
python3 -c "\
import json; \
p = '$(SYSCONFIG)/build-details.json'; \
d = {'language': {'version': '3.14'}, 'implementation': {'name': 'CPython'}, \
     'abi': {'flags': [], 'extension_suffix': '.cpython-314-wasm32-wasi.so'}}; \
json.dump(d, open(p, 'w'), indent=2); \
print('Wrote maturin-format build-details.json:', p)"
```

**pydantic-core/build.sh（每次构建前）：**

```bash
python3 - <<'PYEOF'
import json, os, sys

pyo3_dir = os.environ.get('PYO3_CROSS_LIB_DIR', '')
p = pyo3_dir + '/build-details.json'

maturin_build_details = {
    "language": {"version": "3.14"},
    "implementation": {"name": "CPython"},
    "abi": {
        "flags": [],
        "extension_suffix": ".cpython-314-wasm32-wasi.so"
    }
}

with open(p, 'w') as f:
    json.dump(maturin_build_details, f, indent=2)
PYEOF
```

build.sh 里额外做一次的原因：CI 有 CPython 缓存，缓存命中时 Makefile 里的那次写入不会执行，而 pydantic 构建肯定会跑 build.sh。

---

## 问题二：pyo3 版本不支持 Python 3.14

### 现象

maturin 触发 cargo 编译，构建失败，cargo 退出码 101：

```
Caused by: Cargo build finished with 'exit status: 101'
```

cargo 的详细错误是 pyo3 的 `build.rs` 做了 Python 版本范围检查，Python 3.14 超出了支持范围。

### 根本原因

原仓库的 `pydantic-core/src` 子模块指向 **v2.14.5**（pyo3 0.20.0），而 pyo3 0.20 只声明支持 Python 3.7–3.12。Python 3.14 在 `build.rs` 的版本范围检查中直接失败。

### 解决方案

更新子模块到 **pydantic-core v2.41.5**，它依赖 pyo3 0.26，支持 Python 3.14：

```bash
cd pydantic-core/src
git fetch origin
git checkout v2.41.5   # 对应 commit 52b821df...
cd ../..
git add pydantic-core/src
git commit -m "chore: update pydantic-core submodule to v2.41.5 (pyo3 0.26, Python 3.14 support)"
```

---

## 问题三：wasm-ld 链接标志

### 3.1 `--unresolved-symbols=import-dynamic`：关键标志

#### 现象

同样是 cargo 退出码 101，wasm-ld 报大量未定义符号：

```
wasm-ld: error: undefined symbol: PyModule_Create2
wasm-ld: error: undefined symbol: PyArg_ParseTuple
...（几百个 Python C API 符号）
```

#### 根本原因

Python 扩展模块是动态加载的 `.so`，在链接时 Python C API 符号（`PyModule_Create2` 等）是未定义的，需要在运行时由 Python 解释器提供。普通的 wasm-ld 遇到未定义符号默认报错退出。

`--unresolved-symbols=import-dynamic` 告诉 wasm-ld 把所有未定义符号转换为 **wasm dynamic import**，由运行时（Python 解释器）在加载时解析。没有这个标志，任何 Python 扩展模块都无法链接。

#### 解决方案

在 `pydantic-core/build.sh` 的 RUSTFLAGS 中加入：

```bash
RUSTFLAGS="${RUSTFLAGS} -C link-args=--unresolved-symbols=import-dynamic"
```

### 3.2 `--experimental-pic`：在 LLVM 20 中仍然必需

#### 误判过程

升级到 wasi-sdk-33 时，看到 LLVM 版本已经是 20，以为 PIC 支持已经正式化，删掉了 `--experimental-pic`。结果构建失败。

#### 实际情况

在 wasm-ld 20（LLVM 20.1.0）中，`--experimental-pic` 这个标志**依然存在且必须传递**，即使功能本身已经稳定。flag 的名字还没改。

```bash
RUSTFLAGS="${RUSTFLAGS} -C link-args=--experimental-pic"
```

### 3.3 `linker-plugin-lto`：必须删掉

原仓库用了 `-C linker-plugin-lto`。这个选项要求 Rust 工具链和 wasm-ld 使用完全相同的 LLVM 版本，否则 LTO bitcode 格式不兼容：

```
error: failed to load bitcode of module ... : Invalid bitcode signature
```

Rust stable 工具链自带的 LLVM 版本往往和系统安装的 wasm-ld 不一致，尤其在 wasi-sdk 使用 LLVM 20 而 Rust stable 可能还是 LLVM 19 时。删掉这个标志即可：

```bash
# 删掉这行：
# RUSTFLAGS="${RUSTFLAGS} -C linker-plugin-lto"
```

### 最终 RUSTFLAGS

```bash
RUSTFLAGS="${RUSTFLAGS:-} -C link-args=-L${WASI_SDK_PATH}/share/wasi-sysroot/lib/wasm32-wasip1/"
RUSTFLAGS="${RUSTFLAGS} -C linker=${WASI_SDK_PATH}/bin/wasm-ld"
RUSTFLAGS="${RUSTFLAGS} -C link-self-contained=no"
RUSTFLAGS="${RUSTFLAGS} -C link-args=--experimental-pic"
RUSTFLAGS="${RUSTFLAGS} -C link-args=--shared"
RUSTFLAGS="${RUSTFLAGS} -C link-args=--unresolved-symbols=import-dynamic"
RUSTFLAGS="${RUSTFLAGS} -C relocation-model=pic"
export RUSTFLAGS="$RUSTFLAGS"
```

---

## 问题四：Makefile 绝对路径 target

### 现象

CI 运行 `make build/wasi-sdk` 时：

```
make: *** No rule to make target 'build/wasi-sdk'. Stop.
```

### 根本原因

Makefile 里用了 `$(abspath build)`，所以 target 名字变成了 `/home/runner/work/wasi-wheels/wasi-wheels/build/wasi-sdk`（绝对路径）。在命令行传入相对路径 `build/wasi-sdk` 时 make 找不到对应的规则。

### 解决方案

添加 `.PHONY` 别名：

```makefile
.PHONY: all prerequisites numpy pydantic regex

prerequisites: $(WASI_SDK) $(CPYTHON)
numpy: $(BUILD_DIR)/numpy-wasi.tar.gz
pydantic: $(BUILD_DIR)/pydantic_core-wasi.tar.gz
regex: $(BUILD_DIR)/regex-wasi.tar.gz
```

CI 步骤改用别名：

```yaml
- name: Build prerequisites (wasi-sdk + CPython)
  run: make prerequisites
- name: Build numpy
  run: make numpy
- name: Build pydantic_core
  run: make pydantic
- name: Build regex
  run: make regex
```

---

## 问题五：CPython 缓存命中时重新构建

### 现象

CI 显示 cache hit，但 CPython 还是重新编译了（需要 20+ 分钟）。

### 根本原因

`$(CPYTHON)` target 依赖 `$(CPYTHON_SRC)` 和 `$(CPYTHON_HOST)/bin/python3`。CI 缓存命中时，`build/cpython-wasi/install` 已经存在，但 `cpython-src/` 是刚下载的（时间戳比缓存新），导致 make 认为 CPython 需要重建。

### 解决方案

把普通依赖改为 **order-only 依赖**（`|`）：

```makefile
# 之前：
$(CPYTHON): $(WASI_SDK) $(CPYTHON_SRC) $(CPYTHON_HOST)/bin/python3

# 之后：
$(CPYTHON): | $(WASI_SDK) $(CPYTHON_SRC) $(CPYTHON_HOST)/bin/python3
```

Order-only 依赖只保证构建顺序，不参与时间戳比较。缓存命中时 `$(CPYTHON)` 目录已存在，make 直接跳过。

---

## 问题六：Release 步骤权限错误

### 现象

```
Could not create new tag 'refs/tags/latest'
Error: Resource not accessible by integration
```

### 根本原因

两个问题叠加：

1. Job 没有声明 `permissions: contents: write`，GitHub Actions 默认只给读权限
2. 原本用的 `marvinpinto/action-automatic-releases` 这个 action 已经停止维护，在新版 GitHub Actions 环境下认证失败

### 解决方案

添加权限声明，并把 action 替换为 `gh` CLI（GitHub CLI 在 GitHub Actions 中开箱可用）：

```yaml
update_canary_release:
  needs: release
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  permissions:
    contents: write   # ← 必须声明
  steps:
    - uses: actions/download-artifact@v4
      with:
        name: wasi-wheels

    - name: Publish latest (canary) release
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        gh release delete latest --repo ${{ github.repository }} --yes 2>/dev/null || true
        git tag -d latest 2>/dev/null || true
        gh release create latest *.tar.gz \
          --repo ${{ github.repository }} \
          --title "Development Build" \
          --notes "Latest WASI wheels built from \`main\`" \
          --prerelease
```

---

## 总结

| 问题 | 根本原因 | 解决方案 |
|------|---------|---------|
| `missing field extension_suffix` | maturin ≥1.7 期望嵌套 JSON，CPython 生成扁平 JSON | 强制覆写 `build-details.json` 为嵌套格式 |
| cargo exit 101（版本检查） | pyo3 0.20 不支持 Python 3.14 | 升级 pydantic-core 到 v2.41.5（pyo3 0.26） |
| cargo exit 101（未定义符号） | Python C API 符号在链接时未定义 | 加 `--unresolved-symbols=import-dynamic` |
| `--experimental-pic` 问题 | 误以为 LLVM 20 不再需要此标志 | 恢复该标志（LLVM 20 仍需要） |
| LTO bitcode 格式错误 | Rust 与 wasm-ld 的 LLVM 版本不一致 | 删掉 `linker-plugin-lto` |
| `No rule to make target` | `$(abspath)` 生成绝对路径 target | 添加 `.PHONY` 别名 |
| CPython 缓存命中仍重建 | 源码目录时间戳比缓存新 | 改为 order-only 依赖（`\|`） |
| Release 权限错误 | Job 缺少 `contents: write`，action 已弃用 | 添加权限 + 改用 `gh` CLI |

整个过程大约经历了 23 次 CI 运行，最终三个包全部成功构建并发布。最费时间的两个问题是 `build-details.json` 的格式差异（表面现象相同，多次修改才找到真正原因）和 pyo3 版本不兼容（需要理解 pyo3 的版本支持矩阵）。

代码在 [bkmashiro/wasi-wheels](https://github.com/bkmashiro/wasi-wheels)，Releases 页有预编译的 `.tar.gz`，可以直接拿来用。
