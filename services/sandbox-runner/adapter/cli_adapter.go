package adapter

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// CLIAdapter is a generic first-party adapter that wraps any agent CLI which
// takes a prompt argument. It is the DRY factory behind the cursor/devin/
// openclaw/hermes adapters (#91): every instance reuses the SAME shared
// hardening as claude-code/codex — repo-config quarantine (#49), built-in
// skills (#48), env-scrub, prompt bound, and model/provider (#58) — via the
// package-level runAgentShared/planShared helpers. Instances differ ONLY in the
// Identify name, the underlying binary, and the buildArgs that turn a
// (prompt, model) into the CLI argv. exec/planExec/lookPath are injectable so
// the suite needs no real binary.
type CLIAdapter struct {
	name      string                              // Identify().Name
	binary    string                              // CLI binary looked up on PATH and exec'd
	buildArgs func(prompt, model string) []string // best-effort argv builder

	lookPath func(string) (string, error)
	exec     execFunc
	planExec planExecFunc

	repoDir    string   // captured from Prepare so ApplyFeedback (no dir param) knows where to run
	model      string   // captured from Prepare; "" = the CLI default (no --model flag)
	provider   string   // captured from Prepare; "" = default provider (no provider env)
	mcpServers []string // captured from Prepare; nil/empty = no .mcp.json
}

// newCLIAdapter builds a generic CLI adapter for the given name + binary +
// argv builder, wiring the default real exec/planExec seams (which run `binary`
// with buildArgs) and the real PATH lookup. Registered factories in default.go
// call this; tests override the seams after construction.
func newCLIAdapter(name, binary string, buildArgs func(prompt, model string) []string) *CLIAdapter {
	a := &CLIAdapter{name: name, binary: binary, buildArgs: buildArgs, lookPath: exec.LookPath}
	a.exec = a.runCLI
	a.planExec = a.runPlanCLI
	return a
}

func (a *CLIAdapter) Identify() Identity {
	return Identity{Name: a.name, Version: "cli", Capabilities: []Capability{CanEditCode, CanRunTests}}
}

func (a *CLIAdapter) Prepare(_ context.Context, p PrepareContext) error {
	if _, err := a.lookPath(a.binary); err != nil {
		return fmt.Errorf("%s CLI not found on PATH: %w", a.binary, err)
	}
	a.repoDir = p.RepoDir // ApplyFeedback has no dir param; capture it here like claude-code/codex
	a.model = p.Model     // optional --model selection (validated upstream in Validate())
	a.provider = p.Provider
	a.mcpServers = p.McpServers // optional MCP servers (authz applied at provisioning)
	return nil
}

func (a *CLIAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	return runAgentShared(ctx, a.exec, a.model, a.provider, a.mcpServers, repoDir, intent,
		a.name+": starting", a.name+": finished", a.name+" run failed", emit)
}

// Plan runs the CLI in read-only plan mode in repoDir and returns the captured
// output, reusing the shared hardening (prompt-bound, quarantine, built-in
// skills, env-scrub) via planShared.
func (a *CLIAdapter) Plan(ctx context.Context, repoDir, intent string) (string, error) {
	return planShared(ctx, a.planExec, a.model, a.provider, a.mcpServers, repoDir, intent, a.name+" plan failed")
}

// ApplyFeedback runs the CLI with the feedback notes as the prompt against the
// repo dir captured in Prepare — essentially Run with notes — reusing the same
// hardening via runAgentShared.
func (a *CLIAdapter) ApplyFeedback(ctx context.Context, notes string, emit Emit) error {
	return runAgentShared(ctx, a.exec, a.model, a.provider, a.mcpServers, a.repoDir, notes,
		a.name+": applying feedback", "feedback applied", a.name+" feedback failed", emit)
}

func (*CLIAdapter) Teardown(context.Context) error { return nil }

// runCLI invokes `<binary> <buildArgs(prompt, model)>` in dir, streaming
// combined stdout+stderr line-by-line to onLine. provider selects the backend
// via provider env; the child env is scrubbed via filterChildEnv (same as
// claude-code/codex). mcpConfig is part of the shared exec seam but unused here
// — these CLIs have no --mcp-config flag in the best-effort argv yet.
func (a *CLIAdapter) runCLI(ctx context.Context, dir, prompt, model, provider, mcpConfig string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, a.binary, a.buildArgs(prompt, model)...)
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

// runPlanCLI invokes the CLI in read-only plan mode in dir, capturing the full
// combined stdout+stderr as the returned plan string. mcpConfig is part of the
// shared plan seam but unused here.
func (a *CLIAdapter) runPlanCLI(ctx context.Context, dir, intent, model, provider, mcpConfig string) (string, error) {
	args := append(a.buildArgs(intent, model), "--plan")
	cmd := exec.CommandContext(ctx, a.binary, args...)
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

// cliArgs is the shared best-effort argv builder for a prompt-taking agent CLI:
// the prompt as the sole positional, plus --model when a (validated) model is
// selected. Real per-tool flags are refined when wiring a live tool; the
// injectable exec covers behavior in tests (same approach as codex).
func cliArgs(prompt, model string) []string {
	args := []string{prompt}
	if model != "" {
		args = append(args, "--model", model)
	}
	return args
}

// Per-adapter argv builders. They share cliArgs today (best-effort); keeping
// them named per adapter lets each diverge to real CLI flags independently
// without touching the others.
func cursorArgs(prompt, model string) []string   { return cliArgs(prompt, model) }
func devinArgs(prompt, model string) []string    { return cliArgs(prompt, model) }
func openclawArgs(prompt, model string) []string { return cliArgs(prompt, model) }
func hermesArgs(prompt, model string) []string   { return cliArgs(prompt, model) }
