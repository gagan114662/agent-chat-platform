package adapter

import (
	"context"
	"errors"
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

func TestClaudeCodeAdapterMissingCLI(t *testing.T) {
	a := &ClaudeCodeAdapter{lookPath: func(string) (string, error) { return "", errors.New("nope") }}
	if err := a.Prepare(context.Background(), PrepareContext{}); err == nil {
		t.Fatal("expected error when claude CLI absent")
	}
}
