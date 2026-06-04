import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { notify } from "../db/client.js";
import { createMessage } from "../chat/messages.js";
import { listCheckpoints } from "../fusion/checkpoints.js";
import { startFusionRun } from "../fusion/start.js";
import { agentModelConfig } from "../agents/agents.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { runCheckpoints, runs, tasks, threads, repos, agents } from "../db/schema.js";
import { actor } from "./actor.js";

export interface CheckpointDeps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }

export function registerCheckpointRoutes(app: FastifyInstance, d: CheckpointDeps) {
  // List a run's checkpoints. Org-scoped (#14): the run must be in the caller's org
  // (cross-org / missing run → 404, no leakage).
  app.get("/runs/:id/checkpoints", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId } = actor(req);
    const [run] = await d.db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
    if (!run) return reply.code(404).send({ error: "run not found" });
    const checkpoints = await listCheckpoints(d.db, orgId, runId);
    return reply.code(200).send({ checkpoints });
  });

  // Restore (rewind): open a NEW pending run for the same task based on the
  // checkpoint's commit — reusing the #53 baseBranchOverride so the fresh fusion
  // PR bases on the checkpoint branch. Org-scoped: the run AND the checkpoint must
  // be in the caller's org (cross-org → 404). If no repo/token, still record the
  // new run + message and guard the workflow start (mirrors the reassign route).
  app.post("/runs/:id/checkpoints/:cpId/restore", async (req, reply) => {
    const { id: runId, cpId } = req.params as { id: string; cpId: string };
    const { orgId } = actor(req);

    const [run] = await d.db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
    if (!run) return reply.code(404).send({ error: "run not found" });

    const [checkpoint] = await d.db.select().from(runCheckpoints)
      .where(and(eq(runCheckpoints.id, cpId), eq(runCheckpoints.runId, runId), eq(runCheckpoints.orgId, orgId)));
    if (!checkpoint) return reply.code(404).send({ error: "checkpoint not found" });

    const [task] = await d.db.select().from(tasks).where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
    if (!task) return reply.code(404).send({ error: "task not found" });

    // Open the new pending run for the same task (the restored run).
    const newRunId = randomUUID();
    const [newRun] = await d.db.insert(runs).values({
      id: newRunId, orgId, taskId: task.id, state: "pending", workflowId: `run-${newRunId}`,
    }).returning();

    // The run is driven by the task's current assignee agent (if any).
    const agentId = task.assigneeId ?? run.id;
    const intent = `${task.title} (restored from ${checkpoint.label})`;

    // Resolve thread → repo, org-scoped, and only start the workflow when the repo
    // + its token are present. Without them (e.g. tests with no live GitHub/Temporal)
    // we still record the run + message; the workflow start is simply skipped.
    const [thread] = await d.db.select().from(threads)
      .where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
    if (thread?.repoId) {
      const [repo] = await d.db.select().from(repos)
        .where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
      if (repo && process.env[repo.tokenEnvVar]) {
        const [agent] = task.assigneeKind === "agent" && task.assigneeId
          ? await d.db.select().from(agents).where(and(eq(agents.id, task.assigneeId), eq(agents.orgId, orgId)))
          : [undefined];
        await startFusionRun(d.temporal, {
          run: newRun, orgId, threadId: task.threadId, repo, agentId,
          intent, sandboxUrl: d.sandboxUrl,
          // rewind: base the fresh fusion run on the checkpoint's branch (#53 override).
          baseBranchOverride: checkpoint.branch,
          ...agentModelConfig(agent),
        });
      }
    }

    const body = `↩️ restored from checkpoint ${checkpoint.label} (${checkpoint.commitSha.slice(0, 7)})`;
    const msg = await createMessage(d.db, {
      orgId, threadId: task.threadId, authorKind: "agent", authorId: agentId,
      kind: "system", body,
    });
    await notify(d.sql, THREAD_CHANNEL, { threadId: task.threadId, message: msg });

    return reply.code(201).send({ run: newRun });
  });
}
