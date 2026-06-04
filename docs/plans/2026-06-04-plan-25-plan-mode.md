# Plan 25 — Plan mode: approve-before-execute (#20)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload/conductor's "plan mode" — the agent proposes a plan, a human approves, *then* it executes. We already have the pause→approve machinery at the merge boundary (`held_for_human` + approve/decline, Plan 16); this adds the SAME pattern at the **start** boundary. When a repo/task is in plan mode, a run first produces a **plan** (read-only, no edits) via the sandbox, posts it as a `plan_card` with **Approve / Reject (+ steering note)**, and parks at a new run state `awaiting_plan_approval`. **Approve** → start the execute run (the normal fusion flow). **Reject** → decline; an optional steering note re-plans (a fresh plan run with the note appended). Approval re-triggers work via the existing `startFusionRun` (no Temporal signal-wait needed — same shape as task reassign/approve). Per-tool-call mid-run approval is #21 (deferred — needs an interactive agent).

**Branch** `plan-25-plan-mode` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Go in `services/sandbox-runner`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: sandbox `/plan` endpoint (read-only plan, no push)

**Files:** `services/sandbox-runner/adapter/adapter.go` (Adapter iface), `adapter/fake.go`, `adapter/claude_code.go`, Create `internal/sandbox/plan.go`, `plan_test.go`, Modify `internal/sandbox/http.go`
- [ ] **Step 1 — Adapter `Plan`:** add `Plan(ctx context.Context, repoDir, intent string) (string, error)` to the `Adapter` interface. `FakeAdapter.Plan` returns a deterministic string e.g. `"PLAN for: " + intent + "\n1. step one\n2. step two"` (no file writes). `ClaudeCodeAdapter.Plan` runs `claude -p <intent> --permission-mode plan` (read-only; reuse the quarantine + `filterChildEnv` + prompt-bound from Plan 24) and returns the captured stdout; injECT via a new `planExec` field defaulting to a `runClaudePlanCLI` (mirror `runClaudeCLI` but capture full output into a string and use `--permission-mode plan`).
- [ ] **Step 2 — `plan.go`:** `PlanRequest{ RepoURL, BaseBranch, Intent, Adapter string; WorkDir string \`json:"-"\` }` + `Validate()` (reuse the same scheme/ref rules as `RunRequest` — factor or copy the checks). `Plan(ctx, req, limits) (PlanResult, error)`: shallow-clone the base branch (`CloneIntoDepth(ctx, req.RepoURL, req.BaseBranch, req.WorkDir, limits.CloneDepth)`), `checkRepoSize`, resolve adapter, `adapter.Prepare`, `text, err := adapter.Plan(ctx, req.WorkDir, req.Intent)`, return `PlanResult{ Plan: text }`. **No commit/push.**
- [ ] **Step 3 — `http.go`:** `POST /plan` (MaxBytesReader + DisallowUnknownFields + Validate + `adapterAuthorized` + semaphore + `context.WithTimeout`, same guards as `/run`), `MkdirTemp` workdir, return `PlanResult` JSON.
- [ ] **Step 4 — `plan_test.go`:** against the `file://` fixture (`t.Setenv("ACP_ALLOW_FILE_REPO","1")`) with the fake adapter, `POST /plan` → 200 with a non-empty `plan` containing the intent, and assert NO new branch was pushed (the bare repo still has only its original ref). `go build/vet/test ./...`. Commit `feat(sandbox): /plan endpoint — read-only agent plan, no push (#20)`.

## Task 1: orchestrator — plan gate in runFusion

**Files:** `services/orchestrator/src/sandbox/sandbox-runner-client.ts`, `src/core/run-fusion.ts`, `run-fusion.test.ts`
- [ ] **Step 1 — client:** add `SandboxRunner.plan(req: { repoUrl; baseBranch; intent; adapter? }): Promise<{ plan: string }>` (POST `/plan`, same transport as `run`); add to the `SandboxRunner` interface + every fake (`run-fusion.test`, `traced-fusion.test` → `plan: vi.fn().mockResolvedValue({ plan: "PLAN" })`).
- [ ] **Step 2 — runFusion:** add to `FusionOptions`: `planMode?: boolean;` and `planGate?: (info: { plan: string }) => Promise<{ approved: boolean }>;`. Add `FusionOutcome` `"awaiting_plan"` and a `FusionEvent` variant `{ type: "plan_proposed"; plan: string }`. At the very TOP of `runFusion` (before `sandbox_started`): if `opts.planMode`, `const { plan } = await deps.sandbox.plan({ repoUrl: input.repoUrl, baseBranch: input.baseBranch, intent: input.intent }); await emit({ type: "plan_proposed", plan }); const g = opts.planGate ? await opts.planGate({ plan }) : { approved: true }; if (!g.approved) { await emit({ type: "outcome", outcome: "awaiting_plan" }); return { outcome: "awaiting_plan" }; }` then fall through to the normal execute flow.
- [ ] **Step 3 — tests:** with `planMode: true` + a `planGate` returning `{approved:false}` → outcome `awaiting_plan`, `sandbox.plan` called once, `sandbox.run` NOT called. With `planMode:true` + `planGate` `{approved:true}` → proceeds to merged (existing happy path). Default (no planMode) → unchanged (existing tests green). `pnpm test` + tsc. Commit `feat(orchestrator): plan-mode gate in runFusion (#20)`.

## Task 2: app — run state + plan-approval routes + sink

