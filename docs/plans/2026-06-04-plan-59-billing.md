# Plan 59 — Plans & billing: tiers, quotas, checkout (#85)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** reload.chat — pricing tiers with seat/agent/message/task quotas + Stripe checkout/upgrade. Add `plans` (seeded tiers) + `subscriptions` (org→plan), compute **usage vs quota**, enforce on the key create paths (agents, seats), and expose **Stripe Checkout** (upgrade) + **Portal** (manage) via an injectable Stripe client (fake-tested; live uses `STRIPE_API_KEY`, already wired for meter events). Subscription-status webhook is a follow-up (needs the deploy URL #103).

**Branch** `plan-59-billing` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: plans + subscriptions + quota

**Files:** `services/app/src/db/schema.ts` + next migration (`0027_billing.sql`), Create `src/billing/plans.ts`, `plans.test.ts`
- [ ] **Step 1 — schema/migration:** `plans` (id, name, seatLimit int, agentLimit int, messageQuota int, taskQuota int, stripePriceId text nullable) + `subscriptions` (orgId pk, planId, status text default `active`, stripeCustomerId nullable, stripeSubId nullable, currentPeriodEnd nullable). Seed the tiers in the migration (Starter/Individual/Pro/Growth/Custom with ascending limits; use `-1` for unlimited). `pnpm db:migrate`.
- [ ] **Step 2 — `plans.ts`:**
  - `currentPlan(db, orgId)` → the org's subscription plan (default to the Starter plan if no subscription row).
  - `usage(db, orgId)` → `{ seats, agents, messages, tasks }` (counts from members/agents/messages/tasks, org-scoped).
  - `checkQuota(db, orgId, kind: "seats"|"agents"|"messages"|"tasks")` → `{ used, limit, ok }` (`ok` = limit < 0 (unlimited) || used < limit).
  - `setSubscription(db, { orgId, planId, stripeCustomerId?, stripeSubId?, status? })` (upsert).
- [ ] **Step 3 — enforce (light):** in the agent-create path and the invite/seat path (#88's `seatCount`), gate on `checkQuota` (agents/seats) → reject with a clear "quota reached" when not ok. (Reuse #88's soft check, now backed by the plan limit.) Keep it minimal — these two paths demonstrate enforcement.
- [ ] **Step 4 — test:** seed plans (migration); a Starter org → `currentPlan` Starter; `usage` counts; `checkQuota("agents")` ok under limit, not-ok at limit; `setSubscription` to Pro raises the limit; unlimited (`-1`) always ok; org-scoped. `DATABASE_URL=… pnpm test -- plans` + tsc. Commit `feat(app): plans + subscriptions + usage/quota (#85)`.

## Task 1: billing routes (usage + Stripe checkout/portal)

**Files:** Create `services/app/src/http/billing-routes.ts`, `billing-routes.test.ts`; Modify `src/server.ts`; reuse `src/billing/billing.ts` (Stripe client)
- [ ] **Step 1 — routes:** `registerBillingRoutes(app, d: { db, makeStripe? })`:
  - `GET /billing` → `actor(req).orgId`; `{ plan: currentPlan, usage, quotas: {seats,agents,messages,tasks each {used,limit,ok}} }`.
  - `GET /billing/plans` → the available plans.
  - `POST /billing/checkout { planId }` (admin) → build a Stripe Checkout Session for that plan's `stripePriceId` via `const stripe = (d.makeStripe ?? defaultStripe)()` (400 if Stripe not configured / no priceId); return `{ url }`. (Injectable so tests use a fake Stripe returning a URL.)
  - `POST /billing/portal` (admin) → a Stripe Billing Portal session for the org's `stripeCustomerId`; return `{ url }`.
  - Register in `server.ts`.
- [ ] **Step 2 — test** (`app.inject`, fake `makeStripe`): `GET /billing` returns plan + usage + quotas; `GET /billing/plans` lists tiers; `POST /billing/checkout {planId:"pro"}` (admin) → `{url}` from the fake Stripe (called with the plan's priceId); non-admin → 403; checkout with no Stripe configured → 400; cross-org isolation. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): billing routes — usage + Stripe checkout/portal (#85)`.

---

## Self-Review
- Delivers #85's core: plan tiers + org subscriptions + usage/quota computation + enforcement on agents/seats + Stripe Checkout (upgrade) + Portal (manage), injectable Stripe so it's fake-tested and live with `STRIPE_API_KEY`.
- Backward-compat: default Starter plan when no subscription (existing orgs work); quota enforcement only on agents/seats (clear errors); additive tables/routes; reuses the existing Stripe meter wiring. Migration additive + seeds. Existing suites green.
- Note: the Stripe **subscription webhook** (checkout.completed/subscription.updated → `setSubscription`) needs the public deploy URL (#103) — a follow-up; message/task quota *enforcement* on every send + a billing UI tie to #102.

## Definition of Done (85)
app suite green; tsc; migration applies + seeds tiers. `GET /billing` shows plan + usage + per-resource quotas; agents/seats enforce the plan limit; `POST /billing/checkout` (admin) returns a Stripe Checkout URL via the injected client (400 if unconfigured); `POST /billing/portal` returns a portal URL. Org-scoped.
