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
import { getDb } from '../db/connection.js';

export interface CellEnvelope {
  max_cells: number;
  max_per_role: number;
  idle_days: number;
  roles: string[];
}

export const CELL_ENVELOPE_ALLOW_REASON = 'cell-envelope: within limits';

function envelopePath(): string {
  return process.env.NANOCLAW_CELL_ENVELOPE ?? path.join(os.homedir(), '.config', 'nanoclaw', 'cell-envelope.json');
}

export function readCellEnvelope(): CellEnvelope | null {
  try {
    const raw = JSON.parse(fs.readFileSync(envelopePath(), 'utf8')) as Partial<CellEnvelope>;
    if (
      typeof raw.max_cells !== 'number' ||
      typeof raw.max_per_role !== 'number' ||
      typeof raw.idle_days !== 'number' ||
      !Array.isArray(raw.roles) ||
      raw.roles.length === 0
    )
      return null;
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

export function countCells(env: CellEnvelope): { total: number; byRole: Record<string, number> } {
  const rows = getDb().prepare('SELECT name, folder FROM agent_groups').all() as Array<{
    name: string;
    folder: string;
  }>;
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
