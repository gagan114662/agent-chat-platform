import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agents, members, runs, tasks } from "../db/schema.js";
import { actor } from "./actor.js";
import { setAgentShared, setAgentProfile, setAgentConfig, isAgentVisibility, createAgent, QuotaError } from "../agents/agents.js";
import { roleOf, can } from "../rbac/rbac.js";

export function registerAgentRoutes(app: FastifyInstance, d: { db: DB }) {
  // #91: list the org's agents, exposing the profile fields (avatarUrl,
  // visibility) alongside the existing fields. Org-scoped.
  app.get("/agents", async (req, reply) => {
    const { orgId } = actor(req);
    const rows = await d.db.select().from(agents).where(eq(agents.orgId, orgId));
    return reply.code(200).send(rows);
  });

  // #122: which agents are actively working right now — agents whose assigned
  // tasks have a non-terminal run (pending/running/awaiting_plan_approval). Powers
  // the Team panel's live "working" status instead of a static "online" badge.
  app.get("/agents/active", async (req, reply) => {
    const { orgId } = actor(req);
    const rows = await d.db.select({ agentId: tasks.assigneeId }).from(runs)
      .innerJoin(tasks, and(eq(tasks.id, runs.taskId), eq(tasks.orgId, orgId)))
      .where(and(
        eq(runs.orgId, orgId),
        inArray(runs.state, ["pending", "running", "awaiting_plan_approval"]),
        eq(tasks.assigneeKind, "agent"),
      ));
    const active = [...new Set(rows.map((r) => r.agentId).filter((x): x is string => !!x))];
    return reply.code(200).send({ active });
  });

  // #85: create an agent (admin-gated via agent:share, org-scoped). Enforces the
  // org's plan agent quota — at/over the limit returns 402 with a clear "quota
  // reached" message (upgrade the plan). Defaults the workspace to the creator's.
  app.post("/agents", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "agent:share")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { handle, displayName, adapter, config, workspaceId } =
      (req.body ?? {}) as { handle?: string; displayName?: string; adapter?: string; config?: unknown; workspaceId?: string };
    if (!handle?.trim() || !displayName?.trim()) {
      return reply.code(400).send({ error: "handle and displayName required" });
    }
    let ws = workspaceId;
    if (!ws) {
      const [me] = await d.db.select({ workspaceId: members.workspaceId }).from(members).where(and(eq(members.id, userId), eq(members.orgId, orgId)));
      ws = me?.workspaceId;
    }
    if (!ws) return reply.code(400).send({ error: "workspaceId required" });
    try {
      const agent = await createAgent(d.db, { orgId, workspaceId: ws, handle: handle.trim(), displayName: displayName.trim(), adapter, config });
      return reply.code(201).send(agent);
    } catch (e) {
      if (e instanceof QuotaError) return reply.code(402).send({ error: e.message });
      throw e;
    }
  });

  // #91: set an agent's profile — avatarUrl and/or visibility (public|private).
  // Reuses the existing agent-management gate (#28 agent:share). Org-scoped.
  app.patch("/agents/:id/profile", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { avatarUrl, visibility } = (req.body ?? {}) as { avatarUrl?: string | null; visibility?: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "agent:share")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (visibility !== undefined && !isAgentVisibility(visibility)) {
      return reply.code(400).send({ error: "visibility must be one of: public, private" });
    }
    if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== "string") {
      return reply.code(400).send({ error: "avatarUrl must be a string or null" });
    }
    const agent = await setAgentProfile(d.db, { orgId, agentId: id, avatarUrl, visibility });
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    return reply.code(200).send(agent);
  });

  // #74: set an agent's preferences — systemPrompt / contextDirs / preferences —
  // on its jsonb `config`. Reuses the agent-management gate (#28 agent:share),
  // org-scoped (404). Merges into the existing config so model/provider (#58) and
  // mcpServers (#57) are preserved. contextDirs must be a string[] (else 400).
  app.patch("/agents/:id/config", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { systemPrompt, contextDirs, preferences } =
      (req.body ?? {}) as { systemPrompt?: unknown; contextDirs?: unknown; preferences?: unknown };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "agent:share")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (systemPrompt !== undefined && typeof systemPrompt !== "string") {
      return reply.code(400).send({ error: "systemPrompt must be a string" });
    }
    if (contextDirs !== undefined &&
      (!Array.isArray(contextDirs) || !contextDirs.every((dir) => typeof dir === "string"))) {
      return reply.code(400).send({ error: "contextDirs must be an array of strings" });
    }
    if (preferences !== undefined &&
      (preferences === null || typeof preferences !== "object" || Array.isArray(preferences))) {
      return reply.code(400).send({ error: "preferences must be an object" });
    }
    const agent = await setAgentConfig(d.db, {
      orgId, agentId: id,
      prefs: {
        systemPrompt: systemPrompt as string | undefined,
        contextDirs: contextDirs as string[] | undefined,
        preferences: preferences as Record<string, unknown> | undefined,
      },
    });
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    return reply.code(200).send(agent);
  });

  // #28: toggle whether an agent is shared org-wide (admin only, org-scoped).
  app.patch("/agents/:id/shared", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { shared } = req.body as { shared: boolean };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "agent:share")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (typeof shared !== "boolean") return reply.code(400).send({ error: "shared (boolean) required" });
    const agent = await setAgentShared(d.db, { orgId, agentId: id, shared });
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    return reply.code(200).send(agent);
  });
}
