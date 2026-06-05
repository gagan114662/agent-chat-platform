# Cloud integrations (#100)

Outbound cloud integrations let automations (#98) and autonomous alerts (#93)
reach external services. **Slack** is the first concrete integration; Gmail,
Google Workspace and HubSpot are scaffolded to the same shape and ship behind
their own credentials.

## The `Integration` shape

Every cloud integration is env-driven and injectable:

- A small **client interface** narrowed to the operations we use
  (e.g. Slack's `SlackClient.postMessage(channel, text)`).
- A **`make*Client(fetchImpl?)`** factory that reads the integration's env creds
  and builds the real client. The `fetch` is injectable so tests use a fake — we
  never make a live call in tests.
- A **`configured()`** helper that reports whether the creds are present.

Integrations are listed in the **registry** (`src/integrations/registry.ts`).
`listIntegrations()` returns each integration's status (`configured` or
`needs credentials`) plus its action-risk **tier**. `GET /integrations` exposes
the status (authed/org-scoped).

### Tiering + the approval gate

Each integration carries a `tier`:

- `notify` — low-risk notifications (post a Slack message). No approval needed.
- `action` — mutating, irreversible, or money-moving actions (send an email,
  create a HubSpot deal, edit a Drive doc). These route through the **approval
  gate (#16/#21)** and the **action tiering** model (#97) before they execute.

## Required credentials

| Integration        | Env var(s)                                                        | Status today |
|--------------------|-------------------------------------------------------------------|--------------|
| **Slack**          | `SLACK_BOT_TOKEN` (preferred) **or** `SLACK_WEBHOOK_URL`           | Implemented (outbound post) |
| **Gmail**          | `GOOGLE_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_ID` (+ OAuth secret/refresh) | Scaffold |
| **Google Workspace** | `GOOGLE_WORKSPACE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_ID` (Drive/Calendar scopes) | Scaffold |
| **HubSpot**        | `HUBSPOT_TOKEN`                                                    | Scaffold |

Unconfigured integrations are reported as **"needs credentials"** by the
registry and are skipped (never throw) by the automation/alert callers.

## Slack

### Configuration

Set **either**:

- `SLACK_BOT_TOKEN` — a bot token (`xoxb-…`). Posts via
  `https://slack.com/api/chat.postMessage` with a `Bearer` header.
- `SLACK_WEBHOOK_URL` — an incoming-webhook URL. Posts the `{channel, text}`
  payload to the webhook.

If both are set, the bot token wins. If **neither** is set,
`makeSlackClient()` throws `"slack not configured"` and `slackConfigured()`
returns false.

### As an automation action (#98)

Add a `slack` action to an automation:

```json
{
  "name": "deploy-notify",
  "trigger": { "type": "event", "event": "outcome:merged" },
  "action": { "type": "slack", "channel": "#deploys", "text": "Deploy merged" }
}
```

The action posts via the injected/real Slack client. It is **guarded**: if Slack
is unconfigured or the post fails, the action is skipped (returns false) and the
automation run is never broken.

### As an alert destination (#93)

Set `SLACK_ALERT_CHANNEL` (or pass `slackChannel` to `recordAlerts`). Each NEW
alert is **also** posted to Slack (best-effort), in addition to the in-thread
system message. A failing or unconfigured Slack post never breaks alert
recording.

## Gmail / Google Workspace / HubSpot (scaffolds)

These share the `Integration` shape and are registered with `configured()`
reading their env. Live wiring — the per-provider OAuth flow and read APIs
(e.g. Gmail read → Task) — are follow-ups on this registry. Until their creds
are configured they report "needs credentials" and are inert.
