import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { repos, tasks } from "../db/schema.js";
import { SandboxRunnerClient } from "@acp/orchestrator/sandbox/sandbox-runner-client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import { deployRepo, type Exec } from "../deploy/deploy.js";
import { createMessage } from "../chat/messages.js";

export interface DeployDeps {
  db: DB;
  sandboxUrl?: string;
  makeExec?: (repo: { tokenEnvVar: string; githubOwner: string; githubName: string; defaultBranch: string }) => Exec;
}

// #140 deploy step. Admin-gated (team:manage — runs an arbitrary deploy command in
// the sandbox, and a production deploy is high-stakes, so the human triggering it
// IS the gate, #125). Ships the repo, captures the public URL, records it on the
// repo (+ goal), and posts it back to the goal's thread.
export function registerDeployRoutes(app: FastifyInstance, d: DeployDeps) {
  const sandboxUrl = d.sandboxUrl ?? process.env.SANDBOX_URL ?? "http://localhost:8090";
  const makeExec = d.makeExec ?? ((repo) => {
    const token = process.env[repo.tokenEnvVar];
    const repoUrl = `https://x-access-token:${token}@github.com/${repo.githubOwner}/${repo.githubName}.git`;
    const sandbox = new SandboxRunnerClient(sandboxUrl);
    return async (command: string) => {
      const r = await sandbox.exec({ repoUrl, baseBranch: repo.defaultBranch, command });
      return { stdout: r.output, exitCode: r.exitCode };
    };
  });

  app.post("/repos/:id/deploy", async (req, reply) => {
    const { id: repoId } = req.params as { id: string };
    const { goalId } = (req.body ?? {}) as { goalId?: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, repoId), eq(repos.orgId, orgId)));
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    if (!repo.deployCommand?.trim()) return reply.code(400).send({ error: "no deployCommand configured for this repo" });
    if (!process.env[repo.tokenEnvVar]) return reply.code(400).send({ error: "repo token not configured" });

    let result;
    try {
      result = await deployRepo(d.db, { orgId, repoId, goalId, exec: makeExec(repo) });
    } catch (e) {
      result = { ok: false as const, reason: `deploy error: ${(e as Error).message}` };
    }

    // Post the outcome back to the goal's thread (if a goal was given).
    if (goalId) {
      const [t] = await d.db.select({ threadId: tasks.threadId }).from(tasks)
        .where(and(eq(tasks.orgId, orgId), eq(tasks.goalId, goalId)));
      if (t?.threadId) {
        await createMessage(d.db, {
          orgId, threadId: t.threadId, authorKind: "agent", authorId: "deploy",
          body: result.ok ? `🚀 Deployed — live at ${result.url}` : `Deploy failed: ${result.reason}`,
        });
      }
    }
    return reply.code(result.ok ? 200 : 422).send(result);
  });

  // Configure a repo's deploy command (admin). The command must print ACP_DEPLOY_URL=<url>.
  app.patch("/repos/:id/deploy-command", async (req, reply) => {
    const { id: repoId } = req.params as { id: string };
    const { deployCommand } = (req.body ?? {}) as { deployCommand?: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const [row] = await d.db.update(repos).set({ deployCommand: deployCommand ?? null })
      .where(and(eq(repos.id, repoId), eq(repos.orgId, orgId))).returning();
    if (!row) return reply.code(404).send({ error: "repo not found" });
    return reply.code(200).send({ id: row.id, deployCommand: row.deployCommand });
  });
}
