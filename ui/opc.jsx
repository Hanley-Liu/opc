#!/usr/bin/env node
// opc — OPC 永动公司驾驶台 v3
// 设计定稿：双栏布局（左对话 / 右公司侧栏）+ opencode 消息规范（说话人标签+折叠工具）
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
  border: "#3d445c", hiBg: "#292e42", panel: "#16161e",
};
const COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
const PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
const MAX_RESULT = 8;

let idc = 0;
const nid = () => `e${++idc}`;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const trunc = (s, w) => { s = String(s ?? "").replace(/\n/g, " "); const r = [...s]; return r.length <= w ? s : r.slice(0, Math.max(1, w - 1)).join("") + "…"; };

const AGENTS = [
  ["build", "Sisyphus", "COO·编排"],
  ["product-manager", "产品经理", "需求PRD"],
  ["architect", "架构师", "系统设计"],
  ["developer", "开发者", "编码实现"],
  ["tester", "测试员", "质量保证"],
  ["security-auditor", "安全审计", "漏洞扫描"],
  ["docs-writer", "文档", "README"],
  ["marketing-growth", "增长营销", "涨星推广"],
  ["github-agent", "发布官", "git推送"],
  ["devops-release", "发布工程", "版本CI"],
  ["analyst", "分析师", "数据洞察"],
  ["legal-compliance", "法务", "合规"],
];

function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter(p => p.status === "active"), running: !!eng.running };
}

function trimLines(s, maxLines) {
  const lines = String(s).split("\n");
  if (lines.length <= maxLines) return s;
  return lines.slice(0, maxLines).join("\n") + "\n… (+" + (lines.length - maxLines) + " 行，全文见审计日志)";
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

// 极简 markdown：**粗体** / ```代码块``` / 列表保持
function mdLite(text, w, textColor) {
  const out = [];
  let inCode = false;
  for (let raw of String(text || "").split("\n")) {
    if (raw.trim().startsWith("```")) { inCode = !inCode; continue; }
    const bold = (l) => l.replace(/\*\*(.+?)\*\*/g, "\x1b[1m$1\x1b[22m");
    const styled = bold(raw);
    if (inCode) out.push(lipglossText("  │ " + trunc(styled, w - 6), C.tool));
    else out.push(lipglossText(trunc(styled, w - 2), textColor));
  }
  return out;
}
function lipglossText(text, color) {
  return <Text color={color}>{text}</Text>;
}

// ─────────── 条目 ───────────
// kind: user | assistant | tool(含 result 合并渲染)
function EntryView({ e, w, expanded }) {
  const nameW = 4;

  if (e.kind === "user") {
    return (
      <Box flexDirection="column" marginBottom={0}>
        <Text><Text color={C.secondary} bold>{"你"}</Text><Text dimColor>{" ──"}</Text></Text>
        <Box paddingLeft={nameW} flexDirection="column">
          {wrap(e.text, Math.max(20, w - nameW))}
        </Box>
      </Box>
    );
  }
  if (e.kind === "assistant") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={C.primary} bold>{"Si"}</Text>
          <Text dimColor>{" ── " + trunc(e.model || "", 22) + " ↑" + (e.ptok||0) + " ↓" + (e.ctok||0) + " tok"}</Text>
        </Text>
        <Box paddingLeft={nameW} flexDirection="column">
          {mdLite(e.text, Math.max(20, w - nameW), C.text)}
        </Box>
      </Box>
    );
  }
  if (e.kind === "info") {
    return <Box paddingLeft={nameW}><Text dimColor>· {e.text}</Text></Box>;
  }
  if (e.kind === "error") {
    return <Box paddingLeft={nameW}><Text color={C.error}>✖ {trunc(e.text, w - 6)}</Text></Box>;
  }
  if (e.kind === "tool") {
    const mark = e.hasResult ? (e.ok ? "✓" : "✖") : "⟳";
    const markColor = e.hasResult ? (e.ok ? C.success : C.error) : C.warn;
    const head = `${mark} ⚡ ${e.tool}: ${trunc(prettyParams(e.args), Math.max(16, w - nameW - 14))}`;
    return (
      <Box flexDirection="column" paddingLeft={nameW}>
        <Text>
          <Text color={markColor} bold>{mark + " "}</Text>
          <Text color={C.tool}>{e.tool} </Text>
          <Text dimColor>{trunc(prettyParams(e.args), Math.max(16, w - nameW - 12))}</Text>
          {expanded ? null : e.output && !e.isErr ? <Text dimColor>{" ✓"}</Text> : null}
        </Text>
        {expanded ? (
          <Box flexDirection="column" paddingLeft={2}>
            {(String(e.output ?? "").split("\n").slice(0, MAX_RESULT).map((l, i) =>
              <Text key={i} color={e.isErr ? C.error : C.muted}>│ {trunc(l, w - nameW - 6)}</Text>
            ))}
          </Box>
        ) : null}
      </Box>
    );
  }
  return null;
}

