package adapter

import "strings"

// applyRepoEnv appends the per-repo, admin-configured env vars to a child env
// AFTER the #49 scrub (filterChildEnv). These are intentional repo config — an
// admin override — so a configured *_TOKEN is allowed by design (that is the
// point). nil/empty repoEnv leaves the env unchanged (today's behavior).
func applyRepoEnv(env []string, repoEnv map[string]string) []string {
	for k, v := range repoEnv {
		env = append(env, k+"="+v)
	}
	return env
}

// sensitiveEnvSubstrings name env keys we must NOT expose to the agent process.
var sensitiveEnvSubstrings = []string{"TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL"}

// sensitiveEnvExact are specific keys to drop even though they don't match above.
var sensitiveEnvExact = map[string]bool{
	"AWS_ACCESS_KEY_ID": true, "AWS_SESSION_TOKEN": true, "DATABASE_URL": true,
	"ACP_GIT_TOKEN": true,
}

// preservePrefixes are kept even if they'd otherwise match (claude auth).
var preservePrefixes = []string{"ANTHROPIC_", "CLAUDE_"}

// filterChildEnv drops platform/host secrets from a parent env so a (possibly
// hijacked) agent process can't read the PAT or cloud creds. claude's own auth
// (HOME/.claude, ANTHROPIC_*/CLAUDE_*) is preserved.
func filterChildEnv(parent []string) []string {
	out := make([]string, 0, len(parent))
	for _, kv := range parent {
		key := kv
		if i := strings.IndexByte(kv, '='); i >= 0 {
			key = kv[:i]
		}
		if keep := preserved(key); keep {
			out = append(out, kv)
			continue
		}
		if sensitiveEnvExact[key] || matchesSensitive(key) {
			continue
		}
		out = append(out, kv)
	}
	return out
}

func preserved(key string) bool {
	for _, p := range preservePrefixes {
		if strings.HasPrefix(key, p) {
			return true
		}
	}
	return false
}

func matchesSensitive(key string) bool {
	u := strings.ToUpper(key)
	for _, s := range sensitiveEnvSubstrings {
		if strings.Contains(u, s) {
			return true
		}
	}
	return false
}
