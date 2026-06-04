package adapter

import "testing"

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
