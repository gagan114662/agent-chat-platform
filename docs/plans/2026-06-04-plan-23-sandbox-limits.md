# Plan 23 — sandbox-runner resource limits (#50)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD (Go).

**Design (author's call):** the defending-code scan (#50/VF-02) found `/run` + `/feedback` have no per-request timeout, no concurrency cap, and no clone size/disk bound — valid requests at huge/slow repos exhaust CPU/RAM/disk up to the 10-min server write timeout. Add three bounded, env-configurable limits: **per-request `context.WithTimeout`**, a **concurrency semaphore** (excess → 503), and a **shallow clone (`--depth`) + post-clone size guard**. All defaults are backward-compatible (existing tests, which use tiny `file://` repos + the fake adapter, stay green).

**Branch** `plan-23-sandbox-limits` (off `main`). Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: limits config + concurrency semaphore

**Files:** Create `internal/sandbox/limits.go`, `limits_test.go`
- [ ] **Step 1 — `limits.go`:**
```go
package sandbox

import (
	"os"
	"strconv"
	"time"
)

// Limits are the resource bounds for a sandbox run, read from env (all optional).
type Limits struct {
	Timeout     time.Duration // ACP_RUN_TIMEOUT_SEC (default 600s)
	MaxConcurrent int         // ACP_MAX_CONCURRENT_RUNS (default 8)
	CloneDepth  int           // ACP_CLONE_DEPTH (default 1; 0 = full clone)
	MaxRepoBytes int64        // ACP_MAX_REPO_BYTES (default 1<<30 = 1 GiB; 0 = unlimited)
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil { return n }
	}
	return def
}

func LimitsFromEnv() Limits {
	return Limits{
		Timeout:       time.Duration(envInt("ACP_RUN_TIMEOUT_SEC", 600)) * time.Second,
		MaxConcurrent: envInt("ACP_MAX_CONCURRENT_RUNS", 8),
		CloneDepth:    envInt("ACP_CLONE_DEPTH", 1),
		MaxRepoBytes:  int64(envInt("ACP_MAX_REPO_BYTES", 1<<30)),
	}
}

// semaphore bounds concurrent runs. TryAcquire is non-blocking.
type semaphore chan struct{}

func newSemaphore(n int) semaphore {
	if n < 1 { n = 1 }
	return make(semaphore, n)
}
func (s semaphore) tryAcquire() bool {
	select {
	case s <- struct{}{}:
		return true
	default:
		return false
	}
}
func (s semaphore) release() { <-s }
```
- [ ] **Step 2 — `limits_test.go`:** `LimitsFromEnv` defaults (no env) = 600s/8/1/1GiB; with `t.Setenv` overrides parsed. Semaphore: `newSemaphore(2)` → two `tryAcquire()` true, third false; after `release()` one succeeds again. `go test ./... 2>&1 | tail -4`. Commit `feat(sandbox): resource limits config + concurrency semaphore (#50)`.

## Task 1: repo size guard + shallow clone

**Files:** `internal/sandbox/git.go` (CloneInto depth), Create `internal/sandbox/diskguard.go`, `diskguard_test.go`
- [ ] **Step 1 — `CloneInto` depth:** add a package var `cloneDepth = LimitsFromEnv().CloneDepth` is NOT ideal (env read once at init); instead give `CloneInto` the depth via a new optional path. Simplest backward-compatible move: add `CloneIntoDepth(ctx, repoURL, branch, dest string, depth int)` that builds `clone` args with `--depth <n> --single-branch` when `depth > 0` (and `--no-tags` to trim), else the current full clone; keep `CloneInto` delegating to `CloneIntoDepth(…, 0)` so existing callers/tests are unchanged. The handler (Task 2) calls `CloneIntoDepth(..., limits.CloneDepth)`.
  - Build clone args: `args := []string{"clone", "--single-branch", "--branch", branch}; if depth > 0 { args = append(args, "--depth", strconv.Itoa(depth), "--no-tags") }; args = append(args, "--", cleanURL, dest)` — preserve the existing credential-helper prepend (`newGitCred`) + `gitRunEnv` from Plan 20. (Re-read git.go before editing; keep the `cred` wiring intact.)
- [ ] **Step 2 — `diskguard.go`:**
```go
package sandbox

import (
	"fmt"
	"io/fs"
	"path/filepath"
)

// checkRepoSize walks dir and returns an error if the total regular-file bytes
// exceed maxBytes (maxBytes <= 0 disables the check). Bounds disk use post-clone.
func checkRepoSize(dir string, maxBytes int64) error {
	if maxBytes <= 0 {
		return nil
	}
	var total int64
	err := filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil { return err }
		if d.Type().IsRegular() {
			info, err := d.Info()
			if err != nil { return err }
			total += info.Size()
			if total > maxBytes {
				return fmt.Errorf("repo exceeds size limit (%d bytes)", maxBytes)
			}
		}
		return nil
	})
	return err
}
```
- [ ] **Step 3 — `diskguard_test.go`:** create a temp dir with a file > N bytes; `checkRepoSize(dir, N-1)` → error; `checkRepoSize(dir, N+large)` → nil; `checkRepoSize(dir, 0)` → nil (disabled). `go test ./... 2>&1 | tail -4`. Commit `feat(sandbox): shallow clone (--depth) + post-clone size guard (#50)`.

## Task 2: wire limits into the HTTP handlers

**Files:** `internal/sandbox/http.go`, `http_test.go`
- [ ] **Step 1 — `NewHandler`:** read `limits := LimitsFromEnv()` once and create `sem := newSemaphore(limits.MaxConcurrent)` in `NewHandler` (shared across both routes). In BOTH `/run` and `/feedback` handlers, at the very top (after MaxBytesReader): `if !sem.tryAcquire() { http.Error(w, "too many concurrent runs", http.StatusServiceUnavailable); return }; defer sem.release()`. Then derive `ctx, cancel := context.WithTimeout(r.Context(), limits.Timeout); defer cancel()` and use `ctx` (not `r.Context()`) for `Prepare`, `Run`, `Feedback`.
- [ ] **Step 2 — clone depth + size guard:** in `/run`, clone via the size-bounded path. Since `Run()` does the clone internally, the cleanest seam: after `Run`/`Feedback` is awkward (clone already happened). Instead, pass the depth+maxBytes into the run path: add `Limits` fields to `RunRequest`/`FeedbackRequest`? No — keep them server-side. Simplest: have `Run`/`Feedback` accept a `Limits` param and use `CloneIntoDepth(..., limits.CloneDepth)` then `checkRepoSize(req.WorkDir, limits.MaxRepoBytes)` immediately after clone (abort+cleanup on error). Update `Run`/`Feedback` signatures to take `limits Limits`, update all callers + tests (pass `LimitsFromEnv()` or a test value).
  - In `Run` (run.go): replace `CloneInto(ctx, req.RepoURL, req.BaseBranch, req.WorkDir)` with `CloneIntoDepth(ctx, req.RepoURL, req.BaseBranch, req.WorkDir, limits.CloneDepth)`, then `if err := checkRepoSize(req.WorkDir, limits.MaxRepoBytes); err != nil { return RunResult{}, err }`.
  - Same in `Feedback` (feedback.go) for its clone.
- [ ] **Step 3 — `http_test.go`:** add a test that with `t.Setenv("ACP_MAX_CONCURRENT_RUNS","1")` is hard to exercise deterministically (concurrency) — instead unit-test the semaphore (Task 0) and add an HTTP test that a request with a tiny `ACP_MAX_REPO_BYTES=1` against the `file://` fixture returns 500 with the size-limit message (proves the guard is wired). Keep the existing `/run` + `/feedback` happy-path tests green (defaults are generous; `--depth 1` on the single-commit fixture works). `t.Setenv("ACP_ALLOW_FILE_REPO","1")` as those tests already do.
- [ ] **Step 4:** `cd services/sandbox-runner && go build ./... && go vet ./... && go test ./... 2>&1 | tail -8`. Commit `feat(sandbox): enforce timeout + concurrency + size limits on /run and /feedback (#50)`.

---

## Self-Review
- Closes #50: per-request `WithTimeout`, a concurrency semaphore (excess → 503), shallow `--depth` clone + a post-clone size guard — all env-configurable, defaults generous so existing behavior/tests are unchanged.
- Backward-compat: `CloneInto` keeps its signature (delegates to `CloneIntoDepth(…,0)`); `Run`/`Feedback` gain a `Limits` param (all callers + tests updated to pass `LimitsFromEnv()` or a test value); the credential-helper wiring from Plan 20 is preserved. The `file://` fixture tests stay green (single commit, shallow-clone-safe).
- Note: true disk quotas need OS-level cgroups/quota (the container's job, #49-adjacent); the size guard is a fast in-process bound. Concurrency is per-process (per sandbox-runner instance), which is the right granularity here.

## Definition of Done (50)
go build/vet/test green incl. the new limits/diskguard/semaphore tests. `/run` + `/feedback` enforce a per-request timeout, reject when the concurrency cap is full (503), clone shallow by default, and abort when the cloned repo exceeds the size cap. Defaults keep current behavior.
