package adapter

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFakeAdapter(t *testing.T) {
	a := NewFakeAdapter()
	id := a.Identify()
	if id.Name != "fake" || !id.Has(CanEditCode) {
		t.Fatalf("bad identity: %+v", id)
	}
	dir := t.TempDir()
	var events []EventType
	err := a.Run(context.Background(), dir, "add a greeting", func(e Event) { events = append(events, e.Type) })
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "AGENT_CHANGES.md"))
	if err != nil || !strings.Contains(string(b), "add a greeting") {
		t.Fatalf("expected change file with intent, got %q err %v", b, err)
	}
	// emits at least a file_changed and a done
	var hasFile, hasDone bool
	for _, e := range events {
		hasFile = hasFile || e == EventFileChanged
		hasDone = hasDone || e == EventDone
	}
	if !hasFile || !hasDone {
		t.Fatalf("expected file_changed + done events, got %v", events)
	}
}

func TestFakeAdapterApplyFeedbackWritesFile(t *testing.T) {
	a := NewFakeAdapter()
	dir := t.TempDir()
	if err := a.Prepare(context.Background(), PrepareContext{RepoDir: dir}); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	var events []EventType
	err := a.ApplyFeedback(context.Background(), "ci: lint failed", func(e Event) { events = append(events, e.Type) })
	if err != nil {
		t.Fatalf("ApplyFeedback: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "FEEDBACK.md"))
	if err != nil || !strings.Contains(string(b), "ci: lint failed") {
		t.Fatalf("expected FEEDBACK.md with notes, got %q err %v", b, err)
	}
	var hasFile, hasDone bool
	for _, e := range events {
		hasFile = hasFile || e == EventFileChanged
		hasDone = hasDone || e == EventDone
	}
	if !hasFile || !hasDone {
		t.Fatalf("expected file_changed + done events, got %v", events)
	}
}