**Files:** `services/app/src/tasks/runs.ts`, `runs.test.ts`, `src/fusion/events.ts`, `src/fusion/start.ts` (planMode flag), `src/fusion/activities.ts`, Create `src/http/plan-routes.ts`, `plan-routes.test.ts`, Modify `src/server.ts`, `src/db/schema.ts` (+ migration if a `planMode` column is added)
- [ ] **Step 1 — run state:** add `awaiting_plan_approval` to `RunState`. Transitions: `pending: [..., "awaiting_plan_approval"]`; `awaiting_plan_approval: ["running", "error"]` (approve → running; not terminal); add to neither TERMINAL set. Test `canTransition` cases. 
- [ ] **Step 2 — planMode source:** add a `boolean planMode` (default false) to the `repos` table (migration `0009_repo_plan_mode`) — the per-repo opt-in. (Mentions on a plan-mode repo run plan-first.)
- [ ] **Step 3 — sink (events.ts):** handle the new `plan_proposed` event → post an agent `plan_card` message (kind `plan_card`, body = the plan text, metadata `{ runId, kind: "plan" }`) + NOTIFY; handle outcome `awaiting_plan` → `transitionRun(..., "awaiting_plan_approval", ...)`. (Keep idempotent RunEvent + dedupe by deterministic id.)
- [ ] **Step 4 — wire planMode into the run (start.ts/activities.ts):** `startFusionRun` gains `planMode?: boolean`; the mention handler passes `repo.planMode`. The activity passes `planMode` + a `planGate` to `runFusionTraced`. The `planGate` here ALWAYS returns `{approved:false}` (the first pass only proposes — approval comes via the route, which starts a NEW execute run with planMode forced off). So plan-mode runs: propose → park.
- [ ] **Step 5 — `plan-routes.ts`:** `registerPlanRoutes(app, d: { db, sql, temporal, sandboxUrl })`:
  - `POST /runs/:id/approve-plan`: `actor(req).orgId`; load run org-scoped, must be `awaiting_plan_approval` (404/409 otherwise); resolve task→thread→repo; `transitionRun(..., "running", ...)`; `startFusionRun(..., { planMode: false })` for THIS run (execute now); post a `system` message "✅ plan approved — executing"; return `{ ok: true }`.
  - `POST /runs/:id/reject-plan { notes?: string }`: load held-for-plan run org-scoped; post a `system` message "🚫 plan rejected" + (if notes) "↻ re-planning with steering: <notes>"; transition run → `error` (declined). If `notes`, open a fresh plan-mode run with intent = original + "\n\nSteering: " + notes (reuse openTaskForMention/startFusionRun planMode:true). Return `{ ok: true, replanned: <bool> }`.
  - Register in `server.ts`.
- [ ] **Step 6 — `plan-routes.test.ts`** (`app.inject`, fake temporal/sandbox or guard when no repo/token): seed an org-A run in `awaiting_plan_approval` + task+thread+repo; approve → run→running + "plan approved" message + (fake) startFusionRun invoked; reject with notes → declined message + replan; cross-org → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): plan-mode run state + approve/reject-plan routes (#20)`.

## Task 3: web — plan card with Approve / Reject + steering

**Files:** `services/web/src/api.ts`, `src/types.ts`, Create `src/components/PlanCard.tsx`, `PlanCard.test.tsx`, Modify `src/components/MessageItem.tsx`, thread the callbacks from App
- [ ] **Step 1 — `api.ts`:** `approvePlan(runId)` (POST `/runs/:id/approve-plan`) and `rejectPlan(runId, notes?)` (POST `/runs/:id/reject-plan`, body `{ notes }`).
- [ ] **Step 2 — `PlanCard.tsx`:** for a message with `kind === "plan_card"` and `metadata.runId`, render the plan text (monospace/pre) + **Approve** (near-black) and **Reject** (outline) buttons + a small steering `<textarea>` whose value is passed to `onReject(runId, notes)`. `onApprove(runId)` on approve. Thread `onApprovePlan`/`onRejectPlan` from MessageItem ← ThreadView ← App (App calls api then refetch). 
- [ ] **Step 3 — `MessageItem.tsx`:** render `PlanCard` when `m.kind === "plan_card"` (alongside the existing `pr_card` branch).
- [ ] **Step 4 — tests:** `PlanCard.test.tsx`: renders the plan text + both buttons; clicking Approve calls `onApprove("run1")`; typing a note + Reject calls `onReject("run1", "do X instead")`. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): plan card with approve/reject + steering (#20)`.

---

## Self-Review
- Delivers #20: plan-mode repos propose a plan, park at `awaiting_plan_approval`, and only execute after human approval; reject can steer a re-plan. Reuses the Plan-16 approve→action pattern (no Temporal signal-wait). The sandbox `/plan` runs the agent read-only (claude `--permission-mode plan`), with all Plan-24 hardening.
- Backward-compat: `planMode` defaults false (repos unchanged → today's behavior; existing fusion/run-fusion tests green); new run state/outcome/event/routes/UI are additive; org-scoped (#14). `SandboxRunner.plan` + `Adapter.Plan` are interface additions → update all fakes/impls.
- Note: per-tool-call mid-run approval (#21) is deferred — the one-shot CLI agent can't pause mid-execution; that needs an interactive/streaming adapter.

## Definition of Done (20)
go + orchestrator + app + web suites green; tsc/build clean. A plan-mode repo's mention produces a plan card with Approve/Reject; Approve executes the run (normal fusion → PR), Reject declines (with optional steering re-plan); the run sits at `awaiting_plan_approval` until acted on. Org-scoped.
