# Plan 56 — Invites + member directory (#88)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat — invite flow (pending invites), a member directory, and seat awareness. Add `invites` (token-hashed, pending/accepted/revoked), admin-gated create, accept→creates a member, list/revoke, and a `GET /members` directory. Seat enforcement is a soft check against a configurable limit (hard plan/quota billing is #85). Org-scoped.

**Branch** `plan-56-invites` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: invites model

**Files:** `services/app/src/db/schema.ts` + next migration (`0024_invites.sql`), Create `src/auth/invites.ts`, `invites.test.ts`
- [ ] **Step 1 — schema/migration:** `invites` table: `id` (pk), `orgId`, `workspaceId`, `email`, `role` (default `member`), `tokenHash` (text), `status` (text default `pending` — pending|accepted|revoked), `invitedById`, `createdAt`, `acceptedMemberId` (nullable). `pnpm db:migrate`.
- [ ] **Step 2 — `invites.ts`:**
  - `createInvite(db, { orgId, workspaceId, email, role, byId })` → generate `token = "inv_" + randomBytes(24).base64url`, store `tokenHash = sha256(token)`, status pending; return `{ id, token }` (token ONCE, never stored).
  - `acceptInvite(db, { token, displayName, password? })` → `sha256(token)` lookup pending invite (else throw "invalid invite"); create a `member` (org/workspace from the invite, role from the invite, password hashed if given); mark invite accepted + set `acceptedMemberId`; return the member.
  - `listInvites(db, orgId)` (pending, no token/hash) + `revokeInvite(db, { orgId, id })` (status=revoked, org-scoped).
  - `seatCount(db, orgId)` (member count) + a `seatLimit()` (env `ACP_SEAT_LIMIT`, default large) helper for the soft check.
- [ ] **Step 3 — test:** create → token + pending row (hash ≠ token); accept → a new member with the invite's role/workspace + invite accepted; accept twice → "invalid invite" (already accepted); revoke → accept fails; `listInvites` has no hash; org-scoped. `DATABASE_URL=… pnpm test -- invites` + tsc. Commit `feat(app): invites — create/accept/revoke + seat count (#88)`.

## Task 1: routes + directory

**Files:** Create `services/app/src/http/invite-routes.ts`, `invite-routes.test.ts`; Modify `src/server.ts`, `src/http/auth-routes.ts` (accept is public — bypass the preHandler for `/invites/accept`)
- [ ] `registerInviteRoutes(app, { db })`:
  - `POST /invites { email, role?, workspaceId? }` (admin — `can(roleOf,"team:manage")`; soft seat check: if `seatCount >= seatLimit` → 402/400 "seat limit reached") → `createInvite`; return `{ invite, token }` (token once).
  - `GET /invites` (admin) → `listInvites` (no secret).
  - `DELETE /invites/:id` (admin) → `revokeInvite` (org-scoped 404).
  - `POST /invites/accept { token, displayName, password? }` — **public** (no session needed; bypass the preHandler for this path like `/auth/login`) → `acceptInvite`; 400 on invalid token.
  - `GET /members` → the org's member directory (id, displayName, role, workspaceId — NO passwordHash). Org-scoped.
  - Register in `server.ts`.
- [ ] **test** (`app.inject`): admin `POST /invites` → token; `POST /invites/accept` (public) creates a member that can then log in; accept with a bad token → 400; non-admin invite → 403; `GET /members` lists the directory without password hashes; cross-org revoke → 404; seat-limit (set `ACP_SEAT_LIMIT=0`) → invite blocked. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): invite + member-directory routes (#88)`.

---

## Self-Review
- Delivers #88: token-hashed invites (create/list/revoke, admin), a public accept that provisions a member, a member directory, and a soft seat check, org-scoped.
- Backward-compat: additive table/module/routes; accept is public (bypassed like login) but token-gated; member directory omits secrets; existing auth unchanged. Migration additive. Existing suites green.
- Note: email delivery of the invite link, magic-link accept (#84), and hard seat/plan enforcement (#85 billing) are follow-ups; this delivers the invite lifecycle + directory.

## Definition of Done (88)
app suite green; tsc; migration applies. Admin creates/lists/revokes invites (token shown once); public `POST /invites/accept` provisions a member; `GET /members` is a secret-free directory; soft seat check; org-scoped (non-admin 403, cross-org 404).
