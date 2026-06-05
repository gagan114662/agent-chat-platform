import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import { registerFileStorageRoutes } from "./file-storage-routes.js";
import type { StorageBackend } from "../files/storage.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// In-memory StorageBackend so tests need no real FS.
function memStorage(): StorageBackend & { map: Map<string, Buffer> } {
  const map = new Map<string, Buffer>();
  return {
    map,
    async put(key, data) { map.set(key, Buffer.from(data)); },
    async get(key) {
      const v = map.get(key);
      if (!v) throw new Error("not found");
      return v;
    },
  };
}

function makeApp(storage: StorageBackend) {
  const app = Fastify();
  registerFileStorageRoutes(app, { db: h.db, storage });
  return app;
}

const HDR = { "x-org-id": "o1", "x-user-id": "m1", "content-type": "application/json" };
const HDR2 = { "x-org-id": "o2", "x-user-id": "m2", "content-type": "application/json" };

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
});

describe("POST /files", () => {
  it("201 with a file (inferred kind) + a signed uploadUrl", async () => {
    const app = makeApp(memStorage());
    const res = await app.inject({
      method: "POST", url: "/files", headers: HDR,
      payload: { name: "server.ts", contentType: "application/octet-stream", size: 0 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.file.artifactKind).toBe("code");
    expect(body.file.uploaded).toBe(false);
    expect(body.uploadUrl).toMatch(new RegExp(`^/files/${body.file.id}/content\\?sig=`));
  });

  it("400 when declared size exceeds the 25 MiB cap", async () => {
    const app = makeApp(memStorage());
    const res = await app.inject({
      method: "POST", url: "/files", headers: HDR,
      payload: { name: "big.bin", size: 26 * 1024 * 1024 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /files/:id/content?sig=", () => {
  it("200 stores the bytes + flips uploaded=true with a valid sig", async () => {
    const storage = memStorage();
    const app = makeApp(storage);
    const create = await app.inject({
      method: "POST", url: "/files", headers: HDR,
      payload: { name: "a.bin", contentType: "application/octet-stream" },
    });
    const { file, uploadUrl } = create.json();

    const put = await app.inject({
      method: "PUT", url: uploadUrl,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("the bytes"),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().file.uploaded).toBe(true);
    expect(storage.map.get(file.storageKey)?.toString()).toBe("the bytes");
  });

  it("401 on a bad/missing signature", async () => {
    const app = makeApp(memStorage());
    const create = await app.inject({
      method: "POST", url: "/files", headers: HDR, payload: { name: "a.bin" },
    });
    const { file } = create.json();
    const bad = await app.inject({
      method: "PUT", url: `/files/${file.id}/content?sig=deadbeef`,
      headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("x"),
    });
    expect(bad.statusCode).toBe(401);
    const missing = await app.inject({
      method: "PUT", url: `/files/${file.id}/content`,
      headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("x"),
    });
    expect(missing.statusCode).toBe(401);
  });

  it("413 when the uploaded body exceeds the cap", async () => {
    const app = makeApp(memStorage());
    const create = await app.inject({
      method: "POST", url: "/files", headers: HDR, payload: { name: "a.bin" },
    });
    const { file, uploadUrl } = create.json();
    void file;
    const oversize = Buffer.alloc(25 * 1024 * 1024 + 1);
    const res = await app.inject({
      method: "PUT", url: uploadUrl,
      headers: { "content-type": "application/octet-stream" }, payload: oversize,
    });
    // Fastify enforces bodyLimit → 413 before/at the handler.
    expect([400, 413]).toContain(res.statusCode);
  });
});

describe("GET /files/:id", () => {
  it("metadata + a signed downloadUrl (org-scoped)", async () => {
    const app = makeApp(memStorage());
    const create = await app.inject({ method: "POST", url: "/files", headers: HDR, payload: { name: "a.md" } });
    const { file } = create.json();

    const res = await app.inject({ method: "GET", url: `/files/${file.id}`, headers: HDR });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.file.id).toBe(file.id);
    expect(body.file.artifactKind).toBe("markdown");
    expect(body.downloadUrl).toMatch(new RegExp(`^/files/${file.id}/download\\?sig=`));
  });

  it("cross-org GET → 404", async () => {
    const app = makeApp(memStorage());
    const create = await app.inject({ method: "POST", url: "/files", headers: HDR, payload: { name: "a.md" } });
    const { file } = create.json();
    const res = await app.inject({ method: "GET", url: `/files/${file.id}`, headers: HDR2 });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /files/:id/download?sig=", () => {
  it("streams the stored bytes with the file's content-type", async () => {
    const storage = memStorage();
    const app = makeApp(storage);
    const create = await app.inject({
      method: "POST", url: "/files", headers: HDR,
      payload: { name: "a.png", contentType: "image/png" },
    });
    const { file, uploadUrl } = create.json();
    await app.inject({
      method: "PUT", url: uploadUrl,
      headers: { "content-type": "image/png" }, payload: Buffer.from("PNGDATA"),
    });

    const meta = await app.inject({ method: "GET", url: `/files/${file.id}`, headers: HDR });
    const { downloadUrl } = meta.json();
    const dl = await app.inject({ method: "GET", url: downloadUrl });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("image/png");
    expect(dl.rawPayload.toString()).toBe("PNGDATA");
  });

  it("401 on a bad download signature", async () => {
    const app = makeApp(memStorage());
    const create = await app.inject({ method: "POST", url: "/files", headers: HDR, payload: { name: "a.bin" } });
    const { file } = create.json();
    const res = await app.inject({ method: "GET", url: `/files/${file.id}/download?sig=nope` });
    expect(res.statusCode).toBe(401);
  });
});
