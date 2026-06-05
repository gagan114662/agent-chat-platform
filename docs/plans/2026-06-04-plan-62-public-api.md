# Plan 62 — Public API: OpenAPI spec + docs + TS/Python SDKs (#86)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat — a documented REST API (envelope + path families), an OpenAPI spec, a tool catalogue, and Python/TS SDKs. MVP: a hand-authored **OpenAPI 3** document covering the core public routes (auth, channels/threads/messages, tasks, runs, memory, integrations, billing), served at `GET /openapi.json` + a `GET /docs` Swagger UI; a `docs/api.md` **agent tool catalogue**; a thin **TypeScript SDK**; a **Python SDK** stub. Auth via bearer (session or `acp_` API key, #83).

**Branch** `plan-62-public-api` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: OpenAPI spec + /openapi.json + /docs

**Files:** Create `services/app/src/api/openapi.ts`, `openapi.test.ts`, `src/http/openapi-routes.ts`, `openapi-routes.test.ts`; Modify `src/server.ts`, `src/http/auth-routes.ts` (public paths)
- [ ] **Step 1 — `openapi.ts`:** export a static `openapiSpec` object (OpenAPI 3.1): `info` (title "agent-chat-platform API", version), a `bearerAuth` security scheme (HTTP bearer; note both session tokens and `acp_` API keys), and `paths` for the **core** routes with request/response schemas (don't enumerate all 50 — cover the agent-useful families): `POST /auth/login`, `POST/GET /channels`, `GET/POST /threads/:id/messages`, `POST /tasks/bulk` + `GET/PATCH /tasks/:id`, `GET /runs/:id/diff` + approve/decline, `GET/POST /memory` + `/memory/recall`, `POST /integrations/{linear,github}/import`, `GET /billing`. Reusable `components.schemas` (Message, Task, Run, MemoryNode, etc.).
- [ ] **Step 2 — routes:** `GET /openapi.json` → the spec (public). `GET /docs` → a small HTML page rendering Swagger UI from the CDN against `/openapi.json` (static string; no dep needed). Both public (add to PUBLIC_PATHS / preHandler bypass). Register in `server.ts`.
- [ ] **Step 3 — test:** `openapi.test.ts` — the spec has `openapi: "3..."`, `info.title`, the `bearerAuth` scheme, and ≥8 paths; every path object has a method with a `responses`. `openapi-routes.test.ts` — `GET /openapi.json` 200 + valid JSON spec (public, no auth needed); `GET /docs` 200 HTML referencing `/openapi.json`. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): OpenAPI spec + /openapi.json + /docs (#86)`.

## Task 1: TS SDK + Python SDK + tool catalogue

**Files:** Create `services/sdk-ts/{package.json,src/index.ts,src/index.test.ts,tsconfig.json}`, `services/sdk-py/{acp/__init__.py,README.md}`, `docs/api.md`; add `services/sdk-ts` to `pnpm-workspace.yaml`
- [ ] **Step 1 — TS SDK (`services/sdk-ts`):** a typed `AcpClient({ baseUrl, token })` wrapping `fetch` with `Authorization: Bearer <token>`: methods `listChannels()`, `listMessages(threadId)`, `postMessage(threadId, body)`, `listTasks?`, `createTasksBulk(threadId, items)`, `runDiff(runId)`, `approveRun(runId)`, `memoryRecall(q)`, `importLinear(threadId)`, `getBilling()`. Pure fetch (Node 20+/edge). Test with a fake `fetch` injected (assert the URL/method/headers/body for a couple of methods). `pnpm --filter @acp/sdk-ts test` + a tsc/build. (Add to the workspace.)
- [ ] **Step 2 — Python SDK stub (`services/sdk-py`):** `acp/__init__.py` with an `AcpClient(base_url, token)` using `urllib`/`requests`-free `urllib.request`, a few methods mirroring the TS SDK + a README. (No test harness required for Python here; keep it a minimal, correct stub with a `__main__` smoke that's documented.)
- [ ] **Step 3 — `docs/api.md`:** the **agent tool catalogue** — the API-callable operations grouped by family (chat, tasks, runs, memory, integrations, billing, admin), each with method+path+purpose+auth (session or `acp_` key #83). Link `/openapi.json` + the SDKs. Commit `feat(sdk): TypeScript + Python SDKs + API tool catalogue (#86)`.

---

## Self-Review
- Delivers #86's core: a served OpenAPI 3 spec (`/openapi.json` + `/docs`), a documented tool catalogue, a thin TypeScript SDK (tested), and a Python SDK stub — a real, documented public API surface over the existing routes, auth via session or API key (#83).
- Backward-compat: additive (spec/routes/docs/SDK packages); `/openapi.json` + `/docs` are public; no existing route changes. The SDK is a new workspace package. Existing suites green.
- Note: a strict response envelope on EVERY route + auto-generated (vs hand-authored) OpenAPI + a published/full-coverage SDK are follow-ups; this delivers the spec + catalogue + SDKs for the core API.

## Definition of Done (86)
app + sdk-ts suites green; tsc. `GET /openapi.json` serves a valid OpenAPI 3 spec (≥8 core paths, bearerAuth) publicly; `GET /docs` renders it; `docs/api.md` catalogues the agent-callable API; a tested TS SDK + a Python SDK stub exist.
