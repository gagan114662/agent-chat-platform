# Plan 4b — Wire the Risk/Policy/QA Gate into the Live Fusion Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** Connects the Plan-4a engine (risk classifier, merge-policy, QA gate, `getChangedFiles`, `runFusion` mergeGate) into the app. Adds a `repos.autonomy` dial, a `buildMergeGate` that assembles getChangedFiles→classifyDiff→needsUiQa→decideMerge, passes it via the activity, adds the `held_for_human` run state + thread card, and threads autonomy from the route. Default autonomy `autopilot-merge` → safe green diffs still auto-merge (live behavior preserved); risky/UI diffs become `held_for_human`. Real browser QA stays the pass-through stub.

**Tech Stack:** TS. Branch `plan-4b-gate-wiring` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `repos.autonomy` + `held_for_human` run state

**Files:** Modify `services/app/src/db/schema.ts`, `src/tasks/runs.ts`, `src/tasks/runs.test.ts`, `src/tasks/tasks.ts`; migration.

- [ ] **Step 1:** add `autonomy` to `repos` in `schema.ts`:
```ts
  // inside repos table, after tokenEnvVar:
  autonomy: text("autonomy").notNull().default("autopilot-merge"), // 'monitor-only'|'resolve-ci'|'autopilot-merge'
```
- [ ] **Step 2:** `cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm db:generate && DATABASE_URL=... pnpm db:migrate` — paste the migration filename.
- [ ] **Step 3:** extend `RunState` + transitions in `src/tasks/runs.ts`:
```ts
export type RunState = "pending" | "running" | "merged" | "checks_failed" | "timeout" | "error" | "held_for_human";

const TRANSITIONS: Record<RunState, RunState[]> = {
  pending: ["running", "error"],
  running: ["merged", "checks_failed", "timeout", "error", "held_for_human"],
  merged: [],
  checks_failed: [],
  timeout: [],
  error: [],
  held_for_human: [],
};
```
and update `TERMINAL_RUN_STATES` to include `"held_for_human"`.
- [ ] **Step 4:** map the terminal state to a task state in `src/tasks/tasks.ts` `transitionRun` — `held_for_human` → task `blocked` (it needs a human). The existing logic `to === "merged" ? "done" : "blocked"` already maps any non-merged terminal (incl. held_for_human) to `blocked` — confirm that branch covers it (it does). No change needed beyond `isTerminal` now returning true for held_for_human (from Step 3).
- [ ] **Step 5:** add a test to `src/tasks/runs.test.ts`:
```ts
  it("allows running→held_for_human and treats it terminal", () => {
    expect(canTransition("running", "held_for_human")).toBe(true);
    expect(canTransition("held_for_human", "running")).toBe(false);
  });
```
- [ ] **Step 6:** `DATABASE_URL=... pnpm test -- runs` → PASS; whole suite + tsc clean.
- [ ] **Step 7:** commit:
```bash
git add services/app/src/db/schema.ts services/app/src/tasks/runs.ts services/app/src/tasks/runs.test.ts services/app/migrations
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): repos.autonomy + held_for_human run state"
```

---

## Task 1: `buildMergeGate` (assemble the engine)

**Files:** Create `services/app/src/fusion/gate.ts`, `src/fusion/gate.test.ts`; Modify `services/orchestrator/package.json` (exports)

- [ ] **Step 1: Add orchestrator exports** for the policy modules in `services/orchestrator/package.json` `exports`:
```json
    "./policy/risk.js": "./src/policy/risk.ts",
    "./policy/policy.js": "./src/policy/policy.ts",
    "./policy/qa.js": "./src/policy/qa.ts"
```

- [ ] **Step 2: failing test** `src/fusion/gate.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { buildMergeGate } from "./gate.js";
import type { ChangedFile } from "@acp/orchestrator/policy/risk.js";

function github(files: ChangedFile[]) {
  return { getChangedFiles: vi.fn().mockResolvedValue(files) } as any;
}
const info = { prNumber: 7, prUrl: "u", commitSha: "s", branch: "b" };

describe("buildMergeGate", () => {
  it("autopilot + safe diff → merge", async () => {
    const gate = buildMergeGate(github([{ filename: "src/util.ts", additions: 3, deletions: 0, status: "modified" }]), { owner: "o", repo: "r", autonomy: "autopilot-merge" });
    expect((await gate(info)).merge).toBe(true);
  });
  it("risky diff (deps) → hold", async () => {
    const gate = buildMergeGate(github([{ filename: "package.json", additions: 1, deletions: 0, status: "modified" }]), { owner: "o", repo: "r", autonomy: "autopilot-merge" });
    expect((await gate(info)).merge).toBe(false);
  });
  it("monitor-only → never merge", async () => {
    const gate = buildMergeGate(github([{ filename: "src/util.ts", additions: 1, deletions: 0, status: "modified" }]), { owner: "o", repo: "r", autonomy: "monitor-only" });
    expect((await gate(info)).merge).toBe(false);
  });
});
```

