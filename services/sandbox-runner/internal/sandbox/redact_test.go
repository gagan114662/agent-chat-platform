package sandbox

import (
	"strings"
	"testing"
)

func TestRedactCreds(t *testing.T) {
	in := "git clone https://x-access-token:ghp_SECRET@github.com/o/r.git failed"
	out := redactCreds(in)
	if strings.Contains(out, "ghp_SECRET") {
		t.Fatalf("token leaked: %q", out)
	}
	if !strings.Contains(out, "https://[redacted]@github.com/o/r.git") {
		t.Fatalf("expected redacted url, got %q", out)
	}
	// non-URL text is untouched
	if redactCreds("plain error") != "plain error" {
		t.Fatal("plain text changed")
	}
}
