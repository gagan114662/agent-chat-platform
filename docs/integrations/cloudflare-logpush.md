# Cloudflare Logpush → ACP ingestion (live wiring)

This is the **post-deploy** step (#103) that points live Cloudflare Logpush jobs
at the secret-guarded ingestion endpoint shipped in Plan 42 (#55). The endpoint,
detection, and idempotent incident/Task recording are already built and tested in
`services/app`; this doc only covers wiring the real Logpush jobs to it.

## What ACP exposes

```
POST https://<deploy-host>/ingest/cloudflare/<orgId>
Header:  x-acp-ingest-secret: <ACP_INGEST_SECRET>
Body:    Cloudflare Logpush NDJSON batch (one JSON object per line)
Query:   ?threadId=<security-thread-id>   (optional; Tasks are opened here)
```

- **Auth** is a machine-to-machine shared secret, **not** a user session. The
  endpoint returns `401` if the `x-acp-ingest-secret` header is missing or does
  not match the `ACP_INGEST_SECRET` env var. The user-auth preHandler treats
  `/ingest/*` as public so it never 401s ahead of the secret check.
- **Org-scoped:** `<orgId>` must be a real org → `404` otherwise. A `threadId`
  from another org is invisible → `404`.
- **Idempotent:** incident id is `${orgId}:${key}` and the Task id is
  `incident:${orgId}:${key}` with `onConflictDoNothing`, so re-POSTing the same
  batch creates `0` new rows. Logpush may retry — that's safe.
- **Size-capped** at ~5 MiB per request (`413` over). Malformed NDJSON lines are
  skipped, never fatal.
- Detection (today): WAF/firewall blocks (`Action` in block/challenge/jschallenge/drop,
  aggregated into one `medium` incident when count ≥ `ACP_WAF_BLOCK_THRESHOLD`,
  default 1) and sensitive audit actions (`ActionType`/`action` containing
  delete/token/role → one `high` incident each).

## Step 1 — set the deploy secret

`ACP_INGEST_SECRET` is the shared secret. Generate a strong value and set it as a
Fly secret on the app (it is read at request time, never logged):

```sh
ACP_INGEST_SECRET=$(openssl rand -hex 32)
fly secrets set ACP_INGEST_SECRET="$ACP_INGEST_SECRET" --app acp-convene
# Optional: a default security thread to open Tasks in when ?threadId= is omitted
fly secrets set INCIDENT_THREAD_ID=<thread-id> --app acp-convene
fly deploy --app acp-convene   # redeploy so the new secret takes effect
```

Keep this value — you'll pass it as the destination header below.

## Step 2 — create the Logpush job(s)

Use the `CLOUDFLARE_API_TOKEN` (scoped **Account · Logs · Edit** + **Zone · Logs ·
Edit** on `ipop.ai` / `teachr.live`). Create one job per dataset you want ingested:

| Scope   | Dataset            | Notes                                  |
|---------|--------------------|----------------------------------------|
| Zone    | `http_requests`    | feeds WAF/firewall block aggregation   |
| Zone    | `firewall_events`  | explicit firewall `Action`s            |
| Account | `audit_logs`       | feeds sensitive-action detection       |

### Option A — dashboard

1. Cloudflare dashboard → **Analytics & Logs → Logs → Logpush** (Account level
   for `audit_logs`; Zone level for `http_requests` / `firewall_events`).
2. **Create a Logpush job** → destination **HTTP**.
3. Destination URL:
   `https://<deploy-host>/ingest/cloudflare/<orgId>`
4. Add a custom header: `x-acp-ingest-secret: <ACP_INGEST_SECRET>` and append
   `?threadId=<security-thread-id>` to the URL if you want Tasks opened there.
5. Select fields (include `Action` / `ActionType` and an id field like `RayID`
   / `EventID`), choose **ownership challenge** if prompted, and enable the job.

### Option B — API (curl)

```sh
# Zone job (http_requests). Repeat with dataset=firewall_events.
curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/logpush/jobs" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<JSON
{
  "name": "acp-http-requests",
  "dataset": "http_requests",
  "enabled": true,
  "destination_conf": "https://<deploy-host>/ingest/cloudflare/<orgId>?threadId=<security-thread-id>&header_x-acp-ingest-secret=$ACP_INGEST_SECRET",
  "output_options": {
    "field_names": ["RayID", "ClientIP", "Action", "EdgeResponseStatus", "ClientRequestHost"],
    "output_type": "ndjson"
  }
}
JSON

# Account job (audit_logs):
curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/logpush/jobs" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<JSON
{
  "name": "acp-audit-logs",
  "dataset": "audit_logs",
  "enabled": true,
  "destination_conf": "https://<deploy-host>/ingest/cloudflare/<orgId>?threadId=<security-thread-id>&header_x-acp-ingest-secret=$ACP_INGEST_SECRET",
  "output_options": { "output_type": "ndjson" }
}
JSON
```

> Cloudflare HTTP destinations carry custom headers via the
> `header_<Name>=<Value>` query parameter on `destination_conf` (URL-encode the
> secret). The dashboard exposes the same as a "Custom HTTP headers" field.

Cloudflare validates an HTTP destination with an **ownership challenge**: it
POSTs a token-bearing body to the URL first. Since `/ingest/cloudflare/:orgId`
requires the secret header, complete the challenge from the dashboard/API flow
(which sends the configured header) or temporarily inspect the challenge token in
the job-create response and submit it via `ownership_challenge`.

## Step 3 — verify

After a job runs (or send a manual batch):

```sh
printf '%s\n' \
  '{"Action":"block","ClientIP":"1.1.1.1"}' \
  '{"Action":"block","ClientIP":"2.2.2.2"}' \
  '{"ActionType":"api_token.delete","id":"audit-demo"}' \
| curl -sS -X POST \
    "https://<deploy-host>/ingest/cloudflare/<orgId>?threadId=<security-thread-id>" \
    -H "x-acp-ingest-secret: $ACP_INGEST_SECRET" \
    -H "content-type: text/plain" \
    --data-binary @-
# -> {"incidents":2,"tasks":2}   (re-running the same batch -> {"incidents":0,"tasks":0})
```

Confirm the `incidents` rows and the opened Tasks appear in the org's security
thread.

## Notes

- This replaces the parked Flarehawk approach (#54 has no API) and generalizes
  toward generic log ingestion (#95) and an autonomous alerter (#93).
- Detection today is rule-based; richer anomaly/baseline detection builds on the
  same `incidents` table and ingestion path.
