#!/usr/bin/env bash
# Preflight de um modelo do OmniRoute: chamada real com tool + thinking.
# O catálogo /v1/models mente; só chamada real conta. Uso: preflight-model.sh <model-id>
set -u
M="$1"
BODY=$(cat <<EOF
{"model":"$M","max_tokens":2048,"thinking":{"type":"enabled","budget_tokens":1024},
 "tools":[{"name":"get_time","description":"Retorna a hora atual","input_schema":{"type":"object","properties":{"tz":{"type":"string"}},"required":["tz"]}}],
 "messages":[{"role":"user","content":"Use a ferramenta get_time com tz America/Sao_Paulo. Nao responda em texto."}]}
EOF
)
R=$(curl -s --max-time 120 http://localhost:20128/v1/messages \
  -H 'Content-Type: application/json' -H 'anthropic-version: 2023-06-01' -d "$BODY")
echo "$R" | grep -q '"type":"tool_use"' && TOOL=ok || TOOL=FAIL
echo "$R" | grep -q '"type":"thinking"' && THINK=ok || THINK=no
ERR=$(echo "$R" | grep -o '"message":"[^"]*"' | head -1 | cut -c1-90)
printf '%-30s tool_use=%-4s thinking=%-3s %s\n' "$M" "$TOOL" "$THINK" "${ERR:-}"
