# OPC — One-Person AI Company Runtime

轻量、可移植的自主 AI 公司运行时。**零依赖单二进制**,从 2010 年的 32 位上网本到现代服务器都能跑。

A lightweight, portable runtime for an autonomous one-person AI company.
**Single static binary, zero dependencies** — runs on anything from a 2010-era
32-bit netbook to a modern server.

## 一键安装 / One-line install

```sh
curl -fsSL https://raw.githubusercontent.com/Hanley-Liu/opc/main/install.sh | sh
```

带 GitHub token(自动推送代码)/ with token for autonomous git push:

```sh
curl -fsSL https://raw.githubusercontent.com/Hanley-Liu/opc/main/install.sh | sh -s -- --github-token ghp_xxx
```

## 安装模式 / Modes

| 模式 | 内容 | 适合 |
|---|---|---|
| `worker`(默认) | opc-agent + kb + 配置 + 知识库骨架 | 老设备/节点机 |
| `--mode full` | worker + 心跳调度器 + systemd 常驻 | 主力机 |

## 支持架构 / Architectures

| 架构 | 二进制 | 典型设备 |
|---|---|---|
| linux/amd64 | `opc-agent-linux-amd64` (~5.3MB) | 现代PC/服务器 |
| linux/386 | `opc-agent-linux-386` (~5.1MB) | **32位老电脑** |
| linux/armv6 | `opc-agent-linux-armv6` (~5.2MB) | 树莓派1/Zero、旧手机 |
| linux/arm64 | `opc-agent-linux-arm64` (~5.1MB) | 树莓派4+、新ARM盒子 |

资源占用: **~10MB 内存**,冷启动 <100ms。(对照: opencode ~852MB)

## 使用 / Usage

```sh
opc-agent models                     # 查看模型容错链 (zen免key → kilo → openrouter)
opc-agent agents                     # 查看公司全员(17部门+HR招聘)
opc-agent run "任务描述" --agent build    # COO总调度执行任务
opc-agent run "..." --agent developer --dir ./myproject

kb search "<topic>"                  # 决策前查知识库
kb learn patterns name "content"     # 行动后沉淀经验

# full 模式附加:
opc-heartbeat status                 # 公司运营状态
opc-heartbeat enqueue requirement myproj '{"requirement":"做个xx"}'
```

## 特性 / Features

- 🧠 多智能体协作:产品→架构→开发→测试→安全→优化→文档→设计→法务→发布→营销→分析,15阶段流水线
- 🔀 供应商容错:zen(免费免key)/kilo/openrouter 自动故障转移
- 📚 内置 RAG:kb 知识库,决策前搜索、行动后学习、错误必记录
- 👥 HR 动态扩编:`~/.config/opencode/agents/*.md` 放入 markdown 即新增员工
- ♻️ 向下兼容:直接读取 opencode.jsonc 配置与 agent 定义
- 🪶 极致轻量:Go 静态编译,无 Node/无 Python/无运行时依赖

## License

MIT © Hanley-Liu
