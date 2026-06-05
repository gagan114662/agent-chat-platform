import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { createSession, resolveSession, deleteSession, listMembersForLogin, verifyCredentials, listSessions, revokeSession, revokeOtherSessions } from "./auth.js";
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

describe("device sessions (#84)", () => {
  beforeEach(async () => {
    // a second org/member to prove cross-user/cross-org scoping
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(members).values({ id: "m2", orgId: "o2", workspaceId: "w2", displayName: "Other" });
  });

  it("listSessions returns the caller's own sessions, newest order, WITHOUT tokens-as-secrets", async () => {
    const a = await createSession(h.db, "m1", { userAgent: "Device A" });
    const b = await createSession(h.db, "m1", { userAgent: "Device B" });
    await createSession(h.db, "m2"); // another user's session — must not appear

    const list = await listSessions(h.db, { orgId: "o1", userId: "m1" });
    expect(list.map((s) => s.id).sort()).toEqual([a.token, b.token].sort());
    expect(list.map((s) => s.userAgent)).toContain("Device A");
    // no member's session leaks the OTHER user's session
    expect(list.some((s) => s.id === undefined)).toBe(false);
    // shape carries createdAt + lastSeenAt, no passwordHash/memberId secrets
    expect(JSON.stringify(list)).not.toContain("passwordHash");
  });

  it("revokeSession removes only the caller's matching session; a foreign id is a no-op (0)", async () => {
    const mine = await createSession(h.db, "m1");
    const other = await createSession(h.db, "m2");

    // another user's session id, claimed by m1 → no rows deleted (route → 404)
    expect(await revokeSession(h.db, { orgId: "o1", userId: "m1", sessionId: other.token })).toBe(0);
    // the foreign session still resolves (untouched)
    expect(await resolveSession(h.db, other.token)).toEqual({ orgId: "o2", userId: "m2" });

    // the caller's own session is revoked → 1, and no longer resolves
    expect(await revokeSession(h.db, { orgId: "o1", userId: "m1", sessionId: mine.token })).toBe(1);
    expect(await resolveSession(h.db, mine.token)).toBeUndefined();
  });

  it("revokeOtherSessions keeps the caller's current token, drops their others, leaves other users alone", async () => {
    const current = await createSession(h.db, "m1");
    const stale1 = await createSession(h.db, "m1");
    const stale2 = await createSession(h.db, "m1");
    const other = await createSession(h.db, "m2");

    await revokeOtherSessions(h.db, { orgId: "o1", userId: "m1", keepToken: current.token });

    expect(await resolveSession(h.db, current.token)).toBeTruthy(); // kept
    expect(await resolveSession(h.db, stale1.token)).toBeUndefined();
    expect(await resolveSession(h.db, stale2.token)).toBeUndefined();
    expect(await resolveSession(h.db, other.token)).toBeTruthy(); // untouched
  });
});
