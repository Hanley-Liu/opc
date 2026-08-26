package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/hanley-liu/opc-framework/internal/config"
	"github.com/hanley-liu/opc-framework/internal/engine"
	"github.com/hanley-liu/opc-framework/internal/schema"
	"github.com/hanley-liu/opc-framework/internal/tui"
)

var version = "1.0.0"

func main() {
	if len(os.Args) < 2 {
		usage()
		return
	}
	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "version", "--version", "-v":
		fmt.Println("opc-framework", version)

	case "run":
		var agentID, dir, model, task string
		var positional []string
		for i := 0; i < len(args); i++ {
			switch args[i] {
			case "--agent":
				i++; if i < len(args) { agentID = args[i] }
			case "--dir":
				i++; if i < len(args) { dir = args[i] }
			case "--model":
				i++; if i < len(args) { model = args[i] }
			default:
				positional = append(positional, args[i])
			}
		}
		if len(positional) == 0 {
			fmt.Println(`用法: opc run "任务" [--agent X] [--dir Y] [--model P/M]`)
			os.Exit(1)
		}
		task = positional[0]
		if agentID == "" { agentID = "orchestrator" }
		if dir == "" { cwd, _ := os.Getwd(); dir = cwd }
		abs, _ := filepath.Abs(dir)

		cfg := loadConfig()
		if model != "" { cfg.DefaultModel = model }
		eng := engine.New(cfg)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		eng.Start(ctx)
		defer eng.Stop()

		if err := eng.RunTask(ctx, agentID, task, abs); err != nil {
			fmt.Fprintln(os.Stderr, "[error]", err)
			os.Exit(1)
		}

	case "serve", "start", "tui":
		cfg := loadConfig()
		eng := engine.New(cfg)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		if err := eng.Start(ctx); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }

		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			<-sigCh
			cancel()
			eng.Stop()
			fmt.Println("\n再见")
			os.Exit(0)
		}()

		tui.Run(eng)

	case "agents":
		cfg := loadConfig()
		fmt.Printf("%-16s %-14s %s\n", "ID", "角色", "描述")
		for _, a := range cfg.Agents {
			fmt.Printf("%-16s %-14s %s\n", a.ID, string(a.Role), trunc(a.Description, 44))
		}

	case "status":
		cfg := loadConfig()
		b, _ := json.MarshalIndent(map[string]any{
			"version":   version,
			"dataDir":   cfg.DataDir,
			"agents":    len(cfg.Agents),
			"model":     cfg.DefaultModel,
			"perpetual": cfg.Engine.PerpetualMode,
		}, "", " ")
		fmt.Println(string(b))

	default:
		usage()
	}
}

func loadConfig() *schema.Config {
	cfg, err := config.Load("")
	if err != nil {
		fmt.Fprintln(os.Stderr, "配置加载失败:", err)
		os.Exit(1)
	}
	return cfg
}

func usage() {
	fmt.Printf(`OPC Framework v%s — 完全透明可审计的自主 AI 公司

用法:
  opc run "任务" [--agent ID] [--dir DIR] [--model P/M]   运行任务
  opc agents                                              智能体名册
  opc status                                              系统状态
  opc serve                                               TUI 监控台
`, version)
}

func trunc(s string, n int) string {
	r := []rune(s)
	if len(r) <= n { return s }
	return string(r[:n]) + "…"
}

var _ = strings.TrimSpace