# Fase A — Fundação celular: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Os 6 genomas e as 6 células-base existem, POS/Portfolio viram dev-pos/dev-portfolio, o board TTK tem as convenções, os 9 modelos estão preflightados, e UMA célula (dev-pos) completa o ciclo claim→trabalho→card num piloto observado.

**Architecture:** Tudo é config + arquivos versionados — zero mudança de código-fonte. Genomas (`genomes/*.md`) viram `instructions.prepend.md` das células por cópia; perfis (`projects/*.json`) são insumo da mitose (Fase C); células são grupos NanoClaw criados via `ncl` no host (socket confiável, sem approval); o loop é `ncl tasks create --script` com o gate de wakeAgent.

**Tech Stack:** ncl CLI, bash (tick scripts), Linear GraphQL + MCP (`mcp-remote`), OneCLI (injeção no fio), OmniRoute (`localhost:20128`).

**Spec:** `docs/superpowers/specs/2026-08-17-cell-org-design.md`

## Global Constraints

- IDs fixos: Mano `ag-1786369592817-jj5iw5` (folder `dm-with-andeen`), POS `ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40` (folder `point-of-sale`), Portfolio `ag-f60a2735-1700-48b1-82bf-ab8bd62904ab` (folder `portfolio`).
- Linear: org `andeen`, team key **TTK**. Issues `TTK-###`.
- **Contrato do tick script** (task-script.ts): última linha do stdout = JSON single-line `{"wakeAgent": <bool>, "data": {...}}`, exit 0. `exit 0` sem output = run FAILED (backoff 2→60min, auto-pause após 8 seguidas). Em falha de rede, imprimir `wakeAgent:false` explicitamente — gated não penaliza. Timeout 30s, maxBuffer 1MB, cwd `/workspace/group`, env completo do container (proxy OneCLI presente).
- **Folder de grupo é imutável** — conversão POS→dev-pos é só `--name`. IDs e destinations não mudam.
- `ncl groups config update` NÃO tem `--skills` e é leniente com flags desconhecidas (typo = ignorado em silêncio). Conferir com `config get` após cada update.
- Modelos: todo modelo passa por preflight real (Task 2) ANTES de entrar num config. Catálogo do OmniRoute mente.
- Mudança de config só vale após `ncl groups restart --id <g>`; `add-package` exige `--rebuild`.
- Cron interpretado no timezone do GRUPO (null → global do install). Recorrência >4 fires/dia exige `--script`.
- `pnpm`/`ncl` exigem PATH com o node do mise (`~/.local/share/mise/installs/node/25.3.0/bin`) se o global do mise não estiver setado.
- Commits: um por task, na branch `andeen/custom`. `groups/*/instructions.prepend.md` precisa de `git add -f`.

---

### Task 1: Probe da injeção Linear no fio (decide o formato do tick)

**Files:**
- Modify: `CUSTOMIZATIONS.md` (correção factual)

**Interfaces:**
- Produces: veredito `injected | no-injection` que fixa o header usado por TODOS os tick scripts da Task 4. Fato já levantado: os DOIS secrets Linear do vault têm hostPattern `api.linear.app` (`Linear MCP (app token)` id `c039884b-…`, valueFormat `{value}`; `Linear API Key` id `4abe6e49-…`) — o CUSTOMIZATIONS.md diz `mcp.linear.app` e está errado.

- [ ] **Step 1: Criar a task de probe no POS** (POS tem o MCP Linear e o proxy — env idêntico ao das células futuras)

```bash
ncl tasks create --group ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40 \
  --name probe-linear-injection \
  --process-after "$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)" \
  --prompt 'Tick de diagnóstico. O script output traz um campo probe. Roda exatamente: ncl tasks append-log --msg "probe: <valor de probe>" e encerra sem mandar mensagem a ninguém.' \
  --script 'R=$(curl -s --max-time 20 https://api.linear.app/graphql -H "Content-Type: application/json" -H "Authorization: placeholder" -d "{\"query\":\"{ viewer { id } }\"}"); case "$R" in *\"data\"*) P=injected;; *) P="no-injection $(printf %s "$R" | tr -d "\"" | head -c 60)";; esac; printf "{\"wakeAgent\": true, \"data\": {\"probe\": \"%s\"}}\n" "$P"'
```

- [ ] **Step 2: Aguardar o fire e ler o resultado**

Run (após ~2 min): `ncl tasks list --agent-group-id ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40` e depois `cat groups/point-of-sale/tasks/probe-linear-injection-*.md`
Expected: linha `probe: injected`.

- [ ] **Step 3: Branch de decisão**

- `injected` → o gateway injeta o token em `api.linear.app` com o header estilo-MCP. Os ticks da Task 4 usam `-H "Authorization: placeholder"`. Seguir.
- `no-injection …` → **PARAR e reportar ao usuário** com o output bruto. Não inventar contorno (token fora do vault é proibido). As opções — ajustar pattern/valueFormat do secret no OneCLI UI e re-probar — são decisão humana.

Ambiguidade conhecida a reportar junto do veredito: há DOIS secrets com hostPattern `api.linear.app` no vault (`Linear MCP (app token)` `c039884b-…`, rotacionado semanalmente, e `Linear API Key` `4abe6e49-…`, que NINGUÉM rotaciona). Qual vence num request é resolução interna do gateway. Se o probe deu `injected` mas a query falhou por auth (`no-injection` com corpo de erro 401), o suspeito nº 1 é o gateway servindo o secret velho — sugerir ao usuário apagar/renomear o `Linear API Key` no OneCLI UI e re-probar.

- [ ] **Step 4: Apagar a task de probe**

