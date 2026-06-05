// Package mcpproxy is the enforcement layer of the money-only human gate (#110).
// It sits between agents and tools: every tool call is classified by paymentgate
// and the verdict is enforced ON THE WIRE — Pass forwards to the upstream tool,
// Hold suspends and asks a human (the agent thread blocks on the call, it is NOT
// failed), Deny is rejected and never forwarded. This is deterministic: the agent
// cannot talk its way past it, because the proxy — not the model — decides.
package mcpproxy

import (
	"context"
	"errors"
	"fmt"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/paymentgate"
)

// Upstream forwards an approved call's original payload to the real tool and
// returns its raw result. Implemented by the actual MCP transport.
type Upstream interface {
	Forward(ctx context.Context, raw []byte) ([]byte, error)
}

// ApprovalRequest is what a human sees on the Approve/Decline card.
type ApprovalRequest struct {
	Tool          string
	AmountCents   int64
	Recipient     string
	Justification string
	Reason        string // the gate's reason (e.g. "over the auto-approve threshold")
}

// Approver suspends the call and asks a human. Returns true on approve, false on
// decline. Wired to the app's held_for_human approval flow; the JSON-RPC call
// stays open until this returns.
type Approver interface {
	RequestApproval(ctx context.Context, req ApprovalRequest) (bool, error)
}

// ErrDenied / ErrDeclined are returned (never forwarded) for hard-deny and
// human-declined calls respectively.
var (
	ErrDenied   = errors.New("payment gate: hard-denied")
	ErrDeclined = errors.New("payment gate: declined by human")
)

type Proxy struct {
	Policy   paymentgate.Policy
	Up       Upstream
	Approver Approver
}

// Handle enforces the gate for a single tool call. `call` is the classified
// invocation (tool + parsed amount/recipient), `justification` is the agent's
// stated reason, and `raw` is the original payload forwarded verbatim on approve.
func (p *Proxy) Handle(ctx context.Context, call paymentgate.Call, justification string, raw []byte) ([]byte, error) {
	decision, reason := p.Policy.Decide(call)
	switch decision {
	case paymentgate.Deny:
		return nil, fmt.Errorf("%w: %s", ErrDenied, reason)
	case paymentgate.Hold:
		if p.Approver == nil {
			return nil, fmt.Errorf("%w: no approver configured", ErrDeclined)
		}
		approved, err := p.Approver.RequestApproval(ctx, ApprovalRequest{
			Tool: call.Tool, AmountCents: call.AmountCents, Recipient: call.Recipient,
			Justification: justification, Reason: reason,
		})
		if err != nil {
			return nil, err
		}
		if !approved {
			return nil, ErrDeclined
		}
		// Approved: forward the ORIGINAL payload; the agent resumes unaware.
		return p.Up.Forward(ctx, raw)
	default: // Pass — non-financial or under the auto-approve threshold.
		return p.Up.Forward(ctx, raw)
	}
}
