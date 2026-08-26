#!/usr/bin/env node
// opc — OPC 永动公司 · 对话驾驶台 (Ink/React)
// 定位：不是通用聊天框，是公司的指挥入口。打开即见：引擎/项目池/员工。
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { spawn, execFileSync } from "node:child_process";
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

// 路由到 opencode.jsonc 里的真实员工 ID
function route(input) {
  const low = input.toLowerCase();
  if (/测试|test/.test(low)) return "tester";
  if (/架构/.test(low)) return "architect";
  if (/安全|漏洞|security/.test(low)) return "security-auditor";
  if (/文档|readme|readme/.test(low)) return "docs-writer";
  if (/营销|推广|marketing|涨星|star/.test(low)) return "marketing-growth";
  if (/发布|上线|push/.test(low)) return "github-agent";
  if (/部署|运维|deploy/.test(low)) return "devops-release";
  if (/规划|需求|prd/.test(low)) return "product-manager";
  if (/法务|许可|license|合规/.test(low)) return "legal-compliance";
  if (/数据|统计|分析/.test(low)) return "analyst";
  return "build"; // COO 兜底
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

  const info = (text) => ({ id: nid(), type: "info", text });

  // 共享事件处理器：主任务与 /new 构建共用同一渲染管道
  let pendingToolRef = null;
  const flushPending = () => {
    if (pendingToolRef) {
      push({ ...pendingToolRef, hasResult: true, ok: false, output: "(无结果)" });
      pendingToolRef = null; setLive(null);
    }
  };
  const handleEngineEvent = (ev) => {
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model);
        setTok(t => t + (ev.prompt_tokens||0) + (ev.completion_tokens||0));
        break;
      case "tool":
        flushPending();
        pendingToolRef = { id: nid(), type: "tool", tool: ev.tool, args: ev.args };
        setLive(pendingToolRef);
        break;
      case "result": {
        if (pendingToolRef) {
          const t = pendingToolRef; pendingToolRef = null;
          push({ ...t, hasResult: true, ok: ev.status === "success", output: ev.output });
          setLive(null);
        } else {
          push({ id: nid(), type: "result", ok: ev.status === "success",
                 output: (ev.output||"").split("\n")[0] });
        }
        break;
      }
      case "run-done": {
        flushPending();
        const body = (ev.output || ev.summary || "").trim() || "(无输出)";
        const mdl = ev.model || model;
        const tk = ev.tokens || { prompt: 0, completion: 0, total: ev.total_tokens || 0 };
        setModel(mdl);
        push({ id: nid(), type: "assistant", body,
               meta: `${mdl} · ↑${tk.prompt} ↓${tk.completion} tok · ${ev.duration||0}ms` });
        setTok(t => t + (tk.total||0));
        break;
      }
      case "llm-error":
        flushPending();
        push({ id: nid(), type: "error", text: "模型错误: " + ev.error });
        break;
      default:
        break;
    }
  };

  // 启动横幅：一眼看到公司状态
