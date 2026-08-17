/**
 * Envelope celular em commandDecide (spec 2026-08-17-cell-org-design, Fase C
 * Task 2). O orquestrador (agent, cli_scope global) operando sobre alvos-
 * célula ganha um corredor de autonomia dentro do envelope do host: `create`
 * conta contra os limites, o resto da família da célula passa direto. Fora
 * disso — alvo não-célula, escopo group, sem envelope — o comportamento de
 * hoje fica byte-idêntico (hold para aprovação do admin).
 *
 * Usa o registry real (side-effect import do barrel de comandos, mesmo
 * padrão do conformance test em src/guard/conformance.test.ts) para que os
 * 11 casos validem contra os nomes de comando REAIS — um nome errado no
 * branch dá teste vermelho, não um mock que mente.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Production barrel — side-effect import populates the real command registry
// (and, transitively, each command's guard via registerResource → register).
import '../cli/commands/index.js';

import { ensureContainerConfig, updateContainerConfigScalars } from '../db/container-configs.js';
import { closeDb, createAgentGroup, initTestDb, runMigrations } from '../db/index.js';
import { CELL_ENVELOPE_ALLOW_REASON } from './cell-envelope.js';
import { agentsCreate } from '../modules/agent-to-agent/guard.js';
import { commandGuard } from './registry.js';
import type { GuardInput } from '../guard/index.js';

const envPath = path.join(os.tmpdir(), `cell-envelope-guard-test-${process.pid}.json`);

const MANO_ID = 'ag-mano';

interface EnvelopeShape {
  max_cells: number;
  max_per_role: number;
  idle_days: number;
  roles: string[];
}

function writeEnvelope(overrides: Partial<EnvelopeShape> = {}): void {
  const env: EnvelopeShape = { max_cells: 10, max_per_role: 3, idle_days: 7, roles: ['dev', 'qa'], ...overrides };
  fs.writeFileSync(envPath, JSON.stringify(env));
}

function seedCell(id: string, folder: string, name = folder): void {
  createAgentGroup({ id, name, folder, agent_provider: null, created_at: new Date().toISOString() });
}

function fromMano(payload: Record<string, unknown>): GuardInput {
  return { actor: { kind: 'agent', agentGroupId: MANO_ID }, payload };
}

beforeEach(() => {
  const db = initTestDb();
  runMigrations(db);
  createAgentGroup({
    id: MANO_ID,
    name: 'Mano',
    folder: 'dm-with-andeen',
    agent_provider: null,
    created_at: new Date().toISOString(),
  });
  ensureContainerConfig(MANO_ID, 'claude');
  updateContainerConfigScalars(MANO_ID, { cli_scope: 'global' });
  process.env.NANOCLAW_CELL_ENVELOPE = envPath;
});

afterEach(() => {
  closeDb();
  delete process.env.NANOCLAW_CELL_ENVELOPE;
  fs.rmSync(envPath, { force: true });
});

describe('cell envelope branch in commandDecide', () => {
  it('1. groups-create de agent global, folder de célula, envelope com folga → allow com o motivo do envelope', () => {
    writeEnvelope();
    seedCell('ag-qa-1', 'qa-portfolio'); // 1 qa existente — folga sob max_per_role=3
    const d = commandGuard('groups-create').decide(fromMano({ folder: 'qa-pos', name: 'QA POS' }));
    expect(d.effect).toBe('allow');
    expect(d.reason).toBe(CELL_ENVELOPE_ALLOW_REASON);
  });

  it('2. groups-create com byRole.dev já em max_per_role (3) → hold', () => {
    writeEnvelope();
    seedCell('ag-dev-1', 'dev-pos');
    seedCell('ag-dev-2', 'dev-portfolio');
    seedCell('ag-dev-3', 'dev-crm');
    const d = commandGuard('groups-create').decide(fromMano({ folder: 'dev-novo', name: 'Dev Novo' }));
    expect(d.effect).toBe('hold');
  });

  it('3. groups-create com total já em max_cells (10) → hold', () => {
    writeEnvelope();
    for (let i = 0; i < 5; i++) seedCell(`ag-dev-${i}`, `dev-${i}`);
    for (let i = 0; i < 5; i++) seedCell(`ag-qa-${i}`, `qa-${i}`);
    const d = commandGuard('groups-create').decide(fromMano({ folder: 'qa-novo', name: 'QA Novo' }));
    expect(d.effect).toBe('hold');
  });

  it('4. groups-create com folder "meu-projeto" (não-célula) → hold (comportamento atual)', () => {
    writeEnvelope();
    const d = commandGuard('groups-create').decide(fromMano({ folder: 'meu-projeto', name: 'Meu Projeto' }));
    expect(d.effect).toBe('hold');
  });

  it('5. groups-create SEM envelope (env var aponta para arquivo inexistente) → hold (atual)', () => {
    fs.rmSync(envPath, { force: true }); // garante ausência — readCellEnvelope() → null
    const d = commandGuard('groups-create').decide(fromMano({ folder: 'qa-pos', name: 'QA POS' }));
    expect(d.effect).toBe('hold');
  });

  it('6. groups-delete de agent global com --id de grupo-célula → allow (absorção autônoma)', () => {
    writeEnvelope();
    seedCell('ag-dev-x', 'dev-x');
    const d = commandGuard('groups-delete').decide(fromMano({ id: 'ag-dev-x' }));
    expect(d.effect).toBe('allow');
    expect(d.reason).toBe(CELL_ENVELOPE_ALLOW_REASON);
  });

  it('7. groups-config-update com --id de célula, agent global → allow', () => {
    writeEnvelope();
    seedCell('ag-dev-y', 'dev-y');
    const d = commandGuard('groups-config-update').decide(fromMano({ id: 'ag-dev-y', model: 'sonnet' }));
    expect(d.effect).toBe('allow');
    expect(d.reason).toBe(CELL_ENVELOPE_ALLOW_REASON);
  });

  it('8. groups-config-add-mount com --id de célula, agent global → allow (hostOnly contornado só neste caso)', () => {
    writeEnvelope();
    seedCell('ag-dev-z', 'dev-z');
    const d = commandGuard('groups-config-add-mount').decide(
      fromMano({ id: 'ag-dev-z', host: '/host/x', container: '/x' }),
    );
    expect(d.effect).toBe('allow');
    expect(d.reason).toBe(CELL_ENVELOPE_ALLOW_REASON);
  });

  it('9. groups-config-add-mount com --id NÃO-célula, agent global → deny (hostOnly intacto)', () => {
    writeEnvelope();
    seedCell('ag-not-cell', 'meu-projeto');
    const d = commandGuard('groups-config-add-mount').decide(
      fromMano({ id: 'ag-not-cell', host: '/host/x', container: '/x' }),
    );
    expect(d.effect).toBe('deny');
  });

  it('10. groups-create de agent com cli_scope "group" → hold (envelope só vale para global)', () => {
    writeEnvelope();
    updateContainerConfigScalars(MANO_ID, { cli_scope: 'group' });
    const d = commandGuard('groups-create').decide(fromMano({ folder: 'dev-w', name: 'Dev W' }));
    expect(d.effect).toBe('hold');
  });

  it('11. ator host → allow sempre (trusted socket, inalterado)', () => {
    writeEnvelope();
    const d = commandGuard('groups-create').decide({ actor: { kind: 'host' }, payload: {} });
    expect(d.effect).toBe('allow');
  });
});

// Fase C Task 3 — mesmo envelope, rota a2a (agents.create). Hoje o
// cli_scope-global consulta agentsCreate.decide diretamente (guard.ts:44-56)
// e dá ALLOW incondicional — a rota de mitose do Mano. Sem o envelope aqui, o
// corredor da CLI (commandDecide) é contornável simplesmente pedindo a
// criação via a2a em vez de `ncl groups create`.
describe('cell envelope branch em agentsCreate.decide (rota a2a)', () => {
  it('1. agents.create (a2a) de agent global, name "qa-pos", envelope com folga → allow com o motivo do envelope', () => {
    writeEnvelope();
    seedCell('ag-qa-1', 'qa-portfolio'); // 1 qa existente — folga sob max_per_role=3
    const d = agentsCreate.decide(fromMano({ name: 'qa-pos' }));
    expect(d.effect).toBe('allow');
    expect(d.reason).toBe(CELL_ENVELOPE_ALLOW_REASON);
  });

  it('2. agents.create (a2a) com byRole.qa já em max_per_role (3) → hold', () => {
    writeEnvelope();
    seedCell('ag-qa-1', 'qa-pos');
    seedCell('ag-qa-2', 'qa-portfolio');
    seedCell('ag-qa-3', 'qa-crm');
    const d = agentsCreate.decide(fromMano({ name: 'qa-novo' }));
    expect(d.effect).toBe('hold');
  });

  it('3. agents.create (a2a) com name "assistente-pessoal" (não-célula) → allow (comportamento atual preservado)', () => {
    writeEnvelope();
    const d = agentsCreate.decide(fromMano({ name: 'assistente-pessoal' }));
    expect(d.effect).toBe('allow');
    expect(d.reason).toBe('trusted global-scope agent group');
  });

  it('4. agents.create (a2a) SEM envelope (env var aponta para arquivo inexistente) → allow (comportamento atual; a2a nunca segurou global)', () => {
    fs.rmSync(envPath, { force: true }); // garante ausência — readCellEnvelope() → null
    const d = agentsCreate.decide(fromMano({ name: 'qa-pos' }));
    expect(d.effect).toBe('allow');
    expect(d.reason).toBe('trusted global-scope agent group');
  });
});
