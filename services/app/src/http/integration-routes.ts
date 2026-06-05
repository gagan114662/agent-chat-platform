import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { threads, repos } from "../db/schema.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { GitHubService } from "@acp/orchestrator/github/github-service.js";
import { actor } from "./actor.js";
import { importLinearIssues, makeLinearClient, type LinearClient } from "../integrations/linear.js";
import { importGitHubIssues } from "../integrations/github-issues.js";
import { listIntegrations } from "../integrations/registry.js";

// Builds a Linear client from an API key. Injectable so integration-routes.test.ts
// can pass a fake (no live Linear API); production uses makeLinearClient.
export type MakeLinear = (apiKey: string) => LinearClient;

// Builds a GitHub client from a token. Injectable so tests can pass a fake
// listIssues() (no network); production uses OctokitGitHubService.
export type MakeGitHub = (token: string) => Pick<GitHubService, "listIssues">;

export interface IntegrationDeps {
  db: DB;
  makeLinear?: MakeLinear;
  makeGitHub?: MakeGitHub;
}

export function registerIntegrationRoutes(app: FastifyInstance, d: IntegrationDeps) {
  const makeLinear: MakeLinear = d.makeLinear ?? makeLinearClient;
  const makeGitHub: MakeGitHub = d.makeGitHub ?? ((token: string) => new OctokitGitHubService(token));

  // #100 — registry status of each cloud integration (configured vs "needs
  // credentials"). Authed/org-scoped (actor() fails closed); the config status
  // itself is process-global env, no cross-org data is exposed.
  app.get("/integrations", async (req) => {
    actor(req); // require an authenticated principal
    return { integrations: listIntegrations() };
  });

  app.post("/integrations/linear/import", async (req, reply) => {
    const { threadId } = (req.body ?? {}) as { threadId?: string };
    if (!threadId) return reply.code(400).send({ error: "threadId required" });
    const { orgId } = actor(req);

    // Org-scoped: a thread from another org is invisible here → 404.
    const [thread] = await d.db.select().from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
    if (!thread) return reply.code(404).send({ error: "thread not found" });

    const key = process.env.LINEAR_API_KEY;
    if (!key) return reply.code(400).send({ error: "Linear API key not configured" });

    const client = makeLinear(key);
    const ids = await importLinearIssues(d.db, { orgId, threadId, client });
    return reply.code(200).send({ imported: ids.length, ids });
  });

  app.post("/integrations/github/import", async (req, reply) => {
    const { threadId } = (req.body ?? {}) as { threadId?: string };
    if (!threadId) return reply.code(400).send({ error: "threadId required" });
    const { orgId } = actor(req);

    // Org-scoped resolution: thread → repo, every hop filtered by org_id.
    const [thread] = await d.db.select().from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    if (!thread.repoId) return reply.code(404).send({ error: "repo not found" });
    const [repo] = await d.db.select().from(repos)
      .where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
    if (!repo) return reply.code(404).send({ error: "repo not found" });

    const token = process.env[repo.tokenEnvVar];
    if (!token) return reply.code(400).send({ error: "repo token not configured" });

    const github = makeGitHub(token);
    const ids = await importGitHubIssues(d.db, {
      orgId, threadId, owner: repo.githubOwner, repo: repo.githubName, github,
    });
    return reply.code(200).send({ imported: ids.length, ids });
  });
}
