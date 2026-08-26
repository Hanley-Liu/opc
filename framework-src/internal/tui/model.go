package tui

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/hanley-liu/opc-framework/internal/engine"
	"github.com/hanley-liu/opc-framework/internal/schema"
)

// ───────────── 主题（tokyonight 风，opencode 视觉） ─────────────
type uiTheme struct {
	Bg, Border, Primary, Secondary, Text, Muted, ErrorC, SuccessC, WarnC, ToolC lipgloss.Color
}

func themeNow() uiTheme {
	return uiTheme{
		Bg: "#1a1b26", Border: "#3d445c",
		Primary: "#7aa2f7", Secondary: "#bb9af7",
		Text: "#c0caf5", Muted: "#565f89",
		ErrorC: "#f7768e", SuccessC: "#9ece6a", WarnC: "#e0af68", ToolC: "#7dcfff",
	}
}

const maxResultHeight = 10

// ───────────── 消息块（opencode 三类消息） ─────────────
type bKind int

const (
	bUser bKind = iota
	bAssistant
	bTool
)

type block struct {
	kind     bKind
	title    string // You / Orchestrator / bash …
	body     string // 用户/AI 正文 或 工具参数摘要
	output   string // 工具结果全文
	isErr    bool
	meta     string // assistant 底部 meta 行
	thinking bool   // ⟳ 占位块
	at       time.Time
}

func (b block) render(w int) string {
	t := themeNow()
	if w < 24 { w = 24 }
	inner := w - 4 // 边框+缩进

	switch b.kind {
	case bUser:
		st := lipgloss.NewStyle().
			Width(inner).BorderLeft(true).
			Foreground(lipgloss.Color(t.Text)).
			BorderForeground(lipgloss.Color(t.Secondary)).
			BorderStyle(lipgloss.ThickBorder())
		return st.Render(wrapStr(b.body, inner))

	case bAssistant:
		st := lipgloss.NewStyle().
			Width(inner).BorderLeft(true).
			Foreground(lipgloss.Color(t.Text)).
			BorderForeground(lipgloss.Color(t.Primary)).
			BorderStyle(lipgloss.ThickBorder())
		body := wrapStr(b.body, inner)
		if b.meta != "" {
			body += "\n" + lipgloss.NewStyle().Foreground(lipgloss.Color(t.Muted)).Render(b.meta)
		}
		return st.Render(body)

	case bTool:
		if b.thinking {
			return lipgloss.NewStyle().Foreground(lipgloss.Color(t.Muted)).
				Render("  ⟳ thinking…")
		}
		mark, mc := "✓", t.SuccessC
		if b.isErr { mark, mc = "✖", t.ErrorC }
		head := fmt.Sprintf("%s %s %s",
			lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(t.ToolC)).Render("⚡"),
			lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(t.ToolC)).Render(b.title),
			lipgloss.NewStyle().Foreground(lipgloss.Color(t.Muted)).Render(truncLine(b.body, inner-8)),
		)
		lines := []string{}
		if b.output != "" {
			for _, l := range strings.Split(strings.TrimRight(b.output, "\n"), "\n") {
				lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color(mc)).Render("    "+l))
			}
		}
		_ = mark
		if len(lines) > maxResultHeight {
			extra := len(lines) - maxResultHeight
			lines = append(lines[:maxResultHeight],
				lipgloss.NewStyle().Foreground(lipgloss.Color(t.Muted)).Render(fmt.Sprintf("    … (+%d lines)", extra)))
		}
		all := append([]string{head}, lines...)
		return strings.Join(all, "\n")
	}
	return ""
}

