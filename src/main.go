// opc-agent — standalone, ultra-light agent runtime (zero dependencies).
// Replaces `opencode run` for the OPC pipeline. Backward compatible:
// reads opencode.jsonc + ~/.config/opencode/agents/*.md + auth.json.
//
// Build (static, any old machine):
//   GOOS=linux GOARCH=386  CGO_ENABLED=0 go build -ldflags="-s -w" -o opc-agent-linux-386
//   GOOS=linux GOARCH=arm  CGO_ENABLED=0 go build -ldflags="-s -w" -o opc-agent-linux-arm
//   GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o opc-agent-linux-amd64
//   GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o opc-agent-linux-arm64
package main

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"time"
)

// ----------------------------- constants ---------------------------------

const (
	version          = "1.0.0"
	maxStepsDefault  = 60
	llmTimeout       = 300 * time.Second
	bashTimeout      = 120 * time.Second
	maxToolOutput    = 64 << 10 // 64KB per tool result
	maxFileRead      = 256 << 10
	maxWebfetch      = 32 << 10
	maxGlobResults   = 500
	maxGrepLines     = 200
	subagentDepthMax = 2
	memLimitBytes    = int64(64) << 20 // soft GC target: stay tiny
)

type provider struct {
	name string
	base string
	key  string // may be "" (zen free tier needs none)
}

var home, _ = os.UserHomeDir()

// ----------------------------- config ------------------------------------

type agentDef struct {
	Name        string            `json:"-"`
	Description string            `json:"description,omitempty"`
	Mode        string            `json:"mode,omitempty"`
	Model       string            `json:"model,omitempty"`
	Color       string            `json:"color,omitempty"`
	Prompt      string            `json:"prompt"`
	Tools       map[string]bool   `json:"tools,omitempty"`
	Permission  map[string]string `json:"permission,omitempty"`
	Steps       int               `json:"steps,omitempty"`
	Hidden      bool              `json:"hidden,omitempty"`
}

func stripJSONC(src []byte) []byte {
	var out bytes.Buffer
	i, n := 0, len(src)
	inStr, inLine, inBlock := false, false, false
	for i < n {
		c := src[i]
		switch {
		case inLine:
			if c == '\n' {
				inLine = false
				out.WriteByte(c)
			}
		case inBlock:
			if c == '*' && i+1 < n && src[i+1] == '/' {
				inBlock = false
				i++
			}
		case inStr:
			out.WriteByte(c)
			if c == '\\' && i+1 < n {
				out.WriteByte(src[i+1])
				i++
			} else if c == '"' {
				inStr = false
			}
		default:
			if c == '"' {
				inStr = true
				out.WriteByte(c)
			} else if c == '/' && i+1 < n && src[i+1] == '/' {
				inLine = true
				i++
			} else if c == '/' && i+1 < n && src[i+1] == '*' {
				inBlock = true
				i++
			} else if c == ',' {
				// lookahead: drop comma if next non-ws is } or ] (outside strings)
				j := i + 1
				for j < n && (src[j] == ' ' || src[j] == '\t' || src[j] == '\r' || src[j] == '\n') {
					j++
				}
				if j < n && (src[j] == '}' || src[j] == ']') {
					// omit the comma
				} else {
					out.WriteByte(c)
				}
			} else {
				out.WriteByte(c)
			}
		}
		i++
	}
	return out.Bytes()
}

func loadAuthKeys() map[string]string {
	keys := map[string]string{}
	data, err := os.ReadFile(filepath.Join(home, ".local/share/opencode/auth.json"))
	if err != nil {
		return keys
	}
	var m map[string]map[string]interface{}
	if json.Unmarshal(data, &m) == nil {
		for prov, v := range m {
			if k, ok := v["key"].(string); ok {
				keys[prov] = k
			}
		}
	}
	return keys
}

func providers() map[string]provider {
	auth := loadAuthKeys()
	pm := map[string]provider{
		"zen": {name: "zen", base: "https://opencode.ai/zen/v1", key: os.Getenv("OPENCODE_API_KEY")},
		"kilo": {name: "kilo", base: "https://api.kilo.ai/api/gateway",
			key: auth["kilo"]},
		"openrouter": {name: "openrouter", base: "https://openrouter.ai/api/v1",
			key: auth["openrouter"]},
	}
	if k := os.Getenv("KILO_API_KEY"); k != "" {
		pm["kilo"] = provider{"kilo", "https://api.kilo.ai/api/gateway", k}
	}
	if k := os.Getenv("OPENROUTER_API_KEY"); k != "" {
		pm["openrouter"] = provider{"openrouter", "https://openrouter.ai/api/v1", k}
	}
	return pm
}

