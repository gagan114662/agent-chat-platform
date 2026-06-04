# Plan 40 — Notifications: unread markers + mentions inbox + status (#61)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** conductor 0.25.11/0.35 + reload "messages you should respond to". MVP: per-user **read state** per thread, **unread counts** in the sidebar, **mark-read on open**, and a **mentions inbox** (threads where you were @mentioned and haven't read since). Live updates ride the existing WS. Org+user scoped.

**Branch** `plan-40-notifications` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: read-state + unread counts

**Files:** `services/app/src/db/schema.ts` + next migration (`0014_read_state.sql`), Create `src/nav/read-state.ts`, `read-state.test.ts`
- [ ] **Step 1 — schema/migration:** `read_state` table: `orgId`, `userId`, `threadId`, `lastReadAt` (timestamptz), PRIMARY KEY (`orgId`,`userId`,`threadId`). Migration `0014_read_state.sql` (next contiguous — confirm in `services/app/migrations`). `pnpm db:migrate`.
- [ ] **Step 2 — `read-state.ts`:**
  - `markRead(db, {orgId, userId, threadId, at?})` — upsert `lastReadAt = at ?? now()` (onConflict update).
  - `unreadCounts(db, orgId, userId)` — for the user's accessible threads, count messages with `createdAt > lastReadAt` (threads with no read-state row → all messages unread). Return `{ threadId, unread }[]` (only threads with unread > 0). (Use a join/subquery against `messages` + `read_state`.)
  - `mentionsInbox(db, orgId, userId, handle)` — threads where a message after `lastReadAt` contains `@<handle>` (ILIKE on body), most recent first. (handle = the member's mention handle; pass the userId/handle in.)
- [ ] **Step 3 — test:** seed a thread with 3 messages; no read-state → unread 3; `markRead` at msg-2's time → unread 1; org-scoped (org-B excluded). `mentionsInbox` returns a thread whose unread message contains `@you`, not one where the mention was already read. `DATABASE_URL=… pnpm test -- read-state` + tsc. Commit `feat(app): read-state + unread counts + mentions inbox (#61)`.

## Task 1: routes

**Files:** Create `services/app/src/http/notify-routes.ts`, `notify-routes.test.ts`; Modify `src/server.ts`
- [ ] `registerNotifyRoutes(app, d: { db })`: `POST /threads/:id/read` (body optional `{at}`) → `actor(req)`, mark the thread read (thread must be in org → 404 otherwise); `GET /unreads` → `unreadCounts(orgId, userId)`; `GET /inbox` → `mentionsInbox(orgId, userId, <handle>)` (resolve the member's handle/displayName for the @match — use userId or a handle column). Register in `server.ts`. Tests (`app.inject`): mark-read then `GET /unreads` reflects it; `GET /inbox` lists a mention thread; cross-org thread read → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): unread/read/inbox routes (#61)`.

## Task 2: web — unread badges + mark-read + inbox

**Files:** `services/web/src/api.ts`, `src/components/Sidebar.tsx`, `src/useThreadStream.ts` (or App), `Sidebar.test.tsx`
- [ ] **Step 1 — `api.ts`:** `getUnreads(): Promise<{threadId:string;unread:number}[]>`, `markThreadRead(threadId)`, `getInbox()`.
- [ ] **Step 2:** App loads unreads on mount + after each WS message (debounced/refetch); `Sidebar.tsx` shows an unread **badge** (count) next to channels/threads that have unread > 0. Opening a thread calls `markThreadRead(threadId)` (in `useThreadStream` effect or App) → clears its badge (refetch unreads). An **Inbox** affordance (a small "Activity" item) lists `getInbox()` threads ("you were mentioned"). 
- [ ] **Step 3 — test:** `Sidebar.test.tsx` — given an unreads map with `{t1: 2}`, the t1 row shows a "2" badge; t2 (not in the map) shows none. (Mark-read behavior: a focused test that opening a thread calls `markThreadRead`.) `cd services/web && pnpm test && pnpm build`. Commit `feat(web): unread badges + mark-read + mentions inbox (#61)`.

---

## Self-Review
- Delivers #61 MVP: per-user unread counts + sidebar badges, mark-read on open, and a mentions inbox ("respond to this"), org+user scoped, live via the existing WS refetch.
- Backward-compat: additive table/module/routes/UI; no read-state row = everything unread (sensible default); org-scoped (#14). Existing suites green.
- Note: per-channel/DM notification config + sounds + DND + run/workspace status *badges* (conductor 0.35) are follow-ups; this delivers unread + the mentions inbox, the highest-value pieces. Push notifications (desktop) tie to #90.

## Definition of Done (61)
app + web suites green; tsc/build; migration applies. Sidebar shows unread badges; opening a thread marks it read; `GET /inbox` lists threads where you were mentioned and haven't read. Org+user scoped.
