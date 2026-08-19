# Customizações deste fork

Fork de [nanocoai/nanoclaw](https://github.com/nanocoai/nanoclaw). O trunk fica em
`main` (espelho limpo do upstream); tudo que é meu vive em **`andeen/custom`**, um
commit por assunto, para poder ser rebaseado ou descartado individualmente.

## O que tem aqui

| Commit | O que é | Sobrevive ao upstream? |
|--------|---------|------------------------|
| `fix(chat-sdk-bridge)` | Aprovação por Discord: todo clique virava reject | Some quando o upstream aceitar o PR — aí é só dropar |
| `feat(providers)` | Roteia o agent-runner por um gateway OmniRoute rodando como container irmão | Mantém |
| `chore(channels)` | Adapters Discord + WhatsApp instalados por skill | **Não rebaseie** — veja abaixo |
| `chore(groups)` (×2) | Instruções permanentes do Mano, do POS e do Portfolio | Mantém |
| `feat(skills)` | `/onboard-project` — mapeia um projeto da máquina pra um agent group | Mantém |
| `chore(container/skills)` | Skills superpowers + ponytail vendoradas (MIT) | Mantém; ver `container/skills/NOTICE.md` |
| `feat(dashboard)` | `/add-dashboard` — pusher + wiring em `src/index.ts` | Mantém; o wiring é 3 linhas em `main()` |
| `feat(scripts)` | `refresh-linear-token.sh` — renova o token do MCP do Linear | Mantém |
| `fix(ncl)` (×2) | `--rw` em `groups config add-mount`; `tasks` honra `--group` explícito de agente global | Somem se o upstream aceitar os PRs |
| `feat(guard)` (×4) | Envelope celular: autonomia de mitose/absorção dentro de limites no host (inclui fix do frame kebab) | Mantém |
| `feat(genomes)` + `feat(projects)` | Genomas de papel, ticks, perfis de projeto (organização celular) | Mantém |
| `fix(agent-runner)` | Heartbeat no interval do turno — tool call longa não congela o mtime (kill falso no absolute ceiling) | Some se o upstream aceitar o PR |
| `fix(agent-runner)` | Continuação estourada de contexto conta como sessão inválida — célula sai sozinha do `Prompt is too long` em vez de exigir restart manual | Some se o upstream aceitar o PR |
| `chore` (gitignore) | `.serena/` | Mantém |

Não versionado, e é de propósito: `.env` (credenciais), `data/`, `logs/`, e o resto de
`groups/` — inclusive o `CLAUDE.md` composto a cada spawn.

## Atualizando pro upstream

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout andeen/custom && git rebase upstream/main
pnpm install && pnpm run build && pnpm test
```

Depois do rebase, reinicie o serviço (`systemctl --user restart nanoclaw-v2-*.service`).

Existe também a skill `/update-nanoclaw`, que faz esse fluxo de forma guiada — é o
caminho recomendado, porque ela cobre os passos fora do git (marcador, imagem,
gateway) que o rebase sozinho não toca.

Armadilhas, todas encontradas no update de 2026-08-17 (2.1.54 → 2.2.0):

- **Os adapters de canal não são pra resolver na mão.** Trunk não versiona adapter
  nenhum: eles moram na branch `channels` e entram via `/add-discord`, `/add-whatsapp`.
  Se o rebase conflitar neles, dropa o commit `chore(channels)` e roda a skill de novo
  contra o upstream novo — o resultado é o mesmo e sem merge sujo.
- **Este install é hardened** (`NANOCLAW_HARDENED_IMAGE=true`), então a imagem do agente
  é `./container/build.sh pull`, nunca a forma nua — que sai com código 3 justamente pra
  não substituir os bytes puxados por um build local.
- **Carimbe o marcador antes de reiniciar**:
  `pnpm exec tsx scripts/upgrade-state.ts set "" update-nanoclaw`. Sem isso o tripwire
  (`src/upgrade-state.ts`) chama `process.exit(1)` no próximo boot, porque
  `data/upgrade-state.json` não bate com a versão do `package.json`.
- **`git reset --hard` não desfaz um update.** Ele volta só o código; marcador, `dist/`,
  versão do gateway e tag da imagem ficam no estado novo — e a divergência entre marcador
  e `package.json` impede o próximo boot. Rollback de verdade é reverter os quatro.
- **O `pnpm` do shell pode estar quebrado.** O mise não tem versão global de node setada,
  então os shims (`pnpm`, `ncl`, `bun`) morrem com `No version is set for shim`. Contorno:
  `export PATH=~/.local/share/mise/installs/node/25.3.0/bin:$PATH`. Definitivo:
  `mise use -g node@25.3.0`.
- **`container/agent-runner/node_modules` costuma não existir**, e sem ele o typecheck do
  container falha com `TS2688: Cannot find type definition file for 'bun'` e é pulado.
  `cd container/agent-runner && bun install --frozen-lockfile` faz a validação valer.
- **O aviso no topo do `CLAUDE.md`** é sobre trazer o v2 pra cima de uma instalação v1.
  Rebase de v2 em cima de v2, que é o caso aqui, não é isso.

## Dependências do host

Este install pressupõe, fora do repo:

- Um container `omniroute` no bridge docker padrão, servindo o wire format Anthropic em
  `/v1/messages` na porta 20128, com as credenciais dos providers (`cc/`, `gh/`, `oc/`).
- `ANTHROPIC_BASE_URL=http://omniroute:20128` no `.env` — o hostname nu é resolvido pro
  IP do bridge no spawn (`src/providers/claude.ts`).
- OneCLI para os demais segredos, incluindo o token do MCP do Linear
  (host-pattern `api.linear.app`, injetado no fio — nunca em `container.json`; o MCP e os tick scripts das células dependem dessa injeção).
  **O gateway binda em `172.17.0.1`, não no default `127.0.0.1`** — é como os
  containers o alcançam (`ONECLI_URL` no `.env`). Esse bind vem de env var, não está
  persistido: qualquer `docker compose up` em `~/.onecli` sem
  `ONECLI_BIND_HOST=172.17.0.1` rebinda pra localhost — o health host-side continua
  passando e toda chamada credenciada dos agentes morre no proxy. O comando do
  `docs/onecli-upgrades.md` verbatim cai exatamente nisso; sempre passe a variável
  (ou persista num `~/.onecli/.env`).
- Timer systemd de usuário `nanoclaw-linear-token.timer`, semanal, chamando
  `scripts/refresh-linear-token.sh`. O grant client_credentials do Linear dá 30
  dias e não tem refresh token; sem isso o MCP começa a dar 401 um mês depois de
  configurado.
- `~/.local/share/nanoclaw-bin/rtk` — cópia do binário do host, montada
  read-only nos grupos de projeto. Não dá pra montar `~/.local/bin` direto: é
  padrão bloqueado em `mount-security` (o host executa `onecli` e `claude` de
  lá). Ao atualizar o rtk no host, recopie.
- Mount allowlist com roots ro para `~/nanoclaw-v2/groups`, `~/nanoclaw-v2/genomes` e
  `~/nanoclaw-v2/projects` (visão do orquestrador + insumos de mitose). Nunca
  allowlistar a raiz do repo — o check de blocked-pattern não desce e exporia `.env`.
- `~/.config/nanoclaw/cell-envelope.json` — limites da organização celular
  (max_cells/max_per_role/idle_days/roles). Ausente = mitose autônoma desligada
  (todo create de célula volta a pedir aprovação). Editar só à mão.
