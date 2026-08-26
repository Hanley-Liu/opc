package tui

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/hanley-liu/opc-framework/internal/engine"
	"github.com/hanley-liu/opc-framework/internal/schema"
)

const (
	GREEN  = "\x1b[32m"; RED = "\x1b[31m"; AMBER = "\x1b[33m"; CYAN = "\x1b[96m"
	PURPLE = "\x1b[35m"; DIM = "\x1b[2m"; B = "\x1b[1m"; R = "\x1b[0m"
)

var printMu sync.Mutex

func out(s string) {
	printMu.Lock()
	fmt.Println(s)
	printMu.Unlock()
}

func trunc(s string, w int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	r := []rune(s)
	if len(r) <= w { return s }
	return string(r[:w]) + "…"
}

// Chat opencode 式对话界面：追加式滚动、工具调用内嵌、底部输入
func Chat(eng *engine.Engine) error {
	fmt.Print("\x1b[2J\x1b[H")
	line := func(s string) { fmt.Println(s) }
	bar := DIM + "─" + R
	line(strings.Repeat(bar, 3) + B + " 🏢 OPC · 对话模式 " + R + strings.Repeat(bar, 30))
	line(DIM + "  输入任务即刻执行 · /agents 名册 · /status 状态 · /exit 退出" + R)

	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Print("\n" + GREEN + B + "❯ " + R)
		input, err := reader.ReadString('\n')
		if err != nil { return nil }
		input = strings.TrimSpace(input)
		if input == "" { continue }

		switch strings.ToLower(input) {
		case "/exit", "/quit", "/q":
			line(DIM + "再见 👋" + R)
			return nil
		case "/agents":
			for _, a := range eng.Runtime().List() {
				dot := DIM + "○" + R
				if a.State == "running" { dot = GREEN + "●" + R }
				fmt.Printf("  %s %s %-12s %s\n", dot, PURPLE+pad(a.Name, 13)+R, a.Role, DIM+a.Description+R)
			}
			continue
		case "/status":
			fmt.Printf("  引擎: %s%s%s · 员工 %d 人\n  审计: %s\n",
				GREEN+B, eng.State(), R, len(eng.Runtime().List()), eng.History().FilePath())
			continue
		case "/clear":
			fmt.Print("\x1b[2J\x1b[H")
			continue
		}

		fmt.Printf("\n%s▌ You%s %s\n", B, R, input)

		agentID := route(input)
		events := make(chan schema.ActivityEvent, 64)
		eng.OnEvent = func(e schema.ActivityEvent) { events <- e }

		done := make(chan error, 1)
		go func() {
			done <- eng.RunTask(context.Background(), agentID, input, cwdOrDot())
		}()

		renderLoop(events, done)
		eng.OnEvent = nil
		drain(events)
		fmt.Println()
	}
}

// renderLoop 消费事件直到任务结束 —— 对话流渲染
func renderLoop(events chan schema.ActivityEvent, done chan error) {
	var activeSpin *spinnerT
	startSpin := func(label string) {
		if activeSpin == nil {
			activeSpin = newSpinner(label)
		}
	}
	stopSpinner := func() {
		if activeSpin != nil {
			activeSpin.Stop()
			activeSpin = nil
		}
	}

	for {
		select {
		case e := <-events:
			stopSpinner() // 任何新事件=模型已回复，转圈立即停止
			render(e)
			if e.Type == "llm" {
				startSpin("thinking")
			}
		case err := <-done:
			stopSpinner()
			if err != nil {
				out(fmt.Sprintf("  %s✗ %s%s", RED, trunc(err.Error(), 140), R))
			}
			// 排干剩余事件
			for {
				select {
				case e := <-events: render(e)
				default: return
				}
			}
		}
	}
}

