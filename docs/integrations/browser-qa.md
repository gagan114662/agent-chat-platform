# Browser QA (Playwright)

When a PR touches UI (`.tsx`, `.jsx`, `.css`, `.scss`, `.html`, `.svelte`, `.vue`
— see `needsUiQa`), the merge gate runs a **real browser QA pass** before merge.
The runner navigates the PR's preview deploy, checks the page loaded with
content and **no console errors**, and captures a screenshot. If QA fails, the
gate holds the PR for a human instead of merging.

## How it wires together

- `services/orchestrator/src/policy/browser-qa.ts` — `BrowserDriver` seam
  (`goto` / `consoleErrors` / `textContent` / `screenshot` / `close`), the
  Playwright-backed `playwrightDriver()`, and `browserQaRunner()`. The driver is
  injectable, so unit tests exercise the runner with a **fake** driver (no live
  Chromium).
- `services/orchestrator/src/policy/qa.ts` — `makeQaRunner()` returns the real
  browser runner when `QA_BASE_URL` is set, else the pass-through stub.
- `services/app/src/fusion/gate.ts` — `buildMergeGate` calls `makeQaRunner()`
  (overridable via `opts.qaRunner`) and only merges a UI-touching PR when QA
  passes.

## Runtime prerequisites

1. **Browser binary.** `playwright-core` is a dependency, but the Chromium
   binary is not auto-downloaded. Install it once on the runner/CI image:

   ```sh
   npx playwright install chromium
   ```

2. **A preview URL per PR.** Set `QA_BASE_URL` to the base of the deployed app
   to QA. For per-PR preview deploys (e.g. a Vercel preview per PR — ties to
   #103 / #29.2), set `QA_PREVIEW_URL_PATTERN` with `{pr}` and/or `{branch}`
   placeholders:

   ```sh
   export QA_BASE_URL=https://app.example.com
   export QA_PREVIEW_URL_PATTERN=https://pr-{pr}.preview.example.com
   ```

   When `QA_PREVIEW_URL_PATTERN` is unset, the runner targets `QA_BASE_URL`
   directly.

## Default behavior

If `QA_BASE_URL` is **unset**, `makeQaRunner()` returns the pass-through stub and
the gate behaves exactly as before (UI QA is a no-op pass). This keeps existing
environments and tests unaffected until a preview-URL strategy is configured.

## Pass / fail criteria

| Condition                          | Result   |
| ---------------------------------- | -------- |
| Page loads, content present, no console errors | **pass** + screenshot |
| Any `console.error` / page error   | **fail** (errors listed in summary) |
| Blank / empty page                 | **fail** ("page rendered no content") |
| Navigation throws (e.g. URL down)  | **fail** (error message in summary) |

A failing QA result flows into `decideMerge` as `qaPassed: false`, which holds
the PR for a human (`hold_for_human`). Auto-fixing failing QA via ApplyFeedback
(#66) is a follow-up.
