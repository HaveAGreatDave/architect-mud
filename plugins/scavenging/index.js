// Scavenging plugin.
//
// A perpetual, posture-based search action. `posture === "scavenging"` is the
// authoritative activity flag (see docs/systems-posture.md) — it inherits every
// engine force-stand interruption (moving, attacking, being attacked) for free.
// A companion `player.scavengeState = { zoneId, streak, lastAttempt }` carries the
// bookkeeping the posture string can't; posture is authoritative, so when it stops
// reading "scavenging" this plugin discards the stale state.
//
// A zone opts in via zones.flags.scavenging_table_id -> a reusable scavenging_tables
// template. Depletion and replenish are tracked PER-ZONE (scavenging_zone_stock /
// scavenging_zone_state). Replenish is computed lazily on read (catch-up), so an
// untouched zone burns no CPU but is correctly stocked when someone finally arrives.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, getAllLivePlayers, getLivePlayer } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';

const ATTEMPT_MS = 3500;   // per-attempt cadence, sibling to the attack cooldown
const MAX_SWING = 14;      // best possible 2d8-2d8 roll — reachability ceiling
const HINT_STREAK = 3;     // consecutive failures before the "search harder" nudge

// Default message pools. A table's `messages` JSONB may override `player` and/or
// `broadcast`; empty/absent arrays fall back to these.
const DEFAULT_PLAYER_FLAVOR = [
  'You dig through a heap of debris, tossing aside the worthless bits.',
  'You pry back a sheet of buckled metal and grope around underneath.',
  'You overturn a mound of rubble, squinting at what it was hiding.',
  'You paw through a tangle of scrap, wire, and rot.',
  'You sift through the grime and grit, feeling for anything solid.',
  'You crack open a crushed container and rifle through its guts.',
];
const DEFAULT_BROADCAST = [
  'starts picking through the area, scavenging for anything useful.',
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

// ── Table + per-zone stock loading (with lazy replenish) ──────────────────────

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

// Advance scavengeState bookkeeping; no-op if the player is no longer scavenging.
// Mutates in place — clone-and-replace would orphan references the game loop
// (and our in-place posture writes) still hold.
function advanceState(pid, patch) {
  const cur = getLivePlayer(pid);
  if (!cur || cur.posture !== 'scavenging') return;
  cur.scavengeState = { ...cur.scavengeState, ...patch };
}

// End the action: drop back to standing, clear state, and tell the room.
function stopScavenging(pid, zoneId, handle) {
  const cur = getLivePlayer(pid);
  if (!cur || cur.posture !== 'scavenging') return;
  forceStand(cur, 'scavenging.stop');
  delete cur.scavengeState;
  sendToZone(zoneId, { type: 'zone_event', message: `${handle} stops scavenging.` }, pid);
}

// ── The perpetual attempt ─────────────────────────────────────────────────────

async function runAttempt(player, st, nowMs) {
  const zone = getZone(st.zoneId);
  const tableId = zone?.flags?.scavenging_table_id;
  if (!zone || !tableId) { stopScavenging(player.id, st.zoneId, player.handle); return; }

  const loaded = await loadZoneTable(st.zoneId, tableId);
  if (!loaded || !loaded.entries.length) {
    out(player.id, 'You search, but there\'s nothing here to find.');
    stopScavenging(player.id, st.zoneId, player.handle);
    return;
  }
  const { table, entries } = loaded;
  const pools = flavorPools(table);

  const totalStock = entries.reduce((s, e) => s + e.current_qty, 0);
  if (totalStock === 0) {
    out(player.id, 'You search, but there\'s nothing left here to find.');
    stopScavenging(player.id, st.zoneId, player.handle);
    return;
  }

  const effective = await effectiveSkill(player, 'scavenging');
  const available = entries.filter(e => e.current_qty > 0);
  const reachable = available.filter(e => effective + MAX_SWING >= e.difficulty);
  if (!reachable.length) {
    out(player.id, 'You can tell there\'s something here — but you\'ve got no shot of finding it.');
    stopScavenging(player.id, st.zoneId, player.handle);
    return;
  }

  // Roll one weighted-random available item; failing an out-of-reach pick is fine.
  const target = pickWeighted(available);
  const margin = (effective - target.difficulty) + (roll2d8() - roll2d8());
  const flavor = pick(pools.player);

  // Every search attempt trains Scavenging — a near-miss teaches as much as a
  // find (abs margin, see awardIp), so coming up empty still improves you.
  await awardSkillUse(player.id, 'scavenging', margin);

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
    out(player.id, `${flavor}\n<span class="item-grant">You turn up ${link} and pocket it.</span>`);
    if (totalStock - 1 === 0)
      out(player.id, 'That was the last of it — you\'ve picked the area clean.');
    // A successful find always ends the action.
    stopScavenging(player.id, st.zoneId, player.handle);
    return;
  }

  // Failure.
  out(player.id, `${flavor} You come up empty.`);
  const streak = (st.streak || 0) + 1;
  if (streak === HINT_STREAK) {
    out(player.id, 'You get the feeling there\'s something here, if you just search a little harder...');
  }
  advanceState(player.id, { lastAttempt: nowMs, streak });
}

