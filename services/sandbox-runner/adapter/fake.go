package adapter

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// FakeAdapter is the deterministic reference implementation on the SDK,
// mirroring sandbox.FakeAgent but emitting the full typed event stream.
type FakeAdapter struct{}

func NewFakeAdapter() *FakeAdapter { return &FakeAdapter{} }

func (*FakeAdapter) Identify() Identity {
	return Identity{Name: "fake", Version: "0.1.0", Capabilities: []Capability{CanEditCode}}
}

func (*FakeAdapter) Prepare(context.Context, PrepareContext) error { return nil }

func (*FakeAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "starting fake adapter"})
	emit(Event{Type: EventProgress, Step: "edit", Pct: 50})
	p := filepath.Join(repoDir, "AGENT_CHANGES.md")
	content := fmt.Sprintf("# Agent change\n\nIntent: %s\n", intent)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		return err
	}
	emit(Event{Type: EventFileChanged, Path: "AGENT_CHANGES.md"})
	emit(Event{Type: EventConfidence, Score: 1.0})
	emit(Event{Type: EventDone, Message: "applied: " + intent})
	return nil
}

func (*FakeAdapter) ApplyFeedback(ctx context.Context, notes string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "applying feedback: " + notes})
	emit(Event{Type: EventDone, Message: "feedback applied"})
	return nil
}

func (*FakeAdapter) Teardown(context.Context) error { return nil }
