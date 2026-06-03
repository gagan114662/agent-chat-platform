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
  return !!a && !!r && a.workspaceId === r.workspaceId;
}
