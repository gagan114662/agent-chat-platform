# Plan 77 — Frontend parity II: Billing + Automations + Memory panels (#102)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD. Web-only.

**Design (author's call):** the second #102 slice — surface the remaining high-value backend in the web UI: a **Billing** panel (plan + usage + quotas + upgrade #85), an **Automations** panel (list/create schedule+event automations #98), and a **Memory** panel (recall search + consolidate + node list #26/#40/#82). Pure web over existing routes (proxied, #101). After this the web app materially mirrors the backend; per-feature polish continues organically.

**Branch** `plan-77-frontend-parity-2` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: Billing + Automations panels

**Files:** `services/web/src/api.ts`, Create `src/components/BillingPanel.tsx`, `BillingPanel.test.tsx`, `src/components/AutomationsPanel.tsx`, `AutomationsPanel.test.tsx`; Modify `src/App.tsx` + the command registry (#60)
- [ ] **Step 1 — `api.ts`:** `getBilling()` (→ plan + usage + quotas), `listPlans()`, `billingCheckout(planId)`; `listAutomations()`, `createAutomation(name, trigger, action)`, `setAutomationEnabled(id, enabled)`, `deleteAutomation(id)`. (Read the real routes — `GET /billing`, `GET /billing/plans`, `POST /billing/checkout`, `GET/POST /automations`, `PATCH/DELETE /automations/:id`.)
- [ ] **Step 2 — `BillingPanel.tsx`:** shows the current plan + a usage/quota table (seats/agents/messages/tasks: used/limit, an "over" indicator) + an "Upgrade" button per plan that calls `billingCheckout` and redirects to the returned URL. `AutomationsPanel.tsx`: lists automations (trigger summary + enabled toggle + delete) + a create form (name, trigger type schedule/event + its param, action type message/run/slack + its params).
- [ ] **Step 3 — tests:** `BillingPanel.test.tsx` — renders plan + a quota row from a fetch; clicking Upgrade calls `billingCheckout`. `AutomationsPanel.test.tsx` — lists an automation; toggling enabled calls `setAutomationEnabled`; submitting the create form calls `createAutomation`. `cd services/web && pnpm test`. Commit `feat(web): Billing + Automations panels (#102)`.

## Task 1: Memory panel

**Files:** `services/web/src/api.ts`, Create `src/components/MemoryPanel.tsx`, `MemoryPanel.test.tsx`; Modify `src/App.tsx`
- [ ] **Step 1 — `api.ts`:** `memoryRecall(q)` (GET /memory/recall), `memoryConsolidate()` (POST /memory/consolidate), `listMemoryNodes?()` (GET /memory or the graph — use what exists). (Only-existing routes.)
- [ ] **Step 2 — `MemoryPanel.tsx`:** a recall search box (query → results list of nodes with kind/label/body), a "Consolidate (dream)" button (calls `memoryConsolidate`, shows the created count), and a list of recent nodes. Reachable from nav/⌘K.
- [ ] **Step 3 — test:** `MemoryPanel.test.tsx` — entering a query + search calls `memoryRecall` and renders results; the Consolidate button calls `memoryConsolidate` and shows the count. `cd services/web && pnpm test && pnpm build`. Commit `feat(web): Memory panel — recall + consolidate (#102)`.

---

## Self-Review
- Surfaces Billing (#85), Automations (#98), and Memory (#26/#40/#82) in the web UI — with Goals/Agents/Tasks/identity (Plan 65) + the existing PR/Plan/diff/preview/palette/inbox surfaces, the web app now materially mirrors the backend.
- Backward-compat: additive components + api fns over existing routes; reachable via nav/palette like the prior panels; existing web suites green; build clean. Only-existing endpoints called.
- Note: deeper per-feature polish (files/attachments UI, RBAC/teams/invites admin screens, root-cause/debug surface, a board view) remains incremental; the high-value backend is now reachable. #102 can close as "backend materially surfaced; polish ongoing."

## Definition of Done (102 — close)
web suite green + build. Billing (plan+usage+quotas+upgrade), Automations (list/create/toggle), and Memory (recall+consolidate) panels work over the real routes and are reachable from the UI. The web app surfaces the core of the shipped backend.
