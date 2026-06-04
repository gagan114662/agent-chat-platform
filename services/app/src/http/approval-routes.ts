import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, tasks, threads, repos } from "../db/schema.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { approveRun, declineRun } from "../approvals/approvals.js";
import { actor } from "./actor.js";

// Builds a GitHub client from a token. Injectable so approval-routes.test.ts can pass a
// fake merge() (no network); production uses OctokitGitHubService.
export type MakeGitHub = (token: string) => Pick<GitHubService, "merge">;

export interface ApprovalDeps {
  db: DB;
  makeGitHub?: MakeGitHub;
}

// Resolves the repo (owner/repo + token env var) for a held run in the actor's org,
// so the route can build the GitHub client. Returns null if no such held run exists.
async function resolveRepoForHeldRun(db: DB, orgId: string, runId: string) {
  const [run] = await db.select().from(runs)
    .where(and(eq(runs.id, runId), eq(runs.orgId, orgId), eq(runs.state, "held_for_human")));
  if (!run) return null;
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
  if (!task) return null;
  const [thread] = await db.select().from(threads).where(and(eq(threads.id, task.threadId), eq(threads.orgId, orgId)));
  if (!thread?.repoId) return null;
  const [repo] = await db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
  if (!repo) return null;
  return repo;
}

export function registerApprovalRoutes(app: FastifyInstance, d: ApprovalDeps) {
  const makeGitHub: MakeGitHub = d.makeGitHub ?? ((token: string) => new OctokitGitHubService(token));

  app.post("/runs/:id/approve", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId } = actor(req);

    const repo = await resolveRepoForHeldRun(d.db, orgId, runId);
    if (!repo) return reply.code(404).send({ error: "held run not found" });

    const token = process.env[repo.tokenEnvVar];
    if (!token) return reply.code(400).send({ error: "repo token not configured" });

    try {
      const github = makeGitHub(token);
      const run = await approveRun(d.db, github, { orgId, runId });
      return reply.code(200).send(run);
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.post("/runs/:id/decline", async (req, reply) => {
    const { id: runId } = req.params as { id: string };
    const { orgId } = actor(req);
    try {
      await declineRun(d.db, { orgId, runId });
      return reply.code(200).send({ ok: true });
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });
}
