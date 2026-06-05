import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { threads, repos } from "../db/schema.js";
import { SandboxRunnerClient } from "@acp/orchestrator/sandbox/sandbox-runner-client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";

// The request/result shapes for the sandbox /exec call. Mirror the orchestrator's
// SandboxExecRequest/ExecResult (the orchestrator package only exports a curated
// set of modules, so the shapes are declared locally rather than imported).
export interface SandboxExecRequest {
  repoUrl: string;
  baseBranch: string;
  command: string;
}
export interface ExecResult {
  output: string;
  exitCode: number;
}

// The slice of the sandbox client this route needs. Injectable so exec-routes.test.ts
// can pass a fake exec() (no live sandbox); production builds a real SandboxRunnerClient.
export type SandboxExec = { exec: (req: SandboxExecRequest) => Promise<ExecResult> };
export type MakeSandbox = (baseUrl: string) => SandboxExec;

export interface ExecDeps {
  db: DB;
  sandboxUrl?: string;
  makeSandbox?: MakeSandbox;
}

// #72 admin exec route → sandbox /exec. Runs an arbitrary command in a fresh
// clone of the thread's repo and returns combined output + exit code. Arbitrary
// code execution, so it is admin-gated (`team:manage` → 403) and org-scoped
// (cross-org thread → 404). The sandbox itself default-denies /exec unless
// ACP_ALLOW_EXEC=1 (defense in depth). The credential is constructed like the
// fusion activity and never returned in the response.
export function registerExecRoutes(app: FastifyInstance, d: ExecDeps) {
  const sandboxUrl = d.sandboxUrl ?? process.env.SANDBOX_URL ?? "http://localhost:8090";
  const makeSandbox: MakeSandbox = d.makeSandbox ?? ((baseUrl: string) => new SandboxRunnerClient(baseUrl));

  app.post("/threads/:id/exec", async (req, reply) => {
    const { id: threadId } = req.params as { id: string };
    const { orgId, userId } = actor(req);

    // Org-scoped: a thread from another org is not-found (404), never 403.
    const [thread] = await d.db.select().from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
    if (!thread) return reply.code(404).send({ error: "thread not found" });

    // Admin-gated: arbitrary code execution is admin-only (`team:manage`).
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const { command } = (req.body ?? {}) as { command?: string };
    if (!command?.trim()) return reply.code(400).send({ error: "command required" });

    if (!thread.repoId) return reply.code(400).send({ error: "thread has no repo" });
    const [repo] = await d.db.select().from(repos)
      .where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
    if (!repo) return reply.code(400).send({ error: "thread has no repo" });

    const token = process.env[repo.tokenEnvVar];
    if (!token) return reply.code(400).send({ error: "repo token not configured" });

    // Build the credentialed clone URL exactly like the fusion activity.
    const repoUrl = `https://x-access-token:${token}@github.com/${repo.githubOwner}/${repo.githubName}.git`;
    const sandbox = makeSandbox(sandboxUrl);
    const result = await sandbox.exec({ repoUrl, baseBranch: repo.defaultBranch, command });
    return reply.code(200).send({ output: result.output, exitCode: result.exitCode });
  });
}
