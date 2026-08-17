# Fase C — Orquestração: envelope, loops, supervisor, mitose: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O sistema se auto-opera: toda célula tem loop, o supervisor do Mano vigia o board, e o Mano executa mitose/absorção autônomas dentro de um envelope enforced no host — com notificação a você por dentro do envelope e card de aprovação por fora.

**Architecture:** A ÚNICA mudança de código-fonte do projeto inteiro vive aqui: um módulo de envelope (`src/cli/cell-envelope.ts`) + um branch em `commandDecide` (`src/cli/guard.ts`) + um branch no guard a2a + notificação no call site do dispatch. Fato-chave do levantamento: `groups create/delete` de container JÁ seguram para aprovação hoje (guard.ts:102-104, mesmo `cli_scope: global`) — o envelope AFROUXA esse hold para alvos-célula dentro dos limites, mantendo o fluxo de `pending_approvals` existente para o estouro. O resto é config: tasks, prompts, runbooks.

**Tech Stack:** TypeScript (host, vitest), guard seam (`src/guard/`), `ncl tasks`, Linear MCP, agent-to-agent MCP.

**Spec:** `docs/superpowers/specs/2026-08-17-cell-org-design.md`

## Global Constraints

- **Pré-requisito duro:** piloto da Fase A registrado na spec ("Fase C liberada"). Sem isso, parar.
- `decide` de guard é SÍNCRONO e fail-closed (exceção = DENY). Sem IO assíncrono; `fs.readFileSync` e queries `better-sqlite3` (síncronas) são aceitáveis.
- `defineGuardedAction` com nome duplicado LANÇA no import — o plug-point para comandos ncl é `commandDecide`, nunca um action novo de catálogo.
- Conformance (`src/guard/conformance.test.ts`) exige: comando `access: 'approval'` mantém `grantActionName === 'cli_command'`. O envelope NÃO muda isso — o hold de estouro replay pelo handler existente.
- Testes novos em vitest (Node), padrão do repo. `pnpm test` inteiro verde antes de qualquer restart.
- Envelope em `~/.config/nanoclaw/cell-envelope.json` — path bloqueado para mounts de container (`.config/nanoclaw` é blocked pattern): célula nenhuma o lê. Ausência do arquivo = envelope desligado = comportamento atual (HOLD), fail-closed.
- Células = grupos cujo **name ou folder** casa `<papel>` ou `<papel>-<slug>` com papel em `envelope.roles` (name cobre as conversões legadas dev-pos/dev-portfolio, cujos folders são `point-of-sale`/`portfolio`).
- IDs: Mano `ag-1786369592817-jj5iw5`; dev-pos `ag-32f8d81b-c411-4b4e-9df4-38d68ad77a40`; dev-portfolio `ag-f60a2735-1700-48b1-82bf-ab8bd62904ab`; células-base = IDs anotados na Task 7 da Fase A.
- Commits: um por task, branch `andeen/custom`. Serviço: `systemctl --user restart nanoclaw-v2-2156afdf` (só na Task 9).

---

### Task 1: Envelope no host + módulo de leitura/contagem (TDD)

**Files:**
- Create: `~/.config/nanoclaw/cell-envelope.json` (fora do repo)
- Create: `src/cli/cell-envelope.ts`
- Test: `src/cli/cell-envelope.test.ts`

**Interfaces:**
- Produces: `readCellEnvelope(): CellEnvelope | null`, `cellRoleOf(nameOrFolder: string, env: CellEnvelope): string | null`, `countCells(env: CellEnvelope): { total: number; byRole: Record<string, number> }`, `CELL_ENVELOPE_ALLOW_REASON = 'cell-envelope: within limits'`. Override de path para testes via env `NANOCLAW_CELL_ENVELOPE`.

- [ ] **Step 1: Escrever o envelope real**

```bash
cat > ~/.config/nanoclaw/cell-envelope.json <<'EOF'
{
  "max_cells": 10,
  "max_per_role": 3,
  "idle_days": 7,
  "roles": ["dev", "qa", "po", "design", "devops", "arch"]
}
EOF
python3 -m json.tool ~/.config/nanoclaw/cell-envelope.json > /dev/null && echo OK
```

- [ ] **Step 2: Escrever os testes que falham**

