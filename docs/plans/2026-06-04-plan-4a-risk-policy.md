# Plan 4a — Risk Router + Merge-Policy Engine + QA Gate (orchestrator core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** Implements the merge-decision brain from the spec (autonomy dial + Layer-B safety tripwires + QA-for-UI), as self-contained, unit-tested modules in `@acp/orchestrator`, plus a `getChangedFiles` GitHub method and an OPTIONAL `runFusion` merge-gate. Default behavior is unchanged (no gate → merge on green, as today). The app-side wiring (a `repos.autonomy` column, assembling the gate in the activity, and a `held_for_human` thread card) is **4b**. Real browser QA execution is a pluggable interface with a pass-through stub (wired to the `/browse` harness in a later plan).

**Tech Stack:** unchanged (TS). Branch `plan-4a-risk-policy` (off `main`). Tests: `cd services/orchestrator && pnpm test`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Risk classifier

**Files:** Create `services/orchestrator/src/policy/risk.ts`, `src/policy/risk.test.ts`

- [ ] **Step 1: failing test** `src/policy/risk.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classifyDiff, type ChangedFile } from "./risk.js";

const f = (filename: string, additions = 5, deletions = 0, status = "modified"): ChangedFile => ({ filename, additions, deletions, status });

describe("classifyDiff", () => {
  it("auto-approves a small, safe diff", () => {
    const v = classifyDiff({ files: [f("src/util.ts"), f("README.md")] });
    expect(v.decision).toBe("auto");
    expect(v.reasons).toEqual([]);
  });
  it("flags protected paths (CI, secrets, migrations, deps)", () => {
    for (const name of [".github/workflows/ci.yml", "src/auth/secret.ts", "migrations/001.sql", "package.json"]) {
      expect(classifyDiff({ files: [f(name)] }).decision).toBe("human");
    }
  });
  it("flags large diffs, too many files, deletions, big net-negative", () => {
    expect(classifyDiff({ files: [f("a.ts", 500, 0)] }).decision).toBe("human"); // > 400 lines
    expect(classifyDiff({ files: Array.from({ length: 16 }, (_, i) => f(`f${i}.ts`)) }).decision).toBe("human");
    expect(classifyDiff({ files: [f("gone.ts", 0, 0, "removed")] }).decision).toBe("human");
    expect(classifyDiff({ files: [f("big.ts", 0, 300)] }).decision).toBe("human"); // net -300
  });
});
```

- [ ] **Step 2:** `cd services/orchestrator && pnpm test -- policy/risk` → FAIL. Then implement `src/policy/risk.ts`:
```ts
export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string; // 'added' | 'modified' | 'removed' | 'renamed'
}

export interface RiskOptions { maxLines: number; maxFiles: number; maxNetNegative: number; }
export const DEFAULT_RISK: RiskOptions = { maxLines: 400, maxFiles: 15, maxNetNegative: 200 };

export interface RiskVerdict { decision: "auto" | "human"; reasons: string[]; }

const PROTECTED: { re: RegExp; why: string }[] = [
  { re: /(^|\/)\.github\/workflows\//i, why: "CI workflow" },
  { re: /(^|\/)(Dockerfile|\.circleci\/|deploy\/|k8s\/|terraform\/)/i, why: "infra/deploy config" },
  { re: /(secret|credential|\.env|vault|crypto|(^|\/)auth(\/|\.))/i, why: "auth/secrets/crypto" },
  { re: /(^|\/)migrations?\/|\.sql$/i, why: "database migration" },
  { re: /(package\.json|pnpm-lock\.yaml|go\.mod|go\.sum|requirements\.txt|Cargo\.(toml|lock))$/i, why: "dependency change" },
  { re: /(payment|billing|\bpii\b|ssn)/i, why: "payments/PII" },
];

// Layer-B safety tripwires (spec §5): any hit forces a human gate.
export function classifyDiff(input: { files: ChangedFile[] }, opts: RiskOptions = DEFAULT_RISK): RiskVerdict {
  const reasons: string[] = [];
  const total = input.files.reduce((s, f) => s + f.additions + f.deletions, 0);
  const net = input.files.reduce((s, f) => s + f.additions - f.deletions, 0);
  if (total > opts.maxLines) reasons.push(`diff size ${total} > ${opts.maxLines} lines`);
  if (input.files.length > opts.maxFiles) reasons.push(`${input.files.length} files > ${opts.maxFiles}`);
  if (net < -opts.maxNetNegative) reasons.push(`large net-negative diff (${net})`);
  for (const file of input.files) {
    if (file.status === "removed") reasons.push(`file deleted: ${file.filename}`);
    for (const p of PROTECTED) if (p.re.test(file.filename)) reasons.push(`${p.why}: ${file.filename}`);
  }
  const uniq = [...new Set(reasons)];
  return { decision: uniq.length > 0 ? "human" : "auto", reasons: uniq };
}
```

