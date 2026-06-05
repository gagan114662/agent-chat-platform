import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { classifyDiff, type ChangedFile } from "@acp/orchestrator/policy/risk.js";
import { needsUiQa, makeQaRunner, type QaRunner } from "@acp/orchestrator/policy/qa.js";
import { decideMerge, type Autonomy } from "@acp/orchestrator/policy/policy.js";

export interface GateOpts { owner: string; repo: string; autonomy: Autonomy; qaRunner?: QaRunner; }

// #145: a merge must not ship a FAKE product. Agents have shipped placeholder
// Stripe links (pay.example.com), TODOs, and "replace before launch" notes and
// reported "done". Scan ADDED lines of PRODUCTION files (not docs/tests) for
// placeholder markers; if any survive, the PR is held for a human instead of
// auto-merged — turning a fake "done" into a visible blocker.
const PLACEHOLDER = [
  /example\.com/i, /\bTODO\b/, /\bFIXME\b/, /<\s*placeholder/i, /pay\.example/i,
  /replace before launch/i, /your[-_].*[-_]here/i, /lorem ipsum/i, /changeme/i, /\bXXXX+\b/,
];
const NON_PRODUCTION = /(\.md$|\.txt$|readme|license|changelog|\/test|test\/|\.test\.|\.spec\.|__tests__|fixture|\.stories\.)/i;

export function placeholderBlock(files: ChangedFile[]): { blocked: boolean; reason: string } {
  for (const f of files) {
    if (NON_PRODUCTION.test(f.filename) || !f.patch) continue;
    const added = f.patch.split("\n").filter((l: string) => l.startsWith("+") && !l.startsWith("+++"));
    for (const line of added) {
      const hit = PLACEHOLDER.find((re) => re.test(line));
      if (hit) return { blocked: true, reason: `placeholder/TODO left in production file ${f.filename} — needs real values before merge` };
    }
  }
  return { blocked: false, reason: "" };
}

// Assembles the Plan-4a engine into a runFusion mergeGate: on green, fetch the
// PR's changed files, classify risk, run real browser QA if UI is touched (via
// makeQaRunner — Playwright when QA_BASE_URL is set, else pass-through), and
// apply the repo's autonomy dial to decide merge vs. hold-for-human.
export function buildMergeGate(github: Pick<GitHubService, "getChangedFiles">, opts: GateOpts) {
  const qaRunner = opts.qaRunner ?? makeQaRunner();
  return async (info: { prNumber: number; prUrl: string; commitSha: string; branch: string }) => {
    const files = await github.getChangedFiles(opts.owner, opts.repo, info.prNumber);
    // #145: never auto-merge a fake product — a surviving placeholder/TODO in a
    // production file holds the PR for a human (who then knows the real blocker).
    const ph = placeholderBlock(files);
    if (ph.blocked) return { merge: false, reason: ph.reason };
    const risk = classifyDiff({ files });
    const qaRequired = needsUiQa(files);
    const qa = qaRequired ? await qaRunner.run({ prNumber: info.prNumber, branch: info.branch }) : { passed: true, summary: "" };
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
