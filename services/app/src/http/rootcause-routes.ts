import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, tasks, threads, repos } from "../db/schema.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { actor } from "./actor.js";
import { rankCulprits } from "../observability/root-cause.js";

// Builds a GitHub client from a token. Injectable so rootcause-routes.test.ts can
// pass fakes (no network); production uses OctokitGitHubService. Needs both the diff
// (getChangedFiles) and the CI failure context (getCheckFailureContext) — #17 + #18.
export type MakeGitHub = (token: string) => Pick<GitHubService, "getChangedFiles" | "getCheckFailureContext">;

export interface RootCauseDeps {
  db: DB;
  makeGitHub?: MakeGitHub;
}

export function registerRootCauseRoutes(app: FastifyInstance, d: RootCauseDeps) {
  const makeGitHub: MakeGitHub = d.makeGitHub ?? ((token: string) => new OctokitGitHubService(token));

  // #94 — correlate the failing CI context for a run with its PR diff to rank the
  // changed files most likely to have caused the failure. Org-scoped: run → task →
  // thread → repo, every hop filtered by org_id (cross-org → 404).
  app.get("/runs/:id/root-cause", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId } = actor(req);

    const [run] = await d.db.select().from(runs)
      .where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
    if (!run) return reply.code(404).send({ error: "run not found" });
    if (run.prNumber == null || run.commitSha == null) {
      return reply.code(404).send({ error: "run has no PR yet" });
    }

    const [task] = await d.db.select().from(tasks).where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
    if (!task) return reply.code(404).send({ error: "task not found" });
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
    if (!thread?.repoId) return reply.code(404).send({ error: "repo not found" });
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
    if (!repo) return reply.code(404).send({ error: "repo not found" });

    const token = process.env[repo.tokenEnvVar];
    if (!token) return reply.code(400).send({ error: "repo token not configured" });

    const gh = makeGitHub(token);
    const [files, failure] = await Promise.all([
      gh.getChangedFiles(repo.githubOwner, repo.githubName, run.prNumber),
      gh.getCheckFailureContext(repo.githubOwner, repo.githubName, run.commitSha),
    ]);

    const suspects = rankCulprits(failure, files);
    return reply.code(200).send({
      summary: `${run.state}: ${failure}`,
      failure,
      suspects,
    });
  });
}
