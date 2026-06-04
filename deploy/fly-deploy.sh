#!/usr/bin/env bash
# One-paste Fly.io deploy for the single-origin app+web tier (#103).
# Run from the repo root (where fly.toml + Dockerfile live), on a machine where
# `fly` is logged into YOUR account (the sandbox isn't). Requires a non-trial
# Fly account (a payment method added at https://fly.io/trial).
#
#   ./deploy/fly-deploy.sh
#
# Override the app name / org / region via env if needed:
#   APP=acp-convene ORG=personal REGION=iad ./deploy/fly-deploy.sh
#
# Ships the chat/auth/memory/tasks UI (app + web + Postgres). Live agent RUNS
# additionally need the Temporal + sandbox-runner tiers — see DEPLOY.md step 2.
set -euo pipefail

APP="${APP:-acp-convene}"
ORG="${ORG:-personal}"
REGION="${REGION:-iad}"
DB="${DB:-${APP}-db}"

echo "==> Fly orgs (confirm ORG=$ORG is correct; override with ORG=<slug>):"
fly orgs list

echo "==> 1/5 create app $APP in org $ORG"
fly apps create "$APP" -o "$ORG"

echo "==> 2/5 create managed Postgres $DB in $REGION"
# Newer flyctl: if this errors as deprecated, use:  fly mpg create --name "$DB" --region "$REGION" --org "$ORG"
fly postgres create --name "$DB" --region "$REGION" --org "$ORG" \
  --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1

echo "==> 3/5 attach $DB -> sets DATABASE_URL on $APP"
# Newer flyctl managed PG:  fly mpg attach "$DB" -a "$APP"
fly postgres attach "$DB" -a "$APP"

echo "==> 4/5 demo auth flag (lets the web dev-header path work without a login)"
fly secrets set ACP_ALLOW_DEV_HEADERS=1 -a "$APP"

echo "==> 5/5 build the combined image (web build -> app serves dist/) + deploy"
fly deploy -a "$APP"

echo "==> done. verify:"
echo "    curl https://${APP}.fly.dev/healthz   # expect {\"ok\":true}"
echo "    fly open -a $APP"
echo
echo "Next: point the GitHub App webhook (#23) and Cloudflare Logpush (#55) at https://${APP}.fly.dev"
