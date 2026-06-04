# Plan 21 — Error/leak-path hardening cluster (#51)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** the defending-code scan (#47) surfaced a cluster of cheap, concrete leak/scoping fixes (VF-03/04/06/07). The sandbox already redacts its own error bodies server-side (`redactCreds`); these close the residual paths: broaden the redaction regex, redact on the orchestrator (consumer) side too, stop returning env-var names in 400s, org-scope the one unscoped repo load, add a logger redaction config, and throttle login. Each gets a failing test first.

**Branch** `plan-21-leak-hardening` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0 (VF-03c): broaden `redactCreds` Bearer pattern

**Files:** `services/sandbox-runner/internal/sandbox/redact.go`, `redact_test.go`
- [ ] Change the Bearer rule from `Bearer\s+[\w.\-]+` to `(?i)Bearer\s+[^\s,;]+` (catches JWT `=`/`+`/`/` chars) and add a generic `(?i)token\s+[^\s,;]+` rule AFTER the `ghp_`/`github_pat_` rules (so a raw `Authorization: token <jwt>` not matching `ghp_` is still caught). In `redact_test.go` add cases: `Authorization: Bearer eyJhbGci.payload+sig/x==` → redacted (no `eyJ` leak); `Authorization: token abc.def-ghi` → redacted; ensure existing `ghp_`/`x-access-token:`/URL-userinfo cases still pass. `cd services/sandbox-runner && go test ./... 2>&1 | tail -4`. Commit `fix(sandbox): broaden redactCreds Bearer/token patterns (#51)`.

## Task 1 (VF-03a): redact orchestrator sandbox-client error text

**Files:** Create `services/orchestrator/src/util/redact.ts`, `redact.test.ts`; Modify `services/orchestrator/src/sandbox/sandbox-runner-client.ts`
- [ ] **Step 1 — `redact.ts`:** a TS mirror of the Go redaction (defense-in-depth on the consumer side):
```ts
const URL_CREDS = /([a-zA-Z][a-zA-Z0-9+.\-]*:\/\/)[^/@\s]+@/g;
const BARE = [
  /x-access-token:[^@\s/]+/gi,
  /gh[pousr]_[0-9A-Za-z]+/g,
  /github_pat_[0-9A-Za-z_]+/g,
  /(?:Bearer|token)\s+[^\s,;]+/gi,
  /AKIA[0-9A-Z]{16}/g,
];
export function redactCreds(s: string): string {
  let out = s.replace(URL_CREDS, "$1[redacted]@");
  for (const re of BARE) out = out.replace(re, "[redacted]");
  return out;
}
```
- [ ] **Step 2 — `sandbox-runner-client.ts`:** import `redactCreds` and wrap every thrown error's interpolated text — both the `sandbox-runner ${res.status}: ${text}` throws (run + feedback) and the `invalid JSON response` throws. Apply `redactCreds(...)` to the WHOLE message string.
- [ ] **Step 3 — `redact.test.ts`:** `redactCreds("sandbox-runner 500: clone https://x-access-token:ghp_abc123@github.com/o/r.git failed")` contains neither `ghp_abc123` nor `x-access-token:ghp_abc123` and keeps the non-secret prefix. `cd services/orchestrator && pnpm test 2>&1 | tail -4 && pnpm exec tsc --noEmit -p tsconfig.json`. Commit `fix(orchestrator): redact creds in sandbox-client errors (#51)`.

## Task 2 (VF-03b + VF-04): generic token errors + org-scope the repo load

