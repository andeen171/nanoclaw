/**
 * CLI guard adapter — the command registry's catalog derivation and
 * structural decision, moved verbatim out of dispatch.ts.
 * Declaration is registration: registry.register() derives one
 * catalog entry per command from the CommandDef itself; no second file is
 * edited when a command is added.
 *
 * The decide fn carries today's decisions exactly:
 *   host caller → allow (the 0600 socket is the auth story — in code,
 *   unremovable by data);
 *   cli_scope 'disabled' → deny; 'group' → resource allowlist, cross-group
 *   arg denial, cli_scope-change denial;
 *   access 'approval' for agent callers → hold for the group's admin chain.
 *
 * Arg auto-fill, the sessions-get existence oracle, and post-handler row
 * filtering stay in dispatch.ts — mechanics, not policy.
 */
import {
  CELL_ENVELOPE_ALLOW_REASON,
  cellRoleOf,
  countCells,
  readCellEnvelope,
  type CellEnvelope,
} from './cell-envelope.js';
import { getContainerConfig } from '../db/container-configs.js';
import { getDb } from '../db/connection.js';
import { ALLOW, DENY, HOLD, type GuardedActionSpec, type GuardInput } from '../guard/index.js';
import { GROUP_SCOPE_RESOURCES, type CommandDef } from './registry.js';

const GROUP_WIRING_COMMANDS = new Set(['wirings-get', 'wirings-update']);
const GROUP_WIRING_UPDATE_ARGS = new Set(['id', 'agent_group_id', 'group', 'help', 'engage_mode', 'engage_pattern']);

/**
 * Comandos que compõem a "família da célula" — o corredor de autonomia do
 * envelope só se aplica a estes. Nomes REAIS confirmados contra o registry
 * (crud.ts: `${plural}-${verb.replace(/ /g, '-')}`) em groups.ts e
 * destinations.ts. `groups-config-get` fica de fora — já é `access: 'open'`,
 * não passa pelo hold que o envelope existe para contornar.
 */
export const CELL_FAMILY_COMMANDS = new Set([
  'groups-create',
  'groups-delete',
  'groups-restart',
  'groups-config-update',
  'groups-config-add-mcp-server',
  'groups-config-remove-mcp-server',
  'groups-config-add-package',
  'groups-config-remove-package',
  'groups-config-add-mount',
  'groups-config-remove-mount',
  'destinations-add',
  'destinations-remove',
]);

/**
 * Alvo-célula do comando: `create` usa o folder pedido (grupo ainda não
 * existe); o resto resolve o grupo existente por id (ou agent_group_id, para
 * destinations) e classifica por name ou folder — mesmo critério de
 * `countCells`. Retorna null para "não é alvo-célula" (payload sem id/folder
 * reconhecível, ou grupo/folder que não bate com nenhum papel do envelope) —
 * o chamador cai de volta nos checks normais.
 */
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
  // O guard decide antes do normalizeArgs do crud.ts — frames vindos do
  // container ainda carregam chaves kebab ("agent-group-id"), como o check de
  // GROUP_WIRING_UPDATE_ARGS abaixo já trata. Aceitar só o snake segurava
  // toda destinations-add/remove de célula no HOLD (appr-1787003740130).
  const rawId = payload.id ?? payload.agent_group_id ?? payload['agent-group-id'];
  const id = typeof rawId === 'string' ? rawId : null;
  if (!id) return null;
  const g = getDb().prepare('SELECT name, folder FROM agent_groups WHERE id = ?').get(id) as
    | { name: string; folder: string }
    | undefined;
  if (!g) return null;
  const role = cellRoleOf(g.name, env) ?? cellRoleOf(g.folder, env);
  return role ? { role } : null;
}

/** Dotted catalog action name for a command. */
export function commandGuardAction(cmd: Pick<CommandDef, 'name' | 'action'>): string {
  return cmd.action ?? `cli.${cmd.name}`;
}