func wrapStr(s string, w int) string {
	var out []string
	for _, para := range strings.Split(s, "\n") {
		if para == "" { out = append(out, ""); continue }
		line := ""
		for _, word := range strings.Fields(para) {
			switch {
			case line == "": line = word
			case len(line)+1+len(word) <= w: line += " " + word
			default: out = append(out, line); line = word
			}
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func truncLine(s string, w int) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\r", "")
	r := []rune(s)
	if len(r) <= w { return s }
	return string(r[:max(1, w-1)]) + "…"
}
func maxi(a, b int) int { if a > b { return a }; return b }

// ───────────── Model ─────────────
type Model struct {
	eng      *engine.Engine
	w        int
	h        int
	ready    bool
	busy     bool
	blocks   []block
	vp       viewport.Model
	editor   textarea.Model
	eventCh  chan schema.ActivityEvent
	model       string
	totalTok    int
	dirtyFlag   bool
	mu          sync.Mutex
}

// New 创建 TUI 模型
func New(eng *engine.Engine) Model {
	ta := textarea.New()
	ta.Placeholder = "描述任务，Enter 发送 · Ctrl+C 退出"
	ta.Prompt = ""
	ta.CharLimit = 8000
	ta.ShowLineNumbers = false
	ta.SetWidth(70)
	ta.Focus()

	vp := viewport.New(70, 20)
	vp.SetContent("")

	m := Model{
		eng: eng, editor: ta, vp: vp,
		eventCh: make(chan schema.ActivityEvent, 256),
		model:   eng.Config().DefaultModel,
	}
	eng.OnEvent = func(e schema.ActivityEvent) {
		select { case m.eventCh <- e: default: }
	}
	return m
}

type evtTick struct{}
type evtEngine schema.ActivityEvent

func (m Model) Init() tea.Cmd {
	return tea.Batch(waitEngine(m.eventCh), tickEvery())
}

func waitEngine(ch chan schema.ActivityEvent) tea.Cmd {
	return func() tea.Msg {
		e, ok := <-ch
		if !ok { return nil }
		return evtEngine(e)
	}
}

func tickEvery() tea.Cmd {
	return tea.Tick(time.Second, func(time.Time) tea.Msg { return evtTick{} })
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
		vh := m.h - 8
		if vh < 6 { vh = 6 }
		m.vp.Width = m.w - 2
		m.vp.Height = vh
		m.editor.SetWidth(m.w - 4)
		if !m.ready { m.ready = true }
		cmds = append(cmds, cmdRefresh())

	case evtTick:
		cmds = append(cmds, doRefresh, tickEvery())

	case evtEngine:
		e := schema.ActivityEvent(msg)
		m.mu.Lock()
		m.absorb(e)
		m.mu.Unlock()
		cmds = append(cmds, doRefresh, waitEngine(m.eventCh))

	case doRefreshMsg:
		m.rebuild()

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, tea.Quit
		}
		// Enter 发送；其余给 textarea / viewport
		if m.editor.Focused() && msg.String() == "enter" {
			val := strings.TrimSpace(m.editor.Value())
			if val != "" && !m.busy {
				m.editor.Reset()
				m.submit(val)
			} else if val != "" && m.busy {
				// 忙碌时提示块
				m.mu.Lock()
				m.blocks = append(m.blocks, block{kind: bTool, title: "busy",
					output: "当前任务运行中，完成后自动继续。请稍候。"})
				m.mu.Unlock()
				m.editor.Reset()
			}
			cmds = append(cmds, cmdRefresh())
			return m, tea.Batch(cmds...)
		}
		var c1 tea.Cmd
		m.editor, c1 = m.editor.Update(msg)
		var c2 tea.Cmd
		m.vp, c2 = m.vp.Update(msg)
		cmds = append(cmds, c1, c2)
	}

	var c1 tea.Cmd
	m.editor, c1 = m.editor.Update(msg)
	cmds = append(cmds, c1)
	var c2 tea.Cmd
	m.vp, c2 = m.vp.Update(msg)
	cmds = append(cmds, c2)

	if m.dirtyFlag {
		m.dirtyFlag = false
		m.rebuild()
	}
	return m, tea.Batch(cmds...)
}

type doRefreshMsg struct{}

func doRefresh() tea.Msg { return doRefreshMsg{} }
func cmdRefresh() tea.Cmd { return func() tea.Msg { return doRefreshMsg{} } }

// submit 提交任务到引擎
func (m *Model) submit(task string) {
	dir, _ := os.Getwd()
	m.mu.Lock()
	m.blocks = append(m.blocks,
		block{kind: bUser, title: "You", body: task, at: time.Now()},
		block{kind: bTool, title: "…", thinking: true},
	)
	m.busy = true
	m.mu.Unlock()

	go func() {
		ctx := context.Background()
		defer func() { m.eng.OnEvent = nil }()
		_ = m.eng.RunTask(ctx, routeAgent(task), task, dir)
	}()
}