`src/cli/cell-envelope.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readCellEnvelope, cellRoleOf, CELL_ENVELOPE_ALLOW_REASON } from './cell-envelope.js';

const tmp = path.join(os.tmpdir(), `cell-envelope-test-${process.pid}.json`);

describe('readCellEnvelope', () => {
  afterEach(() => {
    delete process.env.NANOCLAW_CELL_ENVELOPE;
    fs.rmSync(tmp, { force: true });
  });

  it('lê o arquivo apontado por NANOCLAW_CELL_ENVELOPE', () => {
    fs.writeFileSync(tmp, JSON.stringify({ max_cells: 10, max_per_role: 3, idle_days: 7, roles: ['dev', 'qa'] }));
    process.env.NANOCLAW_CELL_ENVELOPE = tmp;
    expect(readCellEnvelope()).toEqual({ max_cells: 10, max_per_role: 3, idle_days: 7, roles: ['dev', 'qa'] });
  });

  it('arquivo ausente → null (envelope desligado, fail-closed)', () => {
    process.env.NANOCLAW_CELL_ENVELOPE = tmp; // não existe
    expect(readCellEnvelope()).toBeNull();
  });

  it('JSON corrompido ou campos faltando → null', () => {
    fs.writeFileSync(tmp, '{nope');
    process.env.NANOCLAW_CELL_ENVELOPE = tmp;
    expect(readCellEnvelope()).toBeNull();
    fs.writeFileSync(tmp, JSON.stringify({ max_cells: 10 }));
    expect(readCellEnvelope()).toBeNull();
  });
});

describe('cellRoleOf', () => {
  const env = { max_cells: 10, max_per_role: 3, idle_days: 7, roles: ['dev', 'qa'] };
  it('papel exato e papel-slug casam', () => {
    expect(cellRoleOf('dev', env)).toBe('dev');
    expect(cellRoleOf('dev-pos', env)).toBe('dev');
    expect(cellRoleOf('qa-portfolio', env)).toBe('qa');
  });
  it('não-célula → null', () => {
    expect(cellRoleOf('dm-with-andeen', env)).toBeNull();
    expect(cellRoleOf('developer', env)).toBeNull(); // prefixo sem hífen não casa
    expect(cellRoleOf('', env)).toBeNull();
  });
});

describe('CELL_ENVELOPE_ALLOW_REASON', () => {
  it('é estável — o dispatch casa notificação por este valor', () => {
    expect(CELL_ENVELOPE_ALLOW_REASON).toBe('cell-envelope: within limits');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm exec vitest run src/cli/cell-envelope.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar `src/cli/cell-envelope.ts`**

```ts
/**
 * Envelope da organização celular (spec 2026-08-17-cell-org-design).
 *
 * O arquivo vive em ~/.config/nanoclaw/ — blocked pattern de mount, fora do
 * alcance de qualquer container. Ausente ou inválido → null → os guards mantêm
 * o comportamento atual (hold para aprovação), fail-closed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface CellEnvelope {
  max_cells: number;
  max_per_role: number;
  idle_days: number;
  roles: string[];
}

export const CELL_ENVELOPE_ALLOW_REASON = 'cell-envelope: within limits';

function envelopePath(): string {
  return process.env.NANOCLAW_CELL_ENVELOPE
    ?? path.join(os.homedir(), '.config', 'nanoclaw', 'cell-envelope.json');
}

export function readCellEnvelope(): CellEnvelope | null {
  try {
    const raw = JSON.parse(fs.readFileSync(envelopePath(), 'utf8')) as Partial<CellEnvelope>;
    if (
      typeof raw.max_cells !== 'number' || typeof raw.max_per_role !== 'number' ||
      typeof raw.idle_days !== 'number' || !Array.isArray(raw.roles) || raw.roles.length === 0
    ) return null;
    return raw as CellEnvelope;
  } catch {
    return null;
  }
}

/** Papel da célula se nameOrFolder é `<papel>` ou `<papel>-<slug>`; senão null. */
export function cellRoleOf(nameOrFolder: string, env: CellEnvelope): string | null {
  for (const role of env.roles) {
    if (nameOrFolder === role || nameOrFolder.startsWith(role + '-')) return role;
  }
  return null;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm exec vitest run src/cli/cell-envelope.test.ts`
Expected: PASS.

- [ ] **Step 6: Adicionar `countCells`** — depende do accessor do DB central. Ler a linha de import de DB em `src/command-gate.ts` (que consulta `user_roles` direto) e usar o MESMO accessor. Append em `cell-envelope.ts`:

```ts
// import do accessor: copiar o padrão de src/command-gate.ts
export function countCells(env: CellEnvelope): { total: number; byRole: Record<string, number> } {
  const rows = /* db */.prepare('SELECT name, folder FROM agent_groups').all() as Array<{ name: string; folder: string }>;
  const byRole: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const role = cellRoleOf(r.name, env) ?? cellRoleOf(r.folder, env);
    if (!role) continue;
    total += 1;
    byRole[role] = (byRole[role] ?? 0) + 1;
  }
  return { total, byRole };
}
```

Substituir `/* db */` pelo accessor real encontrado. Teste (append no test file, usando o helper de DB in-memory que os testes de `src/cli/` já usam — ler `src/cli/crud.test.ts` para o padrão de setup e replicar):

```ts
describe('countCells', () => {
  // setup de DB conforme o padrão de crud.test.ts; inserir agent_groups:
  // (name 'dev', folder 'dev'), (name 'dev-pos', folder 'point-of-sale'),
  // (name 'Mano', folder 'dm-with-andeen')
  it('conta por name OU folder; ignora não-células', () => {
    const env = { max_cells: 10, max_per_role: 3, idle_days: 7, roles: ['dev'] };
    expect(countCells(env)).toEqual({ total: 2, byRole: { dev: 2 } });
  });
});
```

- [ ] **Step 7: Rodar tudo e commitar**

```bash
pnpm exec vitest run src/cli/cell-envelope.test.ts   # PASS
git add src/cli/cell-envelope.ts src/cli/cell-envelope.test.ts
git commit -m "feat(guard): módulo do envelope celular — leitura, papel, contagem"
```

### Task 2: Branch do envelope em commandDecide (TDD)

**Files:**
- Modify: `src/cli/guard.ts` (função `commandDecide`, ~linhas 48-107)
- Test: `src/cli/cell-envelope-guard.test.ts`

**Interfaces:**
- Consumes: Task 1. `commandGuardSpec(cmd).decide(input)` é o seam público de teste (`src/cli/guard.ts:31-46`).
- Produces: para ator agent com `cli_scope: global` e alvo-célula: `groups-create` → ALLOW dentro do envelope / HOLD no estouro; demais comandos da família → ALLOW. Sem envelope ou alvo não-célula → comportamento atual intacto.

- [ ] **Step 1: Confirmar os nomes exatos dos comandos da família** — os nomes registrados vêm do loop de customOperations/CRUD. Run:

```bash
grep -n "name:" src/cli/crud.ts | head -20
grep -rn "'groups-" src/cli/ --include='*.ts' | grep -v test | head
```

Expected: padrão `<resource>-<verb>` (`groups-create`, `groups-delete`) e o formato dos config subverbs (ex.: `groups-config-update`, `groups-config-add-mount` — anotar os nomes REAIS). O teste do Step 2 valida cada nome contra o registry real (import dos barrels) — nome errado = teste vermelho.

- [ ] **Step 2: Escrever os testes que falham**

`src/cli/cell-envelope-guard.test.ts` — usa o registry real (side-effect imports, mesmo padrão do conformance test) + envelope de teste via `NANOCLAW_CELL_ENVELOPE` + DB in-memory (padrão de `crud.test.ts`) com: Mano (`cli_scope: global`), grupos-célula até o limite, e um grupo não-célula. Casos, todos via `commandGuard('<nome>').decide` ou `commandGuardSpec`:

```ts
// 1. groups-create de agent global com folder 'qa-pos', envelope com folga → ALLOW
//    com reason === CELL_ENVELOPE_ALLOW_REASON
// 2. groups-create com byRole.dev já em max_per_role (3), folder 'dev-novo' → HOLD
// 3. groups-create com total já em max_cells (10), folder 'qa-novo' → HOLD
// 4. groups-create com folder 'meu-projeto' (não-célula) → HOLD (comportamento atual)
// 5. groups-create SEM envelope (env var apontando p/ arquivo inexistente) → HOLD (atual)
// 6. groups-delete de agent global com --id de grupo-célula → ALLOW (absorção autônoma)
// 7. groups-config-update com --id de célula, agent global → ALLOW
// 8. groups-config-add-mount com --id de célula, agent global → ALLOW
//    (o hostOnly é contornado SÓ neste caso; validateMount re-valida no spawn)
// 9. groups-config-add-mount com --id NÃO-célula, agent global → DENY (hostOnly intacto)
// 10. groups-create de agent com cli_scope 'group' → HOLD/DENY como hoje (envelope
//     só vale para global — só o orquestrador opera células)
// 11. ator host → ALLOW sempre (trusted socket, inalterado)
```

Escrever os 11 com asserts concretos (`expect(d.effect).toBe('allow')` / `'hold'` / `'deny'`, e no caso 1 `expect(d.reason).toBe(CELL_ENVELOPE_ALLOW_REASON)`).

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm exec vitest run src/cli/cell-envelope-guard.test.ts`
Expected: FAIL nos casos 1, 6, 7, 8 (o resto já passa — é o comportamento atual; se um "já passa" falhar, o entendimento do atual está errado — investigar antes de implementar).

