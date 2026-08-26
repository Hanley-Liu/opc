package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hanley-liu/opc-framework/internal/schema"
)

// Client 零依赖 LLM 客户端 —— 多供应商容错链
type Client struct {
	mu        sync.Mutex
	cfg       *schema.Config
	http      *http.Client
	usage     map[string]schema.TokenUsage
	lastModel string
}

// Message 消息
type Message struct {
	Role       string       `json:"role"`
	Content    any          `json:"content"`
	ToolCalls  []ToolCall   `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
}

// ToolCall 工具调用
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// Response 响应
type Response struct {
	Content    string
	ToolCalls  []ToolCall
	Model      string
	PromptTok  int
	ComplTok   int
}

type rawResponse struct {
	Model  string `json:"model"`
	Choices []struct {
		Message struct {
			Content   any        `json:"content"`
			ToolCalls []ToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage json.RawMessage `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// NewClient 创建客户端（读取 keys.json + auth.json）
func NewClient(cfg *schema.Config) *Client {
	return &Client{
		cfg:  cfg,
		http: &http.Client{Timeout: 300 * time.Second},
		usage: map[string]schema.TokenUsage{},
	}
}

// keyFor 获取供应商 API key（env > keys.json > auth.json）
func (c *Client) keyFor(provider string) string {
	if v := os.Getenv(strings.ToUpper(provider) + "_API_KEY"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	// company/keys.json
	if data, err := os.ReadFile(filepath.Join(home, ".local/share/opencode/company/keys.json")); err == nil {
		var m map[string]string
		json.Unmarshal(data, &m)
		if k, ok := m[provider]; ok { return k }
	}
	// opencode auth.json
	if data, err := os.ReadFile(filepath.Join(home, ".local/share/opencode/auth.json")); err == nil {
		var m map[string]map[string]any
		json.Unmarshal(data, &m)
		if v, ok := m[provider]; ok {
			if k, ok := v["key"].(string); ok { return k }
		}
	}
	return ""
}

// chain 构建供应商容错链
func (c *Client) chain(requested string) []struct{ name, base, model string } {
	type entry = struct{ name, base, model string }
	var out []entry
	add := func(p, m string) {
		pc, ok := c.cfg.Providers[p]
		if !ok || m == "" { return }
		for _, e := range out { if e.name == p && e.model == m { return } }
		out = append(out, entry{p, pc.BaseURL, m})
	}
	p, m := "zen", requested
	if i := strings.Index(requested, "/"); i > 0 {
		p, m = requested[:i], requested[i+1:]
	}
	add(p, m)
	// 通用回退
	add("zen", "laguna-s-2.1-free")
	add("kilo", "poolside/laguna-s-2.1:free")
	add("deepseek", "deepseek-chat")
	add("openrouter", "meta-llama/llama-3.3-70b-instruct")
	return out
}

type wireRequest struct {
	Model       string      `json:"model"`
	Messages    []Message   `json:"messages"`
	Tools       []wireTool  `json:"tools,omitempty"`
	MaxTokens   int         `json:"max_tokens"`
	Temperature float64     `json:"temperature"`
}
type wireTool struct {
	Type     string             `json:"type"`
	Function wireToolFunction   `json:"function"`
}
type wireToolFunction struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// Chat 发起对话（带容错链重试）
func (c *Client) Chat(ctx context.Context, messages []Message, tools []map[string]any) (*Response, error) {
	model := c.cfg.DefaultModel
	wTools := make([]wireTool, len(tools))
	for i, t := range tools {
		name, _ := t["name"].(string)
		desc, _ := t["description"].(string)
		params, _ := t["parameters"].(map[string]interface{})
		if params == nil { params = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}} }
		wTools[i] = wireTool{Type: "function", Function: wireToolFunction{Name: name, Description: desc, Parameters: params}}
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		for _, hop := range c.chain(model) {
			key := c.keyFor(hop.name)
			if key == "" && hop.name != "zen" { continue }
			body, _ := json.Marshal(wireRequest{
				Model: hop.model, Messages: messages, Tools: wTools,
				MaxTokens: 8192, Temperature: 0.4,
			})
			req, err := http.NewRequestWithContext(ctx, "POST",
				strings.TrimSuffix(hop.base, "/")+"/chat/completions", bytes.NewReader(body))
			if err != nil { lastErr = err; continue }
			req.Header.Set("Content-Type", "application/json")
			if key != "" { req.Header.Set("Authorization", "Bearer "+key) }

			resp, err := c.http.Do(req)
			if err != nil { lastErr = fmt.Errorf("%s/%s: %w", hop.name, hop.model, err); continue }
			data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
			resp.Body.Close()
			if err != nil { lastErr = err; continue }
			if resp.StatusCode != 200 {
				lastErr = fmt.Errorf("%s/%s HTTP %d: %.150s", hop.name, hop.model, resp.StatusCode, data)
				continue
			}
			var rr rawResponse
			if err := json.Unmarshal(data, &rr); err != nil { lastErr = fmt.Errorf("%s badjson %v", hop.name, err); continue }
			if rr.Error != nil { lastErr = fmt.Errorf("%s: %s", hop.name, rr.Error.Message); continue }
			if len(rr.Choices) == 0 { lastErr = fmt.Errorf("%s 空响应", hop.name); continue }

			msg := rr.Choices[0].Message
			content := ""
			switch cv := msg.Content.(type) {
			case string: content = cv
			case []interface{}:
				for _, part := range cv {
					if pm, ok := part.(map[string]interface{}); ok {
						if t, ok := pm["text"].(string); ok { content += t }
					}
				}
			}
			c.mu.Lock()
			c.lastModel = rr.Model
			u := c.usage[rr.Model]
			c.mu.Unlock()

			pt, ct := parseUsage(rr.Usage)
			_ = u

			return &Response{
				Content: content, ToolCalls: msg.ToolCalls,
				Model: rr.Model, PromptTok: pt, ComplTok: ct,
			}, nil
		}
		time.Sleep(3 * time.Second)
	}
	return nil, fmt.Errorf("全部供应商失败: %w", lastErr)
}

