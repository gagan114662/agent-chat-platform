package sandbox

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleRun(t *testing.T) {
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
