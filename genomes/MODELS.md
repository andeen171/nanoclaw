# Modelos verificados — preflight real via OmniRoute

Verificado em: 2026-08-18. Re-preflight obrigatório antes de qualquer troca
(o catálogo /v1/models mente; gh/kimi-k3 sumiu do catálogo sem aviso em ago/2026).

**Desde 2026-08-18 os grupos apontam para COMBOS do OmniRoute, não para modelos
crus.** Um combo é uma cadeia de failover (`strategy: priority`) chamável pelo
nome — se o primeiro modelo estoura limite/quota, o gateway tenta o próximo
sozinho. É o que mantém o organismo andando quando um plano acaba. Combos vivem
no OmniRoute (`combos` table / UI); mudanças lá NÃO precisam de config nos
grupos.

| Combo | Cadeia (ordem de prioridade) | Papéis |
|-------|------------------------------|--------|
| nc-fast | agy/gemini-3.6-flash-medium → gh/claude-haiku-4.5 → agy/gemini-3.5-flash-low | Mano, po |
| nc-review | agy/gemini-3.1-pro-low → agy/claude-sonnet-4-6 → cc/claude-sonnet-5 | qa |
| nc-code | cc/claude-sonnet-5 → agy/claude-sonnet-4-6 → agy/gemini-3.1-pro-low | dev, devops |
| nc-heavy | cc/claude-opus-5 → agy/claude-opus-4-6-thinking → agy/claude-sonnet-4-6 | design, arch, dev-pos, dev-portfolio |

Preflight 2026-08-18 (todos os combos e pernas): tool_use ok em nc-fast,
nc-review, nc-code (thinking ok), nc-heavy, e nas pernas individuais
agy/gemini-3.6-flash-{medium,high}, agy/gemini-3.1-pro-low,
agy/claude-sonnet-4-6, agy/claude-opus-4-6-thinking, gh/claude-haiku-4.5.

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
