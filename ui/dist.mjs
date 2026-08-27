#!/usr/bin/env node

// opc.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var C = {
  bg: "#1a1b26",
  // 背景
  panel: "#1e2030",
  // 面板
  border: "#3b4261",
  // 边框
  text: "#c0caf5",
  // 正文
  muted: "#565f89",
  // 灰色
  dim: "#414868",
  // 暗灰
  accent: "#7aa2f7",
  // 蓝色强调
  success: "#9ece6a",
  // 绿色（在线/完成）
  warn: "#e0af68",
  // 黄色（工作中）
  error: "#f7768e",
  // 红色（错误/离线）
  tool: "#7dcfff",
  // 青色（工具）
  purple: "#bb9af7",
  // 紫色（CEO）
  cyan: "#73daca",
  // 青色
  orange: "#ff9e64",
  // 橙色
  pink: "#ff007f"
  // 粉色
};
var HOME = os.homedir();
var COMPANY = path.join(HOME, ".local/share/opencode/company");
var PROJECTS = path.join(HOME, ".local/share/opencode/projects");
var ACTIVITY_FILE = path.join(COMPANY, "activity.jsonl");
var readJSON = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
var readLines = (f, n = 100) => {
  try {
    const data = fs.readFileSync(f, "utf8").trim().split("\n").slice(-n);
    return data.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
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
var timeAgo = (ts) => {
  if (!ts) return "\u4ECE\u672A";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 6e4) return "\u521A\u521A";
  if (diff < 36e5) return `${Math.floor(diff / 6e4)}\u5206\u949F\u524D`;
  if (diff < 864e5) return `${Math.floor(diff / 36e5)}\u5C0F\u65F6\u524D`;
  return `${Math.floor(diff / 864e5)}\u5929\u524D`;
};
var ROSTER = [
  { id: "build", name: "Sisyphus", role: "COO\xB7\u7F16\u6392", emoji: "\u{1F9ED}", color: "#bb9af7", skill: "\u7F16\u6392\u8C03\u5EA6" },
  { id: "product-manager", name: "\u4EA7\u54C1\u7ECF\u7406", role: "\u9700\u6C42PRD", emoji: "\u{1F4CB}", color: "#9ece6a", skill: "\u9700\u6C42\u5206\u6790" },
  { id: "architect", name: "\u67B6\u6784\u5E08", role: "\u7CFB\u7EDF\u8BBE\u8BA1", emoji: "\u{1F3D7}", color: "#7dcfff", skill: "\u67B6\u6784\u8BBE\u8BA1" },
  { id: "developer", name: "\u5F00\u53D1\u8005", role: "\u7F16\u7801\u5B9E\u73B0", emoji: "\u{1F4BB}", color: "#e0af68", skill: "\u4EE3\u7801\u5B9E\u73B0" },
  { id: "tester", name: "\u6D4B\u8BD5\u5458", role: "\u8D28\u91CF\u4FDD\u8BC1", emoji: "\u{1F50D}", color: "#ff9e64", skill: "\u6D4B\u8BD5\u9A8C\u8BC1" },
  { id: "security-auditor", name: "\u5B89\u5168\u5BA1\u8BA1", role: "\u6F0F\u6D1E\u626B\u63CF", emoji: "\u{1F6E1}", color: "#f7768e", skill: "\u5B89\u5168\u5BA1\u8BA1" },
  { id: "docs-writer", name: "\u6587\u6863\u5DE5\u7A0B\u5E08", role: "README", emoji: "\u{1F4DD}", color: "#73daca", skill: "\u6587\u6863\u7F16\u5199" },
  { id: "marketing-growth", name: "\u589E\u957F\u8425\u9500", role: "\u6DA8\u661F\u63A8\u5E7F", emoji: "\u{1F4E2}", color: "#ff007f", skill: "\u8425\u9500\u63A8\u5E7F" },
  { id: "github-agent", name: "\u53D1\u5E03\u5B98", role: "git\u63A8\u9001", emoji: "\u{1F680}", color: "#c0caf5", skill: "\u4EE3\u7801\u53D1\u5E03" },
  { id: "devops-release", name: "\u53D1\u5E03\u5DE5\u7A0B", role: "\u7248\u672CCI", emoji: "\u2699\uFE0F", color: "#2ac3de", skill: "CI/CD" },
  { id: "analyst", name: "\u5206\u6790\u5E08", role: "\u6570\u636E\u6D1E\u5BDF", emoji: "\u{1F4CA}", color: "#b4f9f8", skill: "\u6570\u636E\u5206\u6790" },
  { id: "legal-compliance", name: "\u6CD5\u52A1", role: "\u5408\u89C4", emoji: "\u2696\uFE0F", color: "#a9b1d6", skill: "\u6CD5\u5F8B\u5408\u89C4" }
];
var getRoster = (id) => ROSTER.find((r) => r.id === id) || { id, name: id || "\u672A\u77E5", role: "", emoji: "\u2753", color: C.muted, skill: "" };
function analyzeActivity() {
  const lines = readLines(ACTIVITY_FILE, 500);
  const now = Date.now();
  const hour = 36e5;
  const stats = {};
  ROSTER.forEach((r) => {
    stats[r.id] = {
      runs: 0,
      tools: 0,
      errors: 0,
      tokens: { p: 0, c: 0 },
      lastActive: null,
      recentTasks: []
    };
  });
  const recent = [];
  const errors = [];
  lines.forEach((ev) => {
    const agent = ev.agent;
    if (!stats[agent]) stats[agent] = { runs: 0, tools: 0, errors: 0, tokens: { p: 0, c: 0 }, lastActive: null, recentTasks: [] };
    if (ev.type === "run-start") {
      stats[agent].runs++;
      stats[agent].lastActive = ev.ts;
      if (ev.task) stats[agent].recentTasks.unshift(ev.task);
      if (stats[agent].recentTasks.length > 3) stats[agent].recentTasks.pop();
      recent.unshift({ type: "task", agent, task: ev.task, ts: ev.ts });
    }
    if (ev.type === "tool") {
      stats[agent].tools++;
      recent.unshift({ type: "tool", agent, tool: ev.tool, ts: ev.ts });
    }
    if (ev.type === "run-error" || ev.type === "llm-error") {
      stats[agent].errors++;
      errors.unshift({ agent, error: ev.error || ev.message || "\u672A\u77E5\u9519\u8BEF", ts: ev.ts });
      recent.unshift({ type: "error", agent, error: ev.error || ev.message, ts: ev.ts });
    }
    if (ev.prompt_tokens) stats[agent].tokens.p += ev.prompt_tokens;
    if (ev.completion_tokens) stats[agent].tokens.c += ev.completion_tokens;
  });
  return { stats, recent: recent.slice(0, 30), errors: errors.slice(0, 10) };
}
function analyzePerformance() {
  const { stats } = analyzeActivity();
  return ROSTER.map((r) => ({
    ...r,
    ...stats[r.id],
    totalTokens: (stats[r.id]?.tokens.p || 0) + (stats[r.id]?.tokens.c || 0)
  })).sort((a, b) => b.runs - a.runs);
}
function EmployeeRow({ emp, width, compact }) {
  const statusEmoji = emp.status === "working" ? "\u{1F7E2}" : emp.status === "idle" ? "\u{1F4A4}" : "\u23F8";
  const statusText = emp.status === "working" ? "\u5DE5\u4F5C\u4E2D" : "\u7A7A\u95F2";
  const statusColor = emp.status === "working" ? C.success : C.muted;
  if (compact) {
    return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { color: emp.color }, emp.emoji), /* @__PURE__ */ React.createElement(Text, { color: emp.color }, padR(emp.name, 8)), /* @__PURE__ */ React.createElement(Text, { color: statusColor }, statusEmoji));
  }
  return /* @__PURE__ */ React.createElement(Box, { width, flexDirection: "column" }, /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: emp.color }, emp.emoji, " "), /* @__PURE__ */ React.createElement(Text, { color: emp.color, bold: true }, padR(emp.name, 8)), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, padR(emp.role, 8)), /* @__PURE__ */ React.createElement(Text, { color: statusColor }, statusEmoji, " ", statusText), emp.lastActive ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " (", timeAgo(emp.lastActive), ")") : null), emp.currentTask ? /* @__PURE__ */ React.createElement(Box, { paddingLeft: 3 }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "\u2514\u2500 "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, trunc(emp.currentTask, width - 16))) : null);
}
function ProjectCard({ project, width }) {
  const statusEmoji = project.status === "active" ? "\u{1F7E2}" : project.status === "paused" ? "\u23F8" : "\u{1F534}";
  const lastRun = project.last_run ? timeAgo(new Date(project.last_run * 1e3).toISOString()) : "\u4ECE\u672A";
  return /* @__PURE__ */ React.createElement(Box, { width, flexDirection: "column", borderStyle: "single", borderColor: C.border, paddingX: 1 }, /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: C.accent, bold: true }, statusEmoji, " ", project.id)), /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "\u4F18\u5148\u7EA7: ", project.priority, " | \u4E0A\u6B21: ", lastRun)), project.fail_streak > 0 ? /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: C.error }, "\u26A0\uFE0F \u8FDE\u7EED\u5931\u8D25 ", project.fail_streak, " \u6B21")) : null);
}
function ActivityItem({ item, width }) {
  const time = new Date(item.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const agent = getRoster(item.agent);
  if (item.type === "task") {
    return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, time, " "), /* @__PURE__ */ React.createElement(Text, { color: agent.color }, agent.emoji, agent.name, " "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, trunc(item.task, width - 30)));
  }
  if (item.type === "tool") {
    return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, time, " "), /* @__PURE__ */ React.createElement(Text, { color: agent.color }, agent.name, " "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, item.tool));
  }
  if (item.type === "error") {
    return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, time, " "), /* @__PURE__ */ React.createElement(Text, { color: C.error }, "\u2716 ", agent.name, ": ", trunc(item.error, width - 20)));
  }
  return null;
}
function PerfRow({ emp, width, rank }) {
  const tokens = emp.totalTokens || 0;
  const tokenStr = tokens > 1e3 ? `${(tokens / 1e3).toFixed(1)}k` : String(tokens);
  const errorRate = emp.runs > 0 ? Math.round(emp.errors / emp.runs * 100) : 0;
  const errorColor = errorRate > 20 ? C.error : errorRate > 10 ? C.warn : C.success;
  return /* @__PURE__ */ React.createElement(Box, { width }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, rank, ". "), /* @__PURE__ */ React.createElement(Text, { color: emp.color }, emp.emoji), /* @__PURE__ */ React.createElement(Text, { color: emp.color }, padR(emp.name, 8)), /* @__PURE__ */ React.createElement(Text, { color: C.text }, "\u8FD0\u884C:", padR(String(emp.runs), 4)), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, "\u5DE5\u5177:", padR(String(emp.tools), 4)), /* @__PURE__ */ React.createElement(Text, { color: errorColor }, "\u9519\u8BEF:", padR(String(emp.errors), 3), "(", errorRate, "%)"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "Token:", padR(tokenStr, 6)));
}
var COMMANDS = {
  "/help": { desc: "\u67E5\u770B\u6240\u6709\u547D\u4EE4", usage: "/help" },
  "/office": { desc: "\u67E5\u770B\u529E\u516C\u5BA4\uFF08\u5458\u5DE5\u72B6\u6001\uFF09", usage: "/office" },
  "/projects": { desc: "\u67E5\u770B\u9879\u76EE\u770B\u677F", usage: "/projects" },
  "/say": { desc: "\u8DDF\u5458\u5DE5\u8BF4\u8BDD", usage: "/say <\u5458\u5DE5\u540D> <\u6D88\u606F>" },
  "/msg": { desc: "\u53D1\u6D88\u606F\u7ED9\u5458\u5DE5", usage: "/msg <\u5458\u5DE5\u540D> <\u6D88\u606F>" },
  "/assign": { desc: "\u7ED9\u5458\u5DE5\u5E03\u7F6E\u4EFB\u52A1", usage: "/assign <\u5458\u5DE5\u540D> <\u4EFB\u52A1\u63CF\u8FF0>" },
  "/stats": { desc: "\u67E5\u770B\u7EE9\u6548\u7EDF\u8BA1", usage: "/stats" },
  "/alerts": { desc: "\u67E5\u770B\u544A\u8B66", usage: "/alerts" },
  "/search": { desc: "\u641C\u7D22", usage: "/search <\u5173\u952E\u8BCD>" },
  "/logs": { desc: "\u67E5\u770B\u65E5\u5FD7\u5BA1\u8BA1", usage: "/logs [\u884C\u6570]" },
  "/new": { desc: "\u521B\u5EFA\u65B0\u9879\u76EE", usage: "/new <\u540D\u79F0> <\u9700\u6C42>" },
  "/project": { desc: "\u9879\u76EE\u7BA1\u7406", usage: "/project list | /project focus <name>" },
  "/bill": { desc: "\u67E5\u770B\u8D26\u5355", usage: "/bill" },
  "/clear": { desc: "\u6E05\u7A7A\u6D3B\u52A8\u6D41", usage: "/clear" },
  "/status": { desc: "\u67E5\u770B\u516C\u53F8\u72B6\u6001", usage: "/status" },
  "/refresh": { desc: "\u5237\u65B0\u6570\u636E", usage: "/refresh" },
  "/exit": { desc: "\u9000\u51FA", usage: "/exit" }
};
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
  const [view, setView] = useState("office");
  const [outputLines, setOutputLines] = useState([]);
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
  const addOutput = useCallback((lines) => {
    setOutputLines((prev) => [...prev.slice(-49), ...lines]);
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
          addActivity({ type: "tool", tool: pt.tool, agent: pt.agent });
          pendingToolRef.current = null;
        }
        break;
      }
      case "run-done": {
        const pt = pendingToolRef.current;
        if (pt) {
          addActivity({ type: "tool", tool: pt.tool, agent: pt.agent });
          pendingToolRef.current = null;
        }
        const tk = ev.tokens || {};
        const body = (ev.output || ev.summary || "").trim() || "(\u65E0\u8F93\u51FA)";
        addActivity({ type: "assistant", agent: ev.agent, text: trunc(body.split("\n")[0], 60) });
        setModel(ev.model || model);
        setTok((t) => ({ p: t.p + (tk.prompt || 0), c: t.c + (tk.completion || 0) }));
        setBusy(false);
        setBusyAgent(null);
        setBusyTask("");
        break;
      }
      case "llm-error":
        addActivity({ type: "error", agent: ev.agent || "unknown", error: ev.error });
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
    addActivity({ type: "system", text: `CEO \u2192 ${agent.name}: ${trunc(task, 50)}` });
    const child = spawn(
      "opc-agent",
      ["run", task, "--dir", dir, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${HOME}/.local/bin:${process.env.PATH}` }, cwd: dir }
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
      addActivity({ type: "error", agent: "system", error: e.message });
    });
    child.on("close", () => {
      if (pendingToolRef.current) pendingToolRef.current = null;
      setBusy(false);
      setBusyAgent(null);
    });
  }, [initialDir, focusProj, handleEngineEvent, addActivity]);
  const createProject = useCallback((name, requirement) => {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });
    addOutput([`\u{1F3D7} \u65B0\u9879\u76EE\u300C${name}\u300D\u5F00\u5DE5`]);
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
      { env: { ...process.env, PATH: `${HOME}/.local/bin:${process.env.PATH}` }, cwd: dir }
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
        addOutput([`\u{1F389} \u300C${name}\u300D\u5165\u6C60\u6C38\u52A8\uFF01`]);
      } else {
        addOutput([`\u274C \u300C${name}\u300D\u672A\u5B8C\u6210 (code=${code})`]);
      }
    });
  }, [addOutput, handleEngineEvent]);
  const handleCommand = useCallback((input2) => {
    const trimmed = input2.trim();
    if (!trimmed) return;
    setHistory((prev) => [...prev.slice(-49), trimmed]);
    setHistoryIdx(-1);
    if (!trimmed.startsWith("/")) {
      runTask(trimmed);
      return;
    }
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ");
    switch (cmd) {
      case "/help": {
        const lines = ["\u53EF\u7528\u547D\u4EE4:"];
        Object.entries(COMMANDS).forEach(([c, info]) => {
          lines.push(`  ${c.padEnd(12)} ${info.desc}`);
        });
        addOutput(lines);
        break;
      }
      case "/office": {
        setView("office");
        addOutput(["\u5207\u6362\u5230\u529E\u516C\u5BA4\u89C6\u56FE"]);
        break;
      }
      case "/projects": {
        setView("projects");
        addOutput(["\u5207\u6362\u5230\u9879\u76EE\u770B\u677F"]);
        break;
      }
      case "/stats": {
        setView("stats");
        addOutput(["\u5207\u6362\u5230\u7EE9\u6548\u7EDF\u8BA1"]);
        break;
      }
      case "/logs": {
        setView("logs");
        const n = parseInt(args) || 20;
        const lines = [`\u6700\u8FD1 ${n} \u6761\u65E5\u5FD7:`];
        const all = readLines(ACTIVITY_FILE, n);
        all.reverse().forEach((ev) => {
          const time = new Date(ev.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
          const agent = getRoster(ev.agent);
          if (ev.type === "run-start") lines.push(`  ${time} ${agent.name} \u5F00\u59CB: ${trunc(ev.task, 50)}`);
          else if (ev.type === "tool") lines.push(`  ${time} ${agent.name} \u5DE5\u5177: ${ev.tool}`);
          else if (ev.type === "run-done") lines.push(`  ${time} ${agent.name} \u5B8C\u6210`);
          else if (ev.type === "run-error") lines.push(`  ${time} ${agent.name} \u9519\u8BEF: ${trunc(ev.error, 40)}`);
          else lines.push(`  ${time} ${agent.name} ${ev.type}`);
        });
        setOutputLines(lines);
        break;
      }
      case "/say":
      case "/msg": {
        const sp = args.indexOf(" ");
        if (sp < 1) {
          addOutput(["\u7528\u6CD5: /say <\u5458\u5DE5\u540D> <\u6D88\u606F>"]);
          break;
        }
        const agentName = args.slice(0, sp);
        const msg = args.slice(sp + 1);
        const agent = ROSTER.find((a) => a.name === agentName || a.id === agentName);
        if (!agent) {
          addOutput([`\u627E\u4E0D\u5230\u5458\u5DE5: ${agentName}`]);
          break;
        }
        runTask(msg, agent.id);
        break;
      }
      case "/assign": {
        const sp = args.indexOf(" ");
        if (sp < 1) {
          addOutput(["\u7528\u6CD5: /assign <\u5458\u5DE5\u540D> <\u4EFB\u52A1\u63CF\u8FF0>"]);
          break;
        }
        const agentName = args.slice(0, sp);
        const task = args.slice(sp + 1);
        const agent = ROSTER.find((a) => a.name === agentName || a.id === agentName);
        if (!agent) {
          addOutput([`\u627E\u4E0D\u5230\u5458\u5DE5: ${agentName}`]);
          break;
        }
        runTask(task, agent.id);
        break;
      }
      case "/project": {
        const [sub, ...rest] = args.split(/\s+/);
        if (sub === "list" || !sub) {
          const st2 = companyState();
          if (!st2.pool.length) {
            addOutput(["\u9879\u76EE\u6C60\u4E3A\u7A7A"]);
            break;
          }
          const lines = ["\u9879\u76EE\u6C60:"];
          st2.pool.forEach((p) => {
            const lastRun = p.last_run ? timeAgo(new Date(p.last_run * 1e3).toISOString()) : "\u4ECE\u672A";
            lines.push(`  ${p.status === "active" ? "\u{1F7E2}" : "\u23F8"} ${p.id.padEnd(20)} \u4E0A\u6B21: ${lastRun}`);
          });
          addOutput(lines);
        } else if (sub === "focus") {
          const name = rest[0];
          if (!name) {
            setFocusProj(null);
            addOutput(["\u5DF2\u53D6\u6D88\u805A\u7126"]);
            break;
          }
          const d = path.join(PROJECTS, name);
          if (fs.existsSync(d)) {
            setFocusProj(name);
            addOutput([`\u805A\u7126: ${name}`]);
          } else {
            addOutput([`\u9879\u76EE\u4E0D\u5B58\u5728: ${name}`]);
          }
        }
        break;
      }
      case "/new": {
        const sp = args.indexOf(" ");
        if (sp < 1) {
          addOutput(["\u7528\u6CD5: /new <name> <\u9700\u6C42>"]);
          break;
        }
        createProject(args.slice(0, sp), args.slice(sp + 1));
        break;
      }
      case "/bill": {
        const { stats: stats2 } = analyzeActivity();
        let totalP = 0, totalC = 0;
        Object.values(stats2).forEach((s) => {
          totalP += s.tokens.p;
          totalC += s.tokens.c;
        });
        totalP += tok.p;
        totalC += tok.c;
        addOutput([
          "\u{1F4B0} \u8D26\u5355:",
          `  \u672C\u6B21\u4F1A\u8BDD: \u2191${tok.p} \u2193${tok.c}`,
          `  \u5386\u53F2\u7D2F\u8BA1: \u2191${totalP} \u2193${totalC}`,
          `  \u603B\u8BA1: ${totalP + totalC} tokens`
        ]);
        break;
      }
      case "/search": {
        if (!args) {
          addOutput(["\u7528\u6CD5: /search <\u5173\u952E\u8BCD>"]);
          break;
        }
        const kw = args.toLowerCase();
        const lines = [`\u641C\u7D22 "${args}" \u7ED3\u679C:`];
        const { recent: recent2 } = analyzeActivity();
        const matches = recent2.filter(
          (e) => e.task && e.task.toLowerCase().includes(kw) || e.tool && e.tool.toLowerCase().includes(kw) || e.error && e.error.toLowerCase().includes(kw)
        );
        if (matches.length === 0) {
          lines.push("  (\u65E0\u5339\u914D\u7ED3\u679C)");
        } else {
          matches.slice(0, 10).forEach((e) => {
            const agent = getRoster(e.agent);
            lines.push(`  ${agent.emoji}${agent.name}: ${e.task || e.tool || e.error}`);
          });
        }
        addOutput(lines);
        break;
      }
      case "/clear": {
        setActivities([]);
        setOutputLines([]);
        addOutput(["\u5DF2\u6E05\u7A7A"]);
        break;
      }
      case "/refresh": {
        setTick((x) => x + 1);
        addOutput(["\u5DF2\u5237\u65B0\u6570\u636E"]);
        break;
      }
      case "/status": {
        const st2 = companyState();
        const { stats: stats2 } = analyzeActivity();
        let totalP = 0, totalC = 0, totalRuns = 0, totalErrors = 0;
        Object.values(stats2).forEach((s) => {
          totalP += s.tokens.p;
          totalC += s.tokens.c;
          totalRuns += s.runs;
          totalErrors += s.errors;
        });
        addOutput([
          "\u{1F4CA} \u516C\u53F8\u72B6\u6001:",
          `  \u5F15\u64CE: ${st2.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62"}`,
          `  \u9879\u76EE: ${st2.active.length}/${st2.pool.length} \u6D3B\u8DC3`,
          `  \u5458\u5DE5: ${ROSTER.length}`,
          `  \u603B\u8FD0\u884C: ${totalRuns} \u6B21`,
          `  \u603B\u9519\u8BEF: ${totalErrors} \u6B21`,
          `  \u603BToken: \u2191${totalP + tok.p} \u2193${totalC + tok.c}`
        ]);
        break;
      }
      case "/exit": {
        exit();
        break;
      }
      default: {
        addOutput([`\u672A\u77E5\u547D\u4EE4: ${cmd}\uFF0C\u8F93\u5165 /help \u67E5\u770B\u5E2E\u52A9`]);
      }
    }
  }, [addOutput, runTask, createProject, tok, exit]);
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
        else if (matches.length > 1) addOutput(["\u8865\u5168: " + matches.join("  ")]);
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
  const W = process.stdout.columns || 120;
  const H = process.stdout.rows || 40;
  const breath = tick % 2 === 0 ? "\u25CF" : "\u25CB";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const engText = busy ? "\u5DE5\u4F5C\u4E2D" : st.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62";
  const { stats, recent, errors } = useMemo(() => analyzeActivity(), [tick]);
  const perfData = useMemo(() => analyzePerformance(), [tick]);
  const employeeStatus = ROSTER.map((r) => ({
    ...r,
    status: busy && busyAgent === r.id ? "working" : "idle",
    currentTask: busy && busyAgent === r.id ? busyTask : stats[r.id]?.recentTasks?.[0] || null,
    lastActive: stats[r.id]?.lastActive,
    runs: stats[r.id]?.runs || 0,
    errors: stats[r.id]?.errors || 0
  }));
  const HEADER_H = 3;
  const INPUT_H = 3;
  const FOOTER_H = 1;
  const CONTENT_H = H - HEADER_H - INPUT_H - FOOTER_H;
  const renderContent = () => {
    switch (view) {
      case "office":
        return /* @__PURE__ */ React.createElement(Box, { flexDirection: "row", height: CONTENT_H }, /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: Math.floor(W * 0.4), paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u529E\u516C\u5BA4 \u2500\u2510"), employeeStatus.map((a) => /* @__PURE__ */ React.createElement(EmployeeRow, { key: a.id, emp: a, width: Math.floor(W * 0.4) - 2 }))), /* @__PURE__ */ React.createElement(Box, { width: 1 }, /* @__PURE__ */ React.createElement(Text, { color: C.border }, "\u2502".repeat(CONTENT_H))), /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: W - Math.floor(W * 0.4) - 1, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u5B9E\u65F6\u52A8\u6001 \u2500\u2510"), recent.length === 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u6682\u65E0\u6D3B\u52A8") : recent.slice(0, CONTENT_H - 2).map((item, i) => /* @__PURE__ */ React.createElement(ActivityItem, { key: i, item, width: W - Math.floor(W * 0.4) - 4 }))));
      case "projects":
        return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", height: CONTENT_H, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u9879\u76EE\u770B\u677F \u2500\u2510"), /* @__PURE__ */ React.createElement(Box, { flexDirection: "row", flexWrap: "wrap" }, st.pool.length === 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u9879\u76EE\u6C60\u4E3A\u7A7A") : st.pool.map((p) => /* @__PURE__ */ React.createElement(ProjectCard, { key: p.id, project: p, width: Math.floor(W / 3) - 2 }))), focusProj ? /* @__PURE__ */ React.createElement(Box, { marginTop: 1 }, /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "\u{1F3AF} \u5F53\u524D\u805A\u7126: ", focusProj)) : null);
      case "stats":
        return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", height: CONTENT_H, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u7EE9\u6548\u7EDF\u8BA1 \u2500\u2510"), /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, perfData.map((emp, i) => /* @__PURE__ */ React.createElement(PerfRow, { key: emp.id, emp, width: W - 4, rank: i + 1 }))));
      case "logs":
        return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", height: CONTENT_H, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u65E5\u5FD7\u5BA1\u8BA1 \u2500\u2510"), outputLines.length === 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u8F93\u5165 /logs [\u884C\u6570] \u67E5\u770B\u65E5\u5FD7") : outputLines.map((line, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: C.text }, line)));
      default:
        return null;
    }
  };
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
    /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u{1F3E2} OPC \u6C38\u52A8\u516C\u53F8"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: engColor }, breath, " ", engText), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, "\u{1F4CA} ", st.active.length, "/", st.pool.length, " \u9879\u76EE"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, "\u{1F465} ", ROSTER.length, " \u5458\u5DE5"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "\u{1F4B0} \u2191", tok.p, " \u2193", tok.c), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, trunc(model, 20)), focusProj ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " \u2502 "), /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "\u{1F3AF} ", focusProj)) : null),
    /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u89C6\u56FE: ", view === "office" ? "\u529E\u516C\u5BA4" : view === "projects" ? "\u9879\u76EE\u770B\u677F" : view === "stats" ? "\u7EE9\u6548\u7EDF\u8BA1" : "\u65E5\u5FD7\u5BA1\u8BA1", " | /help \u67E5\u770B\u6240\u6709\u547D\u4EE4")
  ), renderContent(), outputLines.length > 0 && view !== "logs" ? /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", height: Math.min(8, outputLines.length + 2), paddingX: 1, borderStyle: "single", borderColor: C.dim }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.accent }, "\u250C\u2500 \u8F93\u51FA \u2500\u2510"), outputLines.slice(-6).map((line, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: C.text }, line))) : null, /* @__PURE__ */ React.createElement(
    Box,
    {
      borderStyle: { topLeft: "\u250C", top: "\u2500", topRight: "\u2510", left: "\u2502", right: "\u2502", bottomLeft: "\u2514", bottom: "\u2500", bottomRight: "\u2518" },
      borderColor: busy ? C.warn : C.border,
      width: W,
      height: INPUT_H,
      flexDirection: "column",
      paddingX: 1
    },
    /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: C.purple, bold: true }, "\u{1F451} CEO "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "> "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, input), !busy ? /* @__PURE__ */ React.createElement(Text, { color: C.accent }, "\u258C") : /* @__PURE__ */ React.createElement(Text, { color: C.warn }, " \u23F3 ", busyAgent ? getRoster(busyAgent).name : "")),
    /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  Enter\u53D1\u9001 | Tab\u8865\u5168 | \u2191\u2193\u5386\u53F2 | /help\u5E2E\u52A9")
  ));
}
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter((p) => p.status === "active"), running: !!eng.running };
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
var idx = process.argv.indexOf("--dir");
var dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) {
  console.error("\u76EE\u5F55\u4E0D\u5B58\u5728:", dirArg);
  process.exit(1);
}
render(/* @__PURE__ */ React.createElement(App, { initialDir: dirArg }), { patchConsole: false });
