export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string; // 'added' | 'modified' | 'removed' | 'renamed'
}

export interface RiskOptions { maxLines: number; maxFiles: number; maxNetNegative: number; }
export const DEFAULT_RISK: RiskOptions = { maxLines: 400, maxFiles: 15, maxNetNegative: 200 };

export interface RiskVerdict { decision: "auto" | "human"; reasons: string[]; }

const PROTECTED: { re: RegExp; why: string }[] = [
  { re: /(^|\/)\.github\/workflows\//i, why: "CI workflow" },
  { re: /(^|\/)(Dockerfile|\.circleci\/|deploy\/|k8s\/|terraform\/)/i, why: "infra/deploy config" },
  { re: /(secret|credential|\.env|vault|crypto|(^|\/)auth(\/|\.))/i, why: "auth/secrets/crypto" },
  { re: /(^|\/)migrations?\/|\.sql$/i, why: "database migration" },
  { re: /(package\.json|pnpm-lock\.yaml|go\.mod|go\.sum|requirements\.txt|Cargo\.(toml|lock))$/i, why: "dependency change" },
  { re: /(payment|billing|\bpii\b|ssn)/i, why: "payments/PII" },
];

// Layer-B safety tripwires (spec §5): any hit forces a human gate.
export function classifyDiff(input: { files: ChangedFile[] }, opts: RiskOptions = DEFAULT_RISK): RiskVerdict {
  const reasons: string[] = [];
  const total = input.files.reduce((s, f) => s + f.additions + f.deletions, 0);
  const net = input.files.reduce((s, f) => s + f.additions - f.deletions, 0);
  if (total > opts.maxLines) reasons.push(`diff size ${total} > ${opts.maxLines} lines`);
  if (input.files.length > opts.maxFiles) reasons.push(`${input.files.length} files > ${opts.maxFiles}`);
  if (net < -opts.maxNetNegative) reasons.push(`large net-negative diff (${net})`);
  for (const file of input.files) {
    if (file.status === "removed") reasons.push(`file deleted: ${file.filename}`);
    for (const p of PROTECTED) if (p.re.test(file.filename)) reasons.push(`${p.why}: ${file.filename}`);
  }
  const uniq = [...new Set(reasons)];
  return { decision: uniq.length > 0 ? "human" : "auto", reasons: uniq };
}
