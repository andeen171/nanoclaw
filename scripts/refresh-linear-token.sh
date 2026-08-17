#!/usr/bin/env bash
#
# Mint a fresh Linear app token and update the OneCLI secret in place.
#
# Linear's client_credentials grant issues a 30-day token and offers no refresh
# token, so the only way to stay authenticated is to mint a new one before the
# old expires. Silent failure mode without this: the Linear MCP starts 401ing a
# month after setup, long after anyone remembers configuring it.
#
# Reads LINEAR_OAUTH_CLIENT_ID / LINEAR_OAUTH_CLIENT_SECRET / LINEAR_SECRET_ID
# from the project .env. The names are deliberately not LINEAR_CLIENT_ID:
# src/channels/linear.ts (if /add-linear is ever installed) self-registers on
# that exact name and would stand up a webhook listener nobody asked for.
#
# The minted token is never written to disk — it goes straight into the vault.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

[ -f "$ENV_FILE" ] || { echo "no .env at $ENV_FILE" >&2; exit 1; }

get_env() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'"; }

CLIENT_ID="$(get_env LINEAR_OAUTH_CLIENT_ID)"
CLIENT_SECRET="$(get_env LINEAR_OAUTH_CLIENT_SECRET)"
SECRET_ID="$(get_env LINEAR_SECRET_ID)"

for v in CLIENT_ID CLIENT_SECRET SECRET_ID; do
    [ -n "${!v}" ] || { echo "missing LINEAR_OAUTH_${v#CLIENT_}/LINEAR_SECRET_ID in .env" >&2; exit 1; }
done

TOKEN="$(curl -fsS -X POST https://api.linear.app/oauth/token \
    -d grant_type=client_credentials \
    -d "client_id=$CLIENT_ID" \
    -d "client_secret=$CLIENT_SECRET" \
    -d scope=read \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')"

[ -n "$TOKEN" ] || { echo "Linear returned no access_token" >&2; exit 1; }

# Prove the token works before overwriting a secret that is currently valid —
# swapping in a dead token would take the MCP down until the next run.
curl -fsS -X POST https://api.linear.app/graphql \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"query":"{ viewer { id } }"}' | grep -q '"data"' \
    || { echo "minted token failed a read probe — keeping the old secret" >&2; exit 1; }

onecli secrets update --id "$SECRET_ID" --value "$TOKEN" > /dev/null

# The MCP talks to mcp.linear.app, not api.linear.app — that's a separate
# secret (LINEAR_MCP_SECRET_ID) but it carries the same token, so roll it too.
MCP_SECRET_ID="$(get_env LINEAR_MCP_SECRET_ID)"
[ -n "$MCP_SECRET_ID" ] && onecli secrets update --id "$MCP_SECRET_ID" --value "$TOKEN" > /dev/null

echo "linear token rotated $(date -Iseconds)"
