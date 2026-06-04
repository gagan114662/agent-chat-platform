# Plan 52 — Scoped agent API keys (#83)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat — agents authenticate with **API keys scoped to channels/actions**, with rotation + revocation. Add `api_keys` (hashed, org-scoped, scopes jsonb, revoked flag); issue returns the plaintext key ONCE (only the hash is stored); the auth preHandler resolves a `acp_`-prefixed bearer as an API-key principal (revocable). Scope enforcement is recorded + a `requireScope` helper; full per-channel enforcement is a thin follow-up.

**Branch** `plan-52-api-keys` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: api_keys model + issue/revoke

**Files:** `services/app/src/db/schema.ts` + next migration (`0020_api_keys.sql`), Create `src/auth/api-keys.ts`, `api-keys.test.ts`
- [ ] **Step 1 — schema/migration:** `api_keys` table: `id` (pk), `orgId`, `name`, `keyHash` (text, sha256 hex), `scopes` (jsonb default `{}`), `revoked` (boolean default false), `createdAt`, `lastUsedAt` (nullable). Index on `keyHash`. `pnpm db:migrate`.
- [ ] **Step 2 — `api-keys.ts`:**
  - `issueApiKey(db, { orgId, name, scopes?, userId })` → generate `key = "acp_" + randomBytes(24).base64url`, store `keyHash = sha256(key)`, return `{ id, key, name }` (the plaintext `key` ONCE — never stored, never logged).
  - `resolveApiKey(db, key)` → `sha256(key)` lookup; if found + not revoked → `{ orgId, userId: "apikey:"+id, scopes }` (and best-effort update `lastUsedAt`); else undefined.
  - `revokeApiKey(db, { orgId, id })` (set revoked=true, org-scoped) and `listApiKeys(db, orgId)` (NO hash/secret — id/name/scopes/revoked/createdAt/lastUsedAt).
- [ ] **Step 3 — test:** issue → returns a plaintext `acp_…` + a row whose `keyHash` ≠ the key; `resolveApiKey(key)` → the principal with scopes; `resolveApiKey("acp_wrong")` → undefined; revoke → `resolveApiKey` now undefined; `listApiKeys` never includes the hash; org-scoped. `DATABASE_URL=… pnpm test -- api-keys` + tsc. Commit `feat(app): scoped api_keys — issue/resolve/revoke (#83)`.

## Task 1: preHandler resolution + routes

**Files:** `services/app/src/http/auth-routes.ts` (preHandler), Create `src/http/apikey-routes.ts`, `apikey-routes.test.ts`; Modify `src/server.ts`
- [ ] **Step 1 — preHandler:** in `registerAuth`'s preHandler, BEFORE the session-token resolution: if the bearer token starts with `acp_`, `const p = await resolveApiKey(d.db, token); if (p) req.principal = p;` (so API keys authenticate like sessions, set `req.principal`). Falls through to the existing session/dev-header logic otherwise. (Keep #37 fail-closed: an invalid/revoked key → no principal → default-deny.)
- [ ] **Step 2 — routes (`apikey-routes.ts`):** `POST /api-keys { name, scopes? }` (admin-gated — `can(roleOf,"team:manage")` or a new `apikey:manage` action) → `issueApiKey` (returns the key ONCE in the response, with a note it won't be shown again); `GET /api-keys` → `listApiKeys` (no secret); `DELETE /api-keys/:id` → `revokeApiKey`. Org-scoped (cross-org 404). Register in `server.ts`.
- [ ] **Step 3 — test:** `POST /api-keys` (admin) returns an `acp_…` key + 201; using that key as `Authorization: Bearer acp_…` on a normal route authenticates (e.g. `GET /auth/me` returns the api-key principal); `GET /api-keys` lists it without the secret; `DELETE` revokes it → the key no longer authenticates; non-admin issue → 403; cross-org revoke → 404. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): api-key auth in the preHandler + management routes (#83)`.

---

## Self-Review
- Delivers #83's core: org-scoped, hashed, revocable API keys that authenticate via the bearer preHandler (alongside sessions), issued once (only the hash stored), with scopes recorded for enforcement. Rotation = issue-new + revoke-old.
- Backward-compat: additive table/module/routes; the preHandler only adds an `acp_`-prefix branch before the existing logic (sessions/dev-headers unchanged); #37 fail-closed preserved (bad key → no principal). Org-scoped (#14). Existing suites green.
- Note: enforcing each key's `scopes` per-channel/per-action on every route (vs. just recording them) is a thin follow-up via a `requireScope` middleware; this delivers the key lifecycle + authn.

## Definition of Done (83)
app suite green; tsc; migration applies. Admin can issue/list/revoke API keys (key shown once, only hash stored); an `acp_`-bearer authenticates as its org principal until revoked; org-scoped (non-admin 403, cross-org 404); #37 fail-closed intact.
