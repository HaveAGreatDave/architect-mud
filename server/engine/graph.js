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
 *   random    { outcomes:[{next,weight}], next }   → weighted pick
 *   counter   { scope, flag, delta, threshold, reset, ifTrue, ifFalse, next }
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
import { createWorkGate } from './worklist.js';
import { registerAction, dispatchAction } from './actions.js';
import { emit } from './events.js';
import { evalConditions, getFlag } from './flags.js';
import { interp, interpDeep } from './interp.js';
import { getZone, addPlayerToZone, removePlayerFromZone, resolveLanding, world, spawnEnemySync, pickSpawnMessage, getLivePlayer, setNpcHomeOverride, clearNpcHomeOverride } from './world.js';
import { spawnOnGround, spawnInContainer } from './inventory.js';
import { openShopSession } from './vendor-session.js';
import { getItem } from './items-cache.js';

const MAX_STEPS = 100; // cycle / runaway-graph backstop

// Send one server message to a single actor (player). Falls back to a no-op if
// no broadcast is wired into the context.
// A script bound to an actorless event (tick.minute, weather.event) legitimately
// runs with no actor — a `say` there has nobody to talk to, and must no-op
// rather than take the whole dispatch down.
function lineToActor(ctx, message) {
  if (!ctx.actor) return;
  ctx.broadcast?.(null, { type: 'output', message }, null, ctx.actor.id);
}

// Parameterised graphs: `${dotted.path}` in any string field resolves from
// ctx.params before the node runs — trigger params (one graph, many instances)
// plus `event` (the payload the trigger fired on). See engine/interp.js for the
// verbatim-on-failure rules, and docs/scripting.md for the token reference.

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
    // `graph` on the ctx is what a `wait` node's delayed continuation resumes
    // from — set it here rather than trusting every caller to pass it, or a
    // direct runGraph() call silently drops everything after the first wait.
    nodeId = await runNode(node, { ...ctx, graph, depth });
  }
  if (steps >= MAX_STEPS) console.warn('[graph] script hit step limit — possible cycle');
}

