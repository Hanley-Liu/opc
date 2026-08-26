#!/usr/bin/env node

// opc.jsx
import React, { useState, useEffect, useCallback } from "react";
import { render, Static, Box, Text, useInput, useApp } from "ink";
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var C = {
  primary: "#7aa2f7",
  secondary: "#bb9af7",
  text: "#c0caf5",
  muted: "#565f89",
  error: "#f7768e",
  success: "#9ece6a",
  tool: "#7dcfff",
  warn: "#e0af68"
};
var COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
var PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
var MAX_RESULT = 10;
var idc = 0;
var nid = () => `e${++idc}`;
var trunc = (s, w) => {
  s = String(s ?? "").replace(/\n/g, " ");
  return s.length > w ? s.slice(0, w - 1) + "\u2026" : s;
};
function readJSON(f, d) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
}
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  const active = pool.filter((p) => p.status === "active");
  return { pool, active, running: !!eng.running };
}
function Gutter({ color, children }) {
  return /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color, bold: true }, "\u258C "), /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, children));
}
function UserBlock({ text }) {
  return /* @__PURE__ */ React.createElement(Gutter, { color: C.secondary }, /* @__PURE__ */ React.createElement(Text, { color: C.text }, text));
}
function AssistantBlock({ body, meta }) {
  return /* @__PURE__ */ React.createElement(Gutter, { color: C.primary }, /* @__PURE__ */ React.createElement(Text, { color: C.text }, body), meta ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, meta) : null);
}
function ToolRow({ e }) {
  return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, null, /* @__PURE__ */ React.createElement(Text, { color: C.tool, bold: true }, "\u26A1 "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, e.tool, " "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, trunc(prettyParams(e.args), 72))));
}
function ResultRow({ e }) {
  const color = e.ok ? C.success : C.error;
  const lines = String(e.output ?? "").replace(/\n+$/, "").split("\n");
  const shown = lines.slice(0, MAX_RESULT);
  const extra = lines.length - shown.length;
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", paddingLeft: 4 }, shown.map((l, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: i === 0 && !e.ok ? C.error : color }, (i === 0 ? e.ok ? "\u2713 " : "\u2716 " : "  ") + l)), extra > 0 ? /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "   \u2026 (+", extra, " \u884C)") : null);
}
function InfoRow({ text }) {
  return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, text));
}
function Thinking() {
  return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "\u27F3 \u7F16\u6392\u4E2D\u2026"));
}
function prettyParams(raw) {
  try {
    const m = JSON.parse(raw);
    if (m.command) return "$ " + m.command.replace(/\n/g, " ");
    if (m.path && m.old_string) return `${m.path} \u270E`;
    if (m.path && m.content) return `${m.path} \u271A${String(m.content).length}B`;
    if (m.path) return m.path;
    if (m.pattern) return "/" + m.pattern;
    if (m.agent) return `\u2192 ${m.agent}: ${m.task_desc || ""}`;
    if (m.query) return m.query;
    if (m.url) return m.url;
  } catch {
  }
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
function resolveDir(task, initialDir) {
  try {
    const pool = readJSON(path.join(COMPANY, "pool.json"), []);
    for (const p of pool) {
      if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const dir2 = path.join(PROJECTS, p.id);
        if (fs.existsSync(dir2)) return dir2;
      }
    }
  } catch {
  }
  return initialDir;
}
function renderEntry(e) {
  switch (e.type) {
    case "user":
      return /* @__PURE__ */ React.createElement(UserBlock, { text: e.text });
    case "assistant":
      return /* @__PURE__ */ React.createElement(AssistantBlock, { body: e.body, meta: e.meta });
    case "tool":
      return /* @__PURE__ */ React.createElement(ToolRow, { e });
    case "result":
      return /* @__PURE__ */ React.createElement(ResultRow, { e });
    case "info":
      return /* @__PURE__ */ React.createElement(InfoRow, { text: e.text });
    case "error":
      return /* @__PURE__ */ React.createElement(InfoRow, { text: "\u2716 " + e.text });
    default:
      return null;
  }
}
function App({ initialDir }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState([]);
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const st2 = companyState();
    push({
      id: nid(),
      type: "info",
      text: `\u516C\u53F8\u72B6\u6001: \u5F15\u64CE${st2.running ? "\u8FD0\u8F6C\u4E2D \u25CF" : "\u5DF2\u505C\u6B62 \u25CB"} \xB7 \u9879\u76EE\u6C60 ${st2.active.length}/${st2.pool.length} \u6C38\u52A8 (${st2.pool.map((p) => p.id + (p.status === "active" ? "" : "\u23F8")).join(", ") || "\u7A7A"})`
    });
    push({
      id: nid(),
      type: "info",
      text: "\u76F4\u63A5\u8F93\u5165\u4EFB\u52A1\u6D3E\u6D3B\uFF1B\u63D0\u5230\u6C60\u5185\u9879\u76EE\u540D\u4F1A\u81EA\u52A8\u8FDB\u5165\u8BE5\u9879\u76EE\u76EE\u5F55\u3002/pool /agents /clear /exit"
    });
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1200);
    return () => clearInterval(t);
  }, []);
  const push = useCallback((e) => setEntries((prev) => [...prev, e]), []);
  const submit = useCallback((task) => {
    const dir2 = resolveDir(task, initialDir);
    push({ id: nid(), type: "user", text: task });
    setBusy(true);
    const agentID = route(task);
    let pendingTool = null;
    const flushTool = () => {
      if (pendingTool) push({ ...pendingTool, hasResult: true, ok: false, output: "(\u65E0\u7ED3\u679C)" });
      pendingTool = null;
      setLive(null);
    };
    const child = spawn(
      "opc-agent",
      ["run", task, "--dir", dir2, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir2 }
    );
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (raw) => {
      const line = raw.trim();
      if (!line.startsWith("{")) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      switch (ev.type) {
        case "llm":
          setModel(ev.model || model);
          setTok((t) => t + (ev.prompt_tokens || 0) + (ev.completion_tokens || 0));
          break;
        case "tool":
          flushTool();
          pendingTool = { id: nid(), type: "tool", tool: ev.tool, args: ev.args };
          setLive(pendingTool);
          break;
        case "result":
          if (pendingTool) {
            push({ ...pendingTool, hasResult: true, ok: ev.status === "success", output: ev.output });
            pendingTool = null;
            setLive(null);
          }
          break;
        case "run-done": {
          flushTool();
          const meta = `${ev.model} \xB7 \u2191${ev.tokens?.prompt || 0} \u2193${ev.tokens?.completion || 0} tok \xB7 ${ev.duration || 0}ms`;
          push({ id: nid(), type: "assistant", body: (ev.output || "").trim() || "(\u65E0\u8F93\u51FA)", meta });
          setTok((t) => t + (ev.tokens?.total || 0));
          break;
        }
        case "llm-error":
          flushTool();
          push({ id: nid(), type: "error", text: "\u6A21\u578B\u9519\u8BEF: " + ev.error });
          break;
      }
    });
    child.on("close", (code) => {
      flushTool();
      setBusy(false);
      if (code !== 0) push({ id: nid(), type: "error", text: `\u4EFB\u52A1\u5F02\u5E38\u9000\u51FA (code=${code})\uFF0C\u8BE6\u89C1 logs/activity.jsonl` });
    });
  }, [initialDir, push]);
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (key.return) {
      const t = input.trim();
      if (!t || busy) return;
      setInput("");
      if (t === "/exit" || t === "/quit") {
        exit();
        return;
      }
      if (t === "/clear") {
        setEntries([]);
        return;
      }
      if (t === "/pool") {
        const st2 = companyState();
        push({ id: nid(), type: "info", text: st2.pool.map((p) => `${p.id} [${p.status}] \u8FDE\u8D25${p.fail_streak || 0}`).join(" \xB7 ") || "\u9879\u76EE\u6C60\u4E3A\u7A7A \u2014\u2014 \u63D0\u5230\u65B0\u60F3\u6CD5\u5373\u53EF\u521B\u5EFA\u9700\u6C42" });
        return;
      }
      if (t === "/agents") {
        push({ id: nid(), type: "info", text: "\u7F16\u6392 orchestrator \xB7 \u89C4\u5212 planner \xB7 \u5F00\u53D1 developer \xB7 \u6D4B\u8BD5 tester \xB7 \u5BA1\u67E5 reviewer \xB7 \u67B6\u6784 architect \xB7 \u5206\u6790 analyst \xB7 \u8FD0\u7EF4 operator" });
        return;
      }
      submit(t);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((i) => i.slice(0, -1));
      return;
    }
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput((i) => i + ch);
    }
  });
  const staticItems = entries.map((e) => ({ id: e.id, node: renderEntry(e) }));
  const st = companyState();
  const breath = tick % 2 === 0 ? "\u25CF" : "\u25CB";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, /* @__PURE__ */ React.createElement(Static, { items: staticItems }, (item) => /* @__PURE__ */ React.createElement(Box, { key: item.id }, item.node)), live ? /* @__PURE__ */ React.createElement(ToolRow, { e: { ...live, hasResult: false } }) : null, busy ? /* @__PURE__ */ React.createElement(Thinking, null) : null, /* @__PURE__ */ React.createElement(Box, { borderStyle: "round", borderColor: C.border, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { color: C.primary, bold: true }, "\u276F "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, input), busy ? null : /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "_")), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " ", /* @__PURE__ */ React.createElement(Text, { color: engColor }, breath), " \u5F15\u64CE:" + (st.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62") + " \xB7 \u6C60:" + st.active.length + "/" + st.pool.length, " \xB7 " + trunc(model, 30) + " \xB7 \u2191\u2193" + tok + " tok \xB7 Enter \u6D3E\u6D3B \xB7 Ctrl+C \u9000\u51FA"));
}
var idx = process.argv.indexOf("--dir");
var dir = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dir)) {
  console.error("\u76EE\u5F55\u4E0D\u5B58\u5728:", dir);
  process.exit(1);
}
render(/* @__PURE__ */ React.createElement(App, { initialDir: dir }), { patchConsole: false });
