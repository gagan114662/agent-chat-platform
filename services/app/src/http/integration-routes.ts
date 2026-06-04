import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { threads } from "../db/schema.js";
import { actor } from "./actor.js";
import { importLinearIssues, makeLinearClient, type LinearClient } from "../integrations/linear.js";

// Builds a Linear client from an API key. Injectable so integration-routes.test.ts
// can pass a fake (no live Linear API); production uses makeLinearClient.
export type MakeLinear = (apiKey: string) => LinearClient;

export interface IntegrationDeps {
  db: DB;
  makeLinear?: MakeLinear;
}

export function registerIntegrationRoutes(app: FastifyInstance, d: IntegrationDeps) {
  const makeLinear: MakeLinear = d.makeLinear ?? makeLinearClient;

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
}
