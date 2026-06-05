import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerNotesRoutes } from "./notes-routes.js";
import { orgs, workspaces } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerNotesRoutes(app, { db: h.db });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values([
    { id: "wA", orgId: "oA", name: "WA" },
    { id: "wB", orgId: "oB", name: "WB" },
  ]);
});

describe("notes routes", () => {
  it("POST /notes creates, GET lists (org+workspace scoped)", async () => {
    const app = makeApp();
    const create = await app.inject({
      method: "POST", url: "/notes",
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
      payload: { workspaceId: "wA", title: "T", body: "B" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ workspaceId: "wA", title: "T", body: "B", createdById: "mA" });

    const list = await app.inject({
      method: "GET", url: "/notes?workspaceId=wA",
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    await app.close();
  });

  it("GET /notes for another org's workspace returns empty (no leak)", async () => {
    const app = makeApp();
    await app.inject({
      method: "POST", url: "/notes",
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
      payload: { workspaceId: "wA", title: "secret" },
    });
    const list = await app.inject({
      method: "GET", url: "/notes?workspaceId=wA",
      headers: { "x-org-id": "oB", "x-user-id": "mB" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
    await app.close();
  });

  it("PATCH /notes/:id updates (cross-org → 404)", async () => {
    const app = makeApp();
    const created = (await app.inject({
      method: "POST", url: "/notes",
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
      payload: { workspaceId: "wA", title: "T" },
    })).json();

    const cross = await app.inject({
      method: "PATCH", url: `/notes/${created.id}`,
      headers: { "x-org-id": "oB", "x-user-id": "mB" },
      payload: { title: "hacked" },
    });
    expect(cross.statusCode).toBe(404);

    const ok = await app.inject({
      method: "PATCH", url: `/notes/${created.id}`,
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
      payload: { title: "T2", body: "B2" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ title: "T2", body: "B2" });
    await app.close();
  });

  it("DELETE /notes/:id deletes (cross-org → 404, no delete)", async () => {
    const app = makeApp();
    const created = (await app.inject({
      method: "POST", url: "/notes",
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
      payload: { workspaceId: "wA", title: "T" },
    })).json();

    const cross = await app.inject({
      method: "DELETE", url: `/notes/${created.id}`,
      headers: { "x-org-id": "oB", "x-user-id": "mB" },
    });
    expect(cross.statusCode).toBe(404);

    const ok = await app.inject({
      method: "DELETE", url: `/notes/${created.id}`,
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
    });
    expect(ok.statusCode).toBe(204);

    // gone now
    const again = await app.inject({
      method: "DELETE", url: `/notes/${created.id}`,
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
    });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it("POST /notes requires workspaceId", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/notes",
      headers: { "x-org-id": "oA", "x-user-id": "mA" },
      payload: { title: "T" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