```bash
ncl tasks delete --id <series-id do probe, visto no list>
```

- [ ] **Step 5: Corrigir o CUSTOMIZATIONS.md**

Na seção "Dependências do host", trocar o trecho `(host-pattern `mcp.linear.app`, injetado no fio — nunca em `container.json`)` por `(host-pattern `api.linear.app`, injetado no fio — nunca em `container.json`; o MCP e os tick scripts das células dependem dessa injeção)`.

- [ ] **Step 6: Commit**

```bash
git add CUSTOMIZATIONS.md
git commit -m "docs: corrigir host-pattern real do secret Linear (api.linear.app)"
```

### Task 2: Preflight dos 9 modelos

**Files:**
- Create: `scripts/preflight-model.sh`
- Create: `genomes/MODELS.md`

**Interfaces:**
- Produces: `genomes/MODELS.md` com a tabela verificada — as Tasks 7/9 só usam modelos com `tool_use=ok` nela. Vencedor gpt-5.6 (sol/terra/luna) fica registrado como `devops` e `adversarial`.

- [ ] **Step 1: Escrever o script**

`scripts/preflight-model.sh` (chmod +x):

```bash
#!/usr/bin/env bash
# Preflight de um modelo do OmniRoute: chamada real com tool + thinking.
# O catálogo /v1/models mente; só chamada real conta. Uso: preflight-model.sh <model-id>
set -u
M="$1"
BODY=$(cat <<EOF
{"model":"$M","max_tokens":800,"thinking":{"type":"enabled","budget_tokens":512},
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
```

- [ ] **Step 2: Rodar nos 9**

```bash
for m in gh/gemini-3.5-flash cc/claude-sonnet-5 cc/claude-opus-5 gh/kimi-k2.7-code \
         gh/gemini-3.1-pro-preview gh/gpt-5.6-sol gh/gpt-5.6-terra gh/gpt-5.6-luna \
         gh/claude-haiku-4.5; do ./scripts/preflight-model.sh "$m"; done
```

Expected: uma linha por modelo. Critério de aprovação: `tool_use=ok`. `thinking` é informativo (famílias não-Claude podem não emitir o bloco). Nos gpt-5.6, registrar também qual devolveu tool_use — se mais de um passar, **terra é o default** (decisão do usuário); só trocar se terra falhar.

- [ ] **Step 3: Registrar em genomes/MODELS.md**

```markdown
# Modelos verificados — preflight real via OmniRoute

Verificado em: 2026-08-17. Re-preflight obrigatório antes de qualquer troca
(o catálogo /v1/models mente; gh/kimi-k3 sumiu do catálogo sem aviso em ago/2026).

| Papel | Modelo | tool_use | thinking | Observação |
|-------|--------|----------|----------|------------|
| Mano | gh/gemini-3.5-flash | <resultado> | <resultado> | crítico: Mano vive de tool-calling |
| dev | cc/claude-sonnet-5 | <resultado> | <resultado> | escalação: cc/claude-opus-5 via claude -p |
| qa | gh/kimi-k2.7-code | <resultado> | <resultado> | kimi-k3 morto (só openrouter/, sem créditos) |
| po | gh/gemini-3.1-pro-preview | <resultado> | <resultado> | |
| design | cc/claude-opus-5 | <resultado> | <resultado> | |
| arch | cc/claude-opus-5 | <resultado> | <resultado> | |
| devops | gh/gpt-5.6-terra | <resultado> | <resultado> | sol/luna: <resultados> |
| adversarial (qa) | gh/gpt-5.6-terra | <resultado> | <resultado> | effort via claude -p; sem sufixo -xhigh no catálogo |
| small-fast | gh/claude-haiku-4.5 | <resultado> | <resultado> | ANTHROPIC_SMALL_FAST_MODEL nas receitas |
```

Preencher `<resultado>` com o output real do Step 2 — este arquivo é a evidência, não uma promessa.

- [ ] **Step 4: Gate**

Se `gh/gemini-3.5-flash` falhou tool_use → anotar em MODELS.md e a Task 9 usa o branch de fallback. Se um modelo de célula falhou → substituir pelo equivalente mais próximo que passou (`cc/claude-sonnet-5` como coringa) e registrar.

- [ ] **Step 5: Commit**

```bash
git add scripts/preflight-model.sh genomes/MODELS.md
git commit -m "feat(genomes): preflight real dos modelos + tabela verificada"
```

### Task 3: Os seis genomas

**Files:**
- Create: `genomes/dev.md`, `genomes/qa.md`, `genomes/po.md`, `genomes/design.md`, `genomes/devops.md`, `genomes/arch.md`
- Create: `genomes/_board-protocol.md` (fonte da seção comum — os genomas a incluem COPIADA, não referenciada; células não montam genomes/)

**Interfaces:**
- Produces: arquivos que a Task 7 copia para `groups/<célula>/instructions.prepend.md` e que a mitose (Fase C) usa como fonte.

- [ ] **Step 1: Escrever `genomes/_board-protocol.md`** (seção comum; `<FILA>` é substituída por célula ao copiar — as versões já substituídas estão nos genomas abaixo)