/** Catalog entry derived from a CommandDef at registration time. */
export function commandGuardSpec(cmd: CommandDef): GuardedActionSpec {
  return {
    action: commandGuardAction(cmd),
    grantActionName: cmd.access === 'approval' ? 'cli_command' : undefined,
    // Bind a cli_command grant to the exact command it was approved for.
    grantCoversRequest: (grant) => {
      try {
        const payload = JSON.parse(grant.payload) as { frame?: { command?: string } };
        return payload.frame?.command === cmd.name;
      } catch {
        return false;
      }
    },
    decide: (input) => commandDecide(cmd, input),
  };
}

function commandDecide(cmd: CommandDef, input: GuardInput) {
  const { actor } = input;
  if (actor.kind === 'host') return ALLOW('host caller (trusted socket)');
  if (actor.kind !== 'agent') return DENY('CLI commands accept host or agent callers only.');

  const args = input.payload;
  const cliScope = getContainerConfig(actor.agentGroupId)?.cli_scope ?? 'group';

  // Envelope celular (spec 2026-08-17): o orquestrador (agent, cli_scope
  // global) opera células autonomamente dentro do envelope do host. create
  // conta contra os limites; delete/config/destinations em alvo-célula
  // passam direto. Envelope ausente ou alvo não-célula → cai nos checks
  // normais (hold/deny de sempre) logo abaixo — nenhum caminho existente
  // muda de comportamento.
  // Vem antes do hostOnly: add-mount em célula é parte da mitose do
  // orquestrador; validateMount re-valida o allowlist no spawn de qualquer
  // forma, então o desvio aqui não abre uma segunda porta para o mount.
  if (cliScope === 'global') {
    const env = readCellEnvelope();
    if (env && CELL_FAMILY_COMMANDS.has(cmd.name)) {
      const target = resolveCellTarget(cmd.name, args, env);
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

  // Host-only commands (e.g. mount management) are operator-only: rejected for
  // ANY container caller, regardless of cli_scope (even `global`) or approval.
  // The mount allowlist is the boundary cli_scope itself lives inside, so an
  // agent must never alter it — not even with admin approval.
  if (cmd.hostOnly) {
    return DENY(`"${cmd.name}" is operator-only and cannot be run from inside a container.`);
  }

  if (cliScope === 'disabled') {
    return DENY('CLI access is disabled for this agent group.');
  }

  if (cliScope === 'group') {
    const groupWiringCommand = cmd.resource === 'wirings' && GROUP_WIRING_COMMANDS.has(cmd.name);

    // Only allow whitelisted resources and general commands (no resource, like help)
    if (cmd.resource && !GROUP_SCOPE_RESOURCES.has(cmd.resource) && !groupWiringCommand) {
      return DENY(`CLI access is scoped to this agent group. Cannot access "${cmd.resource}".`);
    }

    // Enforce group scope on all agent-group-related args.
    // Different resources use different arg names for the agent group ID.
    // Only check --id for resources where it IS the agent group ID.
    // Inclui a variante kebab: o guard decide antes do normalizeArgs, então
    // frames do container ainda carregam "agent-group-id".
    for (const key of ['agent_group_id', 'group', 'agent-group-id'] as const) {
      if (args[key] && args[key] !== actor.agentGroupId) {
        return DENY('CLI access is scoped to this agent group.');
      }
    }
    if ((cmd.resource === 'groups' || cmd.resource === 'destinations') && args.id && args.id !== actor.agentGroupId) {
      return DENY('CLI access is scoped to this agent group.');
    }

    if (
      groupWiringCommand &&
      cmd.name === 'wirings-update' &&
      Object.keys(args).some((key) => !GROUP_WIRING_UPDATE_ARGS.has(key.replace(/-/g, '_')))
    ) {
      return DENY('Group-scoped wiring updates may only change engage_mode or engage_pattern.');
    }

    // Block cli_scope changes from group-scoped agents (privilege escalation)
    if (args.cli_scope !== undefined || args['cli-scope'] !== undefined) {
      return DENY('Cannot change cli_scope from a group-scoped agent.');
    }
  }

  if (cmd.access === 'approval') {
    return HOLD(`agent-initiated "${cmd.name}" requires admin approval`);
  }

  return ALLOW('open command');
}
