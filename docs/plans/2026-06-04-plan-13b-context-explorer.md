# Plan 13b — Context Explorer UI (memory graph)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** The visible half of the memory graph (Plan 13): a **Context Explorer** in `services/web` — reload.chat's "Context Explorer · N memories · M edges" view. Adds a small `GET /memory/graph` endpoint (nodes+edges), web API + a `useMemory` hook, a presentational `ContextExplorer` (stats header, Personal/Project/Team/Org + kind filter chips, an SVG node-edge graph with deterministic circular layout, node selection → detail/neighbors), and wires a "Context" view switch into `App`/`Sidebar`. Reuses the reload brand tokens.

**Tech Stack:** TS — services/app (one route) + services/web (UI). Branch `plan-13b-context-explorer` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `GET /memory/graph` (backend)

**Files:** Modify `services/app/src/memory/memory.ts`, `src/memory/memory.test.ts`, `src/http/memory-routes.ts`, `src/http/memory-routes.test.ts`

- [ ] **Step 1: add `graph()` to `memory.ts`** (append; reuse `listNodes` + `memoryEdges`/`eq`):
```ts
export interface MemoryGraph { nodes: Awaited<ReturnType<typeof listNodes>>; edges: { id: string; fromId: string; toId: string; relation: string }[]; }

// Returns the org's nodes (optionally filtered) + the edges among those nodes.
export async function graph(db: DB, orgId: string, filter: { kind?: NodeKind; scope?: Scope } = {}): Promise<MemoryGraph> {
  const nodes = await listNodes(db, orgId, filter);
  const ids = new Set(nodes.map((n) => n.id));
  const all = await db.select().from(memoryEdges).where(eq(memoryEdges.orgId, orgId));
  const edges = all
    .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
    .map((e) => ({ id: e.id, fromId: e.fromId, toId: e.toId, relation: e.relation }));
  return { nodes, edges };
}
```
- [ ] **Step 2: add a memory.test.ts case** — `graph("o1")` returns the nodes + only edges whose both endpoints are in the node set; filtering by `kind` narrows nodes and drops dangling edges.
- [ ] **Step 3: add the route in `memory-routes.ts`** (import `graph`):
```ts
  app.get("/memory/graph", async (req) => {
    const { orgId } = actor(req);
    const { kind, scope } = req.query as { kind?: NodeKind; scope?: Scope };
    return graph(d.db, orgId, { kind, scope });
  });
```
- [ ] **Step 4: add a memory-routes.test.ts case** — `GET /memory/graph` returns `{nodes,edges}` (create 2 nodes + 1 edge, assert shape). Run `DATABASE_URL=... pnpm test -- memory` → green; suite + tsc clean.
- [ ] **Step 5: commit**
```bash
git add services/app/src/memory/memory.ts services/app/src/memory/memory.test.ts services/app/src/http/memory-routes.ts services/app/src/http/memory-routes.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): GET /memory/graph (nodes + edges)"
```

---

## Task 1: Web memory API + types + `useMemory` hook

**Files:** Modify `services/web/src/types.ts`, `src/api.ts`; Create `src/useMemory.ts`, `src/api.memory.test.ts`

- [ ] **Step 1: types** in `types.ts`:
```ts
export type MemoryKind = "decision" | "fact" | "preference" | "identity" | "artifact";
export type MemoryScope = "personal" | "project" | "team" | "org";
export interface MemoryNode { id: string; orgId: string; kind: MemoryKind; scope: MemoryScope; label: string; body: string; metadata: Record<string, unknown>; createdAt: string; }
export interface MemoryEdge { id: string; fromId: string; toId: string; relation: string; }
export interface MemoryGraph { nodes: MemoryNode[]; edges: MemoryEdge[]; }
export interface MemoryStats { nodes: number; edges: number; }
```
- [ ] **Step 2: api** in `api.ts` (use `authHeaders()`):
```ts
export async function memoryGraph(filter: { kind?: MemoryKind; scope?: MemoryScope } = {}): Promise<MemoryGraph> {
  const qs = new URLSearchParams();
  if (filter.kind) qs.set("kind", filter.kind);
  if (filter.scope) qs.set("scope", filter.scope);
  const res = await fetch(`/memory/graph?${qs}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`memoryGraph ${res.status}`);
  return res.json();
}
export async function memoryStats(): Promise<MemoryStats> {
  const res = await fetch(`/memory/stats`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`memoryStats ${res.status}`);
  return res.json();
}
```
- [ ] **Step 3: `useMemory.ts`** — loads stats + graph for a scope/kind filter; exposes `{ graph, stats, scope, setScope, kind, setKind, loading }` (refetch on filter change).
- [ ] **Step 4: test** `src/api.memory.test.ts` — mock fetch; `memoryGraph({scope:"team"})` hits `/memory/graph?scope=team` and parses `{nodes,edges}`; `memoryStats()` parses `{nodes,edges}`. Run `pnpm test -- memory` → green.
- [ ] **Step 5: commit**
```bash
git add services/web/src/types.ts services/web/src/api.ts services/web/src/useMemory.ts services/web/src/api.memory.test.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(web): memory graph API + useMemory hook"
```

---

## Task 2: `ContextExplorer` component (stats + filters + SVG graph)

**Files:** Create `services/web/src/components/ContextExplorer.tsx`, `src/components/ContextExplorer.test.tsx`

Presentational: props `{ graph, stats, scope, onScopeChange, kind, onKindChange, loading }`. Layout:
- Header: **"Context Explorer"** + `{stats.nodes} memories · {stats.edges} edges`.
- Scope chips: `All · Personal · Project · Team · Org` (active = near-black `#15151f` pill); kind chips: `All · decision · fact · preference · identity · artifact`.
- **SVG graph**: deterministic circular layout — node `i` at angle `2πi/n` on a radius; draw `<line>` per edge between node centers (stroke `#e7e7f0`); `<circle>` per node colored by kind (decision=`#2563eb`, fact=`#15151f`, preference=`#7c3aed`, identity=`#059669`, artifact=`#d97706`) with the label as a small `<text>` / `<title>`. Clicking a node selects it (highlight + show its label/body + a neighbors count). Empty state when no nodes.

