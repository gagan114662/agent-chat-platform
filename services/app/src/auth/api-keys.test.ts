import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { issueApiKey, resolveApiKey, revokeApiKey, listApiKeys } from "./api-keys.js";
import { apiKeys, orgs, workspaces } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
});

describe("api keys (#83)", () => {
  it("issueApiKey returns a plaintext acp_ key ONCE and stores only the hash", async () => {
    const issued = await issueApiKey(h.db, { orgId: "o1", name: "ci", userId: "u1" });
    expect(issued.key).toMatch(/^acp_/);
    expect(issued.id).toBeTruthy();
    expect(issued.name).toBe("ci");

    // the stored row must NOT contain the plaintext key — only its sha256 hash
    const [row] = await h.db.select().from(apiKeys).where(eq(apiKeys.id, issued.id));
    expect(row.keyHash).not.toBe(issued.key);
    expect(row.keyHash).not.toContain(issued.key);
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(row.revoked).toBe(false);
  });

  it("resolveApiKey returns the principal (org + scopes) for a valid key", async () => {
    const issued = await issueApiKey(h.db, { orgId: "o1", name: "ci", scopes: { channels: ["c1"] }, userId: "u1" });
    const p = await resolveApiKey(h.db, issued.key);
    expect(p).toEqual({ orgId: "o1", userId: `apikey:${issued.id}`, scopes: { channels: ["c1"] } });
  });

  it("resolveApiKey returns undefined for an unknown key", async () => {
    await issueApiKey(h.db, { orgId: "o1", name: "ci", userId: "u1" });
    expect(await resolveApiKey(h.db, "acp_wrong")).toBeUndefined();
  });

  it("resolveApiKey best-effort stamps lastUsedAt", async () => {
    const issued = await issueApiKey(h.db, { orgId: "o1", name: "ci", userId: "u1" });
    await resolveApiKey(h.db, issued.key);
    const [row] = await h.db.select().from(apiKeys).where(eq(apiKeys.id, issued.id));
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("revokeApiKey kills resolution (revoked key → undefined)", async () => {
    const issued = await issueApiKey(h.db, { orgId: "o1", name: "ci", userId: "u1" });
    expect(await resolveApiKey(h.db, issued.key)).toBeDefined();
    await revokeApiKey(h.db, { orgId: "o1", id: issued.id });
    expect(await resolveApiKey(h.db, issued.key)).toBeUndefined();
  });

  it("revokeApiKey is org-scoped: a cross-org revoke does NOT revoke the key", async () => {
    const issued = await issueApiKey(h.db, { orgId: "o1", name: "ci", userId: "u1" });
    await revokeApiKey(h.db, { orgId: "o2", id: issued.id }); // wrong org — no-op
    expect(await resolveApiKey(h.db, issued.key)).toBeDefined();
  });

  it("listApiKeys is org-scoped and never includes the hash or any secret", async () => {
    const issued = await issueApiKey(h.db, { orgId: "o1", name: "ci", scopes: { x: 1 }, userId: "u1" });
    await issueApiKey(h.db, { orgId: "o2", name: "other", userId: "u2" });

    const list = await listApiKeys(h.db, "o1");
    expect(list.map((k) => k.id)).toEqual([issued.id]); // only o1's key
    const k = list[0];
    expect(k).toMatchObject({ id: issued.id, name: "ci", scopes: { x: 1 }, revoked: false });
    expect("keyHash" in k).toBe(false);
    expect(JSON.stringify(list)).not.toContain("key_hash");
    // no field carries the plaintext key
    expect(JSON.stringify(list)).not.toContain(issued.key);
  });
});
