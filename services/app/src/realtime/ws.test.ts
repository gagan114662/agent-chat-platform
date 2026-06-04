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
    delete process.env.ACP_ALLOW_DEV_HEADERS;
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
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  }, 20000);

  it("authenticates with a valid ticket and delivers a message (strict mode)", async () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const pubsub = new ThreadPubSub(h.sql);
      await pubsub.start();
      const app = Fastify();
      await app.register(websocket);
      registerWs(
        app,
        pubsub,
        async () => undefined, // token resolver returns nothing — only the ticket should authenticate
        async () => "o1", // thread t1 → org o1
        (t) => (t === "good" ? { orgId: "o1", userId: "m1" } : undefined),
      );
      await app.listen({ port: 0, host: "127.0.0.1" });
      const { port } = app.server.address() as { port: number };

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?threadId=t1&ticket=good`);
      const got = new Promise<any>((res) => ws.on("message", (d) => res(JSON.parse(d.toString()))));
      await new Promise((res) => ws.on("open", res));
      await notify(h.sql, THREAD_CHANNEL, { threadId: "t1", message: { body: "live-ticket" } });

      expect((await got).body).toBe("live-ticket");
      ws.close();
      await app.close();
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  }, 20_000);

  it("rejects a bad ticket with no token (strict mode)", async () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const pubsub = new ThreadPubSub(h.sql);
      await pubsub.start();
      const app = Fastify();
      await app.register(websocket);
      registerWs(
        app,
        pubsub,
        async () => undefined,
        async () => "o1",
        (t) => (t === "good" ? { orgId: "o1", userId: "m1" } : undefined),
      );
      await app.listen({ port: 0, host: "127.0.0.1" });
      const { port } = app.server.address() as { port: number };
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?threadId=t1&ticket=nope`);
      const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
      expect(await closed).toBe(1008);
      await app.close();
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  }, 20000);

  it("rejects subscribing to a thread from another org (cross-tenant IDOR)", async () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const pubsub = new ThreadPubSub(h.sql);
      await pubsub.start();
      const app = Fastify();
      await app.register(websocket);
      // session principal is in org o2; thread t1 belongs to org o1
      registerWs(
        app,
        pubsub,
        async () => ({ orgId: "o2", userId: "m9" }),
        async () => "o1", // thread t1 → org o1
      );
      await app.listen({ port: 0, host: "127.0.0.1" });
      const { port } = app.server.address() as { port: number };
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?threadId=t1&token=x`);
      const closed = new Promise<number>((res) => ws.on("close", (code) => res(code)));
      expect(await closed).toBe(1008);
      await app.close();
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  }, 20000);
});
