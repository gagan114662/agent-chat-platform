package adapter

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// localAgent mirrors sandbox.Agent's method set (structural typing).
type localAgent interface{ Apply(repoDir, intent string) error }

func TestAsAgent(t *testing.T) {
	var ag localAgent = AsAgent(NewFakeAdapter())
	dir := t.TempDir()
	if err := ag.Apply(dir, "bridge it"); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "AGENT_CHANGES.md"))
	if err != nil || !strings.Contains(string(b), "bridge it") {
		t.Fatalf("bridge did not apply: %q err %v", b, err)
	}
}
