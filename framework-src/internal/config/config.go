package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/hanley-liu/opc-framework/internal/schema"
)

// DataDir 数据目录
func DataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "opc-framework")
}

// DefaultConfig 默认配置 —— 纯标准库，零依赖
func DefaultConfig() *schema.Config {
	return &schema.Config{
		Version:      "1.0.0",
		DataDir:      DataDir(),
		DefaultModel: "zen/laguna-s-2.1-free",
		Agents: map[string]schema.Agent{
			"orchestrator": {
				ID: "orchestrator", Name: "Orchestrator", Role: schema.RoleOrchestrator,
				Description: "协调多智能体协作，编排任务流",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"task", "read", "write", "bash", "glob", "grep"},
				Prompt:      "你是编排者。将复杂任务分解为子任务，分配给合适的专业智能体，监控进度，确保交付。每个决策记录理由。",
				MaxSteps:    50,
			},
			"planner": {
				ID: "planner", Name: "Planner", Role: schema.RolePlanner,
				Description: "任务分解与规划",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"read", "write", "bash"},
				Prompt:      "你是规划师。将目标分解为可执行步骤，识别依赖，输出结构化计划。",
				MaxSteps:    20,
			},
			"developer": {
				ID: "developer", Name: "Developer", Role: schema.RoleDeveloper,
				Description: "代码实现与重构",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"read", "write", "edit", "bash", "glob", "grep"},
				Prompt:      "你是开发者。编写整洁、可测试、可维护的代码。遵循最佳实践。",
				MaxSteps:    30,
			},
			"tester": {
				ID: "tester", Name: "Tester", Role: schema.RoleTester,
				Description: "测试与质量保证",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"read", "write", "bash", "glob", "grep"},
				Prompt:      "你是测试员。编写全面测试用例，覆盖边界条件，报告缺陷。",
				MaxSteps:    20,
			},
			"reviewer": {
				ID: "reviewer", Name: "Reviewer", Role: schema.RoleReviewer,
				Description: "代码审查与安全审计",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"read", "grep", "glob"},
				Prompt:      "你是审查员。检查代码质量、安全、性能。指出问题并给建议。",
				MaxSteps:    15,
			},
			"architect": {
				ID: "architect", Name: "Architect", Role: schema.RoleArchitect,
				Description: "系统架构设计",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"read", "write", "glob", "grep"},
				Prompt:      "你是架构师。设计架构，选型技术栈，定义接口契约。",
				MaxSteps:    20,
			},
			"analyst": {
				ID: "analyst", Name: "Analyst", Role: schema.RoleAnalyst,
				Description: "数据分析与经营洞察",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"read", "write", "bash"},
				Prompt:      "你是分析师。从数据提取洞察，生成报告，辅助决策。",
				MaxSteps:    15,
			},
			"operator": {
				ID: "operator", Name: "Operator", Role: schema.RoleOperator,
				Description: "部署运维与发布",
				Model:       "zen/laguna-s-2.1-free",
				Tools:       []string{"bash", "read", "write"},
				Prompt:      "你是运维员。负责部署、监控、发布、回滚、故障排查。",
				MaxSteps:    20,
			},
		},
		Tools: map[string]schema.ToolDefinition{
			"read":  {Name: "read", Description: "读取文件", Permission: "allow"},
			"write": {Name: "write", Description: "写入文件", Permission: "allow"},
			"edit":  {Name: "edit", Description: "编辑文件", Permission: "allow"},
			"bash":  {Name: "bash", Description: "执行 Shell 命令", Permission: "ask"},
			"glob":  {Name: "glob", Description: "文件匹配", Permission: "allow"},
			"grep":  {Name: "grep", Description: "内容搜索", Permission: "allow"},
			"task":  {Name: "task", Description: "委派子任务", Permission: "allow"},
		},
		Permissions: []schema.PermissionRule{
			{Tool: "read", Action: "allow"},
			{Tool: "write", Action: "allow"},
			{Tool: "edit", Action: "allow"},
			{Tool: "bash", Action: "allow"},
			{Tool: "glob", Action: "allow"},
			{Tool: "grep", Action: "allow"},
			{Tool: "task", Action: "allow"},
		},
		Projects: map[string]schema.Project{},
		Engine: schema.EngineConfig{
			MaxConcurrentRuns:    3,
			DefaultMaxSteps:      30,
			IterationIntervalMin: 60,
			EscalationThreshold:  3,
			PerpetualMode:        true,
		},
		TUI: schema.TUIConfig{
			RefreshSeconds: 2,
			ShowTokens:     true,
			CompactMode:    false,
		},
		Providers: map[string]schema.ProviderConfig{
			"zen": {Name: "zen", BaseURL: "https://opencode.ai/zen/v1", Priority: 1, Models: []string{"laguna-s-2.1-free", "nemotron-3.5-lightning-free"}},
			"kilo": {Name: "kilo", BaseURL: "https://api.kilo.ai/api/gateway", Priority: 2, Models: []string{"poolside/laguna-s-2.1:free"}},
			"deepseek": {Name: "deepseek", BaseURL: "https://api.deepseek.com/v1", Priority: 3, Models: []string{"deepseek-chat", "deepseek-v4-flash-vision-exp"}},
			"openrouter": {Name: "openrouter", BaseURL: "https://openrouter.ai/api/v1", Priority: 4, Models: []string{}},
		},
	}
}

// Load 加载配置（用户配置覆盖默认值）
func Load(path string) (*schema.Config, error) {
	cfg := DefaultConfig()

	if path == "" {
		path = filepath.Join(DataDir(), "config.json")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			Save(cfg, path) // 首次运行写出默认配置
			return cfg, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("解析配置 %s: %w", path, err)
	}
	ensureDirs()
	return cfg, nil
}

// Save 保存配置
func Save(cfg *schema.Config, path string) error {
	if path == "" {
		path = filepath.Join(DataDir(), "config.json")
	}
	os.MkdirAll(filepath.Dir(path), 0755)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(path, data, 0644)
}

func ensureDirs() {
	d := DataDir()
	for _, sub := range []string{"logs", "projects", "sessions"} {
		os.MkdirAll(filepath.Join(d, sub), 0755)
	}
}

// Now 当前时间（便于测试）
var Now = time.Now