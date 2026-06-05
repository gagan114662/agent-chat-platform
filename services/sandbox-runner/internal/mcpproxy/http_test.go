package mcpproxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/paymentgate"
)

func TestCallFromMCP_amountForms(t *testing.T) {
	c, j := CallFromMCP(map[string]any{"name": "wallet.transfer", "arguments": map[string]any{"amount_cents": float64(2500), "recipient": "acct_a", "justification": "rent"}})
	if c.Tool != "wallet.transfer" || c.AmountCents != 2500 || c.Recipient != "acct_a" || j != "rent" {
		t.Fatalf("amount_cents parse: %+v %q", c, j)
	}
	c2, _ := CallFromMCP(map[string]any{"name": "stripe.charge", "arguments": map[string]any{"amount": float64(12.34)}})
	if c2.AmountCents != 1234 {
		t.Fatalf("major-units parse want 1234 got %d", c2.AmountCents)
	}
}

func TestHandler_nonToolsCallForwards(t *testing.T) {
	up := &fakeUp{}
	p := &Proxy{Policy: paymentgate.DefaultPolicy(), Up: up, Approver: &fakeApprover{}}
	rr := httptest.NewRecorder()
	p.Handler().ServeHTTP(rr, httptest.NewRequest("POST", "/", strings.NewReader(`{"method":"tools/list"}`)))
	if rr.Code != http.StatusOK || !up.called {
		t.Fatalf("tools/list must forward; code=%d called=%v", rr.Code, up.called)
	}
}

func TestHandler_financialHeldThenApprovedForwards(t *testing.T) {
	up := &fakeUp{}
	ap := &fakeApprover{approve: true}
	p := &Proxy{Policy: paymentgate.DefaultPolicy(), Up: up, Approver: ap}
	body := `{"method":"tools/call","params":{"name":"wallet.transfer","arguments":{"amount_cents":5000,"recipient":"acct_a"}}}`
	rr := httptest.NewRecorder()
	p.Handler().ServeHTTP(rr, httptest.NewRequest("POST", "/", strings.NewReader(body)))
	if rr.Code != http.StatusOK {
		t.Fatalf("approved call should 200, got %d", rr.Code)
	}
	if ap.calls != 1 || !up.called {
		t.Fatalf("should ask human then forward; asked=%d forwarded=%v", ap.calls, up.called)
	}
}

func TestHandler_deniedReturns403AndNeverForwards(t *testing.T) {
	up := &fakeUp{}
	pol := paymentgate.DefaultPolicy()
	pol.SanctionedRecipients = []string{"acct_evil"}
	p := &Proxy{Policy: pol, Up: up, Approver: &fakeApprover{approve: true}}
	body := `{"method":"tools/call","params":{"name":"wallet.transfer","arguments":{"amount_cents":1,"recipient":"acct_evil"}}}`
	rr := httptest.NewRecorder()
	p.Handler().ServeHTTP(rr, httptest.NewRequest("POST", "/", strings.NewReader(body)))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("sanctioned should 403, got %d", rr.Code)
	}
	if up.called {
		t.Fatal("denied call must not forward")
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if _, ok := resp["error"]; !ok {
		t.Fatal("denied response should carry an error")
	}
}
