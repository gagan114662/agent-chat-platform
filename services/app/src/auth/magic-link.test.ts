import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { requestMagicLink, verifyMagicLink } from "./magic-link.js";
import { resolveSession } from "./auth.js";
import { magicLinks, members, orgs, workspaces } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You", email: "you@x.io" });
});

describe("magic-link (#84)", () => {
  it("requestMagicLink returns an ml_ token ONCE and stores only the hash", async () => {
    const { token } = await requestMagicLink(h.db, { email: "you@x.io" });
    expect(token).toMatch(/^ml_/);

    const [row] = await h.db.select().from(magicLinks).where(eq(magicLinks.memberId, "m1"));
    expect(row).toBeTruthy();
    expect(row.usedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // only the sha256 hex hash is stored — never the plaintext token
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requestMagicLink for an unknown email is a no-op (no row, no token) — no enumeration", async () => {
    const res = await requestMagicLink(h.db, { email: "ghost@x.io" });
    expect(res.token).toBeUndefined();
    const rows = await h.db.select().from(magicLinks);
    expect(rows.length).toBe(0);
  });

  it("verifyMagicLink consumes the token, returns a session + member, and is single-use", async () => {
    const { token } = await requestMagicLink(h.db, { email: "you@x.io" });
    const { token: sessionToken, member } = await verifyMagicLink(h.db, { token: token! });
    expect(member.id).toBe("m1");
    expect(sessionToken).toBeTruthy();

    // the returned token is a real, resolvable session
    const principal = await resolveSession(h.db, sessionToken);
    expect(principal).toEqual({ orgId: "o1", userId: "m1" });

    // the magic-link is now marked used
    const [row] = await h.db.select().from(magicLinks).where(eq(magicLinks.memberId, "m1"));
    expect(row.usedAt).not.toBeNull();

    // single-use: a second verify with the same token fails
    await expect(verifyMagicLink(h.db, { token: token! })).rejects.toThrow("invalid or expired");
  });

  it("an expired token is invalid (verify against a clock past expiry)", async () => {
    const { token } = await requestMagicLink(h.db, { email: "you@x.io" });
    const future = Date.now() + 16 * 60 * 1000; // 16 minutes later — past the 15min TTL
    await expect(verifyMagicLink(h.db, { token: token!, now: future })).rejects.toThrow("invalid or expired");
  });

  it("an unknown token is invalid", async () => {
    await expect(verifyMagicLink(h.db, { token: "ml_nope" })).rejects.toThrow("invalid or expired");
  });
});
