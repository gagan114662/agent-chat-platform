package sandbox

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdapterAuthorized(t *testing.T) {
	// Default-deny: with no allowlist, only "" and "fake" are authorized.
	cases := []struct {
		name string
		want bool
	}{
		{"", true},
		{"fake", true},
		{"claude-code", false},
	}
	for _, c := range cases {
		if got := adapterAuthorized(c.name); got != c.want {
			t.Errorf("adapterAuthorized(%q) = %v, want %v (no allowlist)", c.name, got, c.want)
		}
	}

	t.Setenv("ACP_ALLOWED_ADAPTERS", "claude-code,other")
	allowed := []struct {
		name string
		want bool
	}{
		{"claude-code", true},
		{"other", true},
		{"unknown", false},
		{"fake", true},
		{"", true},
	}
	for _, c := range allowed {
		if got := adapterAuthorized(c.name); got != c.want {
			t.Errorf("adapterAuthorized(%q) = %v, want %v (allowlist set)", c.name, got, c.want)
		}
	}
}

func TestHandleRunForbidsUnauthorizedAdapter(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "intent": "x", "branch": "feature/authz", "adapter": "claude-code",
	})
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized adapter, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleRunAllowsAllowlistedAdapter(t *testing.T) {
	t.Setenv("ACP_ALLOW_FILE_REPO", "1")
	t.Setenv("ACP_ALLOWED_ADAPTERS", "claude-code")
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": "file://" + src, "baseBranch": "main", "intent": "x", "branch": "feature/authz2", "adapter": "claude-code",
	})
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	// The request gets past the authz gate; it may fail later (e.g. claude CLI absent),
	// but it must NOT be a 403.
	if rec.Code == http.StatusForbidden {
		t.Fatalf("expected NOT 403 once allowlisted, got 403: %s", rec.Body.String())
	}
}
