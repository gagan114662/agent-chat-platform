import { and, eq } from "drizzle-orm";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { notify } from "../db/client.js";
import { runEvents, runs } from "../db/schema.js";
import { createMessage } from "../chat/messages.js";
import { transitionRun } from "../tasks/tasks.js";
import { recordCheckpoint } from "./checkpoints.js";
import type { FusionEvent } from "@acp/orchestrator/core/run-fusion.js";

export interface SinkCtx { orgId: string; threadId: string; runId: string; agentId: string; mentionDepth?: number; parentRunId?: string; }
export const THREAD_CHANNEL = "thread_messages";

function describe(e: FusionEvent): string {
  switch (e.type) {
    case "sandbox_started": return "🧪 sandbox started — cloning repo and running agent…";
    case "plan_proposed": return e.plan;
    case "branch_pushed": return `📤 pushed branch \`${e.branch}\` (${e.commitSha.slice(0, 7)})`;
    case "pr_opened": return `🔀 opened PR #${e.prNumber}`;
    case "checks": return `⏳ checks: ${e.status}`;
    case "ci_fix_attempt": return `🔧 CI fix attempt ${e.attempt}: ${e.failure}`;
    case "outcome":
      if (e.outcome === "merged") return `✅ merged PR #${e.prNumber}`;
      if (e.outcome === "held_for_human") return `🔶 held for human review — PR #${e.prNumber}`;
      if (e.outcome === "awaiting_plan") return "📝 plan proposed — awaiting approval";
      return `⚠️ ${e.outcome}`;
  }
}

// Stable logical identity for a fusion event. Replaying the SAME logical event
// must collapse to one row; distinct events (incl. each checks transition) stay
// distinct. checks carries its status so pending vs success are separate events.
function eventKey(e: FusionEvent): string {
  if (e.type === "checks") return `checks:${e.status}`;
  // Each fix attempt is a distinct logical event so they don't collapse on replay.
  if (e.type === "ci_fix_attempt") return `ci_fix_attempt:${e.attempt}`;
  return e.type;
}

export function makeFusionSink(db: DB, sql: postgres.Sql, ctx: SinkCtx) {
  return async (e: FusionEvent) => {
    const key = eventKey(e);

    // Idempotency: if this logical event was already persisted for the run, skip.
    // The runEvents.id encodes (runId, key) so replays resolve to the same row.
    const eventId = `${ctx.runId}:${key}`;
    const existing = await db
      .select({ id: runEvents.id })
      .from(runEvents)
      .where(and(eq(runEvents.runId, ctx.runId), eq(runEvents.id, eventId)));
    if (existing.length > 0) return;

    // seq is the count of events already persisted for this run -> stable 0..N
    // ordering, matching the order events are emitted by the fusion loop.
    const persisted = await db
      .select({ id: runEvents.id })
      .from(runEvents)
      .where(eq(runEvents.runId, ctx.runId));
    const mySeq = persisted.length;

    const [appended] = await db.insert(runEvents).values({
      id: eventId, orgId: ctx.orgId, runId: ctx.runId, seq: mySeq, type: e.type, payload: e as any,
    }).onConflictDoNothing().returning();
    if (!appended) return;

    const isOutcome = e.type === "outcome";
    const isPlan = e.type === "plan_proposed";
    // The FusionEvent outcome carries prNumber/prUrl/commitSha but NOT runId. The UI
    // needs runId on the pr_card to call approve/decline on a held_for_human run, so
    // attach ctx.runId to the outcome message metadata. The plan_card likewise needs
    // runId (+ kind) so the UI can approve/reject the plan.
    let kind: "system" | "pr_card" | "plan_card" = "system";
    if (isOutcome) kind = "pr_card";
    if (isPlan) kind = "plan_card";
    let metadata: Record<string, unknown> = e as any;
    // #53 stacked PRs: attach parentRunId to the outcome (pr_card) metadata so the
    // web PR card can render a "⬑ stacked on <parent>" badge. Absent → flat (no badge).
    if (isOutcome) metadata = { ...(e as any), runId: ctx.runId, ...(ctx.parentRunId ? { parentRunId: ctx.parentRunId } : {}) };
    if (isPlan) metadata = { runId: ctx.runId, kind: "plan" };
    const msg = await createMessage(db, {
      id: `${ctx.runId}:${mySeq}`,
      orgId: ctx.orgId, threadId: ctx.threadId, authorKind: "agent", authorId: ctx.agentId,
      kind,
      body: describe(e),
      metadata,
    });
    await notify(sql, THREAD_CHANNEL, { threadId: ctx.threadId, message: msg });

    // #62 checkpoints: when an event carries a commitSha, record a {branch, commit}
    // snapshot for the run. branch_pushed carries its own branch; outcome carries
    // only a commitSha so fall back to the run's branch (deterministic agent/<runId>).
    // The checkpoint id is deterministic so replays of the same commit collapse.
    if (e.type === "branch_pushed") {
      await recordCheckpoint(db, {
        orgId: ctx.orgId, runId: ctx.runId, label: "agent push",
        branch: e.branch, commitSha: e.commitSha,
      });
    } else if (e.type === "outcome" && e.commitSha) {
      const [r] = await db.select({ branch: runs.branch }).from(runs).where(eq(runs.id, ctx.runId));
      await recordCheckpoint(db, {
        orgId: ctx.orgId, runId: ctx.runId, label: `outcome:${e.outcome}`,
        branch: r?.branch ?? `agent/${ctx.runId}`, commitSha: e.commitSha,
      });
    }

    // Move the run into "running" once work begins so the terminal outcome
    // transition (running -> merged/checks_failed/timeout) is legal.
    if (e.type === "sandbox_started") {
      await transitionRun(db, ctx.runId, "running", {}, ctx.orgId);
    }

    if (isOutcome && e.type === "outcome") {
      // Plan-mode park: outcome "awaiting_plan" maps to the awaiting_plan_approval
      // run state (pending → awaiting_plan_approval, a legal transition).
      if (e.outcome === "awaiting_plan") {
        await transitionRun(db, ctx.runId, "awaiting_plan_approval", {}, ctx.orgId);
      } else {
        await transitionRun(db, ctx.runId, e.outcome, {
          prNumber: e.prNumber, prUrl: e.prUrl, commitSha: e.commitSha,
        }, ctx.orgId);
      }
    }
  };
}
