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
	// Plan produces a read-only plan for the intent WITHOUT editing files.
	Plan(ctx context.Context, repoDir, intent string) (string, error)
	ApplyFeedback(ctx context.Context, notes string, emit Emit) error
	Teardown(ctx context.Context) error
}
