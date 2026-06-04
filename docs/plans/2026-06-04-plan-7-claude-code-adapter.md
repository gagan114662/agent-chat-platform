# Plan 7 — Real Claude Code Adapter + Registry-Driven Agent Selection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** On the Plan-5 adapter SDK, add a real `ClaudeCodeAdapter` that shells the `claude` CLI (subscription auth) inside the sandbox and streams its output as typed events, a `DefaultRegistry` (fake + claude-code), and wire the runner to select the adapter by name from `RunRequest.Adapter` (default `"fake"`, so existing behavior/tests are unchanged). The CLI exec is injectable so tests are fast and don't invoke `claude`.

**Tech Stack:** Go 1.25. Branch `plan-7-real-agent` (off `main`; already carries a seed fix). Tests: `cd services/sandbox-runner && go test ./...`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `ClaudeCodeAdapter`

**Files:** Create `services/sandbox-runner/adapter/claude_code.go`, `adapter/claude_code_test.go`

- [ ] **Step 1: failing test** `adapter/claude_code_test.go`:
```go
package adapter

import (
	"context"
	"errors"
	"testing"
)

func TestClaudeCodeAdapter(t *testing.T) {
	a := &ClaudeCodeAdapter{
		lookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		exec: func(ctx context.Context, dir, intent string, onLine func(string)) error {
			onLine("edited README.md")
			return nil
		},
	}
	id := a.Identify()
	if id.Name != "claude-code" || !id.Has(CanEditCode) {
		t.Fatalf("bad identity: %+v", id)
	}
	if err := a.Prepare(context.Background(), PrepareContext{}); err != nil {
		t.Fatalf("Prepare with present CLI: %v", err)
	}
	var logs, dones int
	err := a.Run(context.Background(), t.TempDir(), "tidy the readme", func(e Event) {
		if e.Type == EventLog {
			logs++
		}
		if e.Type == EventDone {
			dones++
		}
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if logs == 0 || dones != 1 {
		t.Fatalf("expected log events + 1 done, got logs=%d dones=%d", logs, dones)
	}
}

func TestClaudeCodeAdapterMissingCLI(t *testing.T) {
	a := &ClaudeCodeAdapter{lookPath: func(string) (string, error) { return "", errors.New("nope") }}
	if err := a.Prepare(context.Background(), PrepareContext{}); err == nil {
		t.Fatal("expected error when claude CLI absent")
	}
}
```

- [ ] **Step 2:** `cd services/sandbox-runner && go test ./adapter/ -run ClaudeCode` → FAIL. Then implement `adapter/claude_code.go`:
```go
package adapter

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
)

// ClaudeCodeAdapter runs the `claude` CLI (subscription auth) in the repo dir,
// streaming its output as typed log events. exec/lookPath are injectable for tests.
type ClaudeCodeAdapter struct {
	lookPath func(string) (string, error)
	exec     func(ctx context.Context, dir, intent string, onLine func(string)) error
}

func NewClaudeCodeAdapter() *ClaudeCodeAdapter {
	return &ClaudeCodeAdapter{lookPath: exec.LookPath, exec: runClaudeCLI}
}

func (*ClaudeCodeAdapter) Identify() Identity {
	return Identity{Name: "claude-code", Version: "cli", Capabilities: []Capability{CanEditCode, CanRunTests}}
}

func (a *ClaudeCodeAdapter) Prepare(_ context.Context, _ PrepareContext) error {
	if _, err := a.lookPath("claude"); err != nil {
		return fmt.Errorf("claude CLI not found on PATH: %w", err)
	}
	return nil
}

func (a *ClaudeCodeAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "claude-code: starting"})
	emit(Event{Type: EventProgress, Step: "agent", Pct: 10})
	if err := a.exec(ctx, repoDir, intent, func(line string) {
		emit(Event{Type: EventLog, Message: line})
	}); err != nil {
		return fmt.Errorf("claude-code run failed: %w", err)
	}
	emit(Event{Type: EventDone, Message: "claude-code: finished"})
	return nil
}

func (a *ClaudeCodeAdapter) ApplyFeedback(ctx context.Context, notes string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "claude-code: applying feedback"})
	emit(Event{Type: EventDone, Message: "feedback applied"})
	return nil
}

func (*ClaudeCodeAdapter) Teardown(context.Context) error { return nil }

// runClaudeCLI invokes `claude -p <intent> --permission-mode acceptEdits` in dir,
// streaming combined stdout+stderr line-by-line to onLine.
func runClaudeCLI(ctx context.Context, dir, intent string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, "claude", "-p", intent, "--permission-mode", "acceptEdits")
	if dir != "" {
		cmd.Dir = dir
	}
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			onLine(sc.Text())
		}
		close(done)
	}()
	runErr := cmd.Wait()
	_ = pw.Close()
	<-done
	return runErr
}
```