function wrap(s, w) {
  const out = [];
  for (const para of String(s).split("\n")) {
    if (!para) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      if (!line) line = word;
      else if ([...line].length + 1 + [...word].length <= w) line += " " + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.map((l, i) => <Text key={i} color={C.text}>{l}</Text>);
}

// ─────────── App ───────────
function App({ initialDir }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [liveTool, setLiveTool] = useState(null);   // {tool,args}
  const [input, setInput] = useState("");
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState({ p: 0, c: 0 });
  const [tick, setTick] = useState(0);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [dialog, setDialog] = useState(null);
  const [dialogSel, setDialogSel] = useState(0);
  const [focusProj, setFocusProj] = useState(null);
  const [notice, setNotice] = useState("");
  const [scrollFromBottom, setScrollFromBottom] = useState(0);
  const pendingToolRef = useRef(null);
  const { stdout } = process;

  useEffect(() => {
    stdout.write("\x1b[?1049h\x1b[H");
    const t = setInterval(() => setTick(x => x + 1), 1200);
    return () => { clearInterval(t); stdout.write("\x1b[?1049l"); };
  }, []);

  const notice_ = useCallback((text, isErr) => {
    setEntries(prev => [...prev.slice(-199),
      { id: nid(), kind: isErr ? "error" : "info", text }]);
  }, []);

  // 引擎事件 → 统一条目流（工具与其结果合并为一个条目）
  const handleEngineEvent = useCallback((ev) => {
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model);
        setTok(t => ({ p: t.p + (ev.prompt_tokens||0), c: t.c + (ev.completion_tokens||0) }));
        break;
      case "tool":
        pendingToolRef.current = { id: nid(), kind: "tool", tool: ev.tool, args: ev.args, output: "", hasResult: false };
        break;
      case "result":
        if (pendingToolRef.current) {
          const t = pendingToolRef.current;
          t.output = ev.output; t.hasResult = true; t.ok = ev.ok === true || ev.status === "success"; t.isErr = !t.ok;
          setEntries(prev => [...prev.slice(-199), t]);
          pendingToolRef.current = null;
        }
        break;
      case "run-done": {
        if (pendingToolRef.current) {
          const t = pendingToolRef.current;
          t.output = "(中断)"; t.hasResult = true; t.ok = false;
          setEntries(prev => [...prev.slice(-199), t]);
          pendingToolRef.current = null;
        }
        const tk = ev.tokens || {};
        const body = trimLines((ev.output || ev.summary || "").trim() || "(无输出)", 10);
        setModel(ev.model || model);
        setEntries(prev => [...prev.slice(-199), {
          id: nid(), kind: "assistant",
          text: body,
          model: ev.model, ptok: tk.prompt||0, ctok: tk.completion||0,
        }]);
        setTok(t => ({ p: t.p + (tk.prompt||0), c: t.c + (tk.completion||0) }));
        setBusy(false);
        break;
      }
      case "llm-error":
        setEntries(prev => [...prev.slice(-199),
          { id: nid(), kind: "error", text: "模型错误: " + ev.error }]);
        setBusy(false);
        break;
    }
  }, [model]);

  const submitTask = useCallback((task, forceAgent) => {
    let dir = initialDir;
    if (focusProj) {
      const d = path.join(PROJECTS, focusProj);
      if (fs.existsSync(d)) dir = d;
    } else {
      const st = companyState();
      for (const p of st.pool) if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const d = path.join(PROJECTS, p.id);
        if (fs.existsSync(d)) dir = d;
        break;
      }
    }
    const agentID = forceAgent || route(task);
    setBusy(true);
    setEntries(prev => [...prev.slice(-199), { id: nid(), kind: "user", text: task }]);
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
    child.on("close", () => {
      if (pendingToolRef.current) {
        const t = pendingToolRef.current;
        t.output = "(中断)"; t.hasResult = true; t.ok = false;
        setEntries(prev => [...prev.slice(-199), t]);
        pendingToolRef.current = null;
      }
      setBusy(false);
    });
  }, [initialDir, focusProj, handleEngineEvent]);

  function bootstrapNew(name, requirement) {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });
    notice_(`🏗 「${name}」开工（开发→测试→安全→文档→发布），完成后自动入池`);
    setBusy(true);
    setEntries(prev => [...prev.slice(-199), { id: nid(), kind: "info",
      text: `新项目 ${name} 全流水线建设中…` }]);
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
      if (code === 0 && fs.existsSync(path.join(dir, "README.md"))) {
        const pf = path.join(COMPANY, "pool.json");
        const pool = readJSON(pf, []);
        if (!pool.some(p => p.id === name))
          pool.push({ id: name, status: "active", interval_min: 60, priority: 5, last_run: 0, fail_streak: 0 });
        fs.writeFileSync(pf, JSON.stringify(pool, null, 1));
        notice_(`🎉 「${name}」入池永动！`);
      } else notice_(`「${name}」未完成(code=${code})`, true);
    });
  }

  function runSlash(t) {
    const [cmd, ...rest] = t.split(" ");
    const arg = rest.join(" ");
    switch (cmd) {
      case "/help": notice_("输入任务派活 · p聚焦项目 · a派给员工 · b账单 · h历史 · /new 建项 · x 展开最近工具输出"); break;
      case "/clear": setEntries([]); break;
      case "/exit": exit(); break;
      case "/new": {
        const sp = arg.indexOf(" ");
        if (sp < 1) notice_("用法: /new <name> <需求>", true);
        else bootstrapNew(arg.slice(0, sp), arg.slice(sp + 1));
        break;
      }
      case "/focus": {
        if (!arg) { setFocusProj(null); notice_("已取消聚焦"); break; }
        const d = path.join(PROJECTS, arg);
        if (fs.existsSync(d)) { setFocusProj(arg); notice_("聚焦: " + arg); }
        else notice_("项目不存在: " + arg, true);
        break;
      }
      default: notice_("未知命令 " + cmd + " · /help");
    }
  }

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { exit(); return; }

    if (dialog) {
      const list = dialogItems(dialog);
      if (key.upArrow) setDialogSel(s => Math.max(0, s - 1));
      if (key.downArrow) setDialogSel(s => Math.min(list.length - 1, s + 1));
      if (key.escape) setDialog(null);
      if (key.return) { list[dialogSel]?.onPick?.(); setDialog(null); setDialogSel(0); }
      return;
    }

    if (ch === "p" && !input && !busy) { setDialog("proj"); setDialogSel(0); return; }
    if (ch === "a" && !input && !busy) { setDialog("agent"); setDialogSel(0); return; }
    if (ch === "b" && !input) { setDialog("bill"); setDialogSel(0); return; }
    if (ch === "x") {
      setExpandedIds(prev => {
        const s = new Set(prev);
        const toolIds = entries.filter(e => e.kind === "tool").map(e => e.id);
        const last = toolIds[toolIds.length - 1];
        if (last) { if (s.has(last)) s.delete(last); else s.add(last); }
        return s;
      });
      return;
    }
    if (key.pageUp) { setScrollFromBottom(v => v + 10); return; }
    if (key.pageDown) { setScrollFromBottom(v => Math.max(0, v - 10)); return; }

    if (key.return) {
      const t = input.trim();
      setInput("");
      if (!t) return;
      if (t.startsWith("/")) { runSlash(t); return; }
      submitTask(t);
      return;
    }
    if (key.escape) { setInput(""); setNotice(""); return; }
    if (key.backspace || key.delete) { setInput(i => i.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput(i => i + ch);
    }
  });

  function dialogItems(type) {
    if (type === "proj") {
      const st = companyState();
      const items = st.pool.map(p => ({
        label: `${p.status === "active" ? "🟢" : "⏸"} ${p.id}`,
        onPick: () => { setFocusProj(p.id); notice_("聚焦: " + p.id); },
      }));
      items.push({ label: "🌐 取消聚焦", onPick: () => { setFocusProj(null); notice_("已取消"); } });
      return items;
    }
    if (type === "agent") {
      return AGENTS.map(([id, name, desc]) => ({
        label: `${name.padEnd(10)} ${desc}`,
        onPick: () => submitTask(`向${name}报到并简述职责`, id),
      }));
    }
    return [];
  }

  // ─────────── 渲染 ───────────
  const st = companyState();
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;
  const SIDEBAR_W = 30;
  const MAIN_W = W - SIDEBAR_W;
  const CHAT_H = Math.max(6, H - 7);

  const breath = tick % 2 === 0 ? "●" : "○";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;

  // 渲染条目为行数组（带窗口与展开态）
  const rendered = [];
  const visEntries = entries.slice(-(CHAT_H + 20)); // 多取一些，裁剪时保量
  for (const e of visEntries) {
    const expanded = expandedIds.has(e.id);
    const node = EntryView({ e, w: MAIN_W - 2, expanded });
    rendered.push(<Box key={e.id}>{node}</Box>);
  }

  // 可视窗口：贴底或上翻
  const from = Math.max(0, rendered.length - CHAT_H - scrollFromBottom);
  const visible = rendered.slice(from, from + CHAT_H);

  return (
    <Box flexDirection="column" width={W} height={H}>
      {/* Header */}
      <Box borderStyle={{topLeft:"╭",top:"─",topRight:"╮",left:"│",right:"│",bottomLeft:"╰",bottom:"─",bottomRight:"╯"}}
           borderColor={C.border} width={W}>
        <Text>
          {" "}
          <Text bold color={C.primary}>⌬ OPC</Text>
          <Text color={engColor}> [{breath} 引擎:{busy?"工作中":st.running?"运转中":"停止"}]</Text>
          <Text color={C.text}> [池 {st.active.length}/{st.pool.length}]</Text>
          <Text color={C.muted}> [员工 {AGENTS.length}]</Text>
          <Text color={C.warn}> [↑{tok.p} ↓{tok.c}]</Text>
          <Text dimColor> {trunc(model, 24)}</Text>
          {focusProj ? <Text color={C.warn}> [🎯{focusProj}]</Text> : null}
        </Text>
      </Box>

      {/* 双栏主体 */}
      <Box flexDirection="row" height={CHAT_H}>
        {/* 左：对话 */}
        <Box flexDirection="column" width={MAIN_W} paddingX={1}>
          {visible}
          {busy ? <Text color={C.warn} paddingLeft={namePad()}>  ⟳ 编排中…</Text> : null}
          {scrollFromBottom > 0 ? <Text dimColor>  ↕ 上翻 {scrollFromBottom} 行 (PgDn 回底)</Text> : null}
        </Box>
        {/* 分隔线 */}
        <Box width={1}><Text color={C.border}>{"│".repeat(Math.max(1, CHAT_H))}</Text></Box>
        {/* 右：侧栏 */}
        <Box flexDirection="column" width={SIDEBAR_W - 1} paddingX={1}>
          <Text bold color={C.primary}>📦 项目池</Text>
          {st.pool.map(p => (
            <Text key={p.id} color={p.status==="active"?C.success:C.muted}>
              {" "}{p.status==="active"?"🟢":"⏸"} {trunc(p.id, SIDEBAR_W-10)}
            </Text>
          ))}
          {!st.pool.length ? <Text dimColor>  (空)</Text> : null}
          <Text> </Text>
          <Text bold color={C.primary}>👥 员工</Text>
          {AGENTS.slice(0, Math.max(0, CHAT_H - 8 - st.pool.length * 1)).map(([id, name]) => (
            <Text key={id} color={C.muted}>{"  "}{trunc(name, SIDEBAR_W-8)}</Text>
          ))}
          <Box marginTop={1}><Text dimColor>💰 ↑{tok.p} ↓{tok.c}</Text></Box>
          {notice ? <Text color={C.warn}>{trunc(notice, SIDEBAR_W-2)}</Text> : null}
        </Box>
      </Box>

      {/* 输入 */}
      <Box borderStyle="round" borderColor={C.border} paddingX={1} width={W}>
        <Text color={C.primary} bold>{"❯ "}</Text>
        <Text color={C.text}>{input}</Text>
        {!busy ? <Text dimColor>_</Text> : <Text color={C.warn}>⟳</Text>}
      </Box>
      <Text dimColor>
        {" Enter 发送 · x 展开 · PgUp/PgDn 翻页 · p 项目 · a 员工 · b 账单 · h 历史 · Ctrl+C 退出"}
      </Text>
    </Box>
  );
}

function namePad() { return 4; }

// ─────────── 启动 ───────────
const idx = process.argv.indexOf("--dir");
const dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) { console.error("目录不存在:", dirArg); process.exit(1); }

render(<App initialDir={dirArg} />, { patchConsole: false });