func render(e schema.ActivityEvent) {
	switch e.Type {
	case "run-start":
		out(fmt.Sprintf("\n%s● Orchestrator%s %s· 开始处理%s", B, PURPLE+R, DIM, R))

	case "llm":
		extra := ""
		if e.Duration > 0 { extra = fmt.Sprintf(" (%dms)", e.Duration) }
		out(fmt.Sprintf("  %s· %s ↑%d ↓%d tok%s%s",
			DIM, trunc(e.Model, 30), e.Tokens.Prompt, e.Tokens.Completion, extra, R))

	case "tool":
		fmt.Print("\r\x1b[K") // 防御性清行
		out(fmt.Sprintf("  %s⚡ %s%s %s",
			CYAN+B+e.Tool+R, AMBER, prettyInput(e.Input), R))

	case "result":
		fmt.Print("\r\x1b[K")
		mark := GREEN + "✓" + R
		if e.Status != "success" { mark = RED + "✗" + R }
		first := strings.TrimSpace(e.Output)
		if i := strings.Index(first, "\n"); i > 0 { first = first[:i] }
		out(fmt.Sprintf("    %s %s%s%s", mark, DIM, trunc(first, cols()-14), R))

	case "run-done":
		if e.Output != "" {
			out(fmt.Sprintf("\n%s● Orchestrator%s", B, R))
			for _, ln := range strings.Split(strings.TrimSpace(e.Output), "\n") {
				out("  " + ln)
			}
		}
		out(fmt.Sprintf("\n%s  ── 完成 · %d tokens · %dms ──%s", DIM, e.Tokens.Total, e.Duration, R))

	case "llm-error":
		out(fmt.Sprintf("  %s⚠ %s%s", RED, trunc(e.Error, 120), R))
	}
}

// spinnerT 带同步停止的思考动画（Stop() 阻塞到清行完成，杜绝渲染竞态）
type spinnerT struct {
	stop chan struct{}
	done chan struct{}
}

func newSpinner(label string) *spinnerT {
	s := &spinnerT{stop: make(chan struct{}), done: make(chan struct{})}
	go s.run(label)
	return s
}

func (s *spinnerT) Stop() {
	close(s.stop)
	<-s.done // 关键：等清行动作真正执行完再继续打印事件
}

func (s *spinnerT) run(label string) {
	defer close(s.done)
	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	i := 0
	printMu.Lock()
	fmt.Printf("  %s%s %s…%s", DIM, frames[0], label, R)
	printMu.Unlock()
	t := time.NewTicker(110 * time.Millisecond)
	defer t.Stop()
	for {
		// 停止信号优先：避免与 ticker 同时就绪时被随机选中导致清行延迟
		select {
		case <-s.stop:
			printMu.Lock()
			fmt.Print("\r\x1b[K")
			printMu.Unlock()
			return
		default:
		}
		select {
		case <-s.stop:
			printMu.Lock()
			fmt.Print("\r\x1b[K")
			printMu.Unlock()
			return
		case <-t.C:
			i++
			printMu.Lock()
			fmt.Printf("\r  %s%s %s…%s\x1b[K", DIM, frames[i%len(frames)], label, R)
			printMu.Unlock()
		}
	}
}

func prettyInput(raw string) string {
	raw = strings.ReplaceAll(raw, "\\\"", "\"")
	var m map[string]interface{}
	if json.Unmarshal([]byte(raw), &m) == nil && m != nil {
		if c, ok := m["command"].(string); ok && c != "" { return "$ " + c }
		if f, ok := m["path"].(string); ok { return f }
		if p, ok := m["pattern"].(string); ok { return "/" + p }
	}
	return raw
}

func route(input string) string {
	low := strings.ToLower(input)
	switch {
	case strings.Contains(low, "测试"), strings.Contains(low, "test"): return "tester"
	case strings.Contains(low, "架构"): return "architect"
	case strings.Contains(low, "审查"), strings.Contains(low, "review"): return "reviewer"
	case strings.Contains(low, "部署"), strings.Contains(low, "发布"): return "operator"
	case strings.Contains(low, "规划"), strings.Contains(low, "计划"): return "planner"
	default: return "orchestrator"
	}
}

func cwdOrDot() string {
	d, _ := os.Getwd()
	return d
}

func cols() int { return 84 }

func pad(s string, w int) string {
	for len(s) < w { s += " " }
	if len(s) > w { s = s[:w] }
	return s
}
// drain 排干通道
func drain(ch chan schema.ActivityEvent) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}
