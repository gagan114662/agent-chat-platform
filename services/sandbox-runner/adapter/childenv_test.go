package adapter

import (
	"strings"
	"testing"
)

// TestApplyRepoEnv verifies the per-repo, admin-configured env vars (#73) are
// appended AFTER the #49 scrub — including a *_TOKEN, which is an intentional
// admin override (the scrub would otherwise drop it). nil leaves env unchanged.
func TestApplyRepoEnv(t *testing.T) {
	base := filterChildEnv([]string{"PATH=/bin", "GITHUB_TOKEN=scrubbed"})
	// The scrub dropped GITHUB_TOKEN; the repo override re-adds it intentionally.
	got := applyRepoEnv(base, map[string]string{"FOO": "bar", "GITHUB_TOKEN": "admin-set"})

	set := map[string]string{}
	for _, kv := range got {
		if i := strings.IndexByte(kv, '='); i >= 0 {
			set[kv[:i]] = kv[i+1:]
		}
	}
	if set["FOO"] != "bar" {
		t.Errorf("expected repo env FOO=bar, got %q", set["FOO"])
	}
	if set["GITHUB_TOKEN"] != "admin-set" {
		t.Errorf("expected admin override GITHUB_TOKEN=admin-set (intentional), got %q", set["GITHUB_TOKEN"])
	}

	// nil repo env => unchanged.
	unchanged := applyRepoEnv([]string{"PATH=/bin"}, nil)
	if len(unchanged) != 1 || unchanged[0] != "PATH=/bin" {
		t.Errorf("nil repo env must leave env unchanged, got %v", unchanged)
	}
}

func TestFilterChildEnv(t *testing.T) {
	parent := []string{
		"ACP_GIT_TOKEN=x",
		"GITHUB_TOKEN=y",
		"MY_SECRET=z",
		"AWS_ACCESS_KEY_ID=a",
		"DATABASE_URL=d",
		"PATH=/bin",
		"HOME=/h",
		"ANTHROPIC_API_KEY=k",
		"CLAUDE_CONFIG=c",
		"LANG=en",
	}

	got := filterChildEnv(parent)
	set := make(map[string]string, len(got))
	for _, kv := range got {
		for i := 0; i < len(kv); i++ {
			if kv[i] == '=' {
				set[kv[:i]] = kv[i+1:]
				break
			}
		}
	}

	dropped := []string{"ACP_GIT_TOKEN", "GITHUB_TOKEN", "MY_SECRET", "AWS_ACCESS_KEY_ID", "DATABASE_URL"}
	for _, k := range dropped {
		if _, ok := set[k]; ok {
			t.Errorf("expected %s to be dropped, but it was kept", k)
		}
	}

	kept := map[string]string{
		"PATH":              "/bin",
		"HOME":              "/h",
		"ANTHROPIC_API_KEY": "k",
		"CLAUDE_CONFIG":     "c",
		"LANG":              "en",
	}
	for k, v := range kept {
		if got, ok := set[k]; !ok {
			t.Errorf("expected %s to be kept, but it was dropped", k)
		} else if got != v {
			t.Errorf("expected %s=%s, got %s=%s", k, v, k, got)
		}
	}
}
