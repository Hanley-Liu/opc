package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/hanley-liu/opc-framework/internal/schema"
)

// History 审计日志 —— 全透明的核心，JSONL 落盘
type History struct {
	mu       sync.Mutex
	events   []schema.ActivityEvent
	filePath string
	stopCh   chan struct{}
}

// NewHistory 创建
func NewHistory() *History {
	dir := filepath.Join(dataDir(), "logs")
	os.MkdirAll(dir, 0o755)
	return &History{
		events:   []schema.ActivityEvent{},
		filePath: filepath.Join(dir, "activity.jsonl"),
		stopCh:   make(chan struct{}),
	}
}

func dataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "opc-framework")
}

// Start 启动定时刷盘
func (h *History) Start(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	go func() {
		for {
			select {
			case <-ctx.Done():
				t.Stop()
				h.Flush()
				return
			case <-h.stopCh:
				t.Stop()
				h.Flush()
				return
			case <-t.C:
				h.Flush()
			}
		}
	}()
}

// Stop 停止
func (h *History) Stop() {
	select { case <-h.stopCh: default: close(h.stopCh) }
	h.Flush()
}

// Record 记录事件（内存 + 异步落盘）
func (h *History) Record(e schema.ActivityEvent) {
	h.mu.Lock()
	h.events = append(h.events, e)
	n := len(h.events)
	h.mu.Unlock()
	if n >= 50 { // 批量阈值
		h.Flush()
	}
}

// Flush 落盘
func (h *History) Flush() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.events) == 0 {
		return
	}
	f, err := os.OpenFile(h.filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	for _, e := range h.events {
		enc.Encode(e)
	}
	h.events = h.events[:0]
}

// Query 查询（倒序）
func (h *History) Query(limit int, projectID, agentID, typ string) []schema.ActivityEvent {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := []schema.ActivityEvent{}
	for i := len(h.events) - 1; i >= 0 && len(out) < limit; i-- {
		e := h.events[i]
		if projectID != "" && e.ProjectID != projectID { continue }
		if agentID != "" && e.AgentID != agentID { continue }
		if typ != "" && e.Type != typ { continue }
		out = append(out, e)
	}
	return out
}

// FilePath 日志路径
func (h *History) FilePath() string { return h.filePath }

// Session 会话管理
type Session struct {
	mu     sync.RWMutex
	id     string
	data   map[string]any
	path   string
}

// NewSession 创建
func NewSession() *Session {
	return &Session{
		id:   fmt.Sprintf("s-%d", time.Now().Unix()),
		data: map[string]any{},
		path: filepath.Join(dataDir(), "session.json"),
	}
}

// Set 设置
func (s *Session) Set(k string, v any) {
	s.mu.Lock(); defer s.mu.Unlock()
	s.data[k] = v
	s.persist()
}

// Get 读取
func (s *Session) Get(k string) (any, bool) {
	s.mu.RLock(); defer s.mu.RUnlock()
	v, ok := s.data[k]
	return v, ok
}

// ID 会话 ID
func (s *Session) ID() string { s.mu.RLock(); defer s.mu.RUnlock(); return s.id }

func (s *Session) persist() {
	b, _ := json.MarshalIndent(map[string]any{"id": s.id, "data": s.data, "at": time.Now().Format(time.RFC3339)}, "", " ")
	os.WriteFile(s.path, b, 0o644)
}