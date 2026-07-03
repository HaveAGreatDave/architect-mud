/**
 * Shared graph runtime (Phase 4, ADR-0004).
 *
 * Dialogue and Scripts are both node graphs. Dialogue's interactive
 * `say`/`option` walk is driven turn-by-turn by the client (handleDialogue in
 * index.js); Scripts run to completion here. Both share the same node
 * vocabulary and — crucially — Scripts dispatch Actions only, never touching
 * state directly (ADR-0001).
 *
 * Script graph format (the exact JSON the devpanel editor saves):
 *   { start: 'n1', nodes: { n1: { type, ...fields, next }, ... } }
 *
 * Node types:
 *   action    { action, params, next }            → dispatchAction
 *   setflag   { scope, flag, value, op, next }     → SET_FLAG / CLEAR_FLAG
 *   condition { condition|conditions, ifTrue, ifFalse }
 *   branch    (alias of condition)
 *   wait      { seconds, next }                    → delayed continuation
 *   say       { text, next }                       → line to the actor
 *   script    { scriptId, next }                   → run a sub-script
 *
 * This module also registers the orchestration Actions that dialogue nodes and
 * script `action` nodes lean on: GRANT_ITEM, REMOVE_ITEM, TELEPORT, OPEN_UI,
 * TRIGGER_EVENT, EXECUTE_SCRIPT.
 */
import { randomUUID } from 'crypto';
import { query } from '../models/db.js';
import { registerAction, dispatchAction } from './actions.js';
import { emit } from './events.js';
import { evalConditions } from './flags.js';
import { getZone, addPlayerToZone, removePlayerFromZone } from './world.js';
import { openShopSession } from './vendor-session.js';

const MAX_STEPS = 100; // cycle / runaway-graph backstop

// Send one server message to a single actor (player). Falls back to a no-op if
// no broadcast is wired into the context.
function lineToActor(ctx, message) {
  ctx.broadcast?.(null, { type: 'output', message }, null, ctx.actor.id);
}

/**
 * Run a Script graph to completion, starting at graph.start.
 * ctx: { actor, broadcast, depth }
 */
export async function runGraph(graph, ctx) {
  if (!graph || !graph.nodes) return;
  const depth = ctx.depth || 0;
  if (depth > 10) { console.warn('[graph] max script nesting reached'); return; }

  let nodeId = graph.start || Object.keys(graph.nodes)[0];
  let steps = 0;
  while (nodeId && steps++ < MAX_STEPS) {
    const node = graph.nodes[nodeId];
    if (!node) break;
    nodeId = await runNode(node, { ...ctx, depth });
  }
  if (steps >= MAX_STEPS) console.warn('[graph] script hit step limit — possible cycle');
}

// Execute a single node; returns the id of the next node (or null to stop).
async function runNode(node, ctx) {
  switch (node.type) {
    case 'action': {
      const result = await dispatchAction({
        type: node.action,
        actor: ctx.actor,
        params: node.params || {},
        context: { broadcast: ctx.broadcast },
      });
      if (result?.type === 'error') console.warn(`[graph] action ${node.action} failed: ${result.message}`);
      return node.next || null;
    }
    case 'setflag': {
      const isClear = node.op === 'clear';
      await dispatchAction({
        type: isClear ? 'CLEAR_FLAG' : 'SET_FLAG',
        actor: ctx.actor,
        params: { scope: node.scope || 'player', flag: node.flag, value: node.value },
      });
      return node.next || null;
    }
    case 'condition':
    case 'branch': {
      const ok = await evalConditions(node.conditions || node.condition, ctx.actor);
      return (ok ? node.ifTrue : node.ifFalse) || null;
    }
    case 'say': {
      if (node.text) lineToActor(ctx, node.text);
      return node.next || null;
    }
    case 'script': {
      if (node.scriptId) {
        await runScriptById(node.scriptId, { ...ctx, depth: (ctx.depth || 0) + 1 });
      }
      return node.next || null;
    }
    case 'wait': {
      const next = node.next || null;
      const secs = Math.max(0, Number(node.seconds) || 0);
      if (next) {
        // Fire-and-forget delayed continuation; the script's owning call returns now.
        setTimeout(() => {
          runNodeChain(ctx.graph, next, ctx).catch(e =>
            console.error(`[graph] wait continuation error: ${e.message}`));
        }, secs * 1000);
      }
      return null; // stop the synchronous walk; the timer resumes it
    }
    default:
      console.warn(`[graph] unknown node type: ${node.type}`);
      return node.next || null;
  }
}

