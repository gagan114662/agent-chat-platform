package adapter

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newTestCursorAdapter builds a CLIAdapter wired like the registered "cursor"
// adapter but with an injected exec so the suite needs no real CLI binary.
func newTestCursorAdapter(exec func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error) *CLIAdapter {
	a := newCLIAdapter("cursor", "cursor-agent", cursorArgs)
	a.lookPath = func(string) (string, error) { return "/usr/bin/cursor-agent", nil }
	a.exec = exec
	return a
}

// TestCLIAdapterIdentity verifies the generic factory names the adapter and
// declares the shared capabilities.
func TestCLIAdapterIdentity(t *testing.T) {
	a := newTestCursorAdapter(nil)
	id := a.Identify()
	if id.Name != "cursor" || !id.Has(CanEditCode) || !id.Has(CanRunTests) {
		t.Fatalf("bad identity: %+v", id)
	}
}

// TestCLIAdapterRunQuarantinesAndInjectsSkills verifies the generic adapter
// reuses the SAME shared hardening as claude/codex: repo config is quarantined
// (#49) and the built-in skills are injected (#48) DURING exec, both gone after.
func TestCLIAdapterRunQuarantinesAndInjectsSkills(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil instructions"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}
	skillPath := filepath.Join(dir, ".claude", "skills", "code-review", "SKILL.md")

	var skillPresent, claudeMdAbsent bool
	a := newTestCursorAdapter(func(ctx context.Context, d, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
		_, skillErr := os.Stat(skillPath)
		skillPresent = skillErr == nil
		_, mdErr := os.Stat(filepath.Join(d, "CLAUDE.md"))
		claudeMdAbsent = os.IsNotExist(mdErr)
		onLine("edited README.md")
		return nil
	})

	var logs, dones int
	err := a.Run(context.Background(), dir, "tidy the readme", func(e Event) {
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
	if !skillPresent {
		t.Fatal("built-in skill must be present during the agent exec")
	}
	if !claudeMdAbsent {
		t.Fatal("CLAUDE.md must be quarantined during the agent exec")
	}
	if logs == 0 || dones != 1 {
		t.Fatalf("expected log events + 1 done, got logs=%d dones=%d", logs, dones)
	}
	if _, err := os.Stat(filepath.Join(dir, ".claude")); !os.IsNotExist(err) {
		t.Fatalf(".claude must be pruned after Run: %v", err)
	}
	got, err := os.ReadFile(claudeMd)
	if err != nil {
		t.Fatalf("CLAUDE.md not restored after Run: %v", err)
	}
	if string(got) != "evil instructions" {
		t.Fatalf("CLAUDE.md content changed after restore: %q", got)
	}
}

// TestCLIAdapterOversizeIntent verifies an oversize intent is rejected before
// exec (the shared prompt-bound guard).
func TestCLIAdapterOversizeIntent(t *testing.T) {
	called := false
	a := newTestCursorAdapter(func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
		called = true
		return nil
	})
	err := a.Run(context.Background(), t.TempDir(), strings.Repeat("x", 20000), func(Event) {})
	if err == nil {
		t.Fatal("expected error for oversize intent")
	}
	if called {
		t.Fatal("exec must NOT be called when intent exceeds max prompt size")
	}
}

// TestCLIAdapterModelThreaded verifies a model captured in Prepare is threaded
// into the exec seam, and no model => empty (no --model).
func TestCLIAdapterModelThreaded(t *testing.T) {
	var gotModel string
	a := newTestCursorAdapter(func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
		gotModel = model
		onLine("ran")
		return nil
	})
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir(), Model: "cursor-fast"}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := a.Run(context.Background(), t.TempDir(), "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if gotModel != "cursor-fast" {
		t.Fatalf("model not threaded to exec: got %q", gotModel)
	}

	var gotModel2 string
	b := newTestCursorAdapter(func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
		gotModel2 = model
		return nil
	})
	if err := b.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir()}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := b.Run(context.Background(), t.TempDir(), "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if gotModel2 != "" {
		t.Fatalf("expected empty model with no config, got %q", gotModel2)
	}
}