// Execute a single node; returns the id of the next node (or null to stop).
// Every string field is run through interp() against ctx.params first — see the
// parameterised-graph note above. Node ids (next/ifTrue/…) are NOT interpolated:
// graph topology is authored, never computed.
async function runNode(node, ctx) {
  const P = ctx.params;
  switch (node.type) {
    case 'action': {
      const result = await dispatchAction({
        type: node.action,
        actor: ctx.actor,
        params: interpDeep(node.params || {}, P),
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
        params: { scope: node.scope || 'player', flag: interp(node.flag, P), value: interp(node.value, P) },
      });
      return node.next || null;
    }
    case 'condition':
    case 'branch': {
      const ok = await evalConditions(interpDeep(node.conditions || node.condition, P), ctx.actor);
      return (ok ? node.ifTrue : node.ifFalse) || null;
    }
    case 'say': {
      if (node.text) lineToActor(ctx, interp(node.text, P));
      return node.next || null;
    }
    case 'broadcast': {
      // Everyone in the room sees it — this is how a script makes a SCENE rather
      // than whispering to one player. Defaults to the actor's zone; `${zone}`
      // (or an explicit zone field) covers the actorless case.
      const zoneId = interp(node.zone, P) || ctx.actor?.current_zone || P?.zone || null;
      const text = interp(node.text, P);
      if (zoneId && text) {
        ctx.broadcast?.(zoneId,
          { type: 'zone_event', message: text, refresh: !!node.refresh },
          node.excludeActor ? ctx.actor?.id : null);
      }
      return node.next || null;
    }
    case 'spawn': {
      // kind: 'enemy' (an instance from an enemies template) | 'item' (onto the
      // zone floor). A missing template/zone is logged and skipped — a botched
      // spawn must not strand the rest of the graph.
      const zoneId = interp(node.zone, P) || ctx.actor?.current_zone || P?.zone || null;
      const spawnId = interp(node.id, P);
      const qty = Math.max(1, Number(interp(node.quantity ?? 1, P)) || 1);
      if (!zoneId || !spawnId) {
        console.warn(`[graph] spawn node missing ${!zoneId ? 'zone' : 'id'}`);
        return node.next || null;
      }
      if (node.kind === 'item') {
        // A `container` target makes this a DEAD DROP: the item is really there
        // and really retrievable, but it isn't lying on the floor for the next
        // person through the room. Accepts a furniture id or a name to match
        // within the target zone.
        const containerRef = interp(node.container, P);
        if (containerRef) {
          const containerId = await resolveDropContainer(containerRef, zoneId);
          if (!containerId) {
            // Deliberately NOT falling back to the floor — a drop that misses
            // its container and lands in the open is a leaked drop, which is
            // worse than a missing one. Loud in the log, invisible in play.
            console.warn(`[graph] spawn: no container "${containerRef}" in ${zoneId} — drop skipped`);
            return node.next || null;
          }
          await spawnInContainer(spawnId, containerId, qty);
        } else {
          await spawnOnGround(spawnId, zoneId, qty);
        }
        if (node.announce) {
          ctx.broadcast?.(zoneId, { type: 'zone_event', message: interp(node.announce, P), refresh: true });
        }
      } else {
        const { rows } = await query('SELECT * FROM enemies WHERE id=$1', [spawnId]);
        if (!rows.length) { console.warn(`[graph] spawn: no enemy template ${spawnId}`); return node.next || null; }
        if (!getZone(zoneId)) { console.warn(`[graph] spawn: no zone ${zoneId}`); return node.next || null; }
        // Identity-stamping. `${actor.id}` resolves HERE and nowhere else in the
        // node vocabulary: it is what lets a script hand a mob the id of the
        // player who tripped it, which is the only way content can author a
        // CHASE node's `quarry:'flag'` hunt (ai-behaviour.js). Without it a
        // spawned pursuer can only aggro, never hunt somebody by name.
        const stampParams = ctx.actor ? { ...P, actor: ctx.actor } : P;
        const stampFlags = node.flags ? interpDeep(node.flags, stampParams) : null;
        // An override must be a graph OBJECT ({ _start, nodes }); a bare id would
        // sail through and leave the instance with an AI that never ticks.
        let graphOverride = node.behaviour_graph || null;
        if (graphOverride && typeof graphOverride !== 'object') {
          console.warn('[graph] spawn: behaviour_graph must be a graph object — ignored');
          graphOverride = null;
        }
        for (let i = 0; i < qty; i++) {
          const inst = spawnEnemySync(rows[0], zoneId);
          // spawnEnemySync copies template.flags BY REFERENCE (world.js), so this
          // must build a FRESH object — mutating in place would stamp the shared
          // template and every later spawn of it would inherit this hunt.
          if (stampFlags) inst.flags = { ...(inst.flags || {}), ...stampFlags };
          if (graphOverride) inst.behaviour_graph = graphOverride;
          // Silence is an option — a tail you haven't noticed yet shouldn't announce itself.
          if (node.announce !== false) {
            ctx.broadcast?.(zoneId, {
              type: 'zone_event',
              message: node.announce ? interp(node.announce, P) : pickSpawnMessage(inst.name),
              refresh: true,
            });
          }
        }
      }
      return node.next || null;
    }
    case 'script': {
      // Params inherit into the sub-graph — that's what lets a shared mechanics
      // script hand off to a per-instance flavour script named by a param.
      const subId = interp(node.scriptId, P);
      if (subId) {
        await runScriptById(subId, { ...ctx, depth: (ctx.depth || 0) + 1 });
      }
      return node.next || null;
    }
    case 'random': {
      // Weighted pick between outcomes: [{ next, weight }]. A missing/invalid
      // weight counts as 1; an outcome with weight 0 is parked, not deleted.
      // Falls through to node.next when nothing is pickable, so a half-authored
      // random node degrades to a pass-through instead of ending the script.
      const outs = (node.outcomes || []).filter(o => o && (Number(o.weight ?? 1) > 0));
      const total = outs.reduce((s, o) => s + (Number(o.weight ?? 1) || 1), 0);
      if (!outs.length || total <= 0) return node.next || null;
      let roll = Math.random() * total;
      for (const o of outs) {
        roll -= (Number(o.weight ?? 1) || 1);
        if (roll <= 0) return o.next || node.next || null;
      }
      return outs[outs.length - 1].next || node.next || null;
    }
    case 'counter': {
      // Increment a numeric flag, then optionally branch on a threshold.
      // Without a threshold it's just "bump this and carry on" (node.next).
      // reset:true zeroes the flag when the threshold is met, which is what
      // makes "every Nth time" a single node instead of three.
      // delta/threshold are interpolated too, so a counter can accumulate a
      // VALUE off the event rather than just tallying occurrences:
      //   delta: "${event.delta}" on credits.changed → a lifetime-spend ledger.
      // A token that fails to resolve stays verbatim, so Number() gives NaN and
      // the `|| 0` below makes it a no-op rather than a corrupted total.
      const scope = node.scope || 'player';
      const delta = Number(interp(node.delta ?? 1, P)) || 0;
      const flag = interp(node.flag, P);
      const current = Number(await getFlag(scope, flag, ctx.actor)) || 0;
      const rawThreshold = interp(node.threshold, P);
      const threshold = rawThreshold == null || rawThreshold === '' ? null : Number(rawThreshold);
      const hit = threshold != null && !Number.isNaN(threshold) && (current + delta) >= threshold;
      // reset arrives as a real boolean from VINE but as the STRING "false" from
      // a select/raw JSON — and "false" is truthy. Coerce explicitly.
      const doReset = node.reset === true || node.reset === 1 || node.reset === 'true';
      const value = (hit && doReset) ? 0 : current + delta;
      await dispatchAction({
        type: 'SET_FLAG', actor: ctx.actor,
        params: { scope, flag, value: String(value) },
      });
      if (threshold == null) return node.next || null;
      return (hit ? node.ifTrue : node.ifFalse) || node.next || null;
    }
    case 'wait': {
      const next = node.next || null;
      const secs = Math.max(0, Number(interp(node.seconds, P)) || 0);
      if (!next) return null;
      if (secs >= DURABLE_WAIT_S) {
        // Long waits are PARKED IN THE DB, not held in a timer — a restart would
        // otherwise silently eat every pending consequence. This is what makes a
        // three-day debt authorable rather than just a 45-second beat.
        await parkWait(ctx, next, secs);
        return null;
      }
      // Fire-and-forget delayed continuation; the script's owning call returns now.
      setTimeout(() => {
        runNodeChain(ctx.graph, next, ctx).catch(e =>
          console.error(`[graph] wait continuation error: ${e.message}`));
      }, secs * 1000);
      return null; // stop the synchronous walk; the timer resumes it
    }
    default:
      console.warn(`[graph] unknown node type: ${node.type}`);
      return node.next || null;
  }
}

