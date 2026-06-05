import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { goals as goalsTable } from "../db/schema.js";
import { tick, type StartRun } from "./tick.js";
import { autonomousGoals } from "./goals.js";
import { progressGoal, type GoalOutcome, type NextStepGen } from "./progress.js";

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

export interface GoalProgress { goalId: string; title: string; outcome: GoalOutcome }
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
  for (const orgId of orgIds) {
    for (const g of await autonomousGoals(d.db, orgId)) {
      const outcome = await progressGoal(d.db, orgId, g.id, { gen: d.gen });
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
