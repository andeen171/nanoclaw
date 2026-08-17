/**
 * Notificação proativa ao dono para eventos de envelope celular (allow, não
 * aprovação). Dentro do envelope, create/delete de célula executa SEM card de
 * aprovação (spec 2026-08-17-cell-org-design §4) — o dono ainda precisa ouvir
 * falar disso, só que depois do fato, não antes. Caminho mínimo já usado em
 * reason-capture.ts:100 — ensureUserDm + adapter.deliver com {text}.
 *
 * Nunca lança: notificação perdida não pode derrubar o comando que já
 * executou (create/delete já aconteceu — falhar aqui não desfaz nada e só
 * apagaria o resultado bem-sucedido do handler).
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
