import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import { notify } from "../db/client.js";
import { createMessage } from "../chat/messages.js";
import { selectRun } from "../tasks/tasks.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { tasks } from "../db/schema.js";
import { actor } from "./actor.js";

export interface SelectDeps { db: DB; sql: postgres.Sql; }

export function registerSelectRoutes(app: FastifyInstance, d: SelectDeps) {
  // #64 select-winner: mark a run the exclusive winner among its task's siblings.
  // Org-scoped (#14): a cross-org/unknown run id → 404. The clear-siblings + set are
  // atomic (single tx). Posts a "selected" system message to the task's thread.
  app.post("/runs/:id/select", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId, userId } = actor(req);

    let run;
    try {
      run = await selectRun(d.db, orgId, runId);
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }

    // Resolve the run's task → thread (org-scoped) to post + notify in-thread.
    const [task] = await d.db.select().from(tasks)
      .where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
    if (task) {
      const msg = await createMessage(d.db, {
        orgId, threadId: task.threadId, authorKind: "human", authorId: userId,
        kind: "system", body: `✅ selected this run`,
      });
      await notify(d.sql, THREAD_CHANNEL, { threadId: task.threadId, message: msg });
    }

    return reply.code(200).send({ run });
  });
}
