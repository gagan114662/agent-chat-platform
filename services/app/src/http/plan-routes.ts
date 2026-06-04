import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { notify } from "../db/client.js";
import { createMessage } from "../chat/messages.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { loadPlanRunWithRepo } from "../approvals/approvals.js";
import { startFusionRun } from "../fusion/start.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { actor } from "./actor.js";

export interface PlanDeps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }

// Plan mode (#20): approve/reject the proposed plan of an awaiting_plan_approval run.
// Mirrors the Plan-16 held_for_human approve/decline flow — org-scoped run load,
// resolve run→task→thread→repo, transition + post a message + NOTIFY. Approval starts
// a NEW execute run via startFusionRun (planMode off); rejection declines and, with a
// steering note, opens a fresh plan-mode run with the note appended to the intent.
export function registerPlanRoutes(app: FastifyInstance, d: PlanDeps) {
  app.post("/runs/:id/approve-plan", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId } = actor(req);

    let loaded;
    try {
      loaded = await loadPlanRunWithRepo(d.db, { orgId, runId });
    } catch {
      return reply.code(404).send({ error: "plan run not found" });
    }
    const { run, task, thread, repo } = loaded;

    // Approve → execute now: transition this run to running and start the normal
    // fusion flow with planMode OFF (so it edits + opens a PR).
    await transitionRun(d.db, run.id, "running", {}, orgId);
    if (process.env[repo.tokenEnvVar]) {
      await startFusionRun(d.temporal, {
        run, orgId, threadId: thread.id, repo, agentId: task.assigneeId ?? "agent",
        intent: task.title, sandboxUrl: d.sandboxUrl, planMode: false,
      });
    }

    const msg = await createMessage(d.db, {
      orgId, threadId: thread.id, authorKind: "agent", authorId: task.assigneeId ?? "agent",
      kind: "system", body: "✅ plan approved — executing",
      metadata: { runId: run.id, outcome: "plan_approved" },
    });
    await notify(d.sql, THREAD_CHANNEL, { threadId: thread.id, message: msg });

    return reply.code(200).send({ ok: true });
  });

  app.post("/runs/:id/reject-plan", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { notes } = (req.body ?? {}) as { notes?: string };
    const { orgId } = actor(req);

    let loaded;
    try {
      loaded = await loadPlanRunWithRepo(d.db, { orgId, runId });
    } catch {
      return reply.code(404).send({ error: "plan run not found" });
    }
    const { run, task, thread, repo } = loaded;

    // Reject → decline this run (awaiting_plan_approval → error).
    await transitionRun(d.db, run.id, "error", {}, orgId);
    const reject = await createMessage(d.db, {
      orgId, threadId: thread.id, authorKind: "agent", authorId: task.assigneeId ?? "agent",
      kind: "system", body: "🚫 plan rejected", metadata: { runId: run.id, outcome: "plan_rejected" },
    });
    await notify(d.sql, THREAD_CHANNEL, { threadId: thread.id, message: reject });

    let replanned = false;
    if (notes && notes.trim() !== "") {
      // Steering: open a fresh plan-mode run with the note appended to the intent.
      const intent = `${task.title}\n\nSteering: ${notes}`;
      const steer = await createMessage(d.db, {
        orgId, threadId: thread.id, authorKind: "agent", authorId: task.assigneeId ?? "agent",
        kind: "system", body: `↻ re-planning with steering: ${notes}`,
      });
      await notify(d.sql, THREAD_CHANNEL, { threadId: thread.id, message: steer });

      const { run: newRun } = await openTaskForMention(d.db, {
        orgId, threadId: thread.id, intent, agentId: task.assigneeId ?? "agent",
        createdByKind: "human", createdById: task.createdById,
      });
      if (process.env[repo.tokenEnvVar]) {
        await startFusionRun(d.temporal, {
          run: newRun, orgId, threadId: thread.id, repo, agentId: task.assigneeId ?? "agent",
          intent, sandboxUrl: d.sandboxUrl, planMode: true,
        });
      }
      replanned = true;
    }

    return reply.code(200).send({ ok: true, replanned });
  });
}
