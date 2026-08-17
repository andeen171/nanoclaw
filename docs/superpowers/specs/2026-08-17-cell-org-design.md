# Organização celular por papéis — design

**Data:** 2026-08-17 · **Status:** aprovado em conversa, aguardando review da spec
**Escopo:** reestruturar o NanoClaw deste install de "um agente por projeto" para
"células por papel" (dev, qa, po, design, devops) orquestradas pelo Mano, com
board no Linear, loops agênticos com tick a custo zero, e multiplicação
("mitose") governada por envelope no host.

## Decisões fechadas

| Questão | Decisão |
|---------|---------|
| Mapeamento papel×projeto | **Células-base company-wide + mitose sob demanda** (célula-mãe por papel; clone escopado a projeto quando a carga pede) |
| Elenco v1 | dev, qa, po, design, devops + Mano orquestrador. Sem célula "arquiteto" (é o Mano); tech writer dobra no po |
| Fluxo de trabalho | **Board no Linear (TTK)** como fonte de verdade + um único atalho direto dev↔qa por destinations |
| Governança da mitose | Mano autônomo **dentro de envelope duro no host**; dentro → notifica; fora → card de aprovação. Célula pode *pedir* clone |
| Acesso do Mano | `~/dev` rw + `groups/` ro + `ncl` global (já tem). **Sem socket do Docker** — rejeitado por segurança |
| Modelos | Mapa por papel abaixo; cc/ só para Mano e dev (espalha rate limit); tudo passa por preflight real |
| Tier self-hosted da pesquisa | Fora de escopo — `openrouter/` está sem créditos, sem caminho vivo p/ DeepSeek/Qwen local |

## 1. Anatomia

Três conceitos, três lugares:

- **Genoma** — `genomes/<papel>.md`, versionado no repo. Personalidade do papel,
  convenções, protocolo do board, modelo (e small-fast model). Toda célula do
  papel nasce dele; é o que se revisa no fork.
- **Perfil** — `projects/<nome>.json`, versionado no repo. Mounts, packages e
  MCPs específicos do projeto (hoje espalhados no config do grupo POS: pen.dev,
  eas-cli, Linear MCP; Portfolio: yarn 4). A skill `/onboard-project` passa a
  **escrever o perfil** em vez de criar grupo diretamente.
- **Célula** — grupo NanoClaw carimbado de genoma (+ perfil se especializada).

| Célula | Tipo | Mounts | cli_scope |
|--------|------|--------|-----------|
| dev, qa, devops | base | `~/dev` **rw** | group |
| po, design | base | `~/dev` **ro** | group |
| `<papel>-<projeto>` (ex. dev-pos) | especializada | só o repo do projeto | group |
| Mano | orquestrador | `~/dev` rw + `groups/` ro | global |

Todas as células levam o MCP do Linear. Nomes de grupo = nome da célula.

**Transição sem perda:** os grupos POS e Portfolio não são deletados — já são
células dev especializadas avant la lettre. Viram `dev-pos` e `dev-portfolio`
por rename + ajuste de config (memória e mounts intactos). As 5 células-base são
criadas do zero. O sistema nasce com duas mitoses feitas.

## 2. Board (Linear TTK)

Convenções sobre o workflow default do time TTK (org `andeen`):

```
fila do po      = Backlog (grooming)
fila do dev     = Todo + label role:dev
fila do design  = Todo + label role:design
fila do devops  = Todo + label role:devops
fila do qa      = In Review (tudo em review é dele)
projeto         = campo Project do Linear (POS, Portfolio, ...)
```

Mano faz a triagem: pedidos teus no Discord viram issues. Handoff entre papéis =
mover o card. Você observa tudo abrindo o Linear.

## 3. Loop celular

Cada célula tem uma `ncl task` recorrente, cron `*/30 8-22 * * 1-5` (timezone do
install), com **gate de script**: o `--script` (bash pré-task, roda no container
antes de acordar o agente) consulta a fila da célula no GraphQL do Linear; fila
vazia → `wakeAgent=false` → **tick sem custo de LLM**. O plano de implementação
pinna o contrato exato do script lendo o task-script do agent-runner (comportamento
observado em produção: `skipped: wakeAgent=false`, `skipped: script error/no
output` — falha do script é fail-closed).

Ciclo quando acorda:

1. Pega a issue mais antiga da fila.
2. **Claim**: move p/ In Progress + comenta `claimed by <célula>`.
3. **Re-read**: Linear é last-write-wins; se o claim de outra célula colou,
   solta e pega a próxima. Janela de corrida = segundos; custo de colisão = um
   começo duplicado.
4. Trabalha na branch da issue, committa.
5. Move o card + comenta o resultado.

Duas células do mesmo papel na mesma fila coexistem sem re-fiação — é o que faz
a mitose ser barata.

**Atalho dev↔qa:** destination `dev → qa` (pedido de review urgente) e
`qa → dev` (devolver review reprovado). Todo o resto conversa pelo board.

