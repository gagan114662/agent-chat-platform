package payments

import (
	"context"
	"testing"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/paymentgate"
)

func ctx() context.Context { return context.Background() }

func TestMockProviderTransfersAndIssuesCards(t *testing.T) {
	m := NewMockProvider(10000)
	c, _ := m.IssueVirtualCard(ctx(), 5000)
	if c.ID == "" || c.SpendLimitCents != 5000 {
		t.Fatalf("bad card: %+v", c)
	}
	tx, err := m.Transfer(ctx(), "acct_x", 3000)
	if err != nil || tx.AmountCents != 3000 {
		t.Fatalf("transfer: %+v %v", tx, err)
	}
	if b, _ := m.BalanceCents(ctx()); b != 7000 {
		t.Fatalf("balance want 7000 got %d", b)
	}
	if _, err := m.Transfer(ctx(), "acct_x", 999999); err == nil {
		t.Fatal("over-balance transfer must error")
	}
}

func TestGatedTransferHeldRequiresApproval(t *testing.T) {
	m := NewMockProvider(10000)
	asked := 0
	g := &GatedProvider{Inner: m, Policy: paymentgate.DefaultPolicy(), Approve: func(_ context.Context, _ paymentgate.Call) (bool, error) { asked++; return true, nil }}
	tx, err := g.Transfer(ctx(), "acct_x", 3000)
	if err != nil || tx.AmountCents != 3000 {
		t.Fatalf("approved transfer should proceed: %+v %v", tx, err)
	}
	if asked != 1 {
		t.Fatal("a held transfer must ask a human")
	}
	if b, _ := m.BalanceCents(ctx()); b != 7000 {
		t.Fatalf("balance not debited: %d", b)
	}
}

func TestGatedTransferDeclinedDoesNotMove(t *testing.T) {
	m := NewMockProvider(10000)
	g := &GatedProvider{Inner: m, Policy: paymentgate.DefaultPolicy(), Approve: func(_ context.Context, _ paymentgate.Call) (bool, error) { return false, nil }}
	if _, err := g.Transfer(ctx(), "acct_x", 3000); err == nil {
		t.Fatal("declined transfer must error")
	}
	if b, _ := m.BalanceCents(ctx()); b != 10000 {
		t.Fatalf("declined transfer must not move funds, balance=%d", b)
	}
}

func TestGatedSanctionedRecipientDenied(t *testing.T) {
	m := NewMockProvider(10000)
	pol := paymentgate.DefaultPolicy()
	pol.SanctionedRecipients = []string{"acct_evil"}
	asked := 0
	g := &GatedProvider{Inner: m, Policy: pol, Approve: func(_ context.Context, _ paymentgate.Call) (bool, error) { asked++; return true, nil }}
	if _, err := g.Transfer(ctx(), "acct_evil", 100); err == nil {
		t.Fatal("sanctioned recipient must be denied")
	}
	if asked != 0 {
		t.Fatal("hard-deny must not ask a human")
	}
	if b, _ := m.BalanceCents(ctx()); b != 10000 {
		t.Fatal("denied transfer must not move funds")
	}
}

func TestGatedUnderThresholdAutoProceeds(t *testing.T) {
	m := NewMockProvider(10000)
	pol := paymentgate.DefaultPolicy()
	pol.AutoApproveUnderCents = 5000
	asked := 0
	g := &GatedProvider{Inner: m, Policy: pol, Approve: func(_ context.Context, _ paymentgate.Call) (bool, error) { asked++; return true, nil }}
	if _, err := g.Transfer(ctx(), "acct_x", 1000); err != nil {
		t.Fatalf("under-threshold transfer should auto-proceed: %v", err)
	}
	if asked != 0 {
		t.Fatal("under-threshold must not ask a human")
	}
}
