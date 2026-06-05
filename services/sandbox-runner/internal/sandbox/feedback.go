package sandbox

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/adapter"
)

// FeedbackRequest re-runs an agent on an existing branch to address feedback
// (e.g. failing CI). It re-clones the branch, applies feedback, commits + pushes.
type FeedbackRequest struct {
	RepoURL string `json:"repoUrl"`
	Branch   string `json:"branch"`
	Notes    string `json:"notes"`
	Adapter    string   `json:"adapter"`
	Model      string   `json:"model,omitempty"`
	Provider   string   `json:"provider,omitempty"`
	McpServers []string `json:"mcpServers,omitempty"`
	// SetupScript is the per-repo, admin-configured setup script run in the
	// workdir after clone and before the agent. Optional; empty = no-op. Only
	// ever populated from trusted repo config (never cloned content), so no
	// charset validation — it is a shell script by design.
	SetupScript string `json:"setupScript,omitempty"`
	WorkDir     string `json:"-"`
}

// Validate checks the request before any git command is shelled out.
// Mirrors RunRequest's scheme/ref gates.
func (r FeedbackRequest) Validate() error {
	if r.RepoURL == "" {
		return errors.New("repoUrl required")
	}
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
		if os.Getenv("ACP_ALLOW_FILE_REPO") != "1" {
			return errors.New("repoUrl scheme \"file\" not allowed (set ACP_ALLOW_FILE_REPO=1)")
		}
	default:
		return fmt.Errorf("repoUrl scheme %q not allowed", u.Scheme)
	}
	if r.Notes == "" {
		return errors.New("notes required")
	}
	if err := validModelProvider(r.Model, "model"); err != nil {
		return err
	}
	if err := validModelProvider(r.Provider, "provider"); err != nil {
		return err
	}
	if err := validMcpServers(r.McpServers); err != nil {
		return err
	}
	return validRef(r.Branch, "branch")
}

// Feedback re-clones the branch, resolves + prepares the adapter, applies the
// feedback notes, then commits and pushes to the SAME branch, returning the new SHA.
func Feedback(ctx context.Context, req FeedbackRequest, ad adapter.Adapter, limits Limits) (RunResult, error) {
	if err := CloneIntoDepth(ctx, req.RepoURL, req.Branch, req.WorkDir, limits.CloneDepth); err != nil {
		return RunResult{}, fmt.Errorf("clone: %w", err)
	}
	if err := checkRepoSize(req.WorkDir, limits.MaxRepoBytes); err != nil {
		return RunResult{}, err
	}
	// Per-repo setup runs after clone and BEFORE the agent re-applies feedback,
	// in the workdir, bounded by ctx (#50). A non-zero exit fails the run.
	if err := runSetupScript(ctx, req.WorkDir, req.SetupScript, nil); err != nil {
		return RunResult{}, fmt.Errorf("setup: %w", err)
	}
	if err := ad.Prepare(ctx, adapter.PrepareContext{RepoDir: req.WorkDir, Intent: req.Notes, Model: req.Model, Provider: req.Provider, McpServers: req.McpServers}); err != nil {
		return RunResult{}, fmt.Errorf("prepare: %w", err)
	}
	noopEmit := func(adapter.Event) {}
	if err := ad.ApplyFeedback(ctx, req.Notes, noopEmit); err != nil {
		return RunResult{}, fmt.Errorf("feedback: %w", err)
	}
	sha, err := CommitAllAndPushExisting(ctx, req.WorkDir, req.Branch, "agent: address feedback", newGitCred(req.RepoURL))
	if err != nil {
		return RunResult{}, fmt.Errorf("commit/push: %w", err)
	}
	return RunResult{Branch: req.Branch, CommitSHA: sha}, nil
}
