import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import {
  createTool, listTools, getTool, updateTool, publishTool, deleteTool,
} from "./tools.js";
import { orgs, workspaces } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values([
    { id: "wA", orgId: "oA", name: "WA" },
    { id: "wB", orgId: "oB", name: "WB" },
  ]);
});

describe("tools model + CRUD", () => {
  it("createTool inserts an unpublished tool", async () => {
    const t = await createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "Dash", kind: "dashboard",
      content: "<p>hi</p>", byKind: "human", byId: "mA",
    });
    expect(t).toMatchObject({
      orgId: "oA", workspaceId: "wA", name: "Dash", kind: "dashboard",
      content: "<p>hi</p>", published: false, createdByKind: "human", createdById: "mA",
    });
    expect(t.id).toBeTruthy();
  });

  it("createTool defaults kind to page and validates kind", async () => {
    const t = await createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "P", content: "x", byKind: "human", byId: "mA",
    });
    expect(t.kind).toBe("page");

    await expect(createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "Bad", kind: "evil",
      content: "x", byKind: "human", byId: "mA",
    })).rejects.toThrow(/kind/);
  });

  it("updateTool patches content/name/kind", async () => {
    const t = await createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "P", content: "old", byKind: "human", byId: "mA",
    });
    const u = await updateTool(h.db, { orgId: "oA", id: t.id, content: "new", name: "P2" });
    expect(u).toMatchObject({ content: "new", name: "P2" });
    // invalid kind on update rejected
    await expect(updateTool(h.db, { orgId: "oA", id: t.id, kind: "nope" }))
      .rejects.toThrow(/kind/);
  });

  it("publishTool flips the published flag", async () => {
    const t = await createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "P", content: "x", byKind: "human", byId: "mA",
    });
    const pub = await publishTool(h.db, { orgId: "oA", id: t.id, published: true });
    expect(pub?.published).toBe(true);
    const unp = await publishTool(h.db, { orgId: "oA", id: t.id, published: false });
    expect(unp?.published).toBe(false);
  });

  it("listTools(publishedOnly) excludes drafts", async () => {
    const draft = await createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "Draft", content: "x", byKind: "human", byId: "mA",
    });
    const live = await createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "Live", content: "x", byKind: "human", byId: "mA",
    });
    await publishTool(h.db, { orgId: "oA", id: live.id, published: true });

    const all = await listTools(h.db, "oA", { workspaceId: "wA" });
    expect(all).toHaveLength(2);

    const pub = await listTools(h.db, "oA", { workspaceId: "wA", publishedOnly: true });
    expect(pub).toHaveLength(1);
    expect(pub[0].id).toBe(live.id);
    expect(draft.published).toBe(false);
  });

  it("is org-scoped: org-B cannot see/get/edit org-A tools", async () => {
    const t = await createTool(h.db, {
      orgId: "oA", workspaceId: "wA", name: "Secret", content: "x", byKind: "human", byId: "mA",
    });
    // listing for oB's workspace yields nothing
    expect(await listTools(h.db, "oB", { workspaceId: "wA" })).toEqual([]);
    // get with wrong org → undefined
    expect(await getTool(h.db, "oB", t.id)).toBeUndefined();
    // update with wrong org → undefined (no write)
    expect(await updateTool(h.db, { orgId: "oB", id: t.id, content: "hacked" })).toBeUndefined();
    // still intact under oA
    expect((await getTool(h.db, "oA", t.id))?.content).toBe("x");
    // delete with wrong org → false
    expect(await deleteTool(h.db, "oB", t.id)).toBe(false);
    expect(await deleteTool(h.db, "oA", t.id)).toBe(true);
    expect(await getTool(h.db, "oA", t.id)).toBeUndefined();
  });
});
