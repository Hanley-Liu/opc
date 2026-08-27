#!/usr/bin/env node
// OPC 永动公司 v4 — 虚拟办公室
// 设计哲学：CEO 走进办公室，看到员工在工作，下达指令
// 不是聊天，不是仪表盘，是「公司模拟器」

import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ═══════════════════════════════════════════════
//  常量与工具
// ═══════════════════════════════════════════════
const C = {
  // 办公室色调（Tokyo Night）
  floor: "#1a1b26",      // 地板/背景
  wall: "#24283b",       // 墙壁/面板
  desk: "#414868",       // 桌子/分隔线
  text: "#c0caf5",       // 正文
  muted: "#565f89",      // 灰色文字
  accent: "#7aa2f7",     // 强调色（蓝色）
  success: "#9ece6a",    // 在线/完成（绿色）
  warn: "#e0af68",       // 工作中（黄色）
  error: "#f7768e",      // 错误/离线（红色）
  tool: "#7dcfff",       // 工具调用（青色）
  ceo: "#bb9af7",        // CEO（紫色）
  border: "#3d445c",     // 边框
};

const COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
const PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const trunc = (s, w) => {
  s = String(s ?? "").replace(/\n/g, " ");
  const r = [...s];
  return r.length <= w ? s : r.slice(0, Math.max(1, w - 1)).join("") + "…";
};
const padR = (s, w) => { s = String(s ?? ""); return s + " ".repeat(Math.max(0, w - [...s].length)); };
const padL = (s, w) => { s = String(s ?? ""); return " ".repeat(Math.max(0, w - [...s].length)) + s; };

let idc = 0;
const nid = () => `e${++idc}`;

// ═══════════════════════════════════════════════
//  员工花名册
// ═══════════════════════════════════════════════
const ROSTER = [
  { id: "build",            name: "Sisyphus",  role: "COO·编排",  emoji: "🧭", color: "#bb9af7" },
  { id: "product-manager",  name: "产品经理",   role: "需求PRD",   emoji: "📋", color: "#9ece6a" },
  { id: "architect",        name: "架构师",     role: "系统设计",   emoji: "🏗",  color: "#7dcfff" },
  { id: "developer",        name: "开发者",     role: "编码实现",   emoji: "💻", color: "#e0af68" },
  { id: "tester",           name: "测试员",     role: "质量保证",   emoji: "🔍", color: "#ff9e64" },
  { id: "security-auditor", name: "安全审计",   role: "漏洞扫描",   emoji: "🛡",  color: "#f7768e" },
  { id: "docs-writer",      name: "文档工程师", role: "README",    emoji: "📝", color: "#73daca" },
  { id: "marketing-growth", name: "增长营销",   role: "涨星推广",   emoji: "📢", color: "#ff007f" },
  { id: "github-agent",     name: "发布官",     role: "git推送",   emoji: "🚀", color: "#c0caf5" },
  { id: "devops-release",   name: "发布工程",   role: "版本CI",    emoji: "⚙️", color: "#2ac3de" },
  { id: "analyst",          name: "分析师",     role: "数据洞察",   emoji: "📊", color: "#b4f9f8" },
  { id: "legal-compliance", name: "法务",       role: "合规",      emoji: "⚖️", color: "#a9b1d6" },
];

function getRoster(id) {
  return ROSTER.find(r => r.id === id) || { id, name: id || "未知", role: "", emoji: "❓", color: C.muted };
}

// ═══════════════════════════════════════════════
//  状态读取
// ═══════════════════════════════════════════════
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter(p => p.status === "active"), running: !!eng.running };
}

// ═══════════════════════════════════════════════
//  进度条
// ═══════════════════════════════════════════════
function progressBar(pct, w = 16) {
  const filled = Math.round((pct / 100) * w);
  return "█".repeat(filled) + "░".repeat(w - filled);
}