// ── Tick ──────────────────────────────────────────────────────────────────────

let ticking = false;
async function scavengeTick() {
  if (ticking) return;
  ticking = true;
  try {
    const nowMs = Date.now();
    for (const player of getAllLivePlayers()) {
      const st = player.scavengeState;
      if (player.posture === 'scavenging') {
        if (!st) continue;
        if (nowMs - st.lastAttempt < ATTEMPT_MS) continue;
        await runAttempt(player, st, nowMs);
      } else if (st) {
        // Posture was cleared out from under us (moved / attacked / stood). Clean up.
        const cur = getLivePlayer(player.id);
        if (cur) delete cur.scavengeState;
        out(player.id, 'You stop scavenging.');
      }
    }
  } finally {
    ticking = false;
  }
}

schedule('1s', () => scavengeTick().catch(e => console.error('[scavenging] tick error:', e.message)));

// The unified STOP command halts scavenging like any other repeating action.
on('player.stop', ({ player, stopped }) => {
  if (player.posture !== 'scavenging') return;
  stopScavenging(player.id, player.current_zone, player.handle);
  stopped.push('scavenging');
});

// ── Command ─────────────────────────────────────────────────────────────────

async function cmdScavenge(args, raw, player, broadcast) {
  if (player.posture === 'scavenging')
    return { type: 'emote', message: 'You\'re already digging through this place.' };
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type: 'emote', message: 'You\'re too busy fighting to scavenge.' };
  if ((player.posture || 'standing') !== 'standing')
    return { type: 'emote', message: 'You need to be on your feet to scavenge.' };

  const zone = getZone(player.current_zone);
  const tableId = zone?.flags?.scavenging_table_id;
  if (!zone || !tableId)
    return { type: 'emote', message: 'There\'s nothing here worth picking through.' };

  const loaded = await loadZoneTable(player.current_zone, tableId);
  if (!loaded || !loaded.entries.length)
    return { type: 'emote', message: 'There\'s nothing here worth picking through.' };

  const pools = flavorPools(loaded.table);
  // Enter the scavenging posture. lastAttempt is back-dated so the first attempt
  // fires on the very next tick (immediate feedback for empty / no-shot zones).
  setPosture(player, 'scavenging');
  player.scavengeState = { zoneId: player.current_zone, streak: 0, lastAttempt: Date.now() - ATTEMPT_MS };
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} ${pick(pools.broadcast)}` }, player.id);
  return { type: 'emote', message: 'You start scavenging the area, digging for anything worth taking.' };
}

export const commands = {
  scavenge: cmdScavenge,
};

console.log('[scavenging] Plugin loaded.');
