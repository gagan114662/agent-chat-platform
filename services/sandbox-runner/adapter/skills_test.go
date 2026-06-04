package adapter

import (
	"os"
	"path/filepath"
	"testing"
)

// TestProvisionBuiltinSkills verifies the embedded built-in skill set is written
// into repoDir/.claude/skills/ and that the returned cleanup removes exactly what
// was written (pruning the .claude dir it created).
func TestProvisionBuiltinSkills(t *testing.T) {
	repo := t.TempDir()

	cleanup, err := provisionBuiltinSkills(repo)
	if err != nil {
		t.Fatalf("provisionBuiltinSkills: %v", err)
	}

	for _, name := range []string{"code-review", "test-first"} {
		p := filepath.Join(repo, ".claude", "skills", name, "SKILL.md")
		b, err := os.ReadFile(p)
		if err != nil {
			t.Fatalf("expected %s during provisioning: %v", p, err)
		}
		if len(b) == 0 {
			t.Fatalf("%s is empty", p)
		}
	}

	cleanup()

	if _, err := os.Stat(filepath.Join(repo, ".claude", "skills", "code-review")); !os.IsNotExist(err) {
		t.Fatalf("code-review skill not removed after cleanup: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repo, ".claude")); !os.IsNotExist(err) {
		t.Fatalf(".claude not pruned after cleanup: %v", err)
	}
}

// TestProvisionBuiltinSkillsOverride verifies ACP_BUILTIN_SKILLS_DIR overrides
// the embedded set: only the skills in the override dir are provisioned.
func TestProvisionBuiltinSkillsOverride(t *testing.T) {
	custom := t.TempDir()
	skillDir := filepath.Join(custom, "myskill")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("custom body"), 0o644); err != nil {
		t.Fatalf("write SKILL.md: %v", err)
	}
	t.Setenv("ACP_BUILTIN_SKILLS_DIR", custom)

	repo := t.TempDir()
	cleanup, err := provisionBuiltinSkills(repo)
	if err != nil {
		t.Fatalf("provisionBuiltinSkills: %v", err)
	}
	defer cleanup()

	if _, err := os.Stat(filepath.Join(repo, ".claude", "skills", "myskill", "SKILL.md")); err != nil {
		t.Fatalf("expected override skill provisioned: %v", err)
	}
	// the embedded skills must NOT be present when overridden
	if _, err := os.Stat(filepath.Join(repo, ".claude", "skills", "code-review")); !os.IsNotExist(err) {
		t.Fatalf("embedded skill present despite override: %v", err)
	}
}
