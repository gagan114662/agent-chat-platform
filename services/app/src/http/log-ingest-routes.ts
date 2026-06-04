import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { orgs, incidents, logEvents } from "../db/schema.js";
import { parseLogs, errorIncidents } from "../observability/logs.js";

export interface LogIngestDeps {
  db: DB;
  sql: postgres.Sql;
}

// Body cap for an ingest batch (5 MiB) — mirrors the Cloudflare ingest route.
const BODY_LIMIT = 5 * 1024 * 1024;

// registerLogIngestRoutes — #95. Generic, secret-guarded log ingestion. Same
// machine-auth as the Cloudflare route (#55): a SHARED SECRET header
// (x-acp-ingest-secret), NOT the user session — the user-auth preHandler treats
// /ingest/* as public (see auth-routes PUBLIC_PATHS prefix check) and this route
// enforces its own secret. `:source` labels the origin, `:orgId` scopes it.
export function registerLogIngestRoutes(app: FastifyInstance, d: LogIngestDeps) {
  // Read the body as a raw string (logs arrive as NDJSON / JSON / plain text,
  // typically text/plain or application/x-ndjson). Guarded so it's a no-op when
  // a sibling ingest route already registered the same parser on this instance.
  for (const ct of ["text/plain", "application/x-ndjson", "application/octet-stream"]) {
    if (!app.hasContentTypeParser(ct)) {
      app.addContentTypeParser(
        ct,
        { parseAs: "string", bodyLimit: BODY_LIMIT },
        (_req, body, done) => done(null, body),
      );
    }
  }

  app.post<{ Params: { source: string; orgId: string } }>(
    "/ingest/logs/:source/:orgId",
    { bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      // 1) Machine auth: shared secret. 401 if unset or mismatched — BEFORE any
      //    DB work so an unauthenticated caller learns nothing.
      const expected = process.env.ACP_INGEST_SECRET;
      const provided = req.headers["x-acp-ingest-secret"];
      if (!expected || provided !== expected) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      // 2) Org must exist (org-scoped → 404 otherwise).
      const { source, orgId } = req.params;
      const [org] = await d.db.select().from(orgs).where(eq(orgs.id, orgId));
      if (!org) return reply.code(404).send({ error: "org not found" });

      // 3) Parse the batch (NDJSON / JSON array / plain text). Malformed lines
      //    are skipped gracefully by parseLogs.
      const body = typeof req.body === "string" ? req.body : "";
      const contentType = req.headers["content-type"];
      const records = parseLogs(body, contentType);

      // 4) Persist log_events (append-only; ids unique per batch line). A stable
      //    base ts is used so all rows in a batch share an ingest time.
      let ingested = 0;
      if (records.length) {
        const baseTs = new Date();
        const rows = records.map((r, i) => ({
          id: `${orgId}:${source}:${baseTs.getTime()}:${i}:${Math.random().toString(36).slice(2, 8)}`,
          orgId,
          source,
          level: r.level,
          message: r.message,
          raw: (r.raw ?? {}) as object,
          ts: baseTs,
        }));
        // Batch insert; chunk to stay well under parameter limits for huge batches.
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const inserted = await d.db.insert(logEvents).values(rows.slice(i, i + CHUNK)).returning({ id: logEvents.id });
          ingested += inserted.length;
        }
      }

      // 5) Derive incidents from error/fatal records → insert (idempotent via a
      //    deterministic id + onConflictDoNothing → re-POST yields 0 new).
      const detected = errorIncidents(records);
      let newIncidents = 0;
      for (const inc of detected) {
        const incidentId = `${orgId}:${inc.key}`;
        const [incRow] = await d.db.insert(incidents).values({
          id: incidentId,
          orgId,
          source: `log:${source}`,
          severity: inc.severity,
          title: inc.title,
          body: inc.body,
          raw: {},
          taskId: null,
        }).onConflictDoNothing().returning();
        if (incRow) newIncidents++;
      }

      return reply.code(200).send({ ingested, incidents: newIncidents });
    },
  );
}
