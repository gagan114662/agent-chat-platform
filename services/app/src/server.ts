import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { makeDb } from "./db/client.js";
import { ThreadPubSub } from "./realtime/pubsub.js";
import { registerWs } from "./realtime/ws.js";
import { registerRoutes } from "./http/routes.js";
import { registerNavRoutes } from "./http/nav-routes.js";
import { startWorker } from "./fusion/worker.js";
import { makeTemporalClient } from "./fusion/bridge.js";

export async function buildServer() {
  const { db, sql } = makeDb();
  const pubsub = new ThreadPubSub(sql);
  await pubsub.start();
  const temporal = await makeTemporalClient();
  await startWorker();

  const app = Fastify({ logger: true });
  await app.register(websocket);
  registerWs(app, pubsub);
  registerRoutes(app, { db, sql, temporal, sandboxUrl: process.env.SANDBOX_URL ?? "http://localhost:8090" });
  registerNavRoutes(app, { db });
  return app;
}

if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  const app = await buildServer();
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
}
