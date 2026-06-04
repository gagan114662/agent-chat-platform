# sandbox-runner — Skill model

Agents should ship with capabilities out of the box (#48). The sandbox-runner
gives every `claude-code` run (and plan) a **trusted, built-in skill set**
automatically — no per-repo or per-org setup required.

## How built-in skills work

- **Embedded in the binary.** The skill set lives under
  `adapter/builtin_skills/` and is compiled into the runner via `//go:embed`,
  so there is nothing to install or fetch at runtime. Today this ships two
  skills: `code-review` (self-review the diff for error handling, security, and
  test coverage) and `test-first` (write a failing test before implementing).
- **Injected per run.** Before the agent executes, the set is written into the
  clone's `.claude/skills/` so the agent picks it up natively. This happens for
  both `Run` (acceptEdits) and `Plan` (read-only) modes.
- **Layered on the quarantine (#49).** The repo's *own* agent-instruction files
  (`.claude/`, `CLAUDE.md`, `AGENTS.md`, …) are moved aside first as untrusted
  injection vectors. The built-in skills are written *after* that, into the now
  cleared `.claude/skills/`. The repo's own skills never run.
- **Removed before commit.** Cleanup removes exactly what was written (the
  top-level skill dirs) and prunes the `.claude`/`.claude/skills` dirs the
  runner created. Because Go defers are LIFO and the skills-cleanup defer is
  registered *after* the quarantine-restore defer, skills-cleanup runs **first**,
  then the repo's quarantined `.claude/` is restored. The committed tree/diff is
  therefore identical to the original repo — built-ins never land in the PR.
- **Overridable.** Set `ACP_BUILTIN_SKILLS_DIR=/path/to/skills` to provision an
  alternate set instead of the embedded one (each immediate subdirectory is a
  skill, e.g. `myskill/SKILL.md`). Useful for testing or org-specific defaults.

## Tiering (and the registry follow-up)

This plan delivers the **built-in** tier. The full model has three tiers:

| Tier | Trust | Distribution | Status |
| --- | --- | --- | --- |
| **built-in** | trusted (ships with runner) | embedded, injected automatically | done (this plan, #48) |
| **optional** | first-party, opt-in | registry, per-org enable | follow-up |
| **community** | untrusted | registry, authorized + sandboxed like adapters (#38) | follow-up |

The **optional** and **community** tiers need a registry backend (browse /
install UI, versioning, per-org enablement) and are documented here as the
follow-up. A **per-org allowlist** hook will gate which optional/community
skills an org may use; it ties into RBAC (#29) and the adapter authorization
model (#38). Community skills are untrusted code paths and must be authorized
and sandboxed exactly like community adapters — they do **not** get the
automatic, trusted injection the built-in tier enjoys.

## Files

- `adapter/builtin_skills/` — the embedded skill set (`<name>/SKILL.md`).
- `adapter/skills.go` — `provisionBuiltinSkills` / `provisionFromDir`.
- `adapter/claude_code.go` — wires provisioning into `Run` and `Plan` after the
  quarantine defer.
