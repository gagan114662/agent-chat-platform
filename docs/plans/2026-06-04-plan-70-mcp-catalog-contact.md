# Plan 70 — Curated MCP catalog (#97) + contact-form backend (#69)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's calls):** two small items.
- **#97** — expand the #57 MCP catalog with the curated 50-essential-mcp-servers entries, each **security-tiered** (safe/sensitive/money); the existing default-deny authz (#38/#57) already gates them; add a doc.
- **#69** — the landing contact form is a no-op (`console.log`). Add a `POST /contact` endpoint that persists the lead, and wire the landing form to it (falls back to log in standalone dev).

**Branch** `plan-70-mcp-catalog-contact` (off `main`). Go in `services/sandbox-runner`; app + landing. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: curated MCP catalog (#97, Go)

**Files:** `services/sandbox-runner/adapter/mcp.go`, `mcp_test.go`, Create `docs/integrations/mcp-catalog.md`
- [ ] **Step 1 — expand `mcpCatalog`** in `mcp.go` with curated entries + tiers (`safe` | `sensitive` | `money`):
  - **safe** (read-only / local): `filesystem`, `git`, `fetch`, `time`, `sequential-thinking`, `memory`, `context7`, `sqlite`, `brave-search`.
  - **sensitive** (writes/external): `github`, `gitlab`, `slack`, `notion`, `linear`, `postgres`, `redis`, `supabase`, `sentry`, `gdrive`, `cloudflare`, `vercel`, `kubernetes`, `docker`.
  - **money** (irreversible / funds): `stripe`, `paypal`, `plaid`, `quickbooks`, `alpaca`, `ccxt`, `etherscan`, `coingecko`.
  (Commands best-effort `npx -y @modelcontextprotocol/server-<x>` / vendor packages; refined when wired live. Keep the `mcpCatalogEntry` shape from #57.)
- [ ] **Step 2 — authz unchanged:** `mcpAuthorized` already (from #57) allows `safe` by default and requires `ACP_ALLOWED_MCP` for everything else — confirm `money`-tier entries are NOT default-allowed. Add assertions.
- [ ] **Step 3 — test + doc:** `mcp_test.go` — `mcpAuthorized("filesystem")` true; `mcpAuthorized("github")`/`"stripe")` false without `ACP_ALLOWED_MCP`, true with it; `stripe` is `money` tier; the catalog has ≥25 entries. `docs/integrations/mcp-catalog.md` — the catalog grouped by tier, the default-deny rule, the "3-5 active max" guidance, and that money/irreversible require explicit per-org authorization + the approval gate (#16/#21). `go build/vet/test ./...`. Commit `feat(sandbox): curated MCP catalog with security tiers (#97)`.

## Task 1: contact-form backend (#69)

**Files:** `services/app/src/db/schema.ts` + next migration (`0032_contacts.sql`), Create `src/http/contact-routes.ts`, `contact-routes.test.ts`; Modify `src/server.ts`, `src/http/auth-routes.ts` (public path), `services/landing/src/components/Contact.tsx`
- [ ] **Step 1 — schema/migration:** `contacts` table: `id` (pk), `name`, `email`, `website`, `help` (text), `createdAt`. (No orgId — public lead capture.) `pnpm db:migrate`.
- [ ] **Step 2 — route:** `POST /contact { name, email, website?, help? }` — **public** (add to PUBLIC_PATHS / preHandler bypass; it's a marketing form), basic validation (email present, lengths capped), insert a row, return `{ ok: true }`. (A lightweight rate-limit via the existing `allow()` #51 keyed on IP is a nice touch.) Register in `server.ts`.
- [ ] **Step 3 — landing:** `Contact.tsx` `submit` → `fetch("/contact", { method:"POST", … })`; on success show a "thanks" state; on failure fall back to the existing console.log (so standalone dev still works). Remove the "No backend yet" comment.
- [ ] **Step 4 — test:** `contact-routes.test.ts` — `POST /contact` with valid fields → 200 + a `contacts` row; missing email → 400; it's reachable without auth (public). `DATABASE_URL=… pnpm test` + tsc; `cd services/landing && pnpm build`. Commit `feat(app): contact-form backend + landing wiring (#69)`.

---

## Self-Review
- #97: a real, security-tiered MCP catalog (≥25 servers) over the #57 default-deny authz — money/irreversible never default-allowed; documented with the 3-5-max + approval-gate guidance. #69: the landing contact form persists leads via a public `POST /contact` (no more dead form), with a dev fallback.
- Backward-compat: #97 is catalog data + a doc (authz unchanged); #69 is additive (public route + a landing fetch with fallback); migration additive. Existing suites green.
- Note: live MCP commands per server + an in-app install flow (#102) are follow-ups; contact-form email notification is a thin add.

## Definition of Done (97, 69)
go + app suites green; tsc; landing builds; migration applies. The MCP catalog has ≥25 tiered entries (money default-denied); `docs/integrations/mcp-catalog.md` documents them. `POST /contact` persists a lead (public, validated); the landing form posts to it (no more console-log-only).
