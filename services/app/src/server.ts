import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { makeDb } from "./db/client.js";
import { ThreadPubSub } from "./realtime/pubsub.js";
import { registerWs } from "./realtime/ws.js";
import { redeemWsTicket } from "./realtime/ws-tickets.js";
import { registerRoutes } from "./http/routes.js";
import { registerTaskRoutes } from "./http/task-routes.js";
import { registerTaskDetailRoutes } from "./http/task-detail-routes.js";
import { registerFanoutRoutes } from "./http/fanout-routes.js";
import { registerSelectRoutes } from "./http/select-routes.js";
import { registerNavRoutes } from "./http/nav-routes.js";
import { registerThreadReposRoutes } from "./http/thread-repos-routes.js";
import { registerTeamRoutes } from "./http/team-routes.js";
import { registerNotifyRoutes } from "./http/notify-routes.js";
import { registerDmRoutes } from "./http/dm-routes.js";
import { registerMemoryRoutes } from "./http/memory-routes.js";
import { registerAgentRoutes } from "./http/agent-routes.js";
import { registerApprovalRoutes } from "./http/approval-routes.js";
import { registerPlanRoutes } from "./http/plan-routes.js";
import { registerDiffRoutes } from "./http/diff-routes.js";
import { registerExecRoutes } from "./http/exec-routes.js";
import { registerChecksRoutes } from "./http/checks-routes.js";
import { registerNotesRoutes } from "./http/notes-routes.js";
import { registerToolsRoutes } from "./http/tools-routes.js";
import { registerRootCauseRoutes } from "./http/rootcause-routes.js";
import { registerDebugRoutes } from "./http/debug-routes.js";
import { registerFileRoutes } from "./http/file-routes.js";
import { registerFileStorageRoutes } from "./http/file-storage-routes.js";
import { registerCommentSyncRoutes } from "./http/comment-sync-routes.js";
import { registerPrEditRoutes } from "./http/pr-edit-routes.js";
import { registerAutonomyRoutes } from "./http/autonomy-routes.js";
import { registerRepoRoutes } from "./http/repo-routes.js";
import { registerCheckpointRoutes } from "./http/checkpoint-routes.js";
import { registerIntegrationRoutes } from "./http/integration-routes.js";
import { registerIngestRoutes } from "./http/ingest-routes.js";
import { registerLogIngestRoutes } from "./http/log-ingest-routes.js";
import { registerWebhookRoutes } from "./http/webhook-routes.js";
import { registerAuth } from "./http/auth-routes.js";
import { registerSessionRoutes } from "./http/session-routes.js";
import { registerApiKeyRoutes } from "./http/apikey-routes.js";
import { registerInviteRoutes } from "./http/invite-routes.js";
import { registerAutomationRoutes } from "./http/automation-routes.js";
import { registerBillingRoutes } from "./http/billing-routes.js";
import { registerOpenApiRoutes } from "./http/openapi-routes.js";
import { registerContactRoutes } from "./http/contact-routes.js";
import { resolveSession } from "./auth/auth.js";
import { eq } from "drizzle-orm";
import { threads } from "./db/schema.js";
import { startWorker } from "./fusion/worker.js";
import { lazyTemporalClient } from "./fusion/bridge.js";
import { startScheduler } from "./autonomy/scheduler.js";
import { startTelemetry, stopTelemetry } from "./telemetry/otel-init.js";

// pino redaction so credentials never reach the logs (defense-in-depth on top
// of route-level redaction). Paths cover request auth headers, token/ticket
// query params, and any nested token/repoUrl/tokenEnvVar field.
export const loggerOptions = {
  redact: {
    paths: ["req.headers.authorization", "req.query.token", "req.query.ticket", "*.token", "*.repoUrl", "*.tokenEnvVar"],
    censor: "[redacted]",
  },
};

