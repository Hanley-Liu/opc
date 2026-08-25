# Juejin post draft (Chinese + English bilingual)

## Title
OPC：一个 5MB 的静态二进制，让你的 2010 年上网本也能运行 AI 公司

## Slug
opc-5mb-static-binary-ai-company-32bit

## Content

### 背景

作为一个 AI 开发者，我一直在思考这样一个问题：一个「一人 AI 公司」最少需要
多少资源才能运行？

今天我把答案放在了一个 **5MB 的静态二进制** 里面。

### 什么是 OPC？

OPC = One-Person AI Company Runtime。

它是一个单二进制、零依赖的运行时。把它放到任何一台机器上，就像雇佣了一个
完整的 AI 公司。

### 核心特性

1. **极致轻量**
   - 单个 5MB 静态二进制
   - ~10MB 内存占用
   - 冷启动 <100ms
   - 对比：OpenCode ~852MB

2. **老硬件支持**
   - linux/386 — 32 位老电脑
   - linux/armv6 — 树莓派 1 / Zero
   - linux/amd64 — 现代 PC/服务器
   - linux/arm64 — 树莓派 4+

3. **动态 HR 系统**
   在 `~/.config/opencode/agents/` 目录下放一个 markdown 文件，就等于雇佣了
   一名新员工。17 个部门，覆盖产品、架构、开发、测试、安全、优化、文档、设计、
   法务、发布、营销、分析等。

4. **15 阶段流水线**
   产品 → 架构 → 开发 → 测试 → 安全 → 优化 → 文档 → 设计 → 法务 → 发布 →
   营销 → 分析，全流程自动化。

5. **内置 RAG 知识库**
   - `kb search "<topic>"` — 决策前搜索
   - `kb learn patterns name "content"` — 行动后学习
   - 错误必记录

6. **供应商容错**
   zen（免费免 key）→ kilo → openrouter，自动故障转移。

### 安装

```sh
# 国内/慢网络推荐 (CDN 镜像)
curl -fsSL https://cdn.jsdelivr.net/gh/Hanley-Liu/opc@main/install.sh | sh

# GitHub 直连
curl -fsSL https://raw.githubusercontent.com/Hanley-Liu/opc/main/install.sh | sh
```

### 使用

```sh
opc-agent agents                    # 查看公司全员
opc-agent run "做个 todo app" --agent build   # COO 总调度执行任务
opc-agent models                    # 查看模型容错链
kb search "如何写 README"           # 查知识库
kb learn patterns opc "content"     # 学到知识库
```

Full 模式附加：

```sh
opc-heartbeat status                # 公司运营状态
opc-heartbeat enqueue requirement myproj '{"requirement":"做个 xx"}'
```

### 项目地址

- GitHub: https://github.com/Hanley-Liu/opc
- License: MIT

### 写在最后

OPC 的诞生，证明了一个「一人 AI 公司」甚至可以在一个 2010 年的上网本上运行。
这不仅是技术的挑战，更是对极简主义的探索。

如果你有任何想法或反馈，欢迎在 GitHub 上提 Issue 或 PR！

---

### English version

#### Background

As an AI developer, I've been asking myself: how little resources does a
"one-person AI company" actually need to run?

Today I've put the answer in a **5MB static binary**.

#### What is OPC?

OPC = One-Person AI Company Runtime. A single-binary, zero-dependency runtime
that turns any machine into a complete AI company.

#### Key features

1. **Ultra-lightweight**: 5MB binary, ~10MB RAM, <100ms cold start
2. **Legacy hardware support**: 32-bit x86, ARMv6, plus modern amd64/arm64
3. **Dynamic HR**: drop a markdown file = hire a new agent (17 departments)
4. **15-stage pipeline**: product → dev → test → security → docs → legal →
   marketing → analytics
5. **Built-in RAG**: search before deciding, learn after acting
6. **Vendor failover**: zen (free, no key) → kilo → openrouter

#### Install

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/Hanley-Liu/opc@main/install.sh | sh
```

#### Use

```sh
opc-agent agents
opc-agent run "build a todo app" --agent build
```

GitHub: https://github.com/Hanley-Liu/opc | License: MIT
