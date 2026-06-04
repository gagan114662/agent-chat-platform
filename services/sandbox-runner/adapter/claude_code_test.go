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
		exec: func(ctx context.Context, dir, intent string, onLine func(string)) error {
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
		exec: func(ctx context.Context, d, intent string, onLine func(string)) error {
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
		exec: func(ctx context.Context, d, prompt string, onLine func(string)) error {
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
		exec: func(ctx context.Context, dir, prompt string, onLine func(string)) error {
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
		exec: func(ctx context.Context, dir, intent string, onLine func(string)) error {
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
		planExec: func(ctx context.Context, d, intent string) (string, error) {
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
		planExec: func(ctx context.Context, d, intent string) (string, error) {
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
		exec: func(ctx context.Context, d, intent string, onLine func(string)) error {
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