// fallbackChain returns candidate model specs, most preferred first.
func fallbackChain(requested string, pm map[string]provider) []string {
	var chain []string
	add := func(p, m string) {
		if _, ok := pm[p]; !ok || m == "" {
			return
		}
		full := p + "/" + m
		for _, c := range chain {
			if c == full {
				return
			}
		}
		chain = append(chain, full)
	}
	req := requested
	if req == "" {
		req = "kilo/poolside/laguna-s-2.1:free"
	}
	pIdx := strings.Index(req, "/")
	p, m := "kilo", req
	if pIdx > 0 {
		p, m = req[:pIdx], req[pIdx+1:]
	}
	add(p, m)
	// cross-provider equivalents of laguna family first
	if strings.Contains(m, "laguna") {
		add("zen", "laguna-s-2.1-free")
		add("kilo", "poolside/laguna-s-2.1:free")
		add("openrouter", "poolside/laguna-s-2.1:free")
	}
	// generic free fallbacks
	add("zen", "nemotron-3.5-lightning-free")
	add("zen", "x-preview-f-free")
	add("zen", "laguna-s-2.1-free")
	add("kilo", "poolside/laguna-s-2.1:free")
	add("openrouter", "meta-llama/llama-3.3-70b-instruct")
	return chain
}

func loadAgents() map[string]*agentDef {
	agents := map[string]*agentDef{}
	// 1) opencode.jsonc agents section
	cfgPath := filepath.Join(home, ".config/opencode/opencode.jsonc")
	if data, err := os.ReadFile(cfgPath); err == nil {
		var cfg struct {
			Model       string               `json:"model"`
			Agents      map[string]*agentDef `json:"agent"`
			DefaultName string               `json:"defaultAgent"`
		}
		stripped := stripJSONC(data)
		if uerr := json.Unmarshal(stripped, &cfg); uerr != nil {
			fmt.Fprintf(os.Stderr, "[config] %s parse error: %v\n", cfgPath, uerr)
		} else if cfg.Agents != nil {
			for name, a := range cfg.Agents {
				a.Name = name
				if a.Prompt == "" {
					continue
				}
				agents[name] = a
			}
		}
	}
	// 2) markdown hires: ~/.config/opencode/agents/*.md
	mdDir := filepath.Join(home, ".config/opencode/agents")
	if entries, err := os.ReadDir(mdDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(mdDir, e.Name()))
			if err != nil {
				continue
			}
			a := parseMDFrontmatter(string(data))
			if a == nil || a.Prompt == "" {
				continue
			}
			a.Name = strings.TrimSuffix(e.Name(), ".md")
			agents[a.Name] = a
		}
	}
	// 3) built-in orchestrator fallback
	if agents["build"] == nil {
		agents["build"] = &agentDef{Name: "build", Mode: "primary",
			Prompt: "You are Sisyphus, an autonomous orchestrator. Use tools to complete the task.", Tools: map[string]bool{"*": true}}
	}
	return agents
}

// minimal YAML frontmatter: key: value and one nested level of maps/lists
func parseMDFrontmatter(src string) *agentDef {
	if !strings.HasPrefix(src, "---") {
		return nil
	}
	end := strings.Index(src[3:], "\n---")
	if end < 0 {
		return nil
	}
	fm := src[3 : end+3]
	body := strings.TrimSpace(src[end+6:])
	a := &agentDef{Prompt: body, Tools: map[string]bool{"bash": true, "read": true, "write": true, "edit": true,
		"glob": true, "grep": true, "webfetch": true, "task": true}, Permission: map[string]string{
		"bash": "allow", "edit": "allow", "read": "allow", "glob": "allow", "grep": "allow"}}
	curMap := ""
	for _, line := range strings.Split(fm, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || t == "---" || strings.HasPrefix(t, "#") {
			continue
		}
		if !strings.HasPrefix(line, " ") && strings.Contains(t, ":") {
			kv := strings.SplitN(t, ":", 2)
			k, v := strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
			switch k {
			case "description":
				a.Description = unquote(v)
			case "mode":
				a.Mode = unquote(v)
			case "model":
				a.Model = unquote(v)
			case "color":
				a.Color = unquote(v)
			case "steps":
				fmt.Sscanf(v, "%d", &a.Steps)
			default:
				curMap = k
			}
			continue
		}
		// nested "- key: value"? normalize; we accept "  key: value" as map entries
		if strings.HasPrefix(line, " ") && strings.Contains(t, ":") {
			kv := strings.SplitN(t, ":", 2)
			k, v := strings.TrimSpace(kv[0]), strings.TrimSpace(strings.TrimPrefix(kv[1], " "))
			switch curMap {
			case "permission":
				a.Permission[k] = unquote(v)
			case "tools":
				a.Tools[k] = (v == "true" || v == "")
			}
		}
	}
	return a
}

