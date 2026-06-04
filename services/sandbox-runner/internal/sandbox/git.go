package sandbox

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// gitRun runs git in dir and returns combined output on error.
func gitRun(ctx context.Context, dir string, args ...string) error {
	return gitRunEnv(ctx, dir, nil, args...)
}

// gitRunEnv runs git in dir with extra environment entries appended to os.Environ()
// and returns combined output on error. The extra env carries out-of-argv secrets
// (e.g. ACP_GIT_TOKEN) consumed by an inline credential helper.
func gitRunEnv(ctx context.Context, dir string, env []string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
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

// CloneInto clones repoURL at branch into dest. The credential (if repoURL embeds
// a userinfo password) is derived internally so the secret never appears in argv.
func CloneInto(ctx context.Context, repoURL, branch, dest string) error {
	c := newGitCred(repoURL)
	// "--" terminates option parsing so repoURL/dest can never be read as flags.
	args := append(append([]string{}, c.args...), "clone", "--single-branch", "--branch", branch, "--", c.cleanURL, dest)
	return gitRunEnv(ctx, "", c.env, args...)
}

// CommitAllAndPush stages all changes, commits on a new branch, pushes it,
// and returns the commit SHA. cred (if non-empty) keeps the push credential
// out of argv.
func CommitAllAndPush(ctx context.Context, repoDir, branch, message string, cred gitCred) (string, error) {
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
	if err := gitRunEnv(ctx, repoDir, cred.env, append(append([]string{}, cred.args...), "push", "origin", branch)...); err != nil {
		return "", err
	}
	return gitOutput(ctx, repoDir, "rev-parse", "HEAD")
}

// CommitAllAndPushExisting stages all changes, commits, and pushes to a branch
// that already exists (the repo was cloned at that branch — so no `checkout -b`),
// returning the new commit SHA. Used by the /feedback path which re-clones a branch.
// cred (if non-empty) keeps the push credential out of argv.
func CommitAllAndPushExisting(ctx context.Context, repoDir, branch, message string, cred gitCred) (string, error) {
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
	if err := gitRunEnv(ctx, repoDir, cred.env, append(append([]string{}, cred.args...), "push", "origin", "HEAD:"+branch)...); err != nil {
		return "", err
	}
	return gitOutput(ctx, repoDir, "rev-parse", "HEAD")
}
