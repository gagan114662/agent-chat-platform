import type { FastifyInstance } from "fastify";
import type { ThreadPubSub } from "./pubsub.js";

export function registerWs(app: FastifyInstance, pubsub: ThreadPubSub) {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const threadId = (req.query as { threadId?: string }).threadId;
    if (!threadId) { socket.close(1008, "threadId required"); return; }
    const unsub = pubsub.subscribe(threadId, (payload) => {
      socket.send(JSON.stringify(payload.message));
    });
    socket.on("close", unsub);
  });
}
