# Plan 63 — Agent browser QA: real Playwright runner (#65)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** replace the `passThroughQa` stub (the 2nd functional stub from the #47 scan) with a **real** browser QA runner. A `BrowserDriver` interface (goto / consoleErrors / textContent / screenshot) with a **Playwright** impl behind it; the `QaRunner` drives checks (page loads, no console errors, key content present, screenshot captured) and is **fully tested with a fake driver** — no live Chromium in tests. `makeQaRunner()` returns the real runner when `QA_BASE_URL` is configured, else falls back to pass-through. Wired into the merge gate's QA-for-UI seam. The browser binary install + a per-PR preview URL are the documented runtime needs.

**Branch** `plan-63-browser-qa` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: BrowserDriver + QaRunner (tested with a fake)

**Files:** `services/orchestrator/package.json` (add `playwright-core`), `services/orchestrator/src/policy/qa.ts` (extend), Create `src/policy/browser-qa.ts`, `browser-qa.test.ts`
- [ ] **Step 1 — dep:** add `playwright-core` (NOT `playwright` — avoid the auto browser-binary download). `pnpm install`. If the install genuinely cannot fetch it (offline), STOP and report BLOCKED.
- [ ] **Step 2 — `browser-qa.ts`:**
  - `interface BrowserDriver { goto(url): Promise<void>; consoleErrors(): string[]; textContent(): Promise<string>; screenshot(path): Promise<void>; close(): Promise<void>; }`.
  - `playwrightDriver()` → a `BrowserDriver` backed by `playwright-core`'s chromium (launch headless, a page that collects `console` `error` events). (Real impl; not exercised in unit tests.)
  - `browserQaRunner(opts: { baseUrl: string; driverFactory?: () => Promise<BrowserDriver>; screenshotDir?: string }): QaRunner` → `run({ prNumber, branch })`: build the target URL (`baseUrl`, optionally a PR-preview pattern), `goto`, collect console errors, get text content; **pass** if the page loaded with content and no console errors; capture a screenshot; return `{ passed, summary }` (summary lists failures). Uses `driverFactory` (injectable) so tests pass a fake.
- [ ] **Step 3 — `qa.ts`:** `makeQaRunner(): QaRunner` → if `process.env.QA_BASE_URL` set → `browserQaRunner({ baseUrl: QA_BASE_URL })` (real playwright driver); else `passThroughQa` (unchanged fallback, with the clear stub summary). Keep `needsUiQa` + the `QaRunner` interface.
- [ ] **Step 4 — test (`browser-qa.test.ts`):** with a **fake** `driverFactory` (a stub `BrowserDriver`): a clean page (content, no console errors) → `{passed:true}` + screenshot called; a page with a console error → `{passed:false}` + the error in the summary; an empty/blank page → failed ("no content"); a `goto` that throws → failed (gracefully). Assert the right URL was visited. `cd services/orchestrator && pnpm test` + tsc. Commit `feat(orchestrator): real Playwright browser-QA runner (replaces passThroughQa) (#65)`.

## Task 1: wire into the merge gate + docs

**Files:** `services/app/src/fusion/gate.ts` (or wherever `passThroughQa` is consumed), test; `docs/integrations/browser-qa.md`
- [ ] **Step 1 — wire:** find where the QA runner feeds the merge decision (the gate that uses `needsUiQa` + a `QaRunner`). Swap the hardcoded `passThroughQa` for `makeQaRunner()` so a UI-touching PR runs real browser QA **when `QA_BASE_URL` is configured** (else unchanged pass-through — existing tests stay green since `QA_BASE_URL` is unset in tests). Keep the runner injectable where the gate is tested.
- [ ] **Step 2 — `docs/integrations/browser-qa.md`:** document the runtime needs — `npx playwright install chromium` (the browser binary) + a **preview URL** strategy (`QA_BASE_URL`, e.g. a Vercel preview deploy per PR — ties to #103/#29.2) — and how the QA-for-UI merge gate uses it (UI diff → browser QA must pass before merge).
- [ ] **Step 3 — test:** the gate, given a UI diff + an **injected** QaRunner that fails, holds for human (doesn't merge); a passing runner allows merge. (Reuse the existing gate test harness.) `pnpm test` (orchestrator + app) + tsc. Commit `feat(app): wire real browser-QA into the merge gate (#65)`.

---

## Self-Review
- Closes the #65 stub: a real Playwright-backed QA runner (page load + console errors + content + screenshot) replaces `passThroughQa`, wired into the QA-for-UI merge gate, **fully unit-tested via an injectable fake driver** (no live Chromium needed in CI). Defaults to pass-through when no `QA_BASE_URL` (backward-compatible).
- Backward-compat: `playwright-core` added but the browser launch is lazy/behind the interface; `makeQaRunner` falls back to pass-through when unconfigured so existing tests are unaffected; the gate swap is behavior-preserving without `QA_BASE_URL`. Existing suites green.
- Note: the live browser binary (`playwright install`) + a per-PR preview deploy URL are the runtime prerequisites (documented; ties to #103). The agent can be looped to FIX failing QA via ApplyFeedback (#66) — a follow-up.

## Definition of Done (65)
orchestrator + app suites green; tsc. `browserQaRunner` reports pass/fail from a (faked-in-tests) browser driver — console errors / blank page / goto-failure → failed, clean page → passed + screenshot; `makeQaRunner` uses Playwright when `QA_BASE_URL` set else pass-through; the merge gate uses it (UI diff + failing QA → hold). No more silent pass-through stub when QA is configured.
