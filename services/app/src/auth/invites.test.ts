import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { createInvite, acceptInvite, listInvites, revokeInvite, seatCount, seatLimit } from "./invites.js";
import { verifyPassword } from "./password.js";
import { invites, members, orgs, workspaces } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
});

describe("invites (#88)", () => {
  it("createInvite returns a plaintext inv_ token ONCE and stores only the hash", async () => {
    const { id, token } = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "a@x.io", byId: "adm" });
    expect(token).toMatch(/^inv_/);
    expect(id).toBeTruthy();

    const [row] = await h.db.select().from(invites).where(eq(invites.id, id));
    expect(row.status).toBe("pending");
    expect(row.email).toBe("a@x.io");
    expect(row.role).toBe("member"); // default
    // only the sha256 hex hash is stored, never the plaintext token
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("acceptInvite provisions a member with the invite's role/workspace and marks the invite accepted", async () => {
    const { id, token } = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "a@x.io", role: "admin", byId: "adm" });
    const member = await acceptInvite(h.db, { token, displayName: "Ada", password: "pw" });

    expect(member.orgId).toBe("o1");
    expect(member.workspaceId).toBe("w1");
    expect(member.role).toBe("admin");
    expect(member.displayName).toBe("Ada");
    // password was hashed (not stored plaintext), and verifies
    expect(member.passwordHash).toBeTruthy();
    expect(member.passwordHash).not.toBe("pw");
    expect(verifyPassword("pw", member.passwordHash!)).toBe(true);

    const [row] = await h.db.select().from(invites).where(eq(invites.id, id));
    expect(row.status).toBe("accepted");
    expect(row.acceptedMemberId).toBe(member.id);

    // the member really exists in the directory
    const [m] = await h.db.select().from(members).where(eq(members.id, member.id));
    expect(m).toBeTruthy();
  });

  it("acceptInvite works without a password (passwordHash null)", async () => {
    const { token } = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "a@x.io", byId: "adm" });
    const member = await acceptInvite(h.db, { token, displayName: "NoPw" });
    expect(member.passwordHash).toBeNull();
  });

  it("accepting twice fails (already accepted → invalid invite)", async () => {
    const { token } = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "a@x.io", byId: "adm" });
    await acceptInvite(h.db, { token, displayName: "Ada" });
    await expect(acceptInvite(h.db, { token, displayName: "Ada2" })).rejects.toThrow("invalid invite");
  });

  it("a revoked invite cannot be accepted", async () => {
    const { id, token } = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "a@x.io", byId: "adm" });
    await revokeInvite(h.db, { orgId: "o1", id });
    await expect(acceptInvite(h.db, { token, displayName: "Ada" })).rejects.toThrow("invalid invite");
  });

  it("an unknown token is an invalid invite", async () => {
    await expect(acceptInvite(h.db, { token: "inv_nope", displayName: "X" })).rejects.toThrow("invalid invite");
  });

  it("listInvites returns only pending invites for the org, with no token/hash", async () => {
    const pending = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "p@x.io", byId: "adm" });
    const accepted = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "acc@x.io", byId: "adm" });
    await acceptInvite(h.db, { token: accepted.token, displayName: "Acc" });
    const revoked = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "rev@x.io", byId: "adm" });
    await revokeInvite(h.db, { orgId: "o1", id: revoked.id });
    await createInvite(h.db, { orgId: "o2", workspaceId: "w2", email: "other@x.io", byId: "adm2" });

    const list = await listInvites(h.db, "o1");
    expect(list.map((i) => i.id)).toEqual([pending.id]); // only the org's pending invite
    expect(JSON.stringify(list)).not.toContain("tokenHash");
    expect(JSON.stringify(list)).not.toContain("token_hash");
    expect(JSON.stringify(list)).not.toContain(pending.token);
  });

  it("revokeInvite is org-scoped: a cross-org revoke is a no-op", async () => {
    const { id, token } = await createInvite(h.db, { orgId: "o1", workspaceId: "w1", email: "a@x.io", byId: "adm" });
    await revokeInvite(h.db, { orgId: "o2", id }); // wrong org — no-op
    // still pending → still acceptable
    const member = await acceptInvite(h.db, { token, displayName: "Ada" });
    expect(member.orgId).toBe("o1");
  });

  it("seatCount counts members in the org; seatLimit reads ACP_SEAT_LIMIT", async () => {
    expect(await seatCount(h.db, "o1")).toBe(0);
    await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "One" });
    await h.db.insert(members).values({ id: "m2", orgId: "o2", workspaceId: "w2", displayName: "Two" });
    expect(await seatCount(h.db, "o1")).toBe(1);

    const prev = process.env.ACP_SEAT_LIMIT;
    try {
      process.env.ACP_SEAT_LIMIT = "0";
      expect(seatLimit()).toBe(0);
      delete process.env.ACP_SEAT_LIMIT;
      expect(seatLimit()).toBeGreaterThan(1000);
    } finally {
      if (prev === undefined) delete process.env.ACP_SEAT_LIMIT;
      else process.env.ACP_SEAT_LIMIT = prev;
    }
  });
});
