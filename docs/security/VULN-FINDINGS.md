# VULN-FINDINGS — defending-code scan (2026-06-04)

Static review via the repo's `defending-code` skill (ported from
[anthropics/defending-code-reference-harness](https://github.com/anthropics/defending-code-reference-harness),
issue #47). Five focus areas fanned out per
[THREAT_MODEL.md](../../.claude/skills/defending-code/THREAT_MODEL.md): `sandbox-runner-shell`,
`auth+ws`, `routes-idor`, `secrets+temporal`, `web-xss+deps`. Detector = parallel static
reasoning + a triage/confidence pass (false positives dropped after verification).

## Summary
- **New, actionable:** 1 HIGH, 4 MEDIUM, 2 LOW.
- **Tracked (verified still open, addressed in Plan 20):** #37 fail-open auth, #38 adapter authz, #39 ctx/creds/WS tickets.
- **Verified NOT vulnerable (dropped):** XSS (none), RBAC on member write actions, session-token format, clone-dest traversal, `FeedbackRequest.Validate()` parity.

## Findings

| id | sev | conf | area | file | issue |
|----|-----|------|------|------|-------|
| VF-01 | HIGH | 8 | sandbox | `services/sandbox-runner/adapter/claude_code.go:55` | #49 |
| VF-02 | MED | 7 | sandbox | `services/sandbox-runner/internal/sandbox/http.go` | #50 |
| VF-03 | MED | 8 | secrets | `services/orchestrator/src/sandbox/sandbox-runner-client.ts` + routes 400s + `redact.go` | #51 |
| VF-04 | MED | 7 | idor | `services/app/src/http/routes.ts:44` | #51 |
| VF-05 | MED | 8 | deps | `services/app/package.json` (drizzle-orm) | #52 |

Issues filed: #49 (VF-01), #50 (VF-02), #51 (VF-03/04/06/07), #52 (VF-05). RBAC thinness noted on #29.
| VF-06 | LOW | 6 | auth | `services/app/src/http/auth-routes.ts` (no login rate-limit) | #51 |
| VF-07 | LOW | 7 | secrets | `services/app/src/server.ts:29` (no pino redaction) | #51 / #39 |

### VF-01 — claude-code runs with `acceptEdits` on an untrusted repo (HIGH)
`runClaudeCLI` invokes `claude -p <intent> --permission-mode acceptEdits` with `cmd.Dir` set to
the freshly cloned, **attacker-controlled** repo. `claude` trusts repo-resident `.claude/` skills
+ `CLAUDE.md`, and `acceptEdits` auto-approves file edits. So a malicious repo can hijack the
agent (its own instructions/skills override the intent) and act with the sandbox's filesystem /
env / network. `intent` is passed as a distinct argv after `-p` (so it is **not** a flag-injection
vector — verified), and #38 limits *who* can pick `claude-code`, but neither covers
**prompt/repo-content trust**. The real boundary today is the container (gVisor / K8s
namespace-per-org); within it the agent is fully trusted. **Fix direction:** clean `HOME`/env,
ignore in-repo CLI config, drop blanket `acceptEdits` for untrusted prompts, bound `intent`/`notes`,
keep the OS sandbox mandatory + documented. → **#49**

### VF-02 — no per-request timeout / concurrency / disk caps (MED, DoS)
`ctx` is threaded (so cancellation works post-#39), but `/run` + `/feedback` have no
`context.WithTimeout`, no concurrency semaphore, and no clone size/disk cap. Valid requests at
huge repos exhaust CPU/RAM/disk up to the 10-min write timeout. Distinct from #39. **Fix:**
`WithTimeout` + semaphore + `--depth 1` / temp-disk limits. → **#50**

### VF-03 — secret/info leakage in error paths (MED)
(a) `orchestrator/src/sandbox/sandbox-runner-client.ts` throws errors containing the sandbox HTTP
response body, which can echo the token-bearing `repoUrl` (`https://x-access-token:TOKEN@…`) — no
client-side redaction. (b) `approval/diff/comment-sync` routes return the **env-var name** in 400
bodies (deployment-config leak). (c) `redact.go`'s `Bearer\s+[\w.\-]+` misses `Authorization: token …`
(GitHub) and JWT special chars (`= + /`). **Fix:** redact client errors, return generic
"token not configured", broaden the redaction regex. → **#51**

### VF-04 — repo loaded by id without org filter (MED, defense-in-depth)
`routes.ts:44` `select().from(repos).where(eq(repos.id, thread.repoId))` lacks `AND org_id`. The
parent `thread` is already org-scoped so `thread.repoId` is trusted (low exploitability), but every
other by-id load in the app is org-scoped — this is the one inconsistency. **Fix:** add
`eq(repos.orgId, orgId)`. → **#51**

### VF-05 — vulnerable dependency: drizzle-orm < 0.45.2 (MED→HIGH advisory)
`pnpm audit` flags drizzle-orm with a SQL-injection advisory (improperly escaped values) — reachable
(prod DB layer). Also surfaced: `@opentelemetry/exporter-prometheus` DoS (only if `/metrics`
exposed), and dev/test-only `protobufjs` + `vitest` criticals (not shipped). `services/sandbox-runner/go.mod`
has zero deps (no Go advisories). **Fix:** upgrade drizzle-orm ≥ 0.45.2; add `pnpm audit` +
`govulncheck` to CI. → **#52**

### VF-06 / VF-07 — login rate-limit + logger redaction (LOW)
No brute-force throttle on `/auth/login`; Fastify logger has no pino redaction (so a token left in
the WS URL, per #39, would be logged). Defense-in-depth. Folded into #51 / #39.

## Dropped after triage (verified not vulnerable)
- **XSS:** no `dangerouslySetInnerHTML`/`innerHTML`/HTML renderer anywhere; all agent/PR/diff
  content flows through auto-escaping JSX; the sole rendered link is `https://`-guarded with a test.
- **RBAC on member writes:** `can()` permits `thread:create`/`message:post`/`dm:start` to the
  `member` role by design; `channel:create` is correctly admin-gated; no delete route exists. (RBAC
  is *thin* — member ≈ admin for writes — noted on #29, not a vuln.)
- **Session token:** `randomUUID()` is CSPRNG-backed and looked up server-side (opaque) — fine.
- **Clone dest / workdir:** `MkdirTemp` root + constant `"repo"`, no attacker input in the path.
- **FeedbackRequest.Validate():** matches `RunRequest` rigor; `/feedback` applies the same body cap.
