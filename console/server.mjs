#!/usr/bin/env node
// OPC Console — 驾驶舱后端 (zero dependencies, pure node)
// Auth: access-key auto-login (from `opc` launcher) + password for LAN devices.
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { spawn, execSync } from "child_process";

const HOME = os.homedir();
const C = (p) => path.join(HOME, ".local/share/opencode/company", p);
const PORT = Number(process.env.PORT || 4097);
const AUTH_FILE = C("auth.json");

// ---------------- helpers ----------------
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
const tailLines = (f, n) => { try { return fs.readFileSync(f, "utf8").trim().split("\n").slice(-n); } catch { return []; } };
const sh = (cmd, args, cb) => {
  const p = spawn(cmd, args, { env: { ...process.env, PATH: `${HOME}/.local/bin:${process.env.PATH}` } });
  let out = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
  p.on("close", code => cb && cb(code, out));
};

// ---------------- auth ----------------
function loadAuth() {
  let a = readJSON(AUTH_FILE, null);
  if (!a) {
    const password = crypto.randomBytes(4).toString("hex");           // 8-char LAN password
    const accessKey = crypto.randomBytes(24).toString("hex");          // auto-login key
    a = { password, accessKey, created: new Date().toISOString() };
    writeJSON(AUTH_FILE, a);
    try { fs.chmodSync(AUTH_FILE, 0o600); } catch {}
    console.log(`[auth] LAN password: ${password}  (stored in ${AUTH_FILE})`);
  }
  return a;
}
const AUTH = loadAuth();
const sessions = new Set(); // valid cookie tokens

function makeSession() {
  const t = crypto.randomBytes(20).toString("hex");
  sessions.add(t);
  return t;
}
function isAuthed(req, url) {
  const qk = url.searchParams.get("key");
  if (qk && qk === AUTH.accessKey) return true;
  const ck = (req.headers.cookie || "").match(/opc_session=([a-f0-9]+)/);
  if (ck && sessions.has(ck[1])) return true;
  return false;
}

// ---------------- engine glue ----------------
const engine = (args, cb) => sh(`${HOME}/.local/bin/opc-engine`, args, cb);

function getState() {
  const pool = readJSON(C("pool.json"), []);
  const eng = readJSON(C("engine.json"), { running: false });
  const events = tailLines(C("events.log"), 60).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  const metrics = readJSON(C("metrics.json"), { snapshots: [] });
  const snaps = metrics.snapshots || [];
  const latest = snaps[snaps.length - 1] || null;
  const alerts = [];
  for (const p of pool) {
    if ((p.fail_streak || 0) >= 2) alerts.push({ level: "high", project: p.id, msg: `连续失败 ${p.fail_streak} 次${p.escalate ? "(已升级强模型)" : ""}` });
    if (p.status === "paused") alerts.push({ level: "info", project: p.id, msg: "项目已暂停(人工)" });
  }
  if (!eng.running && pool.some(p => p.status === "active")) alerts.push({ level: "high", project: "system", msg: "引擎已停止但项目池仍有活跃项目" });
  // star history per repo across snapshots
  const starHistory = {};
  for (const s of snaps) for (const r of s.repos || []) {
    (starHistory[r.name] = starHistory[r.name] || []).push({ t: s.timestamp, stars: r.stars });
  }
  return {
    engine: eng,
    pool,
    events,
    alerts,
    metrics: { latest, totalStars: latest?.totals?.stars ?? 0, snapCount: snaps.length },
    starHistory,
    wizard: readJSON(C("wizard.json"), { done: false }),
    hasDeepseek: !!readJSON(C("keys.json"), {})["deepseek"],
    hasGithub: !!(process.env.GITHUB_TOKEN || fs.existsSync(path.join(HOME, ".config/opencode/knowledge/core/github-token.md"))),
  };
}

