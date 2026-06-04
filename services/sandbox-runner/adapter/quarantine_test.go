package adapter

import (
	"os"
	"path/filepath"
	"testing"
)

func TestQuarantineRepoConfig(t *testing.T) {
	dir := t.TempDir()

	claudeMd := filepath.Join(dir, "CLAUDE.md")
	if err := os.WriteFile(claudeMd, []byte("evil"), 0o644); err != nil {
		t.Fatalf("write CLAUDE.md: %v", err)
	}
	skillDir := filepath.Join(dir, ".claude", "skills", "x")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir skill: %v", err)
	}
	skillMd := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillMd, []byte("malicious skill"), 0o644); err != nil {
		t.Fatalf("write SKILL.md: %v", err)
	}

	restore, err := quarantineRepoConfig(dir)
	if err != nil {
		t.Fatalf("quarantineRepoConfig: %v", err)
	}

	if _, err := os.Lstat(claudeMd); !os.IsNotExist(err) {
		t.Fatalf("expected CLAUDE.md gone during quarantine, err=%v", err)
	}
	if _, err := os.Lstat(filepath.Join(dir, ".claude")); !os.IsNotExist(err) {
		t.Fatalf("expected .claude gone during quarantine, err=%v", err)
	}

	restore()

	got, err := os.ReadFile(claudeMd)
	if err != nil {
		t.Fatalf("CLAUDE.md not restored: %v", err)
	}
	if string(got) != "evil" {
		t.Fatalf("CLAUDE.md content changed: %q", got)
	}
	gotSkill, err := os.ReadFile(skillMd)
	if err != nil {
		t.Fatalf("SKILL.md not restored: %v", err)
	}
	if string(gotSkill) != "malicious skill" {
		t.Fatalf("SKILL.md content changed: %q", gotSkill)
	}
}

func TestQuarantineRepoConfigNoPaths(t *testing.T) {
	dir := t.TempDir()
	// regular file that is NOT an agent-instruction path
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	restore, err := quarantineRepoConfig(dir)
	if err != nil {
		t.Fatalf("quarantineRepoConfig with no agent paths: %v", err)
	}
	// README.md must remain untouched
	if _, err := os.Stat(filepath.Join(dir, "README.md")); err != nil {
		t.Fatalf("README.md should be untouched: %v", err)
	}
	restore() // no-op, must not panic/error
	if _, err := os.Stat(filepath.Join(dir, "README.md")); err != nil {
		t.Fatalf("README.md should still exist after restore: %v", err)
	}
}
