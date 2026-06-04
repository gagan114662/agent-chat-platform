# Plan 3a — Sandbox-Runner Hardening (the deferred Plan-1 items)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** Implements the security/robustness items deferred from Plan 1 (tracked in `HANDOVER.md`) in the Go `sandbox-runner`: (1) **redact credentials** from token-bearing URLs in any error/log, (2) **validate `RunRequest`** before shelling to git, (3) **`DisallowUnknownFields`** on the JSON decoder, (4) thread **`context.Context`** into git ops (cancellation), (5) **empty-branch/message guards**, (6) **HTTP timeouts + graceful shutdown**. Pure Go; additive; existing Go tests updated only for the new ctx params. (Postgres RLS — a cross-cutting data-layer change that would break every existing query — is split to its own future plan.)

**Tech Stack:** Go 1.25. Branch `plan-3a-sandbox-hardening` (off `main`). Tests: `cd services/sandbox-runner && go test ./...`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Credential redaction

**Files:** Create `services/sandbox-runner/internal/sandbox/redact.go`, `redact_test.go`; Modify `git.go`

- [ ] **Step 1: failing test** `internal/sandbox/redact_test.go`:
```go
package sandbox

import (
	"strings"
	"testing"
)

func TestRedactCreds(t *testing.T) {
	in := "git clone https://x-access-token:ghp_SECRET@github.com/o/r.git failed"
	out := redactCreds(in)
	if strings.Contains(out, "ghp_SECRET") {
		t.Fatalf("token leaked: %q", out)
	}
	if !strings.Contains(out, "https://[redacted]@github.com/o/r.git") {
		t.Fatalf("expected redacted url, got %q", out)
	}
	// non-URL text is untouched
	if redactCreds("plain error") != "plain error" {
		t.Fatal("plain text changed")
	}
}
```

- [ ] **Step 2:** `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestRedactCreds` → FAIL (undefined). Then implement `internal/sandbox/redact.go`:
```go
package sandbox

import "regexp"

// matches scheme://userinfo@  (userinfo = anything up to the @, no slash/space)
var urlCredsRe = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.\-]*://)[^/@\s]+@`)

// redactCreds removes userinfo (user:pass@ or token@) from any URLs in s,
// so credentials never appear in errors, logs, or HTTP responses.
func redactCreds(s string) string {
	return urlCredsRe.ReplaceAllString(s, "${1}[redacted]@")
}
```

- [ ] **Step 3: Apply redaction in `git.go` error wrapping** — replace the two error returns in `gitRun` and `gitOutput` so neither args nor output can leak a token. Change `gitRun`'s error branch to:
```go
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git %s: %v\n%s", redactCreds(strings.Join(args, " ")), err, redactCreds(string(out)))
	}
```
and `gitOutput`'s ExitError branch to:
```go
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("git %s: %v\n%s", redactCreds(strings.Join(args, " ")), err, redactCreds(string(ee.Stderr)))
		}
		return "", fmt.Errorf("git %s: %v", redactCreds(strings.Join(args, " ")), err)
```
(`strings` is already imported in `git.go`.)

- [ ] **Step 4:** `go test ./...` → all pass (existing tests' error strings changed format but they don't assert on it). `go vet ./...` clean.
- [ ] **Step 5:** commit:
```bash
git add services/sandbox-runner/internal/sandbox/redact.go services/sandbox-runner/internal/sandbox/redact_test.go services/sandbox-runner/internal/sandbox/git.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(sandbox): redact credentials from git errors"
```

---

## Task 1: `RunRequest` validation

**Files:** Modify `internal/sandbox/run.go`; Create `internal/sandbox/run_validate_test.go`

- [ ] **Step 1: failing test** `internal/sandbox/run_validate_test.go`:
```go
package sandbox

import "testing"

