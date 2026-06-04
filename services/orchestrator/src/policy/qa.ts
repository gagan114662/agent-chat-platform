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
