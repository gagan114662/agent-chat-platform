import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agents, repos } from "../db/schema.js";

export async function resolveMention(db: DB, orgId: string, handle: string) {
  const [a] = await db.select().from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.handle, handle.toLowerCase())));
  return a;
}

export async function isPermittedOnRepo(db: DB, agentId: string, repoId: string) {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId));
  const [r] = await db.select().from(repos).where(eq(repos.id, repoId));
  if (!a || !r) return false;
  if (a.orgId !== r.orgId) return false;            // never cross-org
  return a.shared || a.workspaceId === r.workspaceId; // #28: shared → any workspace in the org
}

// #28: toggle an agent's `shared` flag (org-scoped). Returns the updated agent,
// or undefined if no agent with that id exists in the org.
export async function setAgentShared(db: DB, { orgId, agentId, shared }: { orgId: string; agentId: string; shared: boolean }) {
  const [a] = await db.update(agents).set({ shared })
    .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)))
    .returning();
  return a;
}
