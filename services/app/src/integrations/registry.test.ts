import { describe, it, expect, afterEach } from "vitest";
import { listIntegrations, integrationRegistry } from "./registry.js";

// Snapshot + restore the env each integration reads, so tests don't leak config.
const ENV_KEYS = [
  "SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL",
  "GMAIL_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_WORKSPACE_OAUTH_CLIENT_ID",
  "HUBSPOT_TOKEN",
] as const;
const SAVED: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) SAVED[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

function clearAll() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("integration registry", () => {
  it("catalogs slack, gmail, google-workspace and hubspot", () => {
    const names = integrationRegistry.map((i) => i.name).sort();
    expect(names).toEqual(["gmail", "google-workspace", "hubspot", "slack"]);
  });

  it("reports slack configured (env set) vs the scaffolds as 'needs credentials'", () => {
    clearAll();
    process.env.SLACK_BOT_TOKEN = "xoxb-fake-token";
    const list = listIntegrations();
    const byName = Object.fromEntries(list.map((i) => [i.name, i]));

    expect(byName["slack"].configured).toBe(true);
    expect(byName["slack"].status).toBe("configured");

    for (const name of ["gmail", "google-workspace", "hubspot"]) {
      expect(byName[name].configured).toBe(false);
      expect(byName[name].status).toBe("needs credentials");
    }
  });

  it("slack is also configured via the webhook env", () => {
    clearAll();
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/FAKE/HOOK";
    const byName = Object.fromEntries(listIntegrations().map((i) => [i.name, i]));
    expect(byName["slack"].configured).toBe(true);
  });

  it("reports everything 'needs credentials' when no env is set", () => {
    clearAll();
    const list = listIntegrations();
    expect(list.every((i) => i.configured === false && i.status === "needs credentials")).toBe(true);
  });

  it("each entry carries a tier", () => {
    for (const i of listIntegrations()) {
      expect(typeof i.tier).toBe("string");
      expect(i.tier.length).toBeGreaterThan(0);
    }
  });
});