// ═══════════════════════════════════════════════
//  活动日志组件
// ═══════════════════════════════════════════════
function ActivityItem({ item, width }) {
  const time = new Date(item.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const agent = getRoster(item.agent);

  if (item.type === "system") {
    return (
      <Box width={width}>
        <Text dimColor>{time} </Text>
        <Text color={C.muted}>{trunc(item.text, width - 8)}</Text>
      </Box>
    );
  }

  if (item.type === "tool") {
    const mark = item.ok === true ? "✓" : item.ok === false ? "✖" : "⟳";
    const markColor = item.ok === true ? C.success : item.ok === false ? C.error : C.warn;
    return (
      <Box width={width}>
        <Text dimColor>{time} </Text>
        <Text color={agent.color}>{trunc(agent.name, 6)} </Text>
        <Text color={markColor} bold>{mark} </Text>
        <Text color={C.tool}>{item.tool} </Text>
        <Text dimColor>{trunc(item.summary || "", width - 30)}</Text>
      </Box>
    );
  }

  if (item.type === "assistant") {
    return (
      <Box width={width}>
        <Text dimColor>{time} </Text>
        <Text color={agent.color} bold>{agent.emoji} {trunc(agent.name, 6)} </Text>
        <Text color={C.text}>{trunc(item.text, width - 30)}</Text>
      </Box>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════
//  员工工位组件
// ═══════════════════════════════════════════════
function EmployeeDesk({ agent, status, task, progress, width }) {
  const statusEmoji = status === "working" ? "🟢" : status === "waiting" ? "⏸" : status === "done" ? "✅" : "💤";
  const statusText = status === "working" ? "工作中" : status === "waiting" ? "等待中" : status === "done" ? "已完成" : "空闲";
  const statusColor = status === "working" ? C.success : status === "waiting" ? C.muted : status === "done" ? C.accent : C.muted;

  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Box>
        <Text color={agent.color}>{agent.emoji} </Text>
        <Text color={agent.color} bold>{padR(agent.name, 8)}</Text>
        <Text dimColor>{padR(agent.role, 8)}</Text>
        <Text color={statusColor}>{statusEmoji} {statusText}</Text>
      </Box>
      {task ? (
        <Box paddingLeft={3}>
          <Text dimColor>└─ </Text>
          <Text color={C.text}>{trunc(task, width - 16)}</Text>
          {progress !== undefined ? (
            <Text color={C.accent}> {progressBar(progress, 8)} {progress}%</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

// ═══════════════════════════════════════════════
//  命令系统
// ═══════════════════════════════════════════════
const COMMANDS = {
  "/help": { desc: "查看所有命令", usage: "/help" },
  "/list": { desc: "列出所有员工", usage: "/list" },
  "/say": { desc: "跟员工说话", usage: "/say <员工名> <消息>" },
  "/project": { desc: "管理项目", usage: "/project list | /project focus <name>" },
  "/new": { desc: "创建新项目", usage: "/new <name> <需求>" },
  "/bill": { desc: "查看账单", usage: "/bill" },
  "/history": { desc: "查看历史", usage: "/history" },
  "/clear": { desc: "清空活动流", usage: "/clear" },
  "/status": { desc: "查看公司状态", usage: "/status" },
  "/exit": { desc: "退出", usage: "/exit" },
};

function parseCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { type: "task", text: trimmed };

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");

  if (!COMMANDS[cmd]) return { type: "error", text: `未知命令: ${cmd}，输入 /help 查看帮助` };

  return { type: "command", cmd, args };
}

// ═══════════════════════════════════════════════
//  任务路由
// ═══════════════════════════════════════════════
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

// ═══════════════════════════════════════════════
//  App
// ═══════════════════════════════════════════════
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
  const [history, setHistory] = useState([]); // 命令历史
  const [historyIdx, setHistoryIdx] = useState(-1);
  const pendingToolRef = useRef(null);

  // 进入 alt buffer
  useEffect(() => {
    stdout.write("\x1b[?1049h\x1b[H");
    const t = setInterval(() => setTick(x => x + 1), 3000); // 3秒刷新
    return () => { clearInterval(t); stdout.write("\x1b[?1049l"); };
  }, []);

  // 添加活动
  const addActivity = useCallback((item) => {
    setActivities(prev => [...prev.slice(-99), { ...item, ts: Date.now() }]);
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
          addActivity({ type: "tool", tool: pt.tool, agent: pt.agent, ok: ev.ok === true || ev.status === "success", summary: trunc(String(ev.output || "").split("\n")[0], 50) });
          pendingToolRef.current = null;
        }
        break;
      }
      case "run-done": {
        const pt = pendingToolRef.current;
        if (pt) {
          addActivity({ type: "tool", tool: pt.tool, agent: pt.agent, ok: false, summary: "(中断)" });
          pendingToolRef.current = null;
        }
        const tk = ev.tokens || {};
        const body = (ev.output || ev.summary || "").trim() || "(无输出)";
        addActivity({ type: "assistant", agent: ev.agent, text: trunc(body.split("\n")[0], 80) });
        setModel(ev.model || model);
        setTok(t => ({ p: t.p + (tk.prompt || 0), c: t.c + (tk.completion || 0) }));
        setBusy(false);
        setBusyAgent(null);
        setBusyTask("");
        break;
      }
      case "llm-error":
        addActivity({ type: "system", text: "模型错误: " + ev.error });
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

    addActivity({ type: "system", text: `CEO 指派 ${agent.name}: ${trunc(task, 50)}` });

    const child = spawn("opc-agent",
      ["run", task, "--dir", dir, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir });

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

    child.on("error", e => { setBusy(false); setBusyAgent(null); addActivity({ type: "system", text: "启动失败: " + e.message }); });
    child.on("close", () => {
      if (pendingToolRef.current) {
        pendingToolRef.current = null;
      }
      setBusy(false);
      setBusyAgent(null);
    });
  }, [initialDir, focusProj, handleEngineEvent, addActivity]);

  // 创建新项目
  const createProject = useCallback((name, requirement) => {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });

    addActivity({ type: "system", text: `新项目「${name}」开工` });
    setBusy(true);
    setBusyAgent("build");
    setBusyTask(`建设 ${name}`);

    const child = spawn("opc-agent",
      ["run",
        `FULL LIFECYCLE for new project '${name}'. Requirement: ${requirement}. Work in cwd. Phases: product-manager -> architect -> developer -> tester(tests pass) -> security-auditor -> legal(MIT Hanley-Liu) -> docs-writer(README.md+README.zh-CN.md) -> git init & push to github.com/Hanley-Liu/${name} (GITHUB_TOKEN set, insteadOf active) -> devops-release(topics+description). Decide everything yourself.`,
        "--dir", dir, "--agent", "build", "--json"],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir });

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
        addActivity({ type: "system", text: `🎉 「${name}」入池永动！` });
      } else {
        addActivity({ type: "system", text: `「${name}」未完成 (code=${code})` });
      }
    });
  }, [addActivity, handleEngineEvent]);

  // 处理命令
  const handleCommand = useCallback((input) => {
    const parsed = parseCommand(input);

    if (parsed.type === "error") {
      addActivity({ type: "system", text: parsed.text });
      return;
    }

    if (parsed.type === "task") {
      runTask(parsed.text);
      return;
    }

    // 命令处理
    switch (parsed.cmd) {
      case "/help": {
        const lines = Object.entries(COMMANDS).map(([cmd, info]) => `  ${cmd.padEnd(12)} ${info.desc}`);
        addActivity({ type: "system", text: "可用命令:\n" + lines.join("\n") });
        break;
      }
      case "/list": {
        const lines = ROSTER.map(a => `  ${a.emoji} ${a.name.padEnd(8)} ${a.role}`);
        addActivity({ type: "system", text: "员工列表:\n" + lines.join("\n") });
        break;
      }
      case "/say": {
        const sp = parsed.args.indexOf(" ");
        if (sp < 1) { addActivity({ type: "system", text: "用法: /say <员工名> <消息>" }); break; }
        const agentName = parsed.args.slice(0, sp);
        const msg = parsed.args.slice(sp + 1);
        const agent = ROSTER.find(a => a.name === agentName || a.id === agentName);
        if (!agent) { addActivity({ type: "system", text: `找不到员工: ${agentName}` }); break; }
        runTask(msg, agent.id);
        break;
      }
      case "/project": {
        const [sub, ...rest] = parsed.args.split(/\s+/);
        if (sub === "list" || !sub) {
          const st = companyState();
          if (!st.pool.length) { addActivity({ type: "system", text: "项目池为空" }); break; }
          const lines = st.pool.map(p => `  ${p.status === "active" ? "🟢" : "⏸"} ${p.id}`);
          addActivity({ type: "system", text: "项目池:\n" + lines.join("\n") });
        } else if (sub === "focus") {
          const name = rest[0];
          if (!name) { setFocusProj(null); addActivity({ type: "system", text: "已取消聚焦" }); break; }
          const d = path.join(PROJECTS, name);
          if (fs.existsSync(d)) { setFocusProj(name); addActivity({ type: "system", text: `聚焦: ${name}` }); }
          else { addActivity({ type: "system", text: `项目不存在: ${name}` }); }
        }
        break;
      }
      case "/new": {
        const sp = parsed.args.indexOf(" ");
        if (sp < 1) { addActivity({ type: "system", text: "用法: /new <name> <需求>" }); break; }
        createProject(parsed.args.slice(0, sp), parsed.args.slice(sp + 1));
        break;
      }
      case "/bill": {
        addActivity({ type: "system", text: `💰 累计 tokens: ↑${tok.p} ↓${tok.c}` });
        break;
      }
      case "/history": {
        const st = companyState();
        const lines = st.pool.map(p => {
          const lastRun = p.last_run ? new Date(p.last_run).toLocaleString("zh-CN") : "从未";
          return `  ${p.id.padEnd(20)} 最后运行: ${lastRun}`;
        });
        addActivity({ type: "system", text: "项目历史:\n" + lines.join("\n") });
        break;
      }
      case "/clear": {
        setActivities([]);
        break;
      }
      case "/status": {
        const st = companyState();
        addActivity({ type: "system", text: `引擎: ${st.running ? "运转中" : "停止"} | 活跃项目: ${st.active.length}/${st.pool.length} | 员工: ${ROSTER.length}` });
        break;
      }
      case "/exit": {
        exit();
        break;
      }
    }
  }, [addActivity, runTask, createProject, tok, exit]);

  // ─── 键盘监听（稳定引用）───
  const S = useRef({});
  S.current = { input, busy, history, historyIdx };

  const handlerRef = useRef(null);
  handlerRef.current = (ch, key) => {
    const s = S.current;

    // Ctrl+C — 退出
    if (key.ctrl && (ch === "c" || ch === "C")) { exit(); return; }

    // Enter — 提交
    if (key.return) {
      const t = s.input.trim();
      setInput("");
      setHistoryIdx(-1);
      if (!t) return;
      setHistory(prev => [...prev.slice(-49), t]);
      handleCommand(t);
      return;
    }

    // Escape — 清空输入
    if (key.escape) { setInput(""); setHistoryIdx(-1); return; }

    // Backspace
    if (key.backspace) { setInput(i => i.slice(0, -1)); return; }

    // 上下箭头 — 历史
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

    // Tab — 自动补全
    if (key.tab) {
      const t = s.input.trim();
      if (t.startsWith("/")) {
        const matches = Object.keys(COMMANDS).filter(c => c.startsWith(t));
        if (matches.length === 1) setInput(matches[0] + " ");
        else if (matches.length > 1) {
          addActivity({ type: "system", text: "补全: " + matches.join("  ") });
        }
      }
      return;
    }

    // 普通字符
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput(i => i + ch);
    }
  };

  const stableInput = useCallback((ch, key) => { handlerRef.current(ch, key); }, []);
  useInput(stableInput);

  // ─── 渲染 ───
  const st = companyState();
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;

  const breath = tick % 2 === 0 ? "●" : "○";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const engText = busy ? "工作中" : st.running ? "运转中" : "停止";

  // 办公室区域高度
  const HEADER_H = 3;
  const INPUT_H = 3;
  const ACTIVITY_H = Math.max(4, H - HEADER_H - INPUT_H - 12);
  const OFFICE_H = H - HEADER_H - ACTIVITY_H - INPUT_H - 1;

  // 当前忙碌的员工状态
  const employeeStatus = ROSTER.map(a => {
    if (busy && busyAgent === a.id) return { ...a, status: "working", task: busyTask, progress: undefined };
    return { ...a, status: "idle", task: null };
  });

  // 最近活动
  const recentActivities = activities.slice(-ACTIVITY_H);

  return (
    <Box flexDirection="column" width={W} height={H}>
      {/* ═══ 头部：公司状态 ═══ */}
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
          <Text color={C.muted}>{" │ "}</Text>
          <Text color={engColor}>{breath} 引擎: {engText}</Text>
          <Text color={C.muted}>{" │ "}</Text>
          <Text color={C.text}>📊 {st.active.length}/{st.pool.length} 项目</Text>
          <Text color={C.muted}>{" │ "}</Text>
          <Text color={C.text}>👥 {ROSTER.length} 员工</Text>
          <Text color={C.muted}>{" │ "}</Text>
          <Text color={C.warn}>💰 ↑{tok.p} ↓{tok.c}</Text>
          <Text color={C.muted}>{" │ "}</Text>
          <Text dimColor>{trunc(model, 24)}</Text>
          {focusProj ? <><Text color={C.muted}>{" │ "}</Text><Text color={C.warn}>🎯 {focusProj}</Text></> : null}
        </Box>
      </Box>

      {/* ═══ 主体：办公室 + 活动流 ═══ */}
      <Box flexDirection="row" height={OFFICE_H + ACTIVITY_H}>
        {/* 左：办公室（员工工位） */}
        <Box
          flexDirection="column"
          width={Math.floor(W * 0.45)}
          height={OFFICE_H + ACTIVITY_H}
          paddingX={1}
        >
          <Text bold color={C.accent}>┌─ 办公室 ─┐</Text>
          <Box flexDirection="column" marginTop={0}>
            {employeeStatus.map(a => (
              <EmployeeDesk
                key={a.id}
                agent={a}
                status={a.status}
                task={a.task}
                progress={a.progress}
                width={Math.floor(W * 0.45) - 2}
              />
            ))}
          </Box>
        </Box>

        {/* 分隔线 */}
        <Box width={1}>
          <Text color={C.border}>{"│".repeat(OFFICE_H + ACTIVITY_H)}</Text>
        </Box>

        {/* 右：活动流 */}
        <Box
          flexDirection="column"
          width={W - Math.floor(W * 0.45) - 1}
          height={OFFICE_H + ACTIVITY_H}
          paddingX={1}
        >
          <Text bold color={C.accent}>┌─ 实时动态 ─┐</Text>
          <Box flexDirection="column" marginTop={0}>
            {recentActivities.length === 0 ? (
              <Text dimColor>  暂无活动，等待 CEO 指令…</Text>
            ) : (
              recentActivities.map((item, i) => (
                <ActivityItem key={i} item={item} width={W - Math.floor(W * 0.45) - 4} />
              ))
            )}
          </Box>
        </Box>
      </Box>

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
          <Text color={C.ceo} bold>👑 CEO </Text>
          <Text color={C.muted}>{"> "}</Text>
          <Text color={C.text}>{input}</Text>
          {!busy ? <Text color={C.accent}>▌</Text> : <Text color={C.warn}> ⏳</Text>}
        </Box>
        <Text dimColor>{"  输入命令: /help 查看帮助 | /say <员工> <消息> | /project list | /new <名称> <需求>"}</Text>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════════
const idx = process.argv.indexOf("--dir");
const dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) { console.error("目录不存在:", dirArg); process.exit(1); }

render(<App initialDir={dirArg} />, { patchConsole: false });
