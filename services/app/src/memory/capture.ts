import type { DB } from "../db/client.js";
import { createNode } from "./memory.js";

export interface DecisionInput {
  orgId: string; runId: string; agentId: string; threadId: string;
  intent: string; outcome: string; prNumber?: number;
}

// "Every decision is captured automatically": one decision memory node per terminal Run.
// Best-effort — must never fail a run.
export async function captureDecision(db: DB, d: DecisionInput): Promise<void> {
  try {
    const pr = d.prNumber ? ` PR #${d.prNumber}` : "";
    await createNode(db, {
      orgId: d.orgId, kind: "decision", scope: "org",
      label: `${d.outcome}${pr}: ${d.intent}`.slice(0, 200),
      body: d.intent,
      metadata: { runId: d.runId, agentId: d.agentId, threadId: d.threadId, outcome: d.outcome, prNumber: d.prNumber },
    });
  } catch (e) {
    console.warn(`memory: failed to capture decision for run ${d.runId}:`, (e as Error).message);
  }
}
