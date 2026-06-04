import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { answerDebug } from "../observability/debug.js";

export interface DebugRoutesDeps {
  db: DB;
}

export function registerDebugRoutes(app: FastifyInstance, d: DebugRoutesDeps) {
  // #92 — conversational debugging. Rule-based NL Q&A over the org's telemetry.
  // Org-scoped: the question is answered only against the caller's orgId.
  app.post("/debug/query", async (req, reply) => {
    const { orgId } = actor(req);
    const { question } = (req.body ?? {}) as { question?: string };
    if (typeof question !== "string" || question.trim() === "") {
      return reply.code(400).send({ error: "question required" });
    }
    const result = await answerDebug(d.db, orgId, question);
    return reply.code(200).send(result);
  });
}