export async function buildServer() {
  const { db, sql } = makeDb();
  const pubsub = new ThreadPubSub(sql);
  await pubsub.start();
  // Lazy Temporal: connect on first run-dispatch, not at boot — the app serves
  // chat/auth/memory/tasks/UI even if Temporal is down. The worker is started
  // fire-and-forget so a missing Temporal can't block (or crash) boot; runs
  // simply won't execute until Temporal is reachable.
  const temporal = lazyTemporalClient();
  startWorker().catch((err) => console.warn("[acp] temporal worker not started (runs won't execute until Temporal is reachable):", String(err)));

  const app = Fastify({ logger: loggerOptions });
  await app.register(websocket);
  registerAuth(app, { db });
  registerWs(
    app,
    pubsub,
    (token) => resolveSession(db, token),
    async (threadId) => {
      const [t] = await db.select({ orgId: threads.orgId }).from(threads).where(eq(threads.id, threadId));
      return t?.orgId;
    },
    redeemWsTicket,
  );
  const sandboxUrl = process.env.SANDBOX_URL ?? "http://localhost:8090";
  registerRoutes(app, { db, sql, temporal, sandboxUrl });
  registerTaskRoutes(app, { db, sql, temporal, sandboxUrl });
  registerTaskDetailRoutes(app, { db });
  registerFanoutRoutes(app, { db, sql, temporal, sandboxUrl });
  registerSelectRoutes(app, { db, sql });
  registerNavRoutes(app, { db });
  registerThreadReposRoutes(app, { db }); // #75: multi-repo per thread + fork
  registerTeamRoutes(app, { db });
  registerNotifyRoutes(app, { db });
  registerDmRoutes(app, { db });
  registerMemoryRoutes(app, { db });
  registerAgentRoutes(app, { db });
  registerApprovalRoutes(app, { db });
  registerPlanRoutes(app, { db, sql, temporal, sandboxUrl });
  registerDiffRoutes(app, { db });
  registerExecRoutes(app, { db, sandboxUrl }); // #72 admin exec route → sandbox /exec
  registerChecksRoutes(app, { db });
  registerNotesRoutes(app, { db });
  registerToolsRoutes(app, { db }); // #99 persistent internal tools (HTML + publish)
  registerRootCauseRoutes(app, { db });
  registerDebugRoutes(app, { db });
  registerFileRoutes(app, { db });
  registerFileStorageRoutes(app, { db });
  registerCommentSyncRoutes(app, { db, sql });
  registerPrEditRoutes(app, { db });
  registerAutonomyRoutes(app, { db, sql, temporal, sandboxUrl });
  registerRepoRoutes(app, { db }); // #139 connect repos + ingest issues as goals
  registerCheckpointRoutes(app, { db, sql, temporal, sandboxUrl });
  registerIntegrationRoutes(app, { db });
  registerIngestRoutes(app, { db, sql });
  registerLogIngestRoutes(app, { db, sql });
  registerWebhookRoutes(app, { db, sql });
  registerApiKeyRoutes(app, { db });
  registerSessionRoutes(app, { db });
  registerInviteRoutes(app, { db });
  registerAutomationRoutes(app, { db, sql, temporal, sandboxUrl });
  registerBillingRoutes(app, { db });
  registerOpenApiRoutes(app); // #86: GET /openapi.json + /docs (public)
  registerContactRoutes(app, { db }); // #69: POST /contact (public marketing lead capture)

  // Public liveness/health probe (in PUBLIC_PATHS so the auth preHandler won't 401 it).
  app.get("/healthz", async () => ({ ok: true }));

  // #137 the unattended clock: drive every autonomy-on goal on an interval (behind
  // ACP_AUTONOMY_INTERVAL_MS — unset/0 disables, so dev + tests never auto-run).
  // Tied to the app lifecycle so it stops cleanly on shutdown.
  const stopScheduler = startScheduler({ db, sql, temporal, sandboxUrl });
  app.addHook("onClose", async () => { stopScheduler(); });

  // Serve the built web SPA same-origin (single-server prod). API routes are
  // registered first so they win; everything else falls back to index.html.
  // Behind SERVE_WEB so dev + tests (which don't set it) are unaffected.
  if (process.env.SERVE_WEB === "1") {
    const webDist = process.env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname;
    const { existsSync } = await import("node:fs");
    if (existsSync(webDist)) {
      const fastifyStatic = (await import("@fastify/static")).default;
      await app.register(fastifyStatic, { root: webDist, wildcard: false });
      app.setNotFoundHandler((req, reply) => {
        // SPA fallback for non-API GETs; API 404s still return JSON.
        if (
          req.method === "GET" &&
          !req.url.startsWith("/auth") &&
          !req.url.startsWith("/threads") &&
          !req.url.startsWith("/channels") &&
          !req.url.startsWith("/teams") &&
          !req.url.startsWith("/runs") &&
          !req.url.startsWith("/tasks") &&
          !req.url.startsWith("/goals") &&
          !req.url.startsWith("/orgs") &&
          !req.url.startsWith("/agents") &&
          !req.url.startsWith("/billing") &&
          !req.url.startsWith("/memory") &&
          !req.url.startsWith("/dms") &&
          !req.url.startsWith("/repos") &&
          !req.url.startsWith("/search") &&
          !req.url.startsWith("/unreads") &&
          !req.url.startsWith("/inbox") &&
          !req.url.startsWith("/principals") &&
          !req.url.startsWith("/ws") &&
          !req.url.startsWith("/ws-ticket") &&
          !req.url.startsWith("/healthz")
        ) {
          return reply.sendFile("index.html");
        }
        return reply.code(404).send({ error: "not found" });
      });
    }
  }
  return app;
}

if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  startTelemetry(); // exports traces to Honeycomb when HONEYCOMB_API_KEY is set
  const app = await buildServer();
  const close = async () => { await stopTelemetry(); await app.close(); process.exit(0); };
  process.on("SIGTERM", close); process.on("SIGINT", close);
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
}
