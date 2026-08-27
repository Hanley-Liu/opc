#!/usr/bin/env node
// OPC 永动公司 v5 — 完整 CEO 驾驶台
// 8大功能：实时员工状态、项目看板、员工通讯、绩效统计、告警提醒、快捷操作、搜索、日志审计
// 设计哲学：CEO 打开就是控制中心，一切数据实时可见

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ═══════════════════════════════════════════════════════
//  常量与工具
// ═══════════════════════════════════════════════════════
const C = {
  bg: "#1a1b26",        // 背景
  panel: "#1e2030",     // 面板
  border: "#3b4261",    // 边框
  text: "#c0caf5",      // 正文
  muted: "#565f89",     // 灰色
  dim: "#414868",       // 暗灰
  accent: "#7aa2f7",    // 蓝色强调
  success: "#9ece6a",   // 绿色（在线/完成）
  warn: "#e0af68",      // 黄色（工作中）
  error: "#f7768e",     // 红色（错误/离线）
  tool: "#7dcfff",      // 青色（工具）
  purple: "#bb9af7",    // 紫色（CEO）
  cyan: "#73daca",      // 青色
  orange: "#ff9e64",    // 橙色
  pink: "#ff007f",      // 粉色
};

const HOME = os.homedir();
const COMPANY = path.join(HOME, ".local/share/opencode/company");
const PROJECTS = path.join(HOME, ".local/share/opencode/projects");
const ACTIVITY_FILE = path.join(COMPANY, "activity.jsonl");

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const readLines = (f, n = 100) => {
  try {
    const data = fs.readFileSync(f, "utf8").trim().split("\n").slice(-n);
    return data.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const trunc = (s, w) => {
  s = String(s ?? "").replace(/\n/g, " ");
  const r = [...s];
  return r.length <= w ? s : r.slice(0, Math.max(1, w - 1)).join("") + "…";
};
const padR = (s, w) => { s = String(s ?? ""); return s + " ".repeat(Math.max(0, w - [...s].length)); };
const timeAgo = (ts) => {
  if (!ts) return "从未";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff/60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}小时前`;
  return `${Math.floor(diff/86400000)}天前`;
};

let idc = 0;
const nid = () => `e${++idc}`;

// ═══════════════════════════════════════════════════════
//  员工花名册
// ═══════════════════════════════════════════════════════
const ROSTER = [
  { id: "build",            name: "Sisyphus",  role: "COO·编排",  emoji: "🧭", color: "#bb9af7", skill: "编排调度" },
  { id: "product-manager",  name: "产品经理",   role: "需求PRD",   emoji: "📋", color: "#9ece6a", skill: "需求分析" },
  { id: "architect",        name: "架构师",     role: "系统设计",   emoji: "🏗",  color: "#7dcfff", skill: "架构设计" },
  { id: "developer",        name: "开发者",     role: "编码实现",   emoji: "💻", color: "#e0af68", skill: "代码实现" },
  { id: "tester",           name: "测试员",     role: "质量保证",   emoji: "🔍", color: "#ff9e64", skill: "测试验证" },
  { id: "security-auditor", name: "安全审计",   role: "漏洞扫描",   emoji: "🛡",  color: "#f7768e", skill: "安全审计" },
  { id: "docs-writer",      name: "文档工程师", role: "README",    emoji: "📝", color: "#73daca", skill: "文档编写" },
  { id: "marketing-growth", name: "增长营销",   role: "涨星推广",   emoji: "📢", color: "#ff007f", skill: "营销推广" },
  { id: "github-agent",     name: "发布官",     role: "git推送",   emoji: "🚀", color: "#c0caf5", skill: "代码发布" },
  { id: "devops-release",   name: "发布工程",   role: "版本CI",    emoji: "⚙️", color: "#2ac3de", skill: "CI/CD" },
  { id: "analyst",          name: "分析师",     role: "数据洞察",   emoji: "📊", color: "#b4f9f8", skill: "数据分析" },
  { id: "legal-compliance", name: "法务",       role: "合规",      emoji: "⚖️", color: "#a9b1d6", skill: "法律合规" },
];

const getRoster = (id) => ROSTER.find(r => r.id === id) || { id, name: id || "未知", role: "", emoji: "❓", color: C.muted, skill: "" };

// ═══════════════════════════════════════════════════════
//  数据分析
// ═══════════════════════════════════════════════════════
function analyzeActivity() {
  const lines = readLines(ACTIVITY_FILE, 500);
  const now = Date.now();
  const hour = 3600000;

  // 每个员工的统计
  const stats = {};
  ROSTER.forEach(r => {
    stats[r.id] = {
      runs: 0,
      tools: 0,
      errors: 0,
      tokens: { p: 0, c: 0 },
      lastActive: null,
      recentTasks: [],
    };
  });

  // 最近活动
  const recent = [];
  // 错误列表
  const errors = [];

  lines.forEach(ev => {
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
      errors.unshift({ agent, error: ev.error || ev.message || "未知错误", ts: ev.ts });
      recent.unshift({ type: "error", agent, error: ev.error || ev.message, ts: ev.ts });
    }
    if (ev.prompt_tokens) stats[agent].tokens.p += ev.prompt_tokens;
    if (ev.completion_tokens) stats[agent].tokens.c += ev.completion_tokens;
  });

  return { stats, recent: recent.slice(0, 30), errors: errors.slice(0, 10) };
}

function analyzePerformance() {
  const { stats } = analyzeActivity();
  return ROSTER.map(r => ({
    ...r,
    ...stats[r.id],
    totalTokens: (stats[r.id]?.tokens.p || 0) + (stats[r.id]?.tokens.c || 0),
  })).sort((a, b) => b.runs - a.runs);
}

// ═══════════════════════════════════════════════════════
//  进度条
// ═══════════════════════════════════════════════════════
function bar(pct, w = 12) {
  const f = Math.round((pct / 100) * w);
  return "█".repeat(f) + "░".repeat(w - f);
}

// ═══════════════════════════════════════════════════════
//  视图组件
// ═══════════════════════════════════════════════════════

// 员工状态行
function EmployeeRow({ emp, width, compact }) {
  const statusEmoji = emp.status === "working" ? "🟢" : emp.status === "idle" ? "💤" : "⏸";
  const statusText = emp.status === "working" ? "工作中" : "空闲";
  const statusColor = emp.status === "working" ? C.success : C.muted;

  if (compact) {
    return (
      <Box width={width}>
        <Text color={emp.color}>{emp.emoji}</Text>
        <Text color={emp.color}>{padR(emp.name, 8)}</Text>
        <Text color={statusColor}>{statusEmoji}</Text>
      </Box>
    );
  }

  return (
    <Box width={width} flexDirection="column">
      <Box>
        <Text color={emp.color}>{emp.emoji} </Text>
        <Text color={emp.color} bold>{padR(emp.name, 8)}</Text>
        <Text dimColor>{padR(emp.role, 8)}</Text>
        <Text color={statusColor}>{statusEmoji} {statusText}</Text>
        {emp.lastActive ? <Text dimColor> ({timeAgo(emp.lastActive)})</Text> : null}
      </Box>
      {emp.currentTask ? (
        <Box paddingLeft={3}>
          <Text dimColor>└─ </Text>
          <Text color={C.text}>{trunc(emp.currentTask, width - 16)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// 项目卡片
function ProjectCard({ project, width }) {
  const statusEmoji = project.status === "active" ? "🟢" : project.status === "paused" ? "⏸" : "🔴";
  const lastRun = project.last_run ? timeAgo(new Date(project.last_run * 1000).toISOString()) : "从未";

  return (
    <Box width={width} flexDirection="column" borderStyle="single" borderColor={C.border} paddingX={1}>
      <Box>
        <Text color={C.accent} bold>{statusEmoji} {project.id}</Text>
      </Box>
      <Box>
        <Text dimColor>优先级: {project.priority} | 上次: {lastRun}</Text>
      </Box>
      {project.fail_streak > 0 ? (
        <Box>
          <Text color={C.error}>⚠️ 连续失败 {project.fail_streak} 次</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// 活动条目
function ActivityItem({ item, width }) {
  const time = new Date(item.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const agent = getRoster(item.agent);

  if (item.type === "task") {
    return (
      <Box width={width}>
        <Text dimColor>{time} </Text>
        <Text color={agent.color}>{agent.emoji}{agent.name} </Text>
        <Text color={C.text}>{trunc(item.task, width - 30)}</Text>
      </Box>
    );
  }
  if (item.type === "tool") {
    return (
      <Box width={width}>
        <Text dimColor>{time} </Text>
        <Text color={agent.color}>{agent.name} </Text>
        <Text color={C.tool}>{item.tool}</Text>
      </Box>
    );
  }
  if (item.type === "error") {
    return (
      <Box width={width}>
        <Text dimColor>{time} </Text>
        <Text color={C.error}>✖ {agent.name}: {trunc(item.error, width - 20)}</Text>
      </Box>
    );
  }
  return null;
}

// 绩效行
function PerfRow({ emp, width, rank }) {
  const tokens = emp.totalTokens || 0;
  const tokenStr = tokens > 1000 ? `${(tokens/1000).toFixed(1)}k` : String(tokens);
  const errorRate = emp.runs > 0 ? Math.round((emp.errors / emp.runs) * 100) : 0;
  const errorColor = errorRate > 20 ? C.error : errorRate > 10 ? C.warn : C.success;

  return (
    <Box width={width}>
      <Text dimColor>{rank}. </Text>
      <Text color={emp.color}>{emp.emoji}</Text>
      <Text color={emp.color}>{padR(emp.name, 8)}</Text>
      <Text color={C.text}>运行:{padR(String(emp.runs), 4)}</Text>
      <Text color={C.tool}>工具:{padR(String(emp.tools), 4)}</Text>
      <Text color={errorColor}>错误:{padR(String(emp.errors), 3)}({errorRate}%)</Text>
      <Text color={C.muted}>Token:{padR(tokenStr, 6)}</Text>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════
//  命令系统
// ═══════════════════════════════════════════════════════
const COMMANDS = {
  "/help":     { desc: "查看所有命令",         usage: "/help" },
  "/office":   { desc: "查看办公室（员工状态）", usage: "/office" },
  "/projects": { desc: "查看项目看板",         usage: "/projects" },
  "/say":      { desc: "跟员工说话",           usage: "/say <员工名> <消息>" },
  "/msg":      { desc: "发消息给员工",         usage: "/msg <员工名> <消息>" },
  "/assign":   { desc: "给员工布置任务",       usage: "/assign <员工名> <任务描述>" },
  "/stats":    { desc: "查看绩效统计",         usage: "/stats" },
  "/alerts":   { desc: "查看告警",             usage: "/alerts" },
  "/search":   { desc: "搜索",                 usage: "/search <关键词>" },
  "/logs":     { desc: "查看日志审计",         usage: "/logs [行数]" },
  "/new":      { desc: "创建新项目",           usage: "/new <名称> <需求>" },
  "/project":  { desc: "项目管理",             usage: "/project list | /project focus <name>" },
  "/bill":     { desc: "查看账单",             usage: "/bill" },
  "/clear":    { desc: "清空活动流",           usage: "/clear" },
  "/status":   { desc: "查看公司状态",         usage: "/status" },
  "/refresh":  { desc: "刷新数据",             usage: "/refresh" },
  "/exit":     { desc: "退出",                 usage: "/exit" },
};

// ═══════════════════════════════════════════════════════
//  App
// ═══════════════════════════════════════════════════════
function App({ initialDir }) {
  const { exit } = useApp();
  const { stdout } = process;

  // 状态
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
  const [view, setView] = useState("office"); // office | projects | stats | logs
  const [outputLines, setOutputLines] = useState([]); // 命令输出
  const pendingToolRef = useRef(null);

  // 进入 alt buffer
  useEffect(() => {
    stdout.write("\x1b[?1049h\x1b[H");
    const t = setInterval(() => setTick(x => x + 1), 3000);
    return () => { clearInterval(t); stdout.write("\x1b[?1049l"); };
  }, []);

  // 添加活动
  const addActivity = useCallback((item) => {
    setActivities(prev => [...prev.slice(-99), { ...item, ts: Date.now() }]);
  }, []);

  // 添加输出
  const addOutput = useCallback((lines) => {
    setOutputLines(prev => [...prev.slice(-49), ...lines]);
  }, []);

  // 处理引擎事件
  const handleEngineEvent = useCallback((ev) => {
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model);
        setTok(t => ({ p: t.p + (ev.prompt_tokens || 0), c: t.c + (ev.completion_tokens || 0) }));
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
        const body = (ev.output || ev.summary || "").trim() || "(无输出)";
        addActivity({ type: "assistant", agent: ev.agent, text: trunc(body.split("\n")[0], 60) });
        setModel(ev.model || model);
        setTok(t => ({ p: t.p + (tk.prompt || 0), c: t.c + (tk.completion || 0) }));
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

  // 执行任务
  const runTask = useCallback((task, forceAgent) => {
    let dir = initialDir;
    if (focusProj) {
      const d = path.join(PROJECTS, focusProj);
      if (fs.existsSync(d)) dir = d;
    } else {
      const st = companyState();
      for (const p of st.pool) {
        if (task.toLowerCase().includes(p.id.toLowerCase())) {
          const d = path.join(PROJECTS, p.id);
          if (fs.existsSync(d)) { dir = d; break; }
        }
      }
    }

    const agentID = forceAgent || routeTask(task);
    const agent = getRoster(agentID);
    setBusy(true);
    setBusyAgent(agentID);
    setBusyTask(trunc(task, 40));

    addActivity({ type: "system", text: `CEO → ${agent.name}: ${trunc(task, 50)}` });

    const child = spawn("opc-agent",
      ["run", task, "--dir", dir, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${HOME}/.local/bin:${process.env.PATH}` }, cwd: dir });

    let buf = "";
    child.stdout.on("data", d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        handleEngineEvent(ev);
      }
    });

    child.on("error", e => { setBusy(false); setBusyAgent(null); addActivity({ type: "error", agent: "system", error: e.message }); });
    child.on("close", () => { if (pendingToolRef.current) pendingToolRef.current = null; setBusy(false); setBusyAgent(null); });
  }, [initialDir, focusProj, handleEngineEvent, addActivity]);

  // 创建新项目
  const createProject = useCallback((name, requirement) => {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });

    addOutput([`🏗 新项目「${name}」开工`]);
    setBusy(true);
    setBusyAgent("build");
    setBusyTask(`建设 ${name}`);

    const child = spawn("opc-agent",
      ["run",
        `FULL LIFECYCLE for new project '${name}'. Requirement: ${requirement}. Work in cwd. Phases: product-manager -> architect -> developer -> tester(tests pass) -> security-auditor -> legal(MIT Hanley-Liu) -> docs-writer(README.md+README.zh-CN.md) -> git init & push to github.com/Hanley-Liu/${name} (GITHUB_TOKEN set, insteadOf active) -> devops-release(topics+description). Decide everything yourself.`,
        "--dir", dir, "--agent", "build", "--json"],
      { env: { ...process.env, PATH: `${HOME}/.local/bin:${process.env.PATH}` }, cwd: dir });

    let buf = "";
    child.stdout.on("data", d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        handleEngineEvent(ev);
      }
    });

    child.on("close", code => {
      setBusy(false);
      setBusyAgent(null);
      if (code === 0 && fs.existsSync(path.join(dir, "README.md"))) {
        const pf = path.join(COMPANY, "pool.json");
        const pool = readJSON(pf, []);
        if (!pool.some(p => p.id === name))
          pool.push({ id: name, status: "active", interval_min: 60, priority: 5, last_run: 0, fail_streak: 0 });
        fs.writeFileSync(pf, JSON.stringify(pool, null, 1));
        addOutput([`🎉 「${name}」入池永动！`]);
      } else {
        addOutput([`❌ 「${name}」未完成 (code=${code})`]);
      }
    });
  }, [addOutput, handleEngineEvent]);

  // 处理命令
  const handleCommand = useCallback((input) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // 保存历史
    setHistory(prev => [...prev.slice(-49), trimmed]);
    setHistoryIdx(-1);

    // 任务模式（非命令）
    if (!trimmed.startsWith("/")) {
      runTask(trimmed);
      return;
    }

    // 解析命令
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ");

    switch (cmd) {
      case "/help": {
        const lines = ["可用命令:"];
        Object.entries(COMMANDS).forEach(([c, info]) => {
          lines.push(`  ${c.padEnd(12)} ${info.desc}`);
        });
        addOutput(lines);
        break;
      }
      case "/office": {
        setView("office");
        addOutput(["切换到办公室视图"]);
        break;
      }
      case "/projects": {
        setView("projects");
        addOutput(["切换到项目看板"]);
        break;
      }
      case "/stats": {
        setView("stats");
        addOutput(["切换到绩效统计"]);
        break;
      }
      case "/logs": {
        setView("logs");
        const n = parseInt(args) || 20;
        const lines = [`最近 ${n} 条日志:`];
        const all = readLines(ACTIVITY_FILE, n);
        all.reverse().forEach(ev => {
          const time = new Date(ev.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
          const agent = getRoster(ev.agent);
          if (ev.type === "run-start") lines.push(`  ${time} ${agent.name} 开始: ${trunc(ev.task, 50)}`);
          else if (ev.type === "tool") lines.push(`  ${time} ${agent.name} 工具: ${ev.tool}`);
          else if (ev.type === "run-done") lines.push(`  ${time} ${agent.name} 完成`);
          else if (ev.type === "run-error") lines.push(`  ${time} ${agent.name} 错误: ${trunc(ev.error, 40)}`);
          else lines.push(`  ${time} ${agent.name} ${ev.type}`);
        });
        setOutputLines(lines);
        break;
      }
      case "/say":
      case "/msg": {
        const sp = args.indexOf(" ");
        if (sp < 1) { addOutput(["用法: /say <员工名> <消息>"]); break; }
        const agentName = args.slice(0, sp);
        const msg = args.slice(sp + 1);
        const agent = ROSTER.find(a => a.name === agentName || a.id === agentName);
        if (!agent) { addOutput([`找不到员工: ${agentName}`]); break; }
        runTask(msg, agent.id);
        break;
      }
      case "/assign": {
        const sp = args.indexOf(" ");
        if (sp < 1) { addOutput(["用法: /assign <员工名> <任务描述>"]); break; }
        const agentName = args.slice(0, sp);
        const task = args.slice(sp + 1);
        const agent = ROSTER.find(a => a.name === agentName || a.id === agentName);
        if (!agent) { addOutput([`找不到员工: ${agentName}`]); break; }
        runTask(task, agent.id);
        break;
      }
      case "/project": {
        const [sub, ...rest] = args.split(/\s+/);
        if (sub === "list" || !sub) {
          const st = companyState();
          if (!st.pool.length) { addOutput(["项目池为空"]); break; }
          const lines = ["项目池:"];
          st.pool.forEach(p => {
            const lastRun = p.last_run ? timeAgo(new Date(p.last_run * 1000).toISOString()) : "从未";
            lines.push(`  ${p.status === "active" ? "🟢" : "⏸"} ${p.id.padEnd(20)} 上次: ${lastRun}`);
          });
          addOutput(lines);
        } else if (sub === "focus") {
          const name = rest[0];
          if (!name) { setFocusProj(null); addOutput(["已取消聚焦"]); break; }
          const d = path.join(PROJECTS, name);
          if (fs.existsSync(d)) { setFocusProj(name); addOutput([`聚焦: ${name}`]); }
          else { addOutput([`项目不存在: ${name}`]); }
        }
        break;
      }
      case "/new": {
        const sp = args.indexOf(" ");
        if (sp < 1) { addOutput(["用法: /new <name> <需求>"]); break; }
        createProject(args.slice(0, sp), args.slice(sp + 1));
        break;
      }
      case "/bill": {
        const { stats } = analyzeActivity();
        let totalP = 0, totalC = 0;
        Object.values(stats).forEach(s => { totalP += s.tokens.p; totalC += s.tokens.c; });
        totalP += tok.p; totalC += tok.c;
        addOutput([
          "💰 账单:",
          `  本次会话: ↑${tok.p} ↓${tok.c}`,
          `  历史累计: ↑${totalP} ↓${totalC}`,
          `  总计: ${totalP + totalC} tokens`,
        ]);
        break;
      }
      case "/search": {
        if (!args) { addOutput(["用法: /search <关键词>"]); break; }
        const kw = args.toLowerCase();
        const lines = [`搜索 "${args}" 结果:`];
        const { recent } = analyzeActivity();
        const matches = recent.filter(e =>
          (e.task && e.task.toLowerCase().includes(kw)) ||
          (e.tool && e.tool.toLowerCase().includes(kw)) ||
          (e.error && e.error.toLowerCase().includes(kw))
        );
        if (matches.length === 0) {
          lines.push("  (无匹配结果)");
        } else {
          matches.slice(0, 10).forEach(e => {
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
        addOutput(["已清空"]);
        break;
      }
      case "/refresh": {
        setTick(x => x + 1);
        addOutput(["已刷新数据"]);
        break;
      }
      case "/status": {
        const st = companyState();
        const { stats } = analyzeActivity();
        let totalP = 0, totalC = 0, totalRuns = 0, totalErrors = 0;
        Object.values(stats).forEach(s => { totalP += s.tokens.p; totalC += s.tokens.c; totalRuns += s.runs; totalErrors += s.errors; });
        addOutput([
          "📊 公司状态:",
          `  引擎: ${st.running ? "运转中" : "停止"}`,
          `  项目: ${st.active.length}/${st.pool.length} 活跃`,
          `  员工: ${ROSTER.length}`,
          `  总运行: ${totalRuns} 次`,
          `  总错误: ${totalErrors} 次`,
          `  总Token: ↑${totalP + tok.p} ↓${totalC + tok.c}`,
        ]);
        break;
      }
      case "/exit": {
        exit();
        break;
      }
      default: {
        addOutput([`未知命令: ${cmd}，输入 /help 查看帮助`]);
      }
    }
  }, [addOutput, runTask, createProject, tok, exit]);

  // ─── 键盘监听 ───
  const S = useRef({});
  S.current = { input, busy, history, historyIdx };

  const handlerRef = useRef(null);
  handlerRef.current = (ch, key) => {
    const s = S.current;

    if (key.ctrl && (ch === "c" || ch === "C")) { exit(); return; }

    if (key.return) {
      const t = s.input.trim();
      setInput("");
      setHistoryIdx(-1);
      if (!t) return;
      handleCommand(t);
      return;
    }

    if (key.escape) { setInput(""); setHistoryIdx(-1); return; }
    if (key.backspace) { setInput(i => i.slice(0, -1)); return; }

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
      if (newIdx >= s.history.length) { setHistoryIdx(-1); setInput(""); }
      else { setHistoryIdx(newIdx); setInput(s.history[newIdx] || ""); }
      return;
    }

    if (key.tab) {
      const t = s.input.trim();
      if (t.startsWith("/")) {
        const matches = Object.keys(COMMANDS).filter(c => c.startsWith(t));
        if (matches.length === 1) setInput(matches[0] + " ");
        else if (matches.length > 1) addOutput(["补全: " + matches.join("  ")]);
      }
      return;
    }

    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput(i => i + ch);
    }
  };

  const stableInput = useCallback((ch, key) => { handlerRef.current(ch, key); }, []);
  useInput(stableInput);

  // ─── 渲染 ───
  const st = companyState();
  const W = process.stdout.columns || 120;
  const H = process.stdout.rows || 40;

  const breath = tick % 2 === 0 ? "●" : "○";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const engText = busy ? "工作中" : st.running ? "运转中" : "停止";

  // 分析数据
  const { stats, recent, errors } = useMemo(() => analyzeActivity(), [tick]);
  const perfData = useMemo(() => analyzePerformance(), [tick]);

  // 员工状态
  const employeeStatus = ROSTER.map(r => ({
    ...r,
    status: busy && busyAgent === r.id ? "working" : "idle",
    currentTask: busy && busyAgent === r.id ? busyTask : (stats[r.id]?.recentTasks?.[0] || null),
    lastActive: stats[r.id]?.lastActive,
    runs: stats[r.id]?.runs || 0,
    errors: stats[r.id]?.errors || 0,
  }));

  // 布局
  const HEADER_H = 3;
  const INPUT_H = 3;
  const FOOTER_H = 1;
  const CONTENT_H = H - HEADER_H - INPUT_H - FOOTER_H;

  // 视图内容
  const renderContent = () => {
    switch (view) {
      case "office":
        return (
          <Box flexDirection="row" height={CONTENT_H}>
            {/* 左：员工列表 */}
            <Box flexDirection="column" width={Math.floor(W * 0.4)} paddingX={1}>
              <Text bold color={C.accent}>┌─ 办公室 ─┐</Text>
              {employeeStatus.map(a => (
                <EmployeeRow key={a.id} emp={a} width={Math.floor(W * 0.4) - 2} />
              ))}
            </Box>
            {/* 分隔 */}
            <Box width={1}><Text color={C.border}>{"│".repeat(CONTENT_H)}</Text></Box>
            {/* 右：活动流 */}
            <Box flexDirection="column" width={W - Math.floor(W * 0.4) - 1} paddingX={1}>
              <Text bold color={C.accent}>┌─ 实时动态 ─┐</Text>
              {recent.length === 0 ? (
                <Text dimColor>  暂无活动</Text>
              ) : (
                recent.slice(0, CONTENT_H - 2).map((item, i) => (
                  <ActivityItem key={i} item={item} width={W - Math.floor(W * 0.4) - 4} />
                ))
              )}
            </Box>
          </Box>
        );

      case "projects":
        return (
          <Box flexDirection="column" height={CONTENT_H} paddingX={1}>
            <Text bold color={C.accent}>┌─ 项目看板 ─┐</Text>
            <Box flexDirection="row" flexWrap="wrap">
              {st.pool.length === 0 ? (
                <Text dimColor>  项目池为空</Text>
              ) : (
                st.pool.map(p => (
                  <ProjectCard key={p.id} project={p} width={Math.floor(W / 3) - 2} />
                ))
              )}
            </Box>
            {focusProj ? (
              <Box marginTop={1}>
                <Text color={C.warn}>🎯 当前聚焦: {focusProj}</Text>
              </Box>
            ) : null}
          </Box>
        );

      case "stats":
        return (
          <Box flexDirection="column" height={CONTENT_H} paddingX={1}>
            <Text bold color={C.accent}>┌─ 绩效统计 ─┐</Text>
            <Box flexDirection="column">
              {perfData.map((emp, i) => (
                <PerfRow key={emp.id} emp={emp} width={W - 4} rank={i + 1} />
              ))}
            </Box>
          </Box>
        );

      case "logs":
        return (
          <Box flexDirection="column" height={CONTENT_H} paddingX={1}>
            <Text bold color={C.accent}>┌─ 日志审计 ─┐</Text>
            {outputLines.length === 0 ? (
              <Text dimColor>  输入 /logs [行数] 查看日志</Text>
            ) : (
              outputLines.map((line, i) => (
                <Text key={i} color={C.text}>{line}</Text>
              ))
            )}
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" width={W} height={H}>
      {/* ═══ 头部 ═══ */}
      <Box
        borderStyle={{ topLeft: "╔", top: "═", topRight: "╗", left: "║", right: "║", bottomLeft: "╚", bottom: "═", bottomRight: "╝" }}
        borderColor={C.border}
        width={W}
        height={HEADER_H}
        flexDirection="column"
        paddingX={1}
      >
        <Box>
          <Text bold color={C.accent}>🏢 OPC 永动公司</Text>
          <Text color={C.muted}> │ </Text>
          <Text color={engColor}>{breath} {engText}</Text>
          <Text color={C.muted}> │ </Text>
          <Text color={C.text}>📊 {st.active.length}/{st.pool.length} 项目</Text>
          <Text color={C.muted}> │ </Text>
          <Text color={C.text}>👥 {ROSTER.length} 员工</Text>
          <Text color={C.muted}> │ </Text>
          <Text color={C.warn}>💰 ↑{tok.p} ↓{tok.c}</Text>
          <Text color={C.muted}> │ </Text>
          <Text dimColor>{trunc(model, 20)}</Text>
          {focusProj ? <><Text color={C.muted}> │ </Text><Text color={C.warn}>🎯 {focusProj}</Text></> : null}
        </Box>
        <Text dimColor>  视图: {view === "office" ? "办公室" : view === "projects" ? "项目看板" : view === "stats" ? "绩效统计" : "日志审计"} | /help 查看所有命令</Text>
      </Box>

      {/* ═══ 内容区 ═══ */}
      {renderContent()}

      {/* ═══ 输出区（命令结果）═══ */}
      {outputLines.length > 0 && view !== "logs" ? (
        <Box flexDirection="column" height={Math.min(8, outputLines.length + 2)} paddingX={1} borderStyle="single" borderColor={C.dim}>
          <Text bold color={C.accent}>┌─ 输出 ─┐</Text>
          {outputLines.slice(-6).map((line, i) => (
            <Text key={i} color={C.text}>{line}</Text>
          ))}
        </Box>
      ) : null}

      {/* ═══ 输入栏 ═══ */}
      <Box
        borderStyle={{ topLeft: "┌", top: "─", topRight: "┐", left: "│", right: "│", bottomLeft: "└", bottom: "─", bottomRight: "┘" }}
        borderColor={busy ? C.warn : C.border}
        width={W}
        height={INPUT_H}
        flexDirection="column"
        paddingX={1}
      >
        <Box>
          <Text color={C.purple} bold>👑 CEO </Text>
          <Text color={C.muted}>{"> "}</Text>
          <Text color={C.text}>{input}</Text>
          {!busy ? <Text color={C.accent}>▌</Text> : <Text color={C.warn}> ⏳ {busyAgent ? getRoster(busyAgent).name : ""}</Text>}
        </Box>
        <Text dimColor>  Enter发送 | Tab补全 | ↑↓历史 | /help帮助</Text>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter(p => p.status === "active"), running: !!eng.running };
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

// ═══════════════════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════════════════
const idx = process.argv.indexOf("--dir");
const dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) { console.error("目录不存在:", dirArg); process.exit(1); }

render(<App initialDir={dirArg} />, { patchConsole: false });
