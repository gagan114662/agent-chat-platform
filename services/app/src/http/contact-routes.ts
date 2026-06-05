import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { DB } from "../db/client.js";
import { contacts } from "../db/schema.js";
import { allow } from "../auth/rate-limit.js";

// #69 contact-form backend. POST /contact is a PUBLIC marketing lead-capture
// endpoint (added to PUBLIC_PATHS / the session-preHandler bypass in
// auth-routes) — anonymous landing-page visitors submit it, so there is no org
// or session. We validate that an email is present and cap field lengths to
// keep the row bounded, then insert a lead. A lightweight per-IP rate limit
// (the existing #51 `allow()`) blunts form-spam.
const MAX = { name: 200, email: 320, website: 500, help: 4000 } as const;

export function registerContactRoutes(app: FastifyInstance, d: { db: DB }) {
  app.post("/contact", async (req, reply) => {
    // Per-IP rate limit (5/min) to blunt marketing-form spam.
    if (!allow(`contact:${req.ip}`)) {
      return reply.code(429).send({ error: "too many requests" });
    }

    const body = (req.body ?? {}) as {
      name?: unknown; email?: unknown; website?: unknown; help?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const website = typeof body.website === "string" ? body.website.trim() : "";
    const help = typeof body.help === "string" ? body.help.trim() : "";

    // Validation: email is required; basic shape; lengths capped.
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.code(400).send({ error: "valid email required" });
    }
    if (name.length > MAX.name || email.length > MAX.email
        || website.length > MAX.website || help.length > MAX.help) {
      return reply.code(400).send({ error: "field too long" });
    }

    await d.db.insert(contacts).values({
      id: randomUUID(),
      name,
      email,
      website: website || null,
      help: help || null,
    });
    return reply.code(200).send({ ok: true });
  });
}
