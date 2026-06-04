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

// PlanRequest asks an adapter to produce a read-only plan for an intent.
// It clones the base branch but NEVER commits or pushes.
type PlanRequest struct {
	RepoURL    string `json:"repoUrl"`
	BaseBranch string `json:"baseBranch"`
	Intent     string `json:"intent"`
	Adapter    string   `json:"adapter"`
	Model      string   `json:"model,omitempty"`
	Provider   string   `json:"provider,omitempty"`
	McpServers []string `json:"mcpServers,omitempty"`
	WorkDir    string   `json:"-"`
}

// PlanResult carries the agent's proposed plan text.
type PlanResult struct {
	Plan string `json:"plan"`
}

// Validate checks the request before any git command is shelled out.
// Mirrors RunRequest's scheme/ref gates (no Branch — plan never pushes).
func (r PlanRequest) Validate() error {
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
	if r.Intent == "" {
		return errors.New("intent required")
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
	return validRef(r.BaseBranch, "baseBranch")
}

// Plan shallow-clones the base branch, resolves + prepares the adapter, and asks
// it for a read-only plan. It never commits or pushes — the clone is discarded.
func Plan(ctx context.Context, req PlanRequest, ad adapter.Adapter, limits Limits) (PlanResult, error) {
	if err := CloneIntoDepth(ctx, req.RepoURL, req.BaseBranch, req.WorkDir, limits.CloneDepth); err != nil {
		return PlanResult{}, fmt.Errorf("clone: %w", err)
	}
	if err := checkRepoSize(req.WorkDir, limits.MaxRepoBytes); err != nil {
		return PlanResult{}, err
	}
	if err := ad.Prepare(ctx, adapter.PrepareContext{RepoDir: req.WorkDir, Intent: req.Intent, Model: req.Model, Provider: req.Provider, McpServers: req.McpServers}); err != nil {
		return PlanResult{}, fmt.Errorf("prepare: %w", err)
	}
	text, err := ad.Plan(ctx, req.WorkDir, req.Intent)
	if err != nil {
		return PlanResult{}, fmt.Errorf("plan: %w", err)
	}
	return PlanResult{Plan: text}, nil
}
