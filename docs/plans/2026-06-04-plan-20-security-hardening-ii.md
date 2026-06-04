# Plan 20 — Security hardening II (#37 fail-closed auth · #38 adapter authz · #39 ctx/creds/WS tickets)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's calls):** Three #36-audit follow-ups.
- **#37 fail-closed auth:** today `actor()` silently falls back to `x-org-id/x-user-id` (→ `o1/m1`) whenever `AUTH_REQUIRE_SESSION` is unset, so a prod deploy that forgets the flag is wide open + impersonatable. **Invert the default:** strict is the default; the dev-header fallback is active **only** when `ACP_ALLOW_DEV_HEADERS=1`. Replace the `AUTH_REQUIRE_SESSION` env with `ACP_ALLOW_DEV_HEADERS` (cleaner: one opt-in for the dev path, default-deny). Test-impacting (every route test uses the header path) → set `ACP_ALLOW_DEV_HEADERS=1` test-wide in vitest config; strict-mode tests delete it locally.
- **#38 adapter authz:** the sandbox `/run` + `/feedback` let any caller pick `claude-code` (runs `claude --permission-mode acceptEdits` on a cloned untrusted repo = host code execution). **Default-deny code-executing adapters:** an `ACP_ALLOWED_ADAPTERS` allowlist (comma-list); `fake` is always allowed (safe no-op); everything else (incl. `claude-code`) must be explicitly allowed, else 403.
- **#39 (1) ctx threading:** `agentBridge.Apply` uses `context.Background()` → agent runs ignore request cancellation/timeout (zombies). Thread `ctx` through the `Agent` interface. **(2) creds out of argv:** the PAT rides in the clone-URL argv (`https://x-access-token:TOKEN@…`, ps-visible) → strip the secret from argv and supply it via an inline `credential.helper` that reads it from the process env. **(3) WS tickets:** the WS token rides in the URL query (proxy-loggable) → issue short-lived single-use tickets (`POST /ws-ticket`), redeem on connect.