func parseUsage(raw json.RawMessage) (int, int) {
	var u struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	}
	if err := json.Unmarshal(raw, &u); err != nil { return 0, 0 }
	return u.PromptTokens, u.CompletionTokens
}

// BuildMessages 构建 system+user 初始消息
func (c *Client) BuildMessages(systemPrompt, userTask string) []Message {
	sys := systemPrompt + "\n\n## RAG 协议\nkb CLI 位于 ~/.local/bin/kb。决策前 kb search，行动后 kb learn，错误必须记录。你是无人监督的自主运行，一切决策自己按规则做并记录理由。"
	return []Message{
		{Role: "system", Content: sys},
		{Role: "user", Content: userTask},
	}
}

// AppendToolResult 追加工具结果消息
func AppendToolResult(messages []Message, toolCallID, result string) []Message {
	// assistant 带 tool_calls 的占位消息已在 messages 里
	messages = append(messages, Message{Role: "assistant", Content: ""})
	messages = append(messages, Message{Role: "tool", ToolCallID: toolCallID, Content: result})
	return messages
}

// DefaultTools 默认工具 Schema 集
func (c *Client) DefaultTools() []map[string]any {
	mk := func(name, desc string, required ...string) map[string]any {
		props := map[string]interface{}{}
		switch name {
		case "read": props["path"] = map[string]string{"type":"string","description":"文件路径"}
		case "write": props["path"]=map[string]string{"type":"string"}; props["content"]=map[string]string{"type":"string"}
		case "edit": props["path"]=map[string]string{"type":"string"}; props["old_string"]=map[string]string{"type":"string"}; props["new_string"]=map[string]string{"type":"string"}
		case "bash": props["command"]=map[string]string{"type":"string","description":"shell命令"}
		case "glob": props["pattern"]=map[string]string{"type":"string"}
		case "grep": props["pattern"]=map[string]string{"type":"string"}
		case "task": props["agent"]=map[string]string{"type":"string","description":"目标智能体ID"}; props["task_desc"]=map[string]string{"type":"string"}
		}
		return map[string]any{
			"name": name, "description": desc,
			"parameters": map[string]any{"type":"object","properties":props,"required":required},
		}
	}
	return []map[string]any{
		mk("bash","执行 Shell 命令","command"),
		mk("read","读文件","path"),
		mk("write","写文件","path","content"),
		mk("edit","替换文件内容","path","old_string","new_string"),
		mk("glob","文件模式匹配","pattern"),
		mk("grep","内容搜索","pattern"),
		mk("task","委派子任务给其他智能体","agent","task_desc"),
	}
}

// UsageReport Token 用量报告
func (c *Client) UsageReport() string {
	c.mu.Lock(); defer c.mu.Unlock()
	var b strings.Builder
	total := 0
	for m, u := range c.usage {
		b.WriteString(fmt.Sprintf("  %s: ↑%d ↓%d\n", m, u.Prompt, u.Completion))
		total += u.Prompt + u.Completion
	}
	b.WriteString(fmt.Sprintf("合计: %d tokens\n", total))
	return b.String()
}

// jsonUnmarshal 包装（避免直接引用 encoding/json 在多个文件重复 import）
func jsonUnmarshal(data string, v any) error {
	return json.Unmarshal([]byte(data), v)
}