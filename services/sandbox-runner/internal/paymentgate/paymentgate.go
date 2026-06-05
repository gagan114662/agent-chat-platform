// Package paymentgate is the deterministic decision core of the money-only human
// gate (#110). It does NOT ask the agent/LLM to police itself — an agent can be
// prompt-injected past a "human_as_tool" call. Instead, every tool call routed
// through the MCP proxy is classified here by NAME + parsed args, and the policy
// (loaded from JSON) decides pass / hold-for-human / hard-deny. The proxy layer
// then enforces the verdict on the wire (Pass → forward; Hold → suspend the
// JSON-RPC call + push an Approve/Decline card; Deny → reject), so the gate is
// enforced deterministically regardless of what the model "intends".
package paymentgate

import (
	"strings"
)

type Decision string

const (
	Pass Decision = "pass" // non-financial, or financial under the auto-approve threshold
	Hold Decision = "hold" // financial — suspend and require human approval
	Deny Decision = "deny" // hard-denied (e.g. sanctioned recipient) — never forwarded
)

// Policy is the JSON-configurable gate policy (#110 step 5).
type Policy struct {
	// Financial calls strictly under this many cents auto-approve (Pass). 0 (default)
	// means every financial call requires a human — the safest default.
	AutoApproveUnderCents int64 `json:"autoApproveUnderCents"`
	// Recipients that are always hard-denied (case-insensitive, trimmed).
	SanctionedRecipients []string `json:"sanctionedRecipients"`
	// Lowercased substrings that mark a tool/method as financial. Matched against
	// the tool name (e.g. "stripe.create_checkout_session", "wallet.transfer").
	FinancialPatterns []string `json:"financialPatterns"`
}

// DefaultPolicy: deny-by-human for all money actions (threshold 0), a broad set of
// financial method patterns, and no sanctioned recipients. Override via JSON.
func DefaultPolicy() Policy {
	return Policy{
		AutoApproveUnderCents: 0,
		FinancialPatterns: []string{
			"checkout", "payment", "payout", "transfer", "send_funds", "sendfunds",
			"issue_card", "issuecard", "charge", "refund", "payment_intent",
			"create_session", "wire", "ach", "invoice", "disburse", "withdraw",
		},
	}
}

// Call is a single tool invocation the proxy is about to forward. Amount/Recipient
// are best-effort parsed from the JSON-RPC params by the proxy; 0/"" when absent.
type Call struct {
	Tool        string // fully-qualified tool/method name
	AmountCents int64  // parsed amount in minor units; 0 when none present
	Recipient   string // parsed payee/recipient; "" when none present
}

// IsFinancial reports whether the tool name matches any financial pattern.
func (p Policy) IsFinancial(tool string) bool {
	t := strings.ToLower(tool)
	for _, pat := range p.FinancialPatterns {
		if pat != "" && strings.Contains(t, strings.ToLower(pat)) {
			return true
		}
	}
	return false
}

// Decide returns the deterministic verdict + a human-readable reason.
func (p Policy) Decide(c Call) (Decision, string) {
	if !p.IsFinancial(c.Tool) {
		return Pass, "non-financial call"
	}
	// Hard-deny sanctioned recipients before any threshold logic.
	for _, s := range p.SanctionedRecipients {
		if s != "" && strings.EqualFold(strings.TrimSpace(s), strings.TrimSpace(c.Recipient)) {
			return Deny, "recipient is sanctioned: " + c.Recipient
		}
	}
	// Small, known-amount payments may auto-approve when a positive threshold is set.
	if c.AmountCents > 0 && c.AmountCents < p.AutoApproveUnderCents {
		return Pass, "financial but under the auto-approve threshold"
	}
	return Hold, "financial action requires human approval"
}