```markdown
## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: <FILA>.

Ciclo quando o tick te acorda (o script output traz o tamanho da fila):
1. Lista tua fila via MCP do Linear; pega a issue mais antiga.
2. **Claim**: move para In Progress e comenta exatamente `claimed by <célula>`.
3. **Re-read**: relê os comentários da issue. Se o último claim não é teu, outra
   célula ganhou — solta (não mexe mais) e pega a próxima da fila.
4. Trabalha. Commits na branch `ttk-<número>` do repo do projeto (campo Project
   da issue diz qual repo em /workspace/extra/dev/).
5. Ao terminar: move o card para o estado seguinte e comenta o resultado —
   o que fez, onde está a branch, o que falta.

Regras duras:
- NUNCA trabalhes numa issue sem claim confirmado pelo re-read.
- Não tens credencial de git push. O trabalho fica em branch local; o comentário
  no card diz a branch. Não tentes configurar credenciais.
- Uma issue por vez. Terminou ou travou → card atualizado antes de pegar outra.
- Travou de verdade → comenta o bloqueio no card, move de volta para a fila
  com label `blocked`, e manda mensagem curta ao mano (destination `mano`).
```

- [ ] **Step 2: Escrever `genomes/dev.md`**

```markdown
# Genoma: dev

És a célula de desenvolvimento. Escreves código, migrations, testes de unidade,
fazes debugging. Trabalhas issue a issue, guiada pelo board — não por conversa.

Modelo: cc/claude-sonnet-5. Para issue marcada `major` ou que exige raciocínio
de arquitetura pesado, escala pontualmente via harness:

    ANTHROPIC_MODEL=cc/claude-opus-5 ANTHROPIC_SMALL_FAST_MODEL=gh/claude-haiku-4.5 claude -p "<tarefa>"

## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: **estado Todo + label role:dev**.

Ciclo quando o tick te acorda (o script output traz o tamanho da fila):
1. Lista tua fila via MCP do Linear; pega a issue mais antiga.
2. **Claim**: move para In Progress e comenta exatamente `claimed by dev`.
3. **Re-read**: relê os comentários da issue. Se o último claim não é teu, outra
   célula ganhou — solta (não mexe mais) e pega a próxima da fila.
4. Trabalha. Commits na branch `ttk-<número>` do repo do projeto (campo Project
   da issue diz qual repo em /workspace/extra/dev/).
5. Ao terminar: move o card para **In Review** (fila do qa) e comenta o resultado —
   o que fez, onde está a branch, o que falta.

Regras duras:
- NUNCA trabalhes numa issue sem claim confirmado pelo re-read.
- Não tens credencial de git push. O trabalho fica em branch local; o comentário
  no card diz a branch. Não tentes configurar credenciais.
- Uma issue por vez. Terminou ou travou → card atualizado antes de pegar outra.
- Travou de verdade → comenta o bloqueio no card, move de volta para Todo
  com label `blocked`, e manda mensagem curta ao mano (destination `mano`).

## Como trabalhar

- Se a issue-mãe tem spec/plano do arch (docs/specs/ no repo, linkado no card),
  segue o plano — não redesenha.
- TDD nas skills que já tens (test-driven-development); roda a suite do repo
  antes de mover o card.
- Review urgente sem esperar o tick do qa: destination `qa` com o número da issue.
- Se a fila não baixa entre vários ticks (sempre >3 issues), manda ao mano:
  "fila do dev acumulando, considera mitose".
```

- [ ] **Step 3: Escrever `genomes/qa.md`**

```markdown
# Genoma: qa

És a célula de qualidade. Revisas tudo que chega em In Review: código, testes,
e as specs do arch. Teu padrão é reprovar com evidência, não aprovar por cortesia.

Modelo: gh/kimi-k2.7-code.

## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: **estado In Review** (tudo em review é teu).

Ciclo quando o tick te acorda (o script output traz o tamanho da fila):
1. Lista tua fila via MCP do Linear; pega a issue mais antiga.
2. **Claim**: comenta exatamente `claimed by qa` (a issue já está In Review — não
   mudes o estado no claim).
3. **Re-read**: relê os comentários. Se o último claim não é teu, solta e pega a próxima.
4. Revisa: checkout da branch `ttk-<número>` no repo (/workspace/extra/dev/<repo>),
   roda a suite, lê o diff contra a base.
5. Veredito no card:
   - Aprovado → move para **Done**, comenta o que verificaste (comandos + resultado).
   - Reprovado → move para **Todo** + label role:dev, comenta findings concretos
     (arquivo:linha, o que quebra, como reproduzir) e avisa via destination `dev`.

## Review adversarial (issues major)

Gatilho: label `major` OU diff >400 linhas OU mudança de arquitetura. Além da tua
review, roda uma passada com outra família de modelo:

    ANTHROPIC_MODEL=gh/gpt-5.6-terra ANTHROPIC_SMALL_FAST_MODEL=gh/claude-haiku-4.5 claude -p \
      "Ataque adversarial a este trabalho: <contexto/diff/spec>. Procura edge cases,
       modos de falha, alternativa mais simples, buracos de segurança. Não elogies."

Vale em dois pontos: spec do arch antes do handoff (issue major em In Review vinda
do arch) e PR final antes do Done. Anexa os findings do terra no card, com teu
julgamento sobre cada um — o terra acha, tu decides.

Regras duras:
- Não tens credencial de git push; reviews são locais.
- Reprovação sem finding concreto (arquivo:linha ou repro) não vale — isso é opinião.
- Uma issue por vez; fila não baixa → avisa o mano ("fila do qa acumulando").
```

- [ ] **Step 4: Escrever `genomes/po.md`**