function readEvents(limit) {
  try {
    const f = path.join(COMPANY, "activity.jsonl");
    const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function cmdPool() {
  const st = companyState();
  if (!st.pool.length) return push({ id: nid(), type: "info", text: "项目池为空 —— /new <name> <需求> 创建" });
  push({ id: nid(), type: "info", text:
    st.pool.map(p => `${p.id} [${p.status==="active"?"永动":"暂停"}] 连败${p.fail_streak||0}${p.escalate?"·强模型":""} 每${p.interval_min}分`).join("\n") });
}

function cmdBill() {
  const evts = readEvents(5000);
  const byModel = {};
  for (const e of evts) {
    if (e.type !== "llm") continue;
    const keyName = e.model || "(未知模型)";
    const m = byModel[keyName] ||= { model: keyName, calls: 0, p: 0, c: 0 };
    m.calls++; m.p += e.prompt_tokens||0; m.c += e.completion_tokens||0;
  }
  const rows = Object.values(byModel).sort((a,b)=>b.calls-a.calls)
    .map(m => `  ${m.model}: ${m.calls} 次 · ↑${m.p} ↓${m.c} tok`);
  push({ id: nid(), type: "info", text: rows.join("\n") || "本会话暂无模型调用记录（审计文件为全量历史）" });
}

function cmdHistory(pid) {
  const evts = readEvents(3000).filter(e =>
    ["run-start","run-done","iteration-start","iteration-done","iteration-failed"].includes(e.type)
    && (!pid || e.project === pid));
  const seen = new Set(); const out = [];
  for (const e of evts.reverse()) {
    const key = e.ts + e.type + e.project;
    if (seen.has(key)) continue; seen.add(key);
    out.push(`${e.ts.slice(11,19)} [${e.project||"-"}] ${e.type}${e.summary?": "+trunc(e.summary,50):e.output?": "+trunc(e.output,50):""}`);
    if (out.length >= 20) break;
  }
  push({ id: nid(), type: "info", text: out.join("\n") || "暂无迭代记录" });
}

function cmdLog(n) {
  const evts = readEvents(n);
  push({ id: nid(), type: "info",
    text: evts.map(e => `${e.ts.slice(11,19)} ${String(e.agent).slice(0,10)} ${e.type}${e.tool?" "+e.tool:""}`).join("\n") || "无事件" });
}

function cmdEngine(action) {
  const valid = { start: true, stop: true };
  if (!valid[action]) return push({ id: nid(), type: "error", text: "用法: /engine start|stop" });
  try {
    execFileSync(path.join(os.homedir(), ".local/bin/opc-engine"), [action], { timeout: 15000 });
    push({ id: nid(), type: "info", text: `引擎已 ${action === "start" ? "启动 ▶" : "停止 ⏹"}` });
  } catch (e) { push({ id: nid(), type: "error", text: "操作失败: " + e.message }); }
}

function poolWrite(mutator) {
  const pf = path.join(COMPANY, "pool.json");
  const pool = readJSON(pf, []);
  mutator(pool);
  fs.writeFileSync(pf, JSON.stringify(pool, null, 1));
}

function poolOp(op, id) {
  if (!id) return push({ id: nid(), type: "error", text: `用法: /${op} <项目名>` });
  poolWrite(pool => {
    for (const p of pool) if (p.id === id) {
      if (op === "pause") p.status = "paused";
      if (op === "resume") p.status = "active";
      if (op === "kill") p._del = true;
    }
    return pool.filter(p => !p._del);
  });
  push({ id: nid(), type: "info", text: `${id} → ${op}` });
}

function poolBoost(id) {
  poolWrite(pool => { for (const p of pool) if (p.id === id) { p.priority = 99; p.last_run = 0; } });
  push({ id: nid(), type: "info", text: `${id} 已插队，下个循环立即迭代` });
}

function setKey(sk) {
  if (!sk.startsWith("sk-")) return push({ id: nid(), type: "error", text: "key 应以 sk- 开头" });
  const kf = path.join(COMPANY, "keys.json");
  const keys = readJSON(kf, {}); keys.deepseek = sk.trim();
  fs.writeFileSync(kf, JSON.stringify(keys, null, 1));
  try { fs.chmodSync(kf, 0o600); } catch {}
  push({ id: nid(), type: "info", text: "DeepSeek key 已保存（疑难杂症自动升级用）" });
}

// /new 全流水线建设 → 完成后自动入池
function bootstrap(name, requirement) {
  name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const dir = path.join(PROJECTS, name);
  fs.mkdirSync(dir, { recursive: true });
  push({ id: nid(), type: "info", text: `🏗 「${name}」开工：开发→测试→安全→文档→发布全自动，完成后自动入池永动。进度看后续 tool 流水。` });
  const child = spawn("opc-agent",
    ["run",
     `FULL LIFECYCLE for new project '${name}'. Requirement: ${requirement}. Work in cwd. Phases: product-manager -> architect -> developer -> tester(tests pass) -> security-auditor -> legal(MIT Hanley-Liu) -> docs-writer(README.md+README.zh-CN.md) -> designer(docs/assets/banner.svg) -> community files -> git init & push to github.com/Hanley-Liu/${name} (GITHUB_TOKEN set, insteadOf rewrite active) -> devops-release(topics+description). Decide everything yourself, never ask.`,
     "--dir", dir, "--agent", "build", "--json"],
    { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` } });
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
    if (code === 0 && fs.existsSync(path.join(dir, "README.md"))) {
      poolWrite(pool => {
        if (!pool.some(p => p.id === name))
          pool.push({ id: name, status: "active", interval_min: 60, priority: 5, last_run: 0, fail_streak: 0 });
      });
      push({ id: nid(), type: "info", text: `🎉 「${name}」建成入池，开始永动！` });
    } else {
      push({ id: nid(), type: "error", text: `「${name}」构建退出(code=${code})。重试: /new ${name} ${requirement.slice(0,30)}…` });
    }
  });
}


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
    let buf = "";
    const child = spawn("opc-agent",
      ["run", task, "--dir", dir, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir });
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
      if (code !== 0) push({ id: nid(), type: "error",
        text: `任务退出 code=${code}（详见 activity.jsonl）` });
    });
  }, [initialDir, push, handleEngineEvent]);
  // ─────────── 键盘输入 ───────────
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { exit(); return; }
    if (key.return) {
      const t = input.trim();
      if (!t || busy) return;
      setInput("");
      if (t === "/exit" || t === "/quit") { exit(); return; }
      if (t === "/clear") { setEntries([]); return; }
      if (t === "/pool") { cmdPool(); return; }
      if (t === "/agents") {
        push(info("编排 build · 规划 product-manager · 开发 developer · 测试 tester · 安全 security-auditor · 文档 docs-writer · 营销 marketing-growth · 发布 github-agent/devops-release · 分析 analyst · 法务 legal-compliance · 人事 hr-manager"));
        return;
      }
      if (t === "/bill") { cmdBill(); return; }
      if (t.startsWith("/history")) { cmdHistory(t.split(" ")[1] || ""); return; }
      if (t.startsWith("/log"))     { cmdLog(parseInt(t.split(" ")[1]) || 15); return; }
      if (t.startsWith("/engine ")) { cmdEngine(t.split(" ")[1]); return; }
      if (t.startsWith("/pause "))  { poolOp("pause",  t.slice(7).trim()); return; }
      if (t.startsWith("/resume ")) { poolOp("resume", t.slice(8).trim()); return; }
      if (t.startsWith("/kill "))   { poolOp("kill",   t.slice(5).trim()); return; }
      if (t.startsWith("/go "))     { poolBoost(t.slice(3).trim()); return; }
      if (t.startsWith("/new ")) {
        const rest = t.slice(4).trim();
        const sp = rest.indexOf(" ");
        if (sp < 1) { push(info("用法: /new <name> <需求描述>")); return; }
        bootstrap(rest.slice(0, sp), rest.slice(sp + 1));
        return;
      }
      if (t.startsWith("/key ")) { setKey(t.slice(5).trim()); return; }
      // 普通任务（含未知斜杠提示）
      if (t.startsWith("/")) { push(info("未知命令。可用: /pool /agents /bill /history /log /engine /pause /resume /kill /go /new /key /clear /exit")); return; }
      submit(t);
    } else if (key.backspace || key.delete) {
      setInput(i => i.slice(0, -1));
    } else if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput(i => i + ch);
    }
  });

  // ─────────── 渲染 ───────────
  const st = companyState();
  const breath = tick % 2 === 0 ? "●" : "○";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;

  return (
    <Box flexDirection="column">
      {entries.slice(-12).map(e => <Box key={e.id}>{renderEntry(e)}</Box>)}

      {live ? (
        <Box paddingLeft={2}>
          <Text><Text color={C.tool} bold>{"⚡ "}</Text>
          <Text color={C.tool}>{live.tool} </Text>
          <Text color={C.muted}>{trunc(prettyParams(live.args), 72)}</Text></Text>
        </Box>
      ) : null}
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

// ─────────── 模块级辅助 ───────────
function routeAgent(input) {
  const low = input.toLowerCase();
  if (/测试|test/.test(low)) return "tester";
  if (/架构/.test(low)) return "architect";
  if (/审查|review/.test(low)) return "reviewer";
  return "build";
}

const idx = process.argv.indexOf("--dir");
const dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) { console.error("目录不存在:", dirArg); process.exit(1); }

render(<App initialDir={dirArg} />, { patchConsole: false });
