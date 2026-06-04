import type { FastifyInstance } from "fastify";
import type { ThreadPubSub } from "./pubsub.js";

export function registerWs(
  app: FastifyInstance,
  pubsub: ThreadPubSub,
  resolveToken?: (token: string) => Promise<{ orgId: string; userId: string } | undefined>,
) {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const { threadId, token } = req.query as { threadId?: string; token?: string };
    if (!threadId) { socket.close(1008, "threadId required"); return; }
    if (process.env.AUTH_REQUIRE_SESSION) {
      const p = token && resolveToken ? await resolveToken(token) : undefined;
      if (!p) { socket.close(1008, "unauthenticated"); return; }
    }
    const unsub = pubsub.subscribe(threadId, (payload) => socket.send(JSON.stringify(payload.message)));
    socket.on("close", unsub);
  });
}