// Resume a walk from a given node id (used by `wait`).
async function runNodeChain(graph, startId, ctx) {
  if (!graph) return;
  let nodeId = startId;
  let steps = 0;
  while (nodeId && steps++ < MAX_STEPS) {
    const node = graph.nodes[nodeId];
    if (!node) break;
    nodeId = await runNode(node, ctx);
  }
}

export async function loadScript(scriptId) {
  const { rows } = await query('SELECT graph FROM scripts WHERE id=$1', [scriptId]);
  return rows.length ? rows[0].graph : null;
}

export async function runScriptById(scriptId, ctx) {
  const graph = await loadScript(scriptId);
  if (!graph) { console.warn(`[graph] script not found: ${scriptId}`); return; }
  await runGraph(graph, { ...ctx, graph });
}

// ---------------------------------------------------------------------------
// Orchestration Actions — dispatched by dialogue nodes and script `action`
// nodes. Each mutates through services/queries and emits a past-tense Event.
// ---------------------------------------------------------------------------

// Give an item to the actor by item_id (dialogue "Give Item"). Stacking-naive:
// grants a fresh row unless the player already holds one (mirrors the old
// dialogue grant guard).
registerAction({
  type: 'GRANT_ITEM',
  handler: async ({ actor, params, context, emit }) => {
    const { item_id, quantity = 1, once = true } = params;
    if (!item_id) return { type: 'error', message: 'GRANT_ITEM requires item_id.' };
    if (once) {
      const { rows } = await query(
        'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1',
        [actor.id, item_id]
      );
      if (rows.length) return { type: 'grant', item_id, granted: false };
    }
    await query(
      'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)',
      [randomUUID(), actor.id, item_id, quantity]
    );
    const { rows: itemRows } = await query('SELECT name FROM items WHERE id=$1', [item_id]);
    const name = itemRows[0]?.name || item_id;
    // Player-facing feedback in the main log — every Source (dialogue, script,
    // quest) gets it, not just the dialogue panel that requested the grant.
    context?.broadcast?.(null, {
      type: 'output',
      message: `<span class="item-grant">${name}${quantity > 1 ? ` x${quantity}` : ''} was added to your inventory.</span>`,
    }, null, actor.id);
    emit('item.granted', { actor, item_id, quantity });
    emit('inventory.changed', { actor });
    return { type: 'grant', item_id, granted: true, name, quantity };
  },
});