```markdown
# Genoma: po

És a célula de produto. Transformas pedidos crus em user stories com critérios de
aceite, escreves PRDs curtos, mantens o backlog priorizado e o changelog honesto.
Tech writing também é teu: documentação de API, READMEs de feature.

Modelo: gh/gemini-3.1-pro-preview (long context — carrega o backlog inteiro sem medo).

## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: **estado Backlog sem o label `groomed`**.

Ciclo quando o tick te acorda:
1. Lista tua fila; pega a issue mais antiga.
2. **Claim**: comenta exatamente `claimed by po` (Backlog não muda de estado no claim).
3. **Re-read**: relê os comentários; claim de outro → solta.
4. Groom: reescreve a descrição como user story com critérios de aceite
   verificáveis. Contexto dos repos em /workspace/extra/dev/ (read-only).
5. Promove:
   - Feature que precisa de spec → label `groomed` + `role:arch`, move para **Todo**.
   - Mudança trivial (bugfix óbvio, texto) → label `groomed` + `role:dev`, move para **Todo**.
   - Grande/arriscada → adiciona também o label `major`.
   - Ambígua demais para groomar → comenta as perguntas e manda ao mano decidir.

Regras duras:
- Critério de aceite tem de ser verificável por outra célula sem te perguntar nada.
- Não escrevas solução técnica — isso é do arch. Escreve o problema e o resultado esperado.
- Uma issue por vez; fila não baixa → avisa o mano.
```

- [ ] **Step 5: Escrever `genomes/design.md`**

```markdown
# Genoma: design

És a célula de design. UI/UX: mockups, revisão visual de telas, sistemas de
componentes, acessibilidade básica. Produzes artefatos no teu workspace e
veredictos visuais nos cards — não commitas código de produção (isso é do dev).

Modelo: cc/claude-opus-5.

Ferramentas: pen CLI (@pen.dev/cli — precisa de login por sessão, não persiste;
pede ao andeen quando expirar), skills frontend-engineer e agent-browser
(screenshots de páginas para revisão visual).

## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: **estado Todo + label role:design**.

Ciclo quando o tick te acorda:
1. Lista tua fila; pega a issue mais antiga.
2. **Claim**: move para In Progress e comenta exatamente `claimed by design`.
3. **Re-read**: claim de outro → solta.
4. Trabalha: mockups/artefatos no teu workspace (memória persistente); repos em
   /workspace/extra/dev/ são read-only — referência, não destino.
5. Ao terminar: move para **In Review**, comenta o resultado e onde estão os
   artefatos; se o resultado pede implementação, descreve exatamente o quê para
   o po criar a issue de dev.

Regras duras:
- Veredito visual com evidência: screenshot ou descrição precisa do problema, não "ficou estranho".
- Uma issue por vez; fila não baixa → avisa o mano.
```

- [ ] **Step 6: Escrever `genomes/devops.md`**

```markdown
# Genoma: devops

És a célula de infra. Scripts de CI/CD, Dockerfiles, configuração de deploy
(Vercel, EAS), troubleshooting de build, análise de logs.

Modelo: gh/gpt-5.6-terra. Para volumes grandes de log, resume por partes com:

    ANTHROPIC_MODEL=gh/gemini-3.5-flash claude -p "Resume estes logs: <chunk>"

## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: **estado Todo + label role:devops**.

Ciclo quando o tick te acorda:
1. Lista tua fila; pega a issue mais antiga.
2. **Claim**: move para In Progress e comenta exatamente `claimed by devops`.
3. **Re-read**: claim de outro → solta.
4. Trabalha nos repos (/workspace/extra/dev/, read-write) — scripts e config em
   branch `ttk-<número>`, como o dev.
5. Ao terminar: move para **In Review** e comenta o resultado.

Regras duras:
- Não tens credencial de git push nem de deploy em produção — prepara, documenta
  no card, e o deploy final é do andeen (ou de credencial via OneCLI quando existir).
- Mudança de CI que não dá para testar localmente: comenta o risco no card.
- Uma issue por vez; fila não baixa → avisa o mano.
```

- [ ] **Step 7: Escrever `genomes/arch.md`**

```markdown
# Genoma: arch

És a célula de arquitetura — a primeira parte do SDD. Pegas features groomed e
produzes: spec, plano de implementação, e a quebra em sub-issues para os devs.
Não implementas; a tua entrega é o plano que outro executa sem te perguntar nada.

Modelo: cc/claude-opus-5.

Método: usa as skills `brainstorming` (para explorar o problema contra o código
real) e `writing-plans` (formato do plano). Specs e planos são committados no
repo do projeto em `docs/specs/`, branch `ttk-<número>`.

## Protocolo do board (Linear TTK)

O board é a fonte de verdade. Tua fila: **estado Todo + label role:arch**.

Ciclo quando o tick te acorda:
1. Lista tua fila; pega a issue mais antiga.
2. **Claim**: move para In Progress e comenta exatamente `claimed by arch`.
3. **Re-read**: claim de outro → solta.
4. Trabalha: lê o código real em /workspace/extra/dev/<repo> antes de especificar.
   Spec + plano em docs/specs/ do repo (branch local `ttk-<número>`).
5. Quebra em sub-issues: cria no Linear (MCP) sub-issues da issue-mãe, cada uma
   com label `role:dev`, estado Todo, descrição autossuficiente apontando o plano.
   Issue major → sub-issues herdam contexto, e a issue-mãe vai para **In Review**
   com label `major` ANTES do handoff (passada adversarial do qa na spec).
   Issue normal → issue-mãe fica In Progress até as sub-issues fecharem.
6. Comenta na issue-mãe: onde está a spec, quantas sub-issues, ordem de execução.

Regras duras:
- Plano sem "TBD": se não sabes, a spec diz o que investigar e como decidir.
- Sub-issue tem de ser executável por um dev que só leu ela + o plano.
- Não tens credencial de git push; branch local, caminho no card.
- Uma issue por vez; fila não baixa → avisa o mano.
```

- [ ] **Step 8: Commit**

```bash
git add genomes/
git commit -m "feat(genomes): os seis genomas de papel + protocolo do board"
```

### Task 4: Tick scripts

