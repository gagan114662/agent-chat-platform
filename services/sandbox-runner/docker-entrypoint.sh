#!/bin/sh
# Sandbox-runner entrypoint. Materializes subscription credentials before the
# runner starts, then hands off. SUBSCRIPTION AUTH ONLY (no metered API keys):
#
#   claude-code -> CLAUDE_CODE_OAUTH_TOKEN env (from `claude setup-token` on a
#                  machine signed into a Claude Pro/Max subscription). The claude
#                  CLI reads it directly; the env scrub preserves CLAUDE_*.
#   codex       -> CODEX_AUTH_JSON env holding the contents of ~/.codex/auth.json
#                  (from `codex login` with a ChatGPT subscription). Written to
#                  $CODEX_HOME/auth.json here so the codex CLI picks it up.
set -e

if [ -n "$CODEX_AUTH_JSON" ]; then
  CODEX_DIR="${CODEX_HOME:-/root/.codex}"
  mkdir -p "$CODEX_DIR"
  printf '%s' "$CODEX_AUTH_JSON" > "$CODEX_DIR/auth.json"
  chmod 600 "$CODEX_DIR/auth.json"
fi

exec /bin/sandbox-runner "$@"
