package adapter

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClaudeCodeAdapter(t *testing.T) {
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, onLine func(string)) error {
			onLine("edited README.md")
			return nil
		},
	}
	id := a.Identify()
	if id.Name != "claude-code" || !id.Has(CanEditCode) {
		t.Fatalf("bad identity: %+v", id)
	}
	if err := a.Prepare(context.Background(), PrepareContext{}); err != nil {
		t.Fatalf("Prepare with present CLI: %v", err)
	}
	var logs, dones int
	err := a.Run(context.Background(), t.TempDir(), "tidy the readme", func(e Event) {
		if e.Type == EventLog {
			logs++
		}
		if e.Type == EventDone {
			dones++
		}
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if logs == 0 || dones != 1 {
		t.Fatalf("expected log events + 1 done, got logs=%d dones=%d", logs, dones)
	}
}

// TestClaudeCodeAdapterInjectsBuiltinSkills verifies the embedded built-in skill
// set is present in repoDir/.claude/skills/ DURING the agent exec and removed
// AFTER Run returns (so the committed tree stays clean), layered on quarantine.
func TestClaudeCodeAdapterInjectsBuiltinSkills(t *testing.T) {
	dir := t.TempDir()
	skillPath := filepath.Join(dir, ".claude", "skills", "code-review", "SKILL.md")

	var presentDuringExec bool
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, d, intent, model, provider, mcpConfig string, onLine func(string)) error {
			_, statErr := os.Stat(skillPath)
			presentDuringExec = statErr == nil
			onLine("ran")
			return nil
		},
	}

	if err := a.Run(context.Background(), dir, "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !presentDuringExec {
		t.Fatal("built-in skill must be present during the agent exec")
	}
	if _, err := os.Stat(skillPath); !os.IsNotExist(err) {
		t.Fatalf("built-in skill must be gone after Run: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".claude")); !os.IsNotExist(err) {
		t.Fatalf(".claude must be pruned after Run: %v", err)
	}
}

// TestClaudeCodeAdapterApplyFeedback verifies ApplyFeedback runs the real agent
// with the feedback notes as the prompt (not a no-op): the injected exec is
// CALLED with the notes, and during the call the repo's CLAUDE.md is quarantined
// and a built-in skill is present; after return the tree is clean (#66).
func TestClaudeCodeAdapterApplyFeedback(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil instructions"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}
	skillPath := filepath.Join(dir, ".claude", "skills", "code-review", "SKILL.md")

	var gotPrompt string
	var skillPresentDuringExec, claudeMdAbsentDuringExec bool
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, d, prompt, model, provider, mcpConfig string, onLine func(string)) error {
			gotPrompt = prompt
			_, skillErr := os.Stat(skillPath)
			skillPresentDuringExec = skillErr == nil
			_, mdErr := os.Stat(filepath.Join(d, "CLAUDE.md"))
			claudeMdAbsentDuringExec = os.IsNotExist(mdErr)
			onLine("addressed feedback")
			return nil
		},
	}
	// repoDir is captured from Prepare, mirroring Run's wiring.
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: dir}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}

	var logs, dones int
	err := a.ApplyFeedback(context.Background(), "fix the failing test", func(e Event) {
		if e.Type == EventLog {
			logs++
		}
		if e.Type == EventDone {
			dones++
		}
	})
	if err != nil {
		t.Fatalf("ApplyFeedback: %v", err)
	}
	if gotPrompt != "fix the failing test" {
		t.Fatalf("exec must be called with notes as prompt, got %q", gotPrompt)
	}
	if !skillPresentDuringExec {
		t.Fatal("built-in skill must be present during the feedback exec")
	}
	if !claudeMdAbsentDuringExec {
		t.Fatal("CLAUDE.md must be quarantined during the feedback exec")
	}
	if logs == 0 || dones != 1 {
		t.Fatalf("expected log events + 1 done, got logs=%d dones=%d", logs, dones)
	}
	// Tree clean after return.
	if _, err := os.Stat(skillPath); !os.IsNotExist(err) {
		t.Fatalf("built-in skill must be gone after ApplyFeedback: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".claude")); !os.IsNotExist(err) {
		t.Fatalf(".claude must be pruned after ApplyFeedback: %v", err)
	}
	got, err := os.ReadFile(claudeMd)
	if err != nil {
		t.Fatalf("CLAUDE.md not restored after ApplyFeedback: %v", err)
	}
	if string(got) != "evil instructions" {
		t.Fatalf("CLAUDE.md content changed after restore: %q", got)
	}
}

