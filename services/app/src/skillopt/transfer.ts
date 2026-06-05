// #136 harness-agnostic skill deployment + cross-agent/model transfer. A skill
// document should be portable — usable by any agent/model/harness — so the
// optimized "skill" isn't locked to one CLI. We detect harness-specific lines
// (tool/CLI/path/model names) and strip them to produce a portable doc to transfer
// to another agent.

// Lines mentioning a specific harness/CLI/model/path are not portable.
const HARNESS_PATTERNS = [
  /\bclaude-code\b/i, /\bcodex\b/i, /\bcursor\b/i, /\bgemini\b/i, /\baider\b/i,
  /--mcp-config/i, /--permission-mode/i, /\/usr\/local\/bin\//, /\bANTHROPIC_|\bOPENAI_|\bCLAUDE_CODE_OAUTH/,
];

export function lineIsHarnessSpecific(line: string): boolean {
  return HARNESS_PATTERNS.some((re) => re.test(line));
}

// isHarnessAgnostic: true when NO line is harness-specific — the doc can deploy
// to any agent/model unchanged.
export function isHarnessAgnostic(doc: string): boolean {
  return doc.split("\n").every((l) => !lineIsHarnessSpecific(l));
}

// transferSkill: strip harness-specific lines, yielding a portable doc to deploy to
// another agent/model. Idempotent; an already-agnostic doc is returned unchanged.
export function transferSkill(doc: string): string {
  return doc.split("\n").filter((l) => !lineIsHarnessSpecific(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
