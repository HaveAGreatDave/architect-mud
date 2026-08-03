// plugins/consort/hire.js
//
// The retainer: placing a consort, keeping one, paying for one, losing one.
//
// ── Why the consort is not an `npcs` row ──────────────────────────────────────
// She (or he) is a LIVE-ONLY NPC, spawned into world.npcs from a player_consorts
// row at boot and on order, and dropped out of it on release. That's deliberate,
// and it's the same law the storefront plugin's hired staff follow for the same
// reason: `npcs` is a CONTENT-class table owned by git, so a consort written
// there would export into the content tree and land on every other database as a
// phantom stranger with somebody else's name on her. The ledger row is the only
// persistence; everything else about her is regenerated from the archetype
// registry and her appearance seed, which is why the schema is so small.
//
// Nothing in the engine minds an NPC with no DB row — the one write path that
// could touch it (gameLoop's hp sync) is an UPDATE that matches zero rows and
// carries on, and content:export reads the npcs TABLE, never world.npcs, so a
// roster can't leak into a commit.
//
// ── Billing ───────────────────────────────────────────────────────────────────
// Charged per GAME day on environment.dayRollover, the same calendar apartment
// rent and shop mortgages run on. Drafted bank → pocket. Two consecutive misses
// and they leave — with a scene, because they are not a subscription that lapses
// quietly, whatever the app implies.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { world, getZone, getLivePlayer, getAllLivePlayers } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { gameToday, addGameDays, gameDaysBetween, ymd, playerControlsApt } from '../../server/engine/apartments.js';
import { ARCHETYPES, PAIRINGS, renderLine } from './archetypes.js';
import { generateAppearance, describeAppearance } from './appearance.js';
import { effectiveRate, loyaltyTier, LOYALTY_TIERS } from './roster.js';

const MISSES_BEFORE_LEAVING = 2;

// ── Ledger ────────────────────────────────────────────────────────────────────
// ── House placements ─────────────────────────────────────────────────────────
// A consort the HOUSE keeps rather than one the Syndicate placed. An authored NPC
// carrying `flags.consort_house_of: '<handle>'` belongs to that player, appears in
// their B.L.I.S.S. arrangement, and costs nothing — Cyd does not invoice himself
// for staff aboard his own boat.
//
// Deliberately NOT a `player_consorts` row. That table is per-player runtime state
// (never exported as content), so seeding rows into it would mean a one-shot
// script that a fresh database wouldn't have — the boat would come back empty on
// every rebuild. Reading the flag instead makes ownership authored content that
// survives a restore, and keeps them out of the billing sweep for free: the
// retainer loop walks `player_consorts`, and these were never in it.
const HOUSE_FLAG = 'consort_house_of';

