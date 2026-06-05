import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { skillDocuments } from "../db/schema.js";

// #131 versioned agent skill documents — external, trainable state. Each save is a
// new immutable version; the latest is injected into the agent's run intent so the
// document is the agent's optimizable "skill" that improves over time.

export async function latestSkill(db: DB, orgId: string, agentId: string) {
  const [row] = await db.select().from(skillDocuments)
    .where(and(eq(skillDocuments.orgId, orgId), eq(skillDocuments.agentId, agentId)))
    .orderBy(desc(skillDocuments.version)).limit(1);
  return row ?? null;
}

export async function listSkillVersions(db: DB, orgId: string, agentId: string) {
  return db.select().from(skillDocuments)
    .where(and(eq(skillDocuments.orgId, orgId), eq(skillDocuments.agentId, agentId)))
    .orderBy(desc(skillDocuments.version));
}

// saveSkillVersion appends a new version (latest.version + 1), never mutating prior
// versions — the document is an append-only, optimizable artifact.
export async function saveSkillVersion(db: DB, orgId: string, agentId: string, content: string) {
  const latest = await latestSkill(db, orgId, agentId);
  const version = (latest?.version ?? 0) + 1;
  const [row] = await db.insert(skillDocuments)
    .values({ id: randomUUID(), orgId, agentId, version, content })
    .returning();
  return row;
}
