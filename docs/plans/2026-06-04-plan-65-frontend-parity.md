# Plan 65 — Frontend parity slice: identity (#68) + Goals + Agents + Tasks (#102)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD. Web-only.

**Design (author's call):** the backend has raced ahead of the UI (#102). Deliver a high-value web slice: (1) **real identity** (`GET /auth/me` → show the actual user in the sidebar instead of the hardcoded `m1/o1` stub, #68); (2) a **Goals** panel (create/list goals + run-tick, surfacing #67); (3) an **Agents** panel (list + edit model/visibility, surfacing #58/#91); (4) a **Tasks** panel (list + detail with comments/relations, surfacing #81). Pure web over existing routes; the dev-proxy already covers them (#101).

**Branch** `plan-65-frontend-parity` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: real identity in the sidebar (#68)

**Files:** `services/web/src/api.ts` (or auth.ts has `getMe`?), `src/components/Sidebar.tsx`, `src/App.tsx`, `Sidebar.test.tsx`
- [ ] On login/mount, call `GET /auth/me` (an `getMe()` in auth.ts/api.ts → `{ orgId, userId, role }`); store it; the Sidebar shows the **real** `userId · org orgId · role` (replace the hardcoded `"signed in as m1 · org o1 (dev stub)"`). When unauthenticated and dev headers are in use, show a clear "dev" badge (don't claim a real identity). Test: given a principal `{userId:"alice",orgId:"acme",role:"admin"}`, the sidebar renders "alice"/"acme"/"admin"; the hardcoded stub string is gone. `cd services/web && pnpm test`. Commit `fix(web): show the real authenticated user in the sidebar (#68)`.

## Task 1: Goals + Agents panels

**Files:** `services/web/src/api.ts`, Create `src/components/GoalsPanel.tsx`, `GoalsPanel.test.tsx`, `src/components/AgentsPanel.tsx`, `AgentsPanel.test.tsx`; Modify `src/App.tsx` (nav to the panels)
- [ ] **Step 1 — `api.ts`:** `createGoal(title, criteria?)`, `listGoals()` (if a list route exists; else just create + decompose), `decomposeGoal(goalId, threadId)`, `runTick(orgId, budgetMax?)`; `listAgents()`, `setAgentProfile(agentId, {avatarUrl?, visibility?})`, `setAgentModel?` (if a route exists; else via the agent config — use what's available). (Read the real routes; only call endpoints that exist.)
- [ ] **Step 2 — `GoalsPanel.tsx`:** a form to create a goal (title + criteria) + a "Decompose" action + a "Run tick" button showing the result (dispatched/alerts counts). `AgentsPanel.tsx`: lists agents (handle, adapter, visibility, avatar) with an inline editor to PATCH visibility (+ avatar). Reachable from a nav item/the command palette (#60).
- [ ] **Step 3 — tests:** `GoalsPanel.test.tsx` — entering a title + submit calls `createGoal`; the Run-tick button calls `runTick` and shows the count. `AgentsPanel.test.tsx` — renders agents from a fetch; changing visibility + save calls `setAgentProfile`. `cd services/web && pnpm test`. Commit `feat(web): Goals + Agents panels (#102)`.

## Task 2: Tasks panel

**Files:** `services/web/src/api.ts`, Create `src/components/TasksPanel.tsx`, `TasksPanel.test.tsx`; Modify `src/App.tsx`
- [ ] **Step 1 — `api.ts`:** `getTask(id)` (task + comments + relations, #81), `updateTask(id, {priority?,dueDate?,state?})`, `addTaskComment(id, body)`, `bulkCreateTasks(threadId, items)`. (Only endpoints that exist.)
- [ ] **Step 2 — `TasksPanel.tsx`:** a task detail view — shows priority/due/state with inline edit (state dropdown from the known states, priority dropdown), the comments list + an add-comment box, and the relations. Reachable from a task reference / nav.
- [ ] **Step 3 — test:** `TasksPanel.test.tsx` — renders a task with comments; changing the state calls `updateTask`; adding a comment calls `addTaskComment`. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): tasks detail panel (priority/state/comments) (#102)`.

---

## Self-Review
- Delivers a strong #102 slice + closes #68: the UI now shows the real authenticated user and surfaces Goals (#67), Agents (#58/#91), and Tasks (#81) — the most impactful gaps between the shipped backend and the web app. Pure web over existing routes.
- Backward-compat: additive components + api fns; identity falls back to a clear dev badge when unauthenticated; only existing endpoints are called. Existing web suites green; `pnpm build` clean.
- Note: #102 is a standing epic — billing/files/automations/memory/notifications panels + a board view remain (each a thin slice on this pattern); this lands the highest-value four. The remaining panels stay tracked on #102.

## Definition of Done (68; #102 slice)
web suite green + build. The sidebar shows the real `/auth/me` user (stub gone, #68); Goals/Agents/Tasks panels create/list/edit via the real routes and are reachable from the UI. Tested.
