import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { notify } from "../db/client.js";
import { runs, tasks, threads, repos, messages } from "../db/schema.js";
import { createMessage } from "../chat/messages.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { actor } from "./actor.js";

// Builds a GitHub client from a token. Injectable so comment-sync-routes.test.ts can pass a
// fake listReviewComments() (no network); production uses OctokitGitHubService.
export type MakeGitHub = (token: string) => Pick<GitHubService, "listReviewComments">;

export interface CommentSyncDeps {
  db: DB;
  sql: postgres.Sql;
  makeGitHub?: MakeGitHub;
}

export function registerCommentSyncRoutes(app: FastifyInstance, d: CommentSyncDeps) {
  const makeGitHub: MakeGitHub = d.makeGitHub ?? ((token: string) => new OctokitGitHubService(token));

  app.post("/runs/:id/sync-comments", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId } = actor(req);

    // Org-scoped resolution: run → task → thread → repo, every hop filtered by org_id.
    const [run] = await d.db.select().from(runs)
      .where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
    if (!run) return reply.code(404).send({ error: "run not found" });
    if (run.prNumber == null) return reply.code(404).send({ error: "run has no PR yet" });

    const [task] = await d.db.select().from(tasks).where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
    if (!task) return reply.code(404).send({ error: "task not found" });
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
    if (!thread?.repoId) return reply.code(404).send({ error: "repo not found" });
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
    if (!repo) return reply.code(404).send({ error: "repo not found" });

    const token = process.env[repo.tokenEnvVar];
    if (!token) return reply.code(400).send({ error: `GitHub token not found in env var: ${repo.tokenEnvVar}` });

    const gh = makeGitHub(token);
    const comments = await gh.listReviewComments(repo.githubOwner, repo.githubName, run.prNumber);

    // Deterministic message ids make re-sync idempotent. Find which ids already exist so we
    // only post (and notify for) the genuinely new ones — synced = count of new messages.
    const idFor = (commentId: number) => `${run.id}:rc:${commentId}`;
    const allIds = comments.map((c) => idFor(c.id));
    const existing = allIds.length
      ? await d.db.select({ id: messages.id }).from(messages)
          .where(and(eq(messages.orgId, orgId), inArray(messages.id, allIds)))
      : [];
    const existingIds = new Set(existing.map((m) => m.id));

    const authorId = task.assigneeId ?? "github";
    let synced = 0;
    for (const c of comments) {
      const id = idFor(c.id);
      if (existingIds.has(id)) continue;
      const loc = c.path ? ` on ${c.path}${c.line ? `:${c.line}` : ""}` : "";
      const msg = await createMessage(d.db, {
        id,
        orgId,
        threadId: thread.id,
        authorKind: "agent",
        authorId,
        kind: "system",
        body: `💬 ${c.user}${loc}: ${c.body}`,
        metadata: { reviewCommentId: c.id, path: c.path, line: c.line },
      });
      await notify(d.sql, THREAD_CHANNEL, { threadId: thread.id, message: msg });
      synced += 1;
    }

    return reply.code(200).send({ synced });
  });
}