/**
 * Resolve a dead-drop container: an exact furniture id first, otherwise a
 * name/alias match among the container furniture in that zone (the same shape
 * `open <name>` uses, so what an author types is what a player can open).
 * Zone-scoped on the name path — a drop must never land in a "locker" three
 * districts away because two rooms named their furniture the same thing.
 */
async function resolveDropContainer(ref, zoneId) {
  const { rows: byId } = await query(
    `SELECT id FROM furniture WHERE id=$1 AND object_type='container' LIMIT 1`, [ref]);
  if (byId.length) return byId[0].id;
  const { rows } = await query(
    `SELECT id FROM furniture
     WHERE zone_id=$1 AND object_type='container'
       AND (name ILIKE $2 OR flags->>'aliases' ILIKE $2) LIMIT 1`,
    [zoneId, `%${ref}%`]
  );
  return rows.length ? rows[0].id : null;
}

// ── Durable waits ───────────────────────────────────────────────────────────
// A `wait` at or past this many seconds is persisted to script_waits instead of
// living in a setTimeout, so a deploy or crash doesn't drop it.
const DURABLE_WAIT_S = 120;

// Parked waits are almost always absent, and resumeDueWaits polls for them on a
// schedule — so the gate lets that tick skip the round trip entirely while the
// table is empty. See engine/worklist.js for why the counter is only ever an
// optimisation and the periodic re-probe is what keeps it correct.
const waitsGate = createWorkGate({
  name: 'script_waits',
  probe: async () => (await query('SELECT COUNT(*)::int AS n FROM script_waits')).rows[0].n,
});

