# Threat model — agent-chat-platform

The source of truth for what the `defending-code` scan treats as in-scope. Update when the
architecture drifts. Built on the #36 audit and the #37/#38/#39 follow-ups.

## System in one line
A multi-tenant chat platform where `@mention`-ing an agent spins a sandboxed run that clones a
GitHub repo, runs a coding agent (`claude` / fake) on it, pushes a branch, opens a PR, and drives
CI to merge — orchestrated by Temporal, surfaced over WebSocket.

## Assets (what an attacker wants)
1. **Cross-tenant data** — another org's threads, messages, tasks, runs, memory, DMs.
2. **GitHub PAT** — `process.env[repo.tokenEnvVar]`; grants write to customer repos.
3. **Host code execution** — the sandbox-runner shells `git` and `claude` on cloned, attacker-influenced repos.
4. **Account takeover** — session tokens, the auth fallback, WS auth.

## Trust boundaries
- **Untrusted → sandbox-runner:** `repoUrl`, `branch`, `intent`, `adapter` arrive over HTTP and become `git`/`claude` argv + filesystem paths. The repo *contents* are untrusted (a malicious repo runs through `claude --permission-mode acceptEdits`). Mitigated by #49 (repo-config quarantine + prompt bound + child-env scrub) — but the container remains the hard boundary (mandatory; see `services/sandbox-runner/SECURITY.md`).
- **Untrusted → app HTTP/WS:** every route input; `actor(req)` decides the tenant.
- **app → GitHub (Octokit):** PAT-bearing; nodeFetch shim.
- **app/orchestrator → Temporal:** workflow args (PAT must NOT be in them — resolved inside the activity).

## Focus areas (the scan fans out one subagent per area)

| Area | Files | Primary risks |
|---|---|---|
| `sandbox-runner-shell` | `services/sandbox-runner/internal/sandbox/{run,git,feedback,http}.go`, `adapter/*` | argv/command injection via repoUrl/branch/intent; URL-scheme SSRF (`file://`, `-`-prefixed); path traversal in clone dest; **adapter selection → host code exec** (claude-code); ctx not threaded (zombie procs); body-size DoS |
| `auth` | `services/app/src/http/{auth-routes,actor}.ts`, `auth/*`, `realtime/ws.ts` | **fail-open default** (dev-header fallback when `AUTH_REQUIRE_SESSION`/`ACP_ALLOW_DEV_HEADERS` unset); impersonation via `x-org-id`/`x-user-id`; weak/optional password; session token handling; WS auth + token-in-URL |
| `routes-idor` | `services/app/src/http/*-routes.ts`, the module layer (`chat/agents/tasks/nav/dm/memory/approvals`) | missing `org_id` scoping on by-id access (cross-tenant IDOR); object access without ownership check |
| `secrets` | `services/app/src/fusion/activities.ts`, `github/*`, `sandbox-runner` redaction | **PAT in git argv** (`ps`-visible); token in logs/errors/thread messages; redaction gaps (`redactCreds`); PAT in Temporal args |
| `ws` | `services/app/src/realtime/ws.ts`, `web/src/useThreadStream.ts` | unauth subscribe; cross-tenant thread subscribe; token in URL query (proxy logs); missing single-use tickets |
| `temporal` | `services/app/src/fusion/*`, `services/orchestrator/src/core/*` | secrets in workflow args; unbounded poll loops; unvalidated activity inputs |
| `web-xss` | `services/web/src/components/*` | XSS via message/PR/diff content rendered without escaping; `dangerouslySetInnerHTML`; markdown render |
| `deps` | `**/package.json`, `go.mod` | known-vuln dependencies (`pnpm audit`, `govulncheck`) |

## Existing mitigations (do NOT re-report as findings)
- Org-scoping: all by-id access goes through `actor(req).orgId` + `WHERE … AND org_id` (Plan 14 IDOR fix).
- `RunRequest.Validate()`: rejects `-`-prefixed/hostless URLs, gates `file://` behind `ACP_ALLOW_FILE_REPO`, `validRef` blocks shell metacharacters; git `--` terminator.
- `redactCreds` on all sandbox error/log output; `MaxBytesReader` (1 MiB) on request bodies.
- PAT resolved inside the Temporal activity (not in workflow args); opaque session tokens; scrypt passwords.
- WS strict mode: token + cross-tenant org check (when `AUTH_REQUIRE_SESSION`).

## Known open gaps (tracked — confirm still open before re-filing)
- #37 fail-closed auth (dev-header fallback should be opt-in, not opt-out).
- #38 adapter authorization (default-deny `claude-code`).
- #39 thread ctx into agent (cancellation) · PAT out of git argv · short-lived WS tickets.
- #49 agent prompt/repo-content trust — **mitigated (Plan 24):** repo-resident agent-instruction files quarantined during runs (diff unaffected), `intent`/`notes` length-bounded, platform secrets scrubbed from the agent's child env (claude auth preserved). Residual: a hijacked agent is still RCE *inside* the container — container mandatory (`services/sandbox-runner/SECURITY.md`).

These three are addressed in Plan 20 (`docs/plans/2026-06-04-plan-20-security-hardening-ii.md`). A
fresh scan should verify they're closed and look for what's *not* yet tracked.
