# sandbox-runner — Security & Trust Model

The sandbox-runner clones **untrusted, attacker-controlled repositories** and executes
their code through code-executing adapters (`claude-code` runs
`claude -p <intent> --permission-mode acceptEdits` with the cwd set to the clone). A
malicious repo can attempt to hijack the agent and `acceptEdits` auto-approves edits, so
**the agent process must be treated as potentially running arbitrary attacker code.**

## The container is the hard boundary (MANDATORY)

The sandbox-runner **MUST** run inside an OS-level sandbox. The in-process defenses below
reduce blast radius but do **not** contain code execution. Required deployment posture:

- **gVisor** (or an equivalent syscall sandbox / microVM) for the runner process.
- **Kubernetes namespace-per-org** isolation with a `NetworkPolicy` that **restricts egress**
  (deny by default; allow only the git remote + the Anthropic API).
- **Resource quota / limits** (CPU, memory, pids, ephemeral disk) per run.
- Non-root UID, read-only root filesystem, dropped Linux capabilities, no host mounts.

Without this boundary, a hijacked agent is full RCE on the host. Do not run the
code-executing adapters outside such a sandbox.

## In-process defenses now in place

These are defense-in-depth *inside* the container, not a substitute for it:

- **Adapter allowlist (#38):** `claude-code` (host code exec) is default-deny; only
  explicitly authorized callers may select it.
- **Repo-config quarantine (#49):** repo-resident agent-instruction files
  (`.claude/`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.cursor`,
  `.github/copilot-instructions.md`, `.aider.conf.yml`, `.windsurfrules`) are moved aside
  for the duration of the run and restored afterward, so an untrusted clone cannot inject
  trusted instructions/skills. The committed tree/diff is unaffected.
- **Built-in skills (#48):** a small, trusted skill set is embedded in the runner binary
  (`//go:embed`, overridable via `ACP_BUILTIN_SKILLS_DIR`) and injected into the clone's
  `.claude/skills/` **after** the quarantine above, then removed before commit (defer-LIFO:
  skills-cleanup runs before quarantine-restore, so the committed tree is unchanged). These
  are trusted because they ship with the runner. Future **optional/community** skills are
  untrusted code paths and must be authorized + sandboxed like adapters (#38) — see
  `SKILLS.md`.
- **Prompt bound (#49):** `intent`/`notes` are length-bounded (`ACP_MAX_PROMPT_BYTES`,
  default 16 KiB); oversize prompts are rejected before the agent is exec'd.
- **Child-env scrub (#49):** the agent process is started with platform/host secrets
  stripped (`ACP_GIT_TOKEN`, `*TOKEN`/`*SECRET`/`*PASSWORD`/`*CREDENTIAL`,
  `AWS_ACCESS_KEY_ID`/`AWS_SESSION_TOKEN`, `DATABASE_URL`). Claude's own subscription auth
  (`HOME`/`.claude`, `ANTHROPIC_*`, `CLAUDE_*`) is preserved so the agent can run.
- **Resource limits (#50):** per-run timeout, concurrency semaphore, shallow clone with a
  post-clone size guard, and request body-size limits bound DoS.
- **Credential handling + redaction (#39/#51):** PAT supplied via a git credential helper
  (kept out of argv) and redacted from logs.

## Residual risk

Even with every defense above, a successfully hijacked agent is still **RCE inside the
container**. Containment of that RCE is the responsibility of the OS sandbox / network
policy / quota described above — the container is the boundary.
