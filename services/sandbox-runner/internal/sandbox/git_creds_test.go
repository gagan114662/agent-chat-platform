package sandbox

import (
	"strings"
	"testing"
)

func TestNewGitCredStripsPassword(t *testing.T) {
	c := newGitCred("https://x-access-token:ghp_secret@github.com/o/r.git")

	if strings.Contains(c.cleanURL, "ghp_secret") {
		t.Fatalf("cleanURL leaks token: %q", c.cleanURL)
	}
	if !strings.Contains(c.cleanURL, "x-access-token@") {
		t.Fatalf("cleanURL should keep the username: %q", c.cleanURL)
	}
	foundToken := false
	for _, e := range c.env {
		if e == "ACP_GIT_TOKEN=ghp_secret" {
			foundToken = true
		}
		if strings.Contains(e, "ghp_secret") && !strings.HasPrefix(e, "ACP_GIT_TOKEN=") {
			t.Fatalf("token leaked outside ACP_GIT_TOKEN env entry: %q", e)
		}
	}
	if !foundToken {
		t.Fatalf("env missing ACP_GIT_TOKEN=ghp_secret: %v", c.env)
	}
	if len(c.args) < 2 {
		t.Fatalf("expected credential.helper args, got %v", c.args)
	}
	if strings.Contains(c.args[1], "ghp_secret") {
		t.Fatalf("helper arg leaks token: %q", c.args[1])
	}
}

func TestNewGitCredNoUserinfoIsNoop(t *testing.T) {
	in := "https://github.com/o/r.git"
	c := newGitCred(in)
	if c.cleanURL != in {
		t.Fatalf("cleanURL changed: %q != %q", c.cleanURL, in)
	}
	if len(c.args) != 0 {
		t.Fatalf("expected no args, got %v", c.args)
	}
	if len(c.env) != 0 {
		t.Fatalf("expected no env, got %v", c.env)
	}
}

func TestNewGitCredFileSchemeIsNoop(t *testing.T) {
	in := "file:///tmp/x"
	c := newGitCred(in)
	if c.cleanURL != in {
		t.Fatalf("cleanURL changed: %q != %q", c.cleanURL, in)
	}
	if len(c.args) != 0 || len(c.env) != 0 {
		t.Fatalf("expected no-op for file scheme, got args=%v env=%v", c.args, c.env)
	}
}