- [ ] **Step 4: Implementar o branch em `commandDecide`**

Em `src/cli/guard.ts`, adicionar ANTES do check `cmd.hostOnly` (~linha 57):

```ts
// Envelope celular (spec 2026-08-17): o orquestrador (agent, cli_scope global)
// opera células autonomamente dentro do envelope do host. create conta contra
// os limites; delete/config/destinations em alvo-célula passam direto. Envelope
// ausente ou alvo não-célula → cai nos checks normais (hold/deny de sempre).
// Vem antes do hostOnly: add-mount em célula é parte da mitose; validateMount
// re-valida contra o allowlist no spawn de qualquer forma.
if (input.actor.kind === 'agent' && callerScopeOf(input) === 'global') {
  const env = readCellEnvelope();
  if (env && CELL_FAMILY_COMMANDS.has(cmd.name)) {
    const target = resolveCellTarget(cmd.name, input.payload, env);
    if (target) {
      if (cmd.name === 'groups-create') {
        const { total, byRole } = countCells(env);
        if (total + 1 > env.max_cells) return HOLD(`cell-envelope: max_cells (${env.max_cells}) atingido`);
        if ((byRole[target.role] ?? 0) + 1 > env.max_per_role)
          return HOLD(`cell-envelope: max_per_role (${env.max_per_role}) atingido para ${target.role}`);
      }
      return ALLOW(CELL_ENVELOPE_ALLOW_REASON);
    }
  }
}
```

