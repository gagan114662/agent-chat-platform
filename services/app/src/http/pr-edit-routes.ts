import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, tasks, threads, repos } from "../db/schema.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { actor } from "./actor.js";

// Builds a GitHub client from a token. Injectable so pr-edit-routes.test.ts can pass a
// fake updatePr() (no network); production uses OctokitGitHubService.
export type MakeGitHub = (token: string) => Pick<GitHubService, "updatePr">;

export interface PrEditDeps {
  db: DB;
  makeGitHub?: MakeGitHub;
}

export function registerPrEditRoutes(app: FastifyInstance, d: PrEditDeps) {
  const makeGitHub: MakeGitHub = d.makeGitHub ?? ((token: string) => new OctokitGitHubService(token));

  app.post("/runs/:id/update-pr", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId } = actor(req);
    const { title, body, base } = (req.body ?? {}) as { title?: string; body?: string; base?: string };

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

    // Only forward fields the caller actually provided — never send undefined title/body/base.
    const patch: { title?: string; body?: string; base?: string } = {};
    if (title !== undefined) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (base !== undefined) patch.base = base;

    const gh = makeGitHub(token);
    await gh.updatePr(repo.githubOwner, repo.githubName, run.prNumber, patch);

    return reply.code(200).send({ ok: true });
  });
}
