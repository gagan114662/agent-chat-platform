import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerToolsRoutes } from "./tools-routes.js";
import { orgs, workspaces, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerToolsRoutes(app, { db: h.db });
  return app;
}

// mAdmin is an admin (team:manage); mMember is a plain member (no team:manage).
// apikey:k1 is an api-key principal (#83) — allowed to create/edit.
const ADMIN = { "x-org-id": "oA", "x-user-id": "mAdmin" };
const MEMBER = { "x-org-id": "oA", "x-user-id": "mMember" };
const APIKEY = { "x-org-id": "oA", "x-user-id": "apikey:k1" };
const OTHER_ORG = { "x-org-id": "oB", "x-user-id": "mAdminB" };

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values([
    { id: "wA", orgId: "oA", name: "WA" },
    { id: "wB", orgId: "oB", name: "WB" },
  ]);
  await h.db.insert(members).values([
    { id: "mAdmin", orgId: "oA", workspaceId: "wA", displayName: "Admin", role: "admin" },
    { id: "mMember", orgId: "oA", workspaceId: "wA", displayName: "Member", role: "member" },
    { id: "mAdminB", orgId: "oB", workspaceId: "wB", displayName: "AdminB", role: "admin" },
  ]);
});

describe("tools routes", () => {
  it("POST /tools (admin) creates an unpublished tool, GET lists it", async () => {
    const app = makeApp();
    const create = await app.inject({
      method: "POST", url: "/tools", headers: ADMIN,
      payload: { workspaceId: "wA", name: "Dash", kind: "dashboard", content: "<p>hi</p>" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      name: "Dash", kind: "dashboard", content: "<p>hi</p>", published: false,
      createdByKind: "human", createdById: "mAdmin",
    });

    const list = await app.inject({
      method: "GET", url: "/tools?workspaceId=wA", headers: ADMIN,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    await app.close();
  });

  it("POST /tools via an api-key principal is allowed", async () => {
    const app = makeApp();
    const create = await app.inject({
      method: "POST", url: "/tools", headers: APIKEY,
      payload: { workspaceId: "wA", name: "AgentTool", content: "<p>x</p>" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ createdByKind: "apikey", createdById: "apikey:k1" });
    await app.close();
  });

  it("POST /tools by a non-admin human → 403", async () => {
    const app = makeApp();
    const create = await app.inject({
      method: "POST", url: "/tools", headers: MEMBER,
      payload: { workspaceId: "wA", name: "X", content: "x" },
    });
    expect(create.statusCode).toBe(403);
    await app.close();
  });

  it("publish flips the flag; list hides drafts when publishedOnly=1", async () => {
    const app = makeApp();
    const draft = (await app.inject({
      method: "POST", url: "/tools", headers: ADMIN,
      payload: { workspaceId: "wA", name: "Draft", content: "x" },
    })).json();
    const live = (await app.inject({
      method: "POST", url: "/tools", headers: ADMIN,
      payload: { workspaceId: "wA", name: "Live", content: "x" },
    })).json();

    const pub = await app.inject({
      method: "POST", url: `/tools/${live.id}/publish`, headers: ADMIN,
      payload: { published: true },
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ published: true });

    const all = await app.inject({ method: "GET", url: "/tools?workspaceId=wA", headers: ADMIN });
    expect(all.json()).toHaveLength(2);

    const onlyPub = await app.inject({
      method: "GET", url: "/tools?workspaceId=wA&publishedOnly=1", headers: ADMIN,
    });
    expect(onlyPub.json()).toHaveLength(1);
    expect(onlyPub.json()[0].id).toBe(live.id);
    expect(draft.published).toBe(false);
    await app.close();
  });

  it("GET /tools/:id returns the tool incl. content; PATCH edits it", async () => {
    const app = makeApp();
    const t = (await app.inject({
      method: "POST", url: "/tools", headers: ADMIN,
      payload: { workspaceId: "wA", name: "P", content: "old" },
    })).json();

    const get = await app.inject({ method: "GET", url: `/tools/${t.id}`, headers: ADMIN });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ content: "old" });

    const patch = await app.inject({
      method: "PATCH", url: `/tools/${t.id}`, headers: ADMIN,
      payload: { content: "new", name: "P2" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ content: "new", name: "P2" });
    await app.close();
  });

  it("cross-org access is invisible (404 / empty)", async () => {
    const app = makeApp();
    const t = (await app.inject({
      method: "POST", url: "/tools", headers: ADMIN,
      payload: { workspaceId: "wA", name: "Secret", content: "x" },
    })).json();

    // another org cannot GET it
    expect((await app.inject({ method: "GET", url: `/tools/${t.id}`, headers: OTHER_ORG })).statusCode).toBe(404);
    // cannot PATCH it
    expect((await app.inject({
      method: "PATCH", url: `/tools/${t.id}`, headers: OTHER_ORG, payload: { content: "hacked" },
    })).statusCode).toBe(404);
    // cannot publish it
    expect((await app.inject({
      method: "POST", url: `/tools/${t.id}/publish`, headers: OTHER_ORG, payload: { published: true },
    })).statusCode).toBe(404);
    // cannot delete it
    expect((await app.inject({ method: "DELETE", url: `/tools/${t.id}`, headers: OTHER_ORG })).statusCode).toBe(404);
    // listing for the same workspace id under another org yields nothing
    expect((await app.inject({ method: "GET", url: "/tools?workspaceId=wA", headers: OTHER_ORG })).json()).toEqual([]);
    await app.close();
  });

  it("DELETE /tools/:id removes the tool", async () => {
    const app = makeApp();
    const t = (await app.inject({
      method: "POST", url: "/tools", headers: ADMIN,
      payload: { workspaceId: "wA", name: "P", content: "x" },
    })).json();
    expect((await app.inject({ method: "DELETE", url: `/tools/${t.id}`, headers: ADMIN })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/tools/${t.id}`, headers: ADMIN })).statusCode).toBe(404);
    await app.close();
  });

  it("POST /tools requires workspaceId and name", async () => {
    const app = makeApp();
    expect((await app.inject({
      method: "POST", url: "/tools", headers: ADMIN, payload: { name: "X", content: "x" },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "POST", url: "/tools", headers: ADMIN, payload: { workspaceId: "wA", content: "x" },
    })).statusCode).toBe(400);
    await app.close();
  });
});
