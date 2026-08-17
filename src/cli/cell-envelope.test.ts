import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readCellEnvelope, cellRoleOf, countCells, CELL_ENVELOPE_ALLOW_REASON } from './cell-envelope.js';
import { initTestDb, closeDb, runMigrations, createAgentGroup } from '../db/index.js';

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

describe('countCells', () => {
  beforeEach(() => {
    const db = initTestDb();
    runMigrations(db);
  });

  afterEach(() => {
    closeDb();
  });

  it('conta por name OU folder; ignora não-células', () => {
    createAgentGroup({
      id: 'ag-1',
      name: 'dev',
      folder: 'dev',
      agent_provider: null,
      created_at: new Date().toISOString(),
    });
    createAgentGroup({
      id: 'ag-2',
      name: 'dev-pos',
      folder: 'point-of-sale',
      agent_provider: null,
      created_at: new Date().toISOString(),
    });
    createAgentGroup({
      id: 'ag-3',
      name: 'Mano',
      folder: 'dm-with-andeen',
      agent_provider: null,
      created_at: new Date().toISOString(),
    });

    const env = { max_cells: 10, max_per_role: 3, idle_days: 7, roles: ['dev'] };
    expect(countCells(env)).toEqual({ total: 2, byRole: { dev: 2 } });
  });
});