func unquote(s string) string {
	s = strings.Trim(s, `"'`)
	return strings.ReplaceAll(s, `\"`, `"`)
}

// ----------------------------- LLM client ---------------------------------

type message struct {
	Role       string       `json:"role"`
	Content    interface{}  `json:"content"`
	ToolCalls  []toolCallRsp `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
	Name       string       `json:"name,omitempty"`
}

type toolCallRsp struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []message     `json:"messages"`
	Tools       []toolSchema  `json:"tools,omitempty"`
	MaxTokens   int           `json:"max_tokens"`
	Temperature float64       `json:"temperature"`
}

type chatResponse struct {
	Choices []struct {
		Message      message `json:"message"`
		FinishReason string  `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string      `json:"message"`
		Code    interface{} `json:"code"`
	} `json:"error,omitempty"`
	Usage json.RawMessage `json:"usage,omitempty"`
}

func (c *chatResponse) totalTokens() int {
	var u struct {
		TotalTokens int `json:"total_tokens"`
	}
	if json.Unmarshal(c.Usage, &u) == nil {
		return u.TotalTokens
	}
	return 0
}

type toolSchema struct {
	Type     string       `json:"type"`
	Function toolFuncDecl `json:"function"`
}
type toolFuncDecl struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

var httpClient = &http.Client{
	Timeout: llmTimeout,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		MaxIdleConns:        4,
		IdleConnTimeout:     90 * time.Second,
		ResponseHeaderTimeout: llmTimeout,
	},
}

func chatCompletion(pm map[string]provider, modelSpec string, req chatRequest) (*chatResponse, error) {
	chain := fallbackChain(modelSpec, pm)
	if len(chain) == 0 {
		return nil, errors.New("no usable provider (check auth.json / OPENCODE_API_KEY)")
	}
	debugMode := os.Getenv("OPC_DEBUG") == "1"
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		for _, spec := range chain {
			idx := strings.Index(spec, "/")
			p := pm[spec[:idx]]
			// skip providers that require a key we don't have (zen free tier needs none)
			if p.key == "" && spec[:idx] != "zen" {
				continue
			}
			modelID := spec[idx+1:]
			req.Model = modelID
			body, _ := json.Marshal(req)
			if debugMode {
				fmt.Fprintf(os.Stderr, "[chain] try %s (%d bytes)\n", spec, len(body))
			}
			httpReq, err := http.NewRequest("POST", p.base+"/chat/completions", bytes.NewReader(body))
			if err != nil {
				lastErr = err
				continue
			}
			httpReq.Header.Set("Content-Type", "application/json")
			if p.key != "" {
				httpReq.Header.Set("Authorization", "Bearer "+p.key)
			}
			resp, err := httpClient.Do(httpReq)
			if err != nil {
				lastErr = fmt.Errorf("%s: %v", spec, err)
				if debugMode {
					fmt.Fprintf(os.Stderr, "[chain] %s ERR %v\n", spec, err)
				}
				continue
			}
			data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
			resp.Body.Close()
			if err != nil {
				lastErr = err
				continue
			}
			if resp.StatusCode != 200 {
				lastErr = fmt.Errorf("%s: HTTP %d: %.200s", spec, resp.StatusCode, string(data))
				if debugMode {
					fmt.Fprintf(os.Stderr, "[chain] %s HTTP%d %.300s\n", spec, resp.StatusCode, string(data))
				}
				continue
			}
			var cr chatResponse
			if err := json.Unmarshal(data, &cr); err != nil {
				lastErr = fmt.Errorf("%s: bad json: %v", spec, err)
				if debugMode {
					fmt.Fprintf(os.Stderr, "[chain] %s BADJSON %v | %.200s\n", spec, err, string(data))
				}
				continue
			}
			if cr.Error != nil {
				lastErr = fmt.Errorf("%s: %s", spec, cr.Error.Message)
				if debugMode {
					fmt.Fprintf(os.Stderr, "[chain] %s APPERR %.300s\n", spec, cr.Error.Message)
				}
				continue
			}
			if len(cr.Choices) == 0 {
				lastErr = fmt.Errorf("%s: empty choices", spec)
				if debugMode {
					fmt.Fprintf(os.Stderr, "[chain] %s EMPTYCHOICE %.400s\n", spec, string(data))
				}
				continue
			}
			return &cr, nil
		}
		time.Sleep(time.Duration(attempt+1) * 5 * time.Second) // backoff then retry whole chain
	}
	return nil, lastErr
}

