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
