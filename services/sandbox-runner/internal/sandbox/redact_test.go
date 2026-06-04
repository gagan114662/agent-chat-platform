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

func TestRedactBareTokens(t *testing.T) {
	cases := []struct {
		name, in, leak string
	}{
		{"ghp", "token ghp_ABCDEFghij0123456789 here", "ghp_ABCDEFghij0123456789"},
		{"github_pat", "pat github_pat_11ABCDE_xyz789 here", "github_pat_11ABCDE_xyz789"},
		{"bearer", "Authorization: Bearer eyJhbGci.abc-123 done", "eyJhbGci.abc-123"},
		{"bearer-jwt", "Authorization: Bearer eyJhbGci.payload+sig/x== done", "eyJhbGci"},
		{"token-jwt", "Authorization: token abc.def-ghi done", "abc.def-ghi"},
		{"x-access-token", "x-access-token:ghp_SECRETvalue done", "ghp_SECRETvalue"},
		{"aws", "key AKIAIOSFODNN7EXAMPLE done", "AKIAIOSFODNN7EXAMPLE"},
	}
	for _, c := range cases {
		out := redactCreds(c.in)
		if strings.Contains(out, c.leak) {
			t.Fatalf("%s: token leaked: %q", c.name, out)
		}
		if !strings.Contains(out, "[redacted]") {
			t.Fatalf("%s: expected [redacted] marker, got %q", c.name, out)
		}
	}
}
