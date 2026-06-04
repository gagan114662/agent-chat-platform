# Plan 24 — sandbox agent prompt/repo-content trust (#49)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD (Go).

**Design (author's call):** the defending-code scan (#49/VF-01, HIGH) found `claude-code` runs `claude -p <intent> --permission-mode acceptEdits` with cwd = the freshly cloned **attacker-controlled** repo. `claude` trusts repo-resident agent instructions (`.claude/`, `CLAUDE.md`, `AGENTS.md`, …), so a malicious repo can hijack the agent (override the intent, run its own skills) and `acceptEdits` auto-approves. #38 limits *who* can pick claude-code; this addresses the *trust* of the prompt and repo content. Three bounded, testable mitigations + docs:
1. **Quarantine repo-resident agent-instruction files** during the run (move aside → run → restore), so the untrusted repo can't inject instructions/skills — and the committed diff is unaffected.
2. **Bound `intent`/`notes` length** (reject oversize prompts).
3. **Strip platform secrets from the agent's child env** (the PAT / `ACP_GIT_TOKEN` / cloud keys), so a hijacked agent can't exfiltrate them — while preserving `claude` subscription auth (HOME / `ANTHROPIC_*` / `CLAUDE_*`).
4. **Document** that code-executing adapters require a mandatory OS sandbox/container.

The container remains the hard boundary (cgroups/gVisor); these defenses reduce what a hijacked-in-sandbox agent can reach.

**Branch** `plan-24-agent-repo-trust` (off `main`). Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: quarantine repo-resident agent instructions

**Files:** Create `services/sandbox-runner/adapter/quarantine.go`, `quarantine_test.go`
- [ ] **Step 1 — `quarantine.go`:**
```go
package adapter

import (
	"os"
	"path/filepath"
)

// agentConfigPaths are repo-resident files/dirs that coding agents treat as
// trusted INSTRUCTIONS. On an untrusted clone they're an injection vector, so we
// move them aside for the duration of the run.
var agentConfigPaths = []string{
	".claude", "CLAUDE.md", "AGENTS.md", ".cursorrules", ".cursor",
	".github/copilot-instructions.md", ".aider.conf.yml", ".windsurfrules",
}

// quarantineRepoConfig moves any agent-instruction files in repoDir into a
// sibling temp dir and returns a restore func that moves them back (so the
// committed tree/diff is unchanged). Best-effort: missing paths are skipped.
func quarantineRepoConfig(repoDir string) (func(), error) {
	stash, err := os.MkdirTemp("", "acp-quarantine-*")
	if err != nil {
		return func() {}, err
	}
	type moved struct{ from, to string }
	var movedItems []moved
	for _, rel := range agentConfigPaths {
		src := filepath.Join(repoDir, rel)
		if _, err := os.Lstat(src); err != nil {
			continue // not present
		}
		dst := filepath.Join(stash, filepath.Base(rel)+"-"+sanitize(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
			continue
		}
		if err := os.Rename(src, dst); err == nil {
			movedItems = append(movedItems, moved{from: src, to: dst})
		}
	}
	restore := func() {
		for _, m := range movedItems {
			_ = os.MkdirAll(filepath.Dir(m.from), 0o755)
			_ = os.Rename(m.to, m.from)
		}
		_ = os.RemoveAll(stash)
	}
	return restore, nil
}

// sanitize makes a relative path safe as a single filename component.
func sanitize(rel string) string {
	out := make([]rune, 0, len(rel))
	for _, r := range rel {
		if r == '/' || r == '\\' || r == filepath.Separator {
			out = append(out, '_')
		} else {
			out = append(out, r)
		}
	}
	return string(out)
}
```
- [ ] **Step 2 — `quarantine_test.go`:** make a temp repoDir with `CLAUDE.md` (content "evil") and `.claude/skills/x/SKILL.md`; call `restore, _ := quarantineRepoConfig(dir)`; assert both are GONE from `dir` after quarantine; call `restore()`; assert both are BACK with original content. A dir with none of the paths → quarantine no-ops, restore no-ops (no error). `go test ./... 2>&1 | tail -4`. Commit `feat(sandbox): quarantine repo-resident agent instructions during runs (#49)`.

## Task 1: bound prompt length + filter the agent's env

**Files:** `services/sandbox-runner/adapter/claude_code.go`, `claude_code_test.go`, Create `adapter/childenv.go`, `childenv_test.go`
- [ ] **Step 1 — `childenv.go`:**
```go
package adapter

import "strings"

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
```
- [ ] **Step 2 — `childenv_test.go`:** `filterChildEnv` drops `ACP_GIT_TOKEN=x`, `GITHUB_TOKEN=y`, `MY_SECRET=z`, `AWS_ACCESS_KEY_ID=a`, `DATABASE_URL=d`; keeps `PATH=/bin`, `HOME=/h`, `ANTHROPIC_API_KEY=k` (preserved prefix), `CLAUDE_CONFIG=c`, `LANG=en`.
- [ ] **Step 3 — `claude_code.go` bound + quarantine + env:**
  - Add a const `maxPromptBytes = 16 * 1024` (or read `ACP_MAX_PROMPT_BYTES`, default 16384, via a small helper).
  - In `Run`: `if len(intent) > maxPromptBytes() { return fmt.Errorf("intent exceeds max prompt size") }` BEFORE emitting/exec. Then `restore, err := quarantineRepoConfig(repoDir); if err == nil { defer restore() }` around the `a.exec(...)` call (so repo instructions are absent during the run, restored after).
  - In `ApplyFeedback`: same length guard on `notes`.
  - In `runClaudeCLI`: set `cmd.Env = filterChildEnv(os.Environ())` (add `"os"` import).
- [ ] **Step 4 — `claude_code_test.go`:** the adapter's `exec` is injectable. Add: (a) `Run` with an oversize intent (`strings.Repeat("x", 20000)`) → error, and the injected `exec` is NOT called (record a bool). (b) `Run` with a normal intent against a temp repoDir containing `CLAUDE.md` → the injected `exec` observes that `CLAUDE.md` is ABSENT during its call (the fake exec checks `os.Stat(filepath.Join(dir,"CLAUDE.md"))` is NotExist), and after `Run` returns the file is restored. Keep existing claude_code tests green. `go build ./... && go vet ./... && go test ./... 2>&1 | tail -6`. Commit `feat(sandbox): bound prompt size + strip secrets from the agent env (#49)`.

## Task 2: document the mandatory sandbox

**Files:** Create `services/sandbox-runner/SECURITY.md`; update `.claude/skills/defending-code/THREAT_MODEL.md` (mark #49 mitigations)
- [ ] **Step 1 — `SECURITY.md`:** short doc: the sandbox-runner executes untrusted repo code via code-executing adapters (claude-code); it MUST run inside an OS sandbox (gVisor / K8s namespace-per-org with NetworkPolicy + resource quota), egress restricted. List the in-process defenses now in place: adapter allowlist (#38), repo-config quarantine + prompt bound + env scrub (#49), resource limits (#50), credential helper + redaction (#39/#51). State the residual: a hijacked agent is still RCE *inside* the container — the container is the boundary.
- [ ] **Step 2:** in `THREAT_MODEL.md`, change the #49 "known open gap" line to reference the mitigations (quarantine/env-scrub/prompt-bound) + "container mandatory (SECURITY.md)". Commit `docs(sandbox): SECURITY.md — mandatory sandbox + trust model (#49)`.

---

## Self-Review
- Closes the in-process half of #49: untrusted repo instructions are quarantined during runs (diff unaffected), prompts are length-bounded, and the platform's secrets (PAT/cloud) are stripped from the agent's env while claude auth survives. The container stays the hard boundary, now documented as mandatory.
- Backward-compat: quarantine/env-filter/bound are additive and default-safe; the `exec` seam keeps the adapter unit-testable without a real `claude`; existing adapter tests stay green. No interface changes.
- Note: fully preventing claude from reading in-repo config would ideally use a CLI flag if one exists; quarantine is the robust, version-independent equivalent. `acceptEdits` is retained (the agent's whole job is to edit) but now operates on a de-instrumented tree inside a locked-down env.

## Definition of Done (49)
go build/vet/test green incl. quarantine + childenv + prompt-bound tests. claude-code runs with repo-resident agent-instruction files moved aside (restored after), an oversize prompt rejected, and platform secrets absent from the agent env. `SECURITY.md` documents the mandatory container boundary.
