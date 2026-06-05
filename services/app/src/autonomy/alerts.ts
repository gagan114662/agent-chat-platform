// #93 autonomous alerts — "monitoring is dead": proactive, contextual alerts
// with no manual thresholds. detectAlerts scans an org's run/CI state and emits
// Alerts; recordAlerts persists them as idempotent `incidents` (source "alert",
// reusing the #55 table — deterministic id `${orgId}:${key}` + onConflictDoNothing)
// and, when a thread is configured, posts a system message + notifies.
//
// Each alert that references a failing run carries its runId so the existing
// fix/approve paths can act on it ("dispatch a fix").
import { and, eq, inArray, max, sql as dsql } from "drizzle-orm";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { runs, runEvents, incidents } from "../db/schema.js";
import { createMessage } from "../chat/messages.js";
import { notify } from "../db/client.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { makeSlackClient, type MakeSlack } from "../integrations/slack.js";

// A detected alert, pre-persistence. `key` is the deterministic dedup key:
// combined with the orgId it forms the incident id (`${orgId}:${key}`) so a
// second scan over the same state collapses (idempotent).
export interface Alert {
  key: string;
  severity: "low" | "medium" | "high";
  title: string;
  body: string;
  runId?: string;
}

// Run states that count as a failure → one high alert each.
const FAILED_STATES = ["checks_failed", "error", "timeout"] as const;

function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Tunable thresholds (env with sane defaults).
function ciFixThreshold(): number {
  return num(process.env.ALERT_CI_FIX_THRESHOLD, 3);
}
function heldAgingMinutes(): number {
  return num(process.env.ALERT_HELD_AGING_MINUTES, 120);
}

// detectAlerts scans the org's run/CI state and returns the alerts that hold
// right now. Pure read (no writes) and org-scoped throughout.
export async function detectAlerts(db: DB, orgId: string): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // 1) Failed runs — one HIGH alert each. The run links the existing fix/review path.
  const failed = await db.select().from(runs)
    .where(and(eq(runs.orgId, orgId), inArray(runs.state, FAILED_STATES as unknown as string[])));
  for (const r of failed) {
    const pr = r.prNumber ? ` (PR #${r.prNumber})` : "";
    alerts.push({
      key: `run-failed:${r.id}`,
      severity: "high",
      title: `Run ${r.id} ${r.state}`,
      body: `Run ${r.id}${pr} ended ${r.state}. Recommended: dispatch a fix / review.`,
      runId: r.id,
    });
  }

  // 2) Repeated CI failures — a run with >= threshold ci_fix_attempt events is
  //    stuck and needs a human. Count distinct fix-attempt events per run, org-scoped.
  const ciThreshold = ciFixThreshold();
  const ciCounts = await db
    .select({ runId: runEvents.runId, n: dsql<number>`count(*)::int` })
    .from(runEvents)
    .where(and(eq(runEvents.orgId, orgId), eq(runEvents.type, "ci_fix_attempt")))
    .groupBy(runEvents.runId);
  for (const c of ciCounts) {
    if (Number(c.n) < ciThreshold) continue;
    alerts.push({
      key: `ci-stuck:${c.runId}`,
      severity: "high",
      title: `Run ${c.runId} CI stuck`,
      body: `CI failing after ${c.n} fix attempts — needs human.`,
      runId: c.runId,
    });
  }

  // 3) Aging held runs — held_for_human older than the threshold. `runs` has no
  //    timestamp, so use the run's last run_event time as the activity proxy
  //    (the held run's last event is its `outcome`). org-scoped via the join.
  const heldCutoff = new Date(Date.now() - heldAgingMinutes() * 60 * 1000);
  const held = await db.select().from(runs)
    .where(and(eq(runs.orgId, orgId), eq(runs.state, "held_for_human")));
  for (const r of held) {
    const [{ last } = { last: null }] = await db
      .select({ last: max(runEvents.createdAt) })
      .from(runEvents)
      .where(and(eq(runEvents.orgId, orgId), eq(runEvents.runId, r.id)));
    // No events yet → no age signal → skip (can't tell if it's aging).
    if (!last) continue;
    if (new Date(last as unknown as string) > heldCutoff) continue;
    const pr = r.prNumber ? ` (PR #${r.prNumber})` : "";
    alerts.push({
      key: `held-aging:${r.id}`,
      severity: "medium",
      title: `Run ${r.id} held for review`,
      body: `Run ${r.id}${pr} held for review, awaiting approval. Recommended: review / approve.`,
      runId: r.id,
    });
  }

  return alerts;
}

export interface RecordAlertsCtx {
  orgId: string;
  // When set (arg or env ALERT_THREAD_ID), each NEW alert is posted as a system
  // message into the thread + a realtime notify fires.
  threadId?: string;
  // #100 optional Slack routing. When a Slack channel is configured (arg or env
  // SLACK_ALERT_CHANNEL) and Slack is available, each NEW alert is ALSO posted to
  // Slack (best-effort/guarded — a failing or unconfigured post never breaks
  // recording). `makeSlack` is injectable so tests pass a fake (no live Slack).
  slackChannel?: string;
  makeSlack?: MakeSlack;
}

// recordAlerts persists the alerts as idempotent `incidents` (source "alert") and
// posts each NEW one to the configured thread. Returns the count of NEW alerts
// (a second scan over the same state → 0).
export async function recordAlerts(
  db: DB,
  sql: postgres.Sql,
  ctx: RecordAlertsCtx,
  alerts: Alert[],
): Promise<number> {
  const threadId = ctx.threadId ?? process.env.ALERT_THREAD_ID;
  const slackChannel = ctx.slackChannel ?? process.env.SLACK_ALERT_CHANNEL;
  let created = 0;
  for (const a of alerts) {
    const [row] = await db.insert(incidents).values({
      id: `${ctx.orgId}:${a.key}`,
      orgId: ctx.orgId,
      source: "alert",
      severity: a.severity,
      title: a.title,
      body: a.body,
      raw: { key: a.key, ...(a.runId ? { runId: a.runId } : {}) },
    }).onConflictDoNothing().returning();
    if (!row) continue; // already recorded — idempotent
    created++;
    if (threadId) {
      const msg = await createMessage(db, {
        orgId: ctx.orgId,
        threadId,
        authorKind: "agent",
        authorId: "alerts",
        kind: "system",
        body: `[${a.severity.toUpperCase()}] ${a.title}\n\n${a.body}`,
      });
      await notify(sql, THREAD_CHANNEL, { threadId, message: msg });
    }
    // Optional Slack route — best-effort/guarded. An unconfigured Slack
    // (makeSlackClient throws "slack not configured") or a failing post is
    // swallowed so it never breaks alert recording. Keeps the in-thread post above.
    if (slackChannel) {
      try {
        const slack = (ctx.makeSlack ?? makeSlackClient)();
        await slack.postMessage(slackChannel, `[${a.severity.toUpperCase()}] ${a.title}\n\n${a.body}`);
      } catch {
        // unconfigured or failed Slack post — ignore (best-effort)
      }
    }
  }
  return created;
}
