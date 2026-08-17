# Fase B — Acesso direto do Mano: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mano roda git direto nos repos de `~/dev` e enxerga o estado das células (workspaces, memória, run-logs) sem delegar — mata a reclamação de atraso.

**Architecture:** Dois mounts novos no grupo do Mano (`~/dev` rw, `groups/` ro) via `ncl groups config add-mount`, com as roots correspondentes na mount allowlist; convenção de escrita anexada ao `instructions.prepend.md` dele. Zero mudança de código-fonte.

**Tech Stack:** ncl CLI (host), mount allowlist (`~/.config/nanoclaw/mount-allowlist.json`), Docker.

**Spec:** `docs/superpowers/specs/2026-08-17-cell-org-design.md` (Seção "Decisões fechadas" → Acesso do Mano; Seção 5 → convenção de escrita)

## Global Constraints

- Grupo do Mano: `ag-1786369592817-jj5iw5`, folder `dm-with-andeen`.
- Mounts adicionais SEMPRE caem em `/workspace/extra/<container-name>` — caminho absoluto em `--container` é rejeitado.
- `--rw` é pedido, não concessão: a root do allowlist precisa de `allowReadWrite: true`, senão o spawn força read-only SEM erro.
- NUNCA allowlistar `~/nanoclaw-v2` inteiro — o check de blocked-pattern roda só na ROOT do mount e não desce; a raiz do repo exporia `.env`. Roots estreitas apenas.
- Todo comando `ncl` roda no host (socket confiável — sem approval card).
- O serviço é `nanoclaw-v2-2156afdf` (systemd user). `pnpm` exige `PATH` com o node do mise (`~/.local/share/mise/installs/node/25.3.0/bin`) ou o global do mise configurado.

---

### Task 1: Allowlist — roots novas (groups, genomes, projects)

**Files:**
- Modify: `~/.config/nanoclaw/mount-allowlist.json`

**Interfaces:**
- Produces: roots `~/nanoclaw-v2/groups` (ro), `~/nanoclaw-v2/genomes` (ro), `~/nanoclaw-v2/projects` (ro) — as duas últimas são consumidas pela Fase A/C (genomas e perfis montados no Mano para a mitose).

- [ ] **Step 1: Ler o arquivo atual**

Run: `cat ~/.config/nanoclaw/mount-allowlist.json`
Expected: JSON com roots `~/dev` (rw) e `~/.local/share/nanoclaw-bin` (ro), `blockedPatterns: []`.

- [ ] **Step 2: Escrever o arquivo com as roots novas**

Substituir o conteúdo por:

```json
{
  "allowedRoots": [
    { "path": "~/dev", "allowReadWrite": true, "description": "Projetos de desenvolvimento" },
    { "path": "~/.local/share/nanoclaw-bin", "allowReadWrite": false, "description": "Binarios do host expostos aos containers (somente leitura)" },
    { "path": "~/nanoclaw-v2/groups", "allowReadWrite": false, "description": "Workspaces das celulas — visao read-only do orquestrador" },
    { "path": "~/nanoclaw-v2/genomes", "allowReadWrite": false, "description": "Genomas de papel — leitura para mitose" },
    { "path": "~/nanoclaw-v2/projects", "allowReadWrite": false, "description": "Perfis de projeto — leitura para mitose" }
  ],
  "blockedPatterns": []
}
```

- [ ] **Step 3: Validar o JSON**

Run: `python3 -m json.tool ~/.config/nanoclaw/mount-allowlist.json > /dev/null && echo OK`
Expected: `OK`

*(Sem commit — o arquivo vive fora do repo. A Task 4 registra a dependência no CUSTOMIZATIONS.md.)*

### Task 2: Mounts do Mano

**Files:**
- Modify: DB central via `ncl` (tabela `container_configs`, additional_mounts do grupo `ag-1786369592817-jj5iw5`)

**Interfaces:**
- Produces: `/workspace/extra/dev` (rw) e `/workspace/extra/cells` (ro) dentro do container do Mano. A Fase A adiciona `genomes`/`projects` quando os diretórios existirem no repo.

- [ ] **Step 1: Adicionar o mount rw de ~/dev**

```bash
ncl groups config add-mount --id ag-1786369592817-jj5iw5 --host ~/dev --container dev --rw
```

Expected: saída de sucesso listando o mount com `readonly: false`.

