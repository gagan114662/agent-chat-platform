import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { createMessage, listMessages } from "../chat/messages.js";
import { notify } from "../db/client.js";
import { parseMentions } from "../chat/mentions.js";
import { resolveMention, isPermittedOnRepo } from "../agents/agents.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { startRun } from "../fusion/bridge.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { threads, repos } from "../db/schema.js";
import { actor } from "./actor.js";

export interface Deps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }

export function registerRoutes(app: FastifyInstance, d: Deps) {
  app.get("/threads/:id/messages", async (req, reply) => {
    const { id: threadId } = req.params as { id: string };
    const { orgId } = actor(req);
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    return listMessages(d.db, threadId, orgId);
  });

  app.post("/threads/:id/messages", async (req, reply) => {
    const { id: threadId } = req.params as { id: string };
    const { body } = req.body as { body: string };
    const { orgId, userId } = actor(req);

    // Load the thread org-scoped FIRST so a foreign thread id can't be written to / mined for mentions.
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
    if (!thread) return reply.code(404).send({ error: "thread not found" });

    const msg = await createMessage(d.db, { orgId, threadId, authorKind: "human", authorId: userId, body });
    await notify(d.sql, THREAD_CHANNEL, { threadId, message: msg });

    const started: string[] = [];
    for (const handle of parseMentions(body)) {
      const agent = await resolveMention(d.db, orgId, handle);
      if (!agent || !thread?.repoId) continue;
      if (!(await isPermittedOnRepo(d.db, agent.id, thread.repoId))) continue;
      const [repo] = await d.db.select().from(repos).where(eq(repos.id, thread.repoId));
      if (!repo) continue; // dangling repoId (no FK constraint) — skip rather than 500
      const token = process.env[repo.tokenEnvVar];
      if (!token) continue;

      const { run } = await openTaskForMention(d.db, {
        orgId, threadId, intent: body, agentId: agent.id, createdByKind: "human", createdById: userId,
      });
      await startRun(d.temporal, run.workflowId, {
        owner: repo.githubOwner, repo: repo.githubName,
        repoUrl: `https://x-access-token:${token}@github.com/${repo.githubOwner}/${repo.githubName}.git`,
        baseBranch: repo.defaultBranch, intent: body, branch: `agent/${run.id}`,
        githubToken: token, sandboxUrl: d.sandboxUrl, pollMs: 5000, maxPolls: 24,
        autonomy: (repo.autonomy as "monitor-only" | "resolve-ci" | "autopilot-merge"),
        sink: { orgId, threadId, runId: run.id, agentId: agent.id },
      });
      started.push(run.id);
    }
    return reply.code(201).send({ message: msg, startedRuns: started });
  });
}
