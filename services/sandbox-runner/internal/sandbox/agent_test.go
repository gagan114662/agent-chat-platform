package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFakeAgentApply(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := FakeAgent{}
	if err := a.Apply(context.Background(), dir, "add a greeting"); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "AGENT_CHANGES.md"))
	if err != nil {
		t.Fatalf("expected AGENT_CHANGES.md: %v", err)
	}
	if !strings.Contains(string(b), "add a greeting") {
		t.Fatalf("expected intent recorded, got: %q", b)
	}
}
