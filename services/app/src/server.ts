import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { makeDb } from "./db/client.js";
import { ThreadPubSub } from "./realtime/pubsub.js";
import { registerWs } from "./realtime/ws.js";
import { registerRoutes } from "./http/routes.js";
import { registerTaskRoutes } from "./http/task-routes.js";
import { registerNavRoutes } from "./http/nav-routes.js";
import { registerDmRoutes } from "./http/dm-routes.js";
import { registerMemoryRoutes } from "./http/memory-routes.js";
import { registerApprovalRoutes } from "./http/approval-routes.js";
import { registerAuth } from "./http/auth-routes.js";
import { resolveSession } from "./auth/auth.js";
import { eq } from "drizzle-orm";
import { threads } from "./db/schema.js";
import { startWorker } from "./fusion/worker.js";
import { makeTemporalClient } from "./fusion/bridge.js";
import { startTelemetry, stopTelemetry } from "./telemetry/otel-init.js";

export async function buildServer() {
  const { db, sql } = makeDb();
  const pubsub = new ThreadPubSub(sql);
  await pubsub.start();
  const temporal = await makeTemporalClient();
  await startWorker();

  const app = Fastify({ logger: true });
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
  );
  const sandboxUrl = process.env.SANDBOX_URL ?? "http://localhost:8090";
  registerRoutes(app, { db, sql, temporal, sandboxUrl });
  registerTaskRoutes(app, { db, sql, temporal, sandboxUrl });
  registerNavRoutes(app, { db });
  registerDmRoutes(app, { db });
  registerMemoryRoutes(app, { db });
  registerApprovalRoutes(app, { db });
  return app;
}

if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  startTelemetry(); // exports traces to Honeycomb when HONEYCOMB_API_KEY is set
  const app = await buildServer();
  const close = async () => { await stopTelemetry(); await app.close(); process.exit(0); };
  process.on("SIGTERM", close); process.on("SIGINT", close);
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
}
