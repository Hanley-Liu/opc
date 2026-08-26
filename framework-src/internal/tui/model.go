package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/hanley-liu/opc-framework/internal/engine"
)

const (
	GREEN = "\x1b[32m"; RED = "\x1b[31m"; AMBER = "\x1b[33m"; BLUE = "\x1b[36m"
	PURPLE = "\x1b[35m"; DIM = "\x1b[2m"; B = "\x1b[1m"; R = "\x1b[0m"
)

// Run 全屏 TUI 监控 —— 纯 ANSI，零依赖
func Run(eng *engine.Engine) error {
	fmt.Print("\x1b[?25l\x1b[2J") // 隐藏光标+清屏
	done := make(chan struct{})

	// 键盘 q 退出
	go func() {
		buf := make([]byte, 1)
		for {
			n, _ := fmt.Scan(buf)
			if n > 0 && (buf[0] == 'q' || buf[0] == 3) {
				close(done)
				return
			}
		}
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			fmt.Print("\x1b[?25h\x1b[2J\x1b[H")
			return nil
		case <-ticker.C:
			draw(eng)
		}
	}
}

func draw(eng *engine.Engine) {
	cols := 100
	var b strings.Builder
	line := func(s string) { b.WriteString(s + "\x1b[K\n") }

	b.WriteString("\x1b[H")

	// 头部
	state := eng.State()
	stColor, stText := GREEN, "● 运转中"
	if state != "running" { stColor, stText = RED, "○ "+state }
	line(fmt.Sprintf("%s🏢 OPC Framework%s  %s%s%s   %sTab切换 · q退出%s",
		B, R, stColor+B+stText+R, "", "", DIM, R))
	line(strings.Repeat("─", cols))

	// 员工
	agents := eng.Runtime().List()
	working := 0
	for _, a := range agents {
		if a.State == "running" { working++ }
	}
	line(fmt.Sprintf("%s👥 员工 (%d 人)%s  工作中: %s%d%s",
		B, len(agents), R, GREEN, working, R))
	for _, a := range agents {
		dot := DIM+"○"+R
		status := a.State
		switch status {
		case "running": dot = GREEN + "●" + R; status = GREEN + status + R
		case "paused": dot = AMBER + "◐" + R
		case "error": dot = RED + "✗" + R
		}
		task := a.CurrentTask
		if len(task) > 30 { task = task[:30] + "…" }
		line(fmt.Sprintf("  %s %s %-14s %s%s%s 步数:%d",
			dot, PURPLE+pad(a.Name, 14)+R, a.Role, DIM, trunc(task, cols-50), R, a.StepCount))
	}
	line("")

	// 项目池
	line(B + "📦 项目池" + R)
	// 从 session 或 config 读项目（简化：从 history 查最近事件）
	evts := eng.History().Query(8, "", "", "")
	seen := map[string]bool{}
	for _, e := range evts {
		if e.ProjectID == "" || seen[e.ProjectID] { continue }
		seen[e.ProjectID] = true
		line(fmt.Sprintf("  %s %-18s %s%s", BLUE+"●"+R, e.ProjectID, DIM, trunc(e.Output, cols-40)+R))
	}

	// 活动流
	line("")
	line(B + "🌊 活动实况" + R)
	for _, e := range evts {
		t := e.Timestamp.Format("15:04:05")
		icon := DIM + "·" + R
		switch e.Type {
		case "tool": icon = BLUE + "⚡" + R
		case "result":
			if e.Status == "success" { icon = GREEN + "✓" + R } else { icon = RED + "✗" + R }
		case "llm": icon = PURPLE + "🧠" + R
		case "run-start": icon = B + "▶" + R
		case "run-done": icon = GREEN + "■" + R
		}
		detail := trunc(e.Output, cols-40)
		line(fmt.Sprintf("  %s %s %s%s%s %s", DIM+t+R, icon, PURPLE+pad(e.AgentID, 12)+R, DIM, e.Tool, R, detail))
	}

	fmt.Print(b.String())
}

func pad(s string, w int) string {
	for len(s) < w { s += " " }
	if len(s) > w { s = s[:w] }
	return s
}
func trunc(s string, w int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > w && w > 3 { return s[:w-1] + "…" }
	return s
}