- [ ] **Step 3:** `pnpm test -- policy/risk` → PASS. Whole suite + tsc clean.
- [ ] **Step 4:** commit:
```bash
git add services/orchestrator/src/policy/risk.ts services/orchestrator/src/policy/risk.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(orchestrator): risk classifier (Layer-B tripwires)"
```

---

## Task 1: Merge-policy engine

**Files:** Create `src/policy/policy.ts`, `src/policy/policy.test.ts`

- [ ] **Step 1: failing test** `src/policy/policy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decideMerge } from "./policy.js";

describe("decideMerge", () => {
  it("autopilot + low risk + green → merge", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "auto", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("merge");
  });
  it("holds when checks are not green", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "auto", checks: "pending", qaRequired: false, qaPassed: false }).action).toBe("hold_for_human");
  });
  it("monitor-only never merges", () => {
    expect(decideMerge({ autonomy: "monitor-only", risk: "auto", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("monitor");
  });
  it("risk tripwire holds even on autopilot", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "human", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("hold_for_human");
  });
  it("UI QA required but not passed holds", () => {
    expect(decideMerge({ autonomy: "autopilot-merge", risk: "auto", checks: "success", qaRequired: true, qaPassed: false }).action).toBe("hold_for_human");
  });
  it("resolve-ci dial holds for human merge even when green+safe", () => {
    expect(decideMerge({ autonomy: "resolve-ci", risk: "auto", checks: "success", qaRequired: false, qaPassed: false }).action).toBe("hold_for_human");
  });
});
```

- [ ] **Step 2:** run → FAIL. Then implement `src/policy/policy.ts`:
```ts
export type Autonomy = "monitor-only" | "resolve-ci" | "autopilot-merge";
export type MergeAction = "merge" | "hold_for_human" | "monitor";

export interface PolicyInput {
  autonomy: Autonomy;
  risk: "auto" | "human";
  checks: "success" | "failure" | "pending";
  qaRequired: boolean;
  qaPassed: boolean;
}

// Resolves the merge decision from the repo's autonomy dial, the risk verdict,
// CI status, and the QA-for-UI gate (spec §5 merge policy).
export function decideMerge(i: PolicyInput): { action: MergeAction; reason: string } {
  if (i.checks !== "success") return { action: "hold_for_human", reason: `checks ${i.checks}` };
  if (i.autonomy === "monitor-only") return { action: "monitor", reason: "monitor-only dial" };
  if (i.qaRequired && !i.qaPassed) return { action: "hold_for_human", reason: "UI QA required but not passed" };
  if (i.risk === "human") return { action: "hold_for_human", reason: "risk tripwire" };
  if (i.autonomy === "autopilot-merge") return { action: "merge", reason: "autopilot: green, low-risk, QA ok" };
  return { action: "hold_for_human", reason: "resolve-ci dial: human merges" };
}
```

- [ ] **Step 3:** run → PASS (6). Suite + tsc clean.
- [ ] **Step 4:** commit:
```bash
git add services/orchestrator/src/policy/policy.ts services/orchestrator/src/policy/policy.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(orchestrator): merge-policy engine (autonomy dial)"
```

---

## Task 2: QA-for-UI gate

**Files:** Create `src/policy/qa.ts`, `src/policy/qa.test.ts`