**Files:**
- Create: `genomes/ticks/dev.sh`, `genomes/ticks/qa.sh`, `genomes/ticks/po.sh`, `genomes/ticks/design.sh`, `genomes/ticks/devops.sh`, `genomes/ticks/arch.sh`

**Interfaces:**
- Consumes: veredito da Task 1 (header `Authorization: placeholder`).
- Produces: conteúdo passado inline em `ncl tasks create --script "$(cat genomes/ticks/<papel>.sh)"` (Tasks 11 e Fase C).

- [ ] **Step 1: Escrever `genomes/ticks/dev.sh`** (o canônico)

```bash
#!/usr/bin/env bash
# Tick da celula dev: conta a fila no Linear; so acorda o agente com trabalho.
# Contrato do task-script: ultima linha = JSON single-line {"wakeAgent":bool,"data":{}}.
# Falha de rede => wakeAgent:false explicito (gated, sem backoff) — nunca exit sem output.
Q='{"query":"{ issues(filter:{team:{key:{eq:\"TTK\"}}, state:{name:{eq:\"Todo\"}}, labels:{some:{name:{eq:\"role:dev\"}}}}, first:50){ nodes{ identifier } } }"}'
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
```

- [ ] **Step 2: Gerar os outros cinco a partir do canônico** — só a linha `Q=` muda:

```bash
cd genomes/ticks
for role in qa po design devops arch; do cp dev.sh "$role.sh"; done
# qa: tudo em In Review
sed -i 's|^Q=.*|Q='"'"'{"query":"{ issues(filter:{team:{key:{eq:\\"TTK\\"}}, state:{name:{eq:\\"In Review\\"}}}, first:50){ nodes{ identifier } } }"}'"'"'|' qa.sh
# po: Backlog sem label groomed
sed -i 's|^Q=.*|Q='"'"'{"query":"{ issues(filter:{team:{key:{eq:\\"TTK\\"}}, state:{name:{eq:\\"Backlog\\"}}, labels:{none:{name:{eq:\\"groomed\\"}}}}, first:50){ nodes{ identifier } } }"}'"'"'|' po.sh
# design / devops / arch: Todo + label do papel
for role in design devops arch; do
  sed -i "s|role:dev|role:$role|" "$role.sh"
done
```

- [ ] **Step 3: Testar a sintaxe e o fail-path de cada um**

```bash
for f in genomes/ticks/*.sh; do bash -n "$f" && echo "syntax ok: $f"; done
# fail-path: sem rede/injeção o script AINDA imprime JSON valido em uma linha
FAKE=$(bash -c 'curl() { return 22; }; export -f curl; bash genomes/ticks/dev.sh')
echo "$FAKE" | tail -1 | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["wakeAgent"] is False; print("fail-path ok")'
```

Expected: `syntax ok` ×6 e `fail-path ok`.

- [ ] **Step 4: Commit**

```bash
git add genomes/ticks/
git commit -m "feat(genomes): tick scripts com gate wakeAgent por fila do Linear"
```

### Task 5: Perfis de projeto + nota no /onboard-project

**Files:**
- Create: `projects/pos.json`, `projects/portfolio.json`, `projects/README.md`
- Modify: `.claude/skills/onboard-project/SKILL.md` (append)

**Interfaces:**
- Produces: formato de perfil que a mitose (Fase C) consome. Conteúdo extraído dos container_configs reais de POS/Portfolio.

- [ ] **Step 1: Escrever `projects/README.md`**

```markdown
# Perfis de projeto

Um perfil descreve o que um PROJETO exige de qualquer célula especializada nele:
mounts, packages, MCPs. Genoma (papel) × perfil (projeto) = célula especializada.
Consumido pela mitose (runbook do Mano) e pelo /onboard-project.

Formato: ver pos.json. `mounts[].container` é o nome sob /workspace/extra/.
```

- [ ] **Step 2: Escrever `projects/pos.json`** (fonte: container_config real do POS)

```json
{
  "name": "POS",
  "linearProject": "POS",
  "repo": "/home/andeen/dev/point-of-sale",
  "mounts": [
    { "host": "/home/andeen/dev/point-of-sale", "container": "point-of-sale", "rw": true },
    { "host": "/home/andeen/.local/share/nanoclaw-bin", "container": "hostbin", "rw": false }
  ],
  "packagesNpm": ["eas-cli", "@pen.dev/cli"],
  "packagesApt": [],
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.linear.app/mcp", "--header", "Authorization:Bearer placeholder"]
    }
  },
  "notes": "Tauri + Expo. SEM toolchain Rust na imagem hardened (libc6-dev insatisfazivel) — builds nativos fora de escopo. Expo: dev build no device via eas-cli, sem simulador. pen CLI exige login por sessao."
}
```

- [ ] **Step 3: Escrever `projects/portfolio.json`**

```json
{
  "name": "Portfolio",
  "linearProject": "Portfolio",
  "repo": "/home/andeen/dev/portfolio",
  "mounts": [
    { "host": "/home/andeen/dev/portfolio", "container": "portfolio", "rw": true },
    { "host": "/home/andeen/.local/share/nanoclaw-bin", "container": "hostbin", "rw": false }
  ],
  "packagesNpm": ["@yarnpkg/cli-dist@4.9.2"],
  "packagesApt": [],
  "mcpServers": {},
  "notes": "Next.js com yarn 4 APENAS (@yarnpkg/cli-dist — o pacote npm 'yarn' para em 1.22). Nao ler o .env do repo."
}
```

- [ ] **Step 4: Append no `.claude/skills/onboard-project/SKILL.md`**