// ----------------------------- tools --------------------------------------

type toolCtx struct {
	cwd         string
	perm        map[string]string
	extDirs     []string
	agents      map[string]*agentDef
	pm          map[string]provider
	modelSpec   string
	depth       int
	logf        func(format string, args ...interface{})
}

func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[2:])
	}
	if p == "~" {
		return home
	}
	return p
}

func allowedPath(ctx *toolCtx, path string) bool {
	abs := path
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(ctx.cwd, abs)
	}
	abs = filepath.Clean(expandHome(abs))
	if strings.HasPrefix(abs, ctx.cwd) {
		return true
	}
	for _, pat := range ctx.extDirs {
		pp := expandHome(strings.TrimSuffix(pat, "*"))
		if strings.HasPrefix(abs, filepath.Clean(pp)) {
			return true
		}
	}
	return false
}

func permCheck(ctx *toolCtx, tool, target string) error {
	action := ctx.perm[tool]
	if action == "" {
		action = "allow"
	}
	switch action {
	case "allow":
	case "deny":
		return fmt.Errorf("permission denied: %s", tool)
	default: // ask → headless auto-reject (matches opencode behavior)
		return fmt.Errorf("permission '%s' requires interactive approval — auto-rejected in headless mode", tool)
	}
	if target != "" && !allowedPath(ctx, target) {
		return fmt.Errorf("external_directory not allowed: %s", target)
	}
	return nil
}