// TestClaudeCodeAdapterApplyFeedbackOversize verifies oversize notes are rejected
// before the agent is ever exec'd (prompt-bound guard reused from Run).
func TestClaudeCodeAdapterApplyFeedbackOversize(t *testing.T) {
	called := false
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, dir, prompt, model, provider, mcpConfig string, onLine func(string)) error {
			called = true
			return nil
		},
	}
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir()}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	err := a.ApplyFeedback(context.Background(), strings.Repeat("x", 20000), func(Event) {})
	if err == nil {
		t.Fatal("expected error for oversize notes")
	}
	if called {
		t.Fatal("exec must NOT be called when notes exceed max prompt size")
	}
}

// TestClaudeCodeAdapterModelProvider verifies that a model/provider captured in
// Prepare is threaded into the exec seam, and that no model => empty (no --model).
func TestClaudeCodeAdapterModelProvider(t *testing.T) {
	var gotModel, gotProvider string
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, onLine func(string)) error {
			gotModel, gotProvider = model, provider
			onLine("ran")
			return nil
		},
	}
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir(), Model: "claude-opus-4-8", Provider: "bedrock"}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := a.Run(context.Background(), t.TempDir(), "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if gotModel != "claude-opus-4-8" {
		t.Fatalf("model not threaded to exec: got %q", gotModel)
	}
	if gotProvider != "bedrock" {
		t.Fatalf("provider not threaded to exec: got %q", gotProvider)
	}

	// No model configured => exec sees empty model (default: no --model flag).
	b := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, onLine func(string)) error {
			gotModel = model
			return nil
		},
	}
	if err := b.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir()}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := b.Run(context.Background(), t.TempDir(), "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if gotModel != "" {
		t.Fatalf("expected empty model with no config, got %q", gotModel)
	}
}

// TestClaudeCodeAdapterProvisionsMcpConfig verifies that with an authorized MCP
// server captured in Prepare, the run writes .mcp.json (present DURING exec),
// the exec seam receives the config path so claudeArgs includes --mcp-config,
// and the file is removed AFTER Run (clean committed tree).
func TestClaudeCodeAdapterProvisionsMcpConfig(t *testing.T) {
	dir := t.TempDir()
	mcpPath := filepath.Join(dir, ".mcp.json")

	var presentDuringExec bool
	var gotMcpConfig string
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, d, intent, model, provider, mcpConfig string, onLine func(string)) error {
			_, statErr := os.Stat(mcpPath)
			presentDuringExec = statErr == nil
			gotMcpConfig = mcpConfig
			onLine("ran")
			return nil
		},
	}
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: dir, McpServers: []string{"filesystem"}}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := a.Run(context.Background(), dir, "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !presentDuringExec {
		t.Fatal(".mcp.json must be present during the agent exec")
	}
	if gotMcpConfig != mcpPath {
		t.Fatalf("exec must receive the .mcp.json path, got %q", gotMcpConfig)
	}
	// The argv built from this config must carry --mcp-config.
	args := claudeArgs("do work", "", "acceptEdits", gotMcpConfig)
	var hasFlag bool
	for i, arg := range args {
		if arg == "--mcp-config" && i+1 < len(args) && args[i+1] == mcpPath {
			hasFlag = true
		}
	}
	if !hasFlag {
		t.Fatalf("expected --mcp-config %s in argv, got %v", mcpPath, args)
	}
	if _, err := os.Stat(mcpPath); !os.IsNotExist(err) {
		t.Fatalf(".mcp.json must be gone after Run: %v", err)
	}
}

