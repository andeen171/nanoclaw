#!/usr/bin/env bash
# Tick da celula po: conta a fila no Linear; so acorda o agente com trabalho.
# Contrato do task-script: ultima linha = JSON single-line {"wakeAgent":bool,"data":{}}.
# Falha de rede => wakeAgent:false explicito (gated, sem backoff) — nunca exit sem output.
# IssueLabelCollectionFilter nao tem "none" (400 GRAPHQL_VALIDATION_FAILED,
# pego pelo supervisor); "sem label groomed" = every com neq — issue sem
# label nenhum tambem passa (every sobre conjunto vazio), que e o correto.
Q='{"query":"{ issues(filter:{team:{key:{eq:\"TTK\"}}, state:{name:{eq:\"Backlog\"}}, labels:{every:{name:{neq:\"groomed\"}}}}, first:50){ nodes{ identifier } } }"}'
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
