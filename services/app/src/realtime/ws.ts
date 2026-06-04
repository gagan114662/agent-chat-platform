import type { FastifyInstance } from "fastify";
import type { ThreadPubSub } from "./pubsub.js";
import { devHeadersAllowed } from "../auth/dev-mode.js";

export function registerWs(
  app: FastifyInstance,
  pubsub: ThreadPubSub,
  resolveToken?: (token: string) => Promise<{ orgId: string; userId: string } | undefined>,
  resolveThreadOrg?: (threadId: string) => Promise<string | undefined>,
  redeemTicket?: (ticket: string) => { orgId: string; userId: string } | undefined,
) {
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const { threadId, token, ticket } = req.query as { threadId?: string; token?: string; ticket?: string };
    if (!threadId) { socket.close(1008, "threadId required"); return; }
    if (!devHeadersAllowed()) {
      // Ticket preferred (short-lived, single-use, not loggable); token kept as a fallback.
      const p =
        (ticket && redeemTicket ? redeemTicket(ticket) : undefined) ??
        (token && resolveToken ? await resolveToken(token) : undefined);
      if (!p) { socket.close(1008, "unauthenticated"); return; }
      // Cross-tenant guard: the subscribed thread must belong to the session's org.
      const threadOrg = resolveThreadOrg ? await resolveThreadOrg(threadId) : undefined;
      if (!threadOrg || threadOrg !== p.orgId) { socket.close(1008, "forbidden"); return; }
    }
    const unsub = pubsub.subscribe(threadId, (payload) => socket.send(JSON.stringify(payload.message)));
    socket.on("close", unsub);
  });
}