Com, no mesmo arquivo:

```ts
const CELL_FAMILY_COMMANDS = new Set([
  'groups-create', 'groups-delete', 'groups-restart',
  // + os nomes REAIS dos config subverbs e destinations confirmados no Step 1,
  // ex.: 'groups-config-update', 'groups-config-add-mount', 'groups-config-add-mcp-server',
  // 'groups-config-add-package', 'groups-config-remove-mount', 'groups-config-remove-mcp-server',
  // 'groups-config-remove-package', 'destinations-add', 'destinations-remove',
]);

/** Alvo-célula do comando: create usa o folder pedido; o resto resolve o grupo por id. */
function resolveCellTarget(
  cmdName: string,
  payload: Record<string, unknown>,
  env: CellEnvelope,
): { role: string } | null {
  if (cmdName === 'groups-create') {
    const folder = typeof payload.folder === 'string' ? payload.folder : null;
    if (!folder) return null; // path de template — fora do envelope
    const role = cellRoleOf(folder, env);
    return role ? { role } : null;
  }
  const id = typeof payload.id === 'string' ? payload.id
    : typeof payload.agent_group_id === 'string' ? payload.agent_group_id : null;
  if (!id) return null;
  const g = /* lookup síncrono de agent_groups por id — reusar o accessor da Task 1 */;
  if (!g) return null;
  const role = cellRoleOf(g.name, env) ?? cellRoleOf(g.folder, env);
  return role ? { role } : null;
}
```

