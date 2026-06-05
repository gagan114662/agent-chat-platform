package adapter

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodexAdapter(t *testing.T) {
	a := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
			onLine("edited README.md")
			return nil
		},
	}
	id := a.Identify()
	if id.Name != "codex" || !id.Has(CanEditCode) {
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

// TestCodexAdapterInjectsBuiltinSkills verifies the embedded built-in skill set
// is present in repoDir/.claude/skills/ DURING the agent exec and removed AFTER
// Run returns (same shared hardening as claude-code, #48), layered on quarantine.
func TestCodexAdapterInjectsBuiltinSkills(t *testing.T) {
	dir := t.TempDir()
	skillPath := filepath.Join(dir, ".claude", "skills", "code-review", "SKILL.md")

	var presentDuringExec bool
	a := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		exec: func(ctx context.Context, d, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
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

// TestCodexAdapterQuarantinesRepoConfig verifies repo-resident agent
// instructions are absent DURING the run and restored AFTER it (#49).
func TestCodexAdapterQuarantinesRepoConfig(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil instructions"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}

	var absentDuringExec bool
	a := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		exec: func(ctx context.Context, d, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
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

// TestCodexAdapterOversizeIntent verifies an oversize intent is rejected before
// the agent is ever exec'd (prompt-bound guard reused from the shared helper).
func TestCodexAdapterOversizeIntent(t *testing.T) {
	called := false
	a := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
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

// TestCodexAdapterModelProvider verifies a model/provider captured in Prepare is
// threaded into the exec seam, and that no model => empty (no --model).
func TestCodexAdapterModelProvider(t *testing.T) {
	var gotModel, gotProvider string
	a := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
			gotModel, gotProvider = model, provider
			onLine("ran")
			return nil
		},
	}
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir(), Model: "gpt-5-codex", Provider: "bedrock"}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := a.Run(context.Background(), t.TempDir(), "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if gotModel != "gpt-5-codex" {
		t.Fatalf("model not threaded to exec: got %q", gotModel)
	}
	if gotProvider != "bedrock" {
		t.Fatalf("provider not threaded to exec: got %q", gotProvider)
	}

	// No model configured => exec sees empty model (default: no --model flag).
	b := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		exec: func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
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

// TestCodexArgs verifies the CLI argv: `codex exec <prompt>` with --model
// appended only when set.
func TestCodexArgs(t *testing.T) {
	withModel := codexArgs("fix it", "gpt-5-codex")
	if len(withModel) < 2 || withModel[0] != "exec" || withModel[1] != "fix it" {
		t.Fatalf("expected `codex exec <prompt>` argv, got %v", withModel)
	}
	var hasModelFlag bool
	for i, arg := range withModel {
		if arg == "--model" && i+1 < len(withModel) && withModel[i+1] == "gpt-5-codex" {
			hasModelFlag = true
		}
	}
	if !hasModelFlag {
		t.Fatalf("expected --model gpt-5-codex in argv, got %v", withModel)
	}
	noModel := codexArgs("fix it", "")
	for _, arg := range noModel {
		if arg == "--model" {
			t.Fatalf("expected NO --model flag with empty model, got %v", noModel)
		}
	}
}

func TestCodexAdapterMissingCLI(t *testing.T) {
	a := &CodexAdapter{lookPath: func(string) (string, error) { return "", errors.New("nope") }}
	if err := a.Prepare(context.Background(), PrepareContext{}); err == nil {
		t.Fatal("expected error when codex CLI absent")
	}
}

// TestCodexAdapterPlan verifies Plan captures planExec output, rejects an
// oversize intent before exec, and quarantines repo-resident agent instructions.
func TestCodexAdapterPlan(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil instructions"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}
	var absentDuringPlan bool
	a := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		planExec: func(ctx context.Context, d, intent, model, provider, mcpConfig string, env map[string]string) (string, error) {
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

// TestCodexAdapterApplyFeedback verifies ApplyFeedback runs the real agent with
// the feedback notes as the prompt against the Prepare-captured repoDir, with
// quarantine + built-in skills active during exec and a clean tree after.
func TestCodexAdapterApplyFeedback(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil instructions"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}
	skillPath := filepath.Join(dir, ".claude", "skills", "code-review", "SKILL.md")

	var gotPrompt string
	var skillPresentDuringExec, claudeMdAbsentDuringExec bool
	a := &CodexAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/codex", nil },
		exec: func(ctx context.Context, d, prompt, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
			gotPrompt = prompt
			_, skillErr := os.Stat(skillPath)
			skillPresentDuringExec = skillErr == nil
			_, mdErr := os.Stat(filepath.Join(d, "CLAUDE.md"))
			claudeMdAbsentDuringExec = os.IsNotExist(mdErr)
			onLine("addressed feedback")
			return nil
		},
	}
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

// TestCodexRegisteredInDefaultRegistry verifies the codex factory is registered
// and builds an adapter whose Identify().Name == "codex".
func TestCodexRegisteredInDefaultRegistry(t *testing.T) {
	r := DefaultRegistry()
	f, ok := r.Get("codex")
	if !ok {
		t.Fatal("expected \"codex\" registered in DefaultRegistry")
	}
	if name := f().Identify().Name; name != "codex" {
		t.Fatalf("factory for codex built wrong adapter: %q", name)
	}
}
