import type { FastifyInstance } from "fastify";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import {
  createAutomation, listAutomations, setEnabled, deleteAutomation,
  type Trigger, type Action,
} from "../autonomy/automations.js";
import type { StartRun } from "../autonomy/tick.js";

// #98 automation CRUD routes. Mutations are admin-gated (`team:manage`); reads are
// org-scoped. An automation in another org is treated as not-found (404) on
// PATCH/DELETE — no cross-org reads or writes. `trigger.type`/`action.type` are
// validated at create time.
export interface AutomationRouteDeps {
  db: DB;
  sql: postgres.Sql;
  temporal: Client;
  sandboxUrl: string;
  start?: StartRun;
}

function validTrigger(t: unknown): t is Trigger {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  if (o.type === "schedule") return typeof o.everyMinutes === "number" && o.everyMinutes > 0;
  if (o.type === "event") return typeof o.event === "string" && o.event.length > 0;
  return false;
}

function validAction(a: unknown): a is Action {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  if (o.type === "message") return typeof o.threadId === "string" && typeof o.body === "string";
  if (o.type === "run") return typeof o.threadId === "string" && typeof o.agentId === "string" && typeof o.intent === "string";
  if (o.type === "slack") return typeof o.channel === "string" && o.channel.length > 0 && typeof o.text === "string";
  return false;
}

export function registerAutomationRoutes(app: FastifyInstance, d: AutomationRouteDeps) {
  app.get("/automations", async (req) => listAutomations(d.db, actor(req).orgId));

  app.post("/automations", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { name, trigger, action } = (req.body ?? {}) as { name?: string; trigger?: unknown; action?: unknown };
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    if (!validTrigger(trigger)) return reply.code(400).send({ error: "trigger must be {type:'schedule',everyMinutes} or {type:'event',event}" });
    if (!validAction(action)) return reply.code(400).send({ error: "action must be {type:'message',threadId,body}, {type:'run',threadId,agentId,intent} or {type:'slack',channel,text}" });
    const created = await createAutomation(d.db, { orgId, name: name.trim(), trigger, action, createdById: userId });
    return reply.code(201).send(created);
  });

  app.patch("/automations/:id", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = req.params as { id: string };
    const { enabled } = (req.body ?? {}) as { enabled?: boolean };
    if (typeof enabled !== "boolean") return reply.code(400).send({ error: "enabled (boolean) required" });
    const ok = await setEnabled(d.db, orgId, id, enabled);
    if (!ok) return reply.code(404).send({ error: "automation not found" });
    return reply.code(200).send({ ok: true });
  });

  app.delete("/automations/:id", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = req.params as { id: string };
    const ok = await deleteAutomation(d.db, orgId, id);
    if (!ok) return reply.code(404).send({ error: "automation not found" });
    return reply.code(204).send();
  });
}
