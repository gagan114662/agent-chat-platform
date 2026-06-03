package sandbox

import (
	"context"
	"path/filepath"
	"testing"
)

func TestRun(t *testing.T) {
	src := makeBareRepoWithCommit(t)
	res, err := Run(context.Background(), RunRequest{
		RepoURL:    src,
		BaseBranch: "main",
		Intent:     "do the thing",
		Branch:     "feature/run",
		WorkDir:    filepath.Join(t.TempDir(), "co"),
	}, FakeAgent{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.CommitSHA == "" || res.Branch != "feature/run" {
		t.Fatalf("unexpected result: %+v", res)
	}
}