func runTool(ctx *toolCtx, name string, args map[string]interface{}) (string, error) {
	getStr := func(k string) string {
		if v, ok := args[k].(string); ok {
			return v
		}
		return ""
	}
	switch name {
	case "bash":
		cmd := getStr("command")
		if cmd == "" {
			return "", errors.New("empty command")
		}
		if err := permCheck(ctx, "bash", ""); err != nil {
			return "", err
		}
		to := bashTimeout
		if f, ok := args["timeout_sec"].(float64); ok && f > 0 && f <= 600 {
			to = time.Duration(f) * time.Second
		}
		c := exec.Command("sh", "-c", cmd)
		c.Dir = ctx.cwd
		c.Env = append(os.Environ(), "PATH="+home+"/.local/bin:"+os.Getenv("PATH"))
		done := make(chan error, 1)
		var buf bytes.Buffer
		c.Stdout = &buf
		c.Stderr = &buf
		if err := c.Start(); err != nil {
			return "", err
		}
		go func() { done <- c.Wait() }()
		select {
		case <-time.After(to):
			c.Process.Kill()
			return truncate(buf.String()), fmt.Errorf("timeout after %s", to)
		case err := <-done:
			out := truncate(buf.String())
			if err != nil {
				return out, nil // exit code info is in output; not fatal for the loop
			}
			return out, nil
		}
	case "read":
		f := expandHome(getStr("file"))
		if err := permCheck(ctx, "read", f); err != nil {
			return "", err
		}
		data, err := os.ReadFile(f)
		if err != nil {
			return "", err
		}
		return truncate(string(data)), nil
	case "write":
		f := expandHome(getStr("file"))
		if err := permCheck(ctx, "edit", f); err != nil {
			return "", err
		}
		content, _ := args["content"].(string)
		os.MkdirAll(filepath.Dir(f), 0o755)
		return "written " + fmt.Sprint(len(content)) + " bytes", os.WriteFile(f, []byte(content), 0o644)
	case "edit":
		f := expandHome(getStr("file"))
		if err := permCheck(ctx, "edit", f); err != nil {
			return "", err
		}
		oldS, newS := getStr("old_string"), getStr("new_string")
		data, err := os.ReadFile(f)
		if err != nil {
			return "", err
		}
		src := string(data)
		cnt := strings.Count(src, oldS)
		if cnt == 0 {
			return "", errors.New("old_string not found")
		}
		if cnt > 1 {
			return "", fmt.Errorf("old_string matches %d times; add context", cnt)
		}
		return "edited", os.WriteFile(f, []byte(strings.Replace(src, oldS, newS, 1)), 0o644)
	case "glob":
		pat := getStr("pattern")
		if err := permCheck(ctx, "glob", ""); err != nil {
			return "", err
		}
		var hits []string
		filepath.Walk(ctx.cwd, func(p string, info os.FileInfo, err error) error {
			if len(hits) >= maxGlobResults || err != nil {
				return nil
			}
			rel, _ := filepath.Rel(ctx.cwd, p)
			ok, _ := filepath.Match(pat, rel)
			base, _ := filepath.Match(pat, filepath.Base(rel))
			if ok || base {
				hits = append(hits, rel)
			}
			return nil
		})
		return strings.Join(hits, "\n"), nil
	case "grep":
		pat := getStr("pattern")
		re, err := regexp.Compile(pat)
		if err != nil {
			return "", err
		}
		root := ctx.cwd
		if p := getStr("path"); p != "" {
			root = expandHome(p)
		}
		if err := permCheck(ctx, "grep", root); err != nil {
			return "", err
		}
		var lines []string
		filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
			if len(lines) >= maxGrepLines || err != nil || info.IsDir() {
				return nil
			}
			if info.Size() > 4<<20 {
				return nil
			}
			data, err := os.ReadFile(p)
			if err != nil {
				return nil
			}
			for i, l := range strings.Split(string(data), "\n") {
				if re.MatchString(l) {
					rel, _ := filepath.Rel(ctx.cwd, p)
					lines = append(lines, fmt.Sprintf("%s:%d: %s", rel, i+1, truncate(l)))
					if len(lines) >= maxGrepLines {
						break
					}
				}
			}
			return nil
		})
		if len(lines) == 0 {
			return "no matches", nil
		}
		return strings.Join(lines, "\n"), nil
	case "webfetch":
		u := getStr("url")
		if err := permCheck(ctx, "webfetch", ""); err != nil {
			return "", err
		}
		resp, err := httpClient.Get(u)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxWebfetch*4))
		text := string(raw)
		tagRe := regexp.MustCompile(`(?s)<(script|style)[^>]*>.*?</\1>`)
		text = tagRe.ReplaceAllString(text, "")
		anyTag := regexp.MustCompile(`<[^>]+>`)
		text = anyTag.ReplaceAllString(text, " ")
		ws := regexp.MustCompile(`\s+`)
		text = ws.ReplaceAllString(text, " ")
		return truncate(text), nil
	case "task":
		agentName := getStr("agent")
		prompt := getStr("prompt")
		if err := permCheck(ctx, "task", ""); err != nil {
			return "", err
		}
		if ctx.depth >= subagentDepthMax {
			return "", errors.New("task depth limit reached")
		}
		sub, ok := ctx.agents[agentName]
		if !ok {
			return "", fmt.Errorf("unknown subagent %q", agentName)
		}
		ctx.logf("[task] -> %s", agentName)
		out, err := agentLoop(ctx.pm, ctx.agents, sub, prompt, ctx.cwd, ctx.depth+1, ctx.logf)
		if err != nil {
			return "", err
		}
		return out, nil
	default:
		return "", fmt.Errorf("unknown tool %q", name)
	}
}

func truncate(s string) string {
	if len(s) <= maxToolOutput {
		return s
	}
	half := maxToolOutput / 2
	return s[:half] + "\n...[truncated]...\n" + s[len(s)-half:]
}

// ----------------------------- agent loop ---------------------------------

