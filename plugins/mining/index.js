// Mining plugin.
//
// A perpetual, posture-based deposit-working action — the rock-face cousin of
// scavenging (see plugins/scavenging/index.js and docs/systems-mining.md).
// `posture === "mining"` is the authoritative activity flag (see
// docs/systems-posture.md) — it inherits every engine force-stand interruption
// (moving, attacking, being attacked) for free. A companion
// `player.mineState = { zoneId, streak, lastAttempt }` carries the bookkeeping the
// posture string can't; posture is authoritative, so when it stops reading
// "mining" this plugin discards the stale state.
//
// A zone opts in via zones.flags.mining_table_id -> a reusable scavenging_tables
// template (mining reuses that schema; a separate flag keeps it from colliding
// with scavenging/fishing on the same zone). Depletion and replenish are tracked
// PER-ZONE (scavenging_zone_stock / scavenging_zone_state), computed lazily on
// read, exactly like scavenging. The one thing mining adds over scavenging: a
// carried, uncontained item tagged `mining_tool` is the tool gate (the fishing-rod
// pattern) — no pick, no mining.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, getLivePlayer } from '../../server/engine/world.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { registerActivity } from '../../server/engine/activity-tick.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';

const ATTEMPT_MS = 3800;   // per-swing cadence — a touch slower than scavenging; stone is stubborn
const MAX_SWING = 14;      // best possible 2d8-2d8 roll — reachability ceiling
const HINT_STREAK = 3;     // consecutive dry swings before the "work the seam harder" nudge

// Default message pools. A table's `messages` JSONB may override `player` and/or
// `broadcast`; empty/absent arrays fall back to these.
const DEFAULT_PLAYER_FLAVOR = [
  'You set the pick and swing, chips of stone spitting off the face.',
  'You lean into a fissure and lever a slab loose, grunting with it.',
  'You work the drill along a seam, dust boiling up thick and grey.',
  'You crack a promising-looking nodule open and peer into the break.',
  'You hammer a wedge deep and rock it until something gives.',
  'You scrape the loose spoil aside and read the rock underneath.',
];
const DEFAULT_BROADCAST = [
  'sets to work on the rock face, mining for anything worth hauling out.',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }
function nowSec() { return Math.floor(Date.now() / 1000); }