- [ ] **Step 1: failing test** `src/policy/qa.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { needsUiQa, passThroughQa } from "./qa.js";
import type { ChangedFile } from "./risk.js";

const f = (filename: string): ChangedFile => ({ filename, additions: 1, deletions: 0, status: "modified" });

describe("qa gate", () => {
  it("needsUiQa true when UI files change", () => {
    expect(needsUiQa([f("src/App.tsx")])).toBe(true);
    expect(needsUiQa([f("src/styles.css")])).toBe(true);
    expect(needsUiQa([f("src/server.ts")])).toBe(false);
  });
  it("passThroughQa returns passed", async () => {
    const r = await passThroughQa.run({ prNumber: 1, branch: "b" });
    expect(r.passed).toBe(true);
  });
});
```

- [ ] **Step 2:** run → FAIL. Then implement `src/policy/qa.ts`:
```ts
import type { ChangedFile } from "./risk.js";

const UI_RE = /\.(tsx|jsx|css|scss|html|svelte|vue)$/i;

// Whether a diff touches UI and therefore requires browser QA before merge (spec §5).
export function needsUiQa(files: ChangedFile[]): boolean {
  return files.some((f) => UI_RE.test(f.filename));
}

export interface QaResult { passed: boolean; summary: string; }
export interface QaRunner { run(input: { prNumber: number; branch: string }): Promise<QaResult>; }

// Default stub — passes. Real browser QA (Playwright/agent-driven via the /browse harness)
// is wired in a later plan; the interface lets it be injected without touching callers.
export const passThroughQa: QaRunner = {
  async run() {
    return { passed: true, summary: "QA stub: passed (browser QA not yet wired)" };
  },
};
```

- [ ] **Step 3:** run → PASS (2). Suite + tsc clean.
- [ ] **Step 4:** commit:
```bash
git add services/orchestrator/src/policy/qa.ts services/orchestrator/src/policy/qa.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(orchestrator): QA-for-UI gate (needsUiQa + pluggable runner)"
```

---

## Task 3: `getChangedFiles` on the GitHub service

**Files:** Modify `src/github/github-service.ts`, `src/github/octokit-github-service.ts`, `src/github/octokit-github-service.test.ts`

- [ ] **Step 1: Extend the interface** in `src/github/github-service.ts` — add a method + reuse the `ChangedFile` shape:
```ts
import type { ChangedFile } from "../policy/risk.js";
// add to the GitHubService interface:
  getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]>;
```
(Add the import at the top; keep the existing `OpenPrInput`/methods.)

- [ ] **Step 2: Add a test** to `src/github/octokit-github-service.test.ts`:
```ts
  it("lists changed files for a PR", async () => {
    nock(api).get("/repos/o/r/pulls/7/files").reply(200, [
      { filename: "src/a.ts", additions: 3, deletions: 1, status: "modified" },
      { filename: "README.md", additions: 1, deletions: 0, status: "added" },
    ]);
    const svc = new OctokitGitHubService("tok");
    const files = await svc.getChangedFiles("o", "r", 7);
    expect(files.map((f) => f.filename)).toEqual(["src/a.ts", "README.md"]);
    expect(files[0]).toMatchObject({ additions: 3, deletions: 1, status: "modified" });
  });
```

- [ ] **Step 3:** run `pnpm test -- octokit-github-service` → the new test FAILS. Then implement in `src/github/octokit-github-service.ts` (add the method to the class):
```ts
  async getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
    const res = await this.octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
    return res.data.map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
    }));
  }
```
(Add `import type { ChangedFile } from "../policy/risk.js";` at the top.)

- [ ] **Step 4:** run → PASS (now 5 octokit tests). Suite + tsc clean.
- [ ] **Step 5:** commit:
```bash
git add services/orchestrator/src/github/github-service.ts services/orchestrator/src/github/octokit-github-service.ts services/orchestrator/src/github/octokit-github-service.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(orchestrator): GitHubService.getChangedFiles"
```

---

## Task 4: Optional merge-gate in `runFusion` (`held_for_human` outcome)

**Files:** Modify `src/core/run-fusion.ts`, `src/core/run-fusion.test.ts`