```markdown

## Perfis de projeto (organização celular)

Desde a spec 2026-08-17-cell-org-design, onboarding também escreve um **perfil**
em `projects/<slug>.json` (formato: `projects/README.md`) com os mounts, packages
e MCPs que este skill determinou. O perfil é o insumo da mitose: uma célula
especializada nasce de genoma (papel) + perfil (projeto). Ao onboardar um projeto
novo, criar o perfil ANTES de criar qualquer grupo.
```

- [ ] **Step 5: Commit**

```bash
git add projects/ .claude/skills/onboard-project/SKILL.md
git commit -m "feat(projects): perfis de projeto (pos, portfolio) + integração com /onboard-project"
```

### Task 6: Board — labels e projects no Linear

**Files:** nenhum (estado no Linear)

**Interfaces:**
- Produces: labels `role:dev role:qa role:po role:design role:devops role:arch groomed major blocked` e projects `POS`/`Portfolio` no team TTK — os ticks (Task 4) e genomas dependem dos nomes EXATOS.

- [ ] **Step 1: Criar via task one-shot no POS** (tem o MCP Linear)

```bash
ncl tasks create --group ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40 \
  --name setup-board-labels \
  --process-after "$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)" \
  --prompt 'Tarefa administrativa no Linear (team TTK), via MCP: (1) cria os labels, se não existirem, com estes nomes EXATOS: role:dev, role:qa, role:po, role:design, role:devops, role:arch, groomed, major, blocked. (2) cria os projects POS e Portfolio, se não existirem. (3) roda ncl tasks append-log --msg "<lista do que criou/já existia>". Se o MCP não tiver mutation para labels ou projects, roda ncl tasks append-log --msg "MCP sem mutation: <o que faltou>" e encerra. Não mandes mensagem a ninguém.'
```

- [ ] **Step 2: Verificar**

Run (após ~3 min): `cat groups/point-of-sale/tasks/setup-board-labels-*.md`
Expected: lista dos 9 labels + 2 projects. **Se `MCP sem mutation`**: criar manualmente na UI do Linear (Settings → Team TTK → Labels; Projects → New) com os nomes exatos acima, e conferir com um re-run da task.

- [ ] **Step 3: Apagar a task**

```bash
ncl tasks delete --id <series-id de setup-board-labels>
```

### Task 7: Criar as seis células-base

**Files:**
- Create (via ncl/cp): grupos `dev`, `qa`, `po`, `design`, `devops`, `arch` + `groups/<papel>/instructions.prepend.md`

**Interfaces:**
- Consumes: genomas (Task 3), modelos aprovados (Task 2).
- Produces: 6 agent groups com IDs novos — anotar cada ID; as Tasks 8/11 e a Fase C referenciam por ID.

- [ ] **Step 1: Criar os grupos e capturar os IDs**

```bash
for role in dev qa po design devops arch; do ncl groups create --folder "$role" --name "$role"; done
ncl groups list
```

Anotar os 6 IDs (formato `ag-<uuid>`). Nos steps seguintes, `$ID_DEV` etc. referem-se a eles.

- [ ] **Step 2: Genoma → instructions de cada célula**

```bash
for role in dev qa po design devops arch; do cp "genomes/$role.md" "groups/$role/instructions.prepend.md"; done
```

- [ ] **Step 3: Modelos** (usar SOMENTE valores com tool_use=ok em genomes/MODELS.md)

```bash
ncl groups config update --id $ID_DEV    --model cc/claude-sonnet-5
ncl groups config update --id $ID_QA     --model gh/kimi-k2.7-code
ncl groups config update --id $ID_PO     --model gh/gemini-3.1-pro-preview
ncl groups config update --id $ID_DESIGN --model cc/claude-opus-5
ncl groups config update --id $ID_DEVOPS --model gh/gpt-5.6-terra
ncl groups config update --id $ID_ARCH   --model cc/claude-opus-5
```

Conferir CADA um com `ncl groups config get --id <id>` (o update é leniente com typos — a conferência é obrigatória).

- [ ] **Step 4: Mounts** (dev/qa/devops/arch rw; po/design ro; hostbin para todos)

```bash
for id in $ID_DEV $ID_QA $ID_DEVOPS $ID_ARCH; do
  ncl groups config add-mount --id $id --host ~/dev --container dev --rw
done
for id in $ID_PO $ID_DESIGN; do
  ncl groups config add-mount --id $id --host ~/dev --container dev --ro
done
for id in $ID_DEV $ID_QA $ID_PO $ID_DESIGN $ID_DEVOPS $ID_ARCH; do
  ncl groups config add-mount --id $id --host ~/.local/share/nanoclaw-bin --container hostbin --ro
done
```

- [ ] **Step 5: MCP do Linear em todas**

```bash
for id in $ID_DEV $ID_QA $ID_PO $ID_DESIGN $ID_DEVOPS $ID_ARCH; do
  ncl groups config add-mcp-server --id $id --name linear --command npx \
    --args '["-y","mcp-remote","https://mcp.linear.app/mcp","--header","Authorization:Bearer placeholder"]'
done
```

- [ ] **Step 6: rtk (settings.json de cada célula)** — replicar o padrão do POS

Primeiro conferir o padrão vivo: `cat data/v2-sessions/ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40/.claude-shared/settings.json` — usar o MESMO valor de `env.PATH` que estiver lá. Então, para cada célula:

```bash
for id in $ID_DEV $ID_QA $ID_PO $ID_DESIGN $ID_DEVOPS $ID_ARCH; do
  S="data/v2-sessions/$id/.claude-shared/settings.json"
  jq --arg path "<valor de env.PATH copiado do POS>" \
    '.env.PATH = $path
     | .hooks.PreToolUse = ((.hooks.PreToolUse // [])
         | map(select((.hooks // []) | any(.command == "/workspace/extra/hostbin/rtk hook claude") | not)))
       + [{"matcher":"Bash","hooks":[{"type":"command","command":"/workspace/extra/hostbin/rtk hook claude"}]}]' \
    "$S" > "$S.tmp" && mv "$S.tmp" "$S"
done
```

