# Modelos verificados — preflight real via OmniRoute

Verificado em: 2026-08-17. Re-preflight obrigatório antes de qualquer troca
(o catálogo /v1/models mente; gh/kimi-k3 sumiu do catálogo sem aviso em ago/2026).

| Papel | Modelo | tool_use | thinking | Observação |
|-------|--------|----------|----------|------------|
| Mano | gh/gemini-3.5-flash | FAIL | no | crítico: Mano vive de tool-calling — IDE token expired: unauthorized: token expired. **Task 9 usa branch de fallback.** |
| dev | cc/claude-sonnet-5 | ok | no | escalação: cc/claude-opus-5 via claude -p |
| qa | gh/kimi-k2.7-code | FAIL | no | kimi-k3 morto (só openrouter/, sem créditos) — No active credentials for provider: github. Substituído por cc/claude-sonnet-5 (coringa). |
| po | gh/gemini-3.1-pro-preview | FAIL | no | No active credentials for provider: github. Substituído por cc/claude-sonnet-5 (coringa). |
| design | cc/claude-opus-5 | ok | no | |
| arch | cc/claude-opus-5 | ok | no | |
| devops | gh/gpt-5.6-terra | FAIL | no | sol/luna: FAIL (No active credentials for provider: github). Substituído por cc/claude-sonnet-5 (coringa). |
| adversarial (qa) | gh/gpt-5.6-terra | FAIL | no | effort via claude -p; sem sufixo -xhigh no catálogo. Substituído por cc/claude-sonnet-5 (coringa). |
| small-fast | gh/claude-haiku-4.5 | FAIL | no | ANTHROPIC_SMALL_FAST_MODEL nas receitas — No active credentials for provider: github. Modelo falhou na rede. Usando endpoint local. |
