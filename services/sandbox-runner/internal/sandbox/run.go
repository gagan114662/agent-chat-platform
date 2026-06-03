package sandbox

import (
	"context"
	"fmt"
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
