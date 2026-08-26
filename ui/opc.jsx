#!/usr/bin/env node
// opc — OPC 永动公司 · 对话驾驶台 (Ink/React)
// 定位：不是通用聊天框，是公司的指挥入口。打开即见：引擎/项目池/员工。
import React, { useState, useEffect, useCallback } from "react";
import { render, Static, Box, Text, useInput, useApp } from "ink";
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const C = {
  primary: "#7aa2f7", secondary: "#bb9af7", text: "#c0caf5", muted: "#565f89",
  error: "#f7768e", success: "#9ece6a", tool: "#7dcfff", warn: "#e0af68",
};
const COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
const PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
const MAX_RESULT = 10;
let idc = 0;
const nid = () => `e${++idc}`;
const trunc = (s, w) => { s = String(s ?? "").replace(/\n/g, " "); return s.length > w ? s.slice(0, w - 1) + "…" : s; };

function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } }

// ─────────── 公司状态（每次交互实时读取） ───────────
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  const active = pool.filter(p => p.status === "active");
  return { pool, active, running: !!eng.running };
}

// ─────────── 组件 ───────────
// 色条消息块（opencode 左边框的 Ink 稳定等价实现）
function Gutter({ color, children }) {
  return (
    <Box>
      <Text color={color} bold>{"▌ "}</Text>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}

function UserBlock({ text }) {
  return <Gutter color={C.secondary}><Text color={C.text}>{text}</Text></Gutter>;
}

function AssistantBlock({ body, meta }) {
  return (
    <Gutter color={C.primary}>
      <Text color={C.text}>{body}</Text>
      {meta ? <Text dimColor>{meta}</Text> : null}
    </Gutter>
  );
}

function ToolRow({ e }) {
  return (
    <Box paddingLeft={2}>
      <Text>
        <Text color={C.tool} bold>⚡ </Text>
        <Text color={C.tool}>{e.tool} </Text>
        <Text color={C.muted}>{trunc(prettyParams(e.args), 72)}</Text>
      </Text>
    </Box>
  );
}

function ResultRow({ e }) {
  const color = e.ok ? C.success : C.error;
  const lines = String(e.output ?? "").replace(/\n+$/, "").split("\n");
  const shown = lines.slice(0, MAX_RESULT);
  const extra = lines.length - shown.length;
  return (
    <Box flexDirection="column" paddingLeft={4}>
      {shown.map((l, i) => (
        <Text key={i} color={i === 0 && !e.ok ? C.error : color}>
          {(i === 0 ? (e.ok ? "✓ " : "✖ ") : "  ") + l}
        </Text>
      ))}
      {extra > 0 ? <Text color={C.muted}>   … (+{extra} 行)</Text> : null}
    </Box>
  );
}

function InfoRow({ text }) {
  return <Box paddingLeft={2}><Text dimColor>{text}</Text></Box>;
}

function Thinking() {
  return <Box paddingLeft={2}><Text color={C.muted}>⟳ 编排中…</Text></Box>;
}

function prettyParams(raw) {
  try {
    const m = JSON.parse(raw);
    if (m.command) return "$ " + m.command.replace(/\n/g, " ");
    if (m.path && m.old_string) return `${m.path} ✎`;
    if (m.path && m.content) return `${m.path} ✚${String(m.content).length}B`;
    if (m.path) return m.path;
    if (m.pattern) return "/" + m.pattern;
    if (m.agent) return `→ ${m.agent}: ${m.task_desc || ""}`;
    if (m.query) return m.query;
    if (m.url) return m.url;
  } catch {}
  return raw;
}

function route(input) {
  const low = input.toLowerCase();
  if (/测试|test/.test(low)) return "tester";
  if (/架构/.test(low)) return "architect";
  if (/审查|review/.test(low)) return "reviewer";
  if (/部署|发布|deploy/.test(low)) return "operator";
  if (/规划|计划/.test(low)) return "planner";
  return "orchestrator";
}

// 任务里提到池内项目名 → 自动切到该项目目录干活
function resolveDir(task, initialDir) {
  try {
    const pool = readJSON(path.join(COMPANY, "pool.json"), []);
    for (const p of pool) {
      if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const dir = path.join(PROJECTS, p.id);
        if (fs.existsSync(dir)) return dir;
      }
    }
  } catch {}
  return initialDir;
}

function renderEntry(e) {
  switch (e.type) {
    case "user": return <UserBlock text={e.text} />;
    case "assistant": return <AssistantBlock body={e.body} meta={e.meta} />;
    case "tool": return <ToolRow e={e} />;
    case "result": return <ResultRow e={e} />;
    case "info": return <InfoRow text={e.text} />;
    case "error": return <InfoRow text={"✖ " + e.text} />;
    default: return null;
  }
}

