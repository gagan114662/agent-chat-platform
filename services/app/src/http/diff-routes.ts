import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, tasks, threads, repos } from "../db/schema.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { actor } from "./actor.js";

// Builds a GitHub client from a token. Injectable so diff-routes.test.ts can pass a
// fake getChangedFiles() (no network); production uses OctokitGitHubService.
export type MakeGitHub = (token: string) => Pick<GitHubService, "getChangedFiles">;

export interface DiffDeps {
  db: DB;
  makeGitHub?: MakeGitHub;
}

export function registerDiffRoutes(app: FastifyInstance, d: DiffDeps) {
  const makeGitHub: MakeGitHub = d.makeGitHub ?? ((token: string) => new OctokitGitHubService(token));

  app.get("/runs/:id/diff", async (req, reply) => {
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
    if (!token) return reply.code(400).send({ error: "repo token not configured" });

    const gh = makeGitHub(token);
    const files = await gh.getChangedFiles(repo.githubOwner, repo.githubName, run.prNumber);
    return reply.code(200).send(files);
  });
}
