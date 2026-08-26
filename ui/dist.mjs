#!/usr/bin/env node

// opc.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { spawn, execFileSync } from "node:child_process";
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
  hiBg: "#292e42"
};
var COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
var PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
var MAX_RESULT = 12;
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
  return r.length <= w ? s : r.slice(0, w - 1).join("") + "\u2026";
};
var AGENTS = [
  { id: "build", name: "Sisyphus (COO)", desc: "\u7F16\u6392\xB7\u515C\u5E95\u63A5\u5355" },
  { id: "product-manager", name: "\u4EA7\u54C1\u7ECF\u7406", desc: "\u9700\u6C42\u5206\u6790 PRD" },
  { id: "architect", name: "\u67B6\u6784\u5E08", desc: "\u7CFB\u7EDF\u8BBE\u8BA1" },
  { id: "developer", name: "\u5F00\u53D1\u8005", desc: "\u7F16\u7801\u5B9E\u73B0" },
  { id: "tester", name: "\u6D4B\u8BD5\u5458", desc: "\u8D28\u91CF\u4FDD\u8BC1" },
  { id: "security-auditor", name: "\u5B89\u5168\u5BA1\u8BA1", desc: "\u6F0F\u6D1E\u626B\u63CF" },
  { id: "docs-writer", name: "\u6587\u6863\u5DE5\u7A0B\u5E08", desc: "README/\u6559\u7A0B" },
  { id: "marketing-growth", name: "\u589E\u957F\u8425\u9500", desc: "\u6DA8\u661F\u63A8\u5E7F" },
  { id: "github-agent", name: "\u53D1\u5E03\u5B98", desc: "git push" },
  { id: "devops-release", name: "\u53D1\u5E03\u5DE5\u7A0B", desc: "\u7248\u672C/CI" },
  { id: "analyst", name: "\u5206\u6790\u5E08", desc: "\u6570\u636E\u6D1E\u5BDF" },
  { id: "legal-compliance", name: "\u6CD5\u52A1", desc: "License\u5408\u89C4" },
  { id: "hr-manager", name: "HR", desc: "\u62DB\u8058\u89E3\u96C7" }
];
function readEvents(limit) {
  try {
    return fs.readFileSync(path.join(COMPANY, "activity.jsonl"), "utf8").trim().split("\n").filter(Boolean).slice(-limit).map((l) => {
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
function App({ initialDir }) {
  const { exit } = useApp();
  const [nav, setNav] = useState({ mode: "root", proj: null, agent: null, act: null, sel: 0, detailSel: 0 });
  const [events, setEvents] = useState(() => readEvents(600));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null);
  const [model, setModel] = useState("zen/laguna-s-2.1-free");
  const [tok, setTok] = useState(0);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState("");
  const pendingToolRef = useRef(null);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1200);
    return () => clearInterval(t);
  }, []);
  const pushNotice = useCallback((text, isError) => {
    setNotice(isError ? "\u2716 " + text : text);
    setTimeout(() => setNotice((n) => n === (isError ? "\u2716 " + text : text) ? "" : n), 6e3);
  }, []);
  const handleEngineEvent = useCallback((ev) => {
    setEvents((prev) => [...prev.slice(-599), ev]);
    switch (ev.type) {
      case "llm":
        setModel(ev.model || "\u2026");
        setTok((t) => t + (ev.prompt_tokens || 0) + (ev.completion_tokens || 0));
        break;
      case "tool":
        if (pendingToolRef.current) pushNotice("(\u4E0A\u4E00\u4E2A\u5DE5\u5177\u65E0\u7ED3\u679C)", true);
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
        pendingToolRef.current = null;
        setBusy(false);
        break;
    }
  }, []);
  const submitTask = useCallback((task, forceAgent, forceDir) => {
    if (!task.trim() || busy) return;
    let dir = forceDir || initialDir;
    if (!forceDir) {
      const pool2 = readJSON(path.join(COMPANY, "pool.json"), []);
      for (const p of pool2) if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const d = path.join(PROJECTS, p.id);
        if (fs.existsSync(d)) dir = d;
        break;
      }
    }
    const agentID = forceAgent || route(task);
    setBusy(true);
    setNav((n) => ({ ...n, mode: "act", act: { kind: "live" }, sel: 0, detailSel: 0 }));
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
      pushNotice("\u542F\u52A8\u5931\u8D25: " + e.message, true);
    });
    child.on("close", (code) => {
      pendingToolRef.current = null;
      setBusy(false);
      if (code !== 0) pushNotice(`\u9000\u51FA\u7801 ${code}\uFF0C\u8BE6\u89C1\u5BA1\u8BA1\u65E5\u5FD7`, true);
    });
  }, [busy, initialDir, handleEngineEvent]);
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const st = { running: readJSON(path.join(COMPANY, "engine.json"), {}).running };
  function getItems() {
    if (nav.mode === "root") {
      const items2 = pool.map((p) => ({
        label: `${p.status === "active" ? "\u{1F7E2}" : "\u23F8"} ${p.id}  ${p.status === "active" ? "\u6C38\u52A8\u4E2D" : "\u5DF2\u6682\u505C"} \xB7 \u8FDE\u8D25${p.fail_streak || 0} \xB7 \u6BCF${p.interval_min}\u5206`,
        value: { kind: "proj", id: p.id }
      }));
      items2.push({ label: "\u2795 \u65B0\u5EFA\u9879\u76EE (/new name \u9700\u6C42)", value: { kind: "newproj" } });
      items2.push({ label: "\u{1F4AC} \u76F4\u63A5\u6D3E\u4E34\u65F6\u4EFB\u52A1\uFF08\u5728\u4E0B\u65B9\u8F93\u5165\uFF09", value: { kind: "noop" } });
      return items2;
    }
    if (nav.mode === "proj") {
      const items2 = AGENTS.map((a) => ({
        label: `${a.name.padEnd(14)} ${a.desc}`,
        value: { kind: "agent", id: a.id }
      }));
      return items2;
    }
    if (nav.mode === "agent") {
      return [
        { label: "\u{1F4DD} \u6D3E\u4EFB\u52A1\u7ED9\u8FD9\u4F4D\u5458\u5DE5\uFF08\u4E0B\u65B9\u8F93\u5165\uFF0CEnter \u53D1\u9001\uFF09", value: { kind: "assign" } },
        { label: "\u{1F4DC} TA \u7684\u5168\u90E8\u6D3B\u52A8\u6D41\u6C34", value: { kind: "stream" } },
        { label: "\u2705 \u5DF2\u5B8C\u6210\u4EFB\u52A1", value: { kind: "done" } },
        { label: "\u2716 \u5931\u8D25\u4E0E\u62A5\u9519", value: { kind: "fail" } }
      ];
    }
    return [];
  }
  const items = getItems();
  function filteredEvents() {
    const want = nav.act?.kind;
    return events.filter((e) => {
      if (nav.proj && e.project !== nav.proj) return false;
      if (nav.agent && e.agent !== nav.agent) return false;
      if (want === "done") return e.type === "run-done";
      if (want === "fail") return e.type === "llm-error" || e.type === "result" && e.status !== "success";
      return ["tool", "result", "llm"].includes(e.type);
    }).reverse();
  }
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (nav.mode === "act" && nav.act?.kind?.startsWith?.("detail:")) {
      if (key.upArrow) setNav((n) => ({ ...n, detailSel: Math.max(0, n.detailSel - 1) }));
      if (key.downArrow) setNav((n) => ({ ...n, detailSel: n.detailSel + 1 }));
      if (key.escape) setNav((n) => ({ ...n, mode: "act", act: { kind: nav.act.listKind }, detailSel: 0 }));
      if (ch && !key.return) {
        setInput((i) => i + ch);
      }
      if (key.return) {
        const txt = input.trim();
        if (txt) {
          setInput("");
          submitTask(txt, nav.agent, path.join(PROJECTS, nav.proj));
        }
      }
      return;
    }
    if (key.upArrow) setNav((n) => ({ ...n, sel: Math.max(0, n.sel - 1) }));
    if (key.downArrow) setNav((n) => ({ ...n, sel: Math.min(items.length - 1, n.sel + 1) }));
    if (key.escape) {
      setInput("");
      setNav((n) => {
        if (n.mode === "act") return { ...n, mode: n.agent ? "agent" : n.proj ? "proj" : "root", act: null, sel: 0 };
        if (n.mode === "agent") return { ...n, mode: "proj", agent: null, sel: 0 };
        if (n.mode === "proj") return { ...n, mode: "root", proj: null, sel: 0 };
        return n;
      });
      return;
    }
    if (key.return) {
      const txt = input.trim();
      if (txt) {
        setInput("");
        if (nav.mode === "agent") submitTask(txt, nav.agent, path.join(PROJECTS, nav.proj));
        else if (nav.mode === "proj") submitTask(txt, null, path.join(PROJECTS, nav.proj));
        else submitTask(txt);
        return;
      }
      const it = items[nav.sel];
      if (!it) return;
      const v = it.value;
      if (v.kind === "proj") setNav((n) => ({ ...n, mode: "proj", proj: v.id, agent: null, sel: 0 }));
      else if (v.kind === "agent") setNav((n) => ({ ...n, mode: "agent", agent: v.id, sel: 0 }));
      else if (v.kind === "noop") pushNotice("\u76F4\u63A5\u5728\u4E0B\u65B9\u9762\u677F\u8F93\u5165\u6587\u5B57\u5373\u53EF");
      else if (v.kind === "newproj") pushNotice("\u8F93\u5165: /new \u540D\u79F0 \u9700\u6C42\u63CF\u8FF0");
      else if (v.kind === "assign") pushNotice(`\u5DF2\u5728\u4E0B\u65B9\u9762\u677F\u8F93\u5165\u5373\u53EF\u6307\u6D3E\u7ED9 ${nav.agent}`);
      else if (["stream", "done", "fail"].includes(v.kind)) {
        setNav((n) => ({ ...n, mode: "act", act: { kind: "detail:" + v.kind, listKind: v.kind }, sel: 0, detailSel: 0 }));
      }
      return;
    }
    if (key.backspace || key.delete) {
      if (input) setInput((i) => i.slice(0, -1));
      else setNav((n) => {
        if (n.mode === "act") return { ...n, mode: n.agent ? "agent" : n.proj ? "proj" : "root", act: null };
        if (n.mode === "agent") return { ...n, mode: "proj", agent: null };
        if (n.mode === "proj") return { ...n, mode: "root", proj: null };
        return n;
      });
      return;
    }
    if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput((i) => i + ch);
    }
  });
  const crumb = ["\u{1F3E2} \u516C\u53F8"];
  if (nav.proj) crumb.push("\u{1F4E6} " + nav.proj);
  if (nav.agent) crumb.push("\u{1F464} " + AGENTS.find((a) => a.id === nav.agent)?.name);
  if (nav.mode === "act") crumb.push(nav.act?.kind === "live" ? "\u{1F534} \u5B9E\u51B5" : "\u{1F4CB} " + (nav.act.listKind || ""));
  const breath = tick % 2 === 0 ? "\u25CF" : "\u25CB";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  const poolActive = pool.filter((p) => p.status === "active").length;
  function renderBody() {
    const W = 110;
    if (nav.mode === "root") {
      const lines = [
        `\u5F15\u64CE ${st.running ? "\u8FD0\u8F6C\u4E2D \u25CF" : "\u505C\u6B62 \u25CB"} \xB7 \u9879\u76EE\u6C60 ${poolActive}/${pool.length} \xB7 \u672C\u8FDB\u7A0B token \u2191\u2193${tok}`,
        ""
      ];
      return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, lines.map((l, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: C.muted }, l)));
    }
    if (nav.mode === "act") {
      const evs = filteredEvents();
      if (nav.act.kind === "live") {
        const recent = evs.slice(-18);
        return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, recent.map((e, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: C.muted }, (e.ts || "").slice(11, 19), " ", e.type === "tool" ? /* @__PURE__ */ React.createElement(React.Fragment, null, "\u26A1 ", e.tool, ": ", trunc(prettyParams(e.args), 70)) : e.type === "llm" ? /* @__PURE__ */ React.createElement(React.Fragment, null, "\u{1F9E0} ", trunc(e.model, 26), " \u2191", e.prompt_tokens || 0, " \u2193", e.completion_tokens || 0) : e.type === "result" ? /* @__PURE__ */ React.createElement(React.Fragment, null, e.status === "success" ? "\u2713" : "\u2716", " ", trunc(e.output, 70)) : e.type === "run-done" ? /* @__PURE__ */ React.createElement(React.Fragment, null, GREEN, "\u25A0 \u5B8C\u6210", R, " ", trunc(e.summary || e.output, 60)) : trunc(e.type, 30))), recent.length === 0 ? /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "\u7B49\u5F85\u4E8B\u4EF6\u2026") : null);
      }
      const sel = Math.min(nav.detailSel, Math.max(0, evs.length - 1));
      const cur = evs[sel];
      return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, evs.slice(0, 40).map((e, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: i === sel ? C.text : C.muted }, i === sel ? "\u25B6 " : "  ", (e.ts || "").slice(11, 19), " ", e.type === "tool" ? `\u26A1 ${e.tool}: ${trunc(prettyParams(e.args), 46)}` : e.type === "result" ? `${e.status === "success" ? "\u2713" : "\u2716"} ${trunc(e.output, 50)}` : e.type === "llm" ? `\u{1F9E0} ${(e.model || "").split("/").pop()} \u2191${e.prompt_tokens || 0}` : e.type === "run-done" ? `\u25A0 ${trunc(e.summary || e.output, 50)}` : e.type === "llm-error" ? `\u26A0 ${trunc(e.error, 50)}` : trunc(e.type, 30))), cur ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Text, null, " "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, "\u2500\u2500 \u9009\u4E2D\u8BE6\u60C5 (", sel + 1, "/", evs.length, ") \u2500\u2500"), /* @__PURE__ */ React.createElement(Text, { color: C.text }, prettyParams(cur.input || "")), String(cur.output || "").split("\n").slice(0, MAX_RESULT).map((l, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: cur.status === "success" ? C.success : C.error }, "  ", l))) : null, evs.length === 0 ? /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "\u6682\u65E0\u8BB0\u5F55") : null);
    }
    return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, items.map((it, i) => /* @__PURE__ */ React.createElement(
      Text,
      {
        key: i,
        backgroundColor: i === nav.sel ? C.hiBg : void 0,
        color: i === nav.sel ? C.text : C.muted
      },
      " ",
      i === nav.sel ? "\u25B6" : " ",
      it.label
    )));
  }
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true, color: C.primary }, " \u232C OPC "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, crumb.join(" \u203A "))), /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", marginTop: 1, marginBottom: 1 }, renderBody()), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, nav.mode === "act" && nav.act?.kind?.startsWith?.("detail:") ? "\u2191\u2193\u6D4F\u89C8 \xB7 Esc\u8FD4\u56DE \xB7 \u8F93\u5165\u6587\u5B57=\u7ED9\u8BE5\u9879\u76EE/\u5458\u5DE5\u6D3E\u4EFB\u52A1" : "\u2191\u2193\u9009\u62E9 \xB7 Enter\u8FDB\u5165/\u53D1\u9001 \xB7 Esc\u8FD4\u56DE \xB7 \u76F4\u63A5\u8F93\u5165\u6587\u5B57=\u6D3E\u4EFB\u52A1"), notice ? /* @__PURE__ */ React.createElement(Text, { color: C.warn }, notice) : null, /* @__PURE__ */ React.createElement(Box, { borderStyle: "round", borderColor: C.border, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { color: C.primary, bold: true }, "\u276F "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, input), !busy ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "_") : /* @__PURE__ */ React.createElement(Text, { color: C.warn }, "\u27F3")), /* @__PURE__ */ React.createElement(Text, null, " ", /* @__PURE__ */ React.createElement(Text, { color: engColor }, breath), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, ` \u5F15\u64CE:${st.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62"} \xB7 \u6C60:${poolActive}/${pool.length} \xB7 ${trunc(model, 28)} \xB7 \u2191\u2193${tok} tok`)));
}
var R = "\x1B[0m";
var GREEN = "\x1B[32m";
var idx = process.argv.indexOf("--dir");
var dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) {
  console.error("\u76EE\u5F55\u4E0D\u5B58\u5728:", dirArg);
  process.exit(1);
}
render(/* @__PURE__ */ React.createElement(App, { initialDir: dirArg }), { patchConsole: false });
