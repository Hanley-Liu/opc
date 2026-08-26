package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/hanley-liu/opc-framework/internal/agent"
	"github.com/hanley-liu/opc-framework/internal/config"
	"github.com/hanley-liu/opc-framework/internal/llm"
	"github.com/hanley-liu/opc-framework/internal/schema"
	"github.com/hanley-liu/opc-framework/internal/tool"
)

// Engine 工作流引擎 —— 纯标准库
type Engine struct {
	mu       sync.RWMutex
	state    string // stopped running paused
	cfg      *schema.Config
	runtime  *agent.Runtime
	executor *tool.Executor
	history  *History
	session  *Session
	llm      *llm.Client
}

// New 创建引擎
func New(cfg *schema.Config) *Engine {
	rt := agent.NewRuntime()
	for _, def := range cfg.Agents {
		rt.Register(def)
	}
	ex := tool.NewExecutor(".")
	for _, rule := range cfg.Permissions {
		ex.SetPermission(rule)
	}
	return &Engine{
		state:    "stopped",
		cfg:      cfg,
		runtime:  rt,
		executor: ex,
		history:  NewHistory(),
		session:  NewSession(),
		llm:      llm.NewClient(cfg),
	}
}

// Start 启动
func (e *Engine) Start(ctx context.Context) error {
	e.mu.Lock()
	if e.state == "running" {
		e.mu.Unlock()
		return fmt.Errorf("已在运行")
	}
	e.state = "running"
	e.mu.Unlock()

	e.history.Start(ctx)
	e.record("", "system", "run-start", "引擎启动", nil)
	return nil
}

// Stop 停止
func (e *Engine) Stop() {
	e.mu.Lock()
	e.state = "stopped"
	e.mu.Unlock()
	e.history.Stop()
}

// Pause 暂停 / Resume 恢复
func (e *Engine) Pause() { e.setState("paused") }
func (e *Engine) Resume() { e.setState("running") }

func (e *Engine) setState(s string) {
	e.mu.Lock(); defer e.mu.Unlock()
	if e.state == "running" || e.state == "paused" {
		e.state = s
	}
}

// State 当前状态
func (e *Engine) State() string {
	e.mu.RLock(); defer e.mu.RUnlock()
	return e.state
}

// Runtime 智能体运行时
func (e *Engine) Runtime() *agent.Runtime { return e.runtime }

// History 审计日志
func (e *Engine) History() *History { return e.history }

// Session 会话
func (e *Engine) Session() *Session { return e.session }

// Executor 工具执行器
func (e *Engine) Executor() *tool.Executor { return e.executor }

// RunTask 运行单次任务（同步，供 CLI 调用）
func (e *Engine) RunTask(ctx context.Context, agentID, task, workingDir string) error {
	a, ok := e.runtime.Get(agentID)
	if !ok {
		return fmt.Errorf("未知智能体: %s", agentID)
	}

	runID := fmt.Sprintf("%08x", time.Now().UnixNano()%0xFFFFFFFF)
	project := base(workingDir)

	e.history.Record(schema.ActivityEvent{
		Timestamp: time.Now(), RunID: runID, ProjectID: project,
		AgentID: agentID, Type: "run-start", Input: task, Status: "pending",
	})

	a.SetState("running")
	defer a.SetState("idle")

	maxSteps := a.MaxSteps
	if maxSteps <= 0 { maxSteps = e.cfg.Engine.DefaultMaxSteps }

	messages := e.llm.BuildMessages(a.Prompt, task)
	totalTokens := schema.TokenUsage{}

	for step := 1; step <= maxSteps; step++ {
		start := time.Now()
		resp, err := e.llm.Chat(ctx, messages, e.llm.DefaultTools())
		if err != nil {
			errModel := ""
			e.history.Record(schema.ActivityEvent{
				Timestamp: time.Now(), RunID: runID, ProjectID: project,
				AgentID: agentID, Type: "llm-error", Model: errModel,
				Error: err.Error(), Duration: ms(start),
			})
			return fmt.Errorf("step %d: %w", step, err)
		}

		e.history.Record(schema.ActivityEvent{
			Timestamp: time.Now(), RunID: runID, ProjectID: project,
			AgentID: agentID, Type: "llm", Model: resp.Model,
			Input: fmt.Sprintf("step %d", step),
			Tokens: schema.TokenUsage{Prompt: resp.PromptTok, Completion: resp.ComplTok, Total: resp.PromptTok + resp.ComplTok},
			Duration: ms(start), Status: "success",
		})
		totalTokens.Prompt += resp.PromptTok
		totalTokens.Completion += resp.ComplTok
		totalTokens.Total += resp.PromptTok + resp.ComplTok

		if len(resp.ToolCalls) == 0 {
			e.history.Record(schema.ActivityEvent{
				Timestamp: time.Now(), RunID: runID, ProjectID: project,
				AgentID: agentID, Type: "run-done",
				Output: truncate(resp.Content, 400), Tokens: totalTokens,
				Duration: ms(start), Status: "success",
			})
			fmt.Println(resp.Content)
			return nil
		}

		// 执行工具调用
		for _, tc := range resp.ToolCalls {
			args := parseArgs(tc.Function.Arguments)
			tStart := time.Now()
			out, err := e.executor.Execute(ctx, tc.Function.Name, args)
			ok := err == nil
			e.history.Record(schema.ActivityEvent{
				Timestamp: time.Now(), RunID: runID, ProjectID: project,
				AgentID: agentID, Type: "tool", Tool: tc.Function.Name,
				Input: truncate(tc.Function.Arguments, 200), Output: truncate(out, 300),
				Duration: ms(tStart), Status: statusOf(ok),
			})
			msgs := llm.AppendToolResult(messages, tc.ID, outOrErr(out, err))
			messages = msgs
		}
	}
	return fmt.Errorf("达到最大步数 %d", maxSteps)
}

// record 内部快捷记录
func (e *Engine) record(project, agentID, typ, detail string, _ map[string]any) {
	e.history.Record(schema.ActivityEvent{
		Timestamp: time.Now(), ProjectID: project, AgentID: agentID,
		Type: typ, Output: detail,
	})
}

// helpers
func base(dir string) string {
	for i := len(dir) - 1; i >= 0; i-- {
		if dir[i] == '/' { return dir[i+1:] }
	}
	return dir
}
func ms(t time.Time) int64 { return time.Since(t).Milliseconds() }
func statusOf(ok bool) string { if ok { return "success" }; return "error" }
func truncate(s string, n int) string { if len(s) <= n { return s }; return s[:n] + "…" }
func resp_model(r *llm.Response) string { if r != nil { return r.Model }; return "" }
func outOrErr(out string, err error) string {
	if err != nil { return "ERROR: " + err.Error() }
	if out == "" { return "(无输出)" }
	return out
}
func parseArgs(s string) map[string]any {
	var m map[string]any
	json.Unmarshal([]byte(s), &m)
	if m == nil { m = map[string]any{} }
	return m
}

// 编译期引用（config 用于未来配置热加载）
var _ = config.DataDir