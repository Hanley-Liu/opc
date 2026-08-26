#!/usr/bin/env node
// opc — OPC 永动公司 · 全屏驾驶台
// 设计: 参考 gemini-cli 的 Ink 架构(chrome/对话框/提示条)，界面与交互为本产品定稿
import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const C = {
  primary: "#7aa2f7", secondary: "#bb9af7", text: "#c0caf5", muted: "#565f89",
  error: "#f7768e", success: "#9ece6a", warn: "#e0af68", tool: "#7dcfff",
  border: "#3d445c", hiBg: "#292e42", panelBg: "#16161e",
};
const COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
const PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
const MAX_RESULT = 10;

let idc = 0;
const nid = () => `e${++idc}`;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const trunc = (s, w) => { s = String(s ?? "").replace(/\n/g, " "); const r = [...s]; return r.length <= w ? s : r.slice(0, Math.max(0,w-1)).join("") + "…"; };

const AGENTS = [
  { id: "build", name: "Sisyphus", desc: "COO·编排兜底" },
  { id: "product-manager", name: "产品经理", desc: "需求PRD" },
  { id: "architect", name: "架构师", desc: "系统设计" },
  { id: "developer", name: "开发者", desc: "编码实现" },
  { id: "tester", name: "测试员", desc: "质量保证" },
  { id: "security-auditor", name: "安全审计", desc: "漏洞扫描" },
  { id: "docs-writer", name: "文档", desc: "README教程" },
  { id: "marketing-growth", name: "增长营销", desc: "涨星推广" },
  { id: "github-agent", name: "发布官", desc: "git推送" },
  { id: "devops-release", name: "发布工程", desc: "版本CI" },
  { id: "analyst", name: "分析师", desc: "数据洞察" },
  { id: "legal-compliance", name: "法务", desc: "License合规" },
];

function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter(p => p.status === "active"), running: !!eng.running };
}

function prettyParams(raw) {
  try {
    const m = JSON.parse(raw);
    if (m.command) return "$ " + m.command.replace(/\n/g, " ");
    if (m.path && m.old_string) return `${m.path} ✎`;
    if (m.path && m.content) return `${m.path} ✚${String(m.content).length}B`;
    if (m.path) return m.path;
    if (m.pattern) return "/" + m.pattern;
    if (m.agent) return `→ ${m.agent}`;
    if (m.query) return m.query;
    if (m.url) return m.url;
  } catch {}
  return raw;
}