- [ ] **Step 3:** run → FAIL. Then implement `src/fusion/gate.ts`:
```ts
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { classifyDiff } from "@acp/orchestrator/policy/risk.js";
import { needsUiQa, passThroughQa } from "@acp/orchestrator/policy/qa.js";
import { decideMerge, type Autonomy } from "@acp/orchestrator/policy/policy.js";

export interface GateOpts { owner: string; repo: string; autonomy: Autonomy; }

// Assembles the Plan-4a engine into a runFusion mergeGate: on green, fetch the
// PR's changed files, classify risk, run the (stub) QA if UI is touched, and
// apply the repo's autonomy dial to decide merge vs. hold-for-human.
export function buildMergeGate(github: Pick<GitHubService, "getChangedFiles">, opts: GateOpts) {
  return async (info: { prNumber: number; prUrl: string; commitSha: string; branch: string }) => {
    const files = await github.getChangedFiles(opts.owner, opts.repo, info.prNumber);
    const risk = classifyDiff({ files });
    const qaRequired = needsUiQa(files);
    const qa = qaRequired ? await passThroughQa.run({ prNumber: info.prNumber, branch: info.branch }) : { passed: true, summary: "" };
    const decision = decideMerge({
      autonomy: opts.autonomy,
      risk: risk.decision,
      checks: "success",
      qaRequired,
      qaPassed: qa.passed,
    });
    return { merge: decision.action === "merge", reason: decision.reason };
  };
}
```

- [ ] **Step 4:** add the orchestrator export for `github-service.js` if missing — check `services/orchestrator/package.json` exports already has `./github/octokit-github-service.js`; ADD `"./github/github-service.js": "./src/github/github-service.ts"` too (the gate imports the `GitHubService` type). Then `cd services/app && DATABASE_URL=... pnpm test -- fusion/gate` → PASS; tsc clean.
- [ ] **Step 5:** commit:
```bash
git add services/app/src/fusion/gate.ts services/app/src/fusion/gate.test.ts services/orchestrator/package.json
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): buildMergeGate (risk + policy + QA → merge decision)"
```

---

## Task 2: Wire the gate into the activity + route + sink

**Files:** Modify `src/fusion/activities.ts`, `src/http/routes.ts`, `src/fusion/events.ts`

- [ ] **Step 1: Activity** `src/fusion/activities.ts` — add `autonomy` to the input, build the gate, pass it:
```ts
import { buildMergeGate } from "./gate.js";
import type { Autonomy } from "@acp/orchestrator/policy/policy.js";
// add to RunFusionActivityInput:
  autonomy: Autonomy;
// in runChatFusionActivity, after constructing deps and sink, build the gate and pass it:
    const github = new OctokitGitHubService(input.githubToken);
    const deps = { sandbox: new SandboxRunnerClient(input.sandboxUrl), github };
    const sink = makeFusionSink(db, sql, input.sink);
    const mergeGate = buildMergeGate(github, { owner: input.owner, repo: input.repo, autonomy: input.autonomy });
    return await runFusionTraced(deps, input, { pollMs: input.pollMs, maxPolls: input.maxPolls, onEvent: sink, mergeGate });
```
(Keep using `runFusionTraced` from Plan 6.)

- [ ] **Step 2: Route** `src/http/routes.ts` — include `autonomy` from the repo row in `startRun`. Where the input object is built, add:
```ts
        autonomy: (repo.autonomy as "monitor-only" | "resolve-ci" | "autopilot-merge"),
```
(`repo` is already fetched in the mention loop.)

- [ ] **Step 3: Sink** `src/fusion/events.ts` — handle `held_for_human`: update `describe` and remove the guard so the terminal transition runs:
```ts
// in describe(e), the outcome case:
    case "outcome":
      if (e.outcome === "merged") return `✅ merged PR #${e.prNumber}`;
      if (e.outcome === "held_for_human") return `🔶 held for human review — PR #${e.prNumber}`;
      return `⚠️ ${e.outcome}`;
```
and change the transition guard to allow held_for_human (it is now a valid RunState):
```ts
    if (isOutcome && e.type === "outcome") {
      await transitionRun(db, ctx.runId, e.outcome, {
        prNumber: e.prNumber, prUrl: e.prUrl, commitSha: e.commitSha,
      });
    }
```
(Remove the `&& e.outcome !== "held_for_human"` guard + its explanatory comment.)

- [ ] **Step 4: Update the integration test** `src/fusion/integration.test.ts` — its stubbed activity input must now include `autonomy` (TS-required on the input type). Add `autonomy: "autopilot-merge"` to the `args[0]` object in the `env.client.workflow.execute(...)` call. (The stub activity doesn't use the gate, so behavior is unchanged.) Also check `src/fusion/bridge.ts`/any caller that builds `RunFusionActivityInput` includes `autonomy`.
- [ ] **Step 5:** run `DATABASE_URL=... pnpm test` (whole app suite) + `pnpm exec tsc --noEmit -p tsconfig.json` — all green. The orchestrator unit tests already cover the gate outcome; the app integration test passes with the stub.
- [ ] **Step 6:** commit:
```bash
git add services/app/src/fusion/activities.ts services/app/src/http/routes.ts services/app/src/fusion/events.ts services/app/src/fusion/integration.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): wire merge gate + held_for_human card into the fusion flow"
```

---

## Self-Review
- Coverage: autonomy dial (T0), gate assembly (T1), live wiring + held_for_human state/card (T2). The risk/policy/QA engine now governs real merges.
- Backward-compat: default autonomy `autopilot-merge` + a safe green diff → `decideMerge` returns `merge` → auto-merges exactly as before (the live chat e2e still ends `merged` for the fixture's tiny diff). The seed's repo r1 gets `autonomy` via the column default. `held_for_human` only arises for risky/UI/monitor diffs.
- Type consistency: `Autonomy` from orchestrator policy reused in the activity input + route + gate. `held_for_human` added to `RunState` (app) — it already exists in the orchestrator `FusionOutcome` (4a). New orchestrator exports for `policy/*` + `github/github-service.js`.

## Definition of Done (4b)
App suite green (Postgres + migration) incl. gate + run-state tests; tsc clean. A green safe diff auto-merges; a risky/UI diff (or a `monitor-only`/`resolve-ci` repo) ends `held_for_human` with a "held for human review" thread card and the Task `blocked`. Real browser QA + per-repo autonomy UI remain follow-ups.
