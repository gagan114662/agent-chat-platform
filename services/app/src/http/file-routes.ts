import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, tasks, threads, repos } from "../db/schema.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { actor } from "./actor.js";

// Builds a GitHub client from a token. Injectable so file-routes.test.ts can pass a
// fake getFileContent() (no network); production uses OctokitGitHubService.
export type MakeGitHub = (token: string) => Pick<GitHubService, "getFileContent">;

export interface FileDeps {
  db: DB;
  makeGitHub?: MakeGitHub;
}

// Rejects path traversal / absolute paths. The GitHub contents API is repo-scoped
// anyway, but we never forward attacker-controlled traversal sequences.
function isUnsafePath(path: string): boolean {
  return path.startsWith("/") || path.split("/").includes("..");
}

export function registerFileRoutes(app: FastifyInstance, d: FileDeps) {
  const makeGitHub: MakeGitHub = d.makeGitHub ?? ((token: string) => new OctokitGitHubService(token));

  app.get("/runs/:id/file", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { path } = req.query as { path?: string };
    const { orgId } = actor(req);

    if (!path) return reply.code(400).send({ error: "path is required" });
    if (isUnsafePath(path)) return reply.code(400).send({ error: "invalid path" });

    // Org-scoped resolution: run → task → thread → repo, every hop filtered by org_id.
    const [run] = await d.db.select().from(runs)
      .where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
    if (!run) return reply.code(404).send({ error: "run not found" });
    if (!run.commitSha) return reply.code(404).send({ error: "run has no commit yet" });

    const [task] = await d.db.select().from(tasks).where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
    if (!task) return reply.code(404).send({ error: "task not found" });
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
    if (!thread?.repoId) return reply.code(404).send({ error: "repo not found" });
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
    if (!repo) return reply.code(404).send({ error: "repo not found" });

    const token = process.env[repo.tokenEnvVar];
    if (!token) return reply.code(400).send({ error: "repo token not configured" });

    const gh = makeGitHub(token);
    try {
      const file = await gh.getFileContent(repo.githubOwner, repo.githubName, run.commitSha, path);
      return reply.code(200).send(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed to read file";
      // Size cap / not-a-file errors surface as a 400 (bad request for this path).
      return reply.code(400).send({ error: msg });
    }
  });
}