function bootstrapProject(body, cb) {
  const name = String(body.name || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const requirement = String(body.requirement || "").slice(0, 2000);
  if (!name || !requirement) return cb(400, { error: "name & requirement required" });
  const dir = path.join(HOME, ".local/share/opencode/projects", name);
  fs.mkdirSync(dir, { recursive: true });
  event("system", "bootstrap-start", `new project ${name}`);
  // run full lifecycle headlessly (detached so HTTP returns immediately)
  const logf = fs.openSync(C("logs") + `/bootstrap-${name}.log`, "a");
  const child = spawn(`${HOME}/.local/bin/opc-agent`,
    ["run",
     `FULL LIFECYCLE bootstrap for new project '${name}'. Requirement: ${requirement}. Work inside current directory: product-manager -> architect -> developer -> tester (tests must pass) -> security-auditor -> legal (LICENSE MIT Hanley-Liu) -> docs-writer (README.md + README.zh-CN.md) -> designer (docs/assets/banner.svg) -> community files -> git init & push to github.com/Hanley-Liu/${name} (GITHUB_TOKEN set, insteadOf rewrite active) -> devops-release (topics+description). Iron rules: decide everything yourself by rule, never ask, never create OTHER projects.`,
     "--dir", dir, "--agent", "build", "--max-steps", "90"],
    { detached: true, stdio: ["ignore", logf, logf], env: { ...process.env, PATH: `${HOME}/.local/bin:${process.env.PATH}` } });
  child.unref();
  // watch for completion -> auto-add to perpetual pool
  const watcher = setInterval(() => {
    try {
      if (fs.existsSync(path.join(dir, "README.md"))) {
        clearInterval(watcher);
        engine(["add-project", name, "60", "5"], () => event(name, "pool-added", "bootstrap finished"));
      }
    } catch {}
  }, 60_000);
  setTimeout(() => clearInterval(watcher), 3 * 3600_000); // give up watching after 3h
  cb(200, { ok: true, name, msg: "bootstrap started; will auto-join pool when README exists" });
}
function event(proj, type, detail) {
  fs.appendFileSync(C("events.log"),
    JSON.stringify({ ts: new Date().toISOString(), project: proj, type, detail: String(detail).slice(0, 160) }) + "\n");
}

// ---------------- server ----------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (code, obj, headers = {}) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(JSON.stringify(obj));
  };
  const body = () => new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

  // static app
  if (url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/favicon.svg") {
    if (!isAuthed(req, url)) {
      // serve minimal login page for LAN visitors
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(loginHTML(url.searchParams.get("next") || "/"));
    }
    let file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    let fp = path.join(HOME, ".local/share/opc/console/public", file);
    fs.readFile(fp, (err, data) => {
      if (err) return json(404, { error: "not found" });
      // successful ?key= access => drop long-lived session cookie
      const headers = { "Content-Type": file.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8" };
      if (url.searchParams.get("key") === AUTH.accessKey) {
        const tok = makeSession();
        headers["Set-Cookie"] = `opc_session=${tok}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
      }
      res.writeHead(200, headers);
      res.end(data);
    });
    return;
  }

  // login API (password)
  if (url.pathname === "/api/login" && req.method === "POST") {
    body().then(b => {
      if (b.password === AUTH.password) {
        const tok = makeSession();
        json(200, { ok: true }, { "Set-Cookie": `opc_session=${tok}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax` });
      } else json(401, { error: "wrong password" });
    });
    return;
  }

  // everything else requires auth
  if (!isAuthed(req, url)) return json(401, { error: "unauthorized" });

  if (url.pathname === "/api/state" && req.method === "GET") return json(200, getState());

  // ---- transparency APIs ----
  if (url.pathname === "/api/agents" && req.method === "GET") {
    // roster: from opencode.jsonc + agents/*.md
    const agents = [];
    try {
      const cfgPath = path.join(HOME, ".config/opencode/opencode.jsonc");
      const src = fs.readFileSync(cfgPath, "utf8");
      const stripped = src.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
      const cfg = JSON.parse(stripped);
      for (const [name, a] of Object.entries(cfg.agent || {})) {
        agents.push({ name, description: a.description || "", model: a.model || cfg.model || "", source: "config", dept: deptOf(name) });
      }
    } catch {}
    try {
      const md = path.join(HOME, ".config/opencode/agents");
      for (const f of fs.readdirSync(md)) {
        if (!f.endsWith(".md")) continue;
        const head = fs.readFileSync(path.join(md, f), "utf8").slice(0, 600);
        const dm = head.match(/description:\s*(.+)/)?.[1]?.trim() || "";
        const name = f.replace(/\.md$/, "");
        if (!agents.find(a => a.name === name)) agents.push({ name, description: dm, model: "kilo/*", source: "hired", dept: "动态招聘" });
      }
    } catch {}
    // live status from activity feed
    const act = tailLines(C("activity.jsonl"), 400).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const now = Date.now();
    for (const a of agents) {
      const last = [...act].reverse().find(e => e.agent === a.name);
      a.lastSeen = last?.ts || null;
      a.working = !!(last && (now - Date.parse(last.ts)) < 5 * 60_000);
      a.currentProject = last?.project || null;
      a.lastAction = last ? `${last.type}${last.tool ? ":" + last.tool : ""}` : null;
    }
    return json(200, { agents });
  }

  if (url.pathname === "/api/activity" && req.method === "GET") {
    let lines = tailLines(C("activity.jsonl"), Number(url.searchParams.get("limit") || 300));
    const project = url.searchParams.get("project"), agentF = url.searchParams.get("agent"), type = url.searchParams.get("type");
    let evts = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (project) evts = evts.filter(e => e.project === project);
    if (agentF) evts = evts.filter(e => e.agent === agentF);
    if (type) evts = evts.filter(e => e.type === type);
    return json(200, { events: evts.reverse() }); // newest first
  }

  if (url.pathname === "/api/billing" && req.method === "GET") {
    const lines = tailLines(C("activity.jsonl"), 5000);
    const byModel = {}, runs = {};
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.type === "llm") {
        const m = byModel[e.model] ||= { model: e.model, calls: 0, promptTokens: 0, completionTokens: 0 };
        m.calls++; m.promptTokens += e.prompt_tokens || 0; m.completionTokens += e.completion_tokens || 0;
      }
      if (e.type === "run-start") runs[e.run] = { run: e.run, agent: e.agent, project: e.project, ts: e.ts };
      if (e.type === "run-done" && runs[e.run]) { runs[e.run].done = true; runs[e.run].totalTokens = e.total_tokens; }
      if (e.type === "run-start") runs[e.run].task = (e.task || "").slice(0, 100);
    }
    return json(200, { byModel: Object.values(byModel), recentRuns: Object.values(runs).slice(-30).reverse() });
  }

  if (url.pathname === "/api/project-history" && req.method === "GET") {
    const pid = url.searchParams.get("id");
    const events = tailLines(C("events.log"), 1000).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter(e => !pid || e.project === pid);
    const acts = tailLines(C("activity.jsonl"), 8000).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter(e => !pid || e.project === pid);
    return json(200, { iterations: events.reverse(), activity: acts.slice(-400).reverse() });
  }

  if (url.pathname === "/api/engine/start" && req.method === "POST") return engine(["start"], () => json(200, { ok: true }));
  if (url.pathname === "/api/engine/stop" && req.method === "POST") return engine(["stop"], () => json(200, { ok: true }));

  if (url.pathname === "/api/pool/add" && req.method === "POST")
    return body().then(b => engine(["add-project", b.id, String(b.interval_min || 60), String(b.priority || 5)], () => json(200, { ok: true })));
  if (url.pathname === "/api/pool/pause" && req.method === "POST") return body().then(b => engine(["pause-project", b.id], () => json(200, { ok: true })));
  if (url.pathname === "/api/pool/resume" && req.method === "POST") return body().then(b => engine(["resume-project", b.id], () => json(200, { ok: true })));
  if (url.pathname === "/api/pool/kill" && req.method === "POST") return body().then(b => engine(["kill-project", b.id], () => json(200, { ok: true })));
  if (url.pathname === "/api/pool/prioritize" && req.method === "POST")
    return body().then(b => {
      // bump priority to top + clear last_run so next cycle picks it
      const pool = readJSON(C("pool.json"), []);
      for (const p of pool) if (p.id === b.id) { p.priority = 99; p.last_run = 0; }
      writeJSON(C("pool.json"), pool);
      event(b.id, "prioritized", "human boost");
      json(200, { ok: true });
    });

  if (url.pathname === "/api/projects/create" && req.method === "POST")
    return body().then(b => bootstrapProject(b, (code, obj) => json(code, obj)));

  if (url.pathname === "/api/settings" && req.method === "GET") {
    const keys = readJSON(C("keys.json"), {});
    return json(200, {
      deepseek: keys.deepseek ? "sk-***" + keys.deepseek.slice(-4) : "",
      lanPassword: AUTH.password,
      accessUrl: `http://localhost:${PORT}/?key=${AUTH.accessKey}`,
    });
  }
  if (url.pathname === "/api/settings" && req.method === "POST") {
    body().then(b => {
      const keys = readJSON(C("keys.json"), {});
      if (b.deepseek && !b.deepseek.includes("***")) keys.deepseek = b.deepseek.trim();
      writeJSON(C("keys.json"), keys);
      try { fs.chmodSync(C("keys.json"), 0o600); } catch {}
      if (b.lanPassword && String(b.lanPassword).length >= 4) { AUTH.password = b.lanPassword; writeJSON(AUTH_FILE, AUTH); }
      json(200, { ok: true });
    });
    return;
  }

  if (url.pathname === "/api/wizard/done" && req.method === "POST") {
    writeJSON(C("wizard.json"), { done: true, at: new Date().toISOString() });
    return json(200, { ok: true });
  }

  json(404, { error: "no route" });
});

