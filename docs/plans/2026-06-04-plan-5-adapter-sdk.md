# Plan 5 — Open Adapter SDK + Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** Implements the spec §7 adapter contract as a publishable Go package `sandbox-runner/adapter` (agents run in the sandbox, Go side). Defines `Adapter` (identify / prepare / run-with-typed-event-stream / apply_feedback / teardown), the typed `Event` stream, capability negotiation, a `Registry`, a `FakeAdapter` reference implementation, and an `AsAgent` bridge so an Adapter structurally satisfies the existing simple `sandbox.Agent` (`Apply`). Additive — the existing `Agent`/`FakeAgent` and `Run` are untouched; wiring `Run` to resolve adapters from the registry is a follow-up.

**Tech Stack:** Go 1.25. Branch `plan-5-adapter-sdk` (off `main`). New package `services/sandbox-runner/adapter`. Tests: `cd services/sandbox-runner && go test ./...`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Adapter contract + capability negotiation

**Files:** Create `services/sandbox-runner/adapter/adapter.go`, `adapter/adapter_test.go`

- [ ] **Step 1: failing test** `adapter/adapter_test.go`:
```go
package adapter

import "testing"

func TestNegotiate(t *testing.T) {
	id := Identity{Name: "x", Version: "1.0.0", Capabilities: []Capability{CanEditCode}}
	if err := Negotiate(id, []Capability{CanEditCode}); err != nil {
		t.Fatalf("expected ok: %v", err)
	}
	if err := Negotiate(id, []Capability{CanRunTests}); err == nil {
		t.Fatal("expected missing-capability error")
	}
}
```

- [ ] **Step 2:** `cd services/sandbox-runner && go test ./adapter/ -run TestNegotiate` → FAIL (no package). Then implement `adapter/adapter.go`:
```go
// Package adapter is the open SDK every agent implements to run in a sandbox.
// Contract per the design spec §7. Published so third parties can ship agents.
package adapter

import (
	"context"
	"fmt"
)

type Capability string

const (
	CanEditCode Capability = "can_edit_code"
	CanRunTests Capability = "can_run_tests"
	CanOpenPR   Capability = "can_open_pr"
)

// Identity describes an adapter for capability negotiation + versioning (semver).
type Identity struct {
	Name         string
	Version      string
	Capabilities []Capability
}

func (id Identity) Has(c Capability) bool {
	for _, x := range id.Capabilities {
		if x == c {
			return true
		}
	}
	return false
}

// Negotiate returns an error if the adapter lacks any required capability.
func Negotiate(id Identity, required []Capability) error {
	for _, r := range required {
		if !id.Has(r) {
			return fmt.Errorf("adapter %q missing capability %q", id.Name, r)
		}
	}
	return nil
}

// EventType is the kind of a streamed run event.
type EventType string

const (
	EventLog         EventType = "log"
	EventProgress    EventType = "progress"
	EventFileChanged EventType = "file_changed"
	EventNeedsInput  EventType = "needs_input"
	EventConfidence  EventType = "confidence"
	EventDone        EventType = "done"
)

// Event is one typed item in an adapter's run stream (one shape, many agents).
type Event struct {
	Type    EventType
	Message string  // log line / needs_input prompt / done summary
	Step    string  // progress step name
	Pct     int     // progress percent
	Path    string  // file_changed path
	Score   float64 // confidence score 0..1
}

// Emit is how an adapter pushes events during Run/ApplyFeedback.
type Emit func(Event)

// PrepareContext is passed to Prepare (install/auth the underlying CLI).
type PrepareContext struct {
	RepoDir string
	Intent  string
	Env     map[string]string
}

// Adapter is the contract every agent implements. Real adapters (Claude Code,
// Codex, Gemini, Aider) and protocol bridges implement this on the same SDK.
type Adapter interface {
	Identify() Identity
	Prepare(ctx context.Context, p PrepareContext) error
	Run(ctx context.Context, repoDir, intent string, emit Emit) error
	ApplyFeedback(ctx context.Context, notes string, emit Emit) error
	Teardown(ctx context.Context) error
}
```

