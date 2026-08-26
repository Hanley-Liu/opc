package schema

import "time"

type AgentRole string

const (
	RoleOrchestrator AgentRole = "orchestrator"
	RolePlanner      AgentRole = "planner"
	RoleDeveloper    AgentRole = "developer"
	RoleTester       AgentRole = "tester"
	RoleReviewer     AgentRole = "reviewer"
	RoleArchitect    AgentRole = "architect"
	RoleAnalyst      AgentRole = "analyst"
	RoleOperator     AgentRole = "operator"
)

// Agent 智能体定义
type Agent struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Role        AgentRole `json:"role"`
	Description string    `json:"description"`
	Model       string    `json:"model"`
	Tools       []string  `json:"tools"`
	Prompt      string    `json:"prompt"`
	MaxSteps    int       `json:"maxSteps"`
}

// ToolDefinition 工具定义
type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Permission  string         `json:"permission"` // allow / deny / ask
}

// PermissionRule 权限规则
type PermissionRule struct {
	Tool   string `json:"tool"`
	Action string `json:"action"` // allow, deny, ask
}

// Project 项目
type Project struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Path      string         `json:"path"`
	Status    string         `json:"status"` // active paused archived
	CreatedAt time.Time      `json:"createdAt"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

// ActivityEvent 审计日志事件 —— 全透明核心
type ActivityEvent struct {
	Timestamp time.Time      `json:"timestamp"`
	RunID     string         `json:"runId"`
	ProjectID string         `json:"projectId,omitempty"`
	AgentID   string         `json:"agentId"`
	Type      string         `json:"type"` // llm tool result error run-start run-done decision
	Tool      string         `json:"tool,omitempty"`
	Model     string         `json:"model,omitempty"`
	Input     string         `json:"input,omitempty"`
	Output    string         `json:"output,omitempty"`
	Tokens    TokenUsage     `json:"tokens,omitempty"`
	Duration  int64          `json:"durationMs,omitempty"`
	Status    string         `json:"status,omitempty"`
	Error     string         `json:"error,omitempty"`
}

// TokenUsage Token 用量
type TokenUsage struct {
	Prompt     int `json:"prompt"`
	Completion int `json:"completion"`
	Total      int `json:"total"`
}

// RunContext 运行上下文
type RunContext struct {
	RunID      string
	ProjectID  string
	AgentID    string
	Task       string
	WorkingDir string
	MaxSteps   int
	Escalated  bool
}

// Config 全局配置
type Config struct {
	Version     string                    `json:"version"`
	DataDir     string                    `json:"dataDir"`
	DefaultModel string                   `json:"defaultModel"`
	Agents      map[string]Agent          `json:"agents"`
	Tools       map[string]ToolDefinition `json:"tools"`
	Permissions []PermissionRule          `json:"permissions"`
	Projects    map[string]Project        `json:"projects"`
	Engine      EngineConfig              `json:"engine"`
	TUI         TUIConfig                 `json:"tui"`
	Providers   map[string]ProviderConfig `json:"providers"`
}

// EngineConfig 引擎配置
type EngineConfig struct {
	MaxConcurrentRuns   int `json:"maxConcurrentRuns"`
	DefaultMaxSteps     int `json:"defaultMaxSteps"`
	IterationIntervalMin int `json:"iterationIntervalMin"`
	EscalationThreshold int `json:"escalationThreshold"`
	PerpetualMode       bool `json:"perpetualMode"`
}

// TUIConfig TUI 配置
type TUIConfig struct {
	RefreshSeconds int  `json:"refreshSeconds"`
	ShowTokens     bool `json:"showTokens"`
	CompactMode    bool `json:"compactMode"`
}

// ProviderConfig LLM 供应商
type ProviderConfig struct {
	Name     string `json:"name"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey,omitempty"`
	Models   []string `json:"models"`
	Priority int    `json:"priority"`
}
