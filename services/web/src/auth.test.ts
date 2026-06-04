import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, me, logout, authHeaders, getToken } from "./auth.js";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("web auth", () => {
  it("authHeaders falls back to dev headers when no token", () => {
    expect(authHeaders()).toHaveProperty("x-org-id");
  });
  it("login stores the token and authHeaders then uses bearer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ token: "tok123", member: { orgId: "o1" } }) })) as unknown as typeof fetch);
    const p = await login("m1");
    expect(p).toEqual({ orgId: "o1", userId: "m1" });
    expect(getToken()).toBe("tok123");
    expect(authHeaders()).toEqual({ Authorization: "Bearer tok123" });
  });
  it("me returns null on 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, ok: false })) as unknown as typeof fetch);
    expect(await me()).toBeNull();
  });
  it("logout clears the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })) as unknown as typeof fetch);
    localStorage.setItem("acp_token", "x");
    await logout();
    expect(getToken()).toBeNull();
  });
});
