package sandbox

import (
	"fmt"
	"os/exec"
)

// gitRun runs git in dir and returns combined output on error.
func gitRun(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git %v: %w\n%s", args, err, out)
	}
	return nil
}

// CloneInto clones repoURL at branch into dest.
func CloneInto(repoURL, branch, dest string) error {
	return gitRun("", "clone", "--branch", branch, "--single-branch", repoURL, dest)
}
