package tool

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hanley-liu/opc-framework/internal/schema"
)

// Executor 工具执行器 —— 纯标准库
type Executor struct {
	mu          sync.RWMutex
	Tools       map[string]ToolFunc
	Permissions map[string]schema.PermissionRule
	WorkingDir  string
}

// ToolFunc 工具函数签名
type ToolFunc func(ctx context.Context, args map[string]any) (string, error)

// NewExecutor 创建执行器
func NewExecutor(workingDir string) *Executor {
	e := &Executor{
		Tools:       make(map[string]ToolFunc),
		Permissions: make(map[string]schema.PermissionRule),
		WorkingDir:  workingDir,
	}
	e.registerBuiltins()
	return e
}

// SetPermission 设置权限
func (e *Executor) SetPermission(rule schema.PermissionRule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.Permissions[rule.Tool] = rule
}

// CheckPermission 权限检查
func (e *Executor) CheckPermission(tool string) (bool, string) {
	e.mu.RLock()
	rule, ok := e.Permissions[tool]
	e.mu.RUnlock()
	if !ok {
		return true, "" // 未声明的工具默认允许（内置白名单）
	}
	switch rule.Action {
	case "allow":
		return true, ""
	case "deny":
		return false, "permission denied: " + tool
	case "ask":
		return false, "需要交互确认: " + tool + " (headless 自动拒绝)"
	default:
		return false, "unknown action: " + rule.Action
	}
}

// Execute 执行工具（带权限检查 + 审计钩子）
func (e *Executor) Execute(ctx context.Context, name string, args map[string]any) (string, error) {
	if ok, msg := e.CheckPermission(name); !ok {
		return "", fmt.Errorf("%s", msg)
	}
	e.mu.RLock()
	fn, ok := e.Tools[name]
	e.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("未知工具: %s", name)
	}
	return fn(ctx, args)
}

func (e *Executor) registerBuiltins() {
	e.Tools["read"] = e.toolRead
	e.Tools["write"] = e.toolWrite
	e.Tools["edit"] = e.toolEdit
	e.Tools["bash"] = e.toolBash
	e.Tools["glob"] = e.toolGlob
	e.Tools["grep"] = e.toolGrep
}

func (e *Executor) resolve(p string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(e.WorkingDir, p)
}

func (e *Executor) toolRead(_ context.Context, args map[string]any) (string, error) {
	p, _ := args["path"].(string)
	data, err := os.ReadFile(e.resolve(p))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (e *Executor) toolWrite(_ context.Context, args map[string]any) (string, error) {
	p, _ := args["path"].(string)
	content, _ := args["content"].(string)
	full := e.resolve(p)
	os.MkdirAll(filepath.Dir(full), 0o755)
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		return "", err
	}
	return fmt.Sprintf("已写入 %d 字节 → %s", len(content), full), nil
}

func (e *Executor) toolEdit(_ context.Context, args map[string]any) (string, error) {
	p, _ := args["path"].(string)
	oldS, _ := args["old_string"].(string)
	newS, _ := args["new_string"].(string)
	full := e.resolve(p)
	data, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	src := string(data)
	cnt := strings.Count(src, oldS)
	if cnt == 0 {
		return "", fmt.Errorf("old_string 未找到")
	}
	if cnt > 1 {
		return "", fmt.Errorf("old_string 匹配 %d 处，请增加上下文", cnt)
	}
	if err := os.WriteFile(full, []byte(strings.Replace(src, oldS, newS, 1)), 0o644); err != nil {
		return "", err
	}
	return "已编辑", nil
}

func (e *Executor) toolBash(ctx context.Context, args map[string]any) (string, error) {
	cmd, _ := args["command"].(string)
	timeoutMs := 120_000
	if t, ok := args["timeout_ms"].(float64); ok && t > 0 {
		timeoutMs = int(t)
	}
	cctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	cmdExec := exec.CommandContext(cctx, "bash", "-c", cmd)
	cmdExec.Dir = e.WorkingDir
	out, err := cmdExec.CombinedOutput()
	res := string(out)
	if err != nil {
		return res, fmt.Errorf("exit: %w", err)
	}
	return res, nil
}

func (e *Executor) toolGlob(_ context.Context, args map[string]any) (string, error) {
	pat, _ := args["pattern"].(string)
	matches, err := filepath.Glob(e.resolve(pat))
	if err != nil {
		return "", err
	}
	return strings.Join(matches, "\n"), nil
}

func (e *Executor) toolGrep(ctx context.Context, args map[string]any) (string, error) {
	pat, _ := args["pattern"].(string)
	root := e.WorkingDir
	if p, ok := args["path"].(string); ok && p != "" {
		root = e.resolve(p)
	}
	c := exec.CommandContext(ctx, "grep", "-rn", "--", pat, root)
	out, err := c.CombinedOutput()
	if err != nil && len(out) == 0 {
		return "无匹配", nil
	}
	return strings.TrimSpace(string(out)), nil
}