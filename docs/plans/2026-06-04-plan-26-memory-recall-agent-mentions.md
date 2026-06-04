# Plan 26 — Memory recall (#26 close-out) + agent↔agent mentions (#27 close-out)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps. TDD.

**Design (author's calls):** Two close-outs.
- **#26 memory recall:** the typed context graph (decision/fact/preference/identity/artifact nodes + edges + scopes) and **capture** (`captureDecision` writes a node per run) already exist. The missing half is **recall** — using that memory. Add `recallForIntent` (keyword match over the org's nodes), a `GET /memory/recall` route, and wire recalled context into the **agent's intent** at run start so prior decisions/facts inform new runs.
- **#27 agent↔agent mentions:** task hand-off (Plan 17) and human multi-mention (N agents → N runs) already work. The missing half is letting an **agent-authored** message trigger mentions (so agents can coordinate by @mentioning each other), with a **loop guard** (bounded mention depth, no self-trigger). Extract the mention logic into a shared `handleMentions` and make it depth-aware + callable for agent authors.

**Branch** `plan-26-memory-recall-agent-mentions` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0 (#26): `recallForIntent` + recall route

**Files:** `services/app/src/memory/memory.ts`, `memory.test.ts`, `src/http/memory-routes.ts`, `memory-routes.test.ts`
- [ ] **Step 1 — `recallForIntent`:** add to `memory.ts`:
```ts
// Pulls the org's memory nodes most relevant to an intent: tokenizes the intent
// into words (>=4 chars), matches them against node label/body (ILIKE), ranks by
// number of distinct term hits, returns the top `limit`. Decisions/facts/preferences
// are the useful kinds for run context (identities/artifacts excluded by default).
export async function recallForIntent(
  db: DB, orgId: string, intent: string, limit = 5,
): Promise<Awaited<ReturnType<typeof listNodes>>> {
  const terms = [...new Set((intent.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []))].slice(0, 12);
  if (terms.length === 0) return [];
  const rows = await db.select().from(memoryNodes).where(and(
    eq(memoryNodes.orgId, orgId),
    inArray(memoryNodes.kind, ["decision", "fact", "preference"]),
    or(...terms.flatMap((t) => [ilike(memoryNodes.label, `%${t}%`), ilike(memoryNodes.body, `%${t}%`)])),
  ));
  const score = (n: { label: string; body: string }) =>
    terms.filter((t) => n.label.toLowerCase().includes(t) || (n.body ?? "").toLowerCase().includes(t)).length;
  return rows.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

// Formats recalled nodes into a compact context preamble for an agent prompt (or "").
export function formatRecall(nodes: Awaited<ReturnType<typeof listNodes>>): string {
  if (nodes.length === 0) return "";
  const lines = nodes.map((n) => `- (${n.kind}) ${n.label}${n.body ? `: ${n.body}` : ""}`);
  return `## Relevant prior context\n${lines.join("\n")}`;
}
```
- [ ] **Step 2 — test (`memory.test.ts`):** seed org-A nodes — a `decision` labeled "Use Postgres LISTEN/NOTIFY for realtime", a `fact` "Auth uses scrypt", an unrelated `artifact`; `recallForIntent(db,"o1","add realtime notify to the auth flow")` returns the decision + fact (not the artifact), decision ranked appropriately; an org-B node never appears (org-scoped). Empty/short intent → `[]`.
- [ ] **Step 3 — route (`memory-routes.ts`):** `GET /memory/recall?q=...&limit=` → `actor(req).orgId`, `recallForIntent(db, orgId, q, limit)`. Test in `memory-routes.test.ts`: returns matching nodes; cross-org isolated; missing `q` → `[]`/400. `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): memory recall (recallForIntent + GET /memory/recall) (#26)`.

## Task 1 (#26): inject recalled context into the run intent

**Files:** `services/app/src/fusion/activities.ts`, `services/orchestrator/src/core/run-fusion.ts` (PR title cleanup), `run-fusion.test.ts`
- [ ] **Step 1 — clean PR title (orchestrator):** in `run-fusion.ts`, change the PR title from `agent: ${input.intent}` to `agent: ${input.intent.split("\n")[0].slice(0, 72)}` (so a multi-line intent — now possible with a context preamble — yields a clean single-line title). Body keeps the full intent. Update/confirm run-fusion tests (the title assertion, if any, still matches for single-line intents). `pnpm test` + tsc.
- [ ] **Step 2 — activity wiring (`activities.ts`):** before starting the fusion run, recall + augment the intent the AGENT sees:
```ts
const recalled = await recallForIntent(db, input.orgId, input.intent);
const preamble = formatRecall(recalled);
const agentIntent = preamble ? `${input.intent}\n\n${preamble}` : input.intent;
```
  pass `agentIntent` as the `intent` to `runFusionTraced`/the sandbox (the first line stays the original task, so the PR title from Step 1 is clean). Keep `captureDecision` as-is. (Read `activities.ts` first to wire at the right spot; `db`/`input.orgId` are in scope there.)
- [ ] **Step 3 — test:** an activity/integration test (or a focused unit around the intent-building) asserting that when matching memory exists, the intent passed downstream includes the `## Relevant prior context` block, and without memory it's unchanged. (If the activity is hard to unit-test directly, extract the 3-line intent-builder into a tiny exported `buildAgentIntent(db, orgId, intent)` and test that.) `pnpm test` + tsc. Commit `feat(app): inject recalled memory into the agent intent (#26)`.

## Task 2 (#27): shared, loop-guarded mention handler for agent authors

**Files:** Create `services/app/src/chat/handle-mentions.ts`, `handle-mentions.test.ts`; Modify `src/http/routes.ts` (use the shared handler), `src/fusion/start.ts` (carry mentionDepth), `src/db/schema.ts` if needed (else store depth in run/task metadata)
- [ ] **Step 1 — extract `handleMentions`:** move the mention loop from `routes.ts` POST `/threads/:id/messages` into `handleMentions(d: { db, sql, temporal, sandboxUrl }, m: { orgId, threadId, body, authorKind: "human" | "agent", authorId, depth: number }): Promise<string[]>` (returns started run ids). It: parses mentions, resolves each agent (org-scoped), skips repo/token gaps (existing logic), AND:
  - **loop guard:** `const MAX_DEPTH = 2; if (m.depth >= MAX_DEPTH) return [];`
  - **no self-trigger:** skip a mention that resolves to `m.authorId` when `m.authorKind === "agent"`.
  - starts each run via `startFusionRun(..., { mentionDepth: m.depth + 1 })`.
  Refactor the human handler to call `handleMentions(..., { authorKind: "human", authorId: userId, depth: 0 })` — behavior for humans is identical (depth 0 → children at depth 1). Keep its existing tests green.
- [ ] **Step 2 — carry depth:** add `mentionDepth?: number` to `StartFusionRunInput` (default 0) and thread it into the `RunFusionActivityInput`/sink ctx so a run knows its depth. When an agent run later authors a message (Step 3), it passes its own depth.
- [ ] **Step 3 — agent-authored trigger:** add a guarded path so an agent message can trigger mentions. Minimal + real: a `postAgentMessage(d, { orgId, threadId, agentId, body, depth })` helper that `createMessage(authorKind:"agent")` + `notify` + `handleMentions(..., authorKind:"agent", authorId: agentId, depth)`. (This is the primitive agents use to coordinate; wiring it to a specific run-completion trigger is a follow-up — the capability + guard is what #27 needs.)
- [ ] **Step 4 — test (`handle-mentions.test.ts`):** with a fake temporal: (a) an `authorKind:"agent"` message "@bob please review" where bob is another org-A agent on a repo → returns 1 run id (bob's run started). (b) a self-mention (`@self` resolving to the author agent) → 0 runs. (c) `depth: 2` (= MAX) → 0 runs (loop guard). (d) human depth-0 path unchanged (existing routes tests stay green). `DATABASE_URL=… pnpm test` + tsc. Commit `feat(app): agent↔agent mentions via shared loop-guarded handler (#27)`.

---

## Self-Review
- **#26:** capture (existing) + recall (new) closes the loop — memory is now queryable (`GET /memory/recall`) and actually fed into agent runs (intent preamble), org-scoped. The typed graph + scopes were already complete.
- **#27:** hand-off + multi-mention (existing) + agent-authored, depth-guarded mentions (new) — agents can now coordinate by @mention without infinite loops (MAX_DEPTH=2, no self-trigger). The human path is refactored onto the same shared handler (behavior identical).
- Backward-compat: recall preamble only augments the agent's intent (PR title cleaned to first line); `mentionDepth` defaults 0; `handleMentions` is a pure refactor for the human path. All existing suites green; org-scoped throughout (#14).
- Note: the concrete UX that makes an agent emit a coordinating @mention at run-completion is a follow-up; this delivers the capability + guard (proven via the fake-temporal test).

## Definition of Done (26, 27)
app + orchestrator suites green + tsc. `GET /memory/recall` returns intent-relevant nodes; agent runs get a recalled-context preamble. An agent-authored message can start another agent's run, bounded by depth and self-mention guards; the human mention path is unchanged. Org-scoped.