func TestRunRequestValidate(t *testing.T) {
	ok := RunRequest{RepoURL: "https://github.com/o/r.git", BaseBranch: "main", Intent: "x", Branch: "feature/x"}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	bad := []RunRequest{
		{},                                                                                  // empty
		{RepoURL: "ftp://x/y", BaseBranch: "main", Intent: "x", Branch: "b"},                 // scheme
		{RepoURL: "https://h/r", BaseBranch: "main", Intent: "x", Branch: "-rf"},             // leading dash
		{RepoURL: "https://h/r", BaseBranch: "ma in", Intent: "x", Branch: "b"},              // whitespace
		{RepoURL: "https://h/r", BaseBranch: "main", Intent: "x", Branch: "a;rm -rf /"},      // shell meta
		{RepoURL: "https://h/r", BaseBranch: "main", Intent: "", Branch: "b"},                // no intent
	}
	for i, r := range bad {
		if err := r.Validate(); err == nil {
			t.Fatalf("bad request %d accepted: %+v", i, r)
		}
	}
}
```

- [ ] **Step 2:** run → FAIL. Then add to `run.go` (add imports `errors`, `net/url`, `strings`):
```go
// Validate checks the request before any git command is shelled out.
func (r RunRequest) Validate() error {
	if r.RepoURL == "" {
		return errors.New("repoUrl required")
	}
	u, err := url.Parse(r.RepoURL)
	if err != nil {
		return fmt.Errorf("repoUrl invalid: %w", err)
	}
	switch u.Scheme {
	case "http", "https", "ssh", "git", "file":
	default:
		return fmt.Errorf("repoUrl scheme %q not allowed", u.Scheme)
	}
	if r.Intent == "" {
		return errors.New("intent required")
	}
	if err := validRef(r.BaseBranch, "baseBranch"); err != nil {
		return err
	}
	return validRef(r.Branch, "branch")
}

func validRef(ref, field string) error {
	if ref == "" {
		return fmt.Errorf("%s required", field)
	}
	if strings.HasPrefix(ref, "-") {
		return fmt.Errorf("%s must not start with '-'", field)
	}
	if strings.ContainsAny(ref, " \t\n\r;|&$`\\\"'") {
		return fmt.Errorf("%s contains illegal characters", field)
	}
	return nil
}
```
(Keep the existing `RunRequest`/`RunResult` structs + `Run`. `fmt` is already imported.)

- [ ] **Step 3:** run `go test ./internal/sandbox/ -run TestRunRequestValidate` → PASS; `go test ./... && go vet ./...` clean.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/internal/sandbox/run.go services/sandbox-runner/internal/sandbox/run_validate_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(sandbox): validate RunRequest before git"
```

---

## Task 2: Context threading + empty-branch/message guards

**Files:** Modify `internal/sandbox/git.go`, `run.go`, `git_test.go`

- [ ] **Step 1: Thread `ctx` through git in `git.go`** — change `gitRun`/`gitOutput` to take a context and use `exec.CommandContext`, and `CloneInto`/`CommitAllAndPush` to take + pass `ctx`. Add `"context"` to imports. New `git.go` bodies:
```go
func gitRun(ctx context.Context, dir string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git %s: %v\n%s", redactCreds(strings.Join(args, " ")), err, redactCreds(string(out)))
	}
	return nil
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("git %s: %v\n%s", redactCreds(strings.Join(args, " ")), err, redactCreds(string(ee.Stderr)))
		}
		return "", fmt.Errorf("git %s: %v", redactCreds(strings.Join(args, " ")), err)
	}
	return strings.TrimSpace(string(out)), nil
}

func CloneInto(ctx context.Context, repoURL, branch, dest string) error {
	return gitRun(ctx, "", "clone", "--branch", branch, "--single-branch", repoURL, dest)
}

func CommitAllAndPush(ctx context.Context, repoDir, branch, message string) (string, error) {
	if branch == "" {
		return "", fmt.Errorf("branch required")
	}
	if message == "" {
		return "", fmt.Errorf("message required")
	}
	if err := gitRun(ctx, repoDir, "config", "user.email", "agent@agent-chat.dev"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "config", "user.name", "agent-chat"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "checkout", "-b", branch); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "add", "-A"); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "commit", "-m", message); err != nil {
		return "", err
	}
	if err := gitRun(ctx, repoDir, "push", "origin", branch); err != nil {
		return "", err
	}
	return gitOutput(ctx, repoDir, "rev-parse", "HEAD")
}
```

- [ ] **Step 2: Thread ctx in `run.go`** — `Run` already has `ctx`; pass it:
```go
	if err := CloneInto(ctx, req.RepoURL, req.BaseBranch, req.WorkDir); err != nil {
		return RunResult{}, fmt.Errorf("clone: %w", err)
	}
	// ...
	sha, err := CommitAllAndPush(ctx, req.WorkDir, req.Branch, "agent: "+req.Intent)
```

- [ ] **Step 3: Update `git_test.go` call sites** — add `context.Background()` as the first arg to every `CloneInto(...)` and `CommitAllAndPush(...)` call, and add `"context"` to the test's imports. (There are calls in `TestCloneInto` and `TestCommitAllAndPush`, including the verify-clone.) Add a guard test:
```go
func TestCommitAllAndPushEmptyGuards(t *testing.T) {
	if _, err := CommitAllAndPush(context.Background(), t.TempDir(), "", "m"); err == nil {
		t.Fatal("expected error for empty branch")
	}
	if _, err := CommitAllAndPush(context.Background(), t.TempDir(), "b", ""); err == nil {
		t.Fatal("expected error for empty message")
	}
}
```

