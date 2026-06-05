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
		{"codex", false}, // #63 codex is a non-fake adapter: default-deny without the allowlist (#38)
		// #91 the generic CLI-factory adapters are non-fake: default-deny too.
		{"cursor", false},
		{"devin", false},
		{"openclaw", false},
		{"hermes", false},
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

	// #63 codex passes the #38 gate once explicitly allowlisted.
	t.Setenv("ACP_ALLOWED_ADAPTERS", "codex")
	if !adapterAuthorized("codex") {
		t.Errorf("adapterAuthorized(%q) = false, want true once allowlisted", "codex")
	}

	// #91 the CLI-factory adapters pass the #38 gate once explicitly allowlisted.
	t.Setenv("ACP_ALLOWED_ADAPTERS", "cursor, devin ,openclaw,hermes")
	for _, name := range []string{"cursor", "devin", "openclaw", "hermes"} {
		if !adapterAuthorized(name) {
			t.Errorf("adapterAuthorized(%q) = false, want true once allowlisted", name)
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
