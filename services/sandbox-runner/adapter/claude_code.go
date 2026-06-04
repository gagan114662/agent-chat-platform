package adapter

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
)

// maxPromptBytesDefault bounds the agent prompt (intent/notes) to limit prompt
// stuffing. Overridable via ACP_MAX_PROMPT_BYTES.
const maxPromptBytesDefault = 16 * 1024

// maxPromptBytes returns the configured prompt byte limit (env override, else
// the default).
func maxPromptBytes() int {
	if v := os.Getenv("ACP_MAX_PROMPT_BYTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return maxPromptBytesDefault
}

// ClaudeCodeAdapter runs the `claude` CLI (subscription auth) in the repo dir,
// streaming its output as typed log events. exec/lookPath are injectable for tests.
type ClaudeCodeAdapter struct {
	lookPath func(string) (string, error)
	exec     func(ctx context.Context, dir, intent string, onLine func(string)) error
	planExec func(ctx context.Context, dir, intent string) (string, error)
	repoDir  string // captured from Prepare so ApplyFeedback (no dir param) knows where to run
}

func NewClaudeCodeAdapter() *ClaudeCodeAdapter {
	return &ClaudeCodeAdapter{lookPath: exec.LookPath, exec: runClaudeCLI, planExec: runClaudePlanCLI}
}

func (*ClaudeCodeAdapter) Identify() Identity {
	return Identity{Name: "claude-code", Version: "cli", Capabilities: []Capability{CanEditCode, CanRunTests}}
}

func (a *ClaudeCodeAdapter) Prepare(_ context.Context, p PrepareContext) error {
	if _, err := a.lookPath("claude"); err != nil {
		return fmt.Errorf("claude CLI not found on PATH: %w", err)
	}
	a.repoDir = p.RepoDir // ApplyFeedback has no dir param; capture it here like FakeAdapter
	return nil
}

func (a *ClaudeCodeAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	return a.runAgent(ctx, repoDir, intent, "claude-code: starting", "claude-code: finished", "claude-code run failed", emit)
}

// runAgent is the shared body for Run and ApplyFeedback: it bounds the prompt,
// quarantines repo-resident agent instructions, provisions the built-in skills,
// runs the agent (a.exec) streaming each line as an EventLog, and emits
// start/done events. Both callers reuse the same Plan-24/29 hardening (DRY).
func (a *ClaudeCodeAdapter) runAgent(ctx context.Context, repoDir, prompt, startMsg, doneMsg, failMsg string, emit Emit) error {
	if len(prompt) > maxPromptBytes() {
		return fmt.Errorf("prompt exceeds max prompt size")
	}
	emit(Event{Type: EventLog, Message: startMsg})
	emit(Event{Type: EventProgress, Step: "agent", Pct: 10})
	if restore, err := quarantineRepoConfig(repoDir); err == nil {
		defer restore()
	}
	if cleanup, err := provisionBuiltinSkills(repoDir); err == nil {
		defer cleanup()
	}
	if err := a.exec(ctx, repoDir, prompt, func(line string) {
		emit(Event{Type: EventLog, Message: line})
	}); err != nil {
		return fmt.Errorf("%s: %w", failMsg, err)
	}
	emit(Event{Type: EventDone, Message: doneMsg})
	return nil
}

// Plan runs `claude -p <intent> --permission-mode plan` (read-only) in repoDir
// and returns the captured stdout. Reuses the Plan-24 hardening: prompt-bound,
// quarantine of repo-resident agent instructions, and filterChildEnv.
func (a *ClaudeCodeAdapter) Plan(ctx context.Context, repoDir, intent string) (string, error) {
	if len(intent) > maxPromptBytes() {
		return "", fmt.Errorf("intent exceeds max prompt size")
	}
	if restore, err := quarantineRepoConfig(repoDir); err == nil {
		defer restore()
	}
	if cleanup, err := provisionBuiltinSkills(repoDir); err == nil {
		defer cleanup()
	}
	text, err := a.planExec(ctx, repoDir, intent)
	if err != nil {
		return "", fmt.Errorf("claude-code plan failed: %w", err)
	}
	return text, nil
}

// ApplyFeedback runs the real agent with the feedback notes as the prompt
// against the repo dir captured in Prepare — essentially Run with notes —
// reusing the same hardening (prompt bound, quarantine, built-in skills,
// env-scrub) via runAgent. No longer a no-op (#66).
func (a *ClaudeCodeAdapter) ApplyFeedback(ctx context.Context, notes string, emit Emit) error {
	return a.runAgent(ctx, a.repoDir, notes, "claude-code: applying feedback", "feedback applied", "claude-code feedback failed", emit)
}

func (*ClaudeCodeAdapter) Teardown(context.Context) error { return nil }

// runClaudeCLI invokes `claude -p <intent> --permission-mode acceptEdits` in dir,
// streaming combined stdout+stderr line-by-line to onLine.
func runClaudeCLI(ctx context.Context, dir, intent string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, "claude", "-p", intent, "--permission-mode", "acceptEdits")
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = filterChildEnv(os.Environ())
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

// runClaudePlanCLI invokes `claude -p <intent> --permission-mode plan` in dir,
// capturing the full combined stdout+stderr as the returned plan string.
// Read-only: --permission-mode plan instructs the agent not to edit files.
func runClaudePlanCLI(ctx context.Context, dir, intent string) (string, error) {
	cmd := exec.CommandContext(ctx, "claude", "-p", intent, "--permission-mode", "plan")
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = filterChildEnv(os.Environ())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