// TestClaudeCodeAdapterNoMcpConfigByDefault verifies that with no MCP servers,
// no .mcp.json is written and the exec seam sees an empty config (no
// --mcp-config) — unchanged default behavior.
func TestClaudeCodeAdapterNoMcpConfigByDefault(t *testing.T) {
	dir := t.TempDir()
	var gotMcpConfig string
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, d, intent, model, provider, mcpConfig string, onLine func(string)) error {
			gotMcpConfig = mcpConfig
			return nil
		},
	}
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: dir}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := a.Run(context.Background(), dir, "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if gotMcpConfig != "" {
		t.Fatalf("expected empty mcpConfig with no servers, got %q", gotMcpConfig)
	}
	if _, err := os.Stat(filepath.Join(dir, ".mcp.json")); !os.IsNotExist(err) {
		t.Fatal(".mcp.json must NOT be written when no servers configured")
	}
	if args := claudeArgs("do work", "", "acceptEdits", ""); contains(args, "--mcp-config") {
		t.Fatalf("expected NO --mcp-config flag with empty config, got %v", args)
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// TestClaudeArgs verifies the CLI argv: --model appended only when set; provider
// env mapped for bedrock/vertex and empty otherwise.
func TestClaudeArgs(t *testing.T) {
	withModel := claudeArgs("fix it", "claude-opus-4-8", "acceptEdits", "")
	var hasModelFlag bool
	for i, arg := range withModel {
		if arg == "--model" && i+1 < len(withModel) && withModel[i+1] == "claude-opus-4-8" {
			hasModelFlag = true
		}
	}
	if !hasModelFlag {
		t.Fatalf("expected --model claude-opus-4-8 in argv, got %v", withModel)
	}
	noModel := claudeArgs("fix it", "", "acceptEdits", "")
	for _, arg := range noModel {
		if arg == "--model" {
			t.Fatalf("expected NO --model flag with empty model, got %v", noModel)
		}
	}
	if env := providerEnv("bedrock"); len(env) != 1 || env[0] != "CLAUDE_CODE_USE_BEDROCK=1" {
		t.Fatalf("bedrock provider env wrong: %v", env)
	}
	if env := providerEnv("vertex"); len(env) != 1 || env[0] != "CLAUDE_CODE_USE_VERTEX=1" {
		t.Fatalf("vertex provider env wrong: %v", env)
	}
	if env := providerEnv(""); env != nil {
		t.Fatalf("default provider must add no env, got %v", env)
	}
	if env := providerEnv("openai"); env != nil {
		t.Fatalf("unknown provider must add no env, got %v", env)
	}
}

func TestClaudeCodeAdapterMissingCLI(t *testing.T) {
	a := &ClaudeCodeAdapter{lookPath: func(string) (string, error) { return "", errors.New("nope") }}
	if err := a.Prepare(context.Background(), PrepareContext{}); err == nil {
		t.Fatal("expected error when claude CLI absent")
	}
}

// TestClaudeCodeAdapterOversizeIntent verifies an oversize intent is rejected
// before the agent is ever exec'd (prompt-bound guard, #49).
func TestClaudeCodeAdapterOversizeIntent(t *testing.T) {
	called := false
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, onLine func(string)) error {
			called = true
			return nil
		},
	}
	err := a.Run(context.Background(), t.TempDir(), strings.Repeat("x", 20000), func(Event) {})
	if err == nil {
		t.Fatal("expected error for oversize intent")
	}
	if called {
		t.Fatal("exec must NOT be called when intent exceeds max prompt size")
	}
}

// TestClaudeCodeAdapterPlan verifies Plan captures planExec output, rejects an
// oversize intent before exec, and quarantines repo-resident agent instructions.
func TestClaudeCodeAdapterPlan(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil instructions"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}
	var absentDuringPlan bool
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		planExec: func(ctx context.Context, d, intent, model, provider, mcpConfig string) (string, error) {
			_, statErr := os.Stat(filepath.Join(d, "CLAUDE.md"))
			absentDuringPlan = os.IsNotExist(statErr)
			return "PLAN: " + intent, nil
		},
	}
	text, err := a.Plan(context.Background(), dir, "tidy the readme")
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	if text != "PLAN: tidy the readme" {
		t.Fatalf("unexpected plan text: %q", text)
	}
	if !absentDuringPlan {
		t.Fatal("CLAUDE.md must be absent during the plan exec")
	}
	if _, err := os.ReadFile(claudeMd); err != nil {
		t.Fatalf("CLAUDE.md not restored after Plan: %v", err)
	}
}

func TestClaudeCodeAdapterPlanOversizeIntent(t *testing.T) {
	called := false
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		planExec: func(ctx context.Context, d, intent, model, provider, mcpConfig string) (string, error) {
			called = true
			return "", nil
		},
	}
	if _, err := a.Plan(context.Background(), t.TempDir(), strings.Repeat("x", 20000)); err == nil {
		t.Fatal("expected error for oversize intent")
	}
	if called {
		t.Fatal("planExec must NOT be called when intent exceeds max prompt size")
	}
}

// TestClaudeCodeAdapterQuarantinesRepoConfig verifies repo-resident agent
// instructions are absent DURING the run and restored AFTER it (#49).
func TestClaudeCodeAdapterQuarantinesRepoConfig(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil instructions"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}

	var absentDuringExec bool
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, d, intent, model, provider, mcpConfig string, onLine func(string)) error {
			_, statErr := os.Stat(filepath.Join(d, "CLAUDE.md"))
			absentDuringExec = os.IsNotExist(statErr)
			onLine("ran")
			return nil
		},
	}

	if err := a.Run(context.Background(), dir, "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !absentDuringExec {
		t.Fatal("CLAUDE.md must be absent during the agent exec")
	}

	got, err := os.ReadFile(claudeMd)
	if err != nil {
		t.Fatalf("CLAUDE.md not restored after Run: %v", err)
	}
	if string(got) != "evil instructions" {
		t.Fatalf("CLAUDE.md content changed after restore: %q", got)
	}
}