// Remove an item from the actor by item_id (dialogue "Remove Item").
registerAction({
  type: 'REMOVE_ITEM',
  handler: async ({ actor, params, emit }) => {
    const { item_id, quantity = 1 } = params;
    if (!item_id) return { type: 'error', message: 'REMOVE_ITEM requires item_id.' };
    const { rows } = await query(
      'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 ORDER BY quantity DESC',
      [actor.id, item_id]
    );
    let toRemove = quantity;
    for (const row of rows) {
      if (toRemove <= 0) break;
      if (row.quantity > toRemove) {
        await query('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [toRemove, row.id]);
        toRemove = 0;
      } else {
        await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
        toRemove -= row.quantity;
      }
    }
    emit('item.removed', { actor, item_id, quantity: quantity - Math.max(0, toRemove) });
    emit('inventory.changed', { actor });
    return { type: 'remove', item_id };
  },
});

// Teleport the actor to a zone (dialogue "Teleport"). Read-only callers get a
// 'move' result they can forward to the client; script callers ignore it.
registerAction({
  type: 'TELEPORT',
  handler: async ({ actor, params, context, emit }) => {
    const { zone_id } = params;
    const target = getZone(zone_id);
    if (!target) return { type: 'error', message: `Unknown zone: ${zone_id}` };
    const from = actor.current_zone;
    if (from) {
      removePlayerFromZone(actor.id, from);
      context?.broadcast?.(from, { type: 'zone_event', message: `${actor.handle} vanishes.` }, actor.id);
    }
    addPlayerToZone(actor.id, zone_id);
    actor.current_zone = zone_id;
    await query('UPDATE players SET current_zone=$1 WHERE id=$2', [zone_id, actor.id]);
    context?.broadcast?.(zone_id, { type: 'zone_event', message: `${actor.handle} appears.` }, actor.id);
    emit('zone.entered', { actor, zone: zone_id, from });
    return { type: 'teleport', zone: zone_id };
  },
});

// Client-directed "open a UI panel" (dialogue "Open Bank/Storage/Crafting").
// Pure directive — the server holds no UI state; it tells the client to open.
registerAction({
  type: 'OPEN_UI',
  handler: async ({ actor, params, context }) => {
    const { ui } = params;
    if (!ui) return { type: 'error', message: 'OPEN_UI requires a ui name.' };
    context?.broadcast?.(null, { type: 'open_ui', ui, npcId: params.npcId || null }, null, actor.id);
    return { type: 'open_ui', ui };
  },
});

// Emit an arbitrary Event from dialogue/scripts (dialogue "Trigger Event").
registerAction({
  type: 'TRIGGER_EVENT',
  handler: async ({ actor, params }) => {
    const { event, payload } = params;
    if (!event) return { type: 'error', message: 'TRIGGER_EVENT requires an event name.' };
    emit(event, { actor, ...(payload || {}) });
    return { type: 'event', event };
  },
});

// Run a Script graph asset (dialogue "Execute Script"; also a script `script` node).
registerAction({
  type: 'EXECUTE_SCRIPT',
  handler: async ({ actor, params, context }) => {
    const { scriptId, graph } = params;
    const g = graph || (scriptId && await loadScript(scriptId));
    if (!g) return { type: 'error', message: 'EXECUTE_SCRIPT: no script found.' };
    await runGraph(g, { actor, broadcast: context?.broadcast, graph: g, depth: 0 });
    return { type: 'script', scriptId: scriptId || null };
  },
});

// Open an NPC's vendor shop (dialogue "Open Shop").
registerAction({
  type: 'OPEN_SHOP',
  handler: async ({ actor, params, context }) => {
    const { npcId } = params;
    if (!npcId) return { type: 'error', message: 'OPEN_SHOP requires npcId.' };
    const { rows } = await query('SELECT * FROM npcs WHERE id=$1', [npcId]);
    if (!rows.length) return { type: 'error', message: `NPC not found: ${npcId}` };
    const npc = rows[0];
    if (!npc.vendor_inventory?.length) return { type: 'error', message: `${npc.name} has nothing to sell.` };
    const { vendorGrudgeRemaining, grudgeRefusal } = await import('./vendor-grudge.js');
    const grudge = await vendorGrudgeRemaining(actor.id, npc.id);
    if (grudge > 0) return { type: 'error', message: grudgeRefusal(npc, grudge) };
    const { getVendorStock } = await import('./vendor.js');
    const stock = await getVendorStock(npc, actor.id);
    openShopSession(actor.id, npc.id);
    context?.broadcast?.(null, { type: 'dialogue_shop', npcId: npc.id, npcName: npc.name, stock, credits: actor.credits }, null, actor.id);
    return { type: 'open_shop', npcId };
  },
});

// Convenience aliases for the OPEN_UI action — builders see named actions.
registerAction({
  type: 'OPEN_BANK',
  handler: async ({ actor, context }) => {
    context?.broadcast?.(null, { type: 'open_ui', ui: 'bank' }, null, actor.id);
    return { type: 'open_ui', ui: 'bank' };
  },
});

registerAction({
  type: 'OPEN_STORAGE',
  handler: async ({ actor, params, context }) => {
    context?.broadcast?.(null, { type: 'open_ui', ui: 'storage', storageId: params.storageId || null }, null, actor.id);
    return { type: 'open_ui', ui: 'storage' };
  },
});

registerAction({
  type: 'OPEN_CRAFTING',
  handler: async ({ actor, params, context }) => {
    context?.broadcast?.(null, { type: 'open_ui', ui: 'crafting', stationId: params.stationId || null }, null, actor.id);
    return { type: 'open_ui', ui: 'crafting' };
  },
});

// Alias for TELEPORT with a builder-friendlier param name.
registerAction({
  type: 'TELEPORT_PLAYER',
  handler: async ({ actor, params, context }) => {
    return dispatchAction({ type: 'TELEPORT', actor, params: { zone_id: params.destination || params.zone_id }, context });
  },
});

// End the current dialogue session.
registerAction({
  type: 'END_CONVERSATION',
  handler: async ({ actor, params, context }) => {
    context?.broadcast?.(null, { type: 'dialogue_end', message: params.message || '' }, null, actor.id);
    return { type: 'dialogue_end' };
  },
});

// Redirect dialogue to a specific node (usable from option actions or scripts).
// Returns a goto_node result that handleDialogue picks up to override navigation.
registerAction({
  type: 'GOTO_NODE',
  handler: async ({ params }) => {
    const { node } = params;
    if (!node) return { type: 'error', message: 'GOTO_NODE requires a node.' };
    return { type: 'goto_node', node };
  },
});
