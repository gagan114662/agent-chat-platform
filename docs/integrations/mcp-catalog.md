# MCP server catalog (#97)

The sandbox runner ships a built-in, curated catalog of Model Context Protocol
(MCP) servers (`services/sandbox-runner/adapter/mcp.go`). Each entry carries a
launch command and a **security tier** that gates default authorization. The
catalog is intentionally small and opinionated — drawn from the
"50 essential MCP servers" shortlist — so an agent run can pick a few high-value
servers without hand-rolling config.

## Default-deny authorization

Authorization is **default-deny by tier** (#38/#57). For a server to be
provisioned into a run, its name must be authorized by `mcpAuthorized`:

- **`safe`** servers are **allowed by default**.
- **`sensitive`** and **`money`** servers are **denied** unless the server name
  appears in the comma-separated `ACP_ALLOWED_MCP` environment variable.
- An **unknown** name is always denied.

`money`-tier servers are **never** default-allowed: even with `ACP_ALLOWED_MCP`
set, funds-moving / irreversible servers must also clear the per-org **approval
gate** (#16/#21) before they are wired into a live run. Treat `ACP_ALLOWED_MCP`
as the floor, not the ceiling.

## Tiers

### safe — read-only / local (allowed by default)

| Server | Purpose |
| --- | --- |
| `filesystem` | Local file read/list within the run workspace |
| `git` | Read git history / status |
| `fetch` | Fetch a URL (read-only) |
| `time` | Current time / timezone helpers |
| `sequential-thinking` | Scratchpad reasoning aid |
| `memory` | Ephemeral key/value memory |
| `context7` | Library / framework docs lookup |
| `sqlite` | Local SQLite query |
| `brave-search` | Web search |

### sensitive — writes / external state (default-deny, needs `ACP_ALLOWED_MCP`)

| Server | Purpose |
| --- | --- |
| `github` | GitHub issues/PRs/repos (writes) |
| `gitlab` | GitLab issues/MRs/repos (writes) |
| `slack` | Post / read Slack messages |
| `notion` | Notion pages / databases (writes) |
| `linear` | Linear issues (writes) |
| `postgres` | Postgres query / mutation |
| `redis` | Redis read/write |
| `supabase` | Supabase project / data access |
| `sentry` | Sentry issues / events |
| `gdrive` | Google Drive files |
| `cloudflare` | Cloudflare account / DNS / Workers |
| `vercel` | Vercel deployments / projects |
| `kubernetes` | Cluster read/apply |
| `docker` | Container lifecycle |

### money — irreversible / moves funds (default-deny + approval gate #16/#21)

| Server | Purpose |
| --- | --- |
| `stripe` | Payments / refunds |
| `paypal` | Payments / payouts |
| `plaid` | Bank account / transfer data |
| `quickbooks` | Accounting ledgers |
| `alpaca` | Brokerage / trade execution |
| `ccxt` | Crypto exchange trading |
| `etherscan` | On-chain Ethereum data / txns |
| `coingecko` | Crypto market data |

## Operational guidance

- **3–5 active max.** Don't wire the whole catalog into a single run. Each
  active MCP server adds tool surface, latency, and prompt-context cost; keep
  3–5 servers that the task actually needs.
- **Money / irreversible require explicit per-org authorization.** Listing a
  `money`-tier server in `ACP_ALLOWED_MCP` is necessary but not sufficient — it
  must also pass the approval gate (#16/#21). Funds movement is never automatic.
- **Catalog data is not authorization.** Adding a server to the catalog only
  makes it *available*; the default-deny tier logic still decides whether it is
  provisioned for a given run.