- [ ] **Step 2: Adicionar o mount ro de groups/**

```bash
ncl groups config add-mount --id ag-1786369592817-jj5iw5 --host /home/andeen/nanoclaw-v2/groups --container cells --ro
```

- [ ] **Step 3: Conferir o config**

Run: `ncl groups config get --id ag-1786369592817-jj5iw5`
Expected: `additional_mounts` com os dois entries — `~/dev` → `dev` com `"readonly": false`, `.../groups` → `cells` com `"readonly": true`.

### Task 3: Convenção de escrita nas instruções do Mano

**Files:**
- Modify: `groups/dm-with-andeen/instructions.prepend.md` (append no fim)

**Interfaces:**
- Produces: seção `## Acesso direto aos repos e às células` que a Fase A referencia ao atualizar a tabela de delegação.

- [ ] **Step 1: Anexar a seção**

Append ao fim de `groups/dm-with-andeen/instructions.prepend.md`:

```markdown

## Acesso direto aos repos e às células

Tu tens agora:

- `/workspace/extra/dev` — TODOS os repos de `~/dev`, **read-write**.
- `/workspace/extra/cells` — os workspaces dos outros agentes (`groups/` do host), **read-only**: memória (`<célula>/memory/`), run-logs de tasks (`<célula>/tasks/*.md`), instruções.

Usa isso para responder na hora — `git -C /workspace/extra/dev/<repo> log/status/diff`, ler o que uma célula anda fazendo — em vez de delegar e esperar.

**Convenção de escrita (obrigatória):** as células são donas das branches delas. Tu LÊS tudo à vontade; só escreves/commitas num repo quando (a) o andeen mandar explicitamente, ou (b) nenhuma célula tem issue ativa (In Progress) naquele repo no board. Nunca commites na branch de uma issue claimed por outra célula.
```

- [ ] **Step 2: Verificar que o arquivo não foi truncado**

Run: `head -3 groups/dm-with-andeen/instructions.prepend.md && tail -5 groups/dm-with-andeen/instructions.prepend.md`
Expected: cabeçalho original intacto no topo; a convenção nova no fim.

- [ ] **Step 3: Commit**

```bash
git add -f groups/dm-with-andeen/instructions.prepend.md
git commit -m "chore(groups): acesso direto do Mano — mounts dev/cells + convenção de escrita"
```

*(`-f` porque `groups/*` é gitignored; os `instructions.prepend.md` já são trackeados assim neste fork.)*

### Task 4: Registrar no CUSTOMIZATIONS.md

**Files:**
- Modify: `CUSTOMIZATIONS.md` (seção "Dependências do host")

- [ ] **Step 1: Anexar o bullet**

Na seção `## Dependências do host`, adicionar:

```markdown
- Mount allowlist com roots ro para `~/nanoclaw-v2/groups`, `~/nanoclaw-v2/genomes` e
  `~/nanoclaw-v2/projects` (visão do orquestrador + insumos de mitose). Nunca
  allowlistar a raiz do repo — o check de blocked-pattern não desce e exporia `.env`.
```

- [ ] **Step 2: Commit**

```bash
git add CUSTOMIZATIONS.md
git commit -m "docs: registrar roots novas do mount allowlist"
```

### Task 5: Respawn e verificação de ponta a ponta

**Files:** nenhum (operacional)

- [ ] **Step 1: Respawn do Mano com mensagem de teste**

```bash
ncl groups restart --id ag-1786369592817-jj5iw5 --message "Ganhaste acesso direto: /workspace/extra/dev (rw, todos os repos) e /workspace/extra/cells (ro, workspaces das células). Testa agora: roda git -C /workspace/extra/dev/point-of-sale log --oneline -3 e me manda o resultado no Discord."
```

- [ ] **Step 2: Verificar os mounts no container vivo**

Aguardar o spawn (~15s), então:

```bash
docker inspect $(docker ps --filter name=nanoclaw-v2-dm-with-andeen --format '{{.Names}}' | head -1) \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} rw={{.RW}}{{println}}{{end}}' | grep extra
```

Expected: `/home/andeen/dev -> /workspace/extra/dev rw=true` e `.../groups -> /workspace/extra/cells rw=false`. **Se `rw=false` no dev**: o allowlist não foi lido — conferir Task 1 e reiniciar o serviço (`systemctl --user restart nanoclaw-v2-2156afdf`).

- [ ] **Step 3: Confirmar a resposta do Mano no Discord**

O Mano deve mandar as 3 linhas do `git log` do POS no DM. Isso prova o ciclo inteiro: mount rw + git funcionando de dentro do container.
