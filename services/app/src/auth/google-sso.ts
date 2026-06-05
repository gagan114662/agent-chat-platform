import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { members } from "../db/schema.js";
import { createSession } from "./auth.js";

// #84 Google SSO — OAuth redirect + callback. Env-driven; the token exchange is
// INJECTABLE so the flow is fully unit-tested offline (no live Google call). The
// live exchange + redirect URI need the deploy URL + Google creds (#103) — see
// docs/integrations/google-sso.md.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// The injected token exchanger: trades the OAuth `code` for the verified email.
export type GoogleExchange = (code: string) => Promise<{ email: string }>;

// googleAuthUrl builds the consent-screen redirect URL. Throws if GOOGLE_CLIENT_ID
// is unset (the route surfaces this as a 400 "sso not configured").
export function googleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// defaultExchange POSTs the code to Google's token endpoint with the client
// secret, then decodes the returned id_token (a JWT) to read the verified email.
// Used only in production — tests inject a fake exchange so no live call is made.
const defaultExchange: GoogleExchange = async (code) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret) throw new Error("Google SSO not configured");
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("no id_token in google response");
  // Decode the JWT payload (middle segment) — base64url JSON — to read the email.
  const payload = JSON.parse(Buffer.from(json.id_token.split(".")[1], "base64url").toString("utf8")) as { email?: string };
  if (!payload.email) throw new Error("no email in id_token");
  return { email: payload.email.trim().toLowerCase() };
};

// handleGoogleCallback runs the exchange (injectable; defaults to the live Google
// call), resolves a member by email — find-or-create within the configured
// default org/workspace (GOOGLE_SSO_ORG_ID / GOOGLE_SSO_WORKSPACE_ID) — and issues
// a session. Returns { token, member }.
export async function handleGoogleCallback(
  db: DB,
  i: { code: string; exchange?: GoogleExchange; userAgent?: string },
): Promise<{ token: string; member: typeof members.$inferSelect }> {
  const exchange = i.exchange ?? defaultExchange;
  const { email: rawEmail } = await exchange(i.code);
  const email = rawEmail.trim().toLowerCase();
  if (!email) throw new Error("no email from google");

  const orgId = process.env.GOOGLE_SSO_ORG_ID;
  const workspaceId = process.env.GOOGLE_SSO_WORKSPACE_ID;
  if (!orgId || !workspaceId) throw new Error("GOOGLE_SSO_ORG_ID/WORKSPACE_ID not configured");

  let [member] = await db.select().from(members).where(eq(members.email, email));
  if (!member) {
    const id = randomUUID();
    [member] = await db.insert(members).values({
      id,
      orgId,
      workspaceId,
      displayName: email,
      email,
    }).returning();
  }

  const { token } = await createSession(db, member.id, { userAgent: i.userAgent });
  return { token, member };
}
