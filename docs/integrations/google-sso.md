# Google SSO (#84)

Google "Sign in with Google" (OAuth 2.0 / OpenID Connect). The flow is env-driven
and the token exchange is injectable so it is fully unit-tested offline; a live
sign-in needs Google credentials plus the deploy URL (a post-deploy #103 step).

## Flow

1. `GET /auth/google` → 302 redirect to Google's consent screen
   (`https://accounts.google.com/o/oauth2/v2/auth`) with a fresh CSRF `state`.
   Returns **400** when `GOOGLE_CLIENT_ID` is unset.
2. Google redirects the user back to `GOOGLE_REDIRECT_URI` with `?code=&state=`.
3. `GET /auth/google/callback?code=&state=` exchanges the `code` for the verified
   email (POST to `https://oauth2.googleapis.com/token`, decoding the `id_token`
   JWT), resolves the member by email — **find-or-create** within the configured
   default org/workspace — and issues a session. Returns `{ token, member }`.

Both routes are PUBLIC (the user has no app session yet); they validate the
code/state themselves. #37 fail-closed is preserved — unconfigured → 400, never
an unauthenticated session.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth client id. **Required** — unset → `/auth/google` 400, `googleAuthUrl` throws. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret. Required for the live token exchange. |
| `GOOGLE_REDIRECT_URI` | The callback URL registered in Google Cloud Console, e.g. `https://app.example.com/auth/google/callback`. Needs the deploy URL (#103). |
| `GOOGLE_SSO_ORG_ID` | Default org a newly-provisioned SSO member joins. |
| `GOOGLE_SSO_WORKSPACE_ID` | Default workspace a newly-provisioned SSO member joins. |

No secret is hard-coded; everything is read from the environment.

## Setup (post-deploy, #103)

1. In Google Cloud Console, create an OAuth 2.0 Client ID (type: Web application).
2. Add the authorized redirect URI = `GOOGLE_REDIRECT_URI` (your deploy URL +
   `/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
   `GOOGLE_SSO_ORG_ID`, `GOOGLE_SSO_WORKSPACE_ID` in the app environment.

## Testing

`handleGoogleCallback` accepts an injectable `exchange(code) => { email }`, so
tests resolve/create a member + session with a fake exchange and **no live Google
call**. See `services/app/src/auth/google-sso.test.ts`.