`callerScopeOf`: o `commandDecide` atual já resolve o cli_scope do caller (usado nas linhas 64-100) — reusar a MESMA resolução, não duplicar (extrair para variável local no topo da função se preciso).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm exec vitest run src/cli/cell-envelope-guard.test.ts src/guard/conformance.test.ts src/cli/`
Expected: PASS geral — inclusive conformance (o envelope não toca grantActionName) e os testes existentes de guard/dispatch (comportamento fora do envelope inalterado).

- [ ] **Step 6: Commit**

```bash
git add src/cli/guard.ts src/cli/cell-envelope-guard.test.ts src/cli/cell-envelope.ts
git commit -m "feat(guard): envelope celular em commandDecide — autonomia dentro dos limites"
```

### Task 3: Envelope no guard agent-to-agent (TDD)

**Files:**
- Modify: `src/modules/agent-to-agent/guard.ts` (decide de `agents.create`, ~linhas 44-56)
- Test: append em `src/cli/cell-envelope-guard.test.ts` (ou o test file do módulo a2a se existir — conferir com `ls src/modules/agent-to-agent/*.test.ts` e seguir o padrão local)

**Interfaces:**
- Consumes: Task 1. O a2a `agents.create` hoje dá ALLOW para cli_scope global — a rota de mitose do Mano.
- Produces: create de célula via a2a conta contra o envelope (ALLOW/HOLD); nome não-célula mantém o ALLOW atual.

- [ ] **Step 1: Ler o decide atual** — `src/modules/agent-to-agent/guard.ts:44-56` — e identificar de onde vem o NOME do agente pedido no payload (a derivação de folder usa `normalizeName`).

- [ ] **Step 2: Testes que falham** — mesmos moldes da Task 2:

```ts
// 1. agents.create (a2a) por agent global, name 'qa-pos', envelope com folga → ALLOW
// 2. idem com byRole.qa em max_per_role → HOLD
// 3. idem name 'assistente-pessoal' (não-célula) → ALLOW (comportamento atual preservado)
// 4. sem envelope → ALLOW (comportamento atual; a2a nunca segurou global)
```

- [ ] **Step 3: Implementar** — no decide, dentro do branch de global-scope, antes do ALLOW atual:

```ts
const env = readCellEnvelope();
if (env) {
  const role = cellRoleOf(normalizeName(String(input.payload.name ?? '')), env);
  if (role) {
    const { total, byRole } = countCells(env);
    if (total + 1 > env.max_cells) return HOLD(`cell-envelope: max_cells (${env.max_cells}) atingido`);
    if ((byRole[role] ?? 0) + 1 > env.max_per_role)
      return HOLD(`cell-envelope: max_per_role (${env.max_per_role}) atingido para ${role}`);
    return ALLOW(CELL_ENVELOPE_ALLOW_REASON);
  }
}
```

Atenção ao conformance: se o decide do a2a passar a poder segurar (HOLD), o action `agents.create` PRECISA ter `grantActionName` + approval handler registrado. Conferir no spec do action (`src/modules/agent-to-agent/guard.ts`) se já tem (o path não-global já segura hoje? verificar); se não tiver, o HOLD acima exige adicioná-lo apontando para o handler de create existente — o conformance test acusa se faltar.

- [ ] **Step 4: Rodar** — `pnpm exec vitest run src/modules/agent-to-agent src/guard/conformance.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent-to-agent/guard.ts src/cli/cell-envelope-guard.test.ts
git commit -m "feat(guard): envelope celular também na rota a2a agents.create"
```

### Task 4: Notificação ao dono nos allows de envelope

**Files:**
- Create: `src/modules/cell-notify.ts`
- Modify: `src/cli/dispatch.ts` (pós-execução, ~linha 163+), `src/modules/agent-to-agent/create-agent.ts` (pós-create)
- Test: `src/modules/cell-notify.test.ts`

**Interfaces:**
- Consumes: `CELL_ENVELOPE_ALLOW_REASON` (o dispatch casa a notificação pela reason do allow); mecanismo mínimo de DM proativo: `ensureUserDm` (`src/modules/permissions/user-dm.ts:54`) + `getDeliveryAdapter()` (`src/delivery.ts:100`) + `getOwners()` (`src/modules/permissions/db/user-roles.ts:62`).
- Produces: `notifyOwnerCellEvent(text: string): Promise<void>` — fire-and-forget, nunca lança.

- [ ] **Step 1: Teste do formatador** (a entrega em si é verificada e2e na Task 8):

`src/modules/cell-notify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCellEvent } from './cell-notify.js';

describe('formatCellEvent', () => {
  it('monta a linha de mitose', () => {
    expect(formatCellEvent('create', 'qa-pos', 'fila do qa com 6 issues')).toBe(
      '🧬 Mitose: célula `qa-pos` criada (fila do qa com 6 issues). Dentro do envelope — nenhuma ação necessária.',
    );
  });
  it('monta a linha de absorção', () => {
    expect(formatCellEvent('delete', 'qa-pos', 'ociosa há 8 dias')).toBe(
      '🫧 Absorção: célula `qa-pos` removida (ociosa há 8 dias). Dentro do envelope — nenhuma ação necessária.',
    );
  });
});
```

- [ ] **Step 2: Implementar `src/modules/cell-notify.ts`**

```ts
/**
 * Notificação proativa ao dono para eventos de envelope celular (allow, não
 * aprovação). Caminho mínimo já usado em reason-capture.ts:100 — ensureUserDm +
 * adapter.deliver com {text}. Nunca lança: notificação perdida não pode
 * derrubar o comando que já executou.
 */
import { ensureUserDm } from './permissions/user-dm.js';
import { getDeliveryAdapter } from '../delivery.js';
import { getOwners } from './permissions/db/user-roles.js';
import { log } from '../log.js';

export function formatCellEvent(kind: 'create' | 'delete', cell: string, why: string): string {
  const head = kind === 'create' ? '🧬 Mitose' : '🫧 Absorção';
  const verb = kind === 'create' ? 'criada' : 'removida';
  return `${head}: célula \`${cell}\` ${verb} (${why}). Dentro do envelope — nenhuma ação necessária.`;
}

