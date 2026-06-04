# Plan 51 — Channel admin (#89) + default workspace assistant (#87)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's calls):** two bounded reload.chat items.
- **#89 channel admin:** rename + archive a channel (admin-gated) + **cursor-based message pagination** (`before`/`after`/`limit`). Private-channel membership enforcement needs a `channel_members` table — a noted follow-up.
- **#87 default assistant:** auto-provision a built-in assistant agent (handle `iris`, claude-code adapter) per workspace, idempotent — so users can `@iris` out of the box.

**Branch** `plan-51-channel-admin-assistant` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: channel admin (#89)

**Files:** `services/app/src/db/schema.ts` + next migration (`0019_channel_archived.sql`), `src/nav/nav.ts` (or wherever channels are queried) + `src/http/nav-routes.ts`, tests
- [ ] **Step 1 — schema/migration:** add `archived: boolean("archived").notNull().default(false)` to `channels`. `pnpm db:migrate`.
- [ ] **Step 2 — routes (nav-routes.ts):** `PATCH /channels/:id { name }` (rename) + `POST /channels/:id/archive { archived?: boolean }` — both `actor(req)`, org-scoped (404), admin-gated (`can(roleOf, "channel:create")` — reuse, or a `channel:manage` action). `GET /channels` excludes archived by default (`?includeArchived=1` to include). 
- [ ] **Step 3 — cursor pagination:** `listMessages`/`GET /threads/:id/messages` accept `?before=<msgId|ts>&after=<…>&limit=<n>` → page by `createdAt`/id (default newest N), org-scoped. Keep the default (no params) behavior backward-compatible (returns recent messages as today, just bounded by a default limit).
- [ ] **Step 4 — test:** rename updates the name (admin; non-admin 403); archive hides it from `GET /channels` (shown with `?includeArchived=1`); cross-org 404; message pagination: seed 5 messages, `?limit=2` returns 2, `?before=<id>` returns older ones. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): channel rename/archive + cursor message pagination (#89)`.

## Task 1: default workspace assistant (#87)

**Files:** Create `services/app/src/agents/default-assistant.ts`, `default-assistant.test.ts`; Modify wherever workspaces are created (`src/nav` or the workspace creation path / `server.ts` startup ensure)
- [ ] **Step 1 — `default-assistant.ts` `ensureDefaultAssistant(db, { orgId, workspaceId })`:** insert an agent `{ id: \`asst:${orgId}:${workspaceId}\`, orgId, workspaceId, handle: "iris", displayName: "Iris", adapter: "claude-code", config: {} }` with `onConflictDoNothing` (idempotent — the deterministic id + the org-handle unique index make re-calling safe). Return the agent.
- [ ] **Step 2 — wire:** call `ensureDefaultAssistant` when a workspace is created (find the workspace-create path; if none exists as a route, add it to the seed + expose a small `POST /workspaces/:id/ensure-assistant` admin route, or call it in the existing workspace setup). Minimal: ensure it on the existing workspace(s) via a callable + a route.
- [ ] **Step 3 — test:** `ensureDefaultAssistant` creates the `iris` agent once; a second call → no dup (idempotent); it's resolvable via `resolveMention(db, orgId, "iris")`; org-scoped. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): default workspace assistant (iris) (#87)`.

---

## Self-Review
- #89: channels can be renamed/archived (admin) + messages paginate by cursor; archived channels hidden by default. #87: every workspace has a default `@iris` assistant out of the box (idempotent provisioning).
- Backward-compat: `archived` defaults false; message pagination defaults to today's behavior when no params; default-assistant is idempotent (deterministic id + unique handle index); admin-gated; org-scoped (#14). Migration additive. Existing suites green.
- Note: private-channel membership enforcement (a `channel_members` table) + per-channel notification config are follow-ups (#89/#61); the assistant's actual capabilities ride the built-in skills (#48) + adapter.

## Definition of Done (89, 87)
app suite green; tsc; migration applies. Channel rename/archive (admin, cross-org 404) + `GET /channels` hides archived + cursor message pagination; `ensureDefaultAssistant` provisions an idempotent `@iris` per workspace, resolvable by mention. Org-scoped.