function pickWeighted(entries) {
  const total = entries.reduce((s, e) => s + Math.max(1, e.weight), 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= Math.max(1, e.weight);
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

// The tool gate: a carried, uncontained item tagged `mining_tool` (the fishing-rod
// carry-gate pattern — a capability tag, not a specific item id).
async function hasPick(playerId) {
  return !!(await resolveInventoryItem(playerId, { tag: 'mining_tool' }));
}

// ── Table + per-zone stock loading (with lazy replenish) ──────────────────────
// Reuses the scavenging_* schema verbatim; per-zone stock is shared by item id if
// a zone happens to run more than one gathering system on the same item (harmless,
// by design — the fishing note in docs/systems-fishing.md).

// Returns { table, entries } where each entry carries { item_id, name, difficulty,
// weight, max_qty, current_qty } post-replenish, or null if the zone has no usable
// table. Initialises per-zone stock/state on first touch and persists replenish.
async function loadZoneTable(zoneId, tableId) {
  const { rows: tRows } = await query(
    'SELECT id, name, replenish_interval_seconds, messages FROM scavenging_tables WHERE id=$1',
    [tableId]
  );
  if (!tRows.length) return null;
  const table = tRows[0];

  const { rows: entries } = await query(
    `SELECT si.item_id, si.difficulty, si.weight, si.max_qty, it.name
     FROM scavenging_table_items si JOIN items it ON it.id = si.item_id
     WHERE si.table_id = $1`,
    [tableId]
  );
  if (!entries.length) return { table, entries: [] };

  // Init state on first touch: full stock, clock anchored now.
  const { rows: stateRows } = await query(
    'SELECT last_replenish FROM scavenging_zone_state WHERE zone_id=$1',
    [zoneId]
  );
  let lastReplenish;
  if (!stateRows.length) {
    lastReplenish = nowSec();
    await query(
      'INSERT INTO scavenging_zone_state (zone_id, table_id, last_replenish) VALUES ($1,$2,$3)',
      [zoneId, tableId, lastReplenish]
    );
    for (const e of entries) {
      await query(
        `INSERT INTO scavenging_zone_stock (zone_id, item_id, current_qty) VALUES ($1,$2,$3)
         ON CONFLICT (zone_id, item_id) DO NOTHING`,
        [zoneId, e.item_id, e.max_qty]
      );
      e.current_qty = e.max_qty;
    }
    return { table, entries };
  }
  lastReplenish = Number(stateRows[0].last_replenish) || 0;

  // Merge live stock; entries added to the template after init start at 0.
  const { rows: stock } = await query(
    'SELECT item_id, current_qty FROM scavenging_zone_stock WHERE zone_id=$1',
    [zoneId]
  );
  const stockMap = new Map(stock.map(s => [s.item_id, s.current_qty]));
  for (const e of entries) {
    if (!stockMap.has(e.item_id)) {
      await query(
        `INSERT INTO scavenging_zone_stock (zone_id, item_id, current_qty) VALUES ($1,$2,0)
         ON CONFLICT (zone_id, item_id) DO NOTHING`,
        [zoneId, e.item_id]
      );
      e.current_qty = 0;
    } else {
      e.current_qty = stockMap.get(e.item_id);
    }
  }

  // Lazy replenish catch-up: one weighted unit per elapsed interval, toward max_qty.
  const interval = Math.max(1, table.replenish_interval_seconds);
  const steps = Math.floor((nowSec() - lastReplenish) / interval);
  if (steps > 0) {
    let applied = 0;
    while (applied < steps) {
      const room = entries.filter(e => e.current_qty < e.max_qty);
      if (!room.length) break; // everything full — clock stays frozen (see docs)
      pickWeighted(room).current_qty++;
      applied++;
    }
    if (applied > 0) {
      for (const e of entries) {
        await query(
          'UPDATE scavenging_zone_stock SET current_qty=$1 WHERE zone_id=$2 AND item_id=$3',
          [e.current_qty, zoneId, e.item_id]
        );
      }
      await query(
        'UPDATE scavenging_zone_state SET last_replenish=$1 WHERE zone_id=$2',
        [lastReplenish + applied * interval, zoneId]
      );
    }
  }
  return { table, entries };
}

function flavorPools(table) {
  const m = table.messages || {};
  return {
    player: Array.isArray(m.player) && m.player.length ? m.player : DEFAULT_PLAYER_FLAVOR,
    broadcast: Array.isArray(m.broadcast) && m.broadcast.length ? m.broadcast : DEFAULT_BROADCAST,
  };
}

// ── State persistence (posture is authoritative — merge onto the current live obj) ─

function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }

// Advance mineState bookkeeping; no-op if the player is no longer mining. Mutates
// in place — clone-and-replace would orphan references the game loop (and our
// in-place posture writes) still hold.
function advanceState(pid, patch) {
  const cur = getLivePlayer(pid);
  if (!cur || cur.posture !== 'mining') return;
  cur.mineState = { ...cur.mineState, ...patch };
}

// End the action: drop back to standing, clear state, and tell the room.
function stopMining(pid, zoneId, handle) {
  const cur = getLivePlayer(pid);
  if (!cur || cur.posture !== 'mining') return;
  forceStand(cur, 'mining.stop');
  delete cur.mineState;
  sendToZone(zoneId, { type: 'zone_event', message: `${handle} stops mining.` }, pid);
}

// ── The perpetual attempt ─────────────────────────────────────────────────────

async function runAttempt(player, st, nowMs) {
  const zone = getZone(st.zoneId);
  const tableId = zone?.flags?.mining_table_id;
  if (!zone || !tableId) { stopMining(player.id, st.zoneId, player.handle); return; }

  // Lost the pick mid-work (dropped, stashed, stolen) — stop like fishing does.
  if (!(await hasPick(player.id))) {
    out(player.id, 'Without a tool in hand, there\'s no working this rock.');
    stopMining(player.id, st.zoneId, player.handle);
    return;
  }

  const loaded = await loadZoneTable(st.zoneId, tableId);
  if (!loaded || !loaded.entries.length) {
    out(player.id, 'You work the face, but there\'s nothing in this rock worth taking.');
    stopMining(player.id, st.zoneId, player.handle);
    return;
  }
  const { table, entries } = loaded;
  const pools = flavorPools(table);

  const totalStock = entries.reduce((s, e) => s + e.current_qty, 0);
  if (totalStock === 0) {
    out(player.id, 'You work the face, but this deposit\'s played out — nothing left in it.');
    stopMining(player.id, st.zoneId, player.handle);
    return;
  }

  const effective = await effectiveSkill(player, 'mining');
  const available = entries.filter(e => e.current_qty > 0);
  const reachable = available.filter(e => effective + MAX_SWING >= e.difficulty);
  if (!reachable.length) {
    out(player.id, 'There\'s ore in here — but it\'s locked in harder rock than you can crack.');
    stopMining(player.id, st.zoneId, player.handle);
    return;
  }

  // Roll one weighted-random available item; failing an out-of-reach pick is fine.
  const target = pickWeighted(available);
  const margin = (effective - target.difficulty) + (roll2d8() - roll2d8());
  const flavor = pick(pools.player);

  // Every swing trains Mining — a near-miss teaches as much as a strike (abs
  // margin, see awardIp), so coming up empty still improves you.
  await awardSkillUse(player.id, 'mining', margin);

  if (margin >= 0) {
    const dec = await query(
      'UPDATE scavenging_zone_stock SET current_qty=current_qty-1 WHERE zone_id=$1 AND item_id=$2 AND current_qty>0',
      [st.zoneId, target.item_id]
    );
    if (!dec.rowCount) { advanceState(player.id, { lastAttempt: nowMs }); return; } // raced dry
    await query(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)',
      [randomUUID(), player.id, target.item_id]
    );
    const link = `<span class="action-link item-link" data-action="examine" data-target="${target.name}" title="Examine ${target.name}">${target.name}</span>`;
    out(player.id, `${flavor}\n<span class="item-grant">You break out ${link} and pocket it.</span>`);
    if (totalStock - 1 === 0)
      out(player.id, 'That was the last of it — this deposit is worked out.');
    // A successful strike always ends the action.
    stopMining(player.id, st.zoneId, player.handle);
    return;
  }

  // Failure.
  out(player.id, `${flavor} Nothing but spoil.`);
  const streak = (st.streak || 0) + 1;
  if (streak === HINT_STREAK) {
    out(player.id, 'There\'s a promising seam here — you just need to work it harder...');
  }
  advanceState(player.id, { lastAttempt: nowMs, streak });
}

