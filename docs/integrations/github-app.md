# GitHub App integration (#23)

The platform integrates with GitHub as a **GitHub App** (App ID `3965781`, Client ID
configured). This gives us two capabilities, both code-complete and env-driven:

1. **Signature-verified webhook** — `POST /webhooks/github` turns `issues.opened`
   into idempotent, org-mapped Tasks.
2. **App installation-token client** — `makeAppInstallationClient(installationId)`
   builds an Octokit that mints short-lived installation tokens (the PAT
   replacement for `OctokitGitHubService`).

The code is built against environment variable **names**; live use requires the
secrets below (user-provided) plus the post-deploy webhook URL.

## Environment variables

| Var | Used by | What it is |
| --- | --- | --- |
| `GITHUB_APP_ID` | `makeAppInstallationClient` | The numeric App ID (`3965781`). |
| `GITHUB_APP_PRIVATE_KEY` | `makeAppInstallationClient` | The App's RSA private key — the **full PEM contents** (`-----BEGIN…`). |
| `GITHUB_APP_WEBHOOK_SECRET` | `POST /webhooks/github` | The webhook signing secret (any strong random string). Must match the App's webhook config. |

`makeAppInstallationClient` throws a clear error if `GITHUB_APP_ID` or
`GITHUB_APP_PRIVATE_KEY` is unset. `POST /webhooks/github` returns `401` if
`GITHUB_APP_WEBHOOK_SECRET` is unset or the `X-Hub-Signature-256` HMAC doesn't
match the raw body (constant-time compared).

## Remaining live-wiring (user-provided)

1. **Private key (.pem):** In the App settings → *Private keys* → **Generate a
   private key**. Download the `.pem`. Set its full contents as the
   `GITHUB_APP_PRIVATE_KEY` secret (e.g. `fly secrets set GITHUB_APP_PRIVATE_KEY="$(cat app.private-key.pem)"`).
2. **Webhook secret:** Generate a strong random string. Set it as the App's
   webhook **Secret** *and* as the `GITHUB_APP_WEBHOOK_SECRET` env/secret on our
   side — they must match for signature verification to pass.
3. **Webhook URL (post-deploy, #103):** After deploy, set the App's webhook
   **Webhook URL** to `https://<deploy-host>/webhooks/github`. Subscribe to the
   **Issues** event (and **ping** is sent automatically on save).
4. **App ID / Client ID:** already set (App ID `3965781`).

## How the webhook maps an event to a Task

- GitHub signs the raw request bytes; we recompute `sha256=` HMAC over the raw
  body with `GITHUB_APP_WEBHOOK_SECRET` and compare in constant time → `401` on
  mismatch.
- `ping` → `{ ok: true }`.
- `issues` with `action === "opened"` → look up our `repos` row by
  `(github_owner, github_name)` from `payload.repository`, resolve its `org_id`
  and a thread wired to that repo (`threads.repo_id`), then insert a Task with id
  `gh:${owner}/${repo}#${number}` (`onConflictDoNothing` → re-deliveries create 0).
- Unknown repo, no repo-thread, non-`opened` action, or any other event →
  `200 { ok: true, ignored: true }` (acknowledged, not an error).

## Swapping the PAT for the App (follow-up)

`OctokitGitHubService` (token/PAT-based) is still the default for repo imports
and run actions. Once installation ids are mapped per repo — a follow-up that
needs an `installations` table (org/repo → `installation_id`, populated from the
`installation` webhook event) — those call sites can swap to
`makeAppInstallationClient(installationId)` for App-scoped, short-lived tokens.
