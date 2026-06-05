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

func TestRunSetupScriptWritesMarker(t *testing.T) {
	dir := t.TempDir()
	var lines []string
	err := runSetupScript(context.Background(), dir, "echo hi > marker.txt", nil, func(l string) {
		lines = append(lines, l)
	})
	if err != nil {
		t.Fatalf("runSetupScript: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "marker.txt")); err != nil {
		t.Fatalf("expected marker.txt in workdir: %v", err)
	}
}

func TestRunSetupScriptStreamsOutput(t *testing.T) {
	dir := t.TempDir()
	var lines []string
	err := runSetupScript(context.Background(), dir, "echo first; echo second", nil, func(l string) {
		lines = append(lines, l)
	})
	if err != nil {
		t.Fatalf("runSetupScript: %v", err)
	}
	if len(lines) != 2 || lines[0] != "first" || lines[1] != "second" {
		t.Fatalf("expected [first second], got %v", lines)
	}
}

func TestRunSetupScriptNonZeroExitFails(t *testing.T) {
	dir := t.TempDir()
	err := runSetupScript(context.Background(), dir, "exit 3", nil, func(string) {})
	if err == nil {
		t.Fatal("expected error for non-zero exit")
	}
}

func TestRunSetupScriptEmptyIsNoop(t *testing.T) {
	dir := t.TempDir()
	called := false
	err := runSetupScript(context.Background(), dir, "", nil, func(string) { called = true })
	if err != nil {
		t.Fatalf("empty script should be no-op, got: %v", err)
	}
	if called {
		t.Fatal("onLine should not be called for empty script")
	}
}

// TestRunSetupScriptSeesEnv verifies the per-repo, admin-configured env vars
// (#73) reach the setup script: the script echoes $FOO and we capture the value.
func TestRunSetupScriptSeesEnv(t *testing.T) {
	dir := t.TempDir()
	var lines []string
	err := runSetupScript(context.Background(), dir, "echo \"$FOO\"", map[string]string{"FOO": "bar"}, func(l string) {
		lines = append(lines, l)
	})
	if err != nil {
		t.Fatalf("runSetupScript: %v", err)
	}
	if len(lines) != 1 || lines[0] != "bar" {
		t.Fatalf("expected setup script to see FOO=bar, got %v", lines)
	}
}

// TestHandleRunWithSetupScript exercises the full /run path: the per-repo setup
// script runs after clone and before the agent. We assert the marker it writes
// is committed to the pushed branch (proving setup ran inside the workdir and
// before the commit/push).
func TestHandleRunWithSetupScript(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "intent": "x",
		"branch": "feature/setup", "setupScript": "echo done > SETUP_MARKER.txt",
	})
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// Clone the pushed branch and confirm the setup marker is present.
	verify := filepath.Join(t.TempDir(), "verify")
	if err := CloneInto(context.Background(), src, "feature/setup", verify); err != nil {
		t.Fatalf("branch not pushed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(verify, "SETUP_MARKER.txt")); err != nil {
		t.Fatalf("expected SETUP_MARKER.txt on pushed branch (setup did not run before agent/commit): %v", err)
	}
}

func TestHandleRunSetupScriptFailsRun(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "intent": "x",
		"branch": "feature/setup-fail", "setupScript": "exit 7",
	})
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from failing setup script, got %d: %s", rec.Code, rec.Body.String())
	}
}
