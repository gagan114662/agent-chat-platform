import type { GtmConnector, GtmAction } from "./runner.js";
import { noopGtmConnector } from "./runner.js";

// The distribution rail for the GTM motion (#41). A real connector delivers an action
// (an email send, a CRM write, a Slack post, …) through the operator's Zapier endpoint
// — a Catch Hook / MCP action URL that triggers a Zap. Mirrors the Stripe pattern: the
// integration is built here; the operator provisions the URL (+ optional auth), and
// nothing physically sends until they do. No creds → noop (records intent, sends nothing).

export class ZapierConnector {
  constructor(private readonly url: string, private readonly auth?: string, private readonly fetchImpl: typeof fetch = fetch) {}

  deliver: GtmConnector = async (a: GtmAction) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.auth) headers["authorization"] = this.auth;
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      // A flat, Zap-friendly payload — Zapier maps these fields onto the chosen action.
      body: JSON.stringify({
        function: a.fn, skill: a.skill, action_kind: a.actionKind,
        summary: a.summary, audience_size: a.audienceSize, ...a.payload,
      }),
    });
    if (!res.ok) throw new Error(`zapier ${res.status}: ${(await res.text()).slice(0, 200)}`);
    // A delivered Zap reaches the intended audience; treat the hook acceptance as sent.
    return { sent: true, reach: a.audienceSize };
  };
}

// connectorFromEnv: the real Zapier connector when ZAPIER_MCP_URL is set, else the
// no-op. This is the default the GTM runner uses, so the autonomous motion goes live
// the moment the operator provisions the URL — no code change.
export function connectorFromEnv(): GtmConnector {
  const url = process.env.ZAPIER_MCP_URL;
  if (!url) return noopGtmConnector;
  return new ZapierConnector(url, process.env.ZAPIER_MCP_AUTH).deliver;
}
