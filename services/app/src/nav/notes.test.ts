import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces } from "../db/schema.js";
import { createNote, listNotes, getNote, updateNote, deleteNote } from "./notes.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values([
    { id: "wA", orgId: "oA", name: "WA" },
    { id: "wA2", orgId: "oA", name: "WA2" },
    { id: "wB", orgId: "oB", name: "WB" },
  ]);
});

describe("notes module", () => {
  it("createNote stores org+workspace scoped fields", async () => {
    const n = await createNote(h.db, {
      orgId: "oA", workspaceId: "wA", title: "T", body: "B", createdById: "mA",
    });
    expect(n.orgId).toBe("oA");
    expect(n.workspaceId).toBe("wA");
    expect(n.title).toBe("T");
    expect(n.body).toBe("B");
    expect(n.createdById).toBe("mA");
  });

  it("listNotes is org+workspace scoped", async () => {
    await createNote(h.db, { orgId: "oA", workspaceId: "wA", title: "a", body: "", createdById: "mA" });
    await createNote(h.db, { orgId: "oA", workspaceId: "wA2", title: "other-ws", body: "", createdById: "mA" });
    await createNote(h.db, { orgId: "oB", workspaceId: "wB", title: "other-org", body: "", createdById: "mB" });

    const wa = await listNotes(h.db, "oA", "wA");
    expect(wa.map((n) => n.title)).toEqual(["a"]);
  });

  it("getNote is org-scoped (cross-org → undefined)", async () => {
    const n = await createNote(h.db, { orgId: "oA", workspaceId: "wA", title: "a", body: "", createdById: "mA" });
    expect(await getNote(h.db, "oA", n.id)).toBeTruthy();
    expect(await getNote(h.db, "oB", n.id)).toBeUndefined();
  });

  it("updateNote patches title/body and bumps updatedAt (org-scoped)", async () => {
    const n = await createNote(h.db, { orgId: "oA", workspaceId: "wA", title: "a", body: "x", createdById: "mA" });
    const updated = await updateNote(h.db, "oA", n.id, { title: "a2", body: "y" });
    expect(updated?.title).toBe("a2");
    expect(updated?.body).toBe("y");
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(n.updatedAt.getTime());

    // cross-org update is a no-op
    expect(await updateNote(h.db, "oB", n.id, { title: "hacked" })).toBeUndefined();
    expect((await getNote(h.db, "oA", n.id))!.title).toBe("a2");
  });

  it("deleteNote is org-scoped (cross-org no-op)", async () => {
    const n = await createNote(h.db, { orgId: "oA", workspaceId: "wA", title: "a", body: "", createdById: "mA" });
    expect(await deleteNote(h.db, "oB", n.id)).toBe(false);
    expect(await getNote(h.db, "oA", n.id)).toBeTruthy();
    expect(await deleteNote(h.db, "oA", n.id)).toBe(true);
    expect(await getNote(h.db, "oA", n.id)).toBeUndefined();
  });
});
