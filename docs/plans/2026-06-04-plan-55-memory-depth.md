# Plan 55 — Memory depth: provenance, versioning, invalidation, contradicts (#82)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat's memory graph is deeper than ours (#26). Add the lifecycle layer: **provenance** (`derived_from` edges), **versioning + optimistic locking** (`supersedeNode` with an expected version), **invalidation/revalidation** (`status`), and **`contradicts` edges** — and make recall (#26) exclude non-active nodes. Embedding/semantic retrieval needs pgvector + an embedder → documented follow-up; this delivers the structural depth.

**Branch** `plan-55-memory-depth` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: schema + memory lifecycle

**Files:** `services/app/src/db/schema.ts` + next migration (`0023_memory_lifecycle.sql`), `src/memory/memory.ts` (+ a `memory-lifecycle.ts` if cleaner), `memory.test.ts`
- [ ] **Step 1 — schema/migration:** add to `memory_nodes`: `version` (integer, default 1), `status` (text, default `"active"` — `active|invalidated|superseded`). (Edges already support arbitrary `relation` strings, so `derived_from`/`contradicts`/`supersedes` need no schema change.) `pnpm db:migrate`.
- [ ] **Step 2 — `memory.ts` additions:**
  - `createNode` gains optional `derivedFrom?: string[]` → after insert, create a `derived_from` edge from the new node to each source id (org-scoped).
  - `supersedeNode(db, { orgId, oldId, expectedVersion, newNode })` → load `oldId` (org-scoped); if `oldId.version !== expectedVersion` → throw `"version conflict"` (optimistic lock); set old `status="superseded"`; `createNode(newNode with version = old.version + 1)`; add a `supersedes` edge new→old. Return the new node.
  - `invalidateNode(db, orgId, id)` (`status="invalidated"`) + `revalidateNode(db, orgId, id)` (`status="active"`).
  - `addContradiction(db, { orgId, fromId, toId })` → a `contradicts` edge.
  - **recall:** update `recallForIntent` + `listNodes`/`searchNodes` to filter `status = "active"` by default (an `includeInactive` option to see all). (`graph`/`neighbors` likewise default to active.)
- [ ] **Step 3 — test:** `createNode({derivedFrom:[a]})` → a `derived_from` edge exists; `supersedeNode` with the right version → old superseded + new version 2 + a `supersedes` edge; wrong `expectedVersion` → throws "version conflict"; `invalidateNode` then `recallForIntent`/`listNodes` exclude it (and `includeInactive` shows it); `addContradiction` creates the edge; all org-scoped. `DATABASE_URL=… pnpm test -- memory` + tsc. Commit `feat(app): memory lifecycle — provenance/versioning/invalidation/contradicts (#82)`.

## Task 1: routes

**Files:** `services/app/src/http/memory-routes.ts` (extend), `memory-routes.test.ts`
- [ ] Add: `POST /memory/nodes/:id/supersede { expectedVersion, node }` (409 on version conflict), `POST /memory/nodes/:id/invalidate`, `POST /memory/nodes/:id/revalidate`, `POST /memory/contradictions { fromId, toId }`. Org-scoped (404). Optionally extend the node-create route to accept `derivedFrom`. Test via `app.inject`: supersede happy-path + 409 on stale version; invalidate hides from `GET /memory`/recall; contradiction edge created; cross-org → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): memory lifecycle routes (supersede/invalidate/contradict) (#82)`.

---

## Self-Review
- Delivers #82's structural depth: provenance edges, optimistic-locked versioning via supersede, invalidation/revalidation, contradicts edges, and recall that only surfaces active nodes — closing the gap vs reload's memory lifecycle (on top of #26 capture + #40 dreaming).
- Backward-compat: `version`/`status` defaulted (existing nodes → version 1/active); recall now filters active (existing active nodes unaffected); edge relations were already free-form. Migration additive. Existing memory tests green (active nodes still returned).
- Note: semantic/embedding retrieval (pgvector + an embedder) + automatic contradiction detection are follow-ups; this delivers the deterministic lifecycle.

## Definition of Done (82)
app suite green; tsc; migration applies. Nodes carry version+status; `supersedeNode`/route enforces optimistic lock (409 on conflict); invalidate/revalidate toggles visibility; recall/list default to active; provenance + contradicts edges supported; org-scoped.
