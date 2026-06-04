package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// pushFeatureBranch clones the bare repo, creates a feature branch with one
// commit, and pushes it — so /feedback has an existing branch to re-clone.
func pushFeatureBranch(t *testing.T, src, branch string) {
	t.Helper()
	dest := filepath.Join(t.TempDir(), "seed")
	if err := CloneInto(context.Background(), src, "main", dest); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dest, "AGENT_CHANGES.md"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitAllAndPush(context.Background(), dest, branch, "seed feature"); err != nil {
		t.Fatal(err)
	}
}

func TestHandleFeedback(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1") // test fixture clones from a local bare repo via file://
	src := makeBareRepoWithCommit(t)
	pushFeatureBranch(t, src, "feature/fb")

	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "branch": "feature/fb", "notes": "ci: lint failed",
	})
	req := httptest.NewRequest(http.MethodPost, "/feedback", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out RunResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.CommitSHA == "" || out.Branch != "feature/fb" {
		t.Fatalf("unexpected result %+v", out)
	}

	// Re-clone the branch and verify FEEDBACK.md landed with the notes.
	verify := filepath.Join(t.TempDir(), "verify")
	if err := CloneInto(context.Background(), src, "feature/fb", verify); err != nil {
		t.Fatalf("re-clone feature branch: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(verify, "FEEDBACK.md"))
	if err != nil {
		t.Fatalf("expected FEEDBACK.md after feedback: %v", err)
	}
	if !bytes.Contains(b, []byte("ci: lint failed")) {
		t.Fatalf("FEEDBACK.md missing notes, got %q", b)
	}

	// HEAD of the branch should be the returned (new) commit.
	head, err := gitOutput(context.Background(), verify, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	if head != out.CommitSHA {
		t.Fatalf("branch HEAD %q != returned sha %q", head, out.CommitSHA)
	}
}

func TestFeedbackRequestValidate(t *testing.T) {
	cases := []struct {
		name string
		req  FeedbackRequest
		ok   bool
	}{
		{"missing repo", FeedbackRequest{Branch: "b", Notes: "n"}, false},
		{"missing notes", FeedbackRequest{RepoURL: "https://h/r", Branch: "b"}, false},
		{"missing branch", FeedbackRequest{RepoURL: "https://h/r", Notes: "n"}, false},
		{"leading dash repo", FeedbackRequest{RepoURL: "-evil", Branch: "b", Notes: "n"}, false},
		{"bad scheme", FeedbackRequest{RepoURL: "ftp://h/r", Branch: "b", Notes: "n"}, false},
		{"ok https", FeedbackRequest{RepoURL: "https://h/r", Branch: "b", Notes: "n"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.req.Validate()
			if c.ok && err != nil {
				t.Fatalf("expected valid, got %v", err)
			}
			if !c.ok && err == nil {
				t.Fatal("expected error")
			}
		})
	}
}
