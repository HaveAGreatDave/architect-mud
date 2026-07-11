/**
 * Action Dispatcher — the single canonical mutation path (ADR-0001).
 * registerAction({type, requiredTag?, validate?, handler})
 * dispatchAction({type, actor, params, context}) → validates → handler → emits events
 */
import { emit } from './events.js';
import * as inv from './inventory.js';
import { tagValue } from './tags.js';

// Body slots a garment can occupy, for the "on your ..." equip message. Weapon/
// accessory slots don't read naturally as body regions, so they keep the plain form.
const BODY_SLOTS = new Set(['head', 'torso', 'hands', 'legs', 'feet']);

// "torso" / "torso and legs" / "head, torso and legs" — the body region(s) a piece
// covers, from its `slot` plus any extra `covers` slots (e.g. a jumpsuit's legs).
function equipRegionPhrase(row, slot) {
  if (!BODY_SLOTS.has(slot)) return null;
  const covers = tagValue(row, 'covers');
  const slots = [slot, ...(Array.isArray(covers) ? covers : [])].filter(s => BODY_SLOTS.has(s));
  if (slots.length <= 1) return slots[0] || null;
  return `${slots.slice(0, -1).join(', ')} and ${slots[slots.length - 1]}`;
}

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

// ---------------------------------------------------------------------------
// Generic action scaffolding — TAKE DROP GIVE EQUIP UNEQUIP MOVE EXAMINE
// Handlers are thin stubs; the real mutation logic is ported domain-by-domain
// (Phase 2+). Only DROP is fully wired in Phase 1.
// ---------------------------------------------------------------------------

registerAction({
  type: 'TAKE',
  handler: async ({ actor, params, context, emit }) => {
    const { row } = params;
    // Owner-locked items (custom_data.ownerId — e.g. a cipher-locked MULE crate)
    // can only be picked up by their owner; nobody else can pinch them off the ground.
    const cd = typeof row.custom_data === 'string' ? (() => { try { return JSON.parse(row.custom_data); } catch { return {}; } })() : (row.custom_data || {});
    if (cd.ownerId && cd.ownerId !== actor.id) {
      return { type: 'error', message: `The ${row.name} is cipher-locked to someone else — it won't come with you.` };
    }
    await inv.pickUp(row, actor);
    const displayName = row.name;
    const article = /^[aeiou]/i.test(displayName) ? 'an' : 'a';
    context.broadcast?.(actor.current_zone, { type:'zone_event', message:`${actor.handle} picks up ${article} ${displayName}.`, refresh: true }, actor.id);
    emit('item.taken', { actor, item: row, zone: actor.current_zone });
    emit('inventory.changed', { actor, zone: actor.current_zone });
    return { type:'take', message:`You pick up ${article} ${displayName}.` };
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
    const region = equipRegionPhrase(row, slot);
    const message = region ? `You equip ${row.name} on your ${region}.` : `You equip ${row.name}.`;
    return { type:'equip', message, slot };
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

// ATTACK is registered by the weapon plugin, which owns the player-initiated
// combat path. The 1-second enemy-combat tick stays raw and never routes
// through the dispatcher (ADR-0001 — latency-critical hot path).

// MOVE routes through cmdMove, which runs the move-gate chain (movement-gates.js)
// before mutating. Direction commands still call cmdMove directly — same path,
// no double dispatch. params: { direction, opts? }. Dynamic import: movement.js
// sits atop describe/world and importing it statically here would cycle.
registerAction({
  type: 'MOVE',
  handler: async ({ actor, params, context }) => {
    const { cmdMove } = await import('./commands/movement.js');
    return cmdMove(params.direction, actor, context.broadcast, params.opts || {});
  },
});

registerAction({
  type: 'EXAMINE',
  handler: async ({ actor, params, emit }) => {
    return { type: 'error', message: 'EXAMINE action not yet ported — use the look command.' };
  },
});
