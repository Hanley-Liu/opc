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
  panelBg: "#16161e"
};
var COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
var PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
var MAX_RESULT = 10;
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
  return r.length <= w ? s : r.slice(0, Math.max(0, w - 1)).join("") + "\u2026";
};
var AGENTS = [
  { id: "build", name: "Sisyphus", desc: "COO\xB7\u7F16\u6392\u515C\u5E95" },
  { id: "product-manager", name: "\u4EA7\u54C1\u7ECF\u7406", desc: "\u9700\u6C42PRD" },
  { id: "architect", name: "\u67B6\u6784\u5E08", desc: "\u7CFB\u7EDF\u8BBE\u8BA1" },
  { id: "developer", name: "\u5F00\u53D1\u8005", desc: "\u7F16\u7801\u5B9E\u73B0" },
  { id: "tester", name: "\u6D4B\u8BD5\u5458", desc: "\u8D28\u91CF\u4FDD\u8BC1" },
  { id: "security-auditor", name: "\u5B89\u5168\u5BA1\u8BA1", desc: "\u6F0F\u6D1E\u626B\u63CF" },
  { id: "docs-writer", name: "\u6587\u6863", desc: "README\u6559\u7A0B" },
  { id: "marketing-growth", name: "\u589E\u957F\u8425\u9500", desc: "\u6DA8\u661F\u63A8\u5E7F" },
  { id: "github-agent", name: "\u53D1\u5E03\u5B98", desc: "git\u63A8\u9001" },
  { id: "devops-release", name: "\u53D1\u5E03\u5DE5\u7A0B", desc: "\u7248\u672CCI" },
  { id: "analyst", name: "\u5206\u6790\u5E08", desc: "\u6570\u636E\u6D1E\u5BDF" },
  { id: "legal-compliance", name: "\u6CD5\u52A1", desc: "License\u5408\u89C4" }
];
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  return { pool, active: pool.filter((p) => p.status === "active"), running: !!eng.running };
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
    if (m.query) return m.query;
    if (m.url) return m.url;
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
function Entry({ e, w }) {
  switch (e.type) {
    case "user":
      return /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color: C.secondary, bold: true }, "\u258C "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, e.text));
    case "assistant":
      return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, (e.body || "").split("\n").map((l, i) => /* @__PURE__ */ React.createElement(Text, { key: i }, /* @__PURE__ */ React.createElement(Text, { color: C.primary, bold: true }, "\u258C "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, l))), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  " + (e.meta || "")));
    case "tool":
      return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, null, /* @__PURE__ */ React.createElement(Text, { color: C.tool, bold: true }, "\u26A1 "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, e.tool, " "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, trunc(prettyParams(e.args), Math.max(20, w - 16)))));
    case "result": {
      const color = e.ok ? C.success : C.error;
      const lines = String(e.output ?? "").replace(/\n+$/, "").split("\n").slice(0, MAX_RESULT);
      return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", paddingLeft: 4 }, lines.map((l, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color }, (i === 0 ? e.ok ? "\u2713 " : "\u2716 " : "  ") + l)));
    }
    case "info":
      return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, e.text));
    case "error":
      return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, { color: C.error }, "\u2716 ", e.text));
    default:
      return null;
  }
}
function Dialog({ title, items, sel, onSelect, onClose, width }) {
  return /* @__PURE__ */ React.createElement(Box, { position: "absolute", justifyContent: "center", width, marginTop: 2 }, /* @__PURE__ */ React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: C.primary,
      paddingX: 1,
      width: Math.min(72, width - 6),
      backgroundColor: C.panelBg
    },
    /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.primary }, " ", title),
    items.map((it, i) => /* @__PURE__ */ React.createElement(
      Text,
      {
        key: i,
        backgroundColor: i === sel ? C.hiBg : void 0,
        color: i === sel ? C.text : C.muted
      },
      " ",
      i === sel ? "\u25B6 " : "  ",
      it.label
    )),
    /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " \u2191\u2193\u9009\u62E9 \xB7 Enter\u786E\u8BA4 \xB7 Esc\u5173\u95ED")
  ));
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
  const [scrollOffset, setScrollOffset] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [focusProj, setFocusProj] = useState(null);
  const [notice, setNotice] = useState("");
  const pendingToolRef = useRef(null);
  useEffect(() => {
    process.stdout.write("\x1B[?1049h\x1B[H");
    const t = setInterval(() => setTick((x) => x + 1), 1200);
    return () => {
      clearInterval(t);
      process.stdout.write("\x1B[?1049l");
    };
  }, []);
  const push = useCallback((e) => setEntries((prev) => [...prev.slice(-199), e]), []);
  const notice_ = useCallback((text, isErr) => {
    push(isErr ? { id: nid(), type: "error", text } : { id: nid(), type: "info", text });
  }, [push]);
  const handleEngineEvent = useCallback((ev) => {
    setEntries((prev) => [...prev.slice(-199), { ...ev, id: ev.run + ":" + ev.type + ":" + (ev.tool || "") + ":" + Math.random().toString(36).slice(2, 6) }]);
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model);
        setTok((t) => t + (ev.prompt_tokens || 0) + (ev.completion_tokens || 0));
        break;
      case "tool":
        pendingToolRef.current = ev;
        break;
      case "result":
        pendingToolRef.current = null;
        break;
      case "run-done": {
        pendingToolRef.current = null;
        const tk = ev.tokens || {};
        setTok((t) => t + (tk.total || ev.total_tokens || 0));
        setBusy(false);
        break;
      }
      case "llm-error":
        setBusy(false);
        break;
    }
    setScrollOffset(0);
  }, [model]);
  const submitTask = useCallback((task, forceAgent, forceDir) => {
    let dir = forceDir || initialDir;
    if (!forceDir) {
      const st2 = companyState();
      for (const p of st2.pool) if (task.toLowerCase().includes(p.id.toLowerCase())) {
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
    child.on("close", (code) => {
      pendingToolRef.current = null;
      setBusy(false);
      if (code !== 0) notice_(`\u9000\u51FA\u7801 ${code}`, true);
    });
  }, [initialDir, focusProj, push, notice_, handleEngineEvent]);
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (dialog) {
      const list = dialogList(dialog.type);
      if (key.upArrow) setDialog((d) => ({ ...d, sel: Math.max(0, d.sel - 1) }));
      if (key.downArrow) setDialog((d) => ({ ...d, sel: Math.min(list.length - 1, d.sel + 1) }));
      if (key.escape) setDialog(null);
      if (key.return) {
        const it = list[dialog.sel];
        if (it) it.onPick?.();
        if (dialog.type !== "bill" && dialog.type !== "history") setDialog(null);
      }
      return;
    }
    if (ch === "p" && !input && !busy) {
      setDialog({ type: "proj", sel: 0 });
      return;
    }
    if (ch === "a" && !input && !busy) {
      setDialog({ type: "agent", sel: 0 });
      return;
    }
    if (ch === "b" && !input) {
      setDialog({ type: "bill", sel: 0 });
      return;
    }
    if (ch === "h" && !input) {
      setDialog({ type: "history", sel: 0 });
      return;
    }
    if (key.pageUp) {
      setScrollOffset((o) => o + 10);
      return;
    }
    if (key.pageDown) {
      setScrollOffset((o) => Math.max(0, o - 10));
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
    if (key.backspace || key.delete) {
      setInput((i) => i.slice(0, -1));
      return;
    }
    if (key.escape) {
      setInput("");
      setFocusProj(null);
      return;
    }
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput((i) => i + ch);
    }
  });
  function dialogList(type) {
    if (type === "proj") {
      const st2 = companyState();
      const items = st2.pool.map((p) => ({
        label: `${p.status === "active" ? "\u{1F7E2}" : "\u23F8"} ${p.id} \xB7 \u8FDE\u8D25${p.fail_streak || 0}`,
        onPick: () => {
          setFocusProj(p.id);
          notice_("\u5DF2\u805A\u7126\u9879\u76EE: " + p.id);
        }
      }));
      items.push({ label: "\u{1F310} \u5168\u90E8\u9879\u76EE(\u4E0D\u805A\u7126)", onPick: () => {
        setFocusProj(null);
        notice_("\u5DF2\u53D6\u6D88\u805A\u7126");
      } });
      return items;
    }
    if (type === "agent") {
      return AGENTS.map((a) => ({
        label: `${a.name.padEnd(12)} ${a.desc}`,
        onPick: () => {
          submitTask(`\u5411${a.name}\u62A5\u5230\u5E76\u7B80\u8FF0\u4F60\u7684\u804C\u8D23`, a.id);
        }
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
      case "/help":
        notice_("\u76F4\u63A5\u8F93\u5165\u4EFB\u52A1\u6D3E\u6D3B \xB7 p \u9879\u76EE\u805A\u7126 \xB7 a \u5458\u5DE5\u67E5\u770B \xB7 b \u8D26\u5355 \xB7 h \u5386\u53F2 \xB7 /new name \u9700\u6C42");
        break;
      case "/clear":
        setEntries([]);
        break;
      case "/exit":
        exit();
        break;
      case "/new": {
        const sp = arg.indexOf(" ");
        if (sp < 1) {
          notice_("\u7528\u6CD5: /new <name> <\u9700\u6C42\u63CF\u8FF0>", true);
          break;
        }
        bootstrapNew(arg.slice(0, sp), arg.slice(sp + 1));
        break;
      }
      case "/engine":
        try {
          execFileSync(path.join(os.homedir(), ".local/bin/opc-engine"), [arg || "status"], { timeout: 15e3, encoding: "utf8" });
          notice_("\u5F15\u64CE: " + (arg === "stop" ? "\u5DF2\u505C\u6B62 \u23F9" : "\u64CD\u4F5C\u5B8C\u6210"));
        } catch (e) {
          notice_("\u5931\u8D25: " + e.message, true);
        }
        break;
      default:
        notice_("\u672A\u77E5\u547D\u4EE4 " + cmd + "\uFF0C\u8BD5\u8BD5 /help");
    }
  }
  function bootstrapNew(name, requirement) {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });
    notice_(`\u{1F3D7} \u300C${name}\u300D\u5F00\u5DE5\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u5165\u6C60\u6C38\u52A8`);
    setBusy(true);
    const child = spawn(
      "opc-agent",
      [
        "run",
        `FULL LIFECYCLE for new project '${name}'. Requirement: ${requirement}. Work in cwd. Phases: product-manager -> architect -> developer -> tester(tests pass) -> security-auditor -> legal(MIT Hanley-Liu) -> docs-writer(README.md+README.zh-CN.md) -> designer(docs/assets/banner.svg) -> community files -> git init & push to github.com/Hanley-Liu/${name} (GITHUB_TOKEN set, insteadOf rewrite active) -> devops-release(topics+description). Decide everything yourself, never ask.`,
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
        notice_(`\u{1F389} \u300C${name}\u300D\u5EFA\u6210\u5165\u6C60\u6C38\u52A8\uFF01`);
      } else notice_(`\u300C${name}\u300D\u6784\u5EFA\u672A\u5B8C\u6210(code=${code})`, true);
    });
  }
  const st = companyState();
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;
  const breath = tick % 2 === 0 ? "\u25CF" : "\u25CB";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const visibleH = H - 6;
  const total = entries.length;
  const end = Math.max(0, total - scrollOffset);
  const start = Math.max(0, end - visibleH);
  const visible = entries.slice(start, end);
  const header = lipglosslessRow([
    ["\u232C OPC \u6C38\u52A8\u516C\u53F8", C.primary, true],
    [`\u5F15\u64CE ${st.running ? "\u25CF \u8FD0\u8F6C\u4E2D" : "\u25CB \u505C\u6B62"}`, st.running ? C.success : C.muted],
    [`\u6C60 ${st.active.length}/${st.pool.length}`, C.text],
    [`\u5458\u5DE5 ${AGENTS.length}`, C.text],
    [focusProj ? `\u{1F3AF} ${focusProj}` : "\u{1F310} \u5168\u90E8", C.warn],
    [trunc(model, 30), C.muted],
    [`\u2191\u2193${tok} tok`, C.muted]
  ], W);
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", height: H }, /* @__PURE__ */ React.createElement(
    Box,
    {
      borderStyle: { topLeft: "\u256D", top: "\u2500", topRight: "\u256E", left: "\u2502", right: "\u2502", bottomLeft: "\u2570", bottom: "\u2500", bottomRight: "\u256F" },
      borderColor: C.border,
      width: W
    },
    /* @__PURE__ */ React.createElement(Text, null, header)
  ), /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", height: visibleH, paddingX: 1 }, start > 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u2191\u2191 \u66F4\u65E9 (", start, " \u6761\uFF0CPgUp \u7FFB\u770B)") : null, visible.map((e) => /* @__PURE__ */ React.createElement(Entry, { key: e.id, e, w: W - 4 })), total === 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u7A7A\u7A7A\u5982\u4E5F\u3002\u8F93\u5165\u4EFB\u52A1\u6D3E\u6D3B\uFF0C\u6216\u6309 h \u770B\u5386\u53F2\u3002") : null, scrollOffset > 0 ? null : busy ? /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "  \u27F3 \u7F16\u6392\u4E2D\u2026") : null), /* @__PURE__ */ React.createElement(Box, { borderStyle: "round", borderColor: C.border, paddingX: 1, width: W }, /* @__PURE__ */ React.createElement(Text, { color: C.primary, bold: true }, "\u276F "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, input), !busy ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "_") : null), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " Enter\u53D1\u9001 \xB7 p\u9879\u76EE a\u5458\u5DE5 b\u8D26\u5355 h\u5386\u53F2 /new\u5EFA\u9879 \xB7 PgUp/PgDn\u7FFB\u9875 \xB7 Ctrl+C \u9000\u51FA"), dialog ? dialog.type === "bill" ? /* @__PURE__ */ React.createElement(BillDialog, { onClose: () => setDialog(null), width: W }) : dialog.type === "history" ? /* @__PURE__ */ React.createElement(HistoryDialog, { onClose: () => setDialog(null), width: W }) : /* @__PURE__ */ React.createElement(
    Dialog,
    {
      title: dialog.type === "proj" ? "\u{1F4E6} \u9009\u62E9\u805A\u7126\u9879\u76EE" : "\u{1F464} \u9009\u62E9\u5458\u5DE5",
      items: dialogList(dialog.type),
      sel: dialog.sel,
      width: W
    }
  ) : null);
}
function lipglosslessRow(segments, width) {
  const out = segments.map(([text, color, bold]) => {
    const style = bold ? "\x1B[1m" : "";
    return `\x1B[38;2;${hexToRgb(color)}m${style}${text}\x1B[0m`;
  }).join(dimSep());
  return " " + truncAnsi(out, width - 2);
}
function dimSep() {
  return "\x1B[38;2;85;95;137m \xB7 \x1B[0m";
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${n >> 16 & 255};${n >> 8 & 255};${n & 255}`;
}
function truncAnsi(s, w) {
  let visible = 0, out = "", i = 0;
  while (i < s.length && visible < w) {
    if (s[i] === "\x1B") {
      while (i < s.length && !/[a-zA-Z]/.test(s[i])) i++;
      i++;
      continue;
    }
    out += s[i];
    visible++;
    i++;
  }
  return out;
}
function BillDialog({ onClose, width }) {
  const events = readEventsLocal(6e3);
  const byModel = {};
  for (const e of events) {
    if (e.type !== "llm") continue;
    const key = e.model || "(unknown)";
    const m = byModel[key] ||= { calls: 0, p: 0, c: 0 };
    m.calls++;
    m.p += e.prompt_tokens || 0;
    m.c += e.completion_tokens || 0;
  }
  const rows = Object.values(byModel).sort((a, b) => b.calls - a.calls);
  const tot = rows.reduce((s, m) => s + m.p + m.c, 0);
  return /* @__PURE__ */ React.createElement(Box, { position: "absolute", justifyContent: "center", width, marginTop: 2 }, /* @__PURE__ */ React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: C.primary,
      paddingX: 1,
      width: Math.min(76, width - 6),
      backgroundColor: C.panelBg
    },
    /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.primary }, " \u{1F4CA} Token \u8D26\u5355"),
    rows.map((m, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: C.text }, "  ", trunc(m.model, 34), "  ", m.calls, " \u6B21  \u2191", m.p.toLocaleString(), " \u2193", m.c.toLocaleString())),
    rows.length === 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u6682\u65E0\u8C03\u7528") : /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u5408\u8BA1 ", tot.toLocaleString(), " tokens"),
    /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " Esc \u5173\u95ED")
  ));
}
function HistoryDialog({ onClose, width }) {
  const events = readEventsLocal(4e3).filter((e) => ["run-done", "iteration-done", "iteration-failed", "run-start"].includes(e.type)).slice(-18).reverse();
  return /* @__PURE__ */ React.createElement(Box, { position: "absolute", justifyContent: "center", width, marginTop: 2 }, /* @__PURE__ */ React.createElement(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: C.primary,
      paddingX: 1,
      width: Math.min(80, width - 6),
      backgroundColor: C.panelBg
    },
    /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.primary }, " \u{1F4DC} \u4EFB\u52A1\u5386\u53F2"),
    events.map((e, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: e.type.includes("fail") ? C.error : C.text }, (e.ts || "").slice(5, 19), " [", e.project || e.agent, "] ", e.type.replace("iteration-", ""), " ", trunc(e.summary || e.output || "", 44))),
    events.length === 0 ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "  \u6682\u65E0") : null,
    /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " Esc \u5173\u95ED")
  ));
}
function readEventsLocal(limit) {
  try {
    const f = path.join(os.homedir(), ".local/share/opencode/company/activity.jsonl");
    return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).slice(-limit).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}
var idx = process.argv.indexOf("--dir");
var dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) {
  console.error("\u76EE\u5F55\u4E0D\u5B58\u5728:", dirArg);
  process.exit(1);
}
render(/* @__PURE__ */ React.createElement(App, { initialDir: dirArg }), { patchConsole: false });
