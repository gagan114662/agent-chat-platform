import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { orgs, threads, tasks, incidents } from "../db/schema.js";
import { parseLogpush, detectIncidents } from "../integrations/cloudflare.js";
import { createMessage } from "../chat/messages.js";
import { notify } from "../db/client.js";
import { THREAD_CHANNEL } from "../fusion/events.js";

export interface IngestDeps {
  db: DB;
  sql: postgres.Sql;
}

// Body cap for an ingest batch (5 MiB). Logpush batches are gzipped on the wire
// but our parser reads decompressed NDJSON; cap protects memory either way.
const BODY_LIMIT = 5 * 1024 * 1024;

// registerIngestRoutes exposes machine-to-machine ingestion endpoints. Auth here
// is a SHARED SECRET header (x-acp-ingest-secret), NOT the user session — the
// user-auth preHandler treats /ingest/* as public (see auth-routes PUBLIC_PATHS
// prefix check) and this route enforces its own secret. Org is the path param.
export function registerIngestRoutes(app: FastifyInstance, d: IngestDeps) {
  // Read the body as a raw string (Logpush posts NDJSON, often text/plain or
  // application/x-ndjson). Registered as a route-local content-type parser so
  // it doesn't change JSON parsing for the rest of the app.
  app.addContentTypeParser(
    ["text/plain", "application/x-ndjson", "application/octet-stream"],
    { parseAs: "string", bodyLimit: BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );

  app.post<{ Params: { orgId: string }; Querystring: { threadId?: string } }>(
    "/ingest/cloudflare/:orgId",
    { bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      // 1) Machine auth: shared secret. 401 if unset or mismatched. Use this
      //    BEFORE any DB work so an unauthenticated caller learns nothing.
      const expected = process.env.ACP_INGEST_SECRET;
      const provided = req.headers["x-acp-ingest-secret"];
      if (!expected || provided !== expected) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      // 2) Org must exist (org-scoped → 404 otherwise).
      const { orgId } = req.params;
      const [org] = await d.db.select().from(orgs).where(eq(orgs.id, orgId));
      if (!org) return reply.code(404).send({ error: "org not found" });

      // 3) Optional target thread for Tasks — resolved org-scoped (a foreign
      //    thread id is invisible → 404). When absent we still record incidents,
      //    just without opening Tasks.
      const threadId = req.query.threadId ?? process.env.INCIDENT_THREAD_ID;
      let resolvedThreadId: string | null = null;
      if (threadId) {
        const [thread] = await d.db.select().from(threads)
          .where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
        if (!thread) return reply.code(404).send({ error: "thread not found" });
        resolvedThreadId = thread.id;
      }

      // 4) Parse NDJSON → detect → persist (idempotent).
      const ndjson = typeof req.body === "string" ? req.body : "";
      const records = parseLogpush(ndjson);
      const detected = detectIncidents(records);

      let newIncidents = 0;
      let newTasks = 0;
      for (const inc of detected) {
        const incidentId = `${orgId}:${inc.key}`;
        const taskId = `incident:${orgId}:${inc.key}`;

        // Open the Task first (when a thread is configured) so we can link it.
        let linkedTaskId: string | null = null;
        if (resolvedThreadId) {
          const [taskRow] = await d.db.insert(tasks).values({
            id: taskId,
            orgId,
            threadId: resolvedThreadId,
            title: inc.title,
            state: "open",
            createdByKind: "integration",
            createdById: "cloudflare",
          }).onConflictDoNothing().returning();
          if (taskRow) {
            newTasks++;
            // Post a system message to the thread so humans see the incident.
            const msg = await createMessage(d.db, {
              orgId,
              threadId: resolvedThreadId,
              authorKind: "agent",
              authorId: "cloudflare",
              kind: "system",
              body: `[${inc.severity.toUpperCase()}] ${inc.title}\n\n${inc.body}`,
            });
            await notify(d.sql, THREAD_CHANNEL, { threadId: resolvedThreadId, message: msg });
          }
          linkedTaskId = taskId;
        }

        const [incRow] = await d.db.insert(incidents).values({
          id: incidentId,
          orgId,
          source: "cloudflare",
          severity: inc.severity,
          title: inc.title,
          body: inc.body,
          raw: inc.raw as object,
          taskId: linkedTaskId,
        }).onConflictDoNothing().returning();
        if (incRow) newIncidents++;
      }

      return reply.code(200).send({ incidents: newIncidents, tasks: newTasks });
    },
  );
}
