#!/usr/bin/env bash
# Tick da celula dev: conta a fila no Linear; so acorda o agente com trabalho.
# Contrato do task-script: ultima linha = JSON single-line {"wakeAgent":bool,"data":{}}.
# Falha de rede => wakeAgent:false explicito (gated, sem backoff) — nunca exit sem output.
Q='{"query":"{ issues(filter:{team:{key:{eq:\"TTK\"}}, state:{name:{eq:\"Todo\"}}, labels:{some:{name:{eq:\"role:design\"}}}}, first:50){ nodes{ identifier } } }"}'
R=$(curl -sf --max-time 20 https://api.linear.app/graphql \
  -H 'Content-Type: application/json' -H 'Authorization: placeholder' \
  -d "$Q") || { echo '{"wakeAgent": false, "data": {"error": "linear-unreachable"}}'; exit 0; }
C=$(printf '%s' "$R" | grep -o '"identifier"' | wc -l | tr -d ' ')
if [ "$C" -gt 0 ] 2>/dev/null; then
  echo "{\"wakeAgent\": true, \"data\": {\"queue\": $C}}"
else
  echo '{"wakeAgent": false, "data": {"queue": 0}}'
fi
exit 0