func builtinTools() []toolSchema {
	mk := func(name, desc, props string, required ...string) toolSchema {
		var p map[string]interface{}
		json.Unmarshal([]byte(props), &p)
		return toolSchema{Type: "function", Function: toolFuncDecl{
			Name: name, Description: desc,
			Parameters: map[string]interface{}{"type": "object", "properties": p, "required": required}}}
	}
	return []toolSchema{
		mk("bash", "Run a shell command via sh -c. Working dir is project dir.", `{"command":{"type":"string"},"timeout_sec":{"type":"number"}}`, "command"),
		mk("read", "Read a file.", `{"file":{"type":"string"}}`, "file"),
		mk("write", "Write/create a file (dirs auto-created).", `{"file":{"type":"string"},"content":{"type":"string"}}`, "file", "content"),
		mk("edit", "Replace exact old_string with new_string in file (must match exactly once).", `{"file":{"type":"string"},"old_string":{"type":"string"},"new_string":{"type":"string"}}`, "file", "old_string", "new_string"),
		mk("glob", "List files matching pattern relative to cwd.", `{"pattern":{"type":"string"}}`, "pattern"),
		mk("grep", "Regex search files under path (default cwd).", `{"pattern":{"type":"string"},"path":{"type":"string"}}`, "pattern"),
		mk("webfetch", "Fetch URL, return readable text.", `{"url":{"type":"string"}}`, "url"),
		mk("task", "Delegate a task to a named subagent.", `{"agent":{"type":"string"},"prompt":{"type":"string"}}`, "agent", "prompt"),
	}
}

const kbProtocol = `
## RAG Protocol (mandatory)
kb CLI at ~/.local/bin/kb. Knowledge at ~/.config/opencode/knowledge/.
Before decisions: kb search "<topic>". After actions/learnings: kb learn <category> <name> "<content>".
After every error: kb learn snippets "error-<ts>" "<error + fix>".`

func agentLoop(pm map[string]provider, agents map[string]*agentDef, a *agentDef, userTask, cwd string, depth int, logf func(string, ...interface{})) (string, error) {
	steps := a.Steps
	if steps <= 0 || steps > 120 {
		steps = maxStepsDefault
	}
	sys := a.Prompt + "\n" + kbProtocol +
		"\nYou are running headless and autonomous. Complete the task using tools; finish with a concise summary."

	extDirs := []string{
		"~/.config/opencode/knowledge/**", "~/.config/opencode/skills/**",
		"~/.local/share/opencode/projects/**", "~/.local/bin/**",
		"~/.local/share/opencode/company/**",
	}
	ctx := &toolCtx{cwd: cwd, perm: a.Permission, extDirs: extDirs, agents: agents,
		pm: pm, modelSpec: a.Model, depth: depth, logf: logf}

	msgs := []message{{Role: "system", Content: sys}, {Role: "user", Content: userTask}}
	tools := builtinTools()
	final := ""
	for step := 0; step < steps; step++ {
		debug.SetGCPercent(40)
		req := chatRequest{Messages: msgs, Tools: tools, MaxTokens: 8192, Temperature: 0.4}
		cr, err := chatCompletion(pm, a.Model, req)
		if err != nil {
			return final, fmt.Errorf("step %d: %v", step, err)
		}
		msg := cr.Choices[0].Message
		content := ""
		switch c := msg.Content.(type) {
		case string:
			content = c
		case []interface{}:
			// content parts style
			for _, part := range c {
				if pm2, ok := part.(map[string]interface{}); ok {
					if t, ok := pm2["text"].(string); ok {
						content += t
					}
				}
			}
		}
		if len(msg.ToolCalls) == 0 {
			final = content
			logf("[loop] done after %d steps (%d tokens)", step+1, cr.totalTokens())
			return final, nil
		}
		assistant := message{Role: "assistant", Content: content, ToolCalls: msg.ToolCalls}
		msgs = append(msgs, assistant)
		for _, tc := range msg.ToolCalls {
			var args map[string]interface{}
			json.Unmarshal([]byte(tc.Function.Arguments), &args)
			logf("[tool] %s %s", tc.Function.Name, tc.Function.Arguments)
			out, err := runTool(ctx, tc.Function.Name, args)
			result := out
			if err != nil {
				result = "ERROR: " + err.Error()
				if out != "" {
					result = out + "\nERROR: " + err.Error()
				}
			}
			if result == "" {
				result = "(no output)"
			}
			msgs = append(msgs, message{Role: "tool", ToolCallID: tc.ID, Content: result})
		}
		pruneHistory(msgs)
	}
	return final, errors.New("max steps reached")
}

