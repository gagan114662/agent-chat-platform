package sandbox

import (
	"fmt"
	"os/exec"
	"strings"
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

// CommitAllAndPush stages all changes, commits on a new branch, pushes it,
// and returns the commit SHA.
func CommitAllAndPush(repoDir, branch, message string) (string, error) {
	if err := gitRun(repoDir, "config", "user.email", "agent@agent-chat.dev"); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "config", "user.name", "agent-chat"); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "checkout", "-b", branch); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "add", "-A"); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "commit", "-m", message); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "push", "origin", branch); err != nil {
		return "", err
	}
	out, err := exec.Command("git", "-C", repoDir, "rev-parse", "HEAD").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
