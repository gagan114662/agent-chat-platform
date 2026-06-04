# Plan 16 — Human Approvals: make `held_for_human` actionable (#20/#21)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Design (author's call):** Today a `held_for_human` run dead-ends (task `blocked`, a "🔶 held for human review" card). This makes it a real **human approval gate** (reload's "@mention humans only for approvals"): the held card gets **Approve / Decline** actions. Approve → merge the PR + run→merged + task→done + a "✅ approved & merged" message. Decline → run stays terminal, task `blocked`, a "🚫 declined" message. Backend routes (org-scoped) + a `held_for_human → merged` transition + UI buttons on the PR card.

**Branch** `plan-16-approvals` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Run state — allow `held_for_human → merged` (approval)

**Files:** `services/app/src/tasks/runs.ts`, `runs.test.ts`
- [ ] `TRANSITIONS.held_for_human = ["merged"]` (was `[]`); keep it terminal otherwise. `merged` stays terminal. Add a test: `canTransition("held_for_human","merged")` true; `held_for_human → running` false. Commit `feat(app): allow held_for_human → merged (approval transition)`.

## Task 1: Approval module + routes

**Files:** Create `services/app/src/approvals/approvals.ts`, `approvals.test.ts`, `src/http/approval-routes.ts`, `approval-routes.test.ts`; Modify `src/server.ts`

- [ ] **Step 1: `approvals.ts`** — `approveRun(db, github, { orgId, runId })` and `declineRun(db, { orgId, runId })`:
  - `approveRun`: load run `WHERE id=:runId AND org_id=:orgId AND state='held_for_human'` (404/throw otherwise). Resolve the run's task→thread→repo to get `owner/repo` + `tokenEnvVar`. `await github.merge(owner, repo, run.prNumber)`. `transitionRun(db, runId, "merged", {}, orgId)`. Post an agent `pr_card` message into the thread: "✅ approved & merged PR #N". Return the updated run.
  - `declineRun`: load held run (org-scoped); post a `system` message "🚫 declined PR #N — left for revision"; (run stays `held_for_human`/task `blocked`). Return.
  - Inject `github: Pick<GitHubService,"merge">` (so tests pass a fake; route builds `OctokitGitHubService(token)` from `process.env[repo.tokenEnvVar]`).
- [ ] **Step 2: tests** `approvals.test.ts` — seed a held run (org A) with a thread→repo (tokenEnvVar set) + pr_number; `approveRun` calls `github.merge(owner,repo,7)`, transitions run→merged + task→done, posts a pr_card; cross-org approve (org B) → throws/no-op; `declineRun` posts a message + leaves blocked.
- [ ] **Step 3: `approval-routes.ts`** — `POST /runs/:id/approve` + `POST /runs/:id/decline`: `actor(req).orgId`; resolve the run's repo token (`process.env[repo.tokenEnvVar]`); build `OctokitGitHubService(token)`; call the module; 404 if not a held run in the actor's org; 400 if token missing. Register in `server.ts`. `approval-routes.test.ts` via `app.inject` (use a fake/mock for the GitHub merge — inject via a small seam, or hit a held run with a stubbed token and assert 4xx without real GitHub; for the happy path, factor the GitHub client construction so the test can inject a fake — e.g. an optional `makeGitHub` dep on `registerApprovalRoutes`).
- [ ] **Step 4:** `DATABASE_URL=... pnpm test -- approval` + whole app suite + tsc. Commit `feat(app): run approval/decline routes (human gate on held_for_human)`.

## Task 2: UI — Approve/Decline on the held PR card

**Files:** `services/web/src/api.ts`, `src/components/PrCard.tsx`, `PrCard.test.tsx`, `src/components/MessageItem.tsx` (pass a callback), `src/App.tsx`/`useThreadStream` (refetch on action)

- [ ] **Step 1:** `api.ts`: `approveRun(runId)` / `declineRun(runId)` (POST, authHeaders). 
- [ ] **Step 2:** `PrCard.tsx`: when `metadata.outcome === "held_for_human"` and `metadata.runId` present, render **Approve** (near-black) + **Decline** (outline) buttons calling an injected `onApprove(runId)`/`onDecline(runId)`. Thread the callbacks from `MessageItem` ← `ThreadView` ← the conversation (App), where they call the api + then refetch the thread (or rely on the WS message the approval posts). Keep existing PrCard rendering for other outcomes.
- [ ] **Step 3:** `PrCard.test.tsx`: a held_for_human card with a runId shows Approve/Decline; clicking Approve calls `onApprove("run1")`. Other outcomes show no buttons.
- [ ] **Step 4:** `cd services/web && pnpm test && pnpm build`. Commit `feat(web): approve/decline buttons on held PR card`.

---

## Self-Review
- Closes the interactive half of #20/#21: a held run is now human-approvable in-thread (approve→merge / decline). Pairs with the merge gate (#4b) + CI loop (#18).
- Backward-compat: additive routes/UI; `held_for_human → merged` is a new allowed transition (other transitions unchanged); org-scoped (reuses the #14 pattern). Existing tests green.
- Note: full "plan mode" (agent proposes a plan before executing) + generic tool-approval mid-run are broader (#20/#21) — this delivers the approval gate on the merge decision, the highest-value piece. `needs_input`/`confidence` mid-run approval = follow-up.

## Definition of Done (16)
App + web suites green; tsc/build clean. A `held_for_human` PR card shows Approve/Decline; Approve merges the PR (org-scoped, via the repo's token) and flips run→merged/task→done with a confirmation message; Decline records the rejection. Cross-org approve is denied.
