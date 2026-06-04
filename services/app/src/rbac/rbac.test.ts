import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { can, roleOf, type Action } from "./rbac.js";
import { orgs, workspaces, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "adm", orgId: "o1", workspaceId: "w1", displayName: "Admin", role: "admin" });
  await h.db.insert(members).values({ id: "reg", orgId: "o1", workspaceId: "w1", displayName: "Reg", role: "member" });
});

describe("rbac", () => {
  it("admin can do everything; member cannot create channels", () => {
    const actions: Action[] = ["channel:create", "thread:create", "message:post", "dm:start"];
    for (const a of actions) expect(can("admin", a)).toBe(true);
    expect(can("member", "channel:create")).toBe(false);
    expect(can("member", "thread:create")).toBe(true);
    expect(can("member", "message:post")).toBe(true);
  });

  it("admin retains every prior capability plus the new ones (backward-compat)", () => {
    const adminActions: Action[] = [
      "channel:create", "channel:delete", "thread:create", "message:post", "dm:start",
      "agent:share", "memory:write:org",
    ];
    for (const a of adminActions) expect(can("admin", a)).toBe(true);
  });

  it("viewer is read-only — denied on every write action", () => {
    const writes: Action[] = ["channel:create", "thread:create", "message:post", "dm:start", "agent:share", "memory:write:org"];
    for (const a of writes) expect(can("viewer", a)).toBe(false);
  });

  it("member matrix: writes yes, channel/agent/org-memory no", () => {
    expect(can("member", "message:post")).toBe(true);
    expect(can("member", "thread:create")).toBe(true);
    expect(can("member", "dm:start")).toBe(true);
    expect(can("member", "channel:create")).toBe(false);
    expect(can("member", "agent:share")).toBe(false);
    expect(can("member", "memory:write:org")).toBe(false);
    expect(can("admin", "memory:write:org")).toBe(true);
  });
  it("roleOf reads the member role, defaults to member for unknown", async () => {
    expect(await roleOf(h.db, "adm", "o1")).toBe("admin");
    expect(await roleOf(h.db, "reg", "o1")).toBe("member");
    expect(await roleOf(h.db, "ghost", "o1")).toBe("member");
  });

  it("roleOf does not read a member from another org (cross-tenant IDOR)", async () => {
    // org B reads org A's admin id → must NOT be granted admin; defaults to member
    expect(await roleOf(h.db, "adm", "o2")).toBe("member");
  });
});
