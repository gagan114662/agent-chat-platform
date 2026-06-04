import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runCheckpoints } from "../db/schema.js";

export interface RecordCheckpointInput {
  orgId: string;
  runId: string;
  label: string;
  branch: string;
  commitSha: string;
}

// Record a checkpoint = a named snapshot of {branch, commitSha} for a run.
// The id is deterministic (`${runId}:cp:${commitSha}`) so feeding the SAME
// commit again (e.g. the fusion sink replaying events) collapses to one row
// (onConflictDoNothing). Idempotent by construction.
export async function recordCheckpoint(db: DB, i: RecordCheckpointInput) {
  const id = `${i.runId}:cp:${i.commitSha}`;
  await db.insert(runCheckpoints).values({
    id, orgId: i.orgId, runId: i.runId, label: i.label, branch: i.branch, commitSha: i.commitSha,
  }).onConflictDoNothing();
  return id;
}

// List a run's checkpoints, org-scoped (#14) and oldest-first.
export async function listCheckpoints(db: DB, orgId: string, runId: string) {
  return db.select().from(runCheckpoints)
    .where(and(eq(runCheckpoints.orgId, orgId), eq(runCheckpoints.runId, runId)))
    .orderBy(asc(runCheckpoints.createdAt), asc(runCheckpoints.id));
}
