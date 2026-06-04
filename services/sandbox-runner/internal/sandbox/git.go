package sandbox

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// gitRun runs git in dir and returns combined output on error.
func gitRun(ctx context.Context, dir string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git %s: %v\n%s", redactCreds(strings.Join(args, " ")), err, redactCreds(string(out)))
	}
	return nil
}

// gitOutput runs git in dir and returns trimmed stdout, wrapping errors like gitRun.
func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("git %s: %v\n%s", redactCreds(strings.Join(args, " ")), err, redactCreds(string(ee.Stderr)))
		}
		return "", fmt.Errorf("git %s: %v", redactCreds(strings.Join(args, " ")), err)
	}
	return strings.TrimSpace(string(out)), nil
}

// CloneInto clones repoURL at branch into dest.
func CloneInto(ctx context.Context, repoURL, branch, dest string) error {
	// "--" terminates option parsing so repoURL/dest can never be read as flags.
	return gitRun(ctx, "", "clone", "--single-branch", "--branch", branch, "--", repoURL, dest)
}

// CommitAllAndPush stages all changes, commits on a new branch, pushes it,
// and returns the commit SHA.
func CommitAllAndPush(ctx context.Context, repoDir, branch, message string) (string, error) {
	if branch == "" {
		return "", fmt.Errorf("branch required")
	}
	if message == "" {
		return "", fmt.Errorf("message required")
	}
	if err := gitRun(ctx, repoDir, "config", "user.email", "agent@agent-chat.dev"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "config", "user.name", "agent-chat"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "checkout", "-b", branch); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "add", "-A"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "commit", "-m", message); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "push", "origin", branch); err != nil {
		return "", err
	}
	return gitOutput(ctx, repoDir, "rev-parse", "HEAD")
}

// CommitAllAndPushExisting stages all changes, commits, and pushes to a branch
// that already exists (the repo was cloned at that branch — so no `checkout -b`),
// returning the new commit SHA. Used by the /feedback path which re-clones a branch.
func CommitAllAndPushExisting(ctx context.Context, repoDir, branch, message string) (string, error) {
	if branch == "" {
		return "", fmt.Errorf("branch required")
	}
	if message == "" {
		return "", fmt.Errorf("message required")
	}
	if err := gitRun(ctx, repoDir, "config", "user.email", "agent@agent-chat.dev"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "config", "user.name", "agent-chat"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "add", "-A"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "commit", "-m", message); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "push", "origin", "HEAD:"+branch); err != nil {
		return "", err
	}
	return gitOutput(ctx, repoDir, "rev-parse", "HEAD")
}
