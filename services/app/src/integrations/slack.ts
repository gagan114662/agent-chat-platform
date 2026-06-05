// #100 Slack outbound integration — the first concrete cloud integration.
//
// Env-driven + injectable: `makeSlackClient(fetchImpl?)` builds a client that
// either POSTs to chat.postMessage (Bearer SLACK_BOT_TOKEN) or to an incoming
// webhook (SLACK_WEBHOOK_URL). The fetch is injectable so tests use a FAKE — no
// live Slack call. When neither env is set, `makeSlackClient` throws "slack not
// configured" (callers guard via `slackConfigured()` and skip rather than throw).

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

// Outbound Slack seam — narrowed to the one operation we need (post a message to
// a channel). Injectable so automation/alert callers and tests can swap a fake.
export interface SlackClient {
  postMessage(channel: string, text: string): Promise<void>;
}

// True when Slack is configured via either auth path. Callers use this to skip
// (best-effort/guarded) when Slack isn't set up, rather than constructing a
// client that would throw.
export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL);
}

// Real client. Prefers a bot token (chat.postMessage, Bearer) and falls back to
// an incoming webhook. Throws "slack not configured" when neither is set, so an
// unconfigured environment fails loud at construction (callers guard first).
// `fetchImpl` defaults to the global fetch; tests inject a fake.
export function makeSlackClient(fetchImpl: typeof fetch = fetch): SlackClient {
  const token = process.env.SLACK_BOT_TOKEN;
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!token && !webhook) throw new Error("slack not configured");

  return {
    async postMessage(channel: string, text: string): Promise<void> {
      const url = token ? SLACK_POST_MESSAGE_URL : (webhook as string);
      const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ channel, text }),
      });
      if (!res.ok) {
        throw new Error(`Slack API error: ${res.status}`);
      }
    },
  };
}

// Builds a Slack client from env. Injectable so automation/alert deps + tests can
// pass a fake (no live Slack); production uses makeSlackClient.
export type MakeSlack = () => SlackClient;