export async function notifyOwnerCellEvent(text: string): Promise<void> {
  try {
    const owner = getOwners()[0]?.user_id;
    if (!owner) return;
    const dm = await ensureUserDm(owner);
    const adapter = getDeliveryAdapter();
    if (!dm || !adapter) return;
    await adapter.deliver(dm.channel_type, dm.platform_id, null, 'chat-sdk', JSON.stringify({ text }));
  } catch (err) {
    log.warn('cell-notify falhou (evento perdido, comando já executou)', { err });
  }
}
```

Ajustar os paths de import aos reais (conferir onde `getOwners` é exportado — `src/modules/permissions/db/user-roles.ts`).

- [ ] **Step 3: Chamar nos dois call sites**

Em `src/cli/dispatch.ts`, após a execução bem-sucedida do handler (localizar o ponto pós-handler ~linha 163+), adicionar:

```ts
// Notificação de envelope: allow autônomo de célula avisa o dono (spec 2026-08-17).
if (
  callerIsAgent && decision.effect === 'allow' &&
  decision.reason === CELL_ENVELOPE_ALLOW_REASON &&
  (req.command === 'groups-create' || req.command === 'groups-delete')
) {
  const cell = String(req.args.folder ?? req.args.id ?? '?');
  void notifyOwnerCellEvent(formatCellEvent(req.command === 'groups-create' ? 'create' : 'delete', cell, 'via ncl pelo orquestrador'));
}
```

Adaptar os nomes locais (`callerIsAgent`, `decision`, `req`) aos identificadores reais do dispatch — a variável da decisão do guard existe no fluxo (linhas 113-117). Em `src/modules/agent-to-agent/create-agent.ts`, após o create bem-sucedido, o mesmo padrão quando a decisão veio com `CELL_ENVELOPE_ALLOW_REASON` — se a reason não estiver acessível ali, notificar quando `readCellEnvelope()` existe e `cellRoleOf(nome)` casa (equivalente na prática: só se chega ao create com allow).

- [ ] **Step 4: Rodar tudo**

```bash
pnpm exec vitest run src/modules/cell-notify.test.ts && pnpm run build && pnpm test
```

Expected: tudo verde (o build pega import errado; a suite pega regressão).

- [ ] **Step 5: Commit**

```bash
git add src/modules/cell-notify.ts src/modules/cell-notify.test.ts src/cli/dispatch.ts src/modules/agent-to-agent/create-agent.ts
git commit -m "feat(guard): notificação ao dono nos allows de envelope (mitose/absorção)"
```

### Task 5: Loops de todas as células (staggered)

**Files:** nenhum (tasks via ncl)

**Interfaces:**
- Consumes: ticks (`genomes/ticks/`), células da Fase A, piloto aprovado.
- Produces: 8 loop tasks. Minutos escalonados — 8 células acordando no mesmo instante é pico de spawn à toa.

- [ ] **Step 1: Ajustar o cron da dev-pos (piloto) para o slot dela**

```bash
ncl tasks update --id <series-id de loop-dev-pos> --recurrence "0,30 8-22 * * 1-5"
```

- [ ] **Step 2: Criar os demais** (`$ID_*` = IDs anotados na Fase A Task 7; prompt idêntico ao do piloto)

```bash
PROMPT='Tick do teu loop. O script output traz o tamanho da tua fila. Segue o Protocolo do board das tuas instruções: pega a issue mais antiga da fila, claim, re-read, trabalha, move o card. Uma issue por tick.'
ncl tasks create --group $ID_DEV    --name loop-dev    --recurrence "0,30 8-22 * * 1-5"  --prompt "$PROMPT" --script "$(cat genomes/ticks/dev.sh)"
ncl tasks create --group $ID_QA     --name loop-qa     --recurrence "5,35 8-22 * * 1-5"  --prompt "$PROMPT" --script "$(cat genomes/ticks/qa.sh)"
ncl tasks create --group $ID_PO     --name loop-po     --recurrence "10,40 8-22 * * 1-5" --prompt "$PROMPT" --script "$(cat genomes/ticks/po.sh)"
ncl tasks create --group $ID_DESIGN --name loop-design --recurrence "15,45 8-22 * * 1-5" --prompt "$PROMPT" --script "$(cat genomes/ticks/design.sh)"
ncl tasks create --group $ID_DEVOPS --name loop-devops --recurrence "20,50 8-22 * * 1-5" --prompt "$PROMPT" --script "$(cat genomes/ticks/devops.sh)"
ncl tasks create --group $ID_ARCH   --name loop-arch   --recurrence "25,55 8-22 * * 1-5" --prompt "$PROMPT" --script "$(cat genomes/ticks/arch.sh)"
sed 's|labels:{some:{name:{eq:\\"role:dev\\"}}}|labels:{some:{name:{eq:\\"role:dev\\"}}}, project:{name:{eq:\\"Portfolio\\"}}|' \
  genomes/ticks/dev.sh > /tmp/tick-dev-portfolio.sh
ncl tasks create --group ag-f60a2735-1700-48b1-82bf-ab8bd62904ab \
  --name loop-dev-portfolio --recurrence "2,32 8-22 * * 1-5" --prompt "$PROMPT" --script "$(cat /tmp/tick-dev-portfolio.sh)"
