import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agents } from "../db/schema.js";

// #87 default workspace assistant. Every workspace gets a built-in `iris`
// assistant (claude-code adapter) so users can `@iris` out of the box.
//
// Idempotency: the id is deterministic (`asst:${orgId}:${workspaceId}`) and the
// insert uses onConflictDoNothing — re-calling for the same workspace is a no-op.
//
// Handle uniqueness: the `agents_org_handle_ux` unique index is on (orgId, handle),
// so within ONE org the handle "iris" can exist only once. The deterministic id
// alone does NOT protect against this: a second workspace in the same org would
// have a different id (no PK conflict) but the SAME handle "iris" → unique-index
// violation. So we resolve the handle per call: the first workspace in an org to
// provision gets "iris"; any later workspace in the same org gets a deterministic
// suffixed handle ("iris-<workspaceId>") that stays unique and stable.
export interface EnsureDefaultAssistantInput {
  orgId: string;
  workspaceId: string;
}

export function defaultAssistantId(orgId: string, workspaceId: string): string {
  return `asst:${orgId}:${workspaceId}`;
}

export async function ensureDefaultAssistant(db: DB, input: EnsureDefaultAssistantInput) {
  const id = defaultAssistantId(input.orgId, input.workspaceId);

  // Idempotent fast-path: this workspace's assistant already exists → return it.
  const [existing] = await db.select().from(agents).where(eq(agents.id, id));
  if (existing) return existing;

  // Choose a handle that won't violate the per-org (orgId, handle) unique index.
  // "iris" if free in this org, else a deterministic per-workspace suffix.
  const [irisTaken] = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.orgId, input.orgId), eq(agents.handle, "iris")));
  const handle = irisTaken ? `iris-${input.workspaceId}` : "iris";

  await db.insert(agents).values({
    id,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    handle,
    displayName: "Iris",
    adapter: "claude-code",
    config: {},
  }).onConflictDoNothing();

  // Re-read so concurrent/idempotent callers all return the row that won the insert.
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  return agent;
}