// absorb 引擎事件 → 界面块
func (m *Model) absorb(e schema.ActivityEvent) {
	// 去掉 thinking 占位
	if n := len(m.blocks); n > 0 && m.blocks[n-1].thinking {
		m.blocks = m.blocks[:n-1]
	}
	switch e.Type {
	case "run-start":
		// 已有 user/thinking 块，无需额外
	case "llm":
		m.model = e.Model
		m.totalTok += e.Tokens.Total
	case "tool":
		m.blocks = append(m.blocks, block{
			kind: bTool, title: e.Tool,
			body: prettyParams(e.Input), at: e.Timestamp,
		})
	case "result":
		isErr := e.Status != "success"
		if n := len(m.blocks); n > 0 && m.blocks[n-1].kind == bTool && !m.blocks[n-1].thinking {
			m.blocks[n-1].output = e.Output
			m.blocks[n-1].isErr = isErr
		} else {
			m.blocks = append(m.blocks, block{kind: bTool, title: "result", output: e.Output, isErr: isErr})
		}
	case "run-done":
		meta := fmt.Sprintf("%s · ↑%d ↓%d tokens · %dms", e.Model, e.Tokens.Prompt, e.Tokens.Completion, e.Duration)
		m.blocks = append(m.blocks, block{
			kind: bAssistant, title: "Orchestrator",
			body: strings.TrimSpace(e.Output), meta: meta,
		})
		m.totalTok += e.Tokens.Total
		m.busy = false
	case "llm-error":
		m.blocks = append(m.blocks, block{
			kind: bTool, title: "model", output: e.Error, isErr: true,
		})
		m.busy = false
	}
	m.dirtyFlag = true
}

// rebuild 重建视口内容并滚到底部
func (m *Model) rebuild() {
	t := themeNow()
	var parts []string
	w := maxi(40, m.vp.Width-2)
	for _, b := range m.blocks {
		parts = append(parts, b.render(w), "")
	}
	if m.busy {
		parts = append(parts, lipgloss.NewStyle().Foreground(lipgloss.Color(t.Muted)).Render("  ⟳ working…"))
	}
	m.vp.SetContent(strings.Join(parts, "\n"))
	m.vp.GotoBottom()
}

// View 渲染整体布局：header / chat / editor / status
func (m Model) View() string {
	t := themeNow()
	if !m.ready {
		return "初始化中…"
	}

	header := lipgloss.NewStyle().
		Bold(true).Foreground(lipgloss.Color(t.Primary)).
		Background(lipgloss.Color("#16161e")).
		Width(m.w).Render(fmt.Sprintf(" ⌬ OPC · 对话 · %s%s", truncLine(m.model, 40), busyHint(m.busy)))

	editorBox := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(t.Border)).
		Width(m.w - 2).
		Render(m.editor.View())

	stateIcon := lipgloss.NewStyle().Foreground(lipgloss.Color(t.SuccessC)).Render("●")
	if !m.busy { stateIcon = lipgloss.NewStyle().Foreground(lipgloss.Color(t.Muted)).Render("○") }
	status := fmt.Sprintf(" %s 引擎:%s · 员工:%d · ↑↓%d tok",
		stateIcon, engState(m.eng), len(m.eng.Runtime().List()), m.totalTok)
	statusBar := lipgloss.NewStyle().
		Foreground(lipgloss.Color(t.Muted)).Background(lipgloss.Color("#16161e")).
		Width(m.w).Render(status)

	return header + "\n" + m.vp.View() + "\n" + editorBox + "\n" + statusBar
}

func busyHint(busy bool) string {
	if busy { return "  ⟳" }
	return ""
}

func engState(e *engine.Engine) string {
	switch e.State() {
	case "running": return "运行中"
	case "paused": return "暂停"
	default: return "停止"
	}
}

// prettyParams 工具参数人性化（opencode renderToolParams 精神）
func prettyParams(raw string) string {
	var m map[string]interface{}
	if json.Unmarshal([]byte(raw), &m) == nil && m != nil {
		if c, ok := m["command"].(string); ok && c != "" {
			return "$ " + strings.ReplaceAll(c, "\n", " ")
		}
		if f, ok := m["path"].(string); ok && f != "" {
			return f
		}
		if p, ok := m["pattern"].(string); ok && p != "" {
			if path, ok2 := m["path"].(string); ok2 && path != "" {
				return p + "  in " + path
			}
			return "/" + p
		}
		if a, ok := m["agent"].(string); ok {
			d, _ := m["task_desc"].(string)
			return "→ " + a + ": " + d
		}
		if q, ok := m["query"].(string); ok {
			return q
		}
		if u, ok := m["url"].(string); ok {
			return u
		}
	}
	return truncLine(raw, 60)
}

// Run 启动 TUI 程序
func Run(eng *engine.Engine) error {
	p := tea.NewProgram(New(eng), tea.WithAltScreen(), tea.WithMouseCellMotion())
	_, err := p.Run()
	return err
}
func routeAgent(input string) string {
	low := strings.ToLower(input)
	switch {
	case strings.Contains(low, "测试"), strings.Contains(low, "test"): return "tester"
	case strings.Contains(low, "架构"): return "architect"
	case strings.Contains(low, "审查"), strings.Contains(low, "review"): return "reviewer"
	case strings.Contains(low, "部署"), strings.Contains(low, "发布"): return "operator"
	case strings.Contains(low, "规划"): return "planner"
	default: return "orchestrator"
	}
}