```

- [ ] **Step 3: Verificar** — `ncl tasks list --all` mostra as 8 séries pending com next-fire coerente. Após 1h de expediente, `ncl tasks list --all` de novo: runs acumulando como gated (fila vazia), `failed_runs: 0` em todas. `failed_runs > 0` numa série = o tick daquela célula está quebrando o contrato — investigar o run log antes de seguir.

### Task 6: Supervisor do Mano

**Files:** nenhum (task via ncl)

- [ ] **Step 1: Criar**

```bash
ncl tasks create --group ag-1786369592817-jj5iw5 --name supervisor \
  --recurrence "0 9,17 * * 1-5" \
  --prompt 'Tick do supervisor da organização celular. Faz nesta ordem, usando o MCP do Linear e os workspaces em /workspace/extra/cells/:
(1) DIGEST: monta um resumo do board TTK — issues por estado, o que fechou desde o último tick, o que está In Progress e há quanto tempo — e manda pro andeen (destination andeen) em no máximo 10 linhas.
(2) TRAVADAS: issue In Progress há mais de 4h sem commit novo na branch ttk-<n> (confere em /workspace/extra/dev/<repo>) e sem comentário novo → move de volta para Todo, comenta "supervisor: claim órfão, devolvida à fila", mantém os labels.
(3) MITOSE: fila de algum papel com mais de 5 issues paradas há mais de um tick, ou célula que te pediu clone → executa o runbook de mitose das tuas instruções. Os limites são enforced no host — dentro do envelope passa direto (o andeen é notificado automaticamente), no estouro vira card de aprovação; não tentes contornar um hold.
(4) ABSORÇÃO: célula especializada sem issue tocada há mais de 7 dias (run logs em /workspace/extra/cells/<folder>/tasks/ e atividade no board) → executa o runbook de absorção.
Fora do horário 8-22 não rodas (o cron garante). Não inventes trabalho: sem nada a reportar em (2)-(4), o digest diz isso numa linha.'
```

- [ ] **Step 2: Disparar uma vez e conferir** — `ncl tasks run --id <series-id de supervisor>`; o digest chega no teu DM do Discord em ~5 min. Sem digest → `ncl tasks get --id <series>` + `logs/nanoclaw.error.log`.

### Task 7: Runbooks de mitose e absorção no Mano

**Files:**
- Modify: `groups/dm-with-andeen/instructions.prepend.md` (append)

- [ ] **Step 1: Conferir a ferramenta a2a de create** — ler o schema do MCP tool de criação de agente em `container/agent-runner/src/mcp-tools/` (procurar `agents` / `create_agent`) e anotar os nomes REAIS dos parâmetros (nome, instruções/persona). O runbook abaixo assume `name` + `instructions`; se os nomes divergirem, ajustar o texto do runbook antes de commitar.

- [ ] **Step 2: Append no instructions.prepend.md do Mano**

```markdown

## Runbook: mitose

Quando: fila de um papel não baixa (>5 issues por mais de um tick) OU uma célula
pediu clone. Decisão é tua; os limites (10 células, 3 por papel) são enforced no
host — dentro do envelope o create passa e o andeen é notificado sozinho; no
estouro vira card de aprovação. NUNCA tentes contornar um hold.

1. Lê o genoma: /workspace/extra/genomes/<papel>.md
2. Lê o perfil: /workspace/extra/projects/<slug>.json
3. Cria a célula via a2a create: name EXATAMENTE `<papel>-<slug>` (ex.: qa-pos),
   instructions = conteúdo do genoma + este preâmbulo no topo:
   "És a célula <papel>-<slug>, especializada no projeto <Nome>. Só trabalhas
   issues do project <Nome> no board. Claim: `claimed by <papel>-<slug>`."
4. Config via ncl (o envelope libera para células):
   - ncl groups config update --id <id-novo> --model <modelo do papel, em /workspace/extra/genomes/MODELS.md>
   - Para cada mount do perfil: ncl groups config add-mount --id <id-novo> --host <host> --container <container> --rw|--ro
   - Para cada MCP do perfil: ncl groups config add-mcp-server --id <id-novo> --name <n> --command <cmd> --args '<args json>'
   - Se o perfil tem packages: ncl groups config add-package --id <id-novo> --npm <pkg> (um por flag) e depois ncl groups restart --id <id-novo> --rebuild
5. Destinations: ncl destinations add --agent-group-id <id-novo> --local-name mano --target-type agent --target-id ag-1786369592817-jj5iw5
   (e para papel dev/qa, o atalho dev↔qa correspondente)
6. Loop: pega o tick do papel em /workspace/extra/genomes/ticks/<papel>.sh,
   adiciona o filtro de project (project:{name:{eq:"<Nome>"}}) na query, e:
   ncl tasks create --group <id-novo> --name loop-<papel>-<slug> --recurrence "<minuto livre>,<minuto+30> 8-22 * * 1-5" --prompt "<prompt padrão dos loops>" --script "<tick ajustado>"
7. Confere: ncl groups config get --id <id-novo> — modelo, mounts e MCP corretos.

## Runbook: absorção

