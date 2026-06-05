# agent-chat-platform — API tool catalogue (#86)

The public REST API for **agent-chat-platform** (reload.chat), grouped by family.
This is the agent-facing catalogue of callable operations; the full
machine-readable contract is served at **`GET /openapi.json`** with an interactive
Swagger UI at **`GET /docs`** (both public — no auth).

## Authentication

Every route except `/auth/login`, `/openapi.json`, and `/docs` requires a bearer
token:

```
Authorization: Bearer <token>
```

The token is either:

- a **user session token** — obtain via `POST /auth/login` (or magic-link / Google SSO), or
- an **`acp_`-prefixed API key** (#83) — revocable, org-scoped, for machine clients.

All resources are **org-scoped**: a cross-org id resolves as `404`, not `403`.

## SDKs

- **TypeScript:** [`@acp/sdk-ts`](../services/sdk-ts) — `new AcpClient({ baseUrl, token })`, pure `fetch`.
- **Python:** [`acp`](../services/sdk-py) — `AcpClient(base_url, token)`, stdlib `urllib` only.

---

## chat

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET    | `/channels` | List channels in the org (`?includeArchived=1`) | session or `acp_` key |
| POST   | `/channels` | Create a channel (requires `channel:create`) | session or `acp_` key |
| GET    | `/channels/:id/threads` | List a channel's threads | session or `acp_` key |
| POST   | `/channels/:id/threads` | Create a thread (requires `thread:create`) | session or `acp_` key |
| GET    | `/threads/:id/messages` | List messages (`?before&after&limit`) | session or `acp_` key |
| POST   | `/threads/:id/messages` | Post a message (triggers `@mention` runs) | session or `acp_` key |
| GET    | `/search?q=` | Full-text search messages | session or `acp_` key |

## tasks

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST   | `/tasks/bulk` | Bulk-create ≤50 tasks in one transaction | session or `acp_` key |
| GET    | `/tasks/:id` | Get a task with comments + relations | session or `acp_` key |
| PATCH  | `/tasks/:id` | Update priority / due date / state | session or `acp_` key |
| POST   | `/tasks/:id/comments` | Add a comment to a task | session or `acp_` key |
| POST   | `/tasks/:id/relations` | Link two tasks (`blocks`/`related`/`duplicate`) | session or `acp_` key |

## runs

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET    | `/runs/:id/diff` | Changed files for a run's PR | session or `acp_` key |
| POST   | `/runs/:id/approve` | Approve a held run (merges its PR) | session or `acp_` key |
| POST   | `/runs/:id/decline` | Decline a held run | session or `acp_` key |

## memory

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET    | `/memory` | List or search (`?kind&scope&q`) memory nodes | session or `acp_` key |
| POST   | `/memory` | Create a memory node (org scope needs `memory:write:org`) | session or `acp_` key |
| GET    | `/memory/recall?q=` | Recall the top-N relevant nodes for an intent | session or `acp_` key |
| GET    | `/memory/stats` | Node counts | session or `acp_` key |
| GET    | `/memory/graph` | The memory graph (`?kind&scope`) | session or `acp_` key |
| GET    | `/memory/:id/neighbors` | A node's neighbours | session or `acp_` key |
| POST   | `/memory/nodes/:id/supersede` | Optimistic-locked supersede | session or `acp_` key |
| POST   | `/memory/nodes/:id/invalidate` | Invalidate a node | session or `acp_` key |
| POST   | `/memory/nodes/:id/revalidate` | Revalidate a node | session or `acp_` key |
| POST   | `/memory/contradictions` | Record a contradiction edge | session or `acp_` key |

## integrations

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST   | `/integrations/linear/import` | Import Linear issues into a thread as tasks | session or `acp_` key |
| POST   | `/integrations/github/import` | Import GitHub issues into a thread as tasks | session or `acp_` key |

## billing

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET    | `/billing` | The org's plan, usage, and per-resource quotas | session or `acp_` key |
| GET    | `/billing/plans` | Available pricing tiers (reference data) | session or `acp_` key |
| POST   | `/billing/checkout` | Stripe Checkout session (requires `team:manage`) | session or `acp_` key |
| POST   | `/billing/portal` | Stripe Billing Portal session (requires `team:manage`) | session or `acp_` key |

## auth / admin

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST   | `/auth/login` | Exchange credentials (+ optional MFA `code`) for a session | **public** |
| POST   | `/auth/logout` | Revoke the current session | session |
| GET    | `/auth/me` | The current principal + role | session or `acp_` key |
| POST   | `/auth/mfa/enroll` · `/confirm` · `/disable` | TOTP MFA lifecycle | session |
| PATCH  | `/channels/:id` | Rename a channel (requires `channel:manage`) | session or `acp_` key |
| POST   | `/channels/:id/archive` | Archive / unarchive a channel (requires `channel:manage`) | session or `acp_` key |
| GET    | `/openapi.json` | The OpenAPI 3 spec | **public** |
| GET    | `/docs` | Swagger UI | **public** |
