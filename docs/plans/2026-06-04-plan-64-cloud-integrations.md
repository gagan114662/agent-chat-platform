# Plan 64 — Cloud integrations: Slack (+ Gmail/Workspace/HubSpot scaffold) (#100)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's call):** Luo-style cloud integrations. Deliver the **mechanism** with **Slack** as the first concrete outbound integration: a `postSlack` action (env `SLACK_BOT_TOKEN` or `SLACK_WEBHOOK_URL`, injectable client), usable as an **automation action** (#98) and an **alert** destination (#93), gated by the approval/authz model. Gmail/Google-Workspace/HubSpot follow the same `Integration` shape — scaffolded + documented (each needs its own creds). All env-driven + fake-tested; no live calls in tests.

**Branch** `plan-64-cloud-integrations` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Slack integration + automation action

**Files:** Create `services/app/src/integrations/slack.ts`, `slack.test.ts`; Modify `src/autonomy/automations.ts` (add a `slack` action type), `automations.test.ts`
- [ ] **Step 1 — `slack.ts`:** `SlackClient` interface `{ postMessage(channel: string, text: string): Promise<void> }`. `makeSlackClient()` → real impl: if `SLACK_BOT_TOKEN` set, POST to `https://slack.com/api/chat.postMessage` (Bearer); elif `SLACK_WEBHOOK_URL` set, POST the webhook; else throw `"slack not configured"`. (Injectable so tests use a fake.) `slackConfigured()` helper.
- [ ] **Step 2 — automation action:** extend `executeAction` (#98) with an `action.type === "slack"` → `{ channel, text }` posting via `(deps.makeSlack ?? makeSlackClient)()`. Guarded — if Slack unconfigured, skip (don't throw and break the automation run). Add `slack` to the action-type validation in the routes.
- [ ] **Step 3 — test:** `slack.test.ts` — `makeSlackClient` with a fake fetch posts to chat.postMessage with the right body/auth when `SLACK_BOT_TOKEN` set; webhook path when only `SLACK_WEBHOOK_URL`; throws when neither. `automations.test.ts` — a `slack` automation action calls the injected Slack client with the configured channel/text; unconfigured → skipped (no throw). `DATABASE_URL=… pnpm test -- slack automations` + tsc. Commit `feat(app): Slack integration + slack automation action (#100)`.

## Task 1: alert routing + integration registry + docs

**Files:** `services/app/src/autonomy/alerts.ts` (optional Slack route), Create `src/integrations/registry.ts`, `registry.test.ts`, `docs/integrations/cloud-integrations.md`; a small route `src/http/integration-routes.ts` (extend)
- [ ] **Step 1 — alert→Slack (optional):** in `recordAlerts` (#93), if `SLACK_ALERT_CHANNEL` is configured and Slack is available, also post each new alert to Slack (best-effort, guarded). Keep the in-thread post as today.
- [ ] **Step 2 — integration registry:** `registry.ts` — a small catalog of cloud integrations `{ name, configured(): boolean, tier }` for `slack` (configured), and **scaffold** entries for `gmail`, `google-workspace`, `hubspot` (`configured()` reads their env, default false). `listIntegrations()` → status of each (configured or "needs credentials"). A `GET /integrations` route returning the registry status (org-scoped/authed).
- [ ] **Step 3 — test + docs:** `registry.test.ts` — `listIntegrations` reports slack configured (env set) vs the others "needs credentials"; route returns the list. `docs/integrations/cloud-integrations.md` — the `Integration` pattern + the exact env each needs: Slack (`SLACK_BOT_TOKEN`/`SLACK_WEBHOOK_URL`), Gmail (`GOOGLE_*` OAuth), Workspace (Drive/Calendar scopes), HubSpot (`HUBSPOT_TOKEN`); note money/irreversible actions route through the approval gate (#16/#21) + tiering (#97). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): integration registry + alert→Slack + cloud-integration docs (#100)`.

---

## Self-Review
- Delivers #100's core: a working **Slack** outbound integration (automation action + optional alert routing), env-driven + injectable + fake-tested, plus an integration **registry** that reports each cloud integration's config status, with Gmail/Workspace/HubSpot scaffolded to the same shape + documented (creds-gated).
- Backward-compat: additive module/action/route/docs; the `slack` action + alert routing are best-effort/guarded (unconfigured → skipped, no break); existing automations/alerts unchanged. Org-scoped. Existing suites green.
- Note: the live Slack/Gmail/Workspace/HubSpot wiring needs each provider's token/OAuth (documented); read APIs (e.g. Gmail read → Task) + a per-integration OAuth flow are follow-ups on this registry.

## Definition of Done (100)
app suite green; tsc. Slack post works (token or webhook, throws unconfigured); a `slack` automation action posts via the injected client (skips unconfigured); `recordAlerts` optionally routes to Slack; `GET /integrations` reports slack configured + gmail/workspace/hubspot "needs credentials"; docs list the required creds.
