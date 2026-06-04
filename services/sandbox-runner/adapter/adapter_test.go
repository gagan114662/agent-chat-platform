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
