import type { ChangedFile } from "./risk.js";
import { browserQaRunner } from "./browser-qa.js";

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

// Selects the QA runner from the environment: when `QA_BASE_URL` is configured,
// returns the real Playwright-backed browser QA runner (optionally with a
// per-PR preview URL pattern via `QA_PREVIEW_URL_PATTERN`); otherwise falls back
// to the pass-through stub so behavior is unchanged when QA is not configured.
export function makeQaRunner(): QaRunner {
  const baseUrl = process.env.QA_BASE_URL;
  if (!baseUrl) return passThroughQa;
  return browserQaRunner({ baseUrl, previewUrlPattern: process.env.QA_PREVIEW_URL_PATTERN });
}
