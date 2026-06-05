import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import {
  createTool, listTools, getTool, updateTool, publishTool, deleteTool,
} from "../tools/tools.js";

// #99 persistent internal tools CRUD. All routes are org-scoped via actor(req).orgId
// — a cross-org tool id is invisible → 404. List is workspace-scoped and can hide
// drafts (publishedOnly). create/edit are gated: an api-key principal #83
// (`userId: "apikey:<id>"`) is always allowed (so an agent can register a tool it
// built); a human caller must be an admin (`team:manage`) — otherwise 403.
function isApiKey(userId: string): boolean {
  return userId.startsWith("apikey:");
}

export function registerToolsRoutes(app: FastifyInstance, d: { db: DB }) {
  // Returns true if the caller may create/edit tools (api-key principal OR admin).
  async function mayWrite(orgId: string, userId: string): Promise<boolean> {
    if (isApiKey(userId)) return true;
    return can(await roleOf(d.db, userId, orgId), "team:manage");
  }

  app.post("/tools", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!(await mayWrite(orgId, userId))) return reply.code(403).send({ error: "forbidden" });
    const { workspaceId, name, kind, content } = (req.body ?? {}) as {
      workspaceId?: string; name?: string; kind?: string; content?: string;
    };
    if (!workspaceId?.trim()) return reply.code(400).send({ error: "workspaceId required" });
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    try {
      const tool = await createTool(d.db, {
        orgId, workspaceId, name, kind, content,
        byKind: isApiKey(userId) ? "apikey" : "human",
        byId: userId,
      });
      return reply.code(201).send(tool);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/tools", async (req, reply) => {
    const { orgId } = actor(req);
    const { workspaceId, publishedOnly } = req.query as {
      workspaceId?: string; publishedOnly?: string;
    };
    if (!workspaceId?.trim()) return reply.code(400).send({ error: "workspaceId required" });
    return listTools(d.db, orgId, {
      workspaceId,
      publishedOnly: publishedOnly === "1" || publishedOnly === "true",
    });
  });

  app.get("/tools/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId } = actor(req);
    const tool = await getTool(d.db, orgId, id);
    if (!tool) return reply.code(404).send({ error: "tool not found" });
    return tool;
  });

  app.patch("/tools/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId, userId } = actor(req);
    if (!(await mayWrite(orgId, userId))) return reply.code(403).send({ error: "forbidden" });
    const { name, content, kind } = (req.body ?? {}) as {
      name?: string; content?: string; kind?: string;
    };
    try {
      const tool = await updateTool(d.db, { orgId, id, name, content, kind });
      if (!tool) return reply.code(404).send({ error: "tool not found" });
      return tool;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post("/tools/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId, userId } = actor(req);
    if (!(await mayWrite(orgId, userId))) return reply.code(403).send({ error: "forbidden" });
    const { published } = (req.body ?? {}) as { published?: boolean };
    const tool = await publishTool(d.db, { orgId, id, published: published === true });
    if (!tool) return reply.code(404).send({ error: "tool not found" });
    return tool;
  });

  app.delete("/tools/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId, userId } = actor(req);
    if (!(await mayWrite(orgId, userId))) return reply.code(403).send({ error: "forbidden" });
    const ok = await deleteTool(d.db, orgId, id);
    if (!ok) return reply.code(404).send({ error: "tool not found" });
    return reply.code(204).send();
  });
}
