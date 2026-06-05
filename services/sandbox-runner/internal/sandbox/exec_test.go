package sandbox

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// With ACP_ALLOW_EXEC=1 + the file:// fixture, POST /exec runs the command in a
// clone and returns combined output + exit code.
func TestHandleExec(t *testing.T) {
	t.Setenv("ACP_ALLOW_EXEC", "1")
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "command": "echo hello && exit 0",
	})
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out ExecResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.Output, "hello") {
		t.Fatalf("expected output to contain hello, got %q", out.Output)
	}
	if out.ExitCode != 0 {
		t.Fatalf("expected exitCode 0, got %d", out.ExitCode)
	}
}

// A non-zero exit is reported as a 200 result carrying the exit code (the command
// ran — the runner succeeded even though the command failed).
func TestHandleExecNonZeroExit(t *testing.T) {
	t.Setenv("ACP_ALLOW_EXEC", "1")
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "command": "exit 7",
	})
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out ExecResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.ExitCode != 7 {
		t.Fatalf("expected exitCode 7, got %d", out.ExitCode)
	}
}

// Default-deny: without ACP_ALLOW_EXEC, /exec is 403 (it's arbitrary code exec).
func TestHandleExecDefaultDeny(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "command": "echo hello",
	})
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without ACP_ALLOW_EXEC, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Oversize bodies are rejected by the MaxBytesReader (413).
func TestHandleExecOversizeBody(t *testing.T) {
	t.Setenv("ACP_ALLOW_EXEC", "1")
	big := bytes.Repeat([]byte("a"), (1<<20)+1)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "https://h/r", "baseBranch": "main", "command": string(big),
	})
	req := httptest.NewRequest(http.MethodPost, "/exec", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for oversize body, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestExecRequestValidate(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	// missing command
	if err := (ExecRequest{RepoURL: "https://h/r", BaseBranch: "main"}).Validate(); err == nil {
		t.Fatal("expected error for empty command")
	}
	// bad scheme
	if err := (ExecRequest{RepoURL: "ftp://h/r", BaseBranch: "main", Command: "ls"}).Validate(); err == nil {
		t.Fatal("expected error for ftp scheme")
	}
	// happy path
	if err := (ExecRequest{RepoURL: "https://h/r", BaseBranch: "main", Command: "ls"}).Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
