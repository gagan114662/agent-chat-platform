# Plan 61 — Auth methods part 2: TOTP MFA + Google SSO (#84)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** completes #84. **TOTP MFA** (RFC-6238, hand-rolled with node crypto — no external lib): enroll → confirm → required at login. **Google SSO**: the OAuth redirect + callback flow reading `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` from env, with an injectable token-exchanger so the flow is unit-tested without live Google (live exchange + the redirect URI need the deploy URL + Google creds — documented). Org-scoped, #37 fail-closed preserved.

**Branch** `plan-61-auth-mfa-sso` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: TOTP MFA

**Files:** `services/app/src/db/schema.ts` + next migration (`0029_mfa.sql`), Create `src/auth/totp.ts`, `totp.test.ts`, `src/auth/mfa.ts`, `mfa.test.ts`, routes in `src/http/auth-routes.ts`
- [ ] **Step 1 — schema/migration:** add to `members`: `totpSecret` (text nullable), `mfaEnabled` (boolean default false). `pnpm db:migrate`.
- [ ] **Step 2 — `totp.ts` (RFC 6238, node crypto):** `generateSecret()` → 20 random bytes base32-encoded; `totpCode(secret, now = Date.now(), step = 30)` → HMAC-SHA1 over the 8-byte big-endian counter `floor(now/1000/step)`, dynamic truncation → 6-digit zero-padded string; `verifyTotp(secret, code, now)` → true if `code` matches `totpCode` for the current window or ±1 (clock skew). Pure functions.
- [ ] **Step 3 — `mfa.ts`:** `enrollMfa(db, { orgId, memberId })` → set `totpSecret = generateSecret()` (not yet enabled), return the secret (+ an `otpauth://` URI for the QR). `confirmMfa(db, { orgId, memberId, code })` → `verifyTotp` against the stored secret → set `mfaEnabled=true` (else throw "invalid code"). `disableMfa(db, {orgId, memberId})`. `mfaRequired(db, memberId)` → boolean.
- [ ] **Step 4 — login gate (auth-routes.ts):** the login + magic-link verify paths: if the member `mfaEnabled`, require a valid `totpCode` (a `code` field) → 401 "mfa required"/"invalid code" if absent/wrong; else issue the session as today. New routes: `POST /auth/mfa/enroll` (authed → secret+uri), `POST /auth/mfa/confirm { code }`, `POST /auth/mfa/disable`.
- [ ] **Step 5 — test:** `totp.test.ts` — `verifyTotp(secret, totpCode(secret, t), t)` true; a code from the previous window verifies (±1); a wrong code false; deterministic at a fixed `now`. `mfa.test.ts` — enroll sets a secret (not enabled); confirm with a valid code enables; bad code throws. Route/login test: with MFA enabled, login without `code` → 401, with a valid `code` → session. `DATABASE_URL=… pnpm test -- totp mfa` + tsc. Commit `feat(app): TOTP MFA — enroll/confirm + login gate (#84)`.

## Task 1: Google SSO (scaffold, env-driven)

**Files:** Create `services/app/src/auth/google-sso.ts`, `google-sso.test.ts`, routes in `src/http/auth-routes.ts`; `docs/integrations/google-sso.md`
- [ ] **Step 1 — `google-sso.ts`:**
  - `googleAuthUrl(state)` → builds `https://accounts.google.com/o/oauth2/v2/auth?...` with `client_id=GOOGLE_CLIENT_ID`, `redirect_uri=GOOGLE_REDIRECT_URI`, `scope=openid email profile`, `response_type=code`, `state`. (Throws if `GOOGLE_CLIENT_ID` unset.)
  - `handleGoogleCallback(db, { code, exchange })` → `exchange` (injectable; default POSTs to Google's token endpoint with `GOOGLE_CLIENT_SECRET`, returns the id_token's email) → resolve a member by email (find-or-create within a default org/workspace per config) → `createSession`. Returns `{ token, member }`.
- [ ] **Step 2 — routes (PUBLIC):** `GET /auth/google` → 302 to `googleAuthUrl` (400 if unconfigured); `GET /auth/google/callback?code=&state=` → `handleGoogleCallback` → set the session (redirect to the app or return `{token}`). Add to PUBLIC_PATHS.
- [ ] **Step 3 — test (`google-sso.test.ts`):** `googleAuthUrl("s")` contains the client_id/redirect/scope/state (set `GOOGLE_CLIENT_ID` via env; unset → throws); `handleGoogleCallback` with a FAKE `exchange` returning `you@e.com` → resolves/creates the member + a session (no live Google call). Route: `GET /auth/google` 302 when configured / 400 when not. `docs/integrations/google-sso.md` documents `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` (post-deploy #103) creds. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): Google SSO flow (env-driven, injectable exchange) (#84)`.

---

## Self-Review
- Completes #84: magic-link (pt1) + device sessions (pt1) + TOTP MFA (enroll/confirm/login-gate, RFC-6238, no external lib) + Google SSO (OAuth redirect + callback, injectable exchange, env-driven). All org-scoped, #37 fail-closed preserved.
- Backward-compat: MFA off by default (existing logins unchanged); SSO is additive + env-gated (unconfigured → 400, no live call in tests); migration additive. Existing suites green.
- Note: live Google SSO needs `GOOGLE_CLIENT_ID/SECRET` + the redirect URI (post-deploy #103) — documented; the token-exchange is injectable so the flow is fully tested offline.

## Definition of Done (84 complete)
app suite green; tsc; migration applies. TOTP MFA enroll/confirm + login requires a valid code when enabled (401 otherwise); `verifyTotp` correct (±1 window); Google SSO redirect (400 unconfigured) + callback resolves/creates a member into a session via an injectable exchange; org-scoped; #37 fail-closed intact.
