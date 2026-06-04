import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { createSession, resolveSession, deleteSession, listMembersForLogin, verifyCredentials } from "./auth.js";
import { orgs, workspaces, members, sessions } from "../db/schema.js";
import { eq } from "drizzle-orm";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You" });
});

describe("auth", () => {
  it("creates a session and resolves it to the principal", async () => {
    const { token, member } = await createSession(h.db, "m1");
    expect(member.displayName).toBe("You");
    expect(token).toMatch(/[0-9a-f-]{36}/);
    expect(await resolveSession(h.db, token)).toEqual({ orgId: "o1", userId: "m1" });
  });
  it("rejects unknown member", async () => {
    await expect(createSession(h.db, "ghost")).rejects.toThrow(/member not found/);
  });
  it("does not resolve an unknown or expired token", async () => {
    expect(await resolveSession(h.db, "nope")).toBeUndefined();
    await h.db.insert(sessions).values({ id: "expired", memberId: "m1", orgId: "o1", expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveSession(h.db, "expired")).toBeUndefined();
  });
  it("deletes a session (logout)", async () => {
    const { token } = await createSession(h.db, "m1");
    await deleteSession(h.db, token);
    expect(await resolveSession(h.db, token)).toBeUndefined();
    expect((await h.db.select().from(sessions).where(eq(sessions.id, token))).length).toBe(0);
  });
  it("lists members for the login picker", async () => {
    expect((await listMembersForLogin(h.db)).map((m) => m.id)).toContain("m1");
  });
  it("verifyCredentials accepts the right password, rejects wrong / passwordless", async () => {
    const { hashPassword } = await import("./password.js");
    await h.db.update((await import("../db/schema.js")).members).set({ passwordHash: hashPassword("pw") }).where((await import("drizzle-orm")).eq((await import("../db/schema.js")).members.id, "m1"));
    expect(await verifyCredentials(h.db, "m1", "pw")).toBeTruthy();
    expect(await verifyCredentials(h.db, "m1", "nope")).toBeUndefined();
    await h.db.insert((await import("../db/schema.js")).members).values({ id: "np", orgId: "o1", workspaceId: "w1", displayName: "NoPw" });
    expect(await verifyCredentials(h.db, "np", "x")).toBeUndefined();
  });
});
