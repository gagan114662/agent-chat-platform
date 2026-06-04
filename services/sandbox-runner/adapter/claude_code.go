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
	exec     func(ctx context.Context, dir, intent, model, provider string, onLine func(string)) error
	planExec func(ctx context.Context, dir, intent, model, provider string) (string, error)
	repoDir  string // captured from Prepare so ApplyFeedback (no dir param) knows where to run
	model    string // captured from Prepare; "" = the CLI default (no --model flag)
	provider string // captured from Prepare; "" = default Anthropic (no provider env)
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
	a.model = p.Model     // optional --model selection (validated upstream in Validate())
	a.provider = p.Provider
	return nil
}

func (a *ClaudeCodeAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	return a.runAgent(ctx, repoDir, intent, "claude-code: starting", "claude-code: finished", "claude-code run failed", emit)
}

// runAgent delegates to the package-level runAgentShared using this adapter's
// injected exec seam and captured model/provider. Kept as a thin method so
// existing claude tests and ApplyFeedback keep their call shape.
func (a *ClaudeCodeAdapter) runAgent(ctx context.Context, repoDir, prompt, startMsg, doneMsg, failMsg string, emit Emit) error {
	return runAgentShared(ctx, a.exec, a.model, a.provider, repoDir, prompt, startMsg, doneMsg, failMsg, emit)
}

// Plan runs `claude -p <intent> --permission-mode plan` (read-only) in repoDir
// and returns the captured stdout. Reuses the Plan-24 hardening via the shared
// planShared helper: prompt-bound, quarantine, built-in skills, filterChildEnv.
func (a *ClaudeCodeAdapter) Plan(ctx context.Context, repoDir, intent string) (string, error) {
	return planShared(ctx, a.planExec, a.model, a.provider, repoDir, intent, "claude-code plan failed")
}

// execFunc is the injectable agent-exec seam shared by every first-party
// adapter (claude-code, codex): run the CLI in dir with the given prompt and
// stream each output line to onLine.
type execFunc func(ctx context.Context, dir, prompt, model, provider string, onLine func(string)) error

// planExecFunc is the injectable read-only plan seam shared by adapters: run
// the CLI's plan mode in dir and return the captured plan text.
type planExecFunc func(ctx context.Context, dir, intent, model, provider string) (string, error)

// runAgentShared is the package-level shared body for Run and ApplyFeedback
// across adapters: it bounds the prompt, quarantines repo-resident agent
// instructions (#49), provisions the built-in skills (#48), runs the agent via
// the injected exec seam (env-scrubbed inside the seam) streaming each line as
// an EventLog, and emits start/done events. Both first-party adapters reuse this
// single hardening path (DRY); only the exec seam (CLI argv) differs.
func runAgentShared(ctx context.Context, exec execFunc, model, provider, repoDir, prompt, startMsg, doneMsg, failMsg string, emit Emit) error {
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
	if err := exec(ctx, repoDir, prompt, model, provider, func(line string) {
		emit(Event{Type: EventLog, Message: line})
	}); err != nil {
		return fmt.Errorf("%s: %w", failMsg, err)
	}
	emit(Event{Type: EventDone, Message: doneMsg})
	return nil
}

// planShared is the package-level shared body for Plan across adapters: it
// bounds the intent, quarantines repo-resident agent instructions, provisions
// built-in skills, and runs the injected read-only planExec seam, returning the
// captured plan text. failMsg names the adapter for error wrapping.
func planShared(ctx context.Context, planExec planExecFunc, model, provider, repoDir, intent, failMsg string) (string, error) {
	if len(intent) > maxPromptBytes() {
		return "", fmt.Errorf("intent exceeds max prompt size")
	}
	if restore, err := quarantineRepoConfig(repoDir); err == nil {
		defer restore()
	}
	if cleanup, err := provisionBuiltinSkills(repoDir); err == nil {
		defer cleanup()
	}
	text, err := planExec(ctx, repoDir, intent, model, provider)
	if err != nil {
		return "", fmt.Errorf("%s: %w", failMsg, err)
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

// claudeArgs builds the claude CLI argv for a prompt, appending --model when a
// (validated) model is selected. mode is the --permission-mode value.
func claudeArgs(intent, model, mode string) []string {
	args := []string{"-p", intent, "--permission-mode", mode}
	if model != "" {
		args = append(args, "--model", model)
	}
	return args
}

// providerEnv maps a (validated) provider selection to the child env that the
// claude CLI reads to switch backends. Default ("" / Anthropic) and unknown
// providers add nothing. Credentials themselves stay deployment env.
func providerEnv(provider string) []string {
	switch provider {
	case "bedrock":
		return []string{"CLAUDE_CODE_USE_BEDROCK=1"}
	case "vertex":
		return []string{"CLAUDE_CODE_USE_VERTEX=1"}
	default:
		return nil
	}
}

// runClaudeCLI invokes `claude -p <intent> --permission-mode acceptEdits` in dir,
// streaming combined stdout+stderr line-by-line to onLine. When model is set it
// appends `--model <model>`; provider selects the backend via provider env.
func runClaudeCLI(ctx context.Context, dir, intent, model, provider string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, "claude", claudeArgs(intent, model, "acceptEdits")...)
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

// runClaudePlanCLI invokes `claude -p <intent> --permission-mode plan` in dir,
// capturing the full combined stdout+stderr as the returned plan string.
// Read-only: --permission-mode plan instructs the agent not to edit files.
func runClaudePlanCLI(ctx context.Context, dir, intent, model, provider string) (string, error) {
	cmd := exec.CommandContext(ctx, "claude", claudeArgs(intent, model, "plan")...)
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
