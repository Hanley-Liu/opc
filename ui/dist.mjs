#!/usr/bin/env node

// opc.jsx
import React, { useState, useEffect, useCallback } from "react";
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
  tool: "#7dcfff",
  warn: "#e0af68"
};
var COMPANY = path.join(os.homedir(), ".local/share/opencode/company");
var PROJECTS = path.join(os.homedir(), ".local/share/opencode/projects");
var MAX_RESULT = 10;
var idc = 0;
var nid = () => `e${++idc}`;
var trunc = (s, w) => {
  s = String(s ?? "").replace(/\n/g, " ");
  return s.length > w ? s.slice(0, w - 1) + "\u2026" : s;
};
function readJSON(f, d) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
}
function companyState() {
  const pool = readJSON(path.join(COMPANY, "pool.json"), []);
  const eng = readJSON(path.join(COMPANY, "engine.json"), { running: false });
  const active = pool.filter((p) => p.status === "active");
  return { pool, active, running: !!eng.running };
}
function Gutter({ color, children }) {
  return /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { color, bold: true }, "\u258C "), /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, children));
}
function UserBlock({ text }) {
  return /* @__PURE__ */ React.createElement(Gutter, { color: C.secondary }, /* @__PURE__ */ React.createElement(Text, { color: C.text }, text));
}
function AssistantBlock({ body, meta }) {
  return /* @__PURE__ */ React.createElement(Gutter, { color: C.primary }, /* @__PURE__ */ React.createElement(Text, { color: C.text }, body), meta ? /* @__PURE__ */ React.createElement(Text, { dimColor: true }, meta) : null);
}
function ToolRow({ e }) {
  return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, null, /* @__PURE__ */ React.createElement(Text, { color: C.tool, bold: true }, "\u26A1 "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, e.tool, " "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, trunc(prettyParams(e.args), 72))));
}
function ResultRow({ e }) {
  const color = e.ok ? C.success : C.error;
  const lines = String(e.output ?? "").replace(/\n+$/, "").split("\n");
  const shown = lines.slice(0, MAX_RESULT);
  const extra = lines.length - shown.length;
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", paddingLeft: 4 }, shown.map((l, i) => /* @__PURE__ */ React.createElement(Text, { key: i, color: i === 0 && !e.ok ? C.error : color }, (i === 0 ? e.ok ? "\u2713 " : "\u2716 " : "  ") + l)), extra > 0 ? /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "   \u2026 (+", extra, " \u884C)") : null);
}
function InfoRow({ text }) {
  return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, { dimColor: true }, text));
}
function Thinking() {
  return /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, { color: C.muted }, "\u27F3 \u7F16\u6392\u4E2D\u2026"));
}
function prettyParams(raw) {
  try {
    const m = JSON.parse(raw);
    if (m.command) return "$ " + m.command.replace(/\n/g, " ");
    if (m.path && m.old_string) return `${m.path} \u270E`;
    if (m.path && m.content) return `${m.path} \u271A${String(m.content).length}B`;
    if (m.path) return m.path;
    if (m.pattern) return "/" + m.pattern;
    if (m.agent) return `\u2192 ${m.agent}: ${m.task_desc || ""}`;
    if (m.query) return m.query;
    if (m.url) return m.url;
  } catch {
  }
  return raw;
}
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
  return "build";
}
function resolveDir(task, initialDir) {
  try {
    const pool = readJSON(path.join(COMPANY, "pool.json"), []);
    for (const p of pool) {
      if (task.toLowerCase().includes(p.id.toLowerCase())) {
        const dir = path.join(PROJECTS, p.id);
        if (fs.existsSync(dir)) return dir;
      }
    }
  } catch {
  }
  return initialDir;
}
function renderEntry(e) {
  switch (e.type) {
    case "user":
      return /* @__PURE__ */ React.createElement(UserBlock, { text: e.text });
    case "assistant":
      return /* @__PURE__ */ React.createElement(AssistantBlock, { body: e.body, meta: e.meta });
    case "tool":
      return /* @__PURE__ */ React.createElement(ToolRow, { e });
    case "result":
      return /* @__PURE__ */ React.createElement(ResultRow, { e });
    case "info":
      return /* @__PURE__ */ React.createElement(InfoRow, { text: e.text });
    case "error":
      return /* @__PURE__ */ React.createElement(InfoRow, { text: "\u2716 " + e.text });
    default:
      return null;
  }
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
  const pendingToolRef = React.useRef(null);
  const info = (text) => ({ id: nid(), type: "info", text });
  const flushPending = () => {
    if (pendingToolRef) {
      push({ ...pendingToolRef, hasResult: true, ok: false, output: "(\u65E0\u7ED3\u679C)" });
      pendingToolRef.current = null;
      setLive(null);
    }
  };
  const handleEngineEvent = (ev) => {
    switch (ev.type) {
      case "llm":
        setModel(ev.model || model);
        setTok((t) => t + (ev.prompt_tokens || 0) + (ev.completion_tokens || 0));
        break;
      case "tool":
        flushPending();
        pendingToolRef.current = { id: nid(), type: "tool", tool: ev.tool, args: ev.args };
        setLive(pendingToolRef.current);
        break;
      case "result": {
        if (pendingToolRef.current) {
          const t = pendingToolRef.current;
          pendingToolRef.current = null;
          push({ ...t, hasResult: true, ok: ev.status === "success", output: ev.output });
          setLive(null);
        } else {
          push({
            id: nid(),
            type: "result",
            ok: ev.status === "success",
            output: (ev.output || "").split("\n")[0]
          });
        }
        break;
      }
      case "run-done": {
        flushPending();
        const body = (ev.output || ev.summary || "").trim() || "(\u65E0\u8F93\u51FA)";
        const mdl = ev.model || model;
        const tk = ev.tokens || { prompt: 0, completion: 0, total: ev.total_tokens || 0 };
        setModel(mdl);
        push({
          id: nid(),
          type: "assistant",
          body,
          meta: `${mdl} \xB7 \u2191${tk.prompt} \u2193${tk.completion} tok \xB7 ${ev.duration || 0}ms`
        });
        setTok((t) => t + (tk.total || 0));
        setBusy(false);
        break;
      }
      case "llm-error":
        flushPending();
        push({ id: nid(), type: "error", text: "\u6A21\u578B\u9519\u8BEF: " + ev.error });
        setBusy(false);
        break;
      default:
        break;
    }
  };
  function readEvents(limit) {
    try {
      const f = path.join(COMPANY, "activity.jsonl");
      const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => {
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
  function cmdPool() {
    const st2 = companyState();
    if (!st2.pool.length) return push({ id: nid(), type: "info", text: "\u9879\u76EE\u6C60\u4E3A\u7A7A \u2014\u2014 /new <name> <\u9700\u6C42> \u521B\u5EFA" });
    push({ id: nid(), type: "info", text: st2.pool.map((p) => `${p.id} [${p.status === "active" ? "\u6C38\u52A8" : "\u6682\u505C"}] \u8FDE\u8D25${p.fail_streak || 0}${p.escalate ? "\xB7\u5F3A\u6A21\u578B" : ""} \u6BCF${p.interval_min}\u5206`).join("\n") });
  }
  function cmdBill() {
    const evts = readEvents(5e3);
    const byModel = {};
    for (const e of evts) {
      if (e.type !== "llm") continue;
      const keyName = e.model || "(\u672A\u77E5\u6A21\u578B)";
      const m = byModel[keyName] ||= { model: keyName, calls: 0, p: 0, c: 0 };
      m.calls++;
      m.p += e.prompt_tokens || 0;
      m.c += e.completion_tokens || 0;
    }
    const rows = Object.values(byModel).sort((a, b) => b.calls - a.calls).map((m) => `  ${m.model}: ${m.calls} \u6B21 \xB7 \u2191${m.p} \u2193${m.c} tok`);
    push({ id: nid(), type: "info", text: rows.join("\n") || "\u672C\u4F1A\u8BDD\u6682\u65E0\u6A21\u578B\u8C03\u7528\u8BB0\u5F55\uFF08\u5BA1\u8BA1\u6587\u4EF6\u4E3A\u5168\u91CF\u5386\u53F2\uFF09" });
  }
  function cmdHistory(pid) {
    const evts = readEvents(3e3).filter((e) => ["run-start", "run-done", "iteration-start", "iteration-done", "iteration-failed"].includes(e.type) && (!pid || e.project === pid));
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const e of evts.reverse()) {
      const key = e.ts + e.type + e.project;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${e.ts.slice(11, 19)} [${e.project || "-"}] ${e.type}${e.summary ? ": " + trunc(e.summary, 50) : e.output ? ": " + trunc(e.output, 50) : ""}`);
      if (out.length >= 20) break;
    }
    push({ id: nid(), type: "info", text: out.join("\n") || "\u6682\u65E0\u8FED\u4EE3\u8BB0\u5F55" });
  }
  function cmdLog(n) {
    const evts = readEvents(n);
    push({
      id: nid(),
      type: "info",
      text: evts.map((e) => `${e.ts.slice(11, 19)} ${String(e.agent).slice(0, 10)} ${e.type}${e.tool ? " " + e.tool : ""}`).join("\n") || "\u65E0\u4E8B\u4EF6"
    });
  }
  function cmdEngine(action) {
    const valid = { start: true, stop: true };
    if (!valid[action]) return push({ id: nid(), type: "error", text: "\u7528\u6CD5: /engine start|stop" });
    try {
      execFileSync(path.join(os.homedir(), ".local/bin/opc-engine"), [action], { timeout: 15e3 });
      push({ id: nid(), type: "info", text: `\u5F15\u64CE\u5DF2 ${action === "start" ? "\u542F\u52A8 \u25B6" : "\u505C\u6B62 \u23F9"}` });
    } catch (e) {
      push({ id: nid(), type: "error", text: "\u64CD\u4F5C\u5931\u8D25: " + e.message });
    }
  }
  function poolWrite(mutator) {
    const pf = path.join(COMPANY, "pool.json");
    const pool = readJSON(pf, []);
    mutator(pool);
    fs.writeFileSync(pf, JSON.stringify(pool, null, 1));
  }
  function poolOp(op, id) {
    if (!id) return push({ id: nid(), type: "error", text: `\u7528\u6CD5: /${op} <\u9879\u76EE\u540D>` });
    poolWrite((pool) => {
      for (const p of pool) if (p.id === id) {
        if (op === "pause") p.status = "paused";
        if (op === "resume") p.status = "active";
        if (op === "kill") p._del = true;
      }
      return pool.filter((p) => !p._del);
    });
    push({ id: nid(), type: "info", text: `${id} \u2192 ${op}` });
  }
  function poolBoost(id) {
    poolWrite((pool) => {
      for (const p of pool) if (p.id === id) {
        p.priority = 99;
        p.last_run = 0;
      }
    });
    push({ id: nid(), type: "info", text: `${id} \u5DF2\u63D2\u961F\uFF0C\u4E0B\u4E2A\u5FAA\u73AF\u7ACB\u5373\u8FED\u4EE3` });
  }
  function setKey(sk) {
    if (!sk.startsWith("sk-")) return push({ id: nid(), type: "error", text: "key \u5E94\u4EE5 sk- \u5F00\u5934" });
    const kf = path.join(COMPANY, "keys.json");
    const keys = readJSON(kf, {});
    keys.deepseek = sk.trim();
    fs.writeFileSync(kf, JSON.stringify(keys, null, 1));
    try {
      fs.chmodSync(kf, 384);
    } catch {
    }
    push({ id: nid(), type: "info", text: "DeepSeek key \u5DF2\u4FDD\u5B58\uFF08\u7591\u96BE\u6742\u75C7\u81EA\u52A8\u5347\u7EA7\u7528\uFF09" });
  }
  function bootstrap(name, requirement) {
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    const dir = path.join(PROJECTS, name);
    fs.mkdirSync(dir, { recursive: true });
    push({ id: nid(), type: "info", text: `\u{1F3D7} \u300C${name}\u300D\u5F00\u5DE5\uFF1A\u5F00\u53D1\u2192\u6D4B\u8BD5\u2192\u5B89\u5168\u2192\u6587\u6863\u2192\u53D1\u5E03\u5168\u81EA\u52A8\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u5165\u6C60\u6C38\u52A8\u3002\u8FDB\u5EA6\u770B\u540E\u7EED tool \u6D41\u6C34\u3002` });
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
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` } }
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
      if (code === 0 && fs.existsSync(path.join(dir, "README.md"))) {
        poolWrite((pool) => {
          if (!pool.some((p) => p.id === name))
            pool.push({ id: name, status: "active", interval_min: 60, priority: 5, last_run: 0, fail_streak: 0 });
        });
        push({ id: nid(), type: "info", text: `\u{1F389} \u300C${name}\u300D\u5EFA\u6210\u5165\u6C60\uFF0C\u5F00\u59CB\u6C38\u52A8\uFF01` });
      } else {
        push({ id: nid(), type: "error", text: `\u300C${name}\u300D\u6784\u5EFA\u9000\u51FA(code=${code})\u3002\u91CD\u8BD5: /new ${name} ${requirement.slice(0, 30)}\u2026` });
      }
    });
  }
  useEffect(() => {
    const st2 = companyState();
    push({
      id: nid(),
      type: "info",
      text: `\u516C\u53F8\u72B6\u6001: \u5F15\u64CE${st2.running ? "\u8FD0\u8F6C\u4E2D \u25CF" : "\u5DF2\u505C\u6B62 \u25CB"} \xB7 \u9879\u76EE\u6C60 ${st2.active.length}/${st2.pool.length} \u6C38\u52A8 (${st2.pool.map((p) => p.id + (p.status === "active" ? "" : "\u23F8")).join(", ") || "\u7A7A"})`
    });
    push({
      id: nid(),
      type: "info",
      text: "\u76F4\u63A5\u8F93\u5165\u4EFB\u52A1\u6D3E\u6D3B\uFF1B\u63D0\u5230\u6C60\u5185\u9879\u76EE\u540D\u4F1A\u81EA\u52A8\u8FDB\u5165\u8BE5\u9879\u76EE\u76EE\u5F55\u3002/pool /agents /clear /exit"
    });
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1200);
    return () => clearInterval(t);
  }, []);
  const push = useCallback((e) => setEntries((prev) => [...prev, e]), []);
  const submit = useCallback((task) => {
    const dir = resolveDir(task, initialDir);
    push({ id: nid(), type: "user", text: task });
    setBusy(true);
    const agentID = route(task);
    let buf = "";
    const child = spawn(
      "opc-agent",
      ["run", task, "--dir", dir, "--agent", agentID, "--json"],
      { env: { ...process.env, PATH: `${os.homedir()}/.local/bin:${process.env.PATH}` }, cwd: dir }
    );
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
    child.on("close", () => {
      flushPending();
      setBusy(false);
    });
    child.on("error", (e) => {
      flushPending();
      push({ id: nid(), type: "error", text: "\u542F\u52A8\u5931\u8D25: " + e.message });
      setBusy(false);
    });
  }, [initialDir, push, handleEngineEvent]);
  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (key.return) {
      const t = input.trim();
      if (!t || busy) return;
      setInput("");
      if (t === "/exit" || t === "/quit") {
        exit();
        return;
      }
      if (t === "/clear") {
        setEntries([]);
        return;
      }
      if (t === "/pool") {
        cmdPool();
        return;
      }
      if (t === "/agents") {
        push(info("\u7F16\u6392 build \xB7 \u89C4\u5212 product-manager \xB7 \u5F00\u53D1 developer \xB7 \u6D4B\u8BD5 tester \xB7 \u5B89\u5168 security-auditor \xB7 \u6587\u6863 docs-writer \xB7 \u8425\u9500 marketing-growth \xB7 \u53D1\u5E03 github-agent/devops-release \xB7 \u5206\u6790 analyst \xB7 \u6CD5\u52A1 legal-compliance \xB7 \u4EBA\u4E8B hr-manager"));
        return;
      }
      if (t === "/bill") {
        cmdBill();
        return;
      }
      if (t.startsWith("/history")) {
        cmdHistory(t.split(" ")[1] || "");
        return;
      }
      if (t.startsWith("/log")) {
        cmdLog(parseInt(t.split(" ")[1]) || 15);
        return;
      }
      if (t.startsWith("/engine ")) {
        cmdEngine(t.split(" ")[1]);
        return;
      }
      if (t.startsWith("/pause ")) {
        poolOp("pause", t.slice(7).trim());
        return;
      }
      if (t.startsWith("/resume ")) {
        poolOp("resume", t.slice(8).trim());
        return;
      }
      if (t.startsWith("/kill ")) {
        poolOp("kill", t.slice(5).trim());
        return;
      }
      if (t.startsWith("/go ")) {
        poolBoost(t.slice(3).trim());
        return;
      }
      if (t.startsWith("/new ")) {
        const rest = t.slice(4).trim();
        const sp = rest.indexOf(" ");
        if (sp < 1) {
          push(info("\u7528\u6CD5: /new <name> <\u9700\u6C42\u63CF\u8FF0>"));
          return;
        }
        bootstrap(rest.slice(0, sp), rest.slice(sp + 1));
        return;
      }
      if (t.startsWith("/key ")) {
        setKey(t.slice(5).trim());
        return;
      }
      if (t.startsWith("/")) {
        push(info("\u672A\u77E5\u547D\u4EE4\u3002\u53EF\u7528: /pool /agents /bill /history /log /engine /pause /resume /kill /go /new /key /clear /exit"));
        return;
      }
      submit(t);
    } else if (key.backspace || key.delete) {
      setInput((i) => i.slice(0, -1));
    } else if (ch && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
      setInput((i) => i + ch);
    }
  });
  const st = companyState();
  const breath = tick % 2 === 0 ? "\u25CF" : "\u25CB";
  const engColor = busy ? C.warn : st.running ? C.success : C.muted;
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column" }, entries.slice(-8).map((e) => /* @__PURE__ */ React.createElement(Box, { key: e.id }, renderEntry(e))), live ? /* @__PURE__ */ React.createElement(Box, { paddingLeft: 2 }, /* @__PURE__ */ React.createElement(Text, null, /* @__PURE__ */ React.createElement(Text, { color: C.tool, bold: true }, "\u26A1 "), /* @__PURE__ */ React.createElement(Text, { color: C.tool }, live.tool, " "), /* @__PURE__ */ React.createElement(Text, { color: C.muted }, trunc(prettyParams(live.args), 72)))) : null, busy ? /* @__PURE__ */ React.createElement(Thinking, null) : null, /* @__PURE__ */ React.createElement(Box, { borderStyle: "round", borderColor: C.border, paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, { color: C.primary, bold: true }, "\u276F "), /* @__PURE__ */ React.createElement(Text, { color: C.text }, input), busy ? null : /* @__PURE__ */ React.createElement(Text, { dimColor: true }, "_")), /* @__PURE__ */ React.createElement(Text, { dimColor: true }, " ", /* @__PURE__ */ React.createElement(Text, { color: engColor }, breath), " \u5F15\u64CE:" + (st.running ? "\u8FD0\u8F6C\u4E2D" : "\u505C\u6B62") + " \xB7 \u6C60:" + st.active.length + "/" + st.pool.length, " \xB7 " + trunc(model, 30) + " \xB7 \u2191\u2193" + tok + " tok \xB7 Enter \u6D3E\u6D3B \xB7 Ctrl+C \u9000\u51FA"));
}
var idx = process.argv.indexOf("--dir");
var dirArg = idx > -1 ? path.resolve(process.argv[idx + 1]) : process.cwd();
if (!fs.existsSync(dirArg)) {
  console.error("\u76EE\u5F55\u4E0D\u5B58\u5728:", dirArg);
  process.exit(1);
}
render(/* @__PURE__ */ React.createElement(App, { initialDir: dirArg }), { patchConsole: false });
