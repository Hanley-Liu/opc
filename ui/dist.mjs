#!/usr/bin/env node

// opc.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var C = {
  // 办公室色调（Tokyo Night）
  floor: "#1a1b26",
  // 地板/背景
  wall: "#24283b",
  // 墙壁/面板
  desk: "#414868",
  // 桌子/分隔线
  text: "#c0caf5",
  // 正文
  muted: "#565f89",
  // 灰色文字
  accent: "#7aa2f7",
  // 强调色（蓝色）
  success: "#9ece6a",
  // 在线/完成（绿色）
  warn: "#e0af68",
  // 工作中（黄色）
  error: "#f7768e",
  // 错误/离线（红色）
  tool: "#7dcfff",
  // 工具调用（青色）
  ceo: "#bb9af7",
  // CEO（紫色）
  border: "#3d445c"
  // 边框
};
var COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
var PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
var readJSON = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
var trunc = (s, w) => {
  s = String(s ?? "").replace(/\n/g, " ");
  const r = [...s];
  return r.length <= w ? s : r.slice(0, Math.max(1, w - 1)).join("") + "\u2026";
};
var padR = (s, w) => {
  s = String(s ?? "");
  return s + " ".repeat(Math.max(0, w - [...s].length));
};
var ROSTER = [
  { id: "build", name: "Sisyphus", role: "COO\xB7\u7F16\u6392", emoji: "\u{1F9ED}", color: "#bb9af7" },
  { id: "product-manager", name: "\u4EA7\u54C1\u7ECF\u7406", role: "\u9700\u6C42PRD", emoji: "\u{1F4CB}", color: "#9ece6a" },
  { id: "architect", name: "\u67B6\u6784\u5E08", role: "\u7CFB\u7EDF\u8BBE\u8BA1", emoji: "\u{1F3D7}", color: "#7dcfff" },
  { id: "developer", name: "\u5F00\u53D1\u8005", role: "\u7F16\u7801\u5B9E\u73B0", emoji: "\u{1F4BB}", color: "#e0af68" },
  { id: "tester", name: "\u6D4B\u8BD5\u5458", role: "\u8D28\u91CF\u4FDD\u8BC1", emoji: "\u{1F50D}", color: "#ff9e64" },
  { id: "security-auditor", name: "\u5B89\u5168\u5BA1\u8BA1", role: "\u6F0F\u6D1E\u626B\u63CF", emoji: "\u{1F6E1}", color: "#f7768e" },
  { id: "docs-writer", name: "\u6587\u6863\u5DE5\u7A0B\u5E08", role: "README", emoji: "\u{1F4DD}", color: "#73daca" },
  { id: "marketing-growth", name: "\u589E\u957F\u8425\u9500", role: "\u6DA8\u661F\u63A8\u5E7F", emoji: "\u{1F4E2}", color: "#ff007f" },
  { id: "github-agent", name: "\u53D1\u5E03\u5B98", role: "git\u63A8\u9001", emoji: "\u{1F680}", color: "#c0caf5" },
  { id: "devops-release", name: "\u53D1\u5E03\u5DE5\u7A0B", role: "\u7248\u672CCI", emoji: "\u2699\uFE0F", color: "#2ac3de" },
  { id: "analyst", name: "\u5206\u6790\u5E08", role: "\u6570\u636E\u6D1E\u5BDF", emoji: "\u{1F4CA}", color: "#b4f9f8" },
  { id: "legal-compliance", name: "\u6CD5\u52A1", role: "\u5408\u89C4", emoji: "\u2696\uFE0F", color: "#a9b1d6" }
];
function getRoster(id) {
  return ROSTER.find((r) => r.id === id) || { id, name: id || "\u672A\u77E5", role: "", emoji: "\u2753", color: C.muted };
}
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter((p) => p.status === "active"), running: !!eng.running };
}
function progressBar(pct, w = 16) {
  const filled = Math.round(pct / 100 * w);
  return "\u2588".repeat(filled) + "\u2591".repeat(w - filled);
}
function ActivityItem({ item, width }) {
  const time = new Date(item.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const agent = getRoster(item.agent);
  if (item.type === "system") {
    return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, time, " "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, trunc(item.text, width - 8)));
  }
  if (item.type === "tool") {
    const mark = item.ok === true ? "\u2713" : item.ok === false ? "\u2716" : "\u27F3";
    const markColor = item.ok === true ? C.success : item.ok === false ? C.error : C.warn;
    return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, time, " "), /* @__PURE__ */ React.createElement(Text, { color: agent.color }, trunc(agent.name, 6), " "), /* @__PURE__ */ React.createElement(Text, { color: markColor, bold: true }, mark, " "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, item.tool, " "), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, trunc(item.summary || "", width - 30)));
  }
  if (item.type === "assistant") {
    return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, time, " "), /* @__PURE__ */ React.createElement(Text, { color: agent.color, bold: true }, agent.emoji, " ", trunc(agent.name, 6), " "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, trunc(item.text, width - 30)));
  }
  return null;
}
function EmployeeDesk({ agent, status, task, progress, width }) {
  const statusEmoji = status === "working" ? "\u{1F7E2}" : status === "waiting" ? "\u23F8" : status === "done" ? "\u2705" : "\u{1F4A4}";
  const statusText = status === "working" ? "\u5DE5\u4F5C\u4E2D" : status === "waiting" ? "\u7B49\u5F85\u4E2D" : status === "done" ? "\u5DF2\u5B8C\u6210" : "\u7A7A\u95F2";
  const statusColor = status === "working" ? C.success : status === "waiting" ? C.muted : status === "done" ? C.accent : C.muted;
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width, paddingX: 1 }, /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: agent.color }, agent.emoji, " "), /* @__PURE__ */ React.createElement(Text, { color: agent.color, bold: true }, padR(agent.name, 8)), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, padR(agent.role, 8)), /* @__PURE__ */ React.createElement(Text, { color: statusColor }, statusEmoji, " ", statusText)), task ? /* @__PURE__ */ React.createElement(Box, { paddingLeft: 3 }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "\u2514\u2500 "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, trunc(task, width - 16)), progress !== void 0 ? /* @__PURE__ */ React.createElement(Text, { color: C.accent }, " ", progressBar(progress, 8), " ", progress, "%") : null) : null);
}
var COMMANDS = {
  "/help": { desc: "\u67E5\u770B\u6240\u6709\u547D\u4EE4", usage: "/help" },
  "/list": { desc: "\u5217\u51FA\u6240\u6709\u5458\u5DE5", usage: "/list" },
  "/say": { desc: "\u8DDF\u5458\u5DE5\u8BF4\u8BDD", usage: "/say <\u5458\u5DE5\u540D> <\u6D88\u606F>" },
  "/project": { desc: "\u7BA1\u7406\u9879\u76EE", usage: "/project list | /project focus <name>" },
  "/new": { desc: "\u521B\u5EFA\u65B0\u9879\u76EE", usage: "/new <name> <\u9700\u6C42>" },
  "/bill": { desc: "\u67E5\u770B\u8D26\u5355", usage: "/bill" },
  "/history": { desc: "\u67E5\u770B\u5386\u53F2", usage: "/history" },
  "/clear": { desc: "\u6E05\u7A7A\u6D3B\u52A8\u6D41", usage: "/clear" },
  "/status": { desc: "\u67E5\u770B\u516C\u53F8\u72B6\u6001", usage: "/status" },
  "/exit": { desc: "\u9000\u51FA", usage: "/exit" }
};
function parseCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { type: "task", text: trimmed };
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");
  if (!COMMANDS[cmd]) return { type: "error", text: `\u672A\u77E5\u547D\u4EE4: ${cmd}\uFF0C\u8F93\u5165 /help \u67E5\u770B\u5E2E\u52A9` };
  return { type: "command", cmd, args };
}
function routeTask(task) {
  const low = task.toLowerCase();
  if (/测试|test/.test(low)) return "tester";
  if (/架构/.test(low)) return "architect";
  if (/安全|漏洞/.test(low)) return "security-auditor";
  if (/文档|readme/.test(low)) return "docs-writer";
  if (/营销|涨星|推广/.test(low)) return "marketing-growth";
  if (/发布|上线|push/.test(low)) return "github-agent";
  if (/法务|license/.test(low)) return "legal-compliance";
  if (/数据|统计/.test(low)) return "analyst";
  return "build";
}
function App({ initialDir }) {
  const { exit } = useApp();
  const { stdout } = process;
  const [activities, setActivities] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyAgent, setBusyAgent] = useState(null);
  const [busyTask, setBusyTask] = useState("");
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState({ p: 0, c: 0 });
  const [tick, setTick] = useState(0);
  const [focusProj, setFocusProj] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const pendingToolRef = useRef(null);
  useEffect(() => {
    stdout.write("\x1B[?1049h\x1B[H");
    const t = setInterval(() => setTick((x) => x + 1), 3e3);
    return () => {
      clearInterval(t);
      stdout.write("\x1B[?1049l");
    };
  }, []);
  const addActivity = useCallback((item) => {
    setActivities((prev) => [...prev.slice(-99), { ...item, ts: Date.now() }]);
  }, []);
  const handleEngineEvent = useCallback((ev) => {
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model);
        setTok((t) => ({ p: t.p + (ev.prompt_tokens || 0), c: t.c + (ev.completion_tokens || 0) }));
        break;
      case "tool":
        pendingToolRef.current = { tool: ev.tool, args: ev.args, agent: ev.agent };
        break;
      case "result": {
        const pt = pendingToolRef.current;
        if (pt) {
          addActivity({ type: "tool", tool: pt.tool, agent: pt.agent, ok: ev.ok === true || ev.status === "success", summary: trunc(String(ev.output || "").split("\n")[0], 50) });
          pendingToolRef.current = null;
        }
        break;
      }
      case "run-done": {
        const pt = pendingToolRef.current;
        if (pt) {
          addActivity({ type: "tool", tool: pt.tool, agent: pt.agent, ok: false, summary: "(\u4E2D\u65AD)" });
          pendingToolRef.current = null;
        }
        const tk = ev.tokens || {};
        const body = (ev.output || ev.summary || "").trim() || "(\u65E0\u8F93\u51FA)";
        addActivity({ type: "assistant", agent: ev.agent, text: trunc(body.split("\n")[0], 80) });
        setModel(ev.model || model);
        setTok((t) => ({ p: t.p + (tk.prompt || 0), c: t.c + (tk.completion || 0) }));
        setBusy(false);
        setBusyAgent(null);
        setBusyTask("");
        break;
      }
      case "llm-error":
        addActivity({ type: "system", text: "\u6A21\u578B\u9519\u8BEF: " + ev.error });
        setBusy(false);
        setBusyAgent(null);
        break;
    }
  }, [model, addActivity]);
  const runTask = useCallback((task, forceAgent) => {
    let dir = initialDir;
    if (focusProj) {
      const d = path.join(PROJECTS, focusProj);
      if (fs.existsSync(d)) dir = d;
    } else {
      const st2 = companyState();
      for (const p of st2.pool) {
        if (task.toLowerCase().includes(p.id.toLowerCase())) {
          const d = path.join(PROJECTS, p.id);
          if (fs.existsSync(d)) {
            dir = d;
            break;
          }
        }
      }
    }
    const agentID = forceAgent || routeTask(task);
    const agent = getRoster(agentID);
    setBusy(true);
    setBusyAgent(agentID);
    setBusyTask(trunc(task, 40));
    addActivity({ type: "system", text: `CEO \u6307\u6D3E ${agent.name}: ${trunc(task, 50)}` });
    const child = spawn(
      "opc-agent",
      ["run", task, "--dir", dir, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir }
    );
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        handleEngineEvent(ev);
      }
    });
    child.on("error", (e) => {
      setBusy(false);
      setBusyAgent(null);
      addActivity({ type: "system", text: "\u542F\u52A8\u5931\u8D25: " + e.message });
    });
    child.on("close", () => {
      if (pendingToolRef.current) {
        pendingToolRef.current = null;
      }
      setBusy(false);
      setBusyAgent(null);
    });
  }, [initialDir, focusProj, handleEngineEvent, addActivity]);
  const createProject = useCallback((name, requirement) => {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });
    addActivity({ type: "system", text: `\u65B0\u9879\u76EE\u300C${name}\u300D\u5F00\u5DE5` });
    setBusy(true);
    setBusyAgent("build");
    setBusyTask(`\u5EFA\u8BBE ${name}`);
    const child = spawn(
      "opc-agent",
      [
        "run",
        `FULL LIFECYCLE for new project '${name}'. Requirement: ${requirement}. Work in cwd. Phases: product-manager -> architect -> developer -> tester(tests pass) -> security-auditor -> legal(MIT Hanley-Liu) -> docs-writer(README.md+README.zh-CN.md) -> git init & push to github.com/Hanley-Liu/${name} (GITHUB_TOKEN set, insteadOf active) -> devops-release(topics+description). Decide everything yourself.`,
        "--dir",
        dir,
        "--agent",
        "build",
        "--json"
      ],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir }
    );
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        handleEngineEvent(ev);
      }
    });
    child.on("close", (code) => {
      setBusy(false);
      setBusyAgent(null);
      if (code === 0 && fs.existsSync(path.join(dir, "README.md"))) {
        const pf = path.join(COMPANY, "pool.json");
        const pool = readJSON(pf, []);
        if (!pool.some((p) => p.id === name))
          pool.push({ id: name, status: "active", interval_min: 60, priority: 5, last_run: 0, fail_streak: 0 });
        fs.writeFileSync(pf, JSON.stringify(pool, null, 1));
        addActivity({ type: "system", text: `\u{1F389} \u300C${name}\u300D\u5165\u6C60\u6C38\u52A8\uFF01` });
      } else {
        addActivity({ type: "system", text: `\u300C${name}\u300D\u672A\u5B8C\u6210 (code=${code})` });
      }
    });
  }, [addActivity, handleEngineEvent]);
  const handleCommand = useCallback((input2) => {
    const parsed = parseCommand(input2);
    if (parsed.type === "error") {
      addActivity({ type: "system", text: parsed.text });
      return;
    }
    if (parsed.type === "task") {
      runTask(parsed.text);
      return;
    }
    switch (parsed.cmd) {
      case "/help": {
        const lines = Object.entries(COMMANDS).map(([cmd, info]) => `  ${cmd.padEnd(12)} ${info.desc}`);
        addActivity({ type: "system", text: "\u53EF\u7528\u547D\u4EE4:\n" + lines.join("\n") });
        break;
      }
      case "/list": {
        const lines = ROSTER.map((a) => `  ${a.emoji} ${a.name.padEnd(8)} ${a.role}`);
        addActivity({ type: "system", text: "\u5458\u5DE5\u5217\u8868:\n" + lines.join("\n") });
        break;
      }
      case "/say": {
        const sp = parsed.args.indexOf(" ");
        if (sp < 1) {
          addActivity({ type: "system", text: "\u7528\u6CD5: /say <\u5458\u5DE5\u540D> <\u6D88\u606F>" });
          break;
        }
        const agentName = parsed.args.slice(0, sp);
        const msg = parsed.args.slice(sp + 1);
        const agent = ROSTER.find((a) => a.name === agentName || a.id === agentName);
        if (!agent) {
          addActivity({ type: "system", text: `\u627E\u4E0D\u5230\u5458\u5DE5: ${agentName}` });
          break;
        }
        runTask(msg, agent.id);
        break;
      }
      case "/project": {
        const [sub, ...rest] = parsed.args.split(/\s+/);
        if (sub === "list" || !sub) {
          const st2 = companyState();
          if (!st2.pool.length) {
            addActivity({ type: "system", text: "\u9879\u76EE\u6C60\u4E3A\u7A7A" });
            break;
          }
          const lines = st2.pool.map((p) => `  ${p.status === "active" ? "\u{1F7E2}" : "\u23F8"} ${p.id}`);
          addActivity({ type: "system", text: "\u9879\u76EE\u6C60:\n" + lines.join("\n") });
        } else if (sub === "focus") {
          const name = rest[0];
          if (!name) {
            setFocusProj(null);
            addActivity({ type: "system", text: "\u5DF2\u53D6\u6D88\u805A\u7126" });
            break;
          }
          const d = path.join(PROJECTS, name);
          if (fs.existsSync(d)) {
            setFocusProj(name);
            addActivity({ type: "system", text: `\u805A\u7126: ${name}` });
          } else {
            addActivity({ type: "system", text: `\u9879\u76EE\u4E0D\u5B58\u5728: ${name}` });
          }
        }
        break;
      }
      case "/new": {
        const sp = parsed.args.indexOf(" ");
        if (sp < 1) {
          addActivity({ type: "system", text: "\u7528\u6CD5: /new <name> <\u9700\u6C42>" });
          break;
        }
        createProject(parsed.args.slice(0, sp), parsed.args.slice(sp + 1));
        break;
      }
      case "/bill": {
        addActivity({ type: "system", text: `\u{1F4B0} \u7D2F\u8BA1 tokens: \u2191${tok.p} \u2193${tok.c}` });
        break;
      }
      case "/history": {
        const st2 = companyState();
        const lines = st2.pool.map((p) => {
          const lastRun = p.last_run ? new Date(p.last_run).toLocaleString("zh-CN") : "\u4ECE\u672A";
          return `  ${p.id.padEnd(20)} \u6700\u540E\u8FD0\u884C: ${lastRun}`;
        });
        addActivity({ type: "system", text: "\u9879\u76EE\u5386\u53F2:\n" + lines.join("\n") });
        break;
      }
      case "/clear": {
        setActivities([]);
        break;
      }
      case "/status": {
        const st2 = companyState();
        addActivity({ type: "system", text: `\u5F15\u64CE: ${st2.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62"} | \u6D3B\u8DC3\u9879\u76EE: ${st2.active.length}/${st2.pool.length} | \u5458\u5DE5: ${ROSTER.length}` });
        break;
      }
      case "/exit": {
        exit();
        break;
      }
    }
  }, [addActivity, runTask, createProject, tok, exit]);
  const S = useRef({});
  S.current = { input, busy, history, historyIdx };
  const handlerRef = useRef(null);
  handlerRef.current = (ch, key) => {
    const s = S.current;
    if (key.ctrl && (ch === "c" || ch === "C")) {
      exit();
      return;
    }
    if (key.return) {
      const t = s.input.trim();
      setInput("");
      setHistoryIdx(-1);
      if (!t) return;
      setHistory((prev) => [...prev.slice(-49), t]);
      handleCommand(t);
      return;
    }
    if (key.escape) {
      setInput("");
      setHistoryIdx(-1);
      return;
    }
    if (key.backspace) {
      setInput((i) => i.slice(0, -1));
      return;
    }
    if (key.upArrow) {
      if (s.history.length === 0) return;
      const newIdx = s.historyIdx < 0 ? s.history.length - 1 : Math.max(0, s.historyIdx - 1);
      setHistoryIdx(newIdx);
      setInput(s.history[newIdx] || "");
      return;
    }
    if (key.downArrow) {
      if (s.historyIdx < 0) return;
      const newIdx = s.historyIdx + 1;
      if (newIdx >= s.history.length) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        setHistoryIdx(newIdx);
        setInput(s.history[newIdx] || "");
      }
      return;
    }
    if (key.tab) {
      const t = s.input.trim();
      if (t.startsWith("/")) {
        const matches = Object.keys(COMMANDS).filter((c) => c.startsWith(t));
        if (matches.length === 1) setInput(matches[0] + " ");
        else if (matches.length > 1) {
          addActivity({ type: "system", text: "\u8865\u5168: " + matches.join("  ") });
        }
      }
      return;
    }
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput((i) => i + ch);
    }
  };
  const stableInput = useCallback((ch, key) => {
    handlerRef.current(ch, key);
  }, []);
  useInput(stableInput);
  const st = companyState();
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;
  const breath = tick % 2 === 0 ? "\u25CF" : "\u25CB";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const engText = busy ? "\u5DE5\u4F5C\u4E2D" : st.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62";
  const HEADER_H = 3;
  const INPUT_H = 3;
  const ACTIVITY_H = Math.max(4, H - HEADER_H - INPUT_H - 12);
  const OFFICE_H = H - HEADER_H - ACTIVITY_H - INPUT_H - 1;
  const employeeStatus = ROSTER.map((a) => {
    if (busy && busyAgent === a.id) return { ...a, status: "working", task: busyTask, progress: void 0 };
    return { ...a, status: "idle", task: null };
  });
  const recentActivities = activities.slice(-ACTIVITY_H);
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: W, height: H }, /* @__PURE__ */ React.createElement(
    Box,
    {
      borderStyle: { topLeft: "\u2554", top: "\u2550", topRight: "\u2557", left: "\u2551", right: "\u2551", bottomLeft: "\u255A", bottom: "\u2550", bottomRight: "\u255D" },
      borderColor: C.border,
      width: W,
      height: HEADER_H,
      flexDirection: "column",
      paddingX: 1
    },
    /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u{1F3E2} OPC \u6C38\u52A8\u516C\u53F8"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: engColor }, breath, " \u5F15\u64CE: ", engText), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, "\u{1F4CA} ", st.active.length, "/", st.pool.length, " \u9879\u76EE"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, "\u{1F465} ", ROSTER.length, " \u5458\u5DE5"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "\u{1F4B0} \u2191", tok.p, " \u2193", tok.c), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, trunc(model, 24)), focusProj ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "\u{1F3AF} ", focusProj)) : null)
  ), /* @__PURE__ */ React.createElement(Box, { flexDirection: "row", height: OFFICE_H + ACTIVITY_H }, /* @__PURE__ */ React.createElement(
    Box,
    {
      flexDirection: "column",
      width: Math.floor(W * 0.45),
      height: OFFICE_H + ACTIVITY_H,
      paddingX: 1
    },
    /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u529E\u516C\u5BA4 \u2500\u2510"),
    /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", marginTop: 0 }, employeeStatus.map((a) => /* @__PURE__ */ React.createElement(
      EmployeeDesk,
      {
        key: a.id,
        agent: a,
        status: a.status,
        task: a.task,
        progress: a.progress,
        width: Math.floor(W * 0.45) - 2
      }
    )))
  ), /* @__PURE__ */ React.createElement(Box, { width: 1 }, /* @__PURE__ */ React.createElement(Text, { color: C.border }, "\u2502".repeat(OFFICE_H + ACTIVITY_H))), /* @__PURE__ */ React.createElement(
    Box,
    {
      flexDirection: "column",
      width: W - Math.floor(W * 0.45) - 1,
      height: OFFICE_H + ACTIVITY_H,
      paddingX: 1
    },
    /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u5B9E\u65F6\u52A8\u6001 \u2500\u2510"),
    /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", marginTop: 0 }, recentActivities.length === 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u6682\u65E0\u6D3B\u52A8\uFF0C\u7B49\u5F85 CEO \u6307\u4EE4\u2026") : recentActivities.map((item, i) => /* @__PURE__ */ React.createElement(ActivityItem, { key: i, item, width: W - Math.floor(W * 0.45) - 4 })))
  )), /* @__PURE__ */ React.createElement(
    Box,
    {
      borderStyle: { topLeft: "\u250C", top: "\u2500", topRight: "\u2510", left: "\u2502", right: "\u2502", bottomLeft: "\u2514", bottom: "\u2500", bottomRight: "\u2518" },
      borderColor: busy ? C.warn : C.border,
      width: W,
      height: INPUT_H,
      flexDirection: "column",
      paddingX: 1
    },
    /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: C.ceo, bold: true }, "\u{1F451} CEO "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "> "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, input), !busy ? /* @__PURE__ */ React.createElement(Text, { color: C.accent }, "\u258C") : /* @__PURE__ */ React.createElement(Text, { color: C.warn }, " \u23F3")),
    /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u8F93\u5165\u547D\u4EE4: /help \u67E5\u770B\u5E2E\u52A9 | /say <\u5458\u5DE5> <\u6D88\u606F> | /project list | /new <\u540D\u79F0> <\u9700\u6C42>")
  ));
}
var idx = process.argv.indexOf("--dir");
var dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) {
  console.error("\u76EE\u5F55\u4E0D\u5B58\u5728:", dirArg);
  process.exit(1);
}
render(/* @__PURE__ */ React.createElement(App, { initialDir: dirArg }), { patchConsole: false });