- [ ] **Step 3:** `go test ./adapter/` → PASS; `go vet ./...` clean.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/adapter/adapter.go services/sandbox-runner/adapter/adapter_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(adapter): SDK contract (Adapter, Event stream, capability negotiation)"
```

---

## Task 1: Registry

**Files:** Create `adapter/registry.go`, `adapter/registry_test.go`

- [ ] **Step 1: failing test** `adapter/registry_test.go`:
```go
package adapter

import (
	"context"
	"testing"
)

type stubAdapter struct{}

func (stubAdapter) Identify() Identity { return Identity{Name: "stub", Version: "0.0.1"} }
func (stubAdapter) Prepare(context.Context, PrepareContext) error { return nil }
func (stubAdapter) Run(context.Context, string, string, Emit) error { return nil }
func (stubAdapter) ApplyFeedback(context.Context, string, Emit) error { return nil }
func (stubAdapter) Teardown(context.Context) error { return nil }

func TestRegistry(t *testing.T) {
	r := NewRegistry()
	if err := r.Register("stub", func() Adapter { return stubAdapter{} }); err != nil {
		t.Fatal(err)
	}
	if err := r.Register("stub", func() Adapter { return stubAdapter{} }); err == nil {
		t.Fatal("expected duplicate-registration error")
	}
	f, ok := r.Get("stub")
	if !ok {
		t.Fatal("expected to find stub")
	}
	if f().Identify().Name != "stub" {
		t.Fatal("factory built wrong adapter")
	}
	if _, ok := r.Get("missing"); ok {
		t.Fatal("unexpected hit")
	}
	if len(r.List()) != 1 || r.List()[0] != "stub" {
		t.Fatalf("unexpected list: %v", r.List())
	}
}
```

- [ ] **Step 2:** run → FAIL. Then implement `adapter/registry.go`:
```go
package adapter

import (
	"fmt"
	"sort"
	"sync"
)

// Factory builds a fresh Adapter instance.
type Factory func() Adapter

// Registry maps adapter names to factories (the published catalog).
type Registry struct {
	mu sync.RWMutex
	m  map[string]Factory
}

func NewRegistry() *Registry { return &Registry{m: map[string]Factory{}} }

func (r *Registry) Register(name string, f Factory) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.m[name]; exists {
		return fmt.Errorf("adapter %q already registered", name)
	}
	r.m[name] = f
	return nil
}

func (r *Registry) Get(name string) (Factory, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	f, ok := r.m[name]
	return f, ok
}

