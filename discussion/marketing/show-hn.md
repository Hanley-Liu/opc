# Show HN: OPC — One-Person AI Company Runtime (5MB static binary, runs on 32-bit hardware)

**Title (≤80 chars):**
Show HN: OPC — a 5MB static binary that runs a whole AI company on a 2010 netbook

**Body:**

I built OPC — a "one-person AI company" runtime that fits in a single 5MB static
binary with zero dependencies. It runs on anything from a 2010-era 32-bit
netbook to a modern server.

## What it does

OPC is a multi-agent AI company in a box. Drop it on a machine and it can:

- **Hire agents on the fly** — drop a `~/.config/opencode/agents/*.md` file and
  you've hired a new employee (engineer, lawyer, marketer, etc.)
- **Run a 15-stage pipeline** — product → architecture → development → testing
  → security → optimization → docs → design → legal → release → marketing →
  analytics, all orchestrated automatically
- **Built-in RAG** — `kb` knowledge base: search before deciding, learn after
  acting, record every error
- **Vendor failover** — zen (free, no key) → kilo → openrouter, automatic
  fallback
- **Full mode** — optional heartbeat scheduler + systemd user services for
  persistent operation

## Why it's different

- **5MB binary** vs OpenCode's ~852MB footprint
- **~10MB RAM** at runtime, cold start <100ms
- **32-bit support** — genuinely runs on decade-old hardware
- **No Node, no Python, no runtime** — pure Go static compilation

## Try it

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/Hanley-Liu/opc@main/install.sh | sh
opc-agent agents          # see the 17 departments
opc-agent run "build a todo app" --agent build
```

GitHub: https://github.com/Hanley-Liu/opc
License: MIT

---

I'm the author. Happy to answer questions and take feedback!
