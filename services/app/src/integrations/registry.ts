// #100 integration registry — a small catalog of the cloud integrations and
// their config status. Slack is the one concrete outbound integration today;
// gmail/google-workspace/hubspot are scaffolds that share the same Integration
// shape (each reads its own creds, default false) and are documented in
// docs/integrations/cloud-integrations.md.
//
// `tier` is the action-risk tier (#97): money/irreversible actions route through
// the approval gate (#16/#21) and the tiering model before they execute.

import { slackConfigured } from "./slack.js";

// Action-risk tier for an integration's outbound actions.
//   - "notify": low-risk notifications (post a message). No approval needed.
//   - "action": mutating/irreversible/money actions → approval gate + tiering.
export type IntegrationTier = "notify" | "action";

// One cloud integration in the catalog.
export interface Integration {
  name: string;
  // Reads the integration's own env creds. Default false for scaffolds.
  configured(): boolean;
  tier: IntegrationTier;
}

// The reported status of one integration.
export interface IntegrationStatus {
  name: string;
  configured: boolean;
  status: "configured" | "needs credentials";
  tier: IntegrationTier;
}

// The catalog. Slack is concrete (outbound post → "notify"). The others are
// scaffolds for follow-up wiring; each reads its own creds and is "action"-tier
// because their real operations (send mail, create deal, edit a doc) are mutating
// and route through the approval gate.
export const integrationRegistry: Integration[] = [
  { name: "slack", configured: slackConfigured, tier: "notify" },
  {
    name: "gmail",
    // Gmail send/read needs Google OAuth creds (follow-up wiring).
    configured: () => Boolean(process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID),
    tier: "action",
  },
  {
    name: "google-workspace",
    // Drive/Calendar scopes on the same Google OAuth app.
    configured: () => Boolean(process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID),
    tier: "action",
  },
  {
    name: "hubspot",
    configured: () => Boolean(process.env.HUBSPOT_TOKEN),
    tier: "action",
  },
];

// listIntegrations → the status of each integration (configured or
// "needs credentials"). Pure read of the env via each entry's configured().
export function listIntegrations(): IntegrationStatus[] {
  return integrationRegistry.map((i) => {
    const configured = i.configured();
    return {
      name: i.name,
      configured,
      status: configured ? "configured" : "needs credentials",
      tier: i.tier,
    };
  });
}
