# Plan 28 — Cross-team agent sharing (#28) + richer RBAC (#29)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's calls):**
- **#28 agent sharing:** `resolveMention` already finds agents org-wide; the only thing pinning an agent to one team is `isPermittedOnRepo` (requires `agent.workspaceId === repo.workspaceId`). Add a per-agent **`shared`** flag: a shared agent may run on **any repo in its org**, not just its home workspace. That is the core of "cross-team agent sharing." (Named, load-balanced *pools* need an availability signal we don't have — noted as a follow-up.)
- **#29 richer RBAC:** today role is `admin|member` and only `channel:create` is enforced, so a member can do every write (the #36/scan note: member≈admin). Add a **`viewer`** role (read-only) and a real `(role × action)` matrix, and **enforce `can()` on the write routes** (message post, thread create, DM start) so viewers are actually read-only. Add **scope-aware memory writes**: creating an `org`-scoped memory node requires `admin`.

**Branch** `plan-28-pools-and-rbac` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0 (#28): shared agents run cross-workspace

**Files:** `services/app/src/db/schema.ts` + migration `0011_agent_shared.sql`, `services/app/src/agents/agents.ts`, `agents.test.ts`, Create `src/http/agent-routes.ts`, `agent-routes.test.ts`, Modify `src/server.ts`
- [ ] **Step 1 — schema + migration:** add `shared: boolean("shared").notNull().default(false)` to the `agents` table. Migration `0011_agent_shared.sql`: `ALTER TABLE agents ADD COLUMN shared boolean NOT NULL DEFAULT false;` (follow the existing migration file/runner pattern; run `pnpm db:migrate`).
- [ ] **Step 2 — `isPermittedOnRepo`:** a shared agent is permitted on any repo in the SAME ORG; an unshared agent stays workspace-pinned:
```ts
export async function isPermittedOnRepo(db: DB, agentId: string, repoId: string) {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId));
  const [r] = await db.select().from(repos).where(eq(repos.id, repoId));
  if (!a || !r) return false;
  if (a.orgId !== r.orgId) return false;            // never cross-org
  return a.shared || a.workspaceId === r.workspaceId; // shared → any workspace in the org
}
```
- [ ] **Step 3 — `setAgentShared` + route:** add `setAgentShared(db, { orgId, agentId, shared })` (org-scoped update, returns the agent). `agent-routes.ts`: `PATCH /agents/:id/shared { shared: boolean }` → `actor(req)`, admin-gated (`can(await roleOf(...), "agent:share")` — add that action in Task 1, or gate on role==="admin" here and tighten in Task 1), org-scoped; 404 if not in org. Register in `server.ts`.
- [ ] **Step 4 — tests:** `agents.test.ts` — seed org-A agent in workspace w1 + repo in workspace w2 (same org): `isPermittedOnRepo` false when `shared=false`, **true when `shared=true`**; a repo in another ORG → false even if shared. `agent-routes.test.ts` — PATCH toggles `shared` (admin), cross-org → 404, non-admin → 403. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): shared agents run cross-workspace (#28)`.

## Task 1 (#29): viewer role + enforced permission matrix

**Files:** `services/app/src/rbac/rbac.ts`, `rbac.test.ts`, Modify `src/http/routes.ts` (message post), `src/http/nav-routes.ts` (thread create), `src/http/dm-routes.ts` (dm start), `src/http/memory-routes.ts` (org-scope node create), + touched route tests
- [ ] **Step 1 — `rbac.ts`:** widen roles + matrix:
```ts
export type Role = "admin" | "member" | "viewer";
export type Action =
  | "channel:create" | "channel:delete" | "thread:create" | "message:post" | "dm:start"
  | "agent:share" | "memory:write:org";

const MATRIX: Record<Role, Action[]> = {
  viewer: [], // read-only
  member: ["thread:create", "message:post", "dm:start"],
  admin: ["channel:create", "channel:delete", "thread:create", "message:post", "dm:start", "agent:share", "memory:write:org"],
};
export function can(role: Role, action: Action): boolean {
  return MATRIX[role]?.includes(action) ?? false;
}
export async function roleOf(db: DB, memberId: string, orgId: string): Promise<Role> {
  const [m] = await db.select().from(members).where(and(eq(members.id, memberId), eq(members.orgId, orgId)));
  return (m?.role as Role) ?? "member";
}
```
  (Keep the existing `roleOf` query; just widen the type + matrix. Note: `admin` is now explicit in the matrix, not a wildcard — list every admin action.)
- [ ] **Step 2 — enforce on write routes:** at the top of each handler, after resolving `{ orgId, userId }`:
  - `routes.ts` POST `/threads/:id/messages`: `if (!can(await roleOf(d.db, userId, orgId), "message:post")) return reply.code(403).send({ error: "forbidden" });`
  - `nav-routes.ts` POST `/channels/:id/threads`: gate on `"thread:create"` (it already gates channel:create — add this one for thread create).
  - `dm-routes.ts` POST `/dms`: gate on `"dm:start"`.
  - `memory-routes.ts` create-node route: if the requested `scope === "org"`, require `can(role, "memory:write:org")` (admin) → else 403; non-org scopes allowed for member.
  - Update `agent-routes.ts` (Task 0) to gate on `"agent:share"`.
- [ ] **Step 3 — tests:** `rbac.test.ts` — `can("viewer","message:post")` false; `can("member","message:post")` true; `can("member","channel:create")` false; `can("admin","memory:write:org")` true; `can("member","memory:write:org")` false. Route tests: a **viewer** (seed a member with `role:"viewer"`, authenticate as them) gets **403** posting a message / creating a thread / starting a DM; a member still succeeds (existing tests green — default role is member). An org-scoped memory create as member → 403, as admin → ok. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): viewer role + enforced RBAC matrix on write routes (#29)`.

---

## Self-Review
- **#28:** a `shared` agent runs on any repo in its org (cross-team), unshared stays workspace-pinned, never cross-org. Toggle via an admin route. (Load-balanced named pools = follow-up: needs an agent-availability signal.)
- **#29:** real `viewer` (read-only) role + an explicit `(role × action)` matrix enforced on the write routes that previously had no check; org-scoped memory writes require admin. Closes the scan's "member≈admin / nothing enforced" gap.
- Backward-compat: `shared` defaults false (today's behavior); default member role keeps all current member capabilities so existing route tests stay green; only `viewer` is newly restricted and `admin` is now explicit (verify no action was dropped from admin). Org-scoped throughout (#14).

## Definition of Done (28, 29)
app suite green + tsc. A shared agent runs cross-workspace (same org only); `PATCH /agents/:id/shared` toggles it (admin). A `viewer` is read-only (403 on message/thread/dm writes), member retains writes, admin retains all; org-scoped memory creation requires admin. Migrations apply.
