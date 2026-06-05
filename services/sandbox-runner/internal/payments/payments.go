// Package payments is the agentic payment-rails layer (#113) — ALWAYS behind the
// money gate (#110). Agents never touch a Provider directly; they go through a
// GatedProvider, so every fund-moving op is classified by paymentgate and either
// auto-approved (under threshold), held for a human, or hard-denied BEFORE the
// underlying provider is called. MockProvider is the deterministic in-memory rail
// for dev/tests (no real money). A real stablecoin-L2 / card-issuer provider
// implements the same interface with the operator's own custody/issuer keys.
package payments

import (
	"context"
	"fmt"
	"strconv"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/paymentgate"
)

type Card struct {
	ID              string
	Last4           string
	SpendLimitCents int64
}

type Transfer struct {
	ID          string
	Recipient   string
	AmountCents int64
}

// Provider is the rail. Implemented by MockProvider (dev) and, later, a real
// custody/issuer-backed provider supplied with the operator's keys.
type Provider interface {
	IssueVirtualCard(ctx context.Context, spendLimitCents int64) (Card, error)
	Transfer(ctx context.Context, recipient string, amountCents int64) (Transfer, error)
	BalanceCents(ctx context.Context) (int64, error)
}

// MockProvider: deterministic, in-memory, no real funds. Starts with a balance.
type MockProvider struct {
	balance int64
	seq     int
	Cards   []Card
	Txns    []Transfer
}

func NewMockProvider(openingBalanceCents int64) *MockProvider {
	return &MockProvider{balance: openingBalanceCents}
}

func (m *MockProvider) next(prefix string) string {
	m.seq++
	return prefix + "_" + strconv.Itoa(m.seq)
}

func (m *MockProvider) IssueVirtualCard(_ context.Context, spendLimitCents int64) (Card, error) {
	c := Card{ID: m.next("card"), Last4: "4242", SpendLimitCents: spendLimitCents}
	m.Cards = append(m.Cards, c)
	return c, nil
}

func (m *MockProvider) Transfer(_ context.Context, recipient string, amountCents int64) (Transfer, error) {
	if amountCents <= 0 {
		return Transfer{}, fmt.Errorf("amount must be positive")
	}
	if amountCents > m.balance {
		return Transfer{}, fmt.Errorf("insufficient balance")
	}
	m.balance -= amountCents
	t := Transfer{ID: m.next("txn"), Recipient: recipient, AmountCents: amountCents}
	m.Txns = append(m.Txns, t)
	return t, nil
}

func (m *MockProvider) BalanceCents(_ context.Context) (int64, error) { return m.balance, nil }

// Approve suspends a held money op for a human. true = proceed. Wired to the
// app's held_for_human approval (same path mcpproxy uses).
type Approve func(ctx context.Context, call paymentgate.Call) (bool, error)

// GatedProvider enforces the money gate in front of any Provider. Read-only ops
// (BalanceCents) pass through; fund-moving ops are gated.
type GatedProvider struct {
	Inner   Provider
	Policy  paymentgate.Policy
	Approve Approve
}

// gate runs the decision for a money call and returns nil only if the op may proceed.
func (g *GatedProvider) gate(ctx context.Context, call paymentgate.Call) error {
	switch d, reason := g.Policy.Decide(call); d {
	case paymentgate.Deny:
		return fmt.Errorf("payment denied: %s", reason)
	case paymentgate.Hold:
		if g.Approve == nil {
			return fmt.Errorf("payment requires human approval but no approver is configured")
		}
		ok, err := g.Approve(ctx, call)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("payment declined by human")
		}
		return nil
	default:
		return nil // Pass
	}
}

func (g *GatedProvider) Transfer(ctx context.Context, recipient string, amountCents int64) (Transfer, error) {
	if err := g.gate(ctx, paymentgate.Call{Tool: "payments.transfer", AmountCents: amountCents, Recipient: recipient}); err != nil {
		return Transfer{}, err
	}
	return g.Inner.Transfer(ctx, recipient, amountCents)
}

func (g *GatedProvider) IssueVirtualCard(ctx context.Context, spendLimitCents int64) (Card, error) {
	if err := g.gate(ctx, paymentgate.Call{Tool: "payments.issue_card", AmountCents: spendLimitCents}); err != nil {
		return Card{}, err
	}
	return g.Inner.IssueVirtualCard(ctx, spendLimitCents)
}

func (g *GatedProvider) BalanceCents(ctx context.Context) (int64, error) {
	return g.Inner.BalanceCents(ctx) // read-only, not gated
}
