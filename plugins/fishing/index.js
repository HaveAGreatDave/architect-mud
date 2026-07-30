// Fishing plugin.
//
// A perpetual, posture-based cast-and-wait action — the water-side cousin of
// scavenging (see plugins/scavenging/index.js and docs/systems-fishing.md).
// `posture === "fishing"` is the authoritative activity flag, so it inherits
// every engine force-stand interruption (moving, attacking, being attacked) for
// free. A companion `player.fishState = { zoneId, streak, lastAttempt, pending, token }`
// carries the bookkeeping the posture string can't.
//
// WHERE you can fish (see fishingTableFor): a zone may opt in explicitly with
// zones.flags.fishing_table_id -> a reusable scavenging_tables template, and that
// always wins — it's how a special spot gets its own list. Failing that, ANY tile
// orthogonally touching water fishes the common bay table, so a beach or a bank
// just works without being authored tile by tile. (Fishing reuses the scavenging
// schema; a separate flag keeps the two systems from colliding.) Per-zone stock is
// created lazily on first cast, so each new shoreline tile gets its own independent
// stock of the shared table rather than sharing a pool.
// Normal catches live in scavenging_table_items with per-zone
// stock + lazy replenish, exactly like scavenging. Fishing-only extras — monster
// hooks and bait-gated catches — live in dedicated scavenging_tables columns
// (fishing_monsters / fishing_bait_catches).
//
// The twist over scavenging: a bite doesn't grant instantly. It ARMS the
// client-side tension-bar reel overlay (a `fishing_game` message). The overlay
// is cosmetic-authoritative like Circuit Breach / Hololock — winning it is the
// gate — and reports back via `fishresolve`, which the server validates
// (anti-spoof token + still-fishing + still-carrying-a-rod) before applying the
// catch, spawning a hooked monster, or snapping the rod on a botched reel.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, getAllZones, getLivePlayer, spawnEnemySync, zoneTerrain } from '../../server/engine/world.js';
import { registerActivity } from '../../server/engine/activity-tick.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { repairItem, conditionBand, destroyItem } from '../../server/engine/durability.js';
import { escAttr } from '../../server/engine/text.js';

const ATTEMPT_MS = 4200;    // per-cast cadence — a touch slower than scavenging; fishing is patient
const MAX_SWING = 14;       // best possible 2d8-2d8 roll — reachability ceiling
const HINT_STREAK = 3;      // consecutive quiet casts before the "try another spot" nudge
const BITE_CHANCE = 0.55;   // base chance a cast gets a bite; bait nudges it up
const PENDING_TTL_MS = 30000; // if an armed overlay isn't resolved in time (player aborted), the fish gets away
const ROD_SNAP_CHANCE = 0.18; // chance a botched reel damages the rod
const ROD_SNAP_DAMAGE = 0.25; // condition lost per snap — four bad reels retire a rod

// Default flavor pools. A table's `messages` JSONB may override `player` /
// `broadcast`; empty/absent arrays fall back to these.
const DEFAULT_PLAYER_FLAVOR = [
  'You flick the line out over the black water and settle in to wait.',
  'The float bobs on an oily swell. You watch it, and wait.',
  'You reel in a little slack and cast again, further out this time.',
  'Something breaks the surface out past your line — then nothing.',
  'The water laps at the pilings. Your line hangs slack.',
];
const DEFAULT_QUIET = [
  'Nothing\'s biting.',
  'The line stays slack. Whatever\'s down there isn\'t interested.',
  'You feel a nibble — then slack again. Missed it.',
];
const DEFAULT_BROADCAST = [
  'casts a line out over the water and settles in to fish.',
];

const DEPTH_MAX = 12;       // difficulty that maps to "as deep as it gets" — normalises a catch's home depth

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }
function nowSec() { return Math.floor(Date.now() / 1000); }
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

