package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
)

func TestHandlePlan(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1") // test fixture clones from a local bare repo via file://
	src := makeBareRepoWithCommit(t)
	refsBefore := listRefs(t, src)

	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "intent": "add a feature",
	})
	req := httptest.NewRequest(http.MethodPost, "/plan", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out PlanResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Plan == "" {
		t.Fatalf("expected non-empty plan, got %+v", out)
	}
	if !strings.Contains(out.Plan, "add a feature") {
		t.Fatalf("expected plan to contain the intent, got %q", out.Plan)
	}

	// Read-only: no branch was pushed — the bare repo's refs are unchanged.
	refsAfter := listRefs(t, src)
	if refsAfter != refsBefore {
		t.Fatalf("expected no new refs pushed; before=%q after=%q", refsBefore, refsAfter)
	}
}

func TestHandlePlanRejectsUnknownField(t *testing.T) {
	body := []byte(`{"repoUrl":"https://h/r","baseBranch":"main","intent":"x","bogus":1}`)
	req := httptest.NewRequest(http.MethodPost, "/plan", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown field, got %d", rec.Code)
	}
}

func TestHandlePlanRejectsInvalid(t *testing.T) {
	body := []byte(`{"repoUrl":"ftp://x/y","baseBranch":"main","intent":"x"}`)
	req := httptest.NewRequest(http.MethodPost, "/plan", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid request, got %d", rec.Code)
	}
}

// listRefs returns a stable string of all refs in a bare repo (for asserting
// nothing was pushed).
func listRefs(t *testing.T, bare string) string {
	t.Helper()
	cmd := exec.CommandContext(context.Background(), "git", "for-each-ref", "--format=%(refname) %(objectname)")
	cmd.Dir = bare
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("for-each-ref: %v\n%s", err, out)
	}
	return string(out)
}