function route(task) {
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

// ─────────── 条目渲染 ───────────
function Entry({ e, w }) {
  switch (e.type) {
    case "user":
      return (
        <Box>
          <Text color={C.secondary} bold>{"▌ "}</Text>
          <Text color={C.text}>{e.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column">
          {(e.body || "").split("\n").map((l, i) => (
            <Text key={i}><Text color={C.primary} bold>{"▌ "}</Text><Text color={C.text}>{l}</Text></Text>
          ))}
          <Text dimColor>{"  " + (e.meta || "")}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box paddingLeft={2}>
          <Text>
            <Text color={C.tool} bold>⚡ </Text>
            <Text color={C.tool}>{e.tool} </Text>
            <Text color={C.muted}>{trunc(prettyParams(e.args), Math.max(20, w - 16))}</Text>
          </Text>
        </Box>
      );
    case "result": {
      const color = e.ok ? C.success : C.error;
      const lines = String(e.output ?? "").replace(/\n+$/, "").split("\n").slice(0, MAX_RESULT);
      return (
        <Box flexDirection="column" paddingLeft={4}>
          {lines.map((l, i) => (
            <Text key={i} color={color}>{(i === 0 ? (e.ok ? "✓ " : "✖ ") : "  ") + l}</Text>
          ))}
        </Box>
      );
    }
    case "info":
      return <Box paddingLeft={2}><Text dimColor>{e.text}</Text></Box>;
    case "error":
      return <Box paddingLeft={2}><Text color={C.error}>✖ {e.text}</Text></Box>;
    default:
      return null;
  }
}

// ─────────── 对话框 ───────────
function Dialog({ title, items, sel, onSelect, onClose, width }) {
  return (
    <Box position="absolute" justifyContent="center" width={width} marginTop={2}>
      <Box flexDirection="column" borderStyle="round" borderColor={C.primary}
           paddingX={1} width={Math.min(72, width - 6)} backgroundColor={C.panelBg}>
        <Text bold color={C.primary}> {title}</Text>
        {items.map((it, i) => (
          <Text key={i} backgroundColor={i === sel ? C.hiBg : undefined}
                color={i === sel ? C.text : C.muted}>
            {" "}{i === sel ? "▶ " : "  "}{it.label}
          </Text>
        ))}
        <Text dimColor>{" ↑↓选择 · Enter确认 · Esc关闭"}</Text>
      </Box>
    </Box>
  );
}

// ─────────── App ───────────
function App({ initialDir }) {
  const { exit } = useApp();

  const [entries, setEntries] = useState([]);
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState(0);
  const [tick, setTick] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0); // 0=贴底
  const [dialog, setDialog] = useState(null); // {type:'proj'|'agent'|'bill'|'history', sel}
  const [focusProj, setFocusProj] = useState(null); // 聚焦项目（过滤+路由）
  const [notice, setNotice] = useState("");
  const pendingToolRef = useRef(null);

  useEffect(() => {
    // 进入备用屏幕：彻底根治画面堆叠
    process.stdout.write("\x1b[?1049h\x1b[H");
    const t = setInterval(() => setTick(x => x + 1), 1200);
    return () => {
      clearInterval(t);
      process.stdout.write("\x1b[?1049l");
    };
  }, []);

  const push = useCallback((e) => setEntries(prev => [...prev.slice(-199), e]), []);
  const notice_ = useCallback((text, isErr) => {
    push(isErr ? { id: nid(), type: "error", text } : { id: nid(), type: "info", text });
  }, [push]);

  const handleEngineEvent = useCallback((ev) => {
    setEntries(prev => [...prev.slice(-199), { ...ev, id: ev.run + ":" + ev.type + ":" + (ev.tool||"") + ":" + Math.random().toString(36).slice(2,6) }]);
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model); setTok(t => t + (ev.prompt_tokens||0) + (ev.completion_tokens||0));
        break;
      case "tool":
        pendingToolRef.current = ev; break;
      case "result":
        pendingToolRef.current = null; break;
      case "run-done": {
        pendingToolRef.current = null;
        const tk = ev.tokens || {};
        setTok(t => t + (tk.total || ev.total_tokens || 0));
        setBusy(false);
        break;
      }
      case "llm-error":
        setBusy(false); break;
    }
    setScrollOffset(0); // 新事件自动贴底
  }, [model]);

  const submitTask = useCallback((task, forceAgent, forceDir) => {
    let dir = forceDir || initialDir;
    if (!forceDir) {
      const st = companyState();
      for (const p of st.pool) if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const d = path.join(PROJECTS, p.id);
        if (fs.existsSync(d)) dir = d;
        break;
      }
    }
    if (focusProj) {
      const d = path.join(PROJECTS, focusProj);
      if (fs.existsSync(d)) dir = d;
    }
    const agentID = forceAgent || route(task);
    setBusy(true);
    push({ id: nid(), type: "user", text: task });
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
    child.on("error", e => { setBusy(false); notice_("启动失败: " + e.message, true); });
    child.on("close", code => {
      pendingToolRef.current = null; setBusy(false);
      if (code !== 0) notice_(`退出码 ${code}`, true);
    });
  }, [initialDir, focusProj, push, notice_, handleEngineEvent]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { exit(); return; }

    // 对话框开启时接管按键
    if (dialog) {
      const list = dialogList(dialog.type);
      if (key.upArrow) setDialog(d => ({ ...d, sel: Math.max(0, d.sel - 1) }));
      if (key.downArrow) setDialog(d => ({ ...d, sel: Math.min(list.length - 1, d.sel + 1) }));
      if (key.escape) setDialog(null);
      if (key.return) {
        const it = list[dialog.sel];
        if (it) it.onPick?.();
        if (dialog.type !== "bill" && dialog.type !== "history") setDialog(null);
      }
      return;
    }

    if (ch === "p" && !input && !busy) { setDialog({ type: "proj", sel: 0 }); return; }
    if (ch === "a" && !input && !busy) { setDialog({ type: "agent", sel: 0 }); return; }
    if (ch === "b" && !input) { setDialog({ type: "bill", sel: 0 }); return; }
    if (ch === "h" && !input) { setDialog({ type: "history", sel: 0 }); return; }

    if (key.pageUp) { setScrollOffset(o => o + 10); return; }
    if (key.pageDown) { setScrollOffset(o => Math.max(0, o - 10)); return; }

    if (key.return) {
      const t = input.trim();
      setInput("");
      if (!t) return;
      if (t.startsWith("/")) { runSlash(t); return; }
      submitTask(t);
      return;
    }
    if (key.backspace || key.delete) { setInput(i => i.slice(0, -1)); return; }
    if (key.escape) { setInput(""); setFocusProj(null); return; }
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput(i => i + ch);
    }
  });

  function dialogList(type) {
    if (type === "proj") {
      const st = companyState();
      const items = st.pool.map(p => ({
        label: `${p.status === "active" ? "🟢" : "⏸"} ${p.id} · 连败${p.fail_streak||0}`,
        onPick: () => { setFocusProj(p.id); notice_("已聚焦项目: " + p.id); },
      }));
      items.push({ label: "🌐 全部项目(不聚焦)", onPick: () => { setFocusProj(null); notice_("已取消聚焦"); } });
      return items;
    }
    if (type === "agent") {
      return AGENTS.map(a => ({
        label: `${a.name.padEnd(12)} ${a.desc}`,
        onPick: () => { submitTask(`向${a.name}报到并简述你的职责`, a.id); },
      }));
    }
    if (type === "bill") return [];
    if (type === "history") return [];
    return [];
  }

  function runSlash(t) {
    const [cmd, ...rest] = t.split(" ");
    const arg = rest.join(" ");
    switch (cmd) {
      case "/help": notice_("直接输入任务派活 · p 项目聚焦 · a 员工查看 · b 账单 · h 历史 · /new name 需求"); break;
      case "/clear": setEntries([]); break;
      case "/exit": exit(); break;
      case "/new": {
        const sp = arg.indexOf(" ");
        if (sp < 1) { notice_("用法: /new <name> <需求描述>", true); break; }
        bootstrapNew(arg.slice(0, sp), arg.slice(sp + 1));
        break;
      }
      case "/engine":
        try { execFileSync(path.join(os.homedir(), ".local/bin/opc-engine"), [arg || "status"], { timeout: 15000, encoding: "utf8" });
              notice_("引擎: " + (arg === "stop" ? "已停止 ⏹" : "操作完成")); }
        catch (e) { notice_("失败: " + e.message, true); }
        break;
      default: notice_("未知命令 " + cmd + "，试试 /help");
    }
  }

  function bootstrapNew(name, requirement) {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });
    notice_(`🏗 「${name}」开工，完成后自动入池永动`);
    setBusy(true);
    const child = spawn("opc-agent",
      ["run",
       `FULL LIFECYCLE for new project '${name}'. Requirement: ${requirement}. Work in cwd. Phases: product-manager -> architect -> developer -> tester(tests pass) -> security-auditor -> legal(MIT Hanley-Liu) -> docs-writer(README.md+README.zh-CN.md) -> designer(docs/assets/banner.svg) -> community files -> git init & push to github.com/Hanley-Liu/${name} (GITHUB_TOKEN set, insteadOf rewrite active) -> devops-release(topics+description). Decide everything yourself, never ask.`,
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
      if (code === 0 && fs.existsSync(path.join(dir, "README.md"))) {
        const pf = path.join(COMPANY, "pool.json");
        const pool = readJSON(pf, []);
        if (!pool.some(p => p.id === name))
          pool.push({ id: name, status: "active", interval_min: 60, priority: 5, last_run: 0, fail_streak: 0 });
        fs.writeFileSync(pf, JSON.stringify(pool, null, 1));
        notice_(`🎉 「${name}」建成入池永动！`);
      } else notice_(`「${name}」构建未完成(code=${code})`, true);
    });
  }

  // ─────────── 渲染 ───────────
  const st = companyState();
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;
  const breath = tick % 2 === 0 ? "●" : "○";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;

  // 可见窗口
  const visibleH = H - 6;
  const total = entries.length;
  const end = Math.max(0, total - scrollOffset);
  const start = Math.max(0, end - visibleH);
  const visible = entries.slice(start, end);

  const header = lipglosslessRow([
    ["⌬ OPC 永动公司", C.primary, true],
    [`引擎 ${st.running ? "● 运转中" : "○ 停止"}`, st.running ? C.success : C.muted],
    [`池 ${st.active.length}/${st.pool.length}`, C.text],
    [`员工 ${AGENTS.length}`, C.text],
    [focusProj ? `🎯 ${focusProj}` : "🌐 全部", C.warn],
    [trunc(model, 30), C.muted],
    [`↑↓${tok} tok`, C.muted],
  ], W);

  return (
    <Box flexDirection="column" height={H}>
      <Box borderStyle={{ topLeft: "╭", top: "─", topRight: "╮", left: "│", right: "│", bottomLeft: "╰", bottom: "─", bottomRight: "╯" }}
           borderColor={C.border} width={W}>
        <Text>{header}</Text>
      </Box>

      {/* 主区：事件流 */}
      <Box flexDirection="column" height={visibleH} paddingX={1}>
        {start > 0 ? <Text dimColor>  ↑↑ 更早 ({start} 条，PgUp 翻看)</Text> : null}
        {visible.map(e => <Entry key={e.id} e={e} w={W - 4} />)}
        {total === 0 ? <Text dimColor>  空空如也。输入任务派活，或按 h 看历史。</Text> : null}
        {scrollOffset > 0 ? null : busy ? (
          <Text color={C.warn}>  ⟳ 编排中…</Text>
        ) : null}
      </Box>

      {/* 输入 */}
      <Box borderStyle="round" borderColor={C.border} paddingX={1} width={W}>
        <Text color={C.primary} bold>{"❯ "}</Text>
        <Text color={C.text}>{input}</Text>
        {!busy ? <Text dimColor>_</Text> : null}
      </Box>
      {/* 提示条 */}
      <Text dimColor>
        {" Enter发送 · p项目 a员工 b账单 h历史 /new建项 · PgUp/PgDn翻页 · Ctrl+C 退出"}
      </Text>

      {dialog ? (
        dialog.type === "bill" ? <BillDialog onClose={() => setDialog(null)} width={W} /> :
        dialog.type === "history" ? <HistoryDialog onClose={() => setDialog(null)} width={W} /> :
        <Dialog title={dialog.type === "proj" ? "📦 选择聚焦项目" : "👤 选择员工"}
                items={dialogList(dialog.type)} sel={dialog.sel} width={W} />
      ) : null}
    </Box>
  );
}