// Pick the catch from an armed pool given the player's cast — power (0 shallow .. 1
// deep) and angle (0.5 straight; off-axis toward either bank). A catch's "home
// depth" is derived from its difficulty (deeper = better), so a deep cast tilts
// the draw toward the scarcer entries. Casting off-line trades away the ordinary
// pool for a better shot at the off-line specials (bait-gated catches + monster
// hooks) — the "different catches on an angle" idea.
function pickCastTarget(pool, power, angle) {
  const offAxis = clamp01(Math.abs(angle - 0.5) * 2);
  const weighted = pool.map(e => {
    const fishDepth = clamp01(e.difficulty / DEPTH_MAX);
    const depthAffinity = 1 - Math.abs(power - fishDepth);   // 0..1, peaks when the cast reaches its depth
    let w = Math.max(1, e.weight) * (0.35 + depthAffinity);
    if (e.kind === 'monster' || e.baitGated) w *= 1 + offAxis * 2.2;  // specials favour the off-line cast
    else w *= 1 - offAxis * 0.4;                                      // straight water favours the ordinary pool
    return { e, w: Math.max(0.05, w) };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of weighted) { r -= x.w; if (r < 0) return x.e; }
  return weighted[weighted.length - 1].e;
}

function pickWeighted(entries) {
  const total = entries.reduce((s, e) => s + Math.max(1, e.weight), 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= Math.max(1, e.weight);
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

// ── Gear: rod (required) + bait (optional) ────────────────────────────────────
// Mirrors the ATM hack_device gate (plugins/atm/index.js): the gate is the
// capability tag on a carried, uncontained item — not a specific item id.

async function hasRod(playerId) {
  return !!(await resolveInventoryItem(playerId, { tag: 'fishing_rod' }));
}

// A botched reel can snap the rod: shed condition, and retire it at zero.
async function maybeSnapRod(playerId) {
  if (Math.random() >= ROD_SNAP_CHANCE) return '';
  const rod = await resolveInventoryItem(playerId, { tag: 'fishing_rod' });
  if (!rod) return '';
  // Through the durability substrate — one funnel (server/engine/durability.js).
  await repairItem(rod, -ROD_SNAP_DAMAGE);
  if (conditionBand(rod.condition).id === 'broken') {
    await destroyItem(rod);
    return ' Your rod snaps clean in half and the pieces spin off into the water.';
  }
  return ' Your rod groans and takes a worrying bend — that nearly cost you it.';
}

// The set of bait sub-tags the player is currently carrying (for bait-gated
// catches), plus whether they hold any generic bait at all.
async function baitState(playerId) {
  const rows = await resolveInventoryItem(playerId, { tag: 'bait', all: true });
  const tags = new Set();
  for (const r of rows) for (const t of Object.keys(r.tags || {})) tags.add(t);
  return { hasBait: rows.length > 0, tags };
}

// Consume one bait item (decrement a stack, delete at zero). Called on a catch.
async function consumeBait(playerId) {
  const b = await resolveInventoryItem(playerId, { tag: 'bait', orderBy: 'pi.quantity ASC' });
  if (!b) return;
  if ((b.quantity ?? 1) > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [b.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [b.inv_id]);
}

// ── Table + per-zone stock loading (lazy replenish) ───────────────────────────
// Reuses the scavenging_tables / scavenging_table_items / scavenging_zone_stock /
// scavenging_zone_state schema verbatim — a fishing table is just a scavenging
// table pointed at by a different zone flag. Logic mirrors scavenging's
// loadZoneTable (per-zone stock init on first touch, one weighted unit per
// elapsed replenish interval).
// ── Where you can fish ────────────────────────────────────────────────────────
// A zone opts in explicitly with flags.fishing_table_id, and that ALWAYS wins —
// it's how a special spot gets its own list (the Echelon's stern, the piers).
// Failing that, any tile orthogonally touching water fishes the common bay table,
// so a player standing on a beach or a bank can simply cast.
const DEFAULT_FISHING_TABLE = 'fish_coldwater_bay';

// "Water" is zoneTerrain() — the single marker, since the legacy `flags.water`
// duplicate was retired on 2026-07-21. This deliberately covers the wildlands
// hydrology as well as the basin: connected-component analysis showed those tiles
// form a north-west sea feeding a one-tile-wide river that meanders ~25 tiles south
// into a delta, plus a north-east sea with a hand-eroded coastline — authored
// geography whose descriptions simply haven't been written yet. A river fishes.
const isWater = (z) => zoneTerrain(z) === 'water';

// Coord index of water tiles per map/floor, so the adjacency test is a hash lookup
// instead of a ~5,700-zone scan — runAttempt runs on a tick for every fishing
// player. Short TTL so a dev-panel repaint self-heals without a restart.
const WATER_INDEX_TTL_MS = 60_000;
let waterIndex = null, waterIndexAt = 0;
function waterCoords() {
  const now = Date.now();
  if (waterIndex && now - waterIndexAt < WATER_INDEX_TTL_MS) return waterIndex;
  const set = new Set();
  for (const z of getAllZones()) {
    if (!isWater(z) || !z.map_id || z.grid_x == null || z.grid_y == null) continue;
    set.add(`${z.map_id}|${z.grid_z ?? 0}|${z.grid_x},${z.grid_y}`);
  }
  waterIndex = set; waterIndexAt = now;
  return set;
}
function bordersWater(zone) {
  if (!zone?.map_id || zone.grid_x == null || zone.grid_y == null) return false;
  const idx = waterCoords(), z0 = zone.grid_z ?? 0;
  return [[0, -1], [0, 1], [1, 0], [-1, 0]].some(([dx, dy]) =>
    idx.has(`${zone.map_id}|${z0}|${zone.grid_x + dx},${zone.grid_y + dy}`));
}

// The table this zone fishes, or null if you can't fish here at all.
export function fishingTableFor(zone) {
  if (!zone) return null;
  if (zone.flags?.fishing_table_id) return zone.flags.fishing_table_id;  // authored spot wins outright
  if (isWater(zone)) return null;   // you cast FROM the bank, not while treading water
  return bordersWater(zone) ? DEFAULT_FISHING_TABLE : null;
}

async function loadZoneTable(zoneId, tableId) {
  const { rows: tRows } = await query(
    'SELECT id, name, replenish_interval_seconds, messages, fishing_monsters, fishing_bait_catches FROM scavenging_tables WHERE id=$1',
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

  const interval = Math.max(1, table.replenish_interval_seconds);
  const steps = Math.floor((nowSec() - lastReplenish) / interval);
  if (steps > 0) {
    let applied = 0;
    while (applied < steps) {
      const room = entries.filter(e => e.current_qty < e.max_qty);
      if (!room.length) break;
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
    quiet: Array.isArray(m.quiet) && m.quiet.length ? m.quiet : DEFAULT_QUIET,
    broadcast: Array.isArray(m.broadcast) && m.broadcast.length ? m.broadcast : DEFAULT_BROADCAST,
  };
}

// ── State bookkeeping (posture is authoritative — merge onto the live obj) ─────

function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }

function advanceState(pid, patch) {
  const cur = getLivePlayer(pid);
  if (!cur || cur.posture !== 'fishing') return;
  cur.fishState = { ...cur.fishState, ...patch };
}

function stopFishing(pid, zoneId, handle) {
  const cur = getLivePlayer(pid);
  if (!cur || cur.posture !== 'fishing') return;
  forceStand(cur, 'fishing.stop');
  delete cur.fishState;
  sendToZone(zoneId, { type: 'zone_event', message: `${handle} reels in and stops fishing.` }, pid);
}

// ── The perpetual cast ────────────────────────────────────────────────────────

async function runAttempt(player, st, nowMs) {
  const zone = getZone(st.zoneId);
  const tableId = fishingTableFor(zone);
  if (!zone || !tableId) { stopFishing(player.id, st.zoneId, player.handle); return; }

  if (!(await hasRod(player.id))) {
    out(player.id, 'Without a rod there\'s nothing to fish with.');
    stopFishing(player.id, st.zoneId, player.handle);
    return;
  }

  const loaded = await loadZoneTable(st.zoneId, tableId);
  if (!loaded || !loaded.entries.length) {
    out(player.id, 'The water here is dead — nothing lives in it.');
    stopFishing(player.id, st.zoneId, player.handle);
    return;
  }
  const { table, entries } = loaded;
  const pools = flavorPools(table);
  // Fishing-only pools now live in dedicated columns (were table.messages.fishing).
  const extras = {
    baitCatches: table.fishing_bait_catches || [],
    monsters: table.fishing_monsters || [],
  };
  const bait = await baitState(player.id);

  // Build the eligible bite pool: stocked normal catches (bait boosts the rarer,
  // higher-difficulty ones), plus bait-gated catches whose bait the player holds,
  // plus monster hooks. Each entry is normalised to { kind, item_id?, enemyTemplateId?, difficulty, weight, name }.
  const pool = [];
  for (const e of entries) {
    if (e.current_qty <= 0) continue;
    // Bait tilts the draw toward scarcer catches (higher difficulty ⇒ better).
    const boost = bait.hasBait ? 1 + Math.max(0, e.difficulty - 4) * 0.35 : 1;
    pool.push({ kind: 'catch', item_id: e.item_id, name: e.name, difficulty: e.difficulty, weight: Math.max(1, e.weight) * boost });
  }
  for (const bc of (extras.baitCatches || [])) {
    if (bc.requiresBaitTag && !bait.tags.has(bc.requiresBaitTag)) continue;
    pool.push({ kind: 'catch', item_id: bc.itemId, name: bc.name || 'catch', difficulty: bc.difficulty ?? 7, weight: bc.weight ?? 2, baitGated: true });
  }
  for (const mon of (extras.monsters || [])) {
    pool.push({ kind: 'monster', enemyTemplateId: mon.enemyTemplateId, name: mon.name || 'something', difficulty: mon.difficulty ?? 9, weight: mon.weight ?? 2 });
  }

  if (!pool.length) {
    out(player.id, 'You search the water, but there\'s nothing left here to catch.');
    stopFishing(player.id, st.zoneId, player.handle);
    return;
  }

  const effective = await effectiveSkill(player, 'fishing');
  const flavor = pick(pools.player);

  // Not every cast gets a bite — bait makes the water livelier.
  const biteChance = BITE_CHANCE + (bait.hasBait ? 0.15 : 0);
  if (Math.random() > biteChance) {
    out(player.id, `${flavor} ${pick(pools.quiet)}`);
    const streak = (st.streak || 0) + 1;
    if (streak === HINT_STREAK) out(player.id, 'The fish here are wary. Might be worth trying a different spot — or better bait.');
    advanceState(player.id, { lastAttempt: nowMs, streak });
    return;
  }

  // A bite — but which fish it is isn't settled yet: the player's CAST decides.
  // Stash the eligible pool and ARM the cast overlay (charge a power meter for
  // depth, aim an angle). The client reports the cast via `fishcast`, and only
  // then does cmdFishCast pick the target and arm the reel fight. The board's
  // cast-stage feel is tuned to the pool's average difficulty (we don't yet know
  // the specific catch); skill tunes the rest.
  const token = randomUUID();
  const avgDiff = Math.round(pool.reduce((s, e) => s + e.difficulty, 0) / pool.length);
  advanceState(player.id, { lastAttempt: nowMs, streak: 0, pending: { pool, token, armedAt: nowMs, phase: 'cast' } });
  out(player.id, `${flavor}\n<span class="text-cyan">Something stirs the black water past your float — ready your cast.</span>`);
  sendToPlayer(player.id, {
    type: 'fishing_game',
    zoneId: st.zoneId,
    deviceName: 'THE LINE',
    skill: effective,
    castDifficulty: avgDiff,
    castCmd: 'fishcast',
    token,
  });
}

// ── Tick ──────────────────────────────────────────────────────────────────────

registerActivity({
  posture: 'fishing',
  stateKey: 'fishState',
  onTick: async (player, st, nowMs) => {
    // A bite is armed and waiting on the overlay — hold the loop. If the
    // player abandoned the overlay, time it out (the fish gets away).
    if (st.pending) {
      if (nowMs - st.pending.armedAt > PENDING_TTL_MS) {
        out(player.id, 'You wait too long — the line goes slack. Whatever it was, it\'s gone.');
        advanceState(player.id, { pending: null, lastAttempt: nowMs });
      }
      return;
    }
    if (nowMs - st.lastAttempt < ATTEMPT_MS) return;
    await runAttempt(player, st, nowMs);
  },
  onAbandon: (player) => {
    const cur = getLivePlayer(player.id);
    if (cur) delete cur.fishState;
    out(player.id, 'You stop fishing.');
  },
});


on('player.stop', ({ player, stopped }) => {
  if (player.posture !== 'fishing') return;
  stopFishing(player.id, player.current_zone, player.handle);
  stopped.push('fishing');
});

// ── Resolve — the overlay reports its outcome here ────────────────────────────
// fishresolve <zoneId> <1|0> <token> — silent; the tension-bar overlay fires it
// with its own win/lose. That outcome is authoritative (like Circuit Breach);
// the server only validates the token + posture + carried rod before acting.

// fishcast <zoneId> <power> <angle> <token> — the cast overlay reports its
// aim/power here. This is where the catch is actually chosen (from the pool
// stashed at bite time), weighted by depth (power) and off-line specials
// (angle). We then arm the reel fight tuned to that specific catch. Silent,
// token-gated, anti-spoof — power/angle are clamped to [0,1] server-side, and
// the pool is the server's, so the client can only influence the draw, never
// summon an out-of-pool catch.
async function cmdFishCast(args, raw, player) {
  const zoneId = args[0];
  const power = clamp01(Number(args[1]));
  const angle = clamp01(Number.isFinite(Number(args[2])) ? Number(args[2]) : 0.5);
  const token = args[3];
  const cur = getLivePlayer(player.id);
  const st = cur?.fishState;
  if (!cur || cur.posture !== 'fishing' || !st || !st.pending || st.pending.phase !== 'cast') return { type: 'noop' };
  if (st.pending.token !== token || st.zoneId !== zoneId) return { type: 'noop' };

  if (!(await hasRod(player.id))) {
    out(player.id, 'Your rod\'s gone — nothing to cast with.');
    stopFishing(player.id, st.zoneId, player.handle);
    return { type: 'noop' };
  }

  const target = pickCastTarget(st.pending.pool, power, angle);
  advanceState(player.id, { pending: { ...st.pending, target, phase: 'fight', armedAt: Date.now() } });

  const effective = await effectiveSkill(player, 'fishing');
  sendToPlayer(player.id, {
    type: 'fishing_fight',
    zoneId: st.zoneId,
    skill: effective,
    difficulty: target.difficulty,
    resolveCmd: 'fishresolve',
    token,
  });
  return { type: 'noop' };
}

async function cmdFishResolve(args, raw, player, broadcast) {
  const zoneId = args[0];
  const won = args[1] === '1';
  const token = args[2];
  const cur = getLivePlayer(player.id);
  const st = cur?.fishState;
  if (!cur || cur.posture !== 'fishing' || !st || !st.pending) return { type: 'noop' };
  if (st.pending.phase !== 'fight' || !st.pending.target) return { type: 'noop' };
  if (st.pending.token !== token || st.zoneId !== zoneId) return { type: 'noop' };

  const target = st.pending.target;
  advanceState(player.id, { pending: null, lastAttempt: Date.now() });

  if (!(await hasRod(player.id))) {
    out(player.id, 'Your rod\'s gone — nothing to land it with.');
    stopFishing(player.id, st.zoneId, player.handle);
    return { type: 'noop' };
  }

  // Monster hook — the thing surfaces either way; winning just means you're
  // braced when it does. It spawns into the zone and aggros; fishing ends.
  if (target.kind === 'monster') {
    if (target.enemyTemplateId) {
      const { rows } = await query('SELECT * FROM enemies WHERE id=$1', [target.enemyTemplateId]);
      if (rows[0]) {
        const inst = spawnEnemySync(rows[0], st.zoneId);
        broadcast(st.zoneId, { type: 'zone_event', message: `The water erupts as <b>${inst.name}</b> comes thrashing up the line onto the dock!`, refresh: true });
      }
    }
    out(player.id, won
      ? '<span class="text-yellow">You haul back hard — and something far bigger than a fish comes with it.</span>'
      : '<span class="text-red">The line screams out — whatever took it is coming up whether you like it or not.</span>');
    if (won) await awardSkillUse(player.id, 'fishing', 4);
    stopFishing(player.id, st.zoneId, player.handle);
    return { type: 'noop' };
  }

  // Ordinary / bait-gated catch.
  if (won) {
    // Bait-gated catches aren't zone-stocked; normal catches decrement stock.
    if (!target.baitGated) {
      const dec = await query(
        'UPDATE scavenging_zone_stock SET current_qty=current_qty-1 WHERE zone_id=$1 AND item_id=$2 AND current_qty>0',
        [st.zoneId, target.item_id]
      );
      if (!dec.rowCount) { out(player.id, 'It slips the hook at the last second and is gone.'); return { type: 'noop' }; }
    }
    await query(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,1,1.0)',
      [randomUUID(), player.id, target.item_id]
    );
    const bait = await baitState(player.id);
    if (bait.hasBait) await consumeBait(player.id);
    const margin = Math.max(0, (await effectiveSkill(player, 'fishing')) - target.difficulty);
    await awardSkillUse(player.id, 'fishing', margin);
    const link = `<span class="action-link item-link" data-action="examine" data-target="${escAttr(target.name)}" title="Examine ${escAttr(target.name)}">${target.name}</span>`;
    out(player.id, `<span class="item-grant">You work it in and swing ${link} up onto the dock.</span>`);
    // A landed catch ends the action, mirroring scavenging — recast to keep going.
    stopFishing(player.id, st.zoneId, player.handle);
    return { type: 'noop' };
  }

  // Lost the reel — the line snapped or the fish threw the hook.
  const snapMsg = await maybeSnapRod(player.id);
  out(player.id, `<span class="text-red">The line goes slack — it\'s gone. The big ones always are.</span>${snapMsg}`);
  if (snapMsg.includes('snaps clean')) { stopFishing(player.id, st.zoneId, player.handle); }
  return { type: 'noop' };
}

// ── Command ───────────────────────────────────────────────────────────────────

async function cmdFish(args, raw, player, broadcast) {
  if (player.posture === 'fishing')
    return { type: 'emote', message: 'You\'re already fishing.' };
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId)
    return { type: 'emote', message: 'You\'re a little busy to be fishing right now.' };
  if ((player.posture || 'standing') !== 'standing')
    return { type: 'emote', message: 'You need to be on your feet to fish.' };

  const zone = getZone(player.current_zone);
  const tableId = fishingTableFor(zone);
  if (!zone || !tableId)
    return { type: 'emote', message: 'There\'s no water here worth fishing.' };
  if (!(await hasRod(player.id)))
    return { type: 'emote', message: 'You need a fishing rod to fish.' };

  const loaded = await loadZoneTable(player.current_zone, tableId);
  if (!loaded || !loaded.entries.length)
    return { type: 'emote', message: 'The water here is dead — nothing lives in it.' };

  const pools = flavorPools(loaded.table);
  setPosture(player, 'fishing');
  player.fishState = { zoneId: player.current_zone, streak: 0, lastAttempt: Date.now() - ATTEMPT_MS, pending: null };
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} ${pick(pools.broadcast)}` }, player.id);
  return { type: 'emote', message: 'You bait the hook, cast your line out over the water, and settle in to fish.' };
}

export const commands = {
  fish: cmdFish,
  fishcast: cmdFishCast,
  fishresolve: cmdFishResolve,
};

// Pure helpers exposed for the regression suite (never used in production).
export const _test = { pickWeighted, pickCastTarget, BITE_CHANCE, ROD_SNAP_CHANCE, ATTEMPT_MS, fishingTableFor, bordersWater, DEFAULT_FISHING_TABLE, invalidateWaterIndex: () => { waterIndex = null; } };

console.log('[fishing] Plugin loaded.');
