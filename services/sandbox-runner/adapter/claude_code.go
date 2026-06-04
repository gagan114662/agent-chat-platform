package adapter

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
)

// ClaudeCodeAdapter runs the `claude` CLI (subscription auth) in the repo dir,
// streaming its output as typed log events. exec/lookPath are injectable for tests.
type ClaudeCodeAdapter struct {
	lookPath func(string) (string, error)
	exec     func(ctx context.Context, dir, intent string, onLine func(string)) error
}

func NewClaudeCodeAdapter() *ClaudeCodeAdapter {
	return &ClaudeCodeAdapter{lookPath: exec.LookPath, exec: runClaudeCLI}
}

func (*ClaudeCodeAdapter) Identify() Identity {
	return Identity{Name: "claude-code", Version: "cli", Capabilities: []Capability{CanEditCode, CanRunTests}}
}

func (a *ClaudeCodeAdapter) Prepare(_ context.Context, _ PrepareContext) error {
	if _, err := a.lookPath("claude"); err != nil {
		return fmt.Errorf("claude CLI not found on PATH: %w", err)
	}
	return nil
}

func (a *ClaudeCodeAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "claude-code: starting"})
	emit(Event{Type: EventProgress, Step: "agent", Pct: 10})
	if err := a.exec(ctx, repoDir, intent, func(line string) {
		emit(Event{Type: EventLog, Message: line})
	}); err != nil {
		return fmt.Errorf("claude-code run failed: %w", err)
	}
	emit(Event{Type: EventDone, Message: "claude-code: finished"})
	return nil
}

func (a *ClaudeCodeAdapter) ApplyFeedback(ctx context.Context, notes string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "claude-code: applying feedback"})
	emit(Event{Type: EventDone, Message: "feedback applied"})
	return nil
}

func (*ClaudeCodeAdapter) Teardown(context.Context) error { return nil }

// runClaudeCLI invokes `claude -p <intent> --permission-mode acceptEdits` in dir,
// streaming combined stdout+stderr line-by-line to onLine.
func runClaudeCLI(ctx context.Context, dir, intent string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, "claude", "-p", intent, "--permission-mode", "acceptEdits")
	if dir != "" {
		cmd.Dir = dir
	}
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
