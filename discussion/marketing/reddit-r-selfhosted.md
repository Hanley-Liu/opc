# Reddit post: r/selfhosted

**Title:**
[Self-hosted] OPC — a 5MB AI company runtime that runs on a 2010 netbook

**Body:**

Hey r/selfhosted!

I've been working on something I think you folks might find interesting.
**OPC** (One-Person AI Company) is a single 5MB static binary that runs a whole
multi-agent AI company — and it actually runs on a 2010-era 32-bit netbook with
~10MB RAM.

### What it does

- **15-stage AI pipeline**: product → architecture → development → testing →
  security → optimization → docs → design → legal → release → marketing →
  analytics
- **Dynamic HR**: drop a markdown file in `~/.config/opencode/agents/` and you've
  hired a new agent
- **Built-in RAG** via `kb` — search before deciding, learn after acting
- **Vendor failover**: zen (free, no API key) → kilo → openrouter
- **Full mode**: optional heartbeat scheduler + systemd user services

### Why it's cool for self-hosters

- **5MB binary** — no Docker images, no Node, no Python, no runtime deps
- **32-bit support** — genuinely runs on old hardware you might have lying around
- **~10MB RAM** at runtime
- **Cold start <100ms**
- **MIT licensed**

### Quick start

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/Hanley-Liu/opc@main/install.sh | sh
opc-agent agents
opc-agent run "build a todo app" --agent build
```

GitHub: https://github.com/Hanley-Liu/opc

I'm curious — would you actually run an AI company on your old netbook? What
would you build with it?

---

*I'm the author and happy to take questions / feedback!*
