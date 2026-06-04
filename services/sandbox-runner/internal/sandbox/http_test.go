package sandbox

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleRun(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1") // test fixture clones from a local bare repo via file://
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "intent": "x", "branch": "feature/http",
	})
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out RunResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.CommitSHA == "" {
		t.Fatalf("expected commitSha, got %+v", out)
	}
}

func TestHandleRunUnknownAdapter(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1") // test fixture clones from a local bare repo via file://
	t.Setenv("ACP_ALLOWED_ADAPTERS", "nope") // pass the authz gate so we exercise the unknown-adapter (400) path
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "intent": "x", "branch": "feature/z", "adapter": "nope",
	})
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown adapter, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleRunRejectsUnknownField(t *testing.T) {
	body := []byte(`{"repoUrl":"https://h/r","baseBranch":"main","intent":"x","branch":"b","bogus":1}`)
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown field, got %d", rec.Code)
	}
}

func TestHandleRunRejectsInvalid(t *testing.T) {
	body := []byte(`{"repoUrl":"ftp://x/y","baseBranch":"main","intent":"x","branch":"b"}`)
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid request, got %d", rec.Code)
	}
}
