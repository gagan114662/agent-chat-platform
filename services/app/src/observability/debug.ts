import { and, asc, desc, eq, inArray, sql as dsql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, runEvents, incidents } from "../db/schema.js";
import { TERMINAL_RUN_STATES } from "../tasks/runs.js";

export interface DebugAnswer {
  answer: string;
  kind: string;
  data: unknown;
}

const FAILURE_STATES = ["checks_failed", "error", "timeout"] as const;
const HELP =
  "I can answer: a run's status, recent failures, run counts by state, or incidents.";

// answerDebug — #92. A deterministic, rule-based router over the org's telemetry
// (runs / run_events / incidents). NO LLM: it pattern-matches the question and runs
// org-scoped queries. An LLM-backed answerer is a documented follow-up. Every query
// is filtered by orgId so one org can never read another's telemetry.
export async function answerDebug(db: DB, orgId: string, question: string): Promise<DebugAnswer> {
  const raw = (question ?? "").trim();
  const q = raw.toLowerCase();

  // 1) A specific run: "run <id>" or "why did run <id> ...". Match against the
  // original (case-preserving) text so run ids keep their case.
  const runMatch = raw.match(/run\s+([A-Za-z0-9][A-Za-z0-9_-]*)/);
  if (runMatch) {
    const runId = runMatch[1];
    const [run] = await db.select().from(runs)
      .where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
    if (!run) {
      return { kind: "run-status", answer: `No run ${runId} in this org.`, data: null };
    }
    const events = await db.select().from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.orgId, orgId)))
      .orderBy(asc(runEvents.seq));
    const recent = events.slice(-5);
    const eventTypes = recent.map((e) => e.type);
    const answer =
      `Run ${runId} is in state "${run.state}"` +
      (run.prNumber != null ? ` (PR #${run.prNumber})` : "") +
      `. Last events: ${eventTypes.length ? eventTypes.join(", ") : "none"}.`;
    return { kind: "run-status", answer, data: { run, events: recent } };
  }

  // 2) Recent failures: "recent failures" / "what's failing" / "what is failing".
  if (/(recent failures|what'?s failing|what is failing|failing runs|failures)/.test(q)) {
    const rows = await db.select().from(runs)
      .where(and(eq(runs.orgId, orgId), inArray(runs.state, [...FAILURE_STATES])))
      .orderBy(desc(runs.id))
      .limit(20);
    const answer = rows.length
      ? `${rows.length} recent failing run(s): ${rows.map((r) => `${r.id} (${r.state})`).join(", ")}.`
      : "No failing runs in this org.";
    return { kind: "recent-failures", answer, data: rows };
  }

  // 3) Counts by state: "error rate" / "how many ... merged|failed" / "run counts".
  if (/(error rate|how many|run counts?|counts? by state|breakdown)/.test(q)) {
    const rows = await db.select({ state: runs.state, n: dsql<number>`count(*)::int` })
      .from(runs)
      .where(eq(runs.orgId, orgId))
      .groupBy(runs.state);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.state] = r.n;
    const total = rows.reduce((s, r) => s + r.n, 0);
    const failed = [...FAILURE_STATES].reduce((s, st) => s + (counts[st] ?? 0), 0);
    const answer =
      `Run counts by state: ${
        Object.entries(counts).map(([s, n]) => `${s}=${n}`).join(", ") || "none"
      } (total ${total}, failed ${failed}).`;
    return { kind: "counts", answer, data: { counts, total, failed } };
  }

  // 4) Incidents / alerts.
  if (/(incidents?|alerts?)/.test(q)) {
    const rows = await db.select().from(incidents)
      .where(eq(incidents.orgId, orgId))
      .orderBy(desc(incidents.createdAt))
      .limit(20);
    const answer = rows.length
      ? `${rows.length} recent incident(s): ${rows.map((i) => `${i.title} (${i.severity})`).join(", ")}.`
      : "No incidents in this org.";
    return { kind: "incidents", answer, data: rows };
  }

  // 5) Fallback — honest help text (no fabricated answer).
  return { kind: "unknown", answer: HELP, data: null };
}

// Re-exported for callers/tests that want to assert terminal/failure classification.
export { FAILURE_STATES, TERMINAL_RUN_STATES };