function deptOf(name) {
  const map = {
    "product-manager": "产品", "analyst": "产品",
    "architect": "工程", "developer": "工程", "tester": "工程", "security-auditor": "工程", "optimizer": "工程",
    "docs-writer": "增长", "designer": "增长", "marketing-growth": "增长", "community-manager": "增长",
    "github-agent": "发布", "devops-release": "发布",
    "legal-compliance": "运营", "hr-manager": "人事",
  };
  return map[name] || "调度";
}

function loginHTML(next) {
  return `<!doctype html><meta charset=utf-8><title>OPC 登录</title>
<body style="font-family:system-ui;background:#0d1117;color:#e6edf3;display:flex;height:100vh;margin:0">
<div style="margin:auto;text-align:center">
<h1>🏢 OPC 驾驶舱</h1>
<p style="color:#8b949e">局域网访问需要密码(本机 <code>opc</code> 启动可免密)</p>
<input id=p type=password placeholder="访问密码" style="padding:10px 14px;border-radius:8px;border:1px solid #30363d;background:#161b22;color:#e6edf3;font-size:16px">
<button onclick="go()" style="padding:10px 18px;border-radius:8px;border:0;background:#238636;color:#fff;font-size:16px;cursor:pointer">进入</button>
<p id=e style="color:#f85149"></p>
<script>
async function go(){const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p.value})});
if(r.ok)location.href=${JSON.stringify("/")};else e.textContent='密码错误';}
p.onkeydown=k=>k.key==='Enter'&&go();
</script></div></body>`;
}

server.listen(PORT, () => {
  console.log(`[opc-console] listening on http://localhost:${PORT}`);
  console.log(`[opc-console] auto-login URL: http://localhost:${PORT}/?key=${AUTH.accessKey}`);
});