Quando: célula ESPECIALIZADA sem issue tocada há mais de 7 dias. Células-base
nunca são absorvidas.

1. ncl tasks cancel --all --group <id-da-célula>
2. Arquiva a memória dela no TEU workspace (tens /workspace/extra/cells read-only):
   cp -r /workspace/extra/cells/<folder>/memory /workspace/agent/absorbed/<célula>-<data>/
   (e o instructions.prepend.md dela junto, para histórico)
3. ncl destinations remove dos links que apontam para ela (o teu local-name dela, se criaste)
4. ncl groups delete --id <id-da-célula> (envelope libera; o andeen é notificado)
5. O folder groups/<folder>/ fica no disco do host — avisa o andeen no digest
   para limpar quando quiser.
```

- [ ] **Step 3: Commit**

```bash
git add -f groups/dm-with-andeen/instructions.prepend.md
git commit -m "chore(groups): runbooks de mitose e absorção no orquestrador"
```

### Task 8: Rollout + e2e da mitose

**Files:** nenhum (operacional)

- [ ] **Step 1: Build, suite completa, restart**

```bash
pnpm run build && pnpm test
systemctl --user restart nanoclaw-v2-2156afdf && sleep 10 && systemctl --user is-active nanoclaw-v2-2156afdf
```

Expected: suite toda verde; serviço `active`; `logs/nanoclaw.log` com `NanoClaw running`.

- [ ] **Step 2: e2e guiado — uma mitose de verdade** — mandar ao Mano no Discord:

> Executa o runbook de mitose para o papel qa no projeto pos (célula qa-pos). É um teste do envelope — me reporta cada passo.

Critérios: (a) célula `qa-pos` criada SEM card de aprovação; (b) a notificação `🧬 Mitose: célula qa-pos criada…` chega no teu DM; (c) `ncl groups config get --id <qa-pos>` mostra modelo do qa + mounts do perfil pos; (d) loop task criada.

- [ ] **Step 3: e2e do estouro** — editar `~/.config/nanoclaw/cell-envelope.json` baixando `max_per_role` para o número ATUAL de células qa (tornando qa-pos+1 impossível), e mandar ao Mano: "cria também qa-portfolio". Critério: chega um CARD de aprovação (não um create silencioso). Rejeitar o card. Restaurar `max_per_role: 3` no arquivo.

- [ ] **Step 4: e2e da absorção** — mandar ao Mano:

> Executa o runbook de absorção na célula qa-pos (teste — ela está ociosa por definição).

Critérios: (a) memória arquivada em `groups/dm-with-andeen/absorbed/qa-pos-<data>/` (conferir no host); (b) `ncl groups list` sem qa-pos; (c) notificação `🫧 Absorção…` no DM; (d) `groups/qa-pos/` órfão no disco — remover: `rm -rf groups/qa-pos`.

- [ ] **Step 5: Reconciliar o dev-loop legado** — o Mano roda `dev-loop-e086` (cron `5 * * * *`) de antes da organização celular. Com o supervisor ativo os dois se sobrepõem. **Perguntar ao andeen**: cancelar (`ncl tasks cancel --id dev-loop-e086`), ou manter os dois por um tempo. Não decidir sozinho — o dev-loop carrega estado próprio (`devloop/`, `memory/goals/dev-loop.md`).

### Task 9: Documentação final

**Files:**
- Modify: `CUSTOMIZATIONS.md`, `docs/superpowers/specs/2026-08-17-cell-org-design.md`

- [ ] **Step 1: CUSTOMIZATIONS.md** — adicionar à tabela de commits:

```markdown
| `feat(guard)` (×3) | Envelope celular: autonomia de mitose/absorção dentro de limites no host | Mantém |
| `feat(genomes)` + `feat(projects)` | Genomas de papel, ticks, perfis de projeto | Mantém |
```

E às dependências do host:

```markdown
- `~/.config/nanoclaw/cell-envelope.json` — limites da organização celular
  (max_cells/max_per_role/idle_days/roles). Ausente = mitose autônoma desligada
  (todo create de célula volta a pedir aprovação). Editar só à mão.
```

- [ ] **Step 2: Corrigir a spec (desvio de implementação)** — na Seção 4 da spec, trocar `memória arquivada em absorbed/<célula>-<data>/ no workspace da mãe` por `memória arquivada em absorbed/<célula>-<data>/ no workspace do Mano (o orquestrador tem groups/ read-only; escrever no workspace da célula-mãe exigiria mount rw que ela não tem)`.

- [ ] **Step 3: Commit**

```bash
git add CUSTOMIZATIONS.md docs/superpowers/specs/2026-08-17-cell-org-design.md
git commit -m "docs: envelope celular no CUSTOMIZATIONS + correção do destino da absorção na spec"
```