function lipglosslessRow(segments, width) {
  // 简易分段着色行
  const out = segments.map(([text, color, bold]) => {
    const style = bold ? "\x1b[1m" : "";
    return `\x1b[38;2;${hexToRgb(color)}m${style}${text}\x1b[0m`;
  }).join(dimSep());
  return " " + truncAnsi(out, width - 2);
}
function dimSep() { return "\x1b[38;2;85;95;137m · \x1b[0m"; }
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n>>16)&255};${(n>>8)&255};${n&255}`;
}
function truncAnsi(s, w) {
  // ANSI 感知截断（简化：只算可见字符）
  let visible = 0, out = "", i = 0;
  while (i < s.length && visible < w) {
    if (s[i] === "\x1b") { while (i < s.length && !/[a-zA-Z]/.test(s[i])) i++; i++; continue; }
    out += s[i]; visible++; i++;
  }
  return out;
}

// ─────────── 账单/历史 对话框 ───────────
function BillDialog({ onClose, width }) {
  const events = readEventsLocal(6000);
  const byModel = {};
  for (const e of events) {
    if (e.type !== "llm") continue;
    const key = e.model || "(unknown)";
    const m = byModel[key] ||= { calls: 0, p: 0, c: 0 };
    m.calls++; m.p += e.prompt_tokens || 0; m.c += e.completion_tokens || 0;
  }
  const rows = Object.values(byModel).sort((a,b)=>b.calls-a.calls);
  const tot = rows.reduce((s,m)=>s+m.p+m.c, 0);
  return (
    <Box position="absolute" justifyContent="center" width={width} marginTop={2}>
      <Box flexDirection="column" borderStyle="round" borderColor={C.primary}
           paddingX={1} width={Math.min(76, width-6)} backgroundColor={C.panelBg}>
        <Text bold color={C.primary}> 📊 Token 账单</Text>
        {rows.map((m,i) => (
          <Text key={i} color={C.text}>  {trunc(m.model,34)}  {m.calls} 次  ↑{m.p.toLocaleString()} ↓{m.c.toLocaleString()}</Text>
        ))}
        {rows.length===0 ? <Text dimColor>  暂无调用</Text> :
          <Text dimColor>  合计 {tot.toLocaleString()} tokens</Text>}
        <Text dimColor>{" Esc 关闭"}</Text>
      </Box>
    </Box>
  );
}

function HistoryDialog({ onClose, width }) {
  const events = readEventsLocal(4000)
    .filter(e => ["run-done","iteration-done","iteration-failed","run-start"].includes(e.type))
    .slice(-18).reverse();
  return (
    <Box position="absolute" justifyContent="center" width={width} marginTop={2}>
      <Box flexDirection="column" borderStyle="round" borderColor={C.primary}
           paddingX={1} width={Math.min(80, width-6)} backgroundColor={C.panelBg}>
        <Text bold color={C.primary}> 📜 任务历史</Text>
        {events.map((e,i) => (
          <Text key={i} color={e.type.includes("fail") ? C.error : C.text}>
            {(e.ts||"").slice(5,19)} [{e.project||e.agent}] {e.type.replace("iteration-","")}{" "}
            {trunc(e.summary || e.output || "", 44)}
          </Text>
        ))}
        {events.length===0 ? <Text dimColor>  暂无</Text> : null}
        <Text dimColor>{" Esc 关闭"}</Text>
      </Box>
    </Box>
  );
}

function readEventsLocal(limit) {
  try {
    const f = path.join(os.homedir(), ".local/share/opencode/company/activity.jsonl");
    return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean)
      .slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ─────────── 启动 ───────────
const idx = process.argv.indexOf("--dir");
const dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) { console.error("目录不存在:", dirArg); process.exit(1); }

render(<App initialDir={dirArg} />, { patchConsole: false });
function buildStatus(busy, st, model, tok, breath, engColor) {
  const seg = (t,c) => `\x1b[38;2;${hexToRgb(c)}m${t}\x1b[0m`;
  return " " + seg(breath, engColor)
    + seg(` 引擎:${st.running?"运转中":"停止"} · 池:${st.active.length}/${st.pool.length}`, "#565f89")
    + seg(` · ${trunc(model,28)} · ↑↓${tok} tok · Enter 派活`, "#565f89");
}
