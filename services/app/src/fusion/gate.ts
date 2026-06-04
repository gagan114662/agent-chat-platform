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
