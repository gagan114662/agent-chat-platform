import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { goals as goalsTable, tasks } from "../db/schema.js";
import { tick, type StartRun } from "./tick.js";
import { autonomousGoals, setGoalAutonomy } from "./goals.js";
import { progressGoal, type GoalOutcome, type NextStepGen } from "./progress.js";
import { runBusinessGoal } from "../business/actions.js";
import { runGtmMotion } from "../gtm/runner.js";
import { LoopGuard, fingerprint } from "./loop-guard.js";
import { enforceBudget } from "./budget.js";

// #149.1 one Loop-Guard for the unattended clock: trips a goal that loops without
// making progress (same open-task state across cycles) or exceeds the iteration cap.
export const loopGuard = new LoopGuard(Number(process.env.ACP_LOOP_MAX_ITERATIONS ?? 15));

// #137 the unattended clock. A human is no longer the clock: this drives every
// org that has an active, autonomy-on goal, on an interval. Each cycle, per org:
//   1) progress each autonomy goal (#138): close it if its criteria are met, or
//      generate the next tasks toward the gap (bounded), or stop for a human;
//   2) tick (autonomousOnly): dispatch the goals' ready tasks within the budget.
// Backpressure: the per-tick budget caps concurrent dispatch; progressGoal caps
// self-generated iterations; done/stuck goals drop out of the autonomousGoals set.

export interface SchedulerDeps {
  db: DB;
  sql: postgres.Sql;
  temporal: Client;
  sandboxUrl: string;
  start?: StartRun;
  budgetMax?: number;
  gen?: NextStepGen;
}

export interface GoalProgress { goalId: string; title: string; outcome: GoalOutcome; suspended?: string }
export interface CycleResult { orgs: number; goals: GoalProgress[]; dispatched: number }

// orgsWithAutonomy: distinct orgs that have at least one active, autonomy-on goal.
async function orgsWithAutonomy(db: DB): Promise<string[]> {
  const rows = await db.selectDistinct({ orgId: goalsTable.orgId }).from(goalsTable)
    .where(and(eq(goalsTable.state, "active"), eq(goalsTable.autonomy, true)));
  return rows.map((r) => r.orgId).filter(Boolean);
}

// runAutonomyCycle: one full pass across every self-driving org. Returns a summary
// for observability (what it closed / generated / dispatched this tick).
export async function runAutonomyCycle(d: SchedulerDeps): Promise<CycleResult> {
  const orgIds = await orgsWithAutonomy(d.db);
  const goals: GoalProgress[] = [];
  let dispatched = 0;
  const capCents = Number(process.env.ACP_BUDGET_CAP_CENTS ?? 0);
  for (const orgId of orgIds) {
    // #149.2 budget gate: at the hard limit, pause this org's autonomy goals and
    // skip the cycle — no overspend. (capCents 0 = unmetered, no enforcement.)
    const budget = await enforceBudget(d.db, orgId, capCents);
    if (budget.tier === "hard") {
      goals.push({ goalId: "-", title: `budget hard limit (${budget.spentCents}¢/${capCents}¢)`, outcome: { status: "stuck", blocked: budget.pausedGoals }, suspended: "budget cap reached — paused, top up to resume" });
      continue;
    }
    for (const g of await autonomousGoals(d.db, orgId)) {
      // #149.1 Loop-Guard: before spending another cycle on this goal, fingerprint
      // its current state (open task titles). If it hasn't changed for several
      // cycles, or the cap is hit, the loop is stuck — SUSPEND it (autonomy off,
      // state preserved) for a human instead of burning more compute.
      const open = await d.db.select({ title: tasks.title }).from(tasks)
        .where(and(eq(tasks.orgId, orgId), eq(tasks.goalId, g.id), inArray(tasks.state, ["open", "in_progress", "blocked"])));
      const sig = fingerprint("goal-progress", open.map((t) => t.title).sort());
      const v = loopGuard.check(g.id, sig);
      if (v.trip) {
        await setGoalAutonomy(d.db, orgId, g.id, false); // pause; resume is a human re-enabling autonomy
        loopGuard.reset(g.id);
        goals.push({ goalId: g.id, title: g.title, outcome: { status: "stuck", blocked: open.length }, suspended: v.reason });
        continue;
      }
      // #146: a business goal advances the funnel — execute its open tasks as
      // business actions (draft charges/campaigns → pending human approval) before
      // judging completion.
      if (g.businessId) {
        await runBusinessGoal(d.db, orgId, g.id);
        // #41: a business being grown autonomously also runs the GTM motion — no human
        // gate (operator's choice). Behind ACP_GTM_AUTONOMY so it's opt-in per deploy.
        // Failures here must not stall the goal loop.
        if (process.env.ACP_GTM_AUTONOMY === "1") {
          try { await runGtmMotion(d.db, { orgId, businessId: g.businessId, byId: "scheduler" }); }
          catch (err) { console.warn("[acp] gtm motion failed:", String(err)); }
        }
      }
      const outcome = await progressGoal(d.db, orgId, g.id, { gen: d.gen });
      if (outcome.status === "done") loopGuard.reset(g.id); // completed → clear its trail
      goals.push({ goalId: g.id, title: g.title, outcome });
    }
    const res = await tick(
      { db: d.db, sql: d.sql, temporal: d.temporal, sandboxUrl: d.sandboxUrl, start: d.start },
      { orgId, budgetMax: d.budgetMax, autonomousOnly: true },
    );
    dispatched += res.dispatched.length;
  }
  return { orgs: orgIds.length, goals, dispatched };
}

// Observable scheduler state (#137 "surface the loop state"). Module-level so the
// status route can read the last cycle + when the next one fires.
export interface SchedulerState {
  enabled: boolean;
  intervalMs: number;
  lastTickAt: number | null;
  nextTickAt: number | null;
  lastSummary: CycleResult | null;
  cycles: number;
}
export const schedulerState: SchedulerState = {
  enabled: false, intervalMs: 0, lastTickAt: null, nextTickAt: null, lastSummary: null, cycles: 0,
};

// startScheduler: the in-process clock. Behind ACP_AUTONOMY_INTERVAL_MS (ms; 0 or
// unset disables — so tests and dev never auto-run). Non-overlapping: skips a tick
// while the previous one is still in flight. Returns a stop() to clear the timer.
export function startScheduler(d: SchedulerDeps, now: () => number = () => Date.now()): () => void {
  const intervalMs = Number(process.env.ACP_AUTONOMY_INTERVAL_MS ?? 0);
  if (!intervalMs || intervalMs <= 0) {
    schedulerState.enabled = false;
    return () => {};
  }
  schedulerState.enabled = true;
  schedulerState.intervalMs = intervalMs;
  schedulerState.nextTickAt = now() + intervalMs;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // backpressure: never overlap cycles
    running = true;
    try {
      schedulerState.lastSummary = await runAutonomyCycle(d);
      schedulerState.lastTickAt = now();
      schedulerState.cycles += 1;
    } catch (err) {
      console.warn("[acp] autonomy cycle failed:", String(err));
    } finally {
      schedulerState.nextTickAt = now() + intervalMs;
      running = false;
    }
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive on shutdown
  return () => { clearInterval(timer); schedulerState.enabled = false; };
}
