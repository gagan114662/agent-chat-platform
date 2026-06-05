package mcpproxy

import (
	"context"
	"errors"
	"testing"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/paymentgate"
)

type fakeUp struct{ called bool }

func (f *fakeUp) Forward(_ context.Context, raw []byte) ([]byte, error) {
	f.called = true
	return append([]byte("ok:"), raw...), nil
}

type fakeApprover struct {
	approve bool
	calls   int
	last    ApprovalRequest
}

func (a *fakeApprover) RequestApproval(_ context.Context, r ApprovalRequest) (bool, error) {
	a.calls++
	a.last = r
	return a.approve, nil
}

func newProxy(approve bool) (*Proxy, *fakeUp, *fakeApprover) {
	up := &fakeUp{}
	ap := &fakeApprover{approve: approve}
	return &Proxy{Policy: paymentgate.DefaultPolicy(), Up: up, Approver: ap}, up, ap
}

func TestNonFinancialForwardsWithoutAsking(t *testing.T) {
	p, up, ap := newProxy(false)
	if _, err := p.Handle(context.Background(), paymentgate.Call{Tool: "fs.read"}, "", []byte("x")); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !up.called {
		t.Fatal("non-financial call must forward")
	}
	if ap.calls != 0 {
		t.Fatal("non-financial call must NOT ask a human")
	}
}

func TestFinancialApprovedForwardsOriginalPayload(t *testing.T) {
	p, up, ap := newProxy(true)
	out, err := p.Handle(context.Background(), paymentgate.Call{Tool: "wallet.transfer", AmountCents: 5000, Recipient: "acct_x"}, "pay the invoice", []byte("PAYLOAD"))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if ap.calls != 1 {
		t.Fatal("financial call must ask a human")
	}
	if ap.last.AmountCents != 5000 || ap.last.Recipient != "acct_x" || ap.last.Justification != "pay the invoice" {
		t.Fatalf("approval card missing context: %+v", ap.last)
	}
	if !up.called || string(out) != "ok:PAYLOAD" {
		t.Fatalf("approved call must forward the ORIGINAL payload, got %q", out)
	}
}

func TestFinancialDeclinedDoesNotForward(t *testing.T) {
	p, up, _ := newProxy(false)
	_, err := p.Handle(context.Background(), paymentgate.Call{Tool: "wallet.transfer", AmountCents: 5000}, "", []byte("x"))
	if !errors.Is(err, ErrDeclined) {
		t.Fatalf("want ErrDeclined, got %v", err)
	}
	if up.called {
		t.Fatal("declined call must NOT forward")
	}
}

func TestSanctionedHardDeniedNeverAsksOrForwards(t *testing.T) {
	p, up, ap := newProxy(true)
	p.Policy.SanctionedRecipients = []string{"acct_evil"}
	_, err := p.Handle(context.Background(), paymentgate.Call{Tool: "wallet.transfer", AmountCents: 1, Recipient: "acct_evil"}, "", []byte("x"))
	if !errors.Is(err, ErrDenied) {
		t.Fatalf("want ErrDenied, got %v", err)
	}
	if up.called || ap.calls != 0 {
		t.Fatal("hard-deny must neither ask a human nor forward")
	}
}

func TestUnderThresholdAutoForwards(t *testing.T) {
	p, up, ap := newProxy(false)
	p.Policy.AutoApproveUnderCents = 1000
	if _, err := p.Handle(context.Background(), paymentgate.Call{Tool: "stripe.charge", AmountCents: 500}, "", []byte("x")); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !up.called {
		t.Fatal("under-threshold financial call should auto-forward")
	}
	if ap.calls != 0 {
		t.Fatal("under-threshold call must not ask a human")
	}
}
