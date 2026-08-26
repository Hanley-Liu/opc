#!/usr/bin/env node

// opc.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { spawn } from "node:child_process";
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
  warn: "#e0af68",
  tool: "#7dcfff",
  border: "#3d445c",
  hiBg: "#292e42",
  panel: "#16161e"
};
var COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
var PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
var MAX_RESULT = 8;
var idc = 0;
var nid = () => `e${++idc}`;
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
var AGENTS = [
  ["build", "Sisyphus", "COO\xB7\u7F16\u6392"],
  ["product-manager", "\u4EA7\u54C1\u7ECF\u7406", "\u9700\u6C42PRD"],
  ["architect", "\u67B6\u6784\u5E08", "\u7CFB\u7EDF\u8BBE\u8BA1"],
  ["developer", "\u5F00\u53D1\u8005", "\u7F16\u7801\u5B9E\u73B0"],
  ["tester", "\u6D4B\u8BD5\u5458", "\u8D28\u91CF\u4FDD\u8BC1"],
  ["security-auditor", "\u5B89\u5168\u5BA1\u8BA1", "\u6F0F\u6D1E\u626B\u63CF"],
  ["docs-writer", "\u6587\u6863", "README"],
  ["marketing-growth", "\u589E\u957F\u8425\u9500", "\u6DA8\u661F\u63A8\u5E7F"],
  ["github-agent", "\u53D1\u5E03\u5B98", "git\u63A8\u9001"],
  ["devops-release", "\u53D1\u5E03\u5DE5\u7A0B", "\u7248\u672CCI"],
  ["analyst", "\u5206\u6790\u5E08", "\u6570\u636E\u6D1E\u5BDF"],
  ["legal-compliance", "\u6CD5\u52A1", "\u5408\u89C4"]
];
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter((p) => p.status === "active"), running: !!eng.running };
}
function trimLines(s, maxLines) {
  const lines = String(s).split("\n");
  if (lines.length <= maxLines) return s;
  return lines.slice(0, maxLines).join("\n") + "\n\u2026 (+" + (lines.length - maxLines) + " \u884C\uFF0C\u5168\u6587\u89C1\u5BA1\u8BA1\u65E5\u5FD7)";
}
function prettyParams(raw) {
  try {
    const m = JSON.parse(raw);
    if (m.command) return "$ " + m.command.replace(/\n/g, " ");
    if (m.path && m.old_string) return `${m.path} \u270E`;
    if (m.path && m.content) return `${m.path} \u271A${String(m.content).length}B`;
    if (m.path) return m.path;
    if (m.pattern) return "/" + m.pattern;
    if (m.agent) return `\u2192 ${m.agent}`;
  } catch {
  }
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
function mdLite(text, w, textColor) {
  const out = [];
  let inCode = false;
  for (let raw of String(text || "").split("\n")) {
    if (raw.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    const bold = (l) => l.replace(/\*\*(.+?)\*\*/g, "\x1B[1m$1\x1B[22m");
    const styled = bold(raw);
    if (inCode) out.push(lipglossText("  \u2502 " + trunc(styled, w - 6), C.tool));
    else out.push(lipglossText(trunc(styled, w - 2), textColor));
  }
  return out;
}
function lipglossText(text, color) {
  return /* @__PURE__ */ React.createElement(Text, { color }, text);
}
function EntryView({ e, w, expanded }) {
  const nameW = 4;
  if (e.kind === "user") {
    return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", marginBottom: 0 }, /* @__PURE__ */ React.createElement(Text, null, /* @__PURE__ */ React.createElement(Text, { color: C.secondary, bold: true }, "\u4F60"), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " \u2500\u2500")), /* @__PURE__ */ React.createElement(Box, { paddingLeft: nameW, flexDirection: "column" }, wrap(e.text, Math.max(20, w - nameW))));
  }
  if (e.kind === "assistant") {
    return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, /* @__PURE__ */ React.createElement(Text, null, /* @__PURE__ */ React.createElement(Text, { color: C.primary, bold: true }, "Si"), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " \u2500\u2500 " + trunc(e.model || "", 22) + " \u2191" + (e.ptok || 0) + " \u2193" + (e.ctok || 0) + " tok")), /* @__PURE__ */ React.createElement(Box, { paddingLeft: nameW, flexDirection: "column" }, mdLite(e.text, Math.max(20, w - nameW), C.text)));
  }
  if (e.kind === "info") {
    return /* @__PURE__ */ React.createElement(Box, { paddingLeft: nameW }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "\xB7 ", e.text));
  }
  if (e.kind === "error") {
    return /* @__PURE__ */ React.createElement(Box, { paddingLeft: nameW }, /* @__PURE__ */ React.createElement(Text, { color: C.error }, "\u2716 ", trunc(e.text, w - 6)));
  }
  if (e.kind === "tool") {
    const mark = e.hasResult ? e.ok ? "\u2713" : "\u2716" : "\u27F3";
    const markColor = e.hasResult ? e.ok ? C.success : C.error : C.warn;
    const head = `${mark} \u26A1 ${e.tool}: ${trunc(prettyParams(e.args), Math.max(16, w - nameW - 14))}`;
    return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", paddingLeft: nameW }, /* @__PURE__ */ React.createElement(Text, null, /* @__PURE__ */ React.createElement(Text, { color: markColor, bold: true }, mark + " "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, e.tool, " "), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, trunc(prettyParams(e.args), Math.max(16, w - nameW - 12))), expanded ? null : e.output && !e.isErr ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " \u2713") : null), expanded ? /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", paddingLeft: 2 }, String(e.output ?? "").split("\n").slice(0, MAX_RESULT).map(
      (l, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: e.isErr ? C.error : C.muted }, "\u2502 ", trunc(l, w - nameW - 6))
    )) : null);
  }
  return null;
}
function wrap(s, w) {
  const out = [];
  for (const para of String(s).split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      if (!line) line = word;
      else if ([...line].length + 1 + [...word].length <= w) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.map((l, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: C.text }, l));
}
function App({ initialDir }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [liveTool, setLiveTool] = useState(null);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState({ p: 0, c: 0 });
  const [tick, setTick] = useState(0);
  const [expandedIds, setExpandedIds] = useState(/* @__PURE__ */ new Set());
  const [dialog, setDialog] = useState(null);
  const [dialogSel, setDialogSel] = useState(0);
  const [focusProj, setFocusProj] = useState(null);
  const [notice, setNotice] = useState("");
  const [scrollFromBottom, setScrollFromBottom] = useState(0);
  const pendingToolRef = useRef(null);
  const { stdout } = process;
  useEffect(() => {
    stdout.write("\x1B[?1049h\x1B[H");
    const t = setInterval(() => setTick((x) => x + 1), 1200);
    return () => {
      clearInterval(t);
      stdout.write("\x1B[?1049l");
    };
  }, []);
  const notice_ = useCallback((text, isErr) => {
    setEntries((prev) => [
      ...prev.slice(-199),
      { id: nid(), kind: isErr ? "error" : "info", text }
    ]);
  }, []);
  const handleEngineEvent = useCallback((ev) => {
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model);
        setTok((t) => ({ p: t.p + (ev.prompt_tokens || 0), c: t.c + (ev.completion_tokens || 0) }));
        break;
      case "tool":
        pendingToolRef.current = { id: nid(), kind: "tool", tool: ev.tool, args: ev.args, output: "", hasResult: false };
        break;
      case "result":
        if (pendingToolRef.current) {
          const t = pendingToolRef.current;
          t.output = ev.output;
          t.hasResult = true;
          t.ok = ev.ok === true || ev.status === "success";
          t.isErr = !t.ok;
          setEntries((prev) => [...prev.slice(-199), t]);
          pendingToolRef.current = null;
        }
        break;
      case "run-done": {
        if (pendingToolRef.current) {
          const t = pendingToolRef.current;
          t.output = "(\u4E2D\u65AD)";
          t.hasResult = true;
          t.ok = false;
          setEntries((prev) => [...prev.slice(-199), t]);
          pendingToolRef.current = null;
        }
        const tk = ev.tokens || {};
        const body = trimLines((ev.output || ev.summary || "").trim() || "(\u65E0\u8F93\u51FA)", 10);
        setModel(ev.model || model);
        setEntries((prev) => [...prev.slice(-199), {
          id: nid(),
          kind: "assistant",
          text: body,
          model: ev.model,
          ptok: tk.prompt || 0,
          ctok: tk.completion || 0
        }]);
        setTok((t) => ({ p: t.p + (tk.prompt || 0), c: t.c + (tk.completion || 0) }));
        setBusy(false);
        break;
      }
      case "llm-error":
        setEntries((prev) => [
          ...prev.slice(-199),
          { id: nid(), kind: "error", text: "\u6A21\u578B\u9519\u8BEF: " + ev.error }
        ]);
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
      const st2 = companyState();
      for (const p of st2.pool) if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const d = path.join(PROJECTS, p.id);
        if (fs.existsSync(d)) dir = d;
        break;
      }
    }
    const agentID = forceAgent || route(task);
    setBusy(true);
    setEntries((prev) => [...prev.slice(-199), { id: nid(), kind: "user", text: task }]);
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
      notice_("\u542F\u52A8\u5931\u8D25: " + e.message, true);
    });
    child.on("close", () => {
      if (pendingToolRef.current) {
        const t = pendingToolRef.current;
        t.output = "(\u4E2D\u65AD)";
        t.hasResult = true;
        t.ok = false;
        setEntries((prev) => [...prev.slice(-199), t]);
        pendingToolRef.current = null;
      }
      setBusy(false);
    });
  }, [initialDir, focusProj, handleEngineEvent]);
  function bootstrapNew(name, requirement) {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });
    notice_(`\u{1F3D7} \u300C${name}\u300D\u5F00\u5DE5\uFF08\u5F00\u53D1\u2192\u6D4B\u8BD5\u2192\u5B89\u5168\u2192\u6587\u6863\u2192\u53D1\u5E03\uFF09\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u5165\u6C60`);
    setBusy(true);
    setEntries((prev) => [...prev.slice(-199), {
      id: nid(),
      kind: "info",
      text: `\u65B0\u9879\u76EE ${name} \u5168\u6D41\u6C34\u7EBF\u5EFA\u8BBE\u4E2D\u2026`
    }]);
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
      if (code === 0 && fs.existsSync(path.join(dir, "README.md"))) {
        const pf = path.join(COMPANY, "pool.json");
        const pool = readJSON(pf, []);
        if (!pool.some((p) => p.id === name))
          pool.push({ id: name, status: "active", interval_min: 60, priority: 5, last_run: 0, fail_streak: 0 });
        fs.writeFileSync(pf, JSON.stringify(pool, null, 1));
        notice_(`\u{1F389} \u300C${name}\u300D\u5165\u6C60\u6C38\u52A8\uFF01`);
      } else notice_(`\u300C${name}\u300D\u672A\u5B8C\u6210(code=${code})`, true);
    });
  }
  function runSlash(t) {
    const [cmd, ...rest] = t.split(" ");
    const arg = rest.join(" ");
    switch (cmd) {
      case "/help":
        notice_("\u8F93\u5165\u4EFB\u52A1\u6D3E\u6D3B \xB7 p\u805A\u7126\u9879\u76EE \xB7 a\u6D3E\u7ED9\u5458\u5DE5 \xB7 b\u8D26\u5355 \xB7 h\u5386\u53F2 \xB7 /new \u5EFA\u9879 \xB7 x \u5C55\u5F00\u6700\u8FD1\u5DE5\u5177\u8F93\u51FA");
        break;
      case "/clear":
        setEntries([]);
        break;
      case "/exit":
        exit();
        break;
      case "/new": {
        const sp = arg.indexOf(" ");
        if (sp < 1) notice_("\u7528\u6CD5: /new <name> <\u9700\u6C42>", true);
        else bootstrapNew(arg.slice(0, sp), arg.slice(sp + 1));
        break;
      }
      case "/focus": {
        if (!arg) {
          setFocusProj(null);
          notice_("\u5DF2\u53D6\u6D88\u805A\u7126");
          break;
        }
        const d = path.join(PROJECTS, arg);
        if (fs.existsSync(d)) {
          setFocusProj(arg);
          notice_("\u805A\u7126: " + arg);
        } else notice_("\u9879\u76EE\u4E0D\u5B58\u5728: " + arg, true);
        break;
      }
      default:
        notice_("\u672A\u77E5\u547D\u4EE4 " + cmd + " \xB7 /help");
    }
  }
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (dialog) {
      const list = dialogItems(dialog);
      if (key.upArrow) setDialogSel((s) => Math.max(0, s - 1));
      if (key.downArrow) setDialogSel((s) => Math.min(list.length - 1, s + 1));
      if (key.escape) setDialog(null);
      if (key.return) {
        list[dialogSel]?.onPick?.();
        setDialog(null);
        setDialogSel(0);
      }
      return;
    }
    if (ch === "p" && !input && !busy) {
      setDialog("proj");
      setDialogSel(0);
      return;
    }
    if (ch === "a" && !input && !busy) {
      setDialog("agent");
      setDialogSel(0);
      return;
    }
    if (ch === "b" && !input) {
      setDialog("bill");
      setDialogSel(0);
      return;
    }
    if (ch === "x") {
      setExpandedIds((prev) => {
        const s = new Set(prev);
        const toolIds = entries.filter((e) => e.kind === "tool").map((e) => e.id);
        const last = toolIds[toolIds.length - 1];
        if (last) {
          if (s.has(last)) s.delete(last);
          else s.add(last);
        }
        return s;
      });
      return;
    }
    if (key.pageUp) {
      setScrollFromBottom((v) => v + 10);
      return;
    }
    if (key.pageDown) {
      setScrollFromBottom((v) => Math.max(0, v - 10));
      return;
    }
    if (key.return) {
      const t = input.trim();
      setInput("");
      if (!t) return;
      if (t.startsWith("/")) {
        runSlash(t);
        return;
      }
      submitTask(t);
      return;
    }
    if (key.escape) {
      setInput("");
      setNotice("");
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
  function dialogItems(type) {
    if (type === "proj") {
      const st2 = companyState();
      const items = st2.pool.map((p) => ({
        label: `${p.status === "active" ? "\u{1F7E2}" : "\u23F8"} ${p.id}`,
        onPick: () => {
          setFocusProj(p.id);
          notice_("\u805A\u7126: " + p.id);
        }
      }));
      items.push({ label: "\u{1F310} \u53D6\u6D88\u805A\u7126", onPick: () => {
        setFocusProj(null);
        notice_("\u5DF2\u53D6\u6D88");
      } });
      return items;
    }
    if (type === "agent") {
      return AGENTS.map(([id, name, desc]) => ({
        label: `${name.padEnd(10)} ${desc}`,
        onPick: () => submitTask(`\u5411${name}\u62A5\u5230\u5E76\u7B80\u8FF0\u804C\u8D23`, id)
      }));
    }
    return [];
  }
  const st = companyState();
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;
  const SIDEBAR_W = 30;
  const MAIN_W = W - SIDEBAR_W;
  const CHAT_H = Math.max(6, H - 7);
  const breath = tick % 2 === 0 ? "\u25CF" : "\u25CB";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const rendered = [];
  const visEntries = entries.slice(-(CHAT_H + 20));
  for (const e of visEntries) {
    const expanded = expandedIds.has(e.id);
    const node = EntryView({ e, w: MAIN_W - 2, expanded });
    rendered.push(/* @__PURE__ */ React.createElement(Box, { key: e.id }, node));
  }
  const from = Math.max(0, rendered.length - CHAT_H - scrollFromBottom);
  const visible = rendered.slice(from, from + CHAT_H);
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: W, height: H }, /* @__PURE__ */ React.createElement(
    Box,
    {
      borderStyle: { topLeft: "\u256D", top: "\u2500", topRight: "\u256E", left: "\u2502", right: "\u2502", bottomLeft: "\u2570", bottom: "\u2500", bottomRight: "\u256F" },
      borderColor: C.border,
      width: W
    },
    /* @__PURE__ */ React.createElement(Text, null, " ", /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.primary }, "\u232C OPC"), /* @__PURE__ */ React.createElement(Text, { color: engColor }, " [", breath, " \u5F15\u64CE:", busy ? "\u5DE5\u4F5C\u4E2D" : st.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62", "]"), /* @__PURE__ */ React.createElement(Text, { color: C.text }, " [\u6C60 ", st.active.length, "/", st.pool.length, "]"), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, " [\u5458\u5DE5 ", AGENTS.length, "]"), /* @__PURE__ */ React.createElement(Text, { color: C.warn }, " [\u2191", tok.p, " \u2193", tok.c, "]"), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " ", trunc(model, 24)), focusProj ? /* @__PURE__ */ React.createElement(Text, { color: C.warn }, " [\u{1F3AF}", focusProj, "]") : null)
  ), /* @__PURE__ */ React.createElement(Box, { flexDirection: "row", height: CHAT_H }, /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: MAIN_W, paddingX: 1 }, visible, busy ? /* @__PURE__ */ React.createElement(Text, { color: C.warn, paddingLeft: namePad() }, "  \u27F3 \u7F16\u6392\u4E2D\u2026") : null, scrollFromBottom > 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u2195 \u4E0A\u7FFB ", scrollFromBottom, " \u884C (PgDn \u56DE\u5E95)") : null), /* @__PURE__ */ React.createElement(Box, { width: 1 }, /* @__PURE__ */ React.createElement(Text, { color: C.border }, "\u2502".repeat(Math.max(1, CHAT_H)))), /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: SIDEBAR_W - 1, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.primary }, "\u{1F4E6} \u9879\u76EE\u6C60"), st.pool.map((p) => /* @__PURE__ */ React.createElement(Text, { key: p.id, color: p.status === "active" ? C.success : C.muted }, " ", p.status === "active" ? "\u{1F7E2}" : "\u23F8", " ", trunc(p.id, SIDEBAR_W - 10))), !st.pool.length ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  (\u7A7A)") : null, /* @__PURE__ */ React.createElement(Text, null, " "), /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.primary }, "\u{1F465} \u5458\u5DE5"), AGENTS.slice(0, Math.max(0, CHAT_H - 8 - st.pool.length * 1)).map(([id, name]) => /* @__PURE__ */ React.createElement(Text, { key: id, color: C.muted }, "  ", trunc(name, SIDEBAR_W - 8))), /* @__PURE__ */ React.createElement(Box, { marginTop: 1 }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "\u{1F4B0} \u2191", tok.p, " \u2193", tok.c)), notice ? /* @__PURE__ */ React.createElement(Text, { color: C.warn }, trunc(notice, SIDEBAR_W - 2)) : null)), /* @__PURE__ */ React.createElement(Box, { borderStyle: "round", borderColor: C.border, paddingX: 1, width: W }, /* @__PURE__ */ React.createElement(Text, { color: C.primary, bold: true }, "\u276F "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, input), !busy ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "_") : /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "\u27F3")), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " Enter \u53D1\u9001 \xB7 x \u5C55\u5F00 \xB7 PgUp/PgDn \u7FFB\u9875 \xB7 p \u9879\u76EE \xB7 a \u5458\u5DE5 \xB7 b \u8D26\u5355 \xB7 h \u5386\u53F2 \xB7 Ctrl+C \u9000\u51FA"));
}
function namePad() {
  return 4;
}
var idx = process.argv.indexOf("--dir");
var dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) {
  console.error("\u76EE\u5F55\u4E0D\u5B58\u5728:", dirArg);
  process.exit(1);
}
render(/* @__PURE__ */ React.createElement(App, { initialDir: dirArg }), { patchConsole: false });
