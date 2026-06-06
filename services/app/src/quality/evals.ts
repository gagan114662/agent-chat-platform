import type { ChangedFile } from "@acp/orchestrator/policy/risk.js";

// #151 agent quality harness. Before an agent's output is accepted/merged, run
// automatic evals: scan production files for placeholders + leaked secrets, and
// check the deliverable actually covers the acceptance criteria. A blocking failure
// holds the PR for a human (vs. merging fake/bad work). This generalizes the #145
// placeholder gate into a reusable harness that also catches secret leakage and
// criteria gaps — the failures that "merged + reported done" used to hide.

export interface EvalFailure { check: string; severity: "block" | "warn"; reason: string }
export interface EvalResult { pass: boolean; score: number; failures: EvalFailure[] }

const PLACEHOLDER = [
  /example\.com/i, /\bTODO\b/, /\bFIXME\b/, /<\s*placeholder/i, /pay\.example/i,
  /replace before launch/i, /your[-_].*[-_]here/i, /lorem ipsum/i, /changeme/i, /\bXXXX+\b/,
  /STRIPE_PAYMENT_LINK_HERE/i, /INSERT_.*_HERE/i,
];
// Leaked credentials must NEVER merge.
const SECRET = [
  /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /\bsk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{10,}/,
];
const NON_PRODUCTION = /(\.md$|\.txt$|readme|license|changelog|\/test|test\/|\.test\.|\.spec\.|__tests__|fixture|\.stories\.|\.env\.example)/i;

// #156 a DEAD purchase CTA: a buy/checkout/pay control wired to a dead target
// (href="#", empty, or javascript:void) — the "placeholder Buy link" failure mode.
// Named-placeholder URLs (CHECKOUT_URL_HERE etc.) are already caught by PLACEHOLDER;
// this catches the structurally-dead ones. CTA word + dead target on the same line.
const CTA_WORD = /\b(buy(\s*now)?|check\s*out|checkout|pay(\s*now)?|purchase|subscribe|order\s*now|add\s*to\s*cart|complete\s*(your\s*)?(purchase|order|payment))\b/i;
const DEAD_TARGET = /(href|formaction|action|data-href|to)\s*=\s*["'](\s*#?\s*|javascript:\s*(void\s*\(\s*0?\s*\)|;)\s*)["']/i;

function addedLines(f: ChangedFile): string[] {
  if (!f.patch) return [];
  return f.patch.split("\n").filter((l: string) => l.startsWith("+") && !l.startsWith("+++"));
}

// scanDiff: placeholder + secret + dead-CTA failures across the diff's PRODUCTION files.
export function scanDiff(files: ChangedFile[]): EvalFailure[] {
  const out: EvalFailure[] = [];
  for (const f of files) {
    const prod = !NON_PRODUCTION.test(f.filename);
    for (const line of addedLines(f)) {
      for (const re of SECRET) if (re.test(line)) out.push({ check: "secret-scan", severity: "block", reason: `possible leaked secret in ${f.filename}` });
      if (prod) for (const re of PLACEHOLDER) if (re.test(line)) { out.push({ check: "placeholder", severity: "block", reason: `placeholder/TODO in production file ${f.filename}` }); break; }
      if (prod && CTA_WORD.test(line) && DEAD_TARGET.test(line)) out.push({ check: "dead-cta", severity: "block", reason: `dead purchase CTA (buy/checkout link goes nowhere) in ${f.filename}` });
    }
  }
  // de-dupe identical reasons
  return out.filter((v, i) => out.findIndex((o) => o.reason === v.reason && o.check === v.check) === i);
}

// criteriaCoverage: each acceptance-criterion line should be visibly addressed in the
// deliverable (a keyword-overlap heuristic; an LLM-judge via the gateway is the
// stronger upgrade). A criterion with no meaningful overlap is a WARN, not a hard
// block (heuristic), so it surfaces without false-blocking.
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "a", "an", "to", "of", "in", "on", "is", "it"]);
export function criteriaCoverage(deliverable: string, criteria: string): EvalFailure[] {
  const text = deliverable.toLowerCase();
  const out: EvalFailure[] = [];
  for (const line of criteria.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean)) {
    const terms = line.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t));
    if (terms.length === 0) continue;
    const hit = terms.filter((t) => text.includes(t)).length;
    if (hit / terms.length < 0.34) out.push({ check: "criteria-coverage", severity: "warn", reason: `criterion may be unaddressed: "${line}"` });
  }
  return out;
}

// evaluate: run the harness. pass = no BLOCK failures. score = 1 - blocks*0.5 - warns*0.1 (clamped).
export function evaluate(input: { files?: ChangedFile[]; deliverable?: string; criteria?: string }): EvalResult {
  const failures: EvalFailure[] = [];
  if (input.files) failures.push(...scanDiff(input.files));
  if (input.deliverable && input.criteria) failures.push(...criteriaCoverage(input.deliverable, input.criteria));
  const blocks = failures.filter((f) => f.severity === "block").length;
  const warns = failures.filter((f) => f.severity === "warn").length;
  return { pass: blocks === 0, score: Math.max(0, 1 - blocks * 0.5 - warns * 0.1), failures };
}
