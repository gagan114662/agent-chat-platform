import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { googleAuthUrl, handleGoogleCallback } from "./google-sso.js";
import { resolveSession } from "./auth.js";
import { members, orgs, workspaces } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
});

describe("google-sso (#84)", () => {
  it("googleAuthUrl builds the OAuth URL with client_id/redirect/scope/state", () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevRedirect = process.env.GOOGLE_REDIRECT_URI;
    process.env.GOOGLE_CLIENT_ID = "cid-123";
    process.env.GOOGLE_REDIRECT_URI = "https://app.example.com/auth/google/callback";
    try {
      const url = googleAuthUrl("state-xyz");
      expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
      expect(url).toContain("client_id=cid-123");
      expect(url).toContain(encodeURIComponent("https://app.example.com/auth/google/callback"));
      // URLSearchParams encodes spaces as '+'
      expect(url).toContain("scope=openid+email+profile");
      expect(url).toContain("response_type=code");
      expect(url).toContain("state=state-xyz");
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = prevId;
      if (prevRedirect === undefined) delete process.env.GOOGLE_REDIRECT_URI; else process.env.GOOGLE_REDIRECT_URI = prevRedirect;
    }
  });

  it("googleAuthUrl throws when GOOGLE_CLIENT_ID is unset", () => {
    const prev = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      expect(() => googleAuthUrl("s")).toThrow(/GOOGLE_CLIENT_ID/);
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CLIENT_ID = prev;
    }
  });

  it("handleGoogleCallback creates a member + session via an injected exchange (no live call)", async () => {
    const prevOrg = process.env.GOOGLE_SSO_ORG_ID;
    const prevWs = process.env.GOOGLE_SSO_WORKSPACE_ID;
    process.env.GOOGLE_SSO_ORG_ID = "o1";
    process.env.GOOGLE_SSO_WORKSPACE_ID = "w1";
    try {
      let called = false;
      const exchange = async (code: string) => { called = true; expect(code).toBe("auth-code"); return { email: "you@e.com" }; };
      const { token, member } = await handleGoogleCallback(h.db, { code: "auth-code", exchange });
      expect(called).toBe(true);
      expect(member.email).toBe("you@e.com");
      expect(member.orgId).toBe("o1");
      expect(member.workspaceId).toBe("w1");

      // a real, resolvable session was issued
      const principal = await resolveSession(h.db, token);
      expect(principal).toEqual({ orgId: "o1", userId: member.id });

      // exactly one member row for that email
      const rows = await h.db.select().from(members).where(eq(members.email, "you@e.com"));
      expect(rows.length).toBe(1);
    } finally {
      if (prevOrg === undefined) delete process.env.GOOGLE_SSO_ORG_ID; else process.env.GOOGLE_SSO_ORG_ID = prevOrg;
      if (prevWs === undefined) delete process.env.GOOGLE_SSO_WORKSPACE_ID; else process.env.GOOGLE_SSO_WORKSPACE_ID = prevWs;
    }
  });

  it("handleGoogleCallback finds an existing member by email (no duplicate)", async () => {
    process.env.GOOGLE_SSO_ORG_ID = "o1";
    process.env.GOOGLE_SSO_WORKSPACE_ID = "w1";
    try {
      await h.db.insert(members).values({ id: "existing", orgId: "o1", workspaceId: "w1", displayName: "Old", email: "you@e.com" });
      const exchange = async () => ({ email: "you@e.com" });
      const { member } = await handleGoogleCallback(h.db, { code: "c", exchange });
      expect(member.id).toBe("existing");
      const rows = await h.db.select().from(members).where(eq(members.email, "you@e.com"));
      expect(rows.length).toBe(1);
    } finally {
      delete process.env.GOOGLE_SSO_ORG_ID;
      delete process.env.GOOGLE_SSO_WORKSPACE_ID;
    }
  });
});