// TestCLIAdapterEnvThreaded verifies per-repo env vars (#73) captured in Prepare
// are threaded into the exec seam, and no env => nil/empty (unchanged behavior).
func TestCLIAdapterEnvThreaded(t *testing.T) {
	var gotEnv map[string]string
	a := newTestCursorAdapter(func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
		gotEnv = env
		onLine("ran")
		return nil
	})
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir(), Env: map[string]string{"FOO": "bar"}}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := a.Run(context.Background(), t.TempDir(), "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if gotEnv["FOO"] != "bar" {
		t.Fatalf("env not threaded to exec: got %v", gotEnv)
	}

	var gotEnv2 map[string]string
	b := newTestCursorAdapter(func(ctx context.Context, dir, intent, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
		gotEnv2 = env
		return nil
	})
	if err := b.Prepare(context.Background(), PrepareContext{RepoDir: t.TempDir()}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := b.Run(context.Background(), t.TempDir(), "do work", func(Event) {}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(gotEnv2) != 0 {
		t.Fatalf("expected empty env with no config, got %v", gotEnv2)
	}
}

// TestCLIAdapterMissingCLI verifies Prepare fails when the underlying binary is
// absent on PATH.
func TestCLIAdapterMissingCLI(t *testing.T) {
	a := newCLIAdapter("cursor", "cursor-agent", cursorArgs)
	a.lookPath = func(string) (string, error) { return "", errors.New("nope") }
	if err := a.Prepare(context.Background(), PrepareContext{}); err == nil {
		t.Fatal("expected error when cursor-agent CLI absent")
	}
}

// TestCLIAdapterArgs verifies buildArgs produces argv carrying the prompt and
// appends --model only when set.
func TestCLIAdapterArgs(t *testing.T) {
	withModel := cursorArgs("fix it", "cursor-fast")
	if !containsArg(withModel, "fix it") {
		t.Fatalf("expected prompt in argv, got %v", withModel)
	}
	var hasModelFlag bool
	for i, arg := range withModel {
		if arg == "--model" && i+1 < len(withModel) && withModel[i+1] == "cursor-fast" {
			hasModelFlag = true
		}
	}
	if !hasModelFlag {
		t.Fatalf("expected --model cursor-fast in argv, got %v", withModel)
	}
	noModel := cursorArgs("fix it", "")
	for _, arg := range noModel {
		if arg == "--model" {
			t.Fatalf("expected NO --model flag with empty model, got %v", noModel)
		}
	}
}

func containsArg(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

// TestCLIAdaptersRegistered verifies all four new CLI adapters resolve from the
// DefaultRegistry and build adapters whose Identify().Name matches.
func TestCLIAdaptersRegistered(t *testing.T) {
	r := DefaultRegistry()
	for _, name := range []string{"cursor", "devin", "openclaw", "hermes"} {
		f, ok := r.Get(name)
		if !ok {
			t.Fatalf("expected %q registered in DefaultRegistry", name)
		}
		if got := f().Identify().Name; got != name {
			t.Fatalf("factory for %q built wrong adapter: %q", name, got)
		}
	}
	// The first-party adapters stay registered alongside the new ones.
	for _, name := range []string{"fake", "claude-code", "codex"} {
		if _, ok := r.Get(name); !ok {
			t.Fatalf("expected existing %q to stay registered", name)
		}
	}
}

// TestCLIAdapterPlanAndFeedback verifies Plan captures planExec output and
// ApplyFeedback runs the agent with notes as the prompt — both via the shared
// hardening helpers (quarantine active during exec).
func TestCLIAdapterPlanAndFeedback(t *testing.T) {
	dir := t.TempDir()
	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}

	var absentDuringPlan bool
	a := newCLIAdapter("cursor", "cursor-agent", cursorArgs)
	a.lookPath = func(string) (string, error) { return "/usr/bin/cursor-agent", nil }
	a.planExec = func(ctx context.Context, d, intent, model, provider, mcpConfig string, env map[string]string) (string, error) {
		_, statErr := os.Stat(filepath.Join(d, "CLAUDE.md"))
		absentDuringPlan = os.IsNotExist(statErr)
		return "PLAN: " + intent, nil
	}
	text, err := a.Plan(context.Background(), dir, "tidy")
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	if text != "PLAN: tidy" {
		t.Fatalf("unexpected plan text: %q", text)
	}
	if !absentDuringPlan {
		t.Fatal("CLAUDE.md must be absent during plan exec")
	}

	var gotPrompt string
	b := newTestCursorAdapter(func(ctx context.Context, d, prompt, model, provider, mcpConfig string, env map[string]string, onLine func(string)) error {
		gotPrompt = prompt
		onLine("addressed feedback")
		return nil
	})
	if err := b.Prepare(context.Background(), PrepareContext{RepoDir: dir}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := b.ApplyFeedback(context.Background(), "fix the failing test", func(Event) {}); err != nil {
		t.Fatalf("ApplyFeedback: %v", err)
	}
	if gotPrompt != "fix the failing test" {
		t.Fatalf("ApplyFeedback must pass notes as prompt, got %q", gotPrompt)
	}
}
