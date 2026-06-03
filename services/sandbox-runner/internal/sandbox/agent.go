package sandbox

import (
	"fmt"
	"os"
	"path/filepath"
)

// Agent makes changes to a checked-out repo to satisfy intent.
// Real adapters (Claude Code, Codex, …) implement this in later plans.
type Agent interface {
	Apply(repoDir, intent string) error
}

// FakeAgent makes a deterministic change so the whole loop is testable.
type FakeAgent struct{}

func (FakeAgent) Apply(repoDir, intent string) error {
	p := filepath.Join(repoDir, "AGENT_CHANGES.md")
	content := fmt.Sprintf("# Agent change\n\nIntent: %s\n", intent)
	return os.WriteFile(p, []byte(content), 0o644)
}
