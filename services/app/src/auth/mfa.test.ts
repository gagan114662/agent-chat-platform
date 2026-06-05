import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { enrollMfa, confirmMfa, disableMfa, mfaRequired } from "./mfa.js";
import { totpCode } from "./totp.js";
import { members, orgs, workspaces } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You", email: "you@x.io" });
});

describe("mfa (#84)", () => {
  it("enrollMfa sets a secret but does NOT enable MFA yet", async () => {
    const { secret, uri } = await enrollMfa(h.db, { orgId: "o1", memberId: "m1" });
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(secret);

    const [m] = await h.db.select().from(members).where(eq(members.id, "m1"));
    expect(m.totpSecret).toBe(secret);
    expect(m.mfaEnabled).toBe(false);
    expect(await mfaRequired(h.db, "m1")).toBe(false);
  });

  it("confirmMfa with a valid code enables MFA", async () => {
    const { secret } = await enrollMfa(h.db, { orgId: "o1", memberId: "m1" });
    const code = totpCode(secret);
    await confirmMfa(h.db, { orgId: "o1", memberId: "m1", code });

    const [m] = await h.db.select().from(members).where(eq(members.id, "m1"));
    expect(m.mfaEnabled).toBe(true);
    expect(await mfaRequired(h.db, "m1")).toBe(true);
  });

  it("confirmMfa with a bad code throws and leaves MFA disabled", async () => {
    const { secret } = await enrollMfa(h.db, { orgId: "o1", memberId: "m1" });
    const good = totpCode(secret);
    const bad = good === "000000" ? "111111" : "000000";
    await expect(confirmMfa(h.db, { orgId: "o1", memberId: "m1", code: bad })).rejects.toThrow("invalid code");

    const [m] = await h.db.select().from(members).where(eq(members.id, "m1"));
    expect(m.mfaEnabled).toBe(false);
  });

  it("confirmMfa before enroll (no secret) throws invalid code", async () => {
    await expect(confirmMfa(h.db, { orgId: "o1", memberId: "m1", code: "123456" })).rejects.toThrow("invalid code");
  });

  it("disableMfa clears the secret and the flag", async () => {
    const { secret } = await enrollMfa(h.db, { orgId: "o1", memberId: "m1" });
    await confirmMfa(h.db, { orgId: "o1", memberId: "m1", code: totpCode(secret) });
    await disableMfa(h.db, { orgId: "o1", memberId: "m1" });

    const [m] = await h.db.select().from(members).where(eq(members.id, "m1"));
    expect(m.mfaEnabled).toBe(false);
    expect(m.totpSecret).toBeNull();
    expect(await mfaRequired(h.db, "m1")).toBe(false);
  });

  it("is org-scoped: a foreign org cannot enroll/confirm another org's member", async () => {
    await expect(enrollMfa(h.db, { orgId: "other", memberId: "m1" })).rejects.toThrow("member not found");
  });
});
