import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { classifyDiff, type ChangedFile } from "@acp/orchestrator/policy/risk.js";
import { needsUiQa, makeQaRunner, type QaRunner } from "@acp/orchestrator/policy/qa.js";
import { decideMerge, type Autonomy } from "@acp/orchestrator/policy/policy.js";
import { scanDiff } from "../quality/evals.js";

export interface GateOpts { owner: string; repo: string; autonomy: Autonomy; qaRunner?: QaRunner; }

// #145/#151: a merge must not ship a FAKE product or a leaked secret. The quality
// harness scans the diff's PRODUCTION files for placeholders (example.com, TODO,
// STRIPE_PAYMENT_LINK_HERE…) and leaked secrets; a blocking failure holds the PR
// for a human instead of auto-merging.
export function placeholderBlock(files: ChangedFile[]): { blocked: boolean; reason: string } {
  const blocking = scanDiff(files).filter((f) => f.severity === "block");
  return blocking.length ? { blocked: true, reason: `${blocking[0].reason} — needs real values before merge` } : { blocked: false, reason: "" };
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
