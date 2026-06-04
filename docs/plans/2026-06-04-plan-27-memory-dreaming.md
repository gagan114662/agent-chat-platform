# Plan 27 — Memory dreaming / offline consolidation (#40)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** OpenAI-style "memory dreaming" (#40) — an offline reflection pass that reads the org's raw memory nodes (captured per run, #26), clusters related ones, and synthesizes **higher-order** memory nodes that summarize a cluster, linked back to their sources via `consolidates` edges. The synthesis step is **injectable** (`synthesize(cluster) → {label, body}`) so it's deterministic in tests and pluggable with an LLM in prod (the production "dream"). Idempotent: re-running doesn't duplicate (deterministic consolidated-node id from the sorted member ids). Triggered on demand via `POST /memory/consolidate`; a scheduled/Temporal cron trigger is a follow-up.

**Branch** `plan-27-memory-dreaming` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `consolidate` (the dreaming pass)

**Files:** Create `services/app/src/memory/dreaming.ts`, `dreaming.test.ts`; uses `src/memory/memory.ts` (createNode/createEdge), `src/db/schema.ts`
- [ ] **Step 1 — `dreaming.ts`:**
```ts
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { memoryNodes, memoryEdges } from "../db/schema.js";
import { createEdge } from "./memory.js";

export interface Cluster { ids: string[]; terms: string[]; kind: string; }
export interface Synthesized { label: string; body: string; }
export type Synthesizer = (members: { kind: string; label: string; body: string }[]) => Synthesized;

const STOP = new Set(["this","that","with","from","into","have","will","your","when","then","than","they","them","uses","use","the","and","for"]);
function terms(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !STOP.has(t)))];
}

// clusterNodes groups raw nodes that share >= 2 significant terms (greedy union).
// Only clusters of size >= 2 are returned (a lone memory needs no consolidation).
export function clusterNodes(nodes: { id: string; kind: string; label: string; body: string }[]): Cluster[] {
  const toks = new Map<string, Set<string>>();
  for (const n of nodes) toks.set(n.id, new Set([...terms(n.label), ...terms(n.body ?? "")]));
  const parent = new Map<string, string>();
  const find = (x: string): string => (parent.get(x) === x || !parent.get(x) ? (parent.set(x, parent.get(x) ?? x), parent.get(x)!) : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  for (const n of nodes) parent.set(n.id, n.id);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = toks.get(nodes[i].id)!, b = toks.get(nodes[j].id)!;
      let shared = 0; for (const t of a) if (b.has(t)) shared++;
      if (shared >= 2) parent.set(find(nodes[i].id), find(nodes[j].id));
    }
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) { const r = find(n.id); (groups.get(r) ?? groups.set(r, []).get(r)!).push(n.id); }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return [...groups.values()].filter((ids) => ids.length >= 2).map((ids) => {
    const members = ids.map((id) => byId.get(id)!);
    const allTerms = [...new Set(members.flatMap((m) => [...terms(m.label), ...terms(m.body ?? "")]))];
    return { ids: ids.sort(), terms: allTerms, kind: members[0].kind };
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
    .filter((n) => !(n.metadata as any)?.dream); // don't consolidate dream nodes
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
```
  (Adjust the union-find helper to compile cleanly — a plain iterative find is fine; the key behaviors are: shared≥2 terms → same cluster, size≥2 only.)
- [ ] **Step 2 — `dreaming.test.ts`:**
  - `clusterNodes`: 3 nodes where two share ≥2 terms ("postgres listen notify realtime" + "realtime notify via postgres") and one unrelated ("scrypt password hashing") → one cluster of the two, the loner excluded.
  - `consolidate` (seeded DB, org-A): seed 2 related + 1 unrelated raw nodes; `consolidate(db,"o1",{synthesize: fake})` → `created: 1`; a new node with `metadata.dream===true` + `consolidatedFrom` of the 2 ids exists; 2 `consolidates` edges created; the fake synthesizer received the 2 members. **Idempotent:** a SECOND `consolidate` → `created: 0` (deterministic id). Org-B nodes never pulled in (org-scoped).
  - `DATABASE_URL=… pnpm test -- dreaming` green. Commit `feat(app): memory dreaming — offline consolidation of related memories (#40)`.

## Task 1: `POST /memory/consolidate` route

**Files:** `services/app/src/http/memory-routes.ts`, `memory-routes.test.ts`
- [ ] **Step 1:** add `POST /memory/consolidate` → `actor(req).orgId`; `const r = await consolidate(db, orgId)` (default heuristic synthesizer); return `r` (`{ created, clusters }`). (Admin-gate is optional now; org-scoping is the security boundary.)
- [ ] **Step 2 — test:** seed org-A related nodes; POST → `{ created: >=1, clusters: >=1 }`; the dream node is then visible via `GET /memory/nodes`; a second POST → `created: 0`. Cross-org isolated. `DATABASE_URL=… pnpm test` + `pnpm exec tsc --noEmit -p tsconfig.json`. Commit `feat(app): POST /memory/consolidate (on-demand dreaming) (#40)`.

---

## Self-Review
- Delivers #40: an offline reflection pass that consolidates clusters of raw memories into higher-order nodes with `consolidates` edges, idempotent, org-scoped, injectable synthesis (LLM-pluggable). The recalled-context path (#26) will surface these higher-order nodes too.
- Backward-compat: additive (new module + one route); dream nodes are marked (`metadata.dream`) and excluded from re-consolidation; existing memory CRUD/recall unaffected. Org-scoped (#14).
- Note: the production "dream" plugs an LLM synthesizer in place of `defaultSynthesize`; a scheduled/Temporal-cron trigger (nightly per org) is a thin follow-up on `consolidate` + the route.

## Definition of Done (40)
app suite green + tsc. `consolidate` clusters related org memories and writes idempotent higher-order `dream` nodes with `consolidates` edges; `POST /memory/consolidate` runs it on demand and is org-scoped; re-running creates nothing new.
