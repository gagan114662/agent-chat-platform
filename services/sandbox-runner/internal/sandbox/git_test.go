package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// makeBareRepoWithCommit creates a bare repo with one commit on "main",
// returning the bare repo path to use as a clone source.
func makeBareRepoWithCommit(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	bare := filepath.Join(dir, "origin.git")
	work := filepath.Join(dir, "work")
	run := func(d string, args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = d
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	run(dir, "init", "--bare", "-b", "main", bare)
	run(dir, "clone", bare, work)
	run(work, "config", "user.email", "t@t.dev")
	run(work, "config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(work, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(work, "add", ".")
	run(work, "commit", "-m", "init")
	run(work, "push", "origin", "main")
	return bare
}

func TestCloneInto(t *testing.T) {
	src := makeBareRepoWithCommit(t)
	dest := filepath.Join(t.TempDir(), "checkout")

	err := CloneInto(src, "main", dest)
	if err != nil {
		t.Fatalf("CloneInto: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "README.md")); err != nil {
		t.Fatalf("expected README.md in checkout: %v", err)
	}
}
