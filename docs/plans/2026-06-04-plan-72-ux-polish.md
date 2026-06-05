# Plan 72 — UX polish: notes + checks tab + message attachments (#76)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** the #76 bundle — deliver the concrete backend slices: a per-workspace **Notes** store (CRUD), a **checks** endpoint (view a run's CI checks in-thread), and **message attachments** (link #80 files to messages). The lighter items (pinned/search workspaces, thinking/effort level, fonts) fold into the frontend-parity epic #102 / are noted.

**Branch** `plan-72-ux-polish` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: per-workspace notes + checks endpoint

**Files:** `services/app/src/db/schema.ts` + next migration (`0033_notes.sql`), Create `src/nav/notes.ts`, `notes.test.ts`, `src/http/notes-routes.ts`, `notes-routes.test.ts`; `src/http/checks-routes.ts`, `checks-routes.test.ts`; Modify `src/server.ts`; orchestrator `GitHubService.getCheckContexts` if needed
- [ ] **Step 1 — notes schema/migration:** `notes` table: `id` (pk), `orgId`, `workspaceId`, `title`, `body`, `createdById`, `createdAt`, `updatedAt`. `pnpm db:migrate`.
- [ ] **Step 2 — notes module + routes:** `createNote`/`listNotes`/`updateNote`/`deleteNote` (org+workspace scoped). `notes-routes.ts`: `POST /notes`, `GET /notes?workspaceId=`, `PATCH /notes/:id`, `DELETE /notes/:id` — org-scoped (404). Register. Test CRUD + cross-org 404.
- [ ] **Step 3 — checks endpoint:** `GET /runs/:id/checks` → `actor(req).orgId`; org-scoped run (404), need commitSha; resolve repo+token; `const status = await gh.getChecksStatus(owner, repo, commitSha)` + (reuse `getCheckFailureContext` for failing contexts) → return `{ status, contexts: [...] }`. (Add `GitHubService.getCheckContexts(owner,repo,ref)` returning per-context name+state if a richer list is cheap; else reuse the existing two.) Test with a fake makeGitHub: returns the status; cross-org 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): per-workspace notes + run checks endpoint (#76)`.

## Task 1: message attachments

**Files:** `services/app/src/chat/messages.ts` (attachment support), `src/http/routes.ts` (post-message accepts fileIds), tests
- [ ] **Step 1 — attach:** `createMessage` accepts an optional `fileIds: string[]` → stored in the message `metadata.attachments` (the #80 `files` ids; validate each file exists in the org). A helper `messageAttachments(db, orgId, message)` → resolves the file metadata (name/contentType/size + a signed download URL via #80's `signFileUrl`) for rendering.
- [ ] **Step 2 — route:** `POST /threads/:id/messages` accepts an optional `fileIds` in the body → attaches them (org-scoped: each file must be in the org). `GET /threads/:id/messages` includes resolved attachments (name + signed download URL) on messages that have them.
- [ ] **Step 3 — test:** post a message with a `fileId` (seed a #80 file) → the message carries the attachment; listing returns it with a download URL; a fileId from another org → rejected/ignored (no cross-org leak). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): message attachments (link files to messages) (#76)`.

---

## Self-Review
- Delivers the concrete #76 slices: per-workspace Notes (CRUD), a run-checks endpoint (CI status + contexts in-thread), and message attachments (the #80 file system linked to chat), all org-scoped.
- Backward-compat: additive table/modules/routes; `fileIds` optional on message create (no fileIds = today); checks reuses existing GitHubService; org-scoped (#14). Migration additive. Existing suites green.
- Note: the Notes/Checks **tabs** + pinned/searchable workspaces + thinking/effort-level selection are UI/config follow-ups folded into #102; this lands the backend.

## Definition of Done (76)
app suite green; tsc; migration applies. Notes CRUD (org+workspace scoped); `GET /runs/:id/checks` returns CI status + contexts (org-scoped); messages can carry file attachments (#80) resolved with signed download URLs; cross-org denied.