// pruneHistory caps old tool outputs so long loops stay small in RAM.
func pruneHistory(msgs []message) {
	lookback := 8 // keep last N messages intact
	if len(msgs) <= lookback+2 {
		return
	}
	for i := 2; i < len(msgs)-lookback; i++ {
		if msgs[i].Role == "tool" {
			if s, ok := msgs[i].Content.(string); ok && len(s) > 1500 {
				msgs[i].Content = s[:600] + "\n...[pruned]...\n" + s[len(s)-400:]
			}
		}
	}
}

// ----------------------------- main ---------------------------------------

func main() {
	debug.SetGCPercent(40)
	go func() {
		for {
			time.Sleep(30 * time.Second)
			debug.FreeOSMemory()
		}
	}()
	if len(os.Args) < 2 {
		usage()
		return
	}
	switch os.Args[1] {
	case "version":
		fmt.Println("opc-agent", version)
	case "models":
		listModels()
	case "agents":
		for name, a := range loadAgents() {
			fmt.Printf("%-20s model=%s desc=%.60s\n", name, a.Model, a.Description)
		}
	case "run":
		cmdRun(os.Args[2:])
	default:
		usage()
	}
}

func usage() {
	fmt.Println(`opc-agent ` + version + ` — standalone lightweight agent runtime

Usage:
  opc-agent run "PROMPT" [--agent NAME] [--dir DIR] [--model PROVIDER/MODEL] [--max-steps N]
  opc-agent models          list provider fallback chains
  opc-agent version`)
}

func listModels() {
	pm := providers()
	chain := fallbackChain("", pm)
	fmt.Println("fallback chain (most preferred first):")
	for _, c := range chain {
		key := "(no key)"
		idx := strings.Index(c, "/")
		if pm[c[:idx]].key != "" {
			key = "(key: auth.json/env)"
		}
		fmt.Printf("  %-45s %s\n", c, key)
	}
}

func cmdRun(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	agentName := fs.String("agent", "build", "agent to run")
	dir := fs.String("dir", ".", "working directory")
	model := fs.String("model", "", "override model PROVIDER/MODEL")
	maxSteps := fs.Int("max-steps", maxStepsDefault, "cap agentic steps")
	_ = maxSteps
	if fs.Parse(args) != nil || fs.NArg() < 1 {
		usage()
		os.Exit(2)
	}
	task := fs.Arg(0)
	abs, err := filepath.Abs(*dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bad dir:", err)
		os.Exit(1)
	}
	start := time.Now()
	agents := loadAgents()
	a := agents[*agentName]
	if a == nil {
		fmt.Fprintf(os.Stderr, "unknown agent %q; have: ", *agentName)
		for n := range agents {
			fmt.Fprint(os.Stderr, n+" ")
		}
		fmt.Fprintln(os.Stderr)
		os.Exit(1)
	}
	if *model != "" {
		a.Model = *model
	}
	pm := providers()
	logger := func(f string, xs ...interface{}) {
		fmt.Printf("\x1b[36m[opc]\x1b[0m "+f+"\n", xs...)
	}
	out, err := agentLoop(pm, agents, a, task, abs, 0, logger)
	dur := time.Since(start).Round(time.Second)
	appendRunLog(*agentName, task, out, err, dur)
	if err != nil {
		fmt.Printf("\x1b[31m[error]\x1b[0m %v\n", err)
	}
	if out != "" {
		fmt.Println(out)
	}
	if err != nil {
		os.Exit(1)
	}
}

func appendRunLog(agent, task, out string, err error, dur time.Duration) {
	dir := filepath.Join(home, ".local/share/opencode/company/logs")
	os.MkdirAll(dir, 0o755)
	f, ferr := os.OpenFile(filepath.Join(dir, "runs.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if ferr != nil {
		return
	}
	defer f.Close()
	status := "OK"
	if err != nil {
		status = "ERR: " + err.Error()
	}
	fmt.Fprintf(f, "\n===== [%s] opc-agent %s exit(%s) dur=%s =====\ntask: %.300s\noutput-tail: %.2000s\n",
		time.Now().Format(time.RFC3339), agent, status, dur, task, out)
	// keep log from growing forever on tiny devices
	if st, e := f.Stat(); e == nil && st.Size() > 8<<20 {
		f.Close()
		os.Remove(filepath.Join(dir, "runs.log.old"))
		os.Rename(filepath.Join(dir, "runs.log"), filepath.Join(dir, "runs.log.old"))
	}
}

var _ = bufio.NewReader