// ── Tick ──────────────────────────────────────────────────────────────────────

registerActivity({
  posture: 'mining',
  stateKey: 'mineState',
  onTick: async (player, st, nowMs) => {
    if (nowMs - st.lastAttempt < ATTEMPT_MS) return;
    await runAttempt(player, st, nowMs);
  },
  // Posture was cleared out from under us (moved / attacked / stood). Clean up.
  onAbandon: (player) => {
    const cur = getLivePlayer(player.id);
    if (cur) delete cur.mineState;
    out(player.id, 'You stop mining.');
  },
});


// The unified STOP command halts mining like any other repeating action.
on('player.stop', ({ player, stopped }) => {
  if (player.posture !== 'mining') return;
  stopMining(player.id, player.current_zone, player.handle);
  stopped.push('mining');
});

// ── Command ─────────────────────────────────────────────────────────────────

async function cmdMine(args, raw, player, broadcast) {
  if (player.posture === 'mining')
    return { type: 'emote', message: 'You\'re already working this rock face.' };
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type: 'emote', message: 'You\'re too busy fighting to mine.' };
  if ((player.posture || 'standing') !== 'standing')
    return { type: 'emote', message: 'You need to be on your feet to mine.' };

  const zone = getZone(player.current_zone);
  const tableId = zone?.flags?.mining_table_id;
  if (!zone || !tableId)
    return { type: 'emote', message: 'There\'s no deposit here worth working.' };

  if (!(await hasPick(player.id)))
    return { type: 'emote', message: 'You need a pick or drill in hand to mine.' };

  const loaded = await loadZoneTable(player.current_zone, tableId);
  if (!loaded || !loaded.entries.length)
    return { type: 'emote', message: 'There\'s no deposit here worth working.' };

  const pools = flavorPools(loaded.table);
  // Enter the mining posture. lastAttempt is back-dated so the first swing fires on
  // the very next tick (immediate feedback for played-out / no-shot deposits).
  setPosture(player, 'mining');
  player.mineState = { zoneId: player.current_zone, streak: 0, lastAttempt: Date.now() - ATTEMPT_MS };
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} ${pick(pools.broadcast)}` }, player.id);
  return { type: 'emote', message: 'You set your tool to the rock and start mining.' };
}

export const commands = {
  mine: cmdMine,
};

console.log('[mining] Plugin loaded.');
