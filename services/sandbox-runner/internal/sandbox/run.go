package sandbox

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

type RunRequest struct {
	RepoURL    string `json:"repoUrl"`
	BaseBranch string `json:"baseBranch"`
	Intent     string `json:"intent"`
	Branch     string `json:"branch"`
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
	u, err := url.Parse(r.RepoURL)
	if err != nil {
		return fmt.Errorf("repoUrl invalid: %w", err)
	}
	switch u.Scheme {
	case "http", "https", "ssh", "git", "file":
	default:
		return fmt.Errorf("repoUrl scheme %q not allowed", u.Scheme)
	}
	if r.Intent == "" {
		return errors.New("intent required")
	}
	if err := validRef(r.BaseBranch, "baseBranch"); err != nil {
		return err
	}
	return validRef(r.Branch, "branch")
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
func Run(ctx context.Context, req RunRequest, agent Agent) (RunResult, error) {
	if err := CloneInto(req.RepoURL, req.BaseBranch, req.WorkDir); err != nil {
		return RunResult{}, fmt.Errorf("clone: %w", err)
	}
	if err := agent.Apply(req.WorkDir, req.Intent); err != nil {
		return RunResult{}, fmt.Errorf("agent: %w", err)
	}
	sha, err := CommitAllAndPush(req.WorkDir, req.Branch, "agent: "+req.Intent)
	if err != nil {
		return RunResult{}, fmt.Errorf("commit/push: %w", err)
	}
	return RunResult{Branch: req.Branch, CommitSHA: sha}, nil
}
