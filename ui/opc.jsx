#!/usr/bin/env node
// opc — OPC 层级导航驾驶台
// 公司 → 项目 → 员工 → 行为 → 详情，Esc 逐级返回；任意层可直接输文字派任务
import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { spawn, execFileSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const C = {
  primary: "#7aa2f7", secondary: "#bb9af7", text: "#c0caf5", muted: "#565f89",
  error: "#f7768e", success: "#9ece6a", warn: "#e0af68", tool: "#7dcfff",
  border: "#3d445c", hiBg: "#292e42",
};
const COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
const PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
const MAX_RESULT = 12;

let idc = 0;
const nid = () => `e${++idc}`;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const trunc = (s, w) => { s = String(s ?? "").replace(/\n/g, " "); const r = [...s]; return r.length <= w ? s : r.slice(0, w - 1).join("") + "…"; };

const AGENTS = [
  { id: "build", name: "Sisyphus (COO)", desc: "编排·兜底接单" },
  { id: "product-manager", name: "产品经理", desc: "需求分析 PRD" },
  { id: "architect", name: "架构师", desc: "系统设计" },
  { id: "developer", name: "开发者", desc: "编码实现" },
  { id: "tester", name: "测试员", desc: "质量保证" },
  { id: "security-auditor", name: "安全审计", desc: "漏洞扫描" },
  { id: "docs-writer", name: "文档工程师", desc: "README/教程" },
  { id: "marketing-growth", name: "增长营销", desc: "涨星推广" },
  { id: "github-agent", name: "发布官", desc: "git push" },
  { id: "devops-release", name: "发布工程", desc: "版本/CI" },
  { id: "analyst", name: "分析师", desc: "数据洞察" },
  { id: "legal-compliance", name: "法务", desc: "License合规" },
  { id: "hr-manager", name: "HR", desc: "招聘解雇" },
];

function readEvents(limit) {
  try {
    return fs.readFileSync(path.join(COMPANY, "activity.jsonl"), "utf8")
      .trim().split("\n").filter(Boolean).slice(-limit)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
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

// ─────────── App ───────────
function App({ initialDir }) {
  const { exit } = useApp();
  // 导航状态机
  const [nav, setNav] = useState({ mode: "root", proj: null, agent: null, act: null, sel: 0, detailSel: 0 });
  // 实况事件（全透明数据源，菜单详情都从这里读）
  const [events, setEvents] = useState(() => readEvents(600));
  // 输入与运行态
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null);
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState(0);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState("");
  const pendingToolRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1200);
    return () => clearInterval(t);
  }, []);

  const pushNotice = useCallback((text, isError) => {
    setNotice(isError ? "✖ " + text : text);
    setTimeout(() => setNotice(n => (n === (isError ? "✖ " + text : text) ? "" : n)), 6000);
  }, []);

  // 引擎事件 → 数据源 + 状态
    const handleEngineEvent = useCallback((ev) => {
    setEvents(prev => [...prev.slice(-599), ev]);
    switch (ev.type) {
      case "llm":
        setModel(ev.model || "…"); setTok(t => t + (ev.prompt_tokens || 0) + (ev.completion_tokens || 0));
        break;
      case "tool":
        if (pendingToolRef.current) pushNotice("(上一个工具无结果)", true);
        pendingToolRef.current = ev;
        break;
      case "result":
        pendingToolRef.current = null;
        break;
      case "run-done": {
        pendingToolRef.current = null;
        const tk = ev.tokens || {};
        setTok(t => t + (tk.total || ev.total_tokens || 0));
        setBusy(false);
        break;
      }
      case "llm-error":
        pendingToolRef.current = null;
        setBusy(false);
        break;
    }
  }, []);

  // 派任务（带上下文）
  const submitTask = useCallback((task, forceAgent, forceDir) => {
    if (!task.trim() || busy) return;
    let dir = forceDir || initialDir;
    if (!forceDir) {
      const pool = readJSON(path.join(COMPANY, "pool.json"), []);
      for (const p of pool) if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const d = path.join(PROJECTS, p.id);
        if (fs.existsSync(d)) dir = d;
        break;
      }
    }
    const agentID = forceAgent || route(task);
    setBusy(true);
    setNav(n => ({ ...n, mode: "act", act: { kind: "live" }, sel: 0, detailSel: 0 })); // 切到实况页观看
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
    child.on("error", e => { setBusy(false); pushNotice("启动失败: " + e.message, true); });
    child.on("close", code => {
      pendingToolRef.current = null;
      setBusy(false);
      if (code !== 0) pushNotice(`退出码 ${code}，详见审计日志`, true);
    });
  }, [busy, initialDir, handleEngineEvent]);

  // 菜单数据
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const st = { running: readJSON(path.join(COMPANY, "engine.json"), {}).running };

  function getItems() {
    if (nav.mode === "root") {
      const items = pool.map(p => ({
        label: `${p.status === "active" ? "🟢" : "⏸"} ${p.id}  ${p.status === "active" ? "永动中" : "已暂停"} · 连败${p.fail_streak || 0} · 每${p.interval_min}分`,
        value: { kind: "proj", id: p.id },
      }));
      items.push({ label: "➕ 新建项目 (/new name 需求)", value: { kind: "newproj" } });
      items.push({ label: "💬 直接派临时任务（在下方输入）", value: { kind: "noop" } });
      return items;
    }
    if (nav.mode === "proj") {
      const items = AGENTS.map(a => ({
        label: `${a.name.padEnd(14)} ${a.desc}`,
        value: { kind: "agent", id: a.id },
      }));
      return items;
    }
    if (nav.mode === "agent") {
      return [
        { label: "📝 派任务给这位员工（下方输入，Enter 发送）", value: { kind: "assign" } },
        { label: "📜 TA 的全部活动流水", value: { kind: "stream" } },
        { label: "✅ 已完成任务", value: { kind: "done" } },
        { label: "✖ 失败与报错", value: { kind: "fail" } },
      ];
    }
    return [];
  }

  const items = getItems();

  // 事件过滤（行为视图）
  function filteredEvents() {
    const want = nav.act?.kind;
    return events.filter(e => {
      if (nav.proj && e.project !== nav.proj) return false;
      if (nav.agent && e.agent !== nav.agent) return false;
      if (want === "done") return e.type === "run-done";
      if (want === "fail") return e.type === "llm-error" || (e.type === "result" && e.status !== "success");
      return ["tool", "result", "llm"].includes(e.type);
    }).reverse();
  }

  // 键盘
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { exit(); return; }

    // 详情模式：上下滚动浏览单条事件的完整内容
    if (nav.mode === "act" && nav.act?.kind?.startsWith?.("detail:")) {
      if (key.upArrow) setNav(n => ({ ...n, detailSel: Math.max(0, n.detailSel - 1) }));
      if (key.downArrow) setNav(n => ({ ...n, detailSel: n.detailSel + 1 }));
      if (key.escape) setNav(n => ({ ...n, mode: "act", act: { kind: nav.act.listKind }, detailSel: 0 }));
      if (ch && !key.return) { setInput(i => i + ch); }
      if (key.return) {
        const txt = input.trim();
        if (txt) { setInput(""); submitTask(txt, nav.agent, path.join(PROJECTS, nav.proj)); }
      }
      return;
    }

    // 行为/员工/项目 菜单模式
    if (key.upArrow) setNav(n => ({ ...n, sel: Math.max(0, n.sel - 1) }));
    if (key.downArrow) setNav(n => ({ ...n, sel: Math.min(items.length - 1, n.sel + 1) }));
    if (key.escape) {
      setInput("");
      setNav(n => {
        if (n.mode === "act") return { ...n, mode: n.agent ? "agent" : n.proj ? "proj" : "root", act: null, sel: 0 };
        if (n.mode === "agent") return { ...n, mode: "proj", agent: null, sel: 0 };
        if (n.mode === "proj") return { ...n, mode: "root", proj: null, sel: 0 };
        return n;
      });
      return;
    }

    if (key.return) {
      // 有输入文字 → 作为任务提交（带当前层级上下文）
      const txt = input.trim();
      if (txt) {
        setInput("");
        if (nav.mode === "agent") submitTask(txt, nav.agent, path.join(PROJECTS, nav.proj));
        else if (nav.mode === "proj") submitTask(txt, null, path.join(PROJECTS, nav.proj));
        else submitTask(txt);
        return;
      }
      // 无输入 → 选择光标项
      const it = items[nav.sel];
      if (!it) return;
      const v = it.value;
      if (v.kind === "proj") setNav(n => ({ ...n, mode: "proj", proj: v.id, agent: null, sel: 0 }));
      else if (v.kind === "agent") setNav(n => ({ ...n, mode: "agent", agent: v.id, sel: 0 }));
      else if (v.kind === "noop") pushNotice("直接在下方面板输入文字即可");
      else if (v.kind === "newproj") pushNotice("输入: /new 名称 需求描述");
      else if (v.kind === "assign") pushNotice(`已在下方面板输入即可指派给 ${nav.agent}`);
      else if (["stream", "done", "fail"].includes(v.kind)) {
        setNav(n => ({ ...n, mode: "act", act: { kind: "detail:" + v.kind, listKind: v.kind }, sel: 0, detailSel: 0 }));
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (input) setInput(i => i.slice(0, -1));
      else setNav(n => { // 空输入时 Backspace 也逐级返回
        if (n.mode === "act") return { ...n, mode: n.agent ? "agent" : n.proj ? "proj" : "root", act: null };
        if (n.mode === "agent") return { ...n, mode: "proj", agent: null };
        if (n.mode === "proj") return { ...n, mode: "root", proj: null };
        return n;
      });
      return;
    }

    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput(i => i + ch);
    }
  });

  // ─────────── 渲染 ───────────
  const crumb = ["🏢 公司"];
  if (nav.proj) crumb.push("📦 " + nav.proj);
  if (nav.agent) crumb.push("👤 " + AGENTS.find(a => a.id === nav.agent)?.name);
  if (nav.mode === "act") crumb.push(nav.act?.kind === "live" ? "🔴 实况" : "📋 " + (nav.act.listKind || ""));

  const breath = tick % 2 === 0 ? "●" : "○";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const poolActive = pool.filter(p => p.status === "active").length;

  function renderBody() {
    const W = 110;
    if (nav.mode === "root") {
      const lines = [
        `引擎 ${st.running ? "运转中 ●" : "停止 ○"} · 项目池 ${poolActive}/${pool.length} · 本进程 token ↑↓${tok}`,
        "",
      ];
      return <Box flexDirection="column">{lines.map((l, i) => <Text key={i} color={C.muted}>{l}</Text>)}</Box>;
    }
    if (nav.mode === "act") {
      const evs = filteredEvents();
      if (nav.act.kind === "live") {
        const recent = evs.slice(-18);
        return (
          <Box flexDirection="column">
            {recent.map((e, i) => (
              <Text key={i} color={C.muted}>
                {(e.ts || "").slice(11, 19)}{" "}
                {e.type === "tool" ? <>⚡ {e.tool}: {trunc(prettyParams(e.args), 70)}</> :
                 e.type === "llm" ? <>🧠 {trunc(e.model, 26)} ↑{e.prompt_tokens||0} ↓{e.completion_tokens||0}</> :
                 e.type === "result" ? <>{e.status === "success" ? "✓" : "✖"} {trunc(e.output, 70)}</> :
                 e.type === "run-done" ? <>{GREEN}■ 完成{R} {trunc(e.summary || e.output, 60)}</> :
                 trunc(e.type, 30)}
              </Text>
            ))}
            {recent.length === 0 ? <Text color={C.muted}>等待事件…</Text> : null}
          </Box>
        );
      }
      // done / fail / stream 列表 + 选中详情
      const sel = Math.min(nav.detailSel, Math.max(0, evs.length - 1));
      const cur = evs[sel];
      return (
        <Box flexDirection="column">
          {evs.slice(0, 40).map((e, i) => (
            <Text key={i} color={i === sel ? C.text : C.muted}>
              {i === sel ? "▶ " : "  "}
              {(e.ts || "").slice(11, 19)} {e.type === "tool" ? `⚡ ${e.tool}: ${trunc(prettyParams(e.args), 46)}` :
                e.type === "result" ? `${e.status === "success" ? "✓" : "✖"} ${trunc(e.output, 50)}` :
                e.type === "llm" ? `🧠 ${(e.model||"").split("/").pop()} ↑${e.prompt_tokens||0}` :
                e.type === "run-done" ? `■ ${trunc(e.summary || e.output, 50)}` :
                e.type === "llm-error" ? `⚠ ${trunc(e.error, 50)}` : trunc(e.type, 30)}
            </Text>
          ))}
          {cur ? (
            <>
              <Text> </Text>
              <Text color={C.tool}>── 选中详情 ({sel + 1}/{evs.length}) ──</Text>
              <Text color={C.text}>{prettyParams(cur.input || "")}</Text>
              {String(cur.output || "").split("\n").slice(0, MAX_RESULT).map((l, i) => (
                <Text key={i} color={cur.status === "success" ? C.success : C.error}>  {l}</Text>
              ))}
            </>
          ) : null}
          {evs.length === 0 ? <Text color={C.muted}>暂无记录</Text> : null}
        </Box>
      );
    }
    // 菜单渲染
    return (
      <Box flexDirection="column">
        {items.map((it, i) => (
          <Text key={i} backgroundColor={i === nav.sel ? C.hiBg : undefined}
                color={i === nav.sel ? C.text : C.muted}>
            {" "}{i === nav.sel ? "▶" : " "}{it.label}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* 面包屑 */}
      <Box>
        <Text bold color={C.primary}> ⌬ OPC </Text>
        <Text color={C.muted}>{crumb.join(" › ")}</Text>
      </Box>
      {/* 主体 */}
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {renderBody()}
      </Box>
      {/* 提示 */}
      <Text dimColor>
        {nav.mode === "act" && nav.act?.kind?.startsWith?.("detail:")
          ? "↑↓浏览 · Esc返回 · 输入文字=给该项目/员工派任务"
          : "↑↓选择 · Enter进入/发送 · Esc返回 · 直接输入文字=派任务"}
      </Text>
      {notice ? <Text color={C.warn}>{notice}</Text> : null}
      {/* 输入面板 */}
      <Box borderStyle="round" borderColor={C.border} paddingX={1}>
        <Text color={C.primary} bold>{"❯ "}</Text>
        <Text color={C.text}>{input}</Text>
        {!busy ? <Text dimColor>_</Text> : <Text color={C.warn}>⟳</Text>}
      </Box>
      {/* 状态栏 */}
      <Text>
        {" "}
        <Text color={engColor}>{breath}</Text>
        <Text dimColor>
          {` 引擎:${st.running ? "运转中" : "停止"} · 池:${poolActive}/${pool.length} · ${trunc(model, 28)} · ↑↓${tok} tok`}
        </Text>
      </Text>
    </Box>
  );
}

const R = "\x1b[0m";
const GREEN = "\x1b[32m";

// ─────────── 启动 ───────────
const idx = process.argv.indexOf("--dir");
const dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) { console.error("目录不存在:", dirArg); process.exit(1); }

render(<App initialDir={dirArg} />, { patchConsole: false });