- [ ] **Step 1: Add a test** to `src/core/run-fusion.test.ts` (append; `deps`/`input` exist):
```ts
it("holds for human when the merge gate declines, instead of merging", async () => {
  const d = deps(["success"]);
  const out = await runFusion(d, input, {
    pollMs: 0, maxPolls: 5,
    mergeGate: async () => ({ merge: false, reason: "risk tripwire" }),
  });
  expect(out.outcome).toBe("held_for_human");
  expect(d.github.merge).not.toHaveBeenCalled();
});

it("merges when the gate approves", async () => {
  const d = deps(["success"]);
  const out = await runFusion(d, input, {
    pollMs: 0, maxPolls: 5,
    mergeGate: async () => ({ merge: true, reason: "autopilot" }),
  });
  expect(out.outcome).toBe("merged");
  expect(d.github.merge).toHaveBeenCalled();
});
```

- [ ] **Step 2:** run `pnpm test -- run-fusion` → the new tests FAIL (mergeGate/held_for_human unknown). Then update `src/core/run-fusion.ts`:
  - Extend the outcome + event unions:
```ts
export type FusionOutcome = "merged" | "checks_failed" | "timeout" | "held_for_human";
```
  (The `FusionEvent` `outcome` variant already references `FusionOutcome`, so it widens automatically.)
  - Add to `FusionOptions`:
```ts
  mergeGate?: (info: { prNumber: number; prUrl: string; commitSha: string; branch: string }) => Promise<{ merge: boolean; reason: string }>;
```
  - In the success branch of the poll loop, consult the gate before merging:
```ts
    if (status === "success") {
      if (opts.mergeGate) {
        const gate = await opts.mergeGate({ prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha, branch: run.branch });
        if (!gate.merge) {
          await emit({ type: "outcome", outcome: "held_for_human", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
          return { outcome: "held_for_human", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
        }
      }
      await deps.github.merge(input.owner, input.repo, pr.number);
      await emit({ type: "outcome", outcome: "merged", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
      return { outcome: "merged", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
```
  (Leave the failure/timeout branches unchanged. The existing 4 run-fusion tests pass no `mergeGate`, so they merge on green exactly as before.)

- [ ] **Step 3:** run `pnpm test` (whole orchestrator suite — original run-fusion tests + the 2 new gate tests + all others) and `pnpm exec tsc --noEmit -p tsconfig.json`. All green/clean.
- [ ] **Step 4:** commit:
```bash
git add services/orchestrator/src/core/run-fusion.ts services/orchestrator/src/core/run-fusion.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(orchestrator): optional merge-gate + held_for_human outcome in runFusion"
```

---

## Self-Review
- Coverage: risk classifier (T0), policy engine (T1), QA gate (T2), getChangedFiles (T3), runFusion gate + held_for_human (T4) — the merge-decision brain from spec §5. ✅
- Backward-compat: `runFusion` with no `mergeGate` behaves exactly as before (4 existing tests green); the new `held_for_human` outcome only arises when a gate is supplied. `getChangedFiles` is an interface addition — the only implementor is `OctokitGitHubService` (updated) and the app's run-fusion fakes don't implement `GitHubService` directly except in tests that construct full fakes (they will need the method only if TS-checked against the interface — the app's `run-fusion.test` fake already implements the 3 methods; adding a 4th to the interface means that fake must add `getChangedFiles`. **Check the app package compiles**; if its `GitHubService` fake breaks, add a `getChangedFiles: vi.fn()` to it — note this in the report.)
- Type consistency: `ChangedFile` defined once in `risk.ts`, reused by `qa.ts`, `github-service.ts`, `octokit-github-service.ts`. `Autonomy`/`MergeAction` in `policy.ts`. `held_for_human` added to `FusionOutcome` (and thus `FusionEvent`).

## Definition of Done (4a)
Orchestrator suite green (risk, policy, qa, getChangedFiles, runFusion gate) + tsc clean. The merge brain exists and is unit-tested; `runFusion` can gate merges. **4b** wires it into the app activity (assemble gate from `repos.autonomy` + getChangedFiles + classifyDiff + decideMerge + QA), adds the `held_for_human` thread card, and a `repos.autonomy` column. Real browser-QA execution and the K8s/gVisor isolation remain infra-bound follow-ups.