- [ ] **Step 1: failing test** `ContextExplorer.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextExplorer } from "./ContextExplorer.js";
import type { MemoryGraph } from "../types.js";

const graph: MemoryGraph = {
  nodes: [
    { id: "n1", orgId: "o1", kind: "decision", scope: "org", label: "merged PR #7", body: "fix login", metadata: {}, createdAt: new Date(0).toISOString() },
    { id: "n2", orgId: "o1", kind: "identity", scope: "org", label: "coder", body: "", metadata: {}, createdAt: new Date(0).toISOString() },
  ],
  edges: [{ id: "e1", fromId: "n1", toId: "n2", relation: "authored_by" }],
};

describe("ContextExplorer", () => {
  it("shows stats and renders the nodes", () => {
    render(<ContextExplorer graph={graph} stats={{ nodes: 2, edges: 1 }} scope="org" onScopeChange={() => {}} kind={undefined} onKindChange={() => {}} loading={false} />);
    expect(screen.getByText(/2 memories/)).toBeInTheDocument();
    expect(screen.getByText(/1 edges/)).toBeInTheDocument();
    expect(screen.getByText("merged PR #7")).toBeInTheDocument();
  });
  it("calls onScopeChange when a scope chip is clicked", () => {
    const onScopeChange = vi.fn();
    render(<ContextExplorer graph={graph} stats={{ nodes: 2, edges: 1 }} scope="org" onScopeChange={onScopeChange} kind={undefined} onKindChange={() => {}} loading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(onScopeChange).toHaveBeenCalledWith("team");
  });
  it("selecting a node shows its detail", () => {
    render(<ContextExplorer graph={graph} stats={{ nodes: 2, edges: 1 }} scope="org" onScopeChange={() => {}} kind={undefined} onKindChange={() => {}} loading={false} />);
    fireEvent.click(screen.getByText("merged PR #7"));
    expect(screen.getByText("fix login")).toBeInTheDocument(); // body shown on select
  });
});
```
> Render node labels as clickable text (e.g. a `<text>`/button list beside the SVG) so the test can `getByText`/click — the SVG circles + a node list both work; ensure labels are queryable.
- [ ] **Step 2:** implement to pass; `pnpm test -- ContextExplorer` → PASS; `pnpm build` clean.
- [ ] **Step 3: commit**
```bash
git add services/web/src/components/ContextExplorer.tsx services/web/src/components/ContextExplorer.test.tsx
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(web): ContextExplorer (memory graph view)"
```

---

## Task 3: Wire a "Context" view into App + Sidebar

**Files:** Modify `services/web/src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/Sidebar.test.tsx`, `src/App.test.tsx`

- [ ] **Step 1: Sidebar** — add a top nav item **"🧠 Context"** (above the channels section) + an `onOpenContext: () => void` prop; clicking it calls `onOpenContext`. Add the prop to every existing `render(<Sidebar .../>)` in the test and add a test: clicking "Context" calls `onOpenContext`.
- [ ] **Step 2: App** (`Workspace`) — add `view` state (`"thread" | "context"`, default `"thread"`); `onOpenContext` sets `"context"`; selecting a thread sets `"thread"`. When `view==="context"`, render `<ContextExplorer .../>` (fed by `useMemory()`) in the main panel instead of the thread conversation; the header shows "Context Explorer". Pass `onOpenContext` to `Sidebar`.
- [ ] **Step 3: App.test.tsx** — extend the routed fetch stub to return `{nodes:[],edges:[]}` for `/memory/graph` and `{nodes:0,edges:0}` for `/memory/stats` (so the context view renders). Keep the existing authed/login tests green.
- [ ] **Step 4:** `pnpm test` (all web green) + `pnpm build` clean.
- [ ] **Step 5: commit**
```bash
git add services/web/src/App.tsx services/web/src/components/Sidebar.tsx services/web/src/components/Sidebar.test.tsx services/web/src/App.test.tsx
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(web): Context view switch (sidebar entry + App wiring)"
```

---

## Self-Review
- Coverage: graph endpoint (T0), web API/hook (T1), ContextExplorer with stats + filters + SVG graph + node detail (T2), App/Sidebar wiring (T3). Completes the visible half of GH #26.
- Backward-compat: additive; the Sidebar gains a required `onOpenContext` prop (added to all render sites/tests); App tests get the `/memory/*` stubs. Existing suites stay green.
- Type consistency: `MemoryNode/Edge/Graph/Stats/Kind/Scope` shared in web `types.ts`, matching the backend `graph()` output. Kind→color map in ContextExplorer.
- Deferred: force-directed layout, edge labels, LLM extraction, agent mid-run memory read/write.

## Definition of Done (13b)
app + web suites green; web build clean. With the stack running + some decisions captured, the sidebar's "Context" entry opens a Context Explorer showing "N memories · M edges", scope/kind filters, an SVG node-edge graph colored by kind, and node selection detail — matching reload.chat's Context Explorer. Validated by a screenshot.
