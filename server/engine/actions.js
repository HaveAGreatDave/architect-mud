/**
 * Action Dispatcher — the single canonical mutation path (ADR-0001).
 * registerAction({type, requiredTag?, validate?, handler})
 * dispatchAction({type, actor, params, context}) → validates → handler → emits events
 */
import { emit, on } from './events.js';
import * as inv from './inventory.js';
import { getZoneEnemies } from './world.js';
import { resolveAttack } from './commands/combat.js';

// type -> { type, requiredTag?, validate?, handler }
const registry = new Map();

export function registerAction({ type, requiredTag, validate, handler }) {
  if (!type || typeof handler !== 'function') throw new Error(`registerAction: type and handler required`);
  registry.set(type, { type, requiredTag, validate, handler });
}

/**
 * Dispatch an Action through the registry.
 * Returns the handler's result (or an error object if validation/dispatch fails).
 * The handler is responsible for emitting events after successful mutation.
 */
export async function dispatchAction({ type, actor, params = {}, context = {} }) {
  const entry = registry.get(type);
  if (!entry) return { type: 'error', message: `Unknown action: ${type}` };

  if (entry.requiredTag) {
    const target = params.target;
    const tags = target?.tags || {};
    if (!Object.prototype.hasOwnProperty.call(tags, entry.requiredTag)) {
      return { type: 'error', message: `Action ${type} requires tag "${entry.requiredTag}"` };
    }
  }

  if (entry.validate) {
    const validationError = await entry.validate({ actor, params, context });
    if (validationError) return { type: 'error', message: validationError };
  }

  return entry.handler({ actor, params, context, emit });
}

export function getRegisteredActions() { return [...registry.keys()]; }

// Observable proof-of-life subscriber (Phase 1 smoke test — remove when events are tested)
on('item.dropped', ({ actor, item, zone }) => {
  console.log(`[event:item.dropped] ${actor.handle} dropped "${item.name}" in ${zone}`);
});
on('inventory.changed', ({ actor }) => {
  console.log(`[event:inventory.changed] ${actor.handle}`);
});

// ---------------------------------------------------------------------------
// Generic action scaffolding — TAKE DROP GIVE EQUIP UNEQUIP MOVE EXAMINE
// Handlers are thin stubs; the real mutation logic is ported domain-by-domain
// (Phase 2+). Only DROP is fully wired in Phase 1.
// ---------------------------------------------------------------------------

registerAction({
  type: 'TAKE',
  handler: async ({ actor, params, context, emit }) => {
    const { row } = params;
    await inv.pickUp(row, actor);
    context.broadcast?.(actor.current_zone, { type:'zone_event', message:`${actor.handle} picks up ${row.name}.`, refresh: true }, actor.id);
    emit('item.taken', { actor, item: row, zone: actor.current_zone });
    emit('inventory.changed', { actor, zone: actor.current_zone });
    return { type:'take', message:`You pick up ${row.name}.` };
  },
});

registerAction({
  type: 'DROP',
  handler: async ({ actor, params, context, emit }) => {
    const { row } = params;
    const explicit = params.qty != null;
    const dropQty = await inv.dropToGround(row, actor.current_zone, params.qty);
    const qtyStr = (explicit && dropQty > 1) ? ` x${dropQty}` : '';
    context.broadcast?.(actor.current_zone, { type:'zone_event', message:`${actor.handle} drops ${row.name}${qtyStr}.`, refresh: true }, actor.id);
    emit('item.dropped', { actor, item: row, zone: actor.current_zone });
    emit('inventory.changed', { actor, zone: actor.current_zone });
    return { type:'drop', message:`You drop ${row.name}${qtyStr}.` };
  },
});

registerAction({
  type: 'GIVE',
  handler: async ({ actor, params, context, emit }) => {
    const { row, toPlayer } = params;
    await inv.giveToPlayer(row, toPlayer);
    context.broadcast?.(null, { type:'output', message:`<span class="msg-ambient">${actor.handle} hands you ${row.name}.</span>` }, null, toPlayer.id);
    emit('item.given', { actor, recipient: toPlayer, item: row });
    emit('inventory.changed', { actor });
    emit('inventory.changed', { actor: toPlayer });
    return { type:'give', message:`You give ${row.name} to ${toPlayer.handle}.` };
  },
});

registerAction({
  type: 'EQUIP',
  handler: async ({ actor, params, emit }) => {
    const { row, slot, layer } = params;
    await inv.equipRow(row, actor, slot, layer);
    emit('item.equipped', { actor, item: row, slot });
    emit('inventory.changed', { actor });
    return { type:'equip', message:`You equip ${row.name}.`, slot };
  },
});

registerAction({
  type: 'UNEQUIP',
  handler: async ({ actor, params, emit }) => {
    const { row } = params;
    await inv.unequipRow(row);
    emit('item.unequipped', { actor, item: row });
    emit('inventory.changed', { actor });
    return { type:'equip', message:`You unequip ${row.name}.` };
  },
});

// Player-initiated combat. The 1-second enemy-combat tick stays raw and never
// routes through the dispatcher (ADR-0001 — latency-critical hot path).
registerAction({
  type: 'ATTACK',
  handler: async ({ actor, params, context, emit }) => {
    const enemies = getZoneEnemies(actor.current_zone);
    if (!enemies.length) return { type:'error', message:'Nothing to attack here.' };
    const target = enemies.find(e => e.name.toLowerCase().includes(params.targetStr));
    if (!target) return { type:'error', message:`Can't find "${params.targetStr}" here.` };
    // resolveAttack emits enemy.killed / enemy.attacked itself — it's the shared
    // chokepoint for the command path and the raw-tick retaliation path.
    return resolveAttack(actor, target, context.broadcast);
  },
});

registerAction({
  type: 'MOVE',
  handler: async ({ actor, params, emit }) => {
    return { type: 'error', message: 'MOVE action not yet ported — use direction commands.' };
  },
});

registerAction({
  type: 'EXAMINE',
  handler: async ({ actor, params, emit }) => {
    return { type: 'error', message: 'EXAMINE action not yet ported — use the look command.' };
  },
});
