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
| `fix(ncl)` | `--rw` em `groups config add-mount` | Some se o upstream aceitar o PR |
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

Duas armadilhas:

- **Os adapters de canal não são pra resolver na mão.** Trunk não versiona adapter
  nenhum: eles moram na branch `channels` e entram via `/add-discord`, `/add-whatsapp`.
  Se o rebase conflitar neles, dropa o commit `chore(channels)` e roda a skill de novo
  contra o upstream novo — o resultado é o mesmo e sem merge sujo.
- **O aviso no topo do `CLAUDE.md`** é sobre trazer o v2 pra cima de uma instalação v1.
  Rebase de v2 em cima de v2, que é o caso aqui, não é isso.

Existe também a skill `/update-nanoclaw`, que faz esse fluxo de forma guiada.

## Dependências do host

Este install pressupõe, fora do repo:

- Um container `omniroute` no bridge docker padrão, servindo o wire format Anthropic em
  `/v1/messages` na porta 20128, com as credenciais dos providers (`cc/`, `gh/`, `oc/`).
- `ANTHROPIC_BASE_URL=http://omniroute:20128` no `.env` — o hostname nu é resolvido pro
  IP do bridge no spawn (`src/providers/claude.ts`).
- OneCLI para os demais segredos, incluindo o token do MCP do Linear
  (host-pattern `mcp.linear.app`, injetado no fio — nunca em `container.json`).
- Timer systemd de usuário `nanoclaw-linear-token.timer`, semanal, chamando
  `scripts/refresh-linear-token.sh`. O grant client_credentials do Linear dá 30
  dias e não tem refresh token; sem isso o MCP começa a dar 401 um mês depois de
  configurado.
- `~/.local/share/nanoclaw-bin/rtk` — cópia do binário do host, montada
  read-only nos grupos de projeto. Não dá pra montar `~/.local/bin` direto: é
  padrão bloqueado em `mount-security` (o host executa `onecli` e `claude` de
  lá). Ao atualizar o rtk no host, recopie.
