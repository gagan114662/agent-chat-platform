import type { ChangedFile } from "@acp/orchestrator/policy/risk.js";

export interface Suspect {
  file: string;
  reason: string;
}

// Paths that are inherently risky when changed — a hit makes a file a stronger
// suspect even when the CI failure context doesn't name it. Mirrors the spirit of
// the orchestrator's risk PROTECTED list, but framed as "likely culprit" reasons.
const PROTECTED: { re: RegExp; why: string }[] = [
  { re: /(^|\/)\.github\/workflows\//i, why: "touches CI config" },
  { re: /(^|\/)(Dockerfile|\.circleci\/|deploy\/|k8s\/|terraform\/)/i, why: "touches infra/deploy config" },
  { re: /(package\.json|pnpm-lock\.yaml|go\.mod|go\.sum|requirements\.txt|Cargo\.(toml|lock))$/i, why: "touches dependency manifest" },
  { re: /(^|\/)migrations?\/|\.sql$/i, why: "touches database migration" },
];

// Extract candidate tokens from the CI failure context: file basenames/paths and
// bare identifiers. Lowercased for case-insensitive matching.
function failureTokens(failureContext: string): Set<string> {
  const tokens = new Set<string>();
  const re = /[A-Za-z0-9_./-]+/g;
  for (const m of failureContext.match(re) ?? []) {
    const t = m.toLowerCase();
    if (t.length >= 2) tokens.add(t);
  }
  return tokens;
}

// Does the failure context mention this file (by full path or basename)?
function mentionedIn(failureContext: string, filename: string, tokens: Set<string>): boolean {
  const lower = failureContext.toLowerCase();
  const path = filename.toLowerCase();
  if (lower.includes(path)) return true;
  const base = path.split("/").pop() ?? path;
  if (base && lower.includes(base)) return true;
  // basename without extension (e.g. "auth" from "auth.ts") appearing as a token
  const stem = base.replace(/\.[^.]+$/, "");
  if (stem.length >= 3 && tokens.has(stem)) return true;
  return false;
}

// rankCulprits — PURE: given the CI failure context string and the run's changed
// files, rank the files by likelihood of having caused the failure. A file scores
// higher when the failure context names it (or a symbol/basename in it), when it
// touches a protected/risky path (CI/infra/deps/migrations), or when it's the
// largest diff. Returns ranked suspects each with a human-readable reason. No IO.
export function rankCulprits(failureContext: string, files: ChangedFile[]): Suspect[] {
  const tokens = failureTokens(failureContext ?? "");
  const maxChurn = Math.max(0, ...files.map((f) => f.additions + f.deletions));

  const scored = files.map((f, idx) => {
    const churn = f.additions + f.deletions;
    let score = 0;
    const reasons: string[] = [];

    if (mentionedIn(failureContext ?? "", f.filename, tokens)) {
      score += 100;
      reasons.push("mentioned in CI failure");
    }
    for (const p of PROTECTED) {
      if (p.re.test(f.filename)) {
        score += 20;
        reasons.push(p.why);
        break;
      }
    }
    if (maxChurn > 0 && churn === maxChurn) {
      score += 10;
      reasons.push("largest diff");
    }
    if (reasons.length === 0) reasons.push("changed in this run");

    return { file: f.filename, reason: reasons.join("; "), score, churn, idx };
  });

  // Stable, deterministic ordering: score desc, then churn desc, then original order.
  scored.sort((a, b) => b.score - a.score || b.churn - a.churn || a.idx - b.idx);

  return scored.map(({ file, reason }) => ({ file, reason }));
}
