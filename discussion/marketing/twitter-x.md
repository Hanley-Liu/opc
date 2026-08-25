# Twitter/X thread draft

## Tweet 1/8
🧵 Introducing OPC — a 5MB static binary that runs a whole AI company.

No Docker. No Node. No Python. Just a single binary that works on a 2010 32-bit
netbook.

#ai #programming #selfhosted

## Tweet 2/8
OPC = One-Person AI Company runtime.

Drop it on a machine and it can:
- Hire agents on the fly (drop a .md file = new employee)
- Run a 15-stage pipeline (product → dev → test → security → docs → legal →
  marketing → analytics)
- Built-in RAG via `kb` knowledge base

## Tweet 3/8
Why OPC is different:

OpenCode: ~852MB
OPC: 5MB

OpenCode: modern hardware
OPC: 2010 32-bit netbook ✓

OpenCode: Node/Python deps
OPC: zero dependencies, pure Go static binary

## Tweet 4/8
Vendor failover built in:
zen (free, no key) → kilo → openrouter

Automatic fallback if one provider is down or rate-limited.

## Tweet 5/8
Full mode includes:
- opc-heartbeat: persistent scheduler
- systemd user services
- queue.json work dispatch

Worker mode (default): just the agent + kb + config. Perfect for old hardware.

## Tweet 6/8
Multi-arch binaries:
- linux/amd64
- linux/386 ← 32-bit!
- linux/armv6 ← Raspberry Pi 1/Zero
- linux/arm64

All ~5MB. All zero-dependency.

## Tweet 7/8
Try it:
```
curl -fsSL https://cdn.jsdelivr.net/gh/Hanley-Liu/opc@main/install.sh | sh
opc-agent agents
opc-agent run "build a todo app" --agent build
```

GitHub: https://github.com/Hanley-Liu/opc
License: MIT

## Tweet 8/8
Would you run an AI company on your old netbook?

I built OPC because I wanted to see how far I could push the "one-person AI
company" idea — and how little resources it could run on.

Thoughts? Feedback?

#ai #programming #selfhosted #opensource
