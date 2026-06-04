import { describe, it, expect, afterAll } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { ThreadPubSub } from "./pubsub.js";
import { registerWs } from "./ws.js";
import { testDb, closeDb } from "../db/test-harness.js";
import { notify } from "../db/client.js";
import { THREAD_CHANNEL } from "../fusion/events.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

describe("ws fan-out", () => {
  it("delivers a NOTIFYed message to a subscribed client", async () => {
    const pubsub = new ThreadPubSub(h.sql);
    await pubsub.start();
    const app = Fastify();
    await app.register(websocket);
    registerWs(app, pubsub);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as { port: number };

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?threadId=t1`);
    const got = new Promise<any>((res) => ws.on("message", (d) => res(JSON.parse(d.toString()))));
    await new Promise((res) => ws.on("open", res));
    await notify(h.sql, THREAD_CHANNEL, { threadId: "t1", message: { body: "live" } });

    expect((await got).body).toBe("live");
    ws.close(); await app.close();
  }, 20_000);

  it("rejects an unauthenticated socket in strict mode", async () => {
    process.env.AUTH_REQUIRE_SESSION = "true";
    try {
      const pubsub = new ThreadPubSub(h.sql);
      await pubsub.start();
      const app = Fastify();
      await app.register(websocket);
      registerWs(app, pubsub, async () => undefined); // resolver returns no principal
      await app.listen({ port: 0, host: "127.0.0.1" });
      const { port } = app.server.address() as { port: number };
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?threadId=t1`);
      const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
      expect(await closed).toBe(1008);
      await app.close();
    } finally {
      delete process.env.AUTH_REQUIRE_SESSION;
    }
  }, 20000);
});
