# Modelos verificados — preflight real via OmniRoute

Verificado em: 2026-08-18 (cadeias engrossadas pós-turno: gh/claude-sonnet-5, gh/gpt-5.3-codex e gh/kimi-k3 preflightados OK; maxRetries 3). Motivo: 7.5k rate-limits em 12h esgotaram cc/+agy/ juntos e sem perna gh/ o combo inteiro 503ava. Re-preflight obrigatório antes de qualquer troca
(o catálogo /v1/models mente; gh/kimi-k3 sumiu do catálogo sem aviso em ago/2026).

**Desde 2026-08-18 os grupos apontam para COMBOS do OmniRoute, não para modelos
crus.** Um combo é uma cadeia de failover (`strategy: priority`) chamável pelo
nome — se o primeiro modelo estoura limite/quota, o gateway tenta o próximo
sozinho. É o que mantém o organismo andando quando um plano acaba. Combos vivem
no OmniRoute (`combos` table / UI); mudanças lá NÃO precisam de config nos
grupos.

| Combo | Cadeia (ordem de prioridade) | Papéis |
|-------|------------------------------|--------|
| nc-fast | gh/claude-haiku-4.5 → agy/claude-sonnet-4-6 → cc/claude-haiku-4-5-20251001 → agy/gemini-3.6-flash-medium | po |
| nc-review | agy/gemini-3.1-pro-low → gh/kimi-k3 → cc/claude-sonnet-5 → gh/claude-sonnet-5 → agy/claude-sonnet-4-6 | qa |
| nc-code | cc/claude-sonnet-5 → gh/claude-sonnet-5 → agy/claude-sonnet-4-6 → gh/gpt-5.3-codex → agy/gemini-3.1-pro-low | **Mano**, dev, devops |
| nc-heavy | cc/claude-opus-5 → gh/claude-sonnet-5 → agy/claude-opus-4-6-thinking → cc/claude-sonnet-5 → agy/claude-sonnet-4-6 | design, arch, dev-pos, dev-portfolio |

**Regra de ordenação (18/08): duas pernas do mesmo provider nunca ficam
seguidas, e `maxRetries` = número de pernas.** Motivo abaixo.

## Combo NÃO garante failover

Quando as contas das primeiras pernas estão sem quota, o gateway recusa a
requisição **na admissão** — `503 all upstream accounts are inactive` — sem
tentar as pernas seguintes, mesmo que uma esteja num provider 100% saudável.

Medido em 18/08: o `nc-heavy` acumulou **1509 falhas**. Na hora 17Z, de ~471
requisições só **21 tocaram a perna 1**; as outras 450 morreram sem tentar
perna nenhuma. A perna `gh/claude-sonnet-5` teve **zero tentativas** enquanto
`github/*` respondia 31/31 no mesmo intervalo. O `nc-code`, que já tinha `gh/`
na perna 2, atravessou a mesma janela sem parar.

Diagnóstico de 503 em combo: comparar tentativas por perna
(`GROUP BY provider, model` em `call_logs`) contra a saúde do provider no mesmo
intervalo. Perna com zero tentativas + provider saudável = é este comportamento,
não "todos os modelos caíram".

Preflight 2026-08-18 (todos os combos e pernas): tool_use ok em nc-fast,
nc-review, nc-code (thinking ok), nc-heavy, e nas pernas individuais
agy/gemini-3.6-flash-{medium,high}, agy/gemini-3.1-pro-low,
agy/claude-sonnet-4-6, agy/claude-opus-4-6-thinking, gh/claude-haiku-4.5.

ATENÇÃO — pernas Gemini via agy/ são INADEQUADAS como primária de sessão
agêntica: o wire Antigravity mangla os nomes das tools (`tool_<hash>` em vez
do nome real) e o modelo entra em confusão/loop (visto 2×: kickoff do Mano
0/16 em 19min, tick do po 2026-08-18 02:00). Preflight de 1 chamada passa;
sessão real com 25 tools quebra. Gemini fica como ÚLTIMA perna de failover e
para `claude -p` pontual (adversarial, resumo de logs), onde funciona.

Mortos/inúteis (não usar): gh/kimi-k2.7-code (400 com thinking),
gh/gemini-3.1-pro-preview e gh/gemini-3.5-flash (not supported no gh/),
gh/gpt-5.6-terra (sumiu do gh/; aug/ = Auggie CLI não instalado),
gh/claude-sonnet-4.6 (funciona mas depreca 2026-09-01).

| Papel | Observação |
|-------|------------|
| dev | escalação pontual: cc/claude-opus-5 via claude -p |
| Mano (batch) | tarefa em LOTE no board (rotear/editar N issues) NÃO roda no nc-fast — a perna flash entra em loop de leitura sem commitar mutations (visto 2026-08-18: 0/16 em 19min; nc-code fez 16/16 em 6min). Escala via `ANTHROPIC_MODEL=nc-code claude -p` ou troca temporária do grupo |
| adversarial (qa) | agy/gemini-3.1-pro-low via claude -p — família diferente do autor (dev = Claude), que é o propósito; se agy/ cair, pula a passada e anota no card |
| small-fast | gh/claude-haiku-4.5 (ANTHROPIC_SMALL_FAST_MODEL nas receitas) — restaurado pós re-auth do Copilot; fallback cc/claude-haiku-4-5-20251001 |
