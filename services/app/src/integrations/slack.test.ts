import { describe, it, expect, afterEach } from "vitest";
import { makeSlackClient, slackConfigured } from "./slack.js";

// No live Slack: every test injects a FAKE fetch and asserts on the captured call.
// We never set a real token — the test tokens are obvious fakes.

const SAVED = {
  token: process.env.SLACK_BOT_TOKEN,
  webhook: process.env.SLACK_WEBHOOK_URL,
};

afterEach(() => {
  // restore env so tests don't leak config into each other / other suites
  if (SAVED.token === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = SAVED.token;
  if (SAVED.webhook === undefined) delete process.env.SLACK_WEBHOOK_URL;
  else process.env.SLACK_WEBHOOK_URL = SAVED.webhook;
});

interface FakeCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(calls: FakeCall[], ok = true, status = 200): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return {
      ok,
      status,
      text: async () => (ok ? "ok" : "boom"),
      json: async () => ({ ok }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("makeSlackClient", () => {
  it("posts to chat.postMessage with Bearer auth + channel/text body when SLACK_BOT_TOKEN is set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-fake-token";
    delete process.env.SLACK_WEBHOOK_URL;
    const calls: FakeCall[] = [];
    const client = makeSlackClient(fakeFetch(calls));
    await client.postMessage("#general", "hello world");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer xoxb-fake-token");
    expect(headers["content-type"]).toContain("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ channel: "#general", text: "hello world" });
  });

  it("posts to the webhook URL with {channel,text} when only SLACK_WEBHOOK_URL is set", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/FAKE/HOOK";
    const calls: FakeCall[] = [];
    const client = makeSlackClient(fakeFetch(calls));
    await client.postMessage("#ops", "webhook hi");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hooks.slack.com/services/FAKE/HOOK");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ channel: "#ops", text: "webhook hi" });
  });

  it("prefers the bot token over the webhook when both are set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-fake-token";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/FAKE/HOOK";
    const calls: FakeCall[] = [];
    const client = makeSlackClient(fakeFetch(calls));
    await client.postMessage("#general", "hi");
    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
  });

  it("throws 'slack not configured' when neither token nor webhook is set", () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_WEBHOOK_URL;
    expect(() => makeSlackClient(fakeFetch([]))).toThrow("slack not configured");
  });

  it("throws on a non-ok Slack response", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-fake-token";
    delete process.env.SLACK_WEBHOOK_URL;
    const client = makeSlackClient(fakeFetch([], false, 500));
    await expect(client.postMessage("#general", "x")).rejects.toThrow(/Slack/);
  });
});

describe("slackConfigured", () => {
  it("is true when a bot token is set", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-fake-token";
    delete process.env.SLACK_WEBHOOK_URL;
    expect(slackConfigured()).toBe(true);
  });

  it("is true when a webhook url is set", () => {
    delete process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/FAKE/HOOK";
    expect(slackConfigured()).toBe(true);
  });

  it("is false when neither is set", () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_WEBHOOK_URL;
    expect(slackConfigured()).toBe(false);
  });
});
