import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { notify } from "../db/client.js";
import { createMessage } from "../chat/messages.js";
import { fanOutTask } from "../tasks/tasks.js";
import { startFusionRun } from "../fusion/start.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { threads, repos, runs, tasks } from "../db/schema.js";
import { actor } from "./actor.js";

export interface FanoutDeps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }

export function registerFanoutRoutes(app: FastifyInstance, d: FanoutDeps) {
  // #64 fan-out: start N concurrent runs for ONE task (competing approaches across
  // agents). Org-scoped (#14): a cross-org task → 404; unknown/cross-org agents are
  // silently skipped; agentIds are de-duplicated. The workflow start is guarded the
  // same way as reassign — only when the repo + its token are present (so tests with
  // no live GitHub/Temporal still record the runs but skip the start).
  app.post("/tasks/:id/fan-out", async (req, reply) => {
    const { id: taskId } = req.params as { id: string };
    const { agentIds } = req.body as { agentIds: string[] };
    const { orgId } = actor(req);

    // Resolve the task org-scoped first so a cross-org id → 404 before any work.
    const [task] = await d.db.select().from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));
    if (!task) return reply.code(404).send({ error: `task not found: ${taskId}` });

    // Resolve the task's thread → repo, org-scoped. Only start when the repo + its
    // token are present (otherwise runs are recorded but the start is skipped).
    let repo = null as Awaited<ReturnType<typeof loadRepo>> | null;
    async function loadRepo() {
      const [thread] = await d.db.select().from(threads)
        .where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
      if (!thread?.repoId) return null;
      const [r] = await d.db.select().from(repos)
        .where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
      return r ?? null;
    }
    repo = await loadRepo();
    const canStart = !!(repo && process.env[repo.tokenEnvVar]);

    const { runIds } = await fanOutTask(d.db, {
      orgId, taskId, agentIds: agentIds ?? [], threadId: task.threadId,
      repo: canStart ? repo : null, sandboxUrl: d.sandboxUrl,
      start: canStart
        ? async (input) => { await startFusionRun(d.temporal, input); }
        : null,
    });

    // Post a "fanned out" system message reflecting how many runs were started.
    const msg = await createMessage(d.db, {
      orgId, threadId: task.threadId, authorKind: "human", authorId: actor(req).userId,
      kind: "system", body: `🌿 fanned out to ${runIds.length} agents`,
    });
    await notify(d.sql, THREAD_CHANNEL, { threadId: task.threadId, message: msg });

    return reply.code(201).send({ runs: runIds });
  });

  // #64 sibling list: the runs competing on one task (org-scoped). Returns the
  // fields the web compare/select surface needs.
  app.get("/tasks/:id/runs", async (req, reply) => {
    const { id: taskId } = req.params as { id: string };
    const { orgId } = actor(req);
    const rows = await d.db.select({
      id: runs.id, state: runs.state, prNumber: runs.prNumber,
      prUrl: runs.prUrl, selected: runs.selected,
    }).from(runs).where(and(eq(runs.taskId, taskId), eq(runs.orgId, orgId)));
    return reply.code(200).send({ runs: rows });
  });
}
