# Plan 29 — Built-in skills out of the box (#48)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD (Go).

**Design (author's call):** Hermes-style "agents ship with skills out of the box" (#48). The buildable core: every `claude-code` run gets a **trusted, embedded built-in skill set** injected into the clone's `.claude/skills/` — layered ON TOP of the Plan-24 quarantine (the repo's own untrusted `.claude/` is moved aside first), and removed before commit so it never lands in the PR. Skills are embedded in the sandbox-runner binary (`//go:embed`), overridable via `ACP_BUILTIN_SKILLS_DIR`. The registry with **optional/community** tiers, a per-org allowlist, and a browse/install UI is the documented follow-up (needs a registry backend); this delivers the "built-in, automatic" half.

**Branch** `plan-29-builtin-skills` (off `main`). Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: embedded built-in skills + provisioning

**Files:** Create `services/sandbox-runner/adapter/builtin_skills/code-review/SKILL.md`, `builtin_skills/test-first/SKILL.md`, `adapter/skills.go`, `adapter/skills_test.go`
- [ ] **Step 1 — bundle two real skills:**
  - `builtin_skills/code-review/SKILL.md`: frontmatter `name: code-review` + a short body ("Before finishing, re-read your diff: check error handling, security (injection/authz), and that tests cover the change.").
  - `builtin_skills/test-first/SKILL.md`: frontmatter `name: test-first` + a short body ("Write a failing test that reproduces the requirement, run it red, then implement until green.").
- [ ] **Step 2 — `skills.go`:**
```go
package adapter

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed builtin_skills
var builtinSkills embed.FS

// provisionBuiltinSkills writes the trusted built-in skill set into
// repoDir/.claude/skills/ so the agent has them for this run, and returns a
// cleanup that removes exactly what it wrote (so the committed tree is clean).
// Source: the embedded set, or ACP_BUILTIN_SKILLS_DIR if set. Call AFTER
// quarantineRepoConfig (which moves the repo's own .claude aside).
func provisionBuiltinSkills(repoDir string) (func(), error) {
	dst := filepath.Join(repoDir, ".claude", "skills")
	written := []string{} // top-level skill dirs we created, for cleanup
	cleanup := func() {
		for _, d := range written {
			_ = os.RemoveAll(d)
		}
		// prune now-empty .claude/skills and .claude if we created them
		_ = os.Remove(dst)
		_ = os.Remove(filepath.Join(repoDir, ".claude"))
	}

	if dir := os.Getenv("ACP_BUILTIN_SKILLS_DIR"); dir != "" {
		return provisionFromDir(os.DirFS(dir), dst, &written, cleanup)
	}
	sub, err := fs.Sub(builtinSkills, "builtin_skills")
	if err != nil {
		return func() {}, err
	}
	return provisionFromDir(sub, dst, &written, cleanup)
}

func provisionFromDir(src fs.FS, dst string, written *[]string, cleanup func()) (func(), error) {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return func() {}, err
	}
	err := fs.WalkDir(src, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || p == "." {
			return err
		}
		target := filepath.Join(dst, p)
		if d.IsDir() {
			// remember top-level skill dirs for cleanup
			if filepath.Dir(p) == "." {
				*written = append(*written, target)
			}
			return os.MkdirAll(target, 0o755)
		}
		b, err := fs.ReadFile(src, p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, 0o644)
	})
	if err != nil {
		cleanup()
		return func() {}, err
	}
	return cleanup, nil
}
```
- [ ] **Step 3 — `skills_test.go`:** `provisionBuiltinSkills(tmpDir)` → `tmpDir/.claude/skills/code-review/SKILL.md` and `.../test-first/SKILL.md` exist with non-empty content; the returned cleanup removes them (and prunes `.claude`). With `t.Setenv("ACP_BUILTIN_SKILLS_DIR", customDir)` containing one `myskill/SKILL.md`, that one is provisioned instead. `go build/vet/test ./...`. Commit `feat(sandbox): embedded built-in skills + provisioning (#48)`.

## Task 1: inject built-in skills into claude-code runs

**Files:** `services/sandbox-runner/adapter/claude_code.go`, `claude_code_test.go`
- [ ] **Step 1 — wire into `Run`:** after the `quarantineRepoConfig` defer and BEFORE `a.exec(...)`, add:
```go
	if cleanup, err := provisionBuiltinSkills(repoDir); err == nil {
		defer cleanup()
	}
```
  (defers are LIFO: built-in-skills cleanup runs first, then the quarantine restore — so the committed tree = the original repo, with neither the injected skills nor any disturbance to the repo's own quarantined `.claude/`.)
- [ ] **Step 2 — wire into `Plan`** (the read-only `Plan(ctx, repoDir, intent)` from Plan 25) the same way, so plan-mode also has the skills.
- [ ] **Step 3 — test:** using the injectable `exec`, run `Run` against a temp repoDir; the injected exec asserts `repoDir/.claude/skills/code-review/SKILL.md` EXISTS during the call; after `Run` returns, assert it's GONE (cleanup). Combined with the existing Plan-24 quarantine test (a repo `CLAUDE.md` is absent during the run and restored after), this proves the layering. `go build/vet/test ./... 2>&1 | tail -6`. Commit `feat(sandbox): inject built-in skills into claude-code runs (#48)`.

## Task 2: document the skill model

**Files:** Create `services/sandbox-runner/SKILLS.md`; update `services/sandbox-runner/SECURITY.md` (mention built-in skill injection)
- [ ] **Step 1 — `SKILLS.md`:** document: built-in skills are embedded + injected into every claude-code run (`.claude/skills/`), the repo's own skills are quarantined as untrusted (Plan 24), built-ins are removed before commit, and the set is overridable via `ACP_BUILTIN_SKILLS_DIR`. Describe the tiering: **built-in** (shipped, automatic — this plan), **optional** (first-party, opt-in) and **community** (untrusted, authorized like adapters #38) as the registry follow-up. Note the per-org allowlist hook ties to RBAC (#29) + adapter authz (#38).
- [ ] **Step 2:** add a line to `SECURITY.md`: built-in skills are trusted+injected post-quarantine; community/optional skills (future) are untrusted code paths to be authorized + sandboxed like adapters. Commit `docs(sandbox): SKILLS.md — built-in skill model + tiering (#48)`.

---

## Self-Review
- Delivers the #48 core: agents get trusted built-in skills automatically on every run, embedded in the binary (overridable), injected post-quarantine and removed pre-commit so the PR stays clean and the repo's own skills stay untrusted.
- Backward-compat: additive; if provisioning fails it's skipped (run continues); the fake adapter path is unaffected (only ClaudeCodeAdapter provisions). Defer-LIFO keeps the committed tree identical to the source. go suite green.
- Note: optional/community tiers + a registry/browse-install UI + per-org allowlist enforcement are the follow-up (need a registry backend); this is the "built-in, out of the box" half, which is the immediate value.

## Definition of Done (48)
go build/vet/test green incl. provisioning + injection tests. Every claude-code run (and plan) has the embedded built-in skills in `.claude/skills/` during execution and a clean tree afterward (skills removed, repo's own `.claude/` quarantined+restored). Overridable via `ACP_BUILTIN_SKILLS_DIR`. `SKILLS.md` documents the model + tiering follow-up.