- [ ] **Step 3:** `go test ./adapter/ -run ClaudeCode` → PASS; `go vet ./...` clean.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/adapter/claude_code.go services/sandbox-runner/adapter/claude_code_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(adapter): real Claude Code adapter (wraps claude CLI)"
```

---

## Task 1: `DefaultRegistry`

**Files:** Create `adapter/default.go`, `adapter/default_test.go`

- [ ] **Step 1: failing test** `adapter/default_test.go`:
```go
package adapter

import "testing"

func TestDefaultRegistry(t *testing.T) {
	r := DefaultRegistry()
	for _, name := range []string{"fake", "claude-code"} {
		f, ok := r.Get(name)
		if !ok {
			t.Fatalf("expected %q registered", name)
		}
		if f().Identify().Name != name {
			t.Fatalf("factory for %q built wrong adapter", name)
		}
	}
}
```

- [ ] **Step 2:** run → FAIL. Then implement `adapter/default.go`:
```go
package adapter

// DefaultRegistry returns the built-in adapter catalog (first-party adapters).
func DefaultRegistry() *Registry {
	r := NewRegistry()
	_ = r.Register("fake", func() Adapter { return NewFakeAdapter() })
	_ = r.Register("claude-code", func() Adapter { return NewClaudeCodeAdapter() })
	return r
}
```

- [ ] **Step 3:** run → PASS; vet clean.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/adapter/default.go services/sandbox-runner/adapter/default_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(adapter): DefaultRegistry (fake + claude-code)"
```

---

## Task 2: Runner selects the adapter by name (`RunRequest.Adapter`)

**Files:** Modify `internal/sandbox/run.go`, `internal/sandbox/http.go`, `internal/sandbox/http_test.go`

- [ ] **Step 1: Add an `Adapter` field to `RunRequest` in `run.go`**:
```ts
// (Go) inside the RunRequest struct, after Branch:
	Adapter    string `json:"adapter"`
```

- [ ] **Step 2: Resolve the agent from the registry in `http.go`** — replace the hardcoded `FakeAgent{}` in the handler. Add imports `"github.com/gagan114662/agent-chat-platform/sandbox-runner/adapter"`. After `req.WorkDir = ...` and before `Run(...)`:
```go
		name := req.Adapter
		if name == "" {
			name = "fake"
		}
		factory, ok := adapter.DefaultRegistry().Get(name)
		if !ok {
			http.Error(w, "unknown adapter: "+name, http.StatusBadRequest)
			return
		}
		ad := factory()
		if err := ad.Prepare(r.Context(), adapter.PrepareContext{RepoDir: req.WorkDir, Intent: req.Intent}); err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusBadRequest)
			return
		}
		var ag Agent = adapter.AsAgent(ad)

		res, err := Run(r.Context(), req, ag)
```
(`adapter.AsAgent(ad)` returns `interface{ Apply(string,string) error }`, which is assignable to `Agent`. Remove the old `Run(r.Context(), req, FakeAgent{})` line.)

- [ ] **Step 3: Add a test to `http_test.go`** — default adapter still works; unknown adapter 400s:
```go
func TestHandleRunUnknownAdapter(t *testing.T) {
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
```
(The existing `TestHandleRun` sends no `adapter` → defaults to `"fake"` → still works. `makeBareRepoWithCommit` + `file://` are already used by `TestHandleRun`.)

- [ ] **Step 4:** `cd services/sandbox-runner && go build ./... && go vet ./... && go test ./...` → all green (the fake-default path keeps every existing test passing; the new unknown-adapter test is 400).
- [ ] **Step 5:** commit:
```bash
git add services/sandbox-runner/internal/sandbox/run.go services/sandbox-runner/internal/sandbox/http.go services/sandbox-runner/internal/sandbox/http_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(sandbox): select agent adapter by name (default fake) via registry"
```

---

## Self-Review
- Coverage: real Claude Code adapter (T0), default registry (T1), registry-driven selection in the runner (T2). The `claude` CLI uses the host's subscription auth (works when the runner runs where the user is logged in; injecting creds into a cloud sandbox is the standing-secrets follow-up).
- Backward-compat: `RunRequest.Adapter` defaults to `"fake"` → existing http/run tests unchanged; `Run` still takes an `Agent`. The adapter's CLI exec is injected in tests, so `claude` is never invoked in CI.
- Note: the orchestrator/app don't yet send an `adapter` field (still fake by default). Passing `adapter:"claude-code"` end-to-end from chat (a per-agent `adapter` config on the `Agent` row → into the sandbox request) is a small app follow-up.

## Definition of Done (7)
`go build ./... && go vet ./... && go test ./...` green incl. the new adapter + selection tests. A `/run` with `{"adapter":"claude-code", ...}` runs real Claude Code in the sandbox (verified by a live demo against the throwaway fixture repo, separate from CI). Default remains `fake`.
