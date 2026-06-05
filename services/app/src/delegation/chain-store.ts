import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { delegationLinks } from "../db/schema.js";
import { accountableHuman, type DelegationChain, type DelegationLink } from "./chain.js";

// #130 persistence for the auditable delegation chain. Each hand-off is recorded;
// chainForTask reconstructs the ordered chain + the accountable human (chain.ts).

export async function recordLink(db: DB, l: { orgId: string; taskId: string; byKind: "human" | "agent"; byId: string; toKind: "human" | "agent"; toId: string }) {
  await db.insert(delegationLinks).values({ id: randomUUID(), ...l });
}

export async function chainForTask(db: DB, orgId: string, taskId: string): Promise<{ chain: DelegationChain; accountableHuman: string | null }> {
  const rows = await db.select().from(delegationLinks)
    .where(and(eq(delegationLinks.orgId, orgId), eq(delegationLinks.taskId, taskId)))
    .orderBy(asc(delegationLinks.at));
  const chain: DelegationChain = rows.map((r): DelegationLink => ({
    byKind: r.byKind as "human" | "agent", byId: r.byId,
    toKind: r.toKind as "human" | "agent", toId: r.toId,
    taskId: r.taskId, at: r.at.toISOString(),
  }));
  return { chain, accountableHuman: accountableHuman(chain) };
}