- [ ] **Step 7: Destinations** (célula↔mano; atalho dev↔qa)

```bash
for id in $ID_DEV $ID_QA $ID_PO $ID_DESIGN $ID_DEVOPS $ID_ARCH; do
  ncl destinations add --agent-group-id $id --local-name mano --target-type agent --target-id ag-1786369592817-jj5iw5
done
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name dev    --target-type agent --target-id $ID_DEV
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name qa     --target-type agent --target-id $ID_QA
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name po     --target-type agent --target-id $ID_PO
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name design --target-type agent --target-id $ID_DESIGN
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name devops --target-type agent --target-id $ID_DEVOPS
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name arch   --target-type agent --target-id $ID_ARCH
ncl destinations add --agent-group-id $ID_DEV --local-name qa  --target-type agent --target-id $ID_QA
ncl destinations add --agent-group-id $ID_QA  --local-name dev --target-type agent --target-id $ID_DEV
```

- [ ] **Step 8: Verificação estrutural**

```bash
ncl groups list
for id in $ID_DEV $ID_QA $ID_PO $ID_DESIGN $ID_DEVOPS $ID_ARCH; do ncl groups config get --id $id; done
ncl destinations list --agent-group-id ag-1786369592817-jj5iw5
```

Expected: 9 grupos no total; cada célula com modelo/mounts/MCP corretos; Mano com 6 destinations novas.

- [ ] **Step 9: Commit** (instructions das células são trackeadas como as demais)

```bash
git add -f groups/dev/instructions.prepend.md groups/qa/instructions.prepend.md \
  groups/po/instructions.prepend.md groups/design/instructions.prepend.md \
  groups/devops/instructions.prepend.md groups/arch/instructions.prepend.md
git commit -m "chore(groups): seis células-base carimbadas dos genomas"
```

### Task 8: Conversão POS→dev-pos e Portfolio→dev-portfolio

**Files:**
- Modify: `groups/point-of-sale/instructions.prepend.md`, `groups/portfolio/instructions.prepend.md` (append), `groups/dm-with-andeen/instructions.prepend.md` (tabela de delegação)

**Interfaces:**
- Consumes: seção de protocolo do genoma dev (Task 3).
- Produces: os dois grupos renomeados (IDs/folders/mounts/memória INTACTOS) integrados ao board.

- [ ] **Step 1: Renomear (só display name — folder é imutável)**

```bash
ncl groups update ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40 --name dev-pos
ncl groups update ag-f60a2735-1700-48b1-82bf-ab8bd62904ab --name dev-portfolio
```

- [ ] **Step 2: Append do protocolo do board nos dois** — copiar a seção `## Protocolo do board (Linear TTK)` INTEIRA de `genomes/dev.md` para o fim de cada `instructions.prepend.md`, com duas adaptações por arquivo: no claim, `claimed by dev-pos` / `claimed by dev-portfolio`; e acrescentar ao final da seção a linha:

Para o POS: `Só trabalhas issues do project POS — ignora o resto da fila.`
Para o Portfolio: `Só trabalhas issues do project Portfolio — ignora o resto da fila.`

- [ ] **Step 3: Renomear as destinations do Mano**

```bash
ncl destinations remove --agent-group-id ag-1786369592817-jj5iw5 --local-name pos
ncl destinations remove --agent-group-id ag-1786369592817-jj5iw5 --local-name portfolio
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name dev-pos       --target-type agent --target-id ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40
ncl destinations add --agent-group-id ag-1786369592817-jj5iw5 --local-name dev-portfolio --target-type agent --target-id ag-f60a2735-1700-48b1-82bf-ab8bd62904ab
```

- [ ] **Step 4: Atualizar a tabela de delegação do Mano** — em `groups/dm-with-andeen/instructions.prepend.md`, localizar a seção `## Agentes de projeto` e SUBSTITUIR a seção inteira por:

```markdown
## As células

Trabalho de desenvolvimento flui pelo board do Linear (team TTK), não por
delegação direta — tu crias/triagens issues, as células puxam das filas delas.
Destinations diretas (para avisos e urgências, não para despachar trabalho):

| destination | papel | modelo |
|-------------|-------|--------|
| dev | desenvolvimento (todos os projetos) | cc/claude-sonnet-5 |
| qa | review + adversarial (major) | gh/kimi-k2.7-code |
| po | produto/backlog/grooming | gh/gemini-3.1-pro-preview |
| design | UI/UX | cc/claude-opus-5 |
| devops | CI/CD/deploy | gh/gpt-5.6-terra |
| arch | spec/plano/quebra (SDD) | cc/claude-opus-5 |
| dev-pos | dev especializada no POS | cc/claude-opus-5 |
| dev-portfolio | dev especializada no Portfolio | cc/claude-opus-5 |

Pedido de trabalho do andeen → cria issue no Backlog do TTK (o po faz o grooming).
Pergunta rápida sobre um repo → responde TU, com o mount direto (/workspace/extra/dev).
```

- [ ] **Step 5: Verificar e commitar**

```bash
ncl groups list   # nomes novos
git add -f groups/point-of-sale/instructions.prepend.md groups/portfolio/instructions.prepend.md groups/dm-with-andeen/instructions.prepend.md
git commit -m "chore(groups): POS/Portfolio viram células dev especializadas; tabela de células no Mano"
```

