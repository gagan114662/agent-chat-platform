# Plan 60 — Auth methods part 1: magic-link + device sessions (#84)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat auth methods. Part 1 of #84: **magic-link email auth** (request a one-time link → verify → session) and **device session management** (list active sessions, revoke one / all-others). TOTP MFA + Google SSO are Part 2 (Plan 61). Magic-link delivery is dev-returned now (email send is a thin follow-up). Org-scoped.

**Branch** `plan-60-auth-magiclink-sessions` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: magic-link

**Files:** `services/app/src/db/schema.ts` + next migration (`0028_magic_links.sql`), Create `src/auth/magic-link.ts`, `magic-link.test.ts`, route in `src/http/auth-routes.ts`
- [ ] **Step 1 — schema/migration:** `magic_links` table: `id` (pk), `memberId`, `tokenHash` (text), `expiresAt` (timestamptz), `usedAt` (nullable), `createdAt`. `pnpm db:migrate`.
- [ ] **Step 2 — `magic-link.ts`:** `requestMagicLink(db, { email })` → find the member by email (a `members.email`? if none, accept memberId or add an `email` lookup — read schema; if members lack email, match on a configurable field or accept memberId); generate `token = "ml_"+randomBytes(24).base64url`, store `tokenHash=sha256(token)`, `expiresAt = now+15min`; return `{ token }` (dev returns it; prod emails it). `verifyMagicLink(db, { token })` → sha256 lookup unused+unexpired (else throw "invalid or expired"); mark `usedAt`; `createSession(db, memberId)` → return `{ token: sessionToken, member }`. Single-use + expiring.
- [ ] **Step 3 — routes (auth-routes.ts, PUBLIC):** `POST /auth/magic-link/request { email }` → `requestMagicLink` (always 200, return the token only when `devHeadersAllowed()` so prod doesn't leak it); `POST /auth/magic-link/verify { token }` → `verifyMagicLink` → `{ token, member }` (401 on invalid). Add both to PUBLIC_PATHS.
- [ ] **Step 4 — test:** request → a token + a magic_links row (hash ≠ token); verify → a session + member; verify again → "invalid" (single-use); an expired token (`verifyMagicLink` with a clock past expiry) → invalid; route: request 200, verify 200 then 401 on reuse. `DATABASE_URL=… pnpm test -- magic-link` + tsc. Commit `feat(app): magic-link email auth (#84)`.

## Task 1: device session management

**Files:** `services/app/src/auth/auth.ts` (or a `sessions.ts`), Create `src/http/session-routes.ts`, `session-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1 — helpers:** the `sessions` table exists. Add `listSessions(db, { orgId, userId })` (the user's active sessions — id, createdAt, lastSeenAt if present, a label/userAgent if stored; NO token), `revokeSession(db, { orgId, userId, sessionId })` (delete that session, only if it belongs to the user), `revokeOtherSessions(db, { orgId, userId, keepToken })` (delete all but the current). (If sessions lack a userAgent/label column, add one in the 0028 migration or list what's there.)
- [ ] **Step 2 — routes:** `GET /auth/sessions` → `listSessions` (current principal). `DELETE /auth/sessions/:id` → `revokeSession` (404 if not the user's). `POST /auth/sessions/revoke-others` → `revokeOtherSessions` (keeps the caller's current token). Register in `server.ts`.
- [ ] **Step 3 — test** (`app.inject`): create 2 sessions for a member (two logins) → `GET /auth/sessions` lists 2 (no tokens); `DELETE /auth/sessions/:id` removes one (and that token no longer authenticates); revoke-others keeps the caller's; a session id from another user → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): device session list + revoke (#84)`.

---

## Self-Review
- Delivers #84 part 1: passwordless magic-link login (single-use, expiring) + device session management (list/revoke/revoke-others), org+user scoped, fail-closed (#37) preserved.
- Backward-compat: additive table/modules/routes; magic-link + verify are public (token-gated); session mgmt only over the caller's own sessions; existing password/session auth unchanged. Migration additive. Existing suites green.
- Note: email delivery of the link + Google SSO + TOTP MFA are the rest of #84 (Part 2 / a thin email follow-up); this delivers magic-link + sessions.

## Definition of Done (84 part 1)
app suite green; tsc; migration applies. `POST /auth/magic-link/request`→token (dev) and `/verify`→session (single-use, expiring, 401 on reuse); `GET /auth/sessions` lists the user's sessions (no tokens), `DELETE /auth/sessions/:id` + `revoke-others` work, scoped to the caller; #37 fail-closed intact.
