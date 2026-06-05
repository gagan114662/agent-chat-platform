import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { eq, and } from "drizzle-orm";
import { members, repos } from "../db/schema.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import { connectRepo, ingestIssues, RepoError, DEFAULT_TOKEN_ENV } from "../repos/manage.js";

// #139: connect arbitrary repos to the workspace (incl. the platform's own) and
// ingest a repo's open GitHub issues as goals. Admin-gated (agent:share — same gate
// as agent/repo management). Org-scoped via actor.
export function registerRepoRoutes(app: FastifyInstance, d: { db: DB }) {
  // Connect an existing GitHub repo. Body: { githubOwner, githubName, defaultBranch?,
  // tokenEnvVar?, production? }. Defaults the token env to the platform's and treats
  // the repo as production (plan-first) unless told otherwise.
  app.post("/repos", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "agent:share")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const body = (req.body ?? {}) as { githubOwner?: string; githubName?: string; defaultBranch?: string; tokenEnvVar?: string; production?: boolean; workspaceId?: string };
    if (!body.githubOwner || !body.githubName) {
      return reply.code(400).send({ error: "githubOwner and githubName required" });
    }
    let ws = body.workspaceId;
    if (!ws) {
      const [me] = await d.db.select({ workspaceId: members.workspaceId }).from(members).where(and(eq(members.id, userId), eq(members.orgId, orgId)));
      ws = me?.workspaceId;
    }
    if (!ws) return reply.code(400).send({ error: "workspaceId required" });
    try {
      const repo = await connectRepo(d.db, {
        orgId, workspaceId: ws, githubOwner: body.githubOwner, githubName: body.githubName,
        defaultBranch: body.defaultBranch, tokenEnvVar: body.tokenEnvVar, production: body.production,
      });
      return reply.code(201).send(repo);
    } catch (e) {
      if (e instanceof RepoError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  // The default token env var a connect uses (so the UI can show what will be read).
  app.get("/repos/default-token-env", async (_req, reply) =>
    reply.code(200).send({ tokenEnvVar: DEFAULT_TOKEN_ENV, present: !!process.env[DEFAULT_TOKEN_ENV] }));

  // Ingest a connected repo's open issues as goals (one per issue, idempotent).
  app.post("/repos/:id/ingest-issues", async (req, reply) => {
    const { id: repoId } = req.params as { id: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "agent:share")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    try {
      const out = await ingestIssues(d.db, { orgId, repoId, byId: userId });
      return reply.code(200).send(out);
    } catch (e) {
      if (e instanceof RepoError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
}
