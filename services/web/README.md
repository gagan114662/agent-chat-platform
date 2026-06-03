# @acp/web — chat + tasks UI (Plan 2.0b)

React + Vite + Tailwind UI for the agent-chat-platform. Consumes the `@acp/app` backend
(`GET /threads/:id/messages`, `GET /ws?threadId=`, `POST /threads/:id/messages`).

## Dev
1. Start the backend stack (see `services/app/README.md`) on `localhost:8080`.
2. `cd services/web && pnpm dev` → open the printed URL.
   Vite proxies `/threads` and `/ws` to `localhost:8080`.
3. Type `@coder <intent>` in the composer and watch live step events + the final PR card.

Dev auth is a stub (`x-org-id: o1`, `x-user-id: m1`); real auth is Phase 2.2.

## Test / build
- `pnpm test` — component + hook tests (jsdom).
- `pnpm build` — typecheck + production bundle.