function houseConsortsFor(handle) {
  if (!handle) return [];
  const want = String(handle).toLowerCase();
  const out = [];
  for (const npc of world.npcs.values()) {
    const owner = npc?.flags?.[HOUSE_FLAG];
    if (!owner || String(owner).toLowerCase() !== want) continue;
    // Shaped like a player_consorts row so every consumer — the arrangement
    // screen, the pairing collapse, the loyalty tier — works unchanged.
    out.push({
      id: npc.id,
      owner_handle: handle,
      name: npc.name,
      archetype: npc.flags.consort_archetype || 'romantic',
      sex: npc.flags.consort_sex || 'female',
      pairing_id: npc.flags.consort_pairing_id || null,
      home_zone: npc.home_zone || npc.zone_id || null,
      daily_rate: 0,          // the house rate, and what marks it as one
      days_kept: 0,
      missed: 0,
      hired_at: 0,
      house: true,
    });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function consortRowsOf(playerId) {
  const { rows } = await query(
    'SELECT * FROM player_consorts WHERE owner_id=$1 ORDER BY hired_at', [playerId]);
  // House placements first — they're the permanent fixtures, and a paid placement
  // is the transient thing sitting alongside them.
  const p = getLivePlayer(playerId);
  return [...houseConsortsFor(p?.handle), ...rows];
}

export async function consortRow(id) {
  const { rows } = await query('SELECT * FROM player_consorts WHERE id=$1', [id]);
  return rows[0] || null;
}

// Everyone in the same pairing as this row (including the row itself). A single
// placement returns just itself — release/billing treat both shapes identically.
// What the player currently keeps, collapsed so a matched pair reads as ONE
// entry — it bills and releases as a single unit, and listing the two halves
// separately would invite trying to release one.
//
// This lives here rather than in bliss-app.js because there are now two front
// ends over it (the tablet app and the `bliss` verb), and the retainer arithmetic
// is exactly the sort of thing that drifts when it's written twice: one of them
// would eventually show the base rate where the other showed the loyalty-adjusted
// one, and a player would be told two different daily costs for the same people.
export async function arrangementEntries(playerId) {
  const rows = await consortRowsOf(playerId);
  const seen = new Set();
  const entries = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    const group = r.pairing_id ? rows.filter(x => x.pairing_id === r.pairing_id) : [r];
    group.forEach(g => seen.add(g.id));
    const todayRate = group.reduce((s, g) => s + effectiveRate(g.daily_rate, g.days_kept), 0);
    const baseRate = group.reduce((s, g) => s + g.daily_rate, 0);
    entries.push({
      id: r.id,
      row: r,
      names: group.map(g => g.name),
      pairing: r.pairing_id ? (PAIRINGS[group.map(g => g.archetype).sort().join('_')]?.label || 'A matched pair') : null,
      daysKept: r.days_kept || 0,
      tier: loyaltyTier(r.days_kept || 0),
      // The rung above, so the app can draw how far a placement is along its
      // tenure rather than just naming where it stands. Derived here and not in
      // the client because LOYALTY_TIERS is the tunable — a ladder copied into a
      // renderer is a ladder that drifts. Null at the top rung: there is no next.
      nextTier: (() => {
        const kept = r.days_kept || 0;
        const nxt = LOYALTY_TIERS.find(t => t.days > kept);
        if (!nxt) return null;
        const prev = loyaltyTier(kept).days;
        const span = nxt.days - prev;
        return {
          label: nxt.label,
          days: nxt.days,
          daysAway: nxt.days - kept,
          pct: span > 0 ? Math.round(((kept - prev) / span) * 100) : 0,
        };
      })(),
      baseRate,
      todayRate,
      saving: Math.max(0, baseRate - todayRate),
      missed: r.missed || 0,
      zone: r.home_zone,
      // A house placement is listed like any other — that's the whole point of
      // showing it — but it carries no retainer and cannot be released: the
      // Syndicate did not place them and has no say in it.
      house: !!r.house,
    });
  }
  return entries;
}

export async function pairMembers(row) {
  if (!row?.pairing_id) return row ? [row] : [];
  const { rows } = await query(
    'SELECT * FROM player_consorts WHERE owner_id=$1 AND pairing_id=$2 ORDER BY hired_at',
    [row.owner_id, row.pairing_id]);
  return rows.length ? rows : [row];
}

// ── Spawning ──────────────────────────────────────────────────────────────────
// Build the live NPC from the ledger row + the archetype registry + the seed.
// Shape mirrors world.js loadNpcs() exactly, minus the DB row behind it.
export function spawnConsort(row) {
  if (!row?.id) return null;
  if (world.npcs.has(row.id)) return world.npcs.get(row.id);

  const appearance = generateAppearance(row.seed, { sex: row.sex, build: row.body });
  const arch = ARCHETYPES[row.archetype] || ARCHETYPES.romantic;

  const live = {
    id: row.id,
    name: row.name,
    description: describeAppearance(row.name, appearance),
    zone_id: row.home_zone,
    home_zone: row.home_zone,
    faction: null,
    dialogue_tree: {},
    vendor_inventory: [],
    wanders: 0,
    wander_zones: [],
    behaviour_graph: {},
    chitchat: [],
    banter: [],
    npc_type: 'npc',
    hp: 20, hp_max: 20,
    sex: appearance.sex,
    biological_sex: appearance.sex,
    studio_zone_id: null,
    work_zone_id: null,
    vendor_shop_name: null,
    home_activities: null,
    onFurniture: null,
    flags: {
      consort: true,
      consort_archetype: row.archetype,
      consort_sex: appearance.sex,
      consort_ledger: true,            // marks a B.L.I.S.S. placement vs. an authored one
      consort_pairing: row.pairing_id || null,
      devoted_to: row.owner_handle,
      clothing_layers: appearance.layers,
      no_banter: true,                 // their conversations belong to this plugin
    },
    _appearance: appearance,
    _archetype: arch,
    _consortRow: row,
    _ai: { currentNode: null, waitUntil: null, patrolPath: [], patrolTarget: null, patrolMode: 'walk', patrolIndex: 0, alertCooldown: 0, lastSay: 0, flags: {} },
  };

  world.npcs.set(live.id, live);
  const z = world.zones.get(live.zone_id);
  if (z) z.npcs.add(live.id);
  else live.zone_id = null;
  return live;
}

export function despawnConsort(id) {
  const live = world.npcs.get(id);
  if (!live) return false;
  if (live.zone_id) world.zones.get(live.zone_id)?.npcs.delete(id);
  world.npcs.delete(id);
  return true;
}

// Boot: put every retained consort back where their ledger row says they live.
export async function rehydrateConsorts() {
  try {
    const { rows } = await query('SELECT * FROM player_consorts');
    let n = 0;
    for (const row of rows) {
      if (!row.home_zone || !world.zones.has(row.home_zone)) {
        console.warn(`[consort] ${row.name} [${row.id}] has no valid billet (${row.home_zone}); leaving unspawned.`);
        continue;
      }
      if (spawnConsort(row)) n++;
    }
    if (n) console.log(`[consort] ${n} retained consort(s) restored to their billets.`);
  } catch (e) {
    console.error('[consort] rehydrate failed:', e.message);
  }
}

// ── Private spaces ────────────────────────────────────────────────────────────
// "Any private space you hold." Three sources, none of them hardcoded to a zone
// id: an apartment you control, a shop you own, or any zone authored with
// `flags.private_billet_owner` set to your handle (the escape hatch that makes
// the Echelon's boudoir work for its owner without this plugin knowing what a
// yacht is).
export async function privateSpacesOf(player) {
  const out = [];
  const seen = new Set();
  const add = (zoneId, label) => {
    if (!zoneId || seen.has(zoneId)) return;
    const z = getZone(zoneId);
    if (!z) return;
    seen.add(zoneId);
    out.push({ id: zoneId, name: z.name || zoneId, label });
  };

  for (const [zoneId, apt] of world.apartments) {
    if (playerControlsApt(player, apt)) add(zoneId, 'Residence');
  }
  for (const [zoneId, z] of world.zones) {
    if (z.flags?.private_billet_owner === player.handle) add(zoneId, 'Private');
  }
  try {
    const { rows } = await query('SELECT zone_id FROM storefronts WHERE owner_id=$1', [player.id]);
    for (const r of rows) add(r.zone_id, 'Premises');
  } catch { /* storefront table may not exist on a bare test DB */ }

  return out;
}

export async function holdsPrivateSpace(player, zoneId) {
  const spaces = await privateSpacesOf(player);
  return spaces.some(s => s.id === zoneId);
}

// ── Ordering ──────────────────────────────────────────────────────────────────
// Takes a generated listing (roster.js) and makes it real: one ledger row per
// member, one live NPC per member, the first day's rate charged up front.
// A pairing is all-or-nothing by construction — both rows share a pairing_id and
// every release path resolves the whole pairing.
export async function placeListing(player, listing, zoneId) {
  const today = gameToday();
  const pairingId = listing.kind === 'pairing' ? randomUUID() : null;
  const created = [];

  for (const m of listing.members) {
    const id = `consort_${randomUUID()}`;
    const row = {
      id,
      owner_id: player.id,
      owner_handle: player.handle,
      name: m.name,
      archetype: m.archetypeKey,
      body: m.appearance.build,
      sex: m.appearance.sex,
      seed: m.seed,
      pairing_id: pairingId,
      home_zone: zoneId,
      daily_rate: listing.kind === 'pairing' ? Math.round(listing.rate / listing.members.length) : listing.rate,
      days_kept: 0,
      missed: 0,
      hired_at: Date.now(),
      last_seen_at: Date.now(),
      next_due: today ? addGameDays(today, 1) : null,
    };
    await query(
      `INSERT INTO player_consorts
        (id, owner_id, owner_handle, name, archetype, body, sex, seed, pairing_id, home_zone,
         daily_rate, days_kept, missed, hired_at, last_seen_at, next_due)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [row.id, row.owner_id, row.owner_handle, row.name, row.archetype, row.body, row.sex,
       row.seed, row.pairing_id, row.home_zone, row.daily_rate, 0, 0, row.hired_at,
       row.last_seen_at, row.next_due]);
    spawnConsort(row);
    created.push(row);
  }
  return created;
}

// ── Release ───────────────────────────────────────────────────────────────────
// Ends the arrangement. A pairing goes together — that's the whole point of a
// pairing, and the app refuses to break one.
export async function releaseConsort(row, reason = 'released') {
  const members = await pairMembers(row);
  for (const m of members) {
    const live = world.npcs.get(m.id);
    if (live?.zone_id) {
      sendToZone(live.zone_id, { type: 'zone_event', message: departureLine(live, reason) });
    }
    despawnConsort(m.id);
    await query('DELETE FROM player_consorts WHERE id=$1', [m.id]);
  }
  return members;
}

function departureLine(live, reason) {
  const name = live.name;
  if (reason === 'unpaid') {
    return `<span class="text-dim">A courier in Syndicate grey collects ${name} without a word to anybody. ` +
      `${renderLine('{They} {do} not look back on the way out, which is somehow worse than if {they} had.', live)}</span>`;
  }
  return `<span class="text-dim">${name} packs the little there is to pack, and goes.</span>`;
}

// ── Billing ───────────────────────────────────────────────────────────────────
// One charge per consort per game day, at the loyalty-adjusted rate. Drafted
// bank first, then pocket. Miss twice running and the Syndicate collects.
export async function billingTick(todayOverride = null) {
  const today = todayOverride || gameToday();
  if (!today) return;

  const { rows } = await query('SELECT * FROM player_consorts');
  // Group by pairing so a pair bills and fails as one unit.
  const handled = new Set();

  for (const row of rows) {
    if (handled.has(row.id)) continue;
    const group = row.pairing_id ? rows.filter(r => r.pairing_id === row.pairing_id) : [row];
    group.forEach(g => handled.add(g.id));

    let due = ymd(row.next_due);
    if (!due) {
      const seeded = addGameDays(today, 1);
      for (const g of group) await query('UPDATE player_consorts SET next_due=$1 WHERE id=$2', [seeded, g.id]);
      continue;
    }
    if (gameDaysBetween(today, due) > 0) continue;   // not due yet

    // Advance past any days a dev date-jump skipped — charge once, not once per day.
    let next = due;
    do { next = addGameDays(next, 1); } while (gameDaysBetween(today, next) <= 0);

    const owed = group.reduce((s, g) => s + effectiveRate(g.daily_rate, g.days_kept), 0);
    const { rows: pr } = await query(
      'SELECT id, handle, credits, bank_credits FROM players WHERE id=$1', [row.owner_id]);
    if (!pr.length) { await releaseConsort(row, 'unpaid'); continue; }
    const p = pr[0];

    const paid = await draft(p, owed);
    const names = group.map(g => g.name).join(' and ');

    if (paid) {
      for (const g of group) {
        await query(
          'UPDATE player_consorts SET next_due=$1, days_kept=days_kept+1, missed=0 WHERE id=$2',
          [next, g.id]);
        const live = world.npcs.get(g.id);
        if (live?._consortRow) { live._consortRow.days_kept = (g.days_kept || 0) + 1; }
      }
      notify(p.id, `<span class="text-dim">B.L.I.S.S. retainer: <span style="color:var(--yellow)">${owed}c</span> for ${names}. ` +
        `${loyaltyTier((row.days_kept || 0) + 1).label}.</span>`);
      continue;
    }

    const missed = (row.missed || 0) + 1;
    if (missed >= MISSES_BEFORE_LEAVING) {
      notify(p.id, `<span style="color:var(--red)">B.L.I.S.S.: the retainer on ${names} has lapsed. The placement has been collected.</span>`);
      await releaseConsort(row, 'unpaid');
      continue;
    }
    for (const g of group) {
      await query('UPDATE player_consorts SET next_due=$1, missed=$2 WHERE id=$3', [next, missed, g.id]);
    }
    notify(p.id, `<span style="color:var(--yellow)">B.L.I.S.S.: retainer of ${owed}c for ${names} could not be drawn. ` +
      `One more missed day and the placement is collected.</span>`);
  }
}

// Bank first, then pocket. Returns false only if the player genuinely can't cover it.
async function draft(p, owed) {
  const res = await query(
    `UPDATE players
        SET bank_credits = bank_credits - LEAST(bank_credits, $1),
            credits      = credits - GREATEST(0, $1 - LEAST(bank_credits, $1))
      WHERE id = $2
        AND bank_credits + credits >= $1
      RETURNING credits, bank_credits`, [owed, p.id]);
  if (!res.rowCount) return false;
  const live = getLivePlayer(p.id);
  if (live) { live.credits = res.rows[0].credits; live.bank_credits = res.rows[0].bank_credits; }
  return true;
}

function notify(playerId, message) {
  const live = getLivePlayer(playerId);
  if (live) sendToPlayer(playerId, { type: 'output', message });
}

on('environment.dayRollover', () => {
  billingTick().catch(e => console.error('[consort] billing tick failed:', e.message));
});

export const _test = {
  spawnConsort, despawnConsort, privateSpacesOf, holdsPrivateSpace,
  billingTick, draft, departureLine, MISSES_BEFORE_LEAVING,
};
