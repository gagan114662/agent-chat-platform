import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { notify } from "../db/client.js";
import { createMessage } from "../chat/messages.js";
import { reassignTask } from "../tasks/tasks.js";
import { startFusionRun } from "../fusion/start.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { threads, repos, runs } from "../db/schema.js";
import { actor } from "./actor.js";

export interface TaskDeps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }

export function registerTaskRoutes(app: FastifyInstance, d: TaskDeps) {
  // Hand a task to another in-org agent: reassign + new run + start fusion + post a
  // "handed off" message. Org-scoped (#14): a cross-org task or agent → 404.
  app.post("/tasks/:id/reassign", async (req, reply) => {
    const { id: taskId } = req.params as { id: string };
    const { agentId, stackOnRunId } = req.body as { agentId: string; stackOnRunId?: string };
    const { orgId, userId } = actor(req);

    // #53 stacked PRs: if the caller asks to stack on a parent run, only honor it when
    // that run is in THIS org (cross-org parent → ignored → flat). Resolving here keeps
    // the parentRunId persisted on the new run and the PR base in lockstep.
    let parentRunId: string | undefined;
    if (stackOnRunId) {
      const [parent] = await d.db.select().from(runs)
        .where(and(eq(runs.id, stackOnRunId), eq(runs.orgId, orgId)));
      if (parent) parentRunId = parent.id;
    }

    let task, run, agent;
    try {
      ({ task, run, agent } = await reassignTask(d.db, {
        orgId, taskId, agentId, byKind: "human", byId: userId, parentRunId,
      }));
    } catch (e) {
      // task/agent not in this org (or absent) → 404, no leakage.
      return reply.code(404).send({ error: (e as Error).message });
    }

    // Resolve the task's thread → repo, org-scoped.
    const [thread] = await d.db.select().from(threads)
      .where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
    if (thread?.repoId) {
      const [repo] = await d.db.select().from(repos)
        .where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
      // Only start the workflow when the repo + its token are actually present.
      // Without a token (e.g. tests with no live GitHub/Temporal) we still record the
      // hand-off + run + message; the workflow start is simply skipped.
      if (repo && process.env[repo.tokenEnvVar]) {
        await startFusionRun(d.temporal, {
          run, orgId, threadId: task.threadId, repo, agentId,
          intent: task.title, sandboxUrl: d.sandboxUrl,
          // stacked: base the child PR on the parent's branch + carry the parent id
          // into the outcome metadata so the web PR card shows a stacked badge.
          baseBranchOverride: parentRunId ? `agent/${parentRunId}` : undefined,
          parentRunId,
        });
      }
    }

    const handoffBody = parentRunId
      ? `🔁 handed off to ${agent.displayName} — ⬑ stacked on agent/${parentRunId}`
      : `🔁 handed off to ${agent.displayName}`;
    const msg = await createMessage(d.db, {
      orgId, threadId: task.threadId, authorKind: "agent", authorId: agentId,
      kind: "system", body: handoffBody,
    });
    await notify(d.sql, THREAD_CHANNEL, { threadId: task.threadId, message: msg });

    return reply.code(201).send({ task, run });
  });
}