// ─────────── App ───────────
function App({ initialDir }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState([]);
  const [live, setLive] = useState(null);       // 进行中的工具调用
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState(0);
  const [tick, setTick] = useState(0);

  // 启动横幅：一眼看到公司状态
  useEffect(() => {
    const st = companyState();
    push({ id: nid(), type: "info",
      text: `公司状态: 引擎${st.running ? "运转中 ●" : "已停止 ○"} · 项目池 ${st.active.length}/${st.pool.length} 永动 (${st.pool.map(p=>p.id+(p.status==="active"?"":"⏸")).join(", ") || "空"})` });
    push({ id: nid(), type: "info",
      text: "直接输入任务派活；提到池内项目名会自动进入该项目目录。/pool /agents /clear /exit" });
  }, []);

  // 引擎心跳指示器（永动公司的呼吸感）
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1200);
    return () => clearInterval(t);
  }, []);

  const push = useCallback((e) => setEntries(prev => [...prev, e]), []);

  const submit = useCallback((task) => {
    const dir = resolveDir(task, initialDir);
    push({ id: nid(), type: "user", text: task });
    setBusy(true);

    const agentID = route(task);
    let pendingTool = null;
    const flushTool = () => {
      if (pendingTool) push({ ...pendingTool, hasResult: true, ok: false, output: "(无结果)" });
      pendingTool = null; setLive(null);
    };

    const child = spawn("opc-agent",
      ["run", task, "--dir", dir, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (raw) => {
      const line = raw.trim();
      if (!line.startsWith("{")) return;
      let ev; try { ev = JSON.parse(line); } catch { return; }
      switch (ev.type) {
        case "llm":
          setModel(ev.model || model); setTok(t => t + (ev.prompt_tokens||0) + (ev.completion_tokens||0));
          break;
        case "tool":
          flushTool();
          pendingTool = { id: nid(), type: "tool", tool: ev.tool, args: ev.args };
          setLive(pendingTool);
          break;
        case "result":
          if (pendingTool) {
            push({ ...pendingTool, hasResult: true, ok: ev.status === "success", output: ev.output });
            pendingTool = null; setLive(null);
          }
          break;
        case "run-done": {
          flushTool();
          const meta = `${ev.model} · ↑${ev.tokens?.prompt||0} ↓${ev.tokens?.completion||0} tok · ${ev.duration||0}ms`;
          push({ id: nid(), type: "assistant", body: (ev.output||"").trim() || "(无输出)", meta });
          setTok(t => t + (ev.tokens?.total||0));
          break;
        }
        case "llm-error":
          flushTool();
          push({ id: nid(), type: "error", text: "模型错误: " + ev.error });
          break;
      }
    });
    child.on("close", (code) => {
      flushTool();
      setBusy(false);
      if (code !== 0) push({ id: nid(), type: "error", text: `任务异常退出 (code=${code})，详见 logs/activity.jsonl` });
    });
  }, [initialDir, push]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { exit(); return; }
    if (key.return) {
      const t = input.trim();
      if (!t || busy) return;
      setInput("");
      if (t === "/exit" || t === "/quit") { exit(); return; }
      if (t === "/clear") { setEntries([]); return; }
      if (t === "/pool") {
        const st = companyState();
        push({ id: nid(), type: "info", text:
          st.pool.map(p => `${p.id} [${p.status}] 连败${p.fail_streak||0}`).join(" · ") || "项目池为空 —— 提到新想法即可创建需求" });
        return;
      }
      if (t === "/agents") {
        push({ id: nid(), type: "info", text:
          "编排 orchestrator · 规划 planner · 开发 developer · 测试 tester · 审查 reviewer · 架构 architect · 分析 analyst · 运维 operator" });
        return;
      }
      submit(t);
      return;
    }
    if (key.backspace || key.delete) { setInput(i => i.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput(i => i + ch);
    }
  });

  // Static 区只放已完成条目（Ink 渲染一次，不随状态抖动）
  const staticItems = entries.map(e => ({ id: e.id, node: renderEntry(e) }));

  const st = companyState();
  const breath = tick % 2 === 0 ? "●" : "○";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item) => <Box key={item.id}>{item.node}</Box>}
      </Static>

      {live ? <ToolRow e={{ ...live, hasResult: false }} /> : null}
      {busy ? <Thinking /> : null}

      <Box borderStyle="round" borderColor={C.border} paddingX={1}>
        <Text color={C.primary} bold>{"❯ "}</Text>
        <Text color={C.text}>{input}</Text>
        {busy ? null : <Text dimColor>_</Text>}
      </Box>
      <Text dimColor>
        {" "}
        <Text color={engColor}>{breath}</Text>
        {" 引擎:" + (st.running ? "运转中" : "停止") + " · 池:" + st.active.length + "/" + st.pool.length}
        {" · " + trunc(model, 30) + " · ↑↓" + tok + " tok · Enter 派活 · Ctrl+C 退出"}
      </Text>
    </Box>
  );
}
const R = "\x1b[0m";

// ─────────── 启动 ───────────
const idx = process.argv.indexOf("--dir");
const dir = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dir)) { console.error("目录不存在:", dir); process.exit(1); }

render(<App initialDir={dir} />, { patchConsole: false });
