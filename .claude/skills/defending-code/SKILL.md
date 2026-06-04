---
name: defending-code
description: Static security review for agent-chat-platform. Adapts Anthropic's defending-code-reference-harness (threat-model → vuln-scan → triage → patch) to this TS+Go codebase. Use before a release, after touching the sandbox-runner / auth / routes / git-shelling / Octokit / WS / Temporal paths, or when asked to "find security gaps / audit / vuln-scan".
---

# defending-code

Threat-model-driven static vulnerability review for this repo, ported from
[anthropics/defending-code-reference-harness](https://github.com/anthropics/defending-code-reference-harness).
The reference targets C/C++ memory bugs via ASAN; the harness is explicitly portable to
other languages and detectors. Here the "detector" is **static code reasoning by parallel
review subagents**, scoped by [THREAT_MODEL.md](./THREAT_MODEL.md), with an execution-verified
follow-up where a sandbox makes it cheap.

**Read-only by default.** The scan never builds, runs, or touches the network. Patching is a
separate, explicit step that produces a plan + tests, not silent edits.

## Pipeline (interactive)

```
threat-model  →  vuln-scan  →  triage  →  patch
 (focus areas)   (fan-out)     (verify)   (plan+TDD fix)
```

### Step 1 — threat-model (scope the review)
Use [THREAT_MODEL.md](./THREAT_MODEL.md) as the focus-area list. It is this repo's trust
boundaries + assets. If the code has drifted, update it first (it is the source of truth for
what "in scope" means). Pick **3–10 focus areas** for this pass; report the file count per area.

### Step 2 — vuln-scan (fan out, one subagent per focus area)
Dispatch **one Explore/general-purpose subagent per focus area** (max ~8 concurrent — see the
global context-window rule; write large results to a file, summarize in chat). Each subagent
gets a brief: the focus area, the files, the relevant threat-model entry, and the rule
"identify candidate vulnerabilities by static reasoning; for each give file:line, a concrete
exploit scenario, and a fix direction. Do NOT report style nits or theoretical issues with no
attacker path." Collate into findings with stable ids (`F-001`…), ordered by severity then
file:line. Write `VULN-FINDINGS.json` + a short `VULN-FINDINGS.md` to the repo root (gitignored
or committed under `docs/security/` — ask).

### Step 3 — triage (verify, dedupe, rank — kill false positives)
For each finding, an independent reviewer assigns a **confidence 1–10** and answers: is there a
real attacker-reachable path? Is it already mitigated elsewhere (e.g. org-scoping, `Validate()`,
redaction)? Drop confirmed-false / already-fixed. For HIGH findings, prefer an
**execution-verified** check when cheap: the sandbox-runner is already containerized — write a
failing test (Go `_test.go` or a Vitest case) that reproduces the issue, per the repo's
test-first bug rule. Keep only survivors.

### Step 4 — patch (plan + TDD fix)
Do NOT hand-edit silently. For each surviving finding write a `writing-plans`-style slice:
failing test → minimal fix → green → commit. Security fixes get an adversarial review subagent
(try to bypass the fix) before merge. File a GitHub issue per finding that isn't fixed this pass.

## Finding schema (`VULN-FINDINGS.json`)

```json
{
  "id": "F-001",
  "file": "services/...",
  "line": 123,
  "focus_area": "sandbox-runner-shell | auth | routes-idor | secrets | ws | temporal | web-xss | deps",
  "category": "command-injection | argv-injection | ssrf | idor | authz-bypass | secret-exposure | path-traversal | dos | xss | deserialization | toctou | crypto",
  "severity": "HIGH | MEDIUM | LOW",
  "confidence": 0.0,
  "title": "...",
  "description": "...",
  "exploit_scenario": "concrete attacker path, not theory",
  "recommendation": "fix direction",
  "status": "open | mitigated | false_positive | fixed",
  "confidence_reason": "..."
}
```

**Severity:** HIGH = directly exploitable (RCE / cross-tenant data / auth bypass / secret leak).
MEDIUM = real impact under specific conditions. LOW = defense-in-depth.

## Categories that actually apply here (high-value targets)
- **Injection / code-exec:** command & argv injection (git/`claude` shelled in `sandbox-runner`), SSRF / repo-URL scheme abuse, path traversal in clone dest, unsafe adapter selection (host code exec).
- **AuthN/Z:** auth bypass / fail-open defaults, cross-tenant IDOR (missing `org_id` scoping), privilege escalation, WS auth, session handling, TOCTOU.
- **Secret handling:** PAT/token exposure in argv (`ps`), logs, error messages, git history, or thread messages; redaction gaps.
- **DoS:** unbounded request bodies, poll loops, recursion, regex.
- **Web:** XSS via rendered message/PR content, token in URL.
- **Supply chain / deps:** known-vuln dependencies (`pnpm audit`, `govulncheck`).

## What NOT to report
Style nits, "could add a comment", theoretical issues with no attacker-reachable path, or things
already mitigated (org-scoping via `actor(req).orgId`, `RunRequest.Validate()`, `redactCreds`,
opaque session tokens). The reference harness's whole point is **execution-verified, low-false-positive**
findings — honor that here with the confidence pass + the test-reproduction step.

## Output / hand-back
Report: focus areas scanned, finding counts by severity, the top findings, and the next step
(triage survivors → patch plan). Reference issue #47 (harness adoption). Then run
`/verify-acp` after any fix.
