import { and, eq } from "drizzle-orm";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { notify } from "../db/client.js";
import { runEvents } from "../db/schema.js";
import { createMessage } from "../chat/messages.js";
import { transitionRun } from "../tasks/tasks.js";
import type { FusionEvent } from "@acp/orchestrator/core/run-fusion.js";

export interface SinkCtx { orgId: string; threadId: string; runId: string; agentId: string; }
export const THREAD_CHANNEL = "thread_messages";

function describe(e: FusionEvent): string {
  switch (e.type) {
    case "sandbox_started": return "🧪 sandbox started — cloning repo and running agent…";
    case "branch_pushed": return `📤 pushed branch \`${e.branch}\` (${e.commitSha.slice(0, 7)})`;
    case "pr_opened": return `🔀 opened PR #${e.prNumber}`;
    case "checks": return `⏳ checks: ${e.status}`;
    case "outcome":
      if (e.outcome === "merged") return `✅ merged PR #${e.prNumber}`;
      if (e.outcome === "held_for_human") return `🔶 held for human review — PR #${e.prNumber}`;
      return `⚠️ ${e.outcome}`;
  }
}

// Stable logical identity for a fusion event. Replaying the SAME logical event
// must collapse to one row; distinct events (incl. each checks transition) stay
// distinct. checks carries its status so pending vs success are separate events.
function eventKey(e: FusionEvent): string {
  return e.type === "checks" ? `checks:${e.status}` : e.type;
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
    const msg = await createMessage(db, {
      id: `${ctx.runId}:${mySeq}`,
      orgId: ctx.orgId, threadId: ctx.threadId, authorKind: "agent", authorId: ctx.agentId,
      kind: isOutcome ? "pr_card" : "system",
      body: describe(e),
      metadata: e as any,
    });
    await notify(sql, THREAD_CHANNEL, { threadId: ctx.threadId, message: msg });

    // Move the run into "running" once work begins so the terminal outcome
    // transition (running -> merged/checks_failed/timeout) is legal.
    if (e.type === "sandbox_started") {
      await transitionRun(db, ctx.runId, "running", {});
    }

    if (isOutcome && e.type === "outcome") {
      await transitionRun(db, ctx.runId, e.outcome, {
        prNumber: e.prNumber, prUrl: e.prUrl, commitSha: e.commitSha,
      });
    }
  };
}
