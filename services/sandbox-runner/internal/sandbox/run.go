package sandbox

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

type RunRequest struct {
	RepoURL    string `json:"repoUrl"`
	BaseBranch string `json:"baseBranch"`
	Intent     string `json:"intent"`
	Branch     string `json:"branch"`
	Adapter    string `json:"adapter"`
	Model      string `json:"model,omitempty"`
	Provider   string `json:"provider,omitempty"`
	WorkDir    string `json:"-"`
}

type RunResult struct {
	Branch    string `json:"branch"`
	CommitSHA string `json:"commitSha"`
}

// Validate checks the request before any git command is shelled out.
func (r RunRequest) Validate() error {
	if r.RepoURL == "" {
		return errors.New("repoUrl required")
	}
	// Reject a leading '-' so the URL can't be reinterpreted as a git/ssh CLI flag
	// (e.g. -oProxyCommand=...) when passed as an argv element.
	if strings.HasPrefix(r.RepoURL, "-") {
		return errors.New("repoUrl must not start with '-'")
	}
	u, err := url.Parse(r.RepoURL)
	if err != nil {
		return fmt.Errorf("repoUrl invalid: %w", err)
	}
	switch u.Scheme {
	case "http", "https", "ssh", "git":
		if u.Host == "" {
			return fmt.Errorf("repoUrl scheme %q requires a host", u.Scheme)
		}
	case "file":
		// file:// can read arbitrary local paths — gated off by default (prod rejects it).
		if os.Getenv("ACP_ALLOW_FILE_REPO") != "1" {
			return errors.New("repoUrl scheme \"file\" not allowed (set ACP_ALLOW_FILE_REPO=1)")
		}
	default:
		return fmt.Errorf("repoUrl scheme %q not allowed", u.Scheme)
	}
	if r.Intent == "" {
		return errors.New("intent required")
	}
	if err := validRef(r.BaseBranch, "baseBranch"); err != nil {
		return err
	}
	if err := validModelProvider(r.Model, "model"); err != nil {
		return err
	}
	if err := validModelProvider(r.Provider, "provider"); err != nil {
		return err
	}
	return validRef(r.Branch, "branch")
}

// validModelProvider gates the optional model/provider selectors. They become
// argv (--model <value>) / env, so reject anything that could be reinterpreted
// as a CLI flag (leading '-') or carry whitespace/metacharacters. Empty is OK
// (the default — no flag, no provider env).
func validModelProvider(v, field string) error {
	if v == "" {
		return nil
	}
	if strings.HasPrefix(v, "-") {
		return fmt.Errorf("%s must not start with '-'", field)
	}
	if strings.ContainsAny(v, " \t\n\r;|&$`\\\"'") {
		return fmt.Errorf("%s contains illegal characters", field)
	}
	return nil
}

func validRef(ref, field string) error {
	if ref == "" {
		return fmt.Errorf("%s required", field)
	}
	if strings.HasPrefix(ref, "-") {
		return fmt.Errorf("%s must not start with '-'", field)
	}
	if strings.ContainsAny(ref, " \t\n\r;|&$`\\\"'") {
		return fmt.Errorf("%s contains illegal characters", field)
	}
	return nil
}

// Run clones, applies the agent, commits and pushes a branch.
func Run(ctx context.Context, req RunRequest, agent Agent, limits Limits) (RunResult, error) {
	if err := CloneIntoDepth(ctx, req.RepoURL, req.BaseBranch, req.WorkDir, limits.CloneDepth); err != nil {
		return RunResult{}, fmt.Errorf("clone: %w", err)
	}
	if err := checkRepoSize(req.WorkDir, limits.MaxRepoBytes); err != nil {
		return RunResult{}, err
	}
	if err := agent.Apply(ctx, req.WorkDir, req.Intent); err != nil {
		return RunResult{}, fmt.Errorf("agent: %w", err)
	}
	sha, err := CommitAllAndPush(ctx, req.WorkDir, req.Branch, "agent: "+req.Intent, newGitCred(req.RepoURL))
	if err != nil {
		return RunResult{}, fmt.Errorf("commit/push: %w", err)
	}
	return RunResult{Branch: req.Branch, CommitSHA: sha}, nil
}