**Files:** `services/app/src/http/{approval-routes,diff-routes,comment-sync-routes,routes}.ts` + their tests
- [ ] **Step 1 — generic 400:** in approval-routes, diff-routes, comment-sync-routes, replace the token-missing 400 body that includes the env-var name (e.g. `GitHub token not configured: ${repo.tokenEnvVar}` / `token not found in env var: …`) with a generic `{ error: "repo token not configured" }` (no env-var name). Update each route's test assertion if it matched the old string (assert 400 + the generic message).
- [ ] **Step 2 — org-scope repo (VF-04):** in `routes.ts` (~:44) the mention handler loads the repo via `select().from(repos).where(eq(repos.id, thread.repoId))`. Add the org filter: `.where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)))` (import `and` if not already). (The thread is already org-scoped, so behavior is unchanged for valid data — defense-in-depth.) If there's an existing routes test that seeds a repo, ensure its `orgId` matches; add a focused test if cheap: a mention whose `thread.repoId` points at a repo in ANOTHER org → no run started (the repo load returns nothing → `continue`).
- [ ] **Step 3:** `cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm test 2>&1 | tail -6 && pnpm exec tsc --noEmit -p tsconfig.json`. Commit `fix(app): generic token-missing error + org-scope repo load (#51)`.

## Task 3 (VF-07): logger credential redaction

**Files:** `services/app/src/server.ts`, `src/server.test.ts` (or a small new `logger.ts` + test)
- [ ] **Step 1:** extract the Fastify logger options into an exported `loggerOptions` (in server.ts or a new `src/logger.ts`) with pino redaction:
```ts
export const loggerOptions = {
  redact: {
    paths: ['req.headers.authorization', 'req.query.token', 'req.query.ticket', '*.token', '*.repoUrl', '*.tokenEnvVar'],
    censor: '[redacted]',
  },
};
```
  and pass it to `Fastify({ logger: loggerOptions })`. (Adjust the existing logger init accordingly.)
- [ ] **Step 2:** a unit test asserting `loggerOptions.redact.paths` includes `req.query.token` and `req.headers.authorization` (proves the config is wired). `cd services/app && DATABASE_URL=… pnpm test 2>&1 | tail -4` + tsc. Commit `fix(app): pino redaction for auth/token fields in logs (#51)`.

## Task 4 (VF-06): login rate-limit (lightweight, no new dep)

**Files:** Create `services/app/src/auth/rate-limit.ts`, `rate-limit.test.ts`; Modify `src/http/auth-routes.ts`
- [ ] **Step 1 — `rate-limit.ts`:** a tiny in-memory fixed-window limiter (no new dependency):
```ts
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
// returns true if the key is allowed (and records the hit), false if over the limit.
export function allow(key: string, limit = 5, windowMs = 60_000, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (b.count >= limit) return false;
  b.count++; return true;
}
export function _reset() { buckets.clear(); } // test hook
```
- [ ] **Step 2 — `auth-routes.ts`:** at the top of `POST /auth/login`, key on `${req.ip}:${memberId}`; if `!allow(key)` return `reply.code(429).send({ error: "too many attempts" })`. (Place BEFORE credential checks so brute-force is throttled.)
- [ ] **Step 3 — `rate-limit.test.ts`:** 5 calls allowed, 6th denied; after the window (`allow(key, 5, 60_000, now + 61_000)`) allowed again; distinct keys independent. Also extend auth-routes.test.ts: 6 rapid bad logins → the 6th is 429 (call `_reset()` in a `beforeEach` to isolate). `cd services/app && DATABASE_URL=… pnpm test 2>&1 | tail -6` + tsc. Commit `fix(app): throttle /auth/login (in-memory rate limit, #51)`.

---

## Self-Review
- Closes #51's cluster: redaction (regex + consumer-side), no env-var names in 400s, the one unscoped repo load fixed, logger redaction, login throttle. All test-backed, no new runtime deps.
- Backward-compat: additive utils; the generic error message is the only externally-visible change (assertions updated); org filter is a no-op for valid data. All three suites stay green.

## Definition of Done (51)
go + orchestrator + app suites green + tsc clean. `redactCreds` catches JWT/`token` formats; sandbox-client errors are redacted; token-missing 400s no longer leak env-var names; the repo load is org-scoped; logs redact auth/token fields; `/auth/login` is rate-limited (429 after 5/min).
