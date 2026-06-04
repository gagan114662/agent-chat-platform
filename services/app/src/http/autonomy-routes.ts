import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { createGoal, decomposeGoal } from "../autonomy/goals.js";
import { tick, type StartRun, type TickResult } from "../autonomy/tick.js";
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
  // State a goal (once, by a human). Org-scoped via actor.
  app.post("/goals", async (req, reply) => {
    const { title, criteria } = (req.body ?? {}) as { title?: string; criteria?: string };
    const { orgId, userId } = actor(req);
    if (!title) return reply.code(400).send({ error: "title required" });
    const goal = await createGoal(d.db, { orgId, title, criteria, byKind: "human", byId: userId });
    return reply.code(201).send(goal);
  });

  // Decompose an open goal into Tasks (idempotent, org-scoped). The goal carries the thread.
  app.post("/goals/:id/decompose", async (req, reply) => {
    const { id: goalId } = req.params as { id: string };
    const { threadId } = (req.body ?? {}) as { threadId?: string };
    const { orgId } = actor(req);
    if (!threadId) return reply.code(400).send({ error: "threadId required" });
    const taskIds = await decomposeGoal(d.db, { orgId, goalId, threadId });
    return reply.code(200).send({ taskIds });
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
