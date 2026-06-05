// #115 payment reconciliation: cross-check the human decision log (#114) against
// the payments that actually executed, and flag anomalies. Pure + testable — the
// caller supplies the executed-transfer ledger (from the payments provider).

export interface DecisionRow {
  id: string;
  recipient?: string | null;
  amountCents: number;
  decision: string; // approve | decline | modify
}

export interface ExecutedTransfer {
  id: string;
  recipient: string;
  amountCents: number;
}

export interface Reconciliation {
  // Money moved with no matching approve/modify decision — the dangerous case.
  executedWithoutApproval: ExecutedTransfer[];
  // Approved but never executed — a stuck/failed payment to chase.
  approvedNotExecuted: DecisionRow[];
  // Totals for the audit summary.
  totalExecutedCents: number;
  totalApprovedCents: number;
}

const key = (recipient: string, cents: number) => `${(recipient || "").trim().toLowerCase()}#${cents}`;

export function reconcile(decisions: DecisionRow[], executed: ExecutedTransfer[]): Reconciliation {
  // An executed transfer is "covered" by an approve/modify decision with the same
  // recipient + amount (modify uses the modified amount via amountCents already).
  const approvals = decisions.filter((d) => d.decision === "approve" || d.decision === "modify");
  const approvedKeys = new Map<string, number>();
  for (const a of approvals) approvedKeys.set(key(a.recipient ?? "", a.amountCents), (approvedKeys.get(key(a.recipient ?? "", a.amountCents)) ?? 0) + 1);

  const executedKeys = new Map<string, number>();
  for (const e of executed) executedKeys.set(key(e.recipient, e.amountCents), (executedKeys.get(key(e.recipient, e.amountCents)) ?? 0) + 1);

  const executedWithoutApproval = executed.filter((e) => (approvedKeys.get(key(e.recipient, e.amountCents)) ?? 0) === 0);
  const approvedNotExecuted = approvals.filter((a) => (executedKeys.get(key(a.recipient ?? "", a.amountCents)) ?? 0) === 0);

  return {
    executedWithoutApproval,
    approvedNotExecuted,
    totalExecutedCents: executed.reduce((s, e) => s + e.amountCents, 0),
    totalApprovedCents: approvals.reduce((s, a) => s + a.amountCents, 0),
  };
}
