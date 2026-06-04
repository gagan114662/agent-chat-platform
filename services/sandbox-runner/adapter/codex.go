package adapter

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// CodexAdapter runs the `codex` CLI in the repo dir, streaming its output as
// typed log events. It is the second first-party adapter (#63) and reuses the
// SAME hardening as ClaudeCodeAdapter — repo-config quarantine (#49), built-in
// skills (#48), env-scrub, prompt bound, and model/provider (#58) — via the
// shared package-level helpers (runAgentShared/planShared). Only the CLI argv
// (the exec seam) differs. exec/lookPath are injectable for tests, so the suite
// needs no real `codex` binary.
type CodexAdapter struct {
	lookPath func(string) (string, error)
	exec     func(ctx context.Context, dir, intent, model, provider string, onLine func(string)) error
	planExec func(ctx context.Context, dir, intent, model, provider string) (string, error)
	repoDir  string // captured from Prepare so ApplyFeedback (no dir param) knows where to run
	model    string // captured from Prepare; "" = the CLI default (no --model flag)
	provider string // captured from Prepare; "" = default provider (no provider env)
}

func NewCodexAdapter() *CodexAdapter {
	return &CodexAdapter{lookPath: exec.LookPath, exec: runCodexCLI, planExec: runCodexPlanCLI}
}

func (*CodexAdapter) Identify() Identity {
	return Identity{Name: "codex", Version: "cli", Capabilities: []Capability{CanEditCode, CanRunTests}}
}

func (a *CodexAdapter) Prepare(_ context.Context, p PrepareContext) error {
	if _, err := a.lookPath("codex"); err != nil {
		return fmt.Errorf("codex CLI not found on PATH: %w", err)
	}
	a.repoDir = p.RepoDir // ApplyFeedback has no dir param; capture it here like claude-code
	a.model = p.Model     // optional --model selection (validated upstream in Validate())
	a.provider = p.Provider
	return nil
}

func (a *CodexAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	return runAgentShared(ctx, a.exec, a.model, a.provider, repoDir, intent, "codex: starting", "codex: finished", "codex run failed", emit)
}

// Plan runs codex in read-only plan mode in repoDir and returns the captured
// output. Reuses the shared hardening (prompt-bound, quarantine, built-in
// skills, env-scrub) via planShared.
func (a *CodexAdapter) Plan(ctx context.Context, repoDir, intent string) (string, error) {
	return planShared(ctx, a.planExec, a.model, a.provider, repoDir, intent, "codex plan failed")
}

// ApplyFeedback runs codex with the feedback notes as the prompt against the
// repo dir captured in Prepare — essentially Run with notes — reusing the same
// hardening via runAgentShared.
func (a *CodexAdapter) ApplyFeedback(ctx context.Context, notes string, emit Emit) error {
	return runAgentShared(ctx, a.exec, a.model, a.provider, a.repoDir, notes, "codex: applying feedback", "feedback applied", "codex feedback failed", emit)
}

func (*CodexAdapter) Teardown(context.Context) error { return nil }

// codexArgs builds the codex CLI argv for a prompt, appending --model when a
// (validated) model is selected. `codex exec <prompt>` is codex's
// non-interactive subcommand. extra holds mode-specific flags (e.g. plan).
func codexArgs(intent, model string, extra ...string) []string {
	args := []string{"exec", intent}
	if model != "" {
		args = append(args, "--model", model)
	}
	args = append(args, extra...)
	return args
}

// runCodexCLI invokes `codex exec <intent>` in dir, streaming combined
// stdout+stderr line-by-line to onLine. When model is set it appends
// `--model <model>`; provider selects the backend via provider env. The child
// env is scrubbed via filterChildEnv (same as claude-code).
func runCodexCLI(ctx context.Context, dir, intent, model, provider string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, "codex", codexArgs(intent, model)...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = append(filterChildEnv(os.Environ()), providerEnv(provider)...)
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			onLine(sc.Text())
		}
		close(done)
	}()
	runErr := cmd.Wait()
	_ = pw.Close()
	<-done
	return runErr
}

// runCodexPlanCLI invokes codex in read-only plan mode in dir, capturing the
// full combined stdout+stderr as the returned plan string.
func runCodexPlanCLI(ctx context.Context, dir, intent, model, provider string) (string, error) {
	cmd := exec.CommandContext(ctx, "codex", codexArgs(intent, model, "--plan")...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = append(filterChildEnv(os.Environ()), providerEnv(provider)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