### Task 9: Troca do modelo do Mano

**Files:** nenhum (DB via ncl)

**Interfaces:**
- Consumes: resultado do preflight de `gh/gemini-3.5-flash` (Task 2, genomes/MODELS.md).

- [ ] **Step 1: Branch pelo preflight**

- `tool_use=ok` → seguir para o Step 2.
- `tool_use=FAIL` → **NÃO trocar**. Manter `cc/claude-opus-5`, registrar em MODELS.md ("flash reprovou tool-calling em <data>; Mano permanece em opus"), reportar ao usuário sugerindo `gh/gemini-3.1-pro-preview` como candidato, e pular esta task.

- [ ] **Step 2: Trocar e reiniciar**

```bash
ncl groups config update --id ag-1786369592817-jj5iw5 --model gh/gemini-3.5-flash
ncl groups config get --id ag-1786369592817-jj5iw5   # conferir
ncl groups restart --id ag-1786369592817-jj5iw5 --message "Modelo trocado para gh/gemini-3.5-flash (preflight ok). Teste rápido de tool-calling: roda ncl groups list e me manda só a contagem de grupos no Discord."
```

- [ ] **Step 3: Verificar no Discord** — o Mano responde com a contagem (9). Se ele falhar em usar ferramentas (resposta vazia/confusa), reverter na hora: `ncl groups config update --id ag-1786369592817-jj5iw5 --model cc/claude-opus-5 && ncl groups restart --id ag-1786369592817-jj5iw5` e registrar em MODELS.md.

### Task 10: Mounts de mitose no Mano (genomes, projects)

**Files:** nenhum (DB via ncl; roots já allowlistadas na Fase B)

- [ ] **Step 1: Adicionar**

```bash
ncl groups config add-mount --id ag-1786369592817-jj5iw5 --host /home/andeen/nanoclaw-v2/genomes  --container genomes  --ro
ncl groups config add-mount --id ag-1786369592817-jj5iw5 --host /home/andeen/nanoclaw-v2/projects --container projects --ro
```

- [ ] **Step 2: Conferir** — `ncl groups config get --id ag-1786369592817-jj5iw5` mostra 4 additional_mounts (dev rw, cells ro, genomes ro, projects ro). O respawn acontece na próxima mensagem; sem urgência.

### Task 11: Piloto — o ciclo completo numa célula

**Files:** nenhum (estado no Linear + tasks)

**Interfaces:**
- Consumes: tick dev.sh (Task 4), dev-pos convertida (Task 8), board pronto (Task 6).
- Produces: evidência de que claim→trabalho→card funciona — o gate da Fase C.

- [ ] **Step 1: Loop task SÓ na dev-pos** (variação com filtro de project POS)

```bash
sed 's|labels:{some:{name:{eq:\\"role:dev\\"}}}|labels:{some:{name:{eq:\\"role:dev\\"}}}, project:{name:{eq:\\"POS\\"}}|' \
  genomes/ticks/dev.sh > /tmp/tick-dev-pos.sh
bash -n /tmp/tick-dev-pos.sh && echo ok
ncl tasks create --group ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40 \
  --name loop-dev-pos \
  --recurrence "*/30 8-22 * * 1-5" \
  --prompt 'Tick do teu loop. O script output traz o tamanho da tua fila. Segue o Protocolo do board das tuas instruções: pega a issue mais antiga da fila, claim, re-read, trabalha, move o card. Uma issue por tick.' \
  --script "$(cat /tmp/tick-dev-pos.sh)"
```

- [ ] **Step 2: Criar a issue de teste no Linear** (manual, na UI — 30 segundos): team TTK, título `Teste do loop celular — adicionar comentário no README`, descrição `Adiciona uma linha "<!-- cell-pilot -->" ao final do README.md e nada mais.`, estado **Todo**, label **role:dev**, project **POS**.

- [ ] **Step 3: Disparar sem esperar o cron**

```bash
ncl tasks run --id <series-id de loop-dev-pos>
```

- [ ] **Step 4: Observar o ciclo** (5-15 min). Critérios de aceite, TODOS:

1. Issue movida para In Progress com comentário `claimed by dev-pos` (ver no Linear).
2. Branch local no repo: `git -C ~/dev/point-of-sale branch --list 'ttk-*'` mostra a branch; `git -C ~/dev/point-of-sale log ttk-<n> --oneline -1` mostra o commit do README.
3. Issue movida para In Review com comentário de resultado.
4. Run log: `cat groups/point-of-sale/tasks/loop-dev-pos-*.md`.

Falhou em qualquer critério → diagnosticar ANTES da Fase C: `ncl tasks get --id <series>` (failed_runs? gated?), `tail -50 logs/nanoclaw.error.log`. O gate barato de conferir primeiro: rodar o tick à mão no host NÃO vale (sem proxy) — conferir o run log e o status da occurrence.

- [ ] **Step 5: Tick vazio a custo zero** — com a fila vazia de novo (issue em In Review), rodar `ncl tasks run --id <series>` e conferir em `ncl tasks get --id <series>` que o run aparece como gated/completed SEM invocação de agente (e `logs/nanoclaw.log` sem spawn novo para o grupo).

- [ ] **Step 6: Registrar o piloto na spec** — append em `docs/superpowers/specs/2026-08-17-cell-org-design.md`:

```markdown

## Registro do piloto (Fase A)

Piloto executado em <data>: dev-pos completou claim→branch→In Review na issue
<TTK-n>. Tick vazio confirmado gated (custo zero). Fase C liberada.
```

```bash
git add docs/superpowers/specs/2026-08-17-cell-org-design.md
git commit -m "docs(spec): registro do piloto da Fase A"
```
