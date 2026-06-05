package paymentgate

import "testing"

func TestNonFinancialPassesThrough(t *testing.T) {
	p := DefaultPolicy()
	for _, tool := range []string{"chat.post", "fs.read", "git.commit", "deploy.run", "memory.search"} {
		if d, _ := p.Decide(Call{Tool: tool}); d != Pass {
			t.Fatalf("%s: want Pass, got %s", tool, d)
		}
	}
}

func TestFinancialHoldsForHumanByDefault(t *testing.T) {
	p := DefaultPolicy()
	for _, tool := range []string{"stripe.create_checkout_session", "wallet.transfer", "cards.issue_card", "bank.wire", "payments.payment_intent.create"} {
		if d, why := p.Decide(Call{Tool: tool, AmountCents: 5000}); d != Hold {
			t.Fatalf("%s: want Hold, got %s (%s)", tool, d, why)
		}
	}
}

func TestSanctionedRecipientHardDenied(t *testing.T) {
	p := DefaultPolicy()
	p.SanctionedRecipients = []string{"acct_evil", "OFAC-LISTED"}
	if d, _ := p.Decide(Call{Tool: "wallet.transfer", AmountCents: 100, Recipient: "acct_evil"}); d != Deny {
		t.Fatalf("sanctioned recipient must be Deny, got %s", d)
	}
	// Case-insensitive + trimmed.
	if d, _ := p.Decide(Call{Tool: "wallet.transfer", Recipient: " ofac-listed "}); d != Deny {
		t.Fatalf("sanctioned match must be case-insensitive/trimmed, got %s", d)
	}
}

func TestAutoApproveUnderThreshold(t *testing.T) {
	p := DefaultPolicy()
	p.AutoApproveUnderCents = 1000 // under $10 auto-approves
	if d, _ := p.Decide(Call{Tool: "stripe.charge", AmountCents: 500}); d != Pass {
		t.Fatalf("under-threshold financial should Pass, got %s", d)
	}
	if d, _ := p.Decide(Call{Tool: "stripe.charge", AmountCents: 1000}); d != Hold {
		t.Fatalf("at-threshold financial should Hold (not strictly under), got %s", d)
	}
	if d, _ := p.Decide(Call{Tool: "stripe.charge", AmountCents: 5000}); d != Hold {
		t.Fatalf("over-threshold financial should Hold, got %s", d)
	}
	// Sanctioned recipient is denied even under the threshold.
	p.SanctionedRecipients = []string{"acct_evil"}
	if d, _ := p.Decide(Call{Tool: "stripe.charge", AmountCents: 1, Recipient: "acct_evil"}); d != Deny {
		t.Fatalf("sanctioned beats threshold; want Deny, got %s", d)
	}
}

func TestFinancialWithNoAmountHolds(t *testing.T) {
	p := DefaultPolicy()
	p.AutoApproveUnderCents = 1000
	// Unknown amount on a financial call must NOT auto-approve.
	if d, _ := p.Decide(Call{Tool: "payouts.disburse"}); d != Hold {
		t.Fatalf("financial call with unknown amount must Hold, got %s", d)
	}
}
