# Plan 75 — Persistent internal tools (#99)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** Luo-style agent-built **persistent internal tools/dashboards** the team uses (not just PRs). Deliver the registry + safe-render core: a `tools` table (name/kind/HTML content, published flag, org+workspace scoped), CRUD (admin or via an API key #83 so an agent can register a tool it built), and a render-data route. The web renders **published** tools in a `sandbox=""` iframe (reuse #59's safe HTML rendering). Natural-language → app generation (the agent authoring the HTML) + the in-app builder UI fold into #102.

**Branch** `plan-75-persistent-tools` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: tools model + CRUD

**Files:** `services/app/src/db/schema.ts` + next migration (`0035_tools.sql`), Create `src/tools/tools.ts`, `tools.test.ts`
- [ ] **Step 1 — schema/migration:** `tools` table: `id` (pk), `orgId`, `workspaceId`, `name`, `kind` (text: `dashboard|form|page`, default `page`), `content` (text — the HTML), `published` (boolean default false), `createdByKind`, `createdById`, `createdAt`, `updatedAt`. `pnpm db:migrate`.
- [ ] **Step 2 — `tools.ts`:** `createTool(db, { orgId, workspaceId, name, kind, content, byKind, byId })` (validates kind), `listTools(db, orgId, { workspaceId?, publishedOnly? })`, `getTool(db, orgId, id)`, `updateTool(db, { orgId, id, name?, content?, kind? })`, `publishTool(db, { orgId, id, published })`, `deleteTool(...)`. All org-scoped. (Content is rendered ONLY in a sandboxed iframe on the client — store as-is.)
- [ ] **Step 3 — test:** create → a tool row (unpublished); update content; publish flips the flag; `listTools(publishedOnly:true)` excludes drafts; org-scoped (org-B can't see/edit); kind validated. `DATABASE_URL=… pnpm test -- tools` + tsc. Commit `feat(app): persistent tools model + CRUD (#99)`.

## Task 1: routes + safe web render

**Files:** Create `services/app/src/http/tools-routes.ts`, `tools-routes.test.ts`; Modify `src/server.ts`; web `src/api.ts`, Create `src/components/ToolView.tsx`, `ToolView.test.tsx`
- [ ] **Step 1 — routes:** `registerToolsRoutes(app, { db })`: `POST /tools` (admin OR api-key principal #83), `GET /tools?workspaceId=&publishedOnly=`, `GET /tools/:id` (the tool incl. content), `PATCH /tools/:id`, `POST /tools/:id/publish { published }`, `DELETE /tools/:id` — org-scoped (404), create/edit gated (admin/`team:manage` or the api-key principal). Register. Test: create + list (drafts hidden when publishedOnly) + publish + get; non-admin create → 403; cross-org → 404.
- [ ] **Step 2 — web `ToolView.tsx`:** given a tool `{ name, content }`, render the HTML in `<iframe sandbox="" srcDoc={content} />` (scripts disabled — safe, exactly like the #59 HTML preview). `api.ts`: `listTools()`, `getTool(id)`. Test (`ToolView.test.tsx`): renders a `sandbox=""` iframe with the content; no host script execution.
- [ ] **Step 3:** `cd services/app && DATABASE_URL=… pnpm test && pnpm exec tsc --noEmit` + `cd services/web && pnpm test && pnpm build`. Commit `feat(app+web): tools routes + safe sandboxed tool render (#99)`.

---

## Self-Review
- Delivers #99's core: persistent, team-accessible internal tools (a `tools` registry with HTML content + publish flag), created via admin or an agent's API key (#83), rendered **safely** in a `sandbox=""` iframe (#59) — a new artifact type beyond PRs. Org+workspace scoped, RBAC-gated.
- Backward-compat: additive table/module/routes/component; content rendered only in a scripts-disabled iframe (XSS-safe, preserves the #47 stance); org-scoped (#14). Migration additive. Existing suites green.
- Note: the agent **authoring** the tool from a natural-language request (a run that emits HTML → registers a tool), live hosting at a stable URL (preview deploy #103), and the in-app builder/list UI are follow-ups (#102); this lands the registry + safe render.

## Definition of Done (99)
app + web suites green; tsc/build; migration applies. Tools CRUD (create via admin/api-key, publish, list with draft-hiding), org+workspace scoped; the web renders a tool's HTML in a sandboxed iframe; cross-org denied. NL-to-app generation documented as the follow-up.