**Pré-requisito OneCLI:** o secret do Linear tem host-pattern `mcp.linear.app`;
o script do tick fala com `api.linear.app`. Adicionar segundo pattern com o
mesmo token; `scripts/refresh-linear-token.sh` passa a atualizar os dois.

## 4. Mitose e absorção

**Gatilhos:** a célula sente a fila não baixar entre ticks e pede clone
(mensagem ao Mano via destination), ou o supervisor do Mano vê a fila acumulando.
Decide e executa sempre o Mano.

**Mitose** (runbook determinístico, vira skill do Mano):
`ncl groups create` → genoma + perfil → snapshot da memória da mãe → mounts do
projeto → task de loop → destinations (atalho qa, rota ao Mano) → agente OneCLI.

**Absorção:** célula sem issue tocada em `idle_days` → memória arquivada em
`absorbed/<célula>-<data>/` no workspace da mãe (nada se mistura
automaticamente) → grupo deletado.

**Envelope — a única mudança de código-fonte do projeto:**
`~/.config/nanoclaw/cell-envelope.json` (blocked pattern: célula nenhuma monta):

```json
{ "max_cells": 10, "max_per_role": 3, "idle_days": 7 }
```

Enforcement no **guard seam** (`src/guard/`): guard novo em `groups
create`/`delete` vindos de container. Dentro do envelope → allow + notificação
no Discord do dono; estourou → hold → card via `pending_approvals` (fluxo
existente, com o fix do approve→reject já aplicado). Instrução no CLAUDE.md do
Mano é pedido; o guard é o limite — o Mano escreve no próprio workspace, então
nada que mora lá conta como enforcement. Guard novo entra no conformance test
(`src/guard/conformance.test.ts`).

## 5. Supervisor do Mano

Task recorrente 2×/dia em expediente:

- Digest do board pra ti no Discord.
- Célula travada: issue In Progress >4h sem commit nem comentário → devolve pro
  Todo e anota.
- Avaliação de mitose/absorção contra o board e os run-logs (`groups/` ro).

Convenção de escrita (no genoma do Mano): células são donas das próprias
branches; Mano lê tudo, escreve só sob ordem explícita tua ou em repo sem issue
ativa.

## 6. Modelos

| Célula | Modelo | Racional |
|--------|--------|----------|
| Mano | `cc/claude-opus-5` | fronteira, fala com o dono (como já é) |
| dev | `cc/claude-sonnet-5` | SWE; pesado → assinatura cc/ |
| qa | `gh/claude-sonnet-5` | mesma classe, cota Copilot Pro+ — espalha carga |
| po | `gh/gemini-3.1-pro-preview` | long context p/ PRD/backlog |
| design | `gh/claude-sonnet-4.6` | frontend + visão sem disputar cc/ |
| devops | `gh/gpt-5.6-*` (preflight escolhe entre sol/terra/luna) | CLI/agentic; logs volumosos → `gh/gemini-3.5-flash` |

Regras: catálogo do OmniRoute mente — **preflight real** (tool-call + thinking)
antes de cada modelo valer; resultado registrado com data. 429 crônico no cc/ →
dev desce p/ `gh/claude-sonnet-5` (uma linha de config). cc/ fica restrito a
Mano+dev para não repetir o 429 de 2026-08-14.

## 7. Falhas

| Falha | Comportamento |
|-------|---------------|
| Linear fora do ar | script falha → `wakeAgent=false` (fail-closed nativo) |
| Token Linear expira | timer semanal existente, atualizando os dois host-patterns |
| Célula morre no meio de issue | claim órfão → supervisor devolve pro Todo em <1 dia útil |
| 429 no cc/ | SDK re-tenta; crônico → troca de modelo do dev |
| Claim duplicado | re-read corta; custo = um começo duplicado |
| Mitose descontrolada | impossível estruturalmente: guard no host, envelope fora do alcance de containers |

## 8. Entrega e verificação

Ordem: **B → A → C** (cada fase útil sozinha):

1. **B — acesso do Mano**: mounts (`~/dev` rw, `groups/` ro + allowlist),
   convenção de escrita no genoma. Verifica: Mano roda `git log` num repo sem
   delegar.
2. **A — fundação**: genomas, perfis, 5 células-base, conversão
   POS→dev-pos / Portfolio→dev-portfolio, labels no board, host-pattern novo no
   OneCLI, preflight dos 6 modelos. Verifica: issue de teste `role:dev` num
   sandbox percorre claim→branch→review→done com o loop de UMA célula antes de
   ligar o cron das demais.
3. **C — orquestração**: loops de todas as células, supervisor, guard+envelope
   (unit + conformance), runbook de mitose executado uma vez na mão antes de
   virar skill do Mano.

Fora de escopo desta spec: célula de arquitetura, tier self-hosted, socket do
Docker no container, dashboards novos (o `/add-dashboard` existente já mostra
grupos/sessões).
