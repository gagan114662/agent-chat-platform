import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { and, desc, eq } from "drizzle-orm";
import { createGoal, decomposeGoal, listGoals, setGoalAutonomy, autonomousGoals } from "../autonomy/goals.js";
import { tick, type StartRun, type TickResult } from "../autonomy/tick.js";
import { schedulerState } from "../autonomy/scheduler.js";
import { runBusinessGoal } from "../business/actions.js";
import { progressGoal } from "../autonomy/progress.js";
import { orgSpendCents, budgetTier } from "../autonomy/budget.js";
import { detectAlerts, recordAlerts } from "../autonomy/alerts.js";
import { incidents, goals } from "../db/schema.js";
import { defaultRoleGraph, makeFusionExec, runRoleGraph } from "../orchestration/role-graph.js";
import { actor } from "./actor.js";

// `start` is the injectable fusion starter (see tick.ts) — routes pass it through so the
// manual tick trigger can run against a FAKE temporal in tests; production uses the
// default real `startFusionRun`.
export interface AutonomyDeps {
  db: DB;
  sql: postgres.Sql;
  temporal: Client;
  sandboxUrl: string;
  start?: StartRun;
}

export function registerAutonomyRoutes(app: FastifyInstance, d: AutonomyDeps) {
  // List the org's goals (#120: so the Goals panel persists them across nav).
  app.get("/goals", async (req, reply) => {
    const { orgId } = actor(req);
    return reply.code(200).send({ goals: await listGoals(d.db, orgId) });
  });

  // State a goal (once, by a human). Org-scoped via actor. #146: an optional
  // businessId makes this a BUSINESS goal — its tasks run as funnel actions.
  app.post("/goals", async (req, reply) => {
    const { title, criteria, businessId } = (req.body ?? {}) as { title?: string; criteria?: string; businessId?: string };
    const { orgId, userId } = actor(req);
    if (!title) return reply.code(400).send({ error: "title required" });
    const goal = await createGoal(d.db, { orgId, title, criteria, byKind: "human", byId: userId, businessId });
    return reply.code(201).send(goal);
  });

  // #150.2 runtime: run a goal as a coordinated ROLE TEAM — Planner → Coder →
  // Reviewer, each a real agent run, executed in order with prior outputs as
  // context. Fired in the background; the runs stream into the thread live. Needs a
  // repo-bound threadId.
  app.post("/goals/:id/run-team", async (req, reply) => {
    const { id: goalId } = req.params as { id: string };
    const { threadId } = (req.body ?? {}) as { threadId?: string };
    const { orgId } = actor(req);
    if (!threadId) return reply.code(400).send({ error: "threadId (repo-bound) required" });
    const [g] = await d.db.select().from(goals).where(and(eq(goals.id, goalId), eq(goals.orgId, orgId)));
    if (!g) return reply.code(404).send({ error: "goal not found" });
    const graph = defaultRoleGraph(g.title);
    const exec = makeFusionExec({ db: d.db, sql: d.sql, temporal: d.temporal, sandboxUrl: d.sandboxUrl }, { orgId, threadId });
    // fire-and-forget: the team runs in dependency order; watch the thread.
    runRoleGraph(graph, exec).catch((e) => console.warn("[acp] role-graph run failed:", String(e)));
    return reply.code(202).send({ dispatched: true, graph: graph.map((n) => ({ id: n.id, role: n.role, agent: n.agentHandle, deps: n.deps ?? [] })) });
  });

  // #146: advance a business goal now (manual trigger, like "Run now" for code
  // goals) — execute its open tasks as business actions → pending drafts in the
  // approval surface, then judge completion. Org-scoped.
  app.post("/goals/:id/run", async (req, reply) => {
    const { id: goalId } = req.params as { id: string };
    const { orgId } = actor(req);
    const result = await runBusinessGoal(d.db, orgId, goalId);
    const outcome = await progressGoal(d.db, orgId, goalId);
    return reply.code(200).send({ ...result, outcome });
  });

  // Decompose an open goal into Tasks (idempotent, org-scoped). The goal carries the thread.
  app.post("/goals/:id/decompose", async (req, reply) => {
    const { id: goalId } = req.params as { id: string };
    const { threadId, assigneeId } = (req.body ?? {}) as { threadId?: string; assigneeId?: string };
    const { orgId } = actor(req);
    if (!threadId) return reply.code(400).send({ error: "threadId required" });
    const taskIds = await decomposeGoal(d.db, { orgId, goalId, threadId, assigneeId });
    return reply.code(200).send({ taskIds });
  });

  // #137: turn a goal's unattended self-drive on/off. When on, the scheduler
  // advances it task-by-task with no "Run now". Org-scoped.
  app.patch("/goals/:id/autonomy", async (req, reply) => {
    const { id: goalId } = req.params as { id: string };
    const { on } = (req.body ?? {}) as { on?: boolean };
    const { orgId } = actor(req);
    if (typeof on !== "boolean") return reply.code(400).send({ error: "on (boolean) required" });
    const goal = await setGoalAutonomy(d.db, orgId, goalId, on);
    if (!goal) return reply.code(404).send({ error: "goal not found" });
    return reply.code(200).send(goal);
  });

  // #149.2: budget status for the org (read-only) — spend vs cap + tier. Cap from
  // ACP_BUDGET_CAP_CENTS (0 = unmetered). The scheduler enforces (pauses) at hard.
  app.get("/autonomy/budget", async (req, reply) => {
    const { orgId } = actor(req);
    const capCents = Number(process.env.ACP_BUDGET_CAP_CENTS ?? 0);
    const spentCents = await orgSpendCents(d.db, orgId);
    const { tier, ratio } = budgetTier(spentCents, capCents);
    return reply.code(200).send({ spentCents, capCents, tier, ratio: Number(ratio.toFixed(3)) });
  });

  // #137: surface the unattended loop's state — is the clock running, when does it
  // next fire, what did the last cycle do, and which goals are self-driving. Makes
  // the loop observable instead of a black box. Org-scoped (lists this org's goals).
  app.get("/autonomy/status", async (req, reply) => {
    const { orgId } = actor(req);
    const goals = await autonomousGoals(d.db, orgId);
    return reply.code(200).send({
      enabled: schedulerState.enabled,
      intervalMs: schedulerState.intervalMs,
      lastTickAt: schedulerState.lastTickAt,
      nextTickAt: schedulerState.nextTickAt,
      cycles: schedulerState.cycles,
      lastSummary: schedulerState.lastSummary,
      goals: goals.map((g) => ({ id: g.id, title: g.title, iterations: g.iterations })),
    });
  });

  // The manual self-prompt trigger (the production trigger is a Temporal cron — see
  // runTickForAllOrgs below). Guarded so an actor can only tick their own org → 403.
  app.post("/orgs/:orgId/tick", async (req, reply) => {
    const { orgId: pathOrgId } = req.params as { orgId: string };
    const { budgetMax } = (req.body ?? {}) as { budgetMax?: number };
    const { orgId } = actor(req);
    if (orgId !== pathOrgId) return reply.code(403).send({ error: "forbidden" });
    const result = await tick(
      { db: d.db, sql: d.sql, temporal: d.temporal, sandboxUrl: d.sandboxUrl, start: d.start },
      { orgId, budgetMax },
    );
    return reply.code(200).send(result);
  });

  // #93: manual alert scan — detect + record idempotent alert-incidents. Returns
  // the count of NEW alerts. Org-guarded (an actor can only scan their own org → 403).
  app.post("/orgs/:orgId/alerts/scan", async (req, reply) => {
    const { orgId: pathOrgId } = req.params as { orgId: string };
    const { threadId } = (req.body ?? {}) as { threadId?: string };
    const { orgId } = actor(req);
    if (orgId !== pathOrgId) return reply.code(403).send({ error: "forbidden" });
    const detected = await detectAlerts(d.db, orgId);
    const created = await recordAlerts(d.db, d.sql, { orgId, threadId }, detected);
    return reply.code(200).send({ alerts: created });
  });

  // #93: list recent alert-incidents (source "alert"), org-scoped + guarded → 403.
  app.get("/orgs/:orgId/alerts", async (req, reply) => {
    const { orgId: pathOrgId } = req.params as { orgId: string };
    const { orgId } = actor(req);
    if (orgId !== pathOrgId) return reply.code(403).send({ error: "forbidden" });
    const rows = await d.db.select().from(incidents)
      .where(and(eq(incidents.orgId, orgId), eq(incidents.source, "alert")))
      .orderBy(desc(incidents.createdAt), desc(incidents.id))
      .limit(100);
    return reply.code(200).send({ alerts: rows });
  });
}

// Production self-prompt: a Temporal Schedule should fire a `tickActivity` on an interval
// (e.g. every 5 min) that calls this for the platform's active orgs — the system prompting
// itself without a human per action. Each tick is budget-bounded (see tick.ts) so the loop
// stays bounded. Wiring the live Schedule is a follow-up (see worker.ts); this helper is the
// activity body and is what the schedule calls.
//
// TODO(#67): register a Temporal Schedule in fusion/worker.ts that invokes a tickActivity
// wrapping runTickForAllOrgs on a 5-minute interval, per active org.
export async function runTickForAllOrgs(
  d: AutonomyDeps,
  args: { orgIds: string[]; budgetMax?: number },
): Promise<Record<string, TickResult>> {
  const out: Record<string, TickResult> = {};
  for (const orgId of args.orgIds) {
    out[orgId] = await tick(
      { db: d.db, sql: d.sql, temporal: d.temporal, sandboxUrl: d.sandboxUrl, start: d.start },
      { orgId, budgetMax: args.budgetMax },
    );
  }
  return out;
}
