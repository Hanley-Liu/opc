package agent

import (
	"fmt"
	"sync"
	"time"

	"github.com/hanley-liu/opc-framework/internal/schema"
)

// Agent 智能体运行时实例
type Agent struct {
	schema.Agent
	mu           sync.RWMutex
	State        string // idle running paused error
	CurrentTask  string
	StepCount    int
	LastActivity time.Time
}

// SetState 状态变更
func (a *Agent) SetState(s string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.State = s
	a.LastActivity = time.Now()
}

// GetStatus 状态快照（TUI 用）
func (a *Agent) GetStatus() map[string]any {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return map[string]any{
		"id": a.ID, "name": a.Name, "role": string(a.Role),
		"state": a.State, "steps": a.StepCount,
		"task":     a.CurrentTask,
		"lastSeen": a.LastActivity.Format(time.RFC3339),
	}
}

// Runtime 智能体管理器
type Runtime struct {
	mu     sync.RWMutex
	agents map[string]*Agent
}

// NewRuntime 创建
func NewRuntime() *Runtime {
	return &Runtime{agents: make(map[string]*Agent)}
}

// Register 注册智能体
func (rt *Runtime) Register(def schema.Agent) *Agent {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	a := &Agent{Agent: def, State: "idle", LastActivity: time.Now()}
	rt.agents[def.ID] = a
	return a
}

// Get 获取
func (rt *Runtime) Get(id string) (*Agent, bool) {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	a, ok := rt.agents[id]
	return a, ok
}

// List 列出全部（按角色排序）
func (rt *Runtime) List() []*Agent {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	out := make([]*Agent, 0, len(rt.agents))
	for _, a := range rt.agents {
		out = append(out, a)
	}
	// 简单排序：按名字
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[i].Name > out[j].Name {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

// WorkingCount 工作中数量
func (rt *Runtime) WorkingCount() int {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	n := 0
	for _, a := range rt.agents {
		if a.State == "running" {
			n++
		}
	}
	return n
}

// String 调试输出
func (a *Agent) String() string {
	return fmt.Sprintf("[%s] %s (%s) state=%s steps=%d", a.ID, a.Name, a.Role, a.State, a.StepCount)
}