func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.m))
	for n := range r.m {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
```

- [ ] **Step 3:** run → PASS; vet clean.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/adapter/registry.go services/sandbox-runner/adapter/registry_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(adapter): adapter registry"
```

---

## Task 2: `FakeAdapter` reference implementation

**Files:** Create `adapter/fake.go`, `adapter/fake_test.go`

- [ ] **Step 1: failing test** `adapter/fake_test.go`:
```go
package adapter

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFakeAdapter(t *testing.T) {
	a := NewFakeAdapter()
	id := a.Identify()
	if id.Name != "fake" || !id.Has(CanEditCode) {
		t.Fatalf("bad identity: %+v", id)
	}
	dir := t.TempDir()
	var events []EventType
	err := a.Run(context.Background(), dir, "add a greeting", func(e Event) { events = append(events, e.Type) })
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "AGENT_CHANGES.md"))
	if err != nil || !strings.Contains(string(b), "add a greeting") {
		t.Fatalf("expected change file with intent, got %q err %v", b, err)
	}
	// emits at least a file_changed and a done
	var hasFile, hasDone bool
	for _, e := range events {
		hasFile = hasFile || e == EventFileChanged
		hasDone = hasDone || e == EventDone
	}
	if !hasFile || !hasDone {
		t.Fatalf("expected file_changed + done events, got %v", events)
	}
}
```

- [ ] **Step 2:** run → FAIL. Then implement `adapter/fake.go`:
```go
package adapter

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// FakeAdapter is the deterministic reference implementation on the SDK,
// mirroring sandbox.FakeAgent but emitting the full typed event stream.
type FakeAdapter struct{}

func NewFakeAdapter() *FakeAdapter { return &FakeAdapter{} }

func (*FakeAdapter) Identify() Identity {
	return Identity{Name: "fake", Version: "0.1.0", Capabilities: []Capability{CanEditCode}}
}

func (*FakeAdapter) Prepare(context.Context, PrepareContext) error { return nil }

func (*FakeAdapter) Run(ctx context.Context, repoDir, intent string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "starting fake adapter"})
	emit(Event{Type: EventProgress, Step: "edit", Pct: 50})
	p := filepath.Join(repoDir, "AGENT_CHANGES.md")
	content := fmt.Sprintf("# Agent change\n\nIntent: %s\n", intent)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		return err
	}
	emit(Event{Type: EventFileChanged, Path: "AGENT_CHANGES.md"})
	emit(Event{Type: EventConfidence, Score: 1.0})
	emit(Event{Type: EventDone, Message: "applied: " + intent})
	return nil
}

func (*FakeAdapter) ApplyFeedback(ctx context.Context, notes string, emit Emit) error {
	emit(Event{Type: EventLog, Message: "applying feedback: " + notes})
	emit(Event{Type: EventDone, Message: "feedback applied"})
	return nil
}

func (*FakeAdapter) Teardown(context.Context) error { return nil }
```

- [ ] **Step 3:** run → PASS; vet clean.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/adapter/fake.go services/sandbox-runner/adapter/fake_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(adapter): FakeAdapter reference implementation"
```

---

## Task 3: `AsAgent` bridge (adapter → existing simple Agent)

**Files:** Create `adapter/bridge.go`, `adapter/bridge_test.go`

The existing sandbox `Agent` is `interface { Apply(repoDir, intent string) error }`. Go interfaces are structural, so a bridge type with that method satisfies it without importing the sandbox package (no cycle).

- [ ] **Step 1: failing test** `adapter/bridge_test.go`:
```go
package adapter

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// localAgent mirrors sandbox.Agent's method set (structural typing).
type localAgent interface{ Apply(repoDir, intent string) error }

func TestAsAgent(t *testing.T) {
	var ag localAgent = AsAgent(NewFakeAdapter())
	dir := t.TempDir()
	if err := ag.Apply(dir, "bridge it"); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "AGENT_CHANGES.md"))
	if err != nil || !strings.Contains(string(b), "bridge it") {
		t.Fatalf("bridge did not apply: %q err %v", b, err)
	}
}
```

- [ ] **Step 2:** run → FAIL. Then implement `adapter/bridge.go`:
```go
package adapter

import "context"

// agentBridge adapts an Adapter to the legacy simple Agent contract
// (Apply(repoDir, intent) error) by running it and discarding the event stream.
type agentBridge struct{ a Adapter }

func (b agentBridge) Apply(repoDir, intent string) error {
	return b.a.Run(context.Background(), repoDir, intent, func(Event) {})
}

// AsAgent wraps an Adapter so it structurally satisfies sandbox.Agent.
// Lets any SDK adapter drop into the existing Run() loop.
func AsAgent(a Adapter) interface{ Apply(repoDir, intent string) error } {
	return agentBridge{a}
}
```

- [ ] **Step 3:** `go build ./... && go vet ./... && go test ./...` → all green.
- [ ] **Step 4:** commit:
```bash
git add services/sandbox-runner/adapter/bridge.go services/sandbox-runner/adapter/bridge_test.go
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(adapter): AsAgent bridge to the existing Agent contract"
```

---

## Self-Review
- Coverage of spec §7: contract (identify/prepare/run+stream/apply_feedback/teardown) T0; capability negotiation + semver `Version` T0; registry T1; reference adapter T2; bridge to the running loop T3. ✅
- Additive: the existing `sandbox.Agent`/`FakeAgent`/`Run` are untouched; the SDK is a new package. Wiring `Run` to look up adapters by name from the registry (and streaming events into the thread) is a documented follow-up.
- Note: real first-party adapters (Claude Code, Codex, Gemini, Aider) wrap external CLIs — they belong in their own packages on this SDK and need those CLIs present; out of scope here. The contract + registry + reference + bridge are the publishable core.

## Definition of Done (5)
`go build ./... && go vet ./... && go test ./...` green, including the new `adapter` package (contract, registry, FakeAdapter, bridge). The SDK is publishable and the FakeAdapter proves the contract end to end; real CLI-wrapping adapters and registry-driven `Run` selection are follow-ups.
