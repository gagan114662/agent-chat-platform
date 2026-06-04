import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { memoryNodes } from "../db/schema.js";
import { createEdge } from "./memory.js";

export interface Cluster { ids: string[]; terms: string[]; kind: string; }
export interface Synthesized { label: string; body: string; }
export type Synthesizer = (members: { kind: string; label: string; body: string }[]) => Synthesized;

const STOP = new Set(["this", "that", "with", "from", "into", "have", "will", "your", "when", "then", "than", "they", "them", "uses", "use", "the", "and", "for"]);
function terms(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !STOP.has(t)))];
}

// clusterNodes groups raw nodes that share >= 2 significant terms (greedy union-find,
// transitive). Only clusters of size >= 2 are returned (a lone memory needs no
// consolidation). Member ids within each cluster are sorted for a deterministic id.
export function clusterNodes(nodes: { id: string; kind: string; label: string; body: string }[]): Cluster[] {
  const toks = new Map<string, Set<string>>();
  for (const n of nodes) toks.set(n.id, new Set([...terms(n.label), ...terms(n.body ?? "")]));

  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n.id, n.id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // path compression
    let c = x;
    while (parent.get(c) !== r) { const next = parent.get(c)!; parent.set(c, r); c = next; }
    return r;
  };
  const union = (x: string, y: string): void => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = toks.get(nodes[i].id)!, b = toks.get(nodes[j].id)!;
      let shared = 0;
      for (const t of a) if (b.has(t)) shared++;
      if (shared >= 2) union(nodes[i].id, nodes[j].id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n.id);
    const g = groups.get(r);
    if (g) g.push(n.id); else groups.set(r, [n.id]);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  return [...groups.values()].filter((ids) => ids.length >= 2).map((ids) => {
    const sorted = [...ids].sort();
    const members = sorted.map((id) => byId.get(id)!);
    const allTerms = [...new Set(members.flatMap((m) => [...terms(m.label), ...terms(m.body ?? "")]))];
    return { ids: sorted, terms: allTerms, kind: members[0].kind };
  });
}

// defaultSynthesize: deterministic heuristic (no LLM) — a higher-order summary of the cluster.
export const defaultSynthesize: Synthesizer = (members) => ({
  label: `Consolidated: ${members.map((m) => m.label).join("; ").slice(0, 120)}`,
  body: members.map((m) => `- (${m.kind}) ${m.label}${m.body ? `: ${m.body}` : ""}`).join("\n"),
});

function consolidatedId(orgId: string, ids: string[]): string {
  return "mem-dream-" + createHash("sha256").update(orgId + "|" + ids.join(",")).digest("hex").slice(0, 24);
}

export interface ConsolidateResult { created: number; clusters: number; }

// consolidate reads the org's RAW nodes (excluding prior dream nodes), clusters them,
// and for each cluster writes ONE higher-order node (deterministic id → idempotent)
// with `consolidates` edges to its sources. synthesize is injectable.
export async function consolidate(
  db: DB, orgId: string, opts: { synthesize?: Synthesizer } = {},
): Promise<ConsolidateResult> {
  const synth = opts.synthesize ?? defaultSynthesize;
  const raw = (await db.select().from(memoryNodes).where(eq(memoryNodes.orgId, orgId)))
    .filter((n) => !(n.metadata as { dream?: boolean })?.dream); // don't consolidate dream nodes
  const clusters = clusterNodes(raw.map((n) => ({ id: n.id, kind: n.kind, label: n.label, body: n.body ?? "" })));
  let created = 0;
  for (const c of clusters) {
    const id = consolidatedId(orgId, c.ids);
    const exists = await db.select({ id: memoryNodes.id }).from(memoryNodes).where(and(eq(memoryNodes.orgId, orgId), eq(memoryNodes.id, id)));
    if (exists.length > 0) continue; // idempotent
    const members = c.ids.map((mid) => raw.find((r) => r.id === mid)!).map((m) => ({ kind: m.kind, label: m.label, body: m.body ?? "" }));
    const s = synth(members);
    await db.insert(memoryNodes).values({
      id, orgId, kind: c.kind, scope: "org", label: s.label, body: s.body,
      metadata: { dream: true, consolidatedFrom: c.ids },
    }).onConflictDoNothing();
    for (const mid of c.ids) await createEdge(db, { orgId, fromId: id, toId: mid, relation: "consolidates" });
    created++;
  }
  return { created, clusters: clusters.length };
}