async function parkWait(ctx, nextNodeId, secs) {
  await query(
    `INSERT INTO script_waits (id, script_id, graph, node_id, player_id, params, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), ctx.scriptId || null, JSON.stringify(ctx.graph || {}), nextNodeId,
     ctx.actor?.id || null, JSON.stringify(ctx.params || {}), Date.now() + secs * 1000]
  );
  waitsGate.noteWork();
}

/**
 * Resume every due parked wait. Scheduled (see server/index.js), so it is
 * idle-gated by scheduler.js and never runs against an empty world.
 *
 * A row whose player is offline is LEFT IN PLACE rather than run or discarded —
 * the consequence lands the next time they're actually connected to see it. That
 * makes the table a queue of owed outcomes, not a stopwatch.
 */
export async function resumeDueWaits(broadcast) {
  if (!await waitsGate.shouldRun()) return 0;
  const { rows } = await query(
    'SELECT * FROM script_waits WHERE due_at <= $1 ORDER BY due_at LIMIT 50', [Date.now()]);
  if (!rows.length) return 0;
  let ran = 0;
  for (const row of rows) {
    const actor = row.player_id ? getLivePlayer(row.player_id) : null;
    if (row.player_id && !actor) continue; // still owed — wait for them to log in
    await query('DELETE FROM script_waits WHERE id=$1', [row.id]);
    ran++;
    try {
      await runNodeChain(row.graph, row.node_id, {
        actor, broadcast, graph: row.graph, params: row.params || {},
        scriptId: row.script_id, depth: 0,
      });
    } catch (e) {
      console.error(`[graph] parked wait ${row.id} failed: ${e.message}`);
    }
  }
  return ran;
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
  // scriptId rides the ctx so a parked `wait` can record which asset it came from.
  await runGraph(graph, { ...ctx, graph, scriptId });
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
    const name = getItem(item_id)?.name || item_id;
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
    const zone_id = resolveLanding(params.zone_id); // facades forward into their interior
    const target = getZone(zone_id);
    if (!target) return { type: 'error', message: `Unknown zone: ${params.zone_id}` };
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

// Relocate an NPC's home for good, from dialogue or a script.
//
// This is NOT a teleport — it changes where an NPC *lives*, which is what makes
// a rescue, a defection or a promotion stick across a restart. The plain move
// (TELEPORT-style) is undone by the next boot, because boot re-places NPCs at
// home_zone; and writing npcs.home_zone directly is undone by the next content
// deploy, because that column is authored content. setNpcHomeOverride is the
// only route that survives both. Pass no zone_id to send them back to the home
// their content file authored.
registerAction({
  type: 'SET_NPC_HOME',
  handler: async ({ params }) => {
    const npcId = params.npc_id || params.npc;
    if (!npcId) return { type: 'error', message: 'SET_NPC_HOME requires npc_id.' };
    if (!world.npcs.has(npcId)) return { type: 'error', message: `Unknown NPC: ${npcId}` };
    const zoneId = resolveLanding(params.zone_id || params.zone); // facades forward into their interior
    if (!zoneId) { // no destination = revert to the authored home
      await clearNpcHomeOverride(npcId);
      return { type: 'npc_home', npc_id: npcId, home_zone: null, cleared: true };
    }
    const ok = await setNpcHomeOverride(npcId, zoneId, { source: params.source || 'content', reason: params.reason || null });
    if (!ok) return { type: 'error', message: `SET_NPC_HOME: unusable zone ${zoneId}` };
    return { type: 'npc_home', npc_id: npcId, home_zone: zoneId };
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
    // scriptParams lets a dialogue node reuse a parameterised graph the same way
    // a trigger row does (params, not scriptParams, is already this action's own
    // argument bag — hence the distinct key).
    const { scriptId, graph, scriptParams } = params;
    const g = graph || (scriptId && await loadScript(scriptId));
    if (!g) return { type: 'error', message: 'EXECUTE_SCRIPT: no script found.' };
    await runGraph(g, { actor, broadcast: context?.broadcast, graph: g, depth: 0, params: scriptParams || undefined });
    return { type: 'script', scriptId: scriptId || null };
  },
});

// Open an NPC's vendor shop (dialogue "Open Shop").
registerAction({
  type: 'OPEN_SHOP',
  handler: async ({ actor, params, context }) => {
    const { npcId } = params;
    if (!npcId) return { type: 'error', message: 'OPEN_SHOP requires npcId.' };
    const npc = world.npcs.get(npcId);
    if (!npc) return { type: 'error', message: `NPC not found: ${npcId}` };
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