**Branch** `plan-20-security-hardening-ii` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0 (#37): fail-closed auth — `ACP_ALLOW_DEV_HEADERS` replaces `AUTH_REQUIRE_SESSION`

**Files:** Create `services/app/src/auth/dev-mode.ts`; Modify `src/http/actor.ts`, `src/http/auth-routes.ts`, `src/realtime/ws.ts`, `vitest.config.ts`, `src/http/auth-routes.test.ts`, `src/realtime/ws.test.ts`; Create `src/http/actor.test.ts`

- [ ] **Step 1 — `dev-mode.ts`:** 
```ts
// Dev-header auth fallback (x-org-id/x-user-id) is OFF by default (fail-closed).
// Set ACP_ALLOW_DEV_HEADERS=1 ONLY in local/dev/test to enable the header stub.
export function devHeadersAllowed(): boolean {
  return process.env.ACP_ALLOW_DEV_HEADERS === "1";
}
```
- [ ] **Step 2 — `actor.ts`:** only fall back to headers when dev headers are allowed; otherwise throw (defensive — the auth preHandler should already have 401'd):
```ts
import { devHeadersAllowed } from "../auth/dev-mode.js";
export function actor(req: Pick<FastifyRequest, "headers" | "principal">) {
  if (req.principal) return req.principal;
  if (devHeadersAllowed()) {
    return {
      orgId: (req.headers["x-org-id"] as string) ?? "o1",
      userId: (req.headers["x-user-id"] as string) ?? "m1",
    };
  }
  throw new Error("unauthenticated");
}
```
- [ ] **Step 3 — `auth-routes.ts`:** replace every `process.env.AUTH_REQUIRE_SESSION` truthiness with `strict = !devHeadersAllowed()`. Specifically: import `devHeadersAllowed`; in the preHandler `if (!devHeadersAllowed() && !req.principal) { …PUBLIC_PATHS check… 401 }`; `/auth/members` → `if (!devHeadersAllowed()) return reply.code(404)…`; login → `const strict = !devHeadersAllowed();`. (Keep `/auth/me`, `/auth/logout` as-is.)
- [ ] **Step 4 — `ws.ts`:** replace `if (process.env.AUTH_REQUIRE_SESSION)` with `if (!devHeadersAllowed())` (import it). (Ticket support is added in Task 5 — leave the token path here for now.)
- [ ] **Step 5 — `vitest.config.ts`:** add `env: { ACP_ALLOW_DEV_HEADERS: "1" }` to the `test` block so the existing header-path route tests stay green.
- [ ] **Step 6 — update the two strict tests** to drive strict via the new env. In `auth-routes.test.ts` and `ws.test.ts`, the two tests that set `process.env.AUTH_REQUIRE_SESSION = "true"` instead do `delete process.env.ACP_ALLOW_DEV_HEADERS;` in the `try` and **`process.env.ACP_ALLOW_DEV_HEADERS = "1";`** (restore, not delete) in `finally`. (Same assertions: 401 / 404 / 1008.)
- [ ] **Step 7 — new `actor.test.ts`:** (a) with `ACP_ALLOW_DEV_HEADERS` deleted, `actor({ headers: {}, principal: undefined })` **throws** `unauthenticated`; restore `="1"` after. (b) with it `="1"`, `actor({ headers: { "x-org-id":"oX","x-user-id":"mX" } })` → `{orgId:"oX",userId:"mX"}`. (c) a principal always wins regardless of env.
- [ ] **Step 8:** `cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm test 2>&1 | tail -6` (all green) + `pnpm exec tsc --noEmit -p tsconfig.json`. Commit `feat(app): fail-closed auth — ACP_ALLOW_DEV_HEADERS gates the dev-header fallback (#37)`.

## Task 1 (#38): sandbox adapter authorization (default-deny code-executing adapters)

**Files:** Create `services/sandbox-runner/internal/sandbox/authz.go`, `authz_test.go`; Modify `internal/sandbox/http.go`

- [ ] **Step 1 — `authz.go`:**
```go
package sandbox

import (
	"os"
	"strings"
)

// adapterAuthorized reports whether an adapter name may be invoked by this runner.
// "fake" (the safe no-op test adapter) is always allowed. Every other adapter —
// including code-executing ones like "claude-code" — must be listed in the
// comma-separated ACP_ALLOWED_ADAPTERS env (default-deny). Empty name → "fake".
func adapterAuthorized(name string) bool {
	if name == "" || name == "fake" {
		return true
	}
	for _, a := range strings.Split(os.Getenv("ACP_ALLOWED_ADAPTERS"), ",") {
		if strings.TrimSpace(a) == name {
			return true
		}
	}
	return false
}
```
- [ ] **Step 2 — `http.go`:** in BOTH the `/run` and `/feedback` handlers, right after resolving `name` (the `if name == ""` block) and BEFORE `DefaultRegistry().Get(name)`, add:
```go
		if !adapterAuthorized(name) {
			http.Error(w, "adapter not authorized: "+name, http.StatusForbidden)
			return
		}
```
- [ ] **Step 3 — `authz_test.go`:** table test: `""`→true, `"fake"`→true, `"claude-code"`→false (env unset). Then `t.Setenv("ACP_ALLOWED_ADAPTERS","claude-code,other")` → `"claude-code"`→true, `"unknown"`→false, `"fake"` still true. Also an HTTP test: POST `/run` with `{"adapter":"claude-code", …minimal valid body…}` and no allowlist → **403** (build the mux via `NewHandler()`, use a `file://` repo with `t.Setenv("ACP_ALLOW_FILE_REPO","1")` and a valid branch/intent so it passes `Validate()` and reaches the authz gate). With `t.Setenv("ACP_ALLOWED_ADAPTERS","claude-code")` the same request gets past the gate (it may then fail later for other reasons — assert the status is NOT 403).
- [ ] **Step 4:** `cd services/sandbox-runner && go build ./... && go vet ./... && go test ./... 2>&1 | tail -8`. Commit `feat(sandbox): authorize adapter selection — default-deny non-fake adapters (#38)`.

## Task 2 (#39.1): thread request ctx into the agent (cancellation)

**Files:** `services/sandbox-runner/internal/sandbox/agent.go`, `internal/sandbox/run.go`, `adapter/bridge.go`; any other `Apply` impls/callers

- [ ] **Step 1 — `agent.go`:** change the interface + fake to take ctx:
```go
type Agent interface {
	Apply(ctx context.Context, repoDir, intent string) error
}
func (FakeAgent) Apply(_ context.Context, repoDir, intent string) error { /* body unchanged */ }
```
(add `"context"` to imports).
- [ ] **Step 2 — `bridge.go`:** thread ctx through (no more `context.Background()`):
```go
func (b agentBridge) Apply(ctx context.Context, repoDir, intent string) error {
	return b.a.Run(ctx, repoDir, intent, func(Event) {})
}
func AsAgent(a Adapter) interface {
	Apply(ctx context.Context, repoDir, intent string) error
} {
	return agentBridge{a}
}
```
- [ ] **Step 3 — `run.go`:** `Run` already has `ctx` — call `agent.Apply(ctx, req.WorkDir, req.Intent)`.
- [ ] **Step 4:** grep for any other `.Apply(` callers/impls in the module and update them. `cd services/sandbox-runner && go build ./... && go vet ./... && go test ./... 2>&1 | tail -6` (existing run/loop tests green). Commit `feat(sandbox): thread request ctx into the agent (cancellation, #39)`.

## Task 3 (#39.2): keep the PAT out of git argv (inline credential helper)

**Files:** `services/sandbox-runner/internal/sandbox/git.go`, `internal/sandbox/git_creds.go` (new), `internal/sandbox/git_creds_test.go` (new), `internal/sandbox/run.go`, `internal/sandbox/feedback.go`

- [ ] **Step 1 — `git_creds.go`:** derive credentials from a URL that embeds userinfo, returning a clean URL (no secret), the `-c credential.helper=…` args (no secret — reads the env), and the env that carries the secret:
```go
package sandbox

import "net/url"

type gitCred struct {
	cleanURL string   // URL with the password stripped (safe for argv)
	args     []string // prepended before the git subcommand (no secret)
	env      []string // carries the secret out-of-argv (process env only)
}

// newGitCred splits any userinfo password out of repoURL so it never appears in
// argv. The token is passed via the ACP_GIT_TOKEN env to an inline credential
// helper; the helper string itself contains no secret. If there's no password,
// it's a no-op (clean URL == input, no args/env).
func newGitCred(repoURL string) gitCred {
	u, err := url.Parse(repoURL)
	if err != nil || u.User == nil {
		return gitCred{cleanURL: repoURL}
	}
	pass, ok := u.User.Password()
	if !ok || pass == "" {
		return gitCred{cleanURL: repoURL}
	}
	user := u.User.Username()
	if user == "" {
		user = "x-access-token"
	}
	u.User = url.User(user) // keep username (not secret), drop password
	helper := "!f() { test \"$1\" = get && echo username=" + user + " && echo password=$ACP_GIT_TOKEN; }; f"
	return gitCred{
		cleanURL: u.String(),
		args:     []string{"-c", "credential.helper=" + helper},
		env:      []string{"ACP_GIT_TOKEN=" + pass, "GIT_TERMINAL_PROMPT=0"},
	}
}
```
- [ ] **Step 2 — `git.go`:** add env-aware variants and route network commands through them. Add:
```go
func gitRunEnv(ctx context.Context, dir string, env []string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" { cmd.Dir = dir }
	if len(env) > 0 { cmd.Env = append(os.Environ(), env...) }
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git %s: %v\n%s", redactCreds(strings.Join(args, " ")), err, redactCreds(string(out)))
	}
	return nil
}
```
(add `"os"` import). Keep `gitRun` as `gitRunEnv(ctx, dir, nil, args...)`. Then:
  - `CloneInto(ctx, repoURL, branch, dest)`: `c := newGitCred(repoURL); args := append(append([]string{}, c.args...), "clone","--single-branch","--branch",branch,"--",c.cleanURL,dest); return gitRunEnv(ctx, "", c.env, args...)`.
  - `CommitAllAndPush` / `CommitAllAndPushExisting`: add a trailing param `cred gitCred`; the **push** step becomes `gitRunEnv(ctx, repoDir, cred.env, append(append([]string{}, cred.args...), "push","origin",<branch-or-HEAD:branch>)...)`. The config/checkout/add/commit/rev-parse steps stay on plain `gitRun`/`gitOutput` (no secret needed).
- [ ] **Step 3 — callers:** `run.go` `Run` → `c := newGitCred(req.RepoURL)` then `CloneInto` uses the URL (it re-derives internally — fine) and `CommitAllAndPush(ctx, req.WorkDir, req.Branch, "agent: "+req.Intent, c)`. `feedback.go` → `CloneInto(req.RepoURL,…)` then `CommitAllAndPushExisting(ctx, repoDir, req.Branch, msg, newGitCred(req.RepoURL))`. (Keep `CloneInto` deriving its own cred so its signature is unchanged.)
- [ ] **Step 4 — `git_creds_test.go`:** unit test `newGitCred`: (a) `https://x-access-token:ghp_secret@github.com/o/r.git` → `cleanURL` has no `ghp_secret` and no `:` password (`strings.Contains(c.cleanURL,"ghp_secret")==false`, contains `x-access-token@`), `c.env` contains `ACP_GIT_TOKEN=ghp_secret`, `c.args[1]` has no `ghp_secret`. (b) a URL with no userinfo (`https://github.com/o/r.git`) → `cleanURL==input`, `len(args)==0`, `len(env)==0`. (c) `file:///tmp/x` → no-op.
- [ ] **Step 5:** the existing git/feedback round-trip tests use `file://` repos (no token → `newGitCred` is a no-op), so they keep passing. `cd services/sandbox-runner && go build ./... && go vet ./... && go test ./... 2>&1 | tail -8`. Commit `feat(sandbox): keep PAT out of git argv via inline credential helper (#39)`.

## Task 4 (#39.3): short-lived single-use WS tickets — backend

**Files:** Create `services/app/src/realtime/ws-tickets.ts`, `ws-tickets.test.ts`; Modify `src/realtime/ws.ts`, `src/http/auth-routes.ts`, `src/server.ts`

- [ ] **Step 1 — `ws-tickets.ts`:** in-memory single-use ticket store:
```ts
import { randomBytes } from "node:crypto";
type Principal = { orgId: string; userId: string };
const tickets = new Map<string, { p: Principal; exp: number }>();
const TTL_MS = 30_000;
export function issueWsTicket(p: Principal, now = Date.now()): string {
  const id = randomBytes(24).toString("base64url");
  tickets.set(id, { p, exp: now + TTL_MS });
  return id;
}
// Single-use: deletes on read; returns undefined if missing/expired.
export function redeemWsTicket(id: string, now = Date.now()): Principal | undefined {
  const t = tickets.get(id);
  if (!t) return undefined;
  tickets.delete(id);
  if (t.exp < now) return undefined;
  return t.p;
}
```
- [ ] **Step 2 — `auth-routes.ts`:** add an authenticated `POST /ws-ticket` → `if (!req.principal) return reply.code(401)…; return { ticket: issueWsTicket(req.principal) };` (import `issueWsTicket`). (It sits behind the same preHandler; in dev-headers mode `req.principal` may be unset → then the ticket isn't needed, the WS dev path still works. Only issue a ticket when there's a real principal.)
  - Adjust: when `devHeadersAllowed()` and no principal, return `reply.code(400).send({ error: "no session" })` so dev clients fall back to the token/header path. Keep it simple.
- [ ] **Step 3 — `ws.ts`:** accept a `ticket` query param and an injected `redeemTicket`. Signature becomes `registerWs(app, pubsub, resolveToken?, resolveThreadOrg?, redeemTicket?)`. In the strict branch (`!devHeadersAllowed()`): `const p = (ticket && redeemTicket ? redeemTicket(ticket) : undefined) ?? (token && resolveToken ? await resolveToken(token) : undefined);` then the existing `if (!p) close(1008)` + cross-org check. (Ticket preferred; token kept as fallback.)
- [ ] **Step 4 — `server.ts`:** pass `redeemWsTicket` as the 5th arg to `registerWs` (import it).
- [ ] **Step 5 — `ws-tickets.test.ts`:** issue → redeem returns the principal; **second redeem of the same ticket → undefined** (single-use); an expired ticket (`redeemWsTicket(id, now + 60_000)`) → undefined; an unknown id → undefined.
- [ ] **Step 6 — extend `ws.test.ts`:** add a strict-mode test (delete `ACP_ALLOW_DEV_HEADERS` in try / restore `="1"` in finally) where `registerWs(app, pubsub, async()=>undefined, async()=>"o1", (t)=> t==="good" ? {orgId:"o1",userId:"m1"} : undefined)` and the client connects `?threadId=t1&ticket=good` → the socket stays open and receives a NOTIFYed message (assert delivery, mirroring the first test). A bad ticket (`?ticket=nope`, no token) → close 1008.
- [ ] **Step 7:** `cd services/app && DATABASE_URL=… pnpm test 2>&1 | tail -6` + tsc. Commit `feat(app): short-lived single-use WS tickets (POST /ws-ticket, #39)`.

## Task 5 (#39.3): WS tickets — web client

**Files:** `services/web/src/api.ts`, `src/useThreadStream.ts`; update `useThreadStream` test if one exists

- [ ] **Step 1 — `api.ts`:** `getWsTicket(): Promise<string | null>` → `POST /ws-ticket` with `authHeaders()`; on 2xx return `json().ticket`, else `null` (so the dev/no-session path still works).
- [ ] **Step 2 — `useThreadStream.ts`:** make the socket open after fetching a ticket. Replace the `wsUrl` token query with a ticket query, fetched async:
```ts
const proto = location.protocol === "https:" ? "wss" : "ws";
getWsTicket().then((ticket) => {
  if (cancelled) return;
  const q = `threadId=${encodeURIComponent(threadId)}${ticket ? `&ticket=${encodeURIComponent(ticket)}` : ""}`;
  ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
  ws.onmessage = (e) => { try { append(JSON.parse(e.data) as Message); } catch {} };
}).catch(() => {});
```
  (keep the `listMessages` history pull and the `cancelled`/cleanup logic; the cleanup `ws?.close()` still applies since `ws` is the outer `let`). Drop the `getToken` import if now unused. The token no longer rides in the URL.
- [ ] **Step 3:** `cd services/web && pnpm test 2>&1 | tail -6 && pnpm build 2>&1 | tail -3`. Commit `feat(web): connect WS with a short-lived ticket instead of a URL token (#39)`.

---

## Self-Review
- **#37**: dev-header fallback is now opt-in (`ACP_ALLOW_DEV_HEADERS=1`); unset → `actor()` throws + preHandler/ws/auth-routes default-deny. Tests opt in process-wide; strict tests opt out locally. `AUTH_REQUIRE_SESSION` retired.
- **#38**: `claude-code` (and any non-`fake` adapter) is 403 unless allowlisted; `fake` stays allowed so the run/feedback tests pass.
- **#39**: agent runs honor request ctx (cancellation); the PAT never appears in git argv (inline credential helper reads it from env; clean URL keeps only the non-secret username); WS auth uses single-use 30s tickets, token kept only as a dev fallback.
- Backward-compat: Go interface change (`Agent.Apply(ctx,…)`) updates all impls; `CommitAllAndPush*` gain a `cred` param (all callers updated); `file://` test repos make the cred path a no-op so existing Go tests stay green; new app routes/store are additive; org-scoping (#14) unaffected. All three suites + tsc/build green.

## Definition of Done (37/38/39)
app + go + web suites green; tsc/build clean. Auth is fail-closed (dev headers require `ACP_ALLOW_DEV_HEADERS=1`). The sandbox refuses non-allowlisted adapters (`claude-code` 403 by default). Agent runs are cancellable via request ctx, the PAT is absent from git argv, and WS connections authenticate with short-lived single-use tickets.