- [ ] **Step 4:** `go test ./... && go vet ./... && go build ./...` → all green.
- [ ] **Step 5:** commit:
```bash
git add services/sandbox-runner/internal/sandbox/git.go services/sandbox-runner/internal/sandbox/run.go services/sandbox-runner/internal/sandbox/git_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(sandbox): thread context into git ops + empty-branch/message guards"
```

---

## Task 3: HTTP handler — DisallowUnknownFields, validation, redaction, request context

**Files:** Modify `internal/sandbox/http.go`, `http_test.go`

- [ ] **Step 1: Rewrite the handler body in `http.go`**:
```go
	mux.HandleFunc("POST /run", func(w http.ResponseWriter, r *http.Request) {
		var req RunRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusBadRequest)
			return
		}
		if err := req.Validate(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		work, err := os.MkdirTemp("", "sbx-*")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.RemoveAll(work)
		req.WorkDir = filepath.Join(work, "repo")

		res, err := Run(r.Context(), req, FakeAgent{})
		if err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
```
(Drop the now-unused `"context"` import — `r.Context()` replaces `context.Background()`.)

- [ ] **Step 2: Add tests to `http_test.go`**:
```go
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
```
(The existing `TestHandleRun` posts a valid body — still 200. `bytes`/`net/http`/`httptest` already imported there.)

- [ ] **Step 3:** `go test ./... && go vet ./...` → green.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/internal/sandbox/http.go services/sandbox-runner/internal/sandbox/http_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(sandbox): strict JSON decode + request validation + redacted errors + request ctx"
```

---

## Task 4: Server timeouts + graceful shutdown

**Files:** Modify `cmd/server/main.go`; Create `cmd/server/main_test.go`

- [ ] **Step 1: Rewrite `cmd/server/main.go`** with a testable server constructor + graceful shutdown:
```go
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/sandbox"
)

// newServer builds the HTTP server with sane timeouts (no Slowloris / runaway).
func newServer(addr string) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           sandbox.NewHandler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      10 * time.Minute, // a run can take minutes
		IdleTimeout:       60 * time.Second,
	}
}

func main() {
	addr := os.Getenv("SANDBOX_ADDR")
	if addr == "" {
		addr = ":8090"
	}
	srv := newServer(addr)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("sandbox-runner listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown error: %v", err)
	}
}
```

- [ ] **Step 2: Test the server config** `cmd/server/main_test.go`:
```go
package main

import (
	"testing"
	"time"
)

func TestNewServerTimeouts(t *testing.T) {
	srv := newServer(":0")
	if srv.ReadTimeout == 0 || srv.WriteTimeout == 0 || srv.IdleTimeout == 0 || srv.ReadHeaderTimeout == 0 {
		t.Fatalf("server missing timeouts: %+v", srv)
	}
	if srv.WriteTimeout < time.Minute {
		t.Fatalf("write timeout too small for long runs: %v", srv.WriteTimeout)
	}
	if srv.Handler == nil {
		t.Fatal("handler not set")
	}
}
```

- [ ] **Step 3:** `cd services/sandbox-runner && go build ./... && go vet ./... && go test ./...` → all green (incl. `cmd/server` now has a test).
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/cmd/server/main.go services/sandbox-runner/cmd/server/main_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(sandbox): HTTP timeouts + graceful shutdown"
```

---

## Self-Review
- Coverage of HANDOVER deferred items: redact creds (T0), input validation + DisallowUnknownFields (T1,T3), ctx threading (T2), empty guards (T2), HTTP timeouts + graceful shutdown (T4). ✅
- Backward-compat: error string format changed (now redacted) — no existing test asserts on it. `CloneInto`/`CommitAllAndPush` gained a leading `ctx` param — all call sites (run.go + git_test.go) updated; `Run`'s signature is unchanged (already had ctx), so the orchestrator/HTTP callers are unaffected.
- Note (carried forward): Postgres RLS, K8s namespace isolation, and gVisor/Kata runtime remain — they require a cluster + a data-layer GUC rewrite; documented as their own future plans, not buildable as additive slices here.

## Definition of Done (3a)
`go build ./... && go vet ./... && go test ./...` all green. Credentials never appear in errors/responses; invalid/unknown-field requests are rejected with 400; git ops honor the request context; the server has timeouts and shuts down gracefully. RLS + K8s/gVisor isolation remain for infra-bound plans.
