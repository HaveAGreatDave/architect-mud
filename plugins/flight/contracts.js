// Flight — cargo & passenger contracts (the freight economy). A field's board
// carries jobs: haul cargo or fly a passenger origin→dest airfield within a
// deadline for a payout that scales with distance × weight × risk. Cargo loads
// into the craft as weight (feeding takeoff difficulty + fuel burn via effStats).
// Contraband jobs pay more but must be flown dark — running the transponder off
// dodges SPECTER but is itself a crime in controlled airspace.
//
// Contracts are quests (plugins/quests) under the hood: a devpanel/VINE-authored
// "flight_template" quest row is an archetype (Freight, Smuggling, VIP Charter…);
// topUp() rolls a concrete "flight" quest instance from a template for a field's
// board (a fresh non-repeatable quest row with a single 'deliver' objective).
// Accepting binds it to an aircraft (dispatches START_QUEST); a verified landing
// (checkContractDelivery, called from index.js cmdLandResolve) dispatches TURN_IN
// so payment flows through the same canonical reward-grant path every quest uses.
// 'deliver' objectives are never auto-tracked by zone.entered — see the comment
// in plugins/quests/index.js — so a player can't fake a delivery by walking there.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, liveAircraft, out, persist, fieldFor as fieldOf, isContinuous, pushContext, effLoadout, installedKits, BAND_BURN, REFUEL_PRICE_PER_UNIT, rentalOpFee, airfieldOf, fieldName } from './state.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { getZoneNpcs } from '../../server/engine/world.js';
import { teachVerb } from '../../server/engine/messaging.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { registerPurchaseDelivery } from '../../server/engine/vendor.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';

const nowSec = () => Math.floor(Date.now() / 1000);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const BOARD_TTL_S = 6 * 3600;       // an untaken posting is culled after this long
const STALE_DONE_S = 24 * 3600;     // a turned-in/abandoned instance is swept after this long

export async function airfields() {
  const { rows } = await query("SELECT id, name, grid_x, grid_y, flags FROM zones WHERE map_id='map_world' AND flags ? 'airfield_id'");
  return rows;
}

// Devpanel/VINE-authored archetypes — see scripts/migrate-flight-job-types.js for
// the seed. meta shape: { kind:'cargo'|'passenger', legal, payMult, riskBase,
// wMin, wMax, deadlineMins, names:[...] }.
async function loadTemplates() {
  const { rows } = await query("SELECT * FROM quests WHERE quest_type='flight_template'");
  return rows;
}

// A generic mid-tier aircraft assumption for the board's up-front quote (the real
// aircraft — and its rental status — isn't known until accept, when the payout is
// recomputed and frozen in).
const GENERIC_TYPE = { fuel_burn_base: 1.0, cargo_capacity: 200, price_rent_hourly: 200, seats: 4 };

// Payout = what the run actually costs (fuel + rental, if rented) plus a margin —
// thin when renting (barely profitable), fatter when flying your own iron (decently
// profitable), plus a small risk premium. Tunable — see docs/proposals/systems-flight.md
// "Economy balance target" for the open design note this replaces a flat formula for.
function estimateContractPayout({ type, rental, dist, weight, deadlineMins, riskBase }) {
  const t = type || GENERIC_TYPE;
  const loadFrac = weight / (t.cargo_capacity || 1);
  const burnPerLeg = (t.fuel_burn_base || 1) * (1 + loadFrac * 0.5) * (BAND_BURN.cruise || 1.25);
  const fuelUnits = burnPerLeg * dist * 2; // round trip
  const fuelCost = fuelUnits * REFUEL_PRICE_PER_UNIT;
  const rentalCost = rental ? rentalOpFee(t) * ((deadlineMins || 20) / 30) : 0;
  const margin = rental ? 0.20 : 0.55;
  const riskBonus = (riskBase || 0) * 15;
  return Math.round((fuelCost + rentalCost) * (1 + margin) + riskBonus);
}

// Keep ~4 open jobs on a field's board (lazy top-up when listed). Legal fields
// carry only honest work; lawless fields also carry the shady jobs.
export async function topUp(fieldZone, fields) {
  await query(
    `DELETE FROM quests WHERE quest_type='flight' AND (
       (meta->>'expiresAt')::bigint < $1 AND id NOT IN (SELECT quest_id FROM player_quests)
       OR id IN (SELECT quest_id FROM player_quests WHERE status IN ('turned_in','abandoned') AND updated_at < $2)
     )`,
    [nowSec(), nowSec() - STALE_DONE_S]
  );

  const { rows } = await query(
    `SELECT COUNT(*)::int n FROM quests WHERE quest_type='flight' AND meta->>'originZone'=$1
     AND id NOT IN (SELECT quest_id FROM player_quests)`,
    [fieldZone.id]
  );
  const have = rows[0]?.n || 0;
  const others = fields.filter(f => f.id !== fieldZone.id && f.grid_x != null);
  if (!others.length) return;
  const lawless = !!airfieldOf(fieldZone)?.lawless;
  const lawlessDests = others.filter(f => airfieldOf(f)?.lawless);
  const templates = await loadTemplates();
  const legalTemplates = templates.filter(t => t.meta?.legal);
  const illegalTemplates = templates.filter(t => !t.meta?.legal);
  if (!legalTemplates.length && !illegalTemplates.length) return; // nothing authored yet
  const pool = () => (lawless && illegalTemplates.length && Math.random() < 0.4) ? illegalTemplates : legalTemplates;

  for (let i = have; i < 4; i++) {
    const candidates = pool().length ? pool() : (legalTemplates.length ? legalTemplates : illegalTemplates);
    if (!candidates.length) break;
    const tmpl = pick(candidates);
    const m = tmpl.meta || {};
    // A template may pin its destination (meta.destZone, authored in VINE) — land
    // at that specific airfield rather than a random one. Only honoured when it's a
    // real other field on the map; otherwise falls back to the random pick.
    const fixed = m.destZone && others.find(f => f.id === m.destZone);
    const dest = fixed || ((!m.legal && lawlessDests.length) ? pick(lawlessDests) : pick(others));
    const dist = cheb(fieldZone.grid_x, fieldZone.grid_y, dest.grid_x, dest.grid_y) || 1;
    const wMin = m.wMin || 40, wMax = Math.max(wMin, m.wMax || wMin);
    const weight = wMin + Math.floor(Math.random() * (wMax - wMin + 1));
    const risk = Math.min(5, 1 + Math.floor(dist / 4) + (m.riskBase || 0) + (airfieldOf(dest)?.lawless ? 1 : 0));
    const names = Array.isArray(m.names) && m.names.length ? m.names : ['a shipment'];
    const cargoName = pick(names);
    const deadlineMins = m.deadlineMins || 20;
    const destName = fieldName(dest);
    const quoted = estimateContractPayout({ type: GENERIC_TYPE, rental: true, dist, weight, deadlineMins, riskBase: risk });

    await query(
      `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
       VALUES ($1,$2,$3,$4,$5,0,'flight',$6,EXTRACT(EPOCH FROM NOW()))`,
      [
        `quest_flight_${randomUUID().slice(0, 8)}`,
        tmpl.name,
        cargoName,
        JSON.stringify([{ type: 'deliver', zone: dest.id, count: 1, desc: `Deliver ${cargoName} to ${destName}` }]),
        JSON.stringify({ credits: quoted }),
        JSON.stringify({
          templateId: tmpl.id, originZone: fieldZone.id, destZone: dest.id, dist, weight, risk,
          contraband: m.legal ? 0 : 1, deadlineS: deadlineMins * 60, kind: m.kind || 'cargo',
          cargoName, jobType: tmpl.name, expiresAt: nowSec() + BOARD_TTL_S,
        }),
      ]
    );
  }
}

export function boardRows(fieldId) {
  return query(
    `SELECT * FROM quests WHERE quest_type='flight' AND meta->>'originZone'=$1
     AND id NOT IN (SELECT quest_id FROM player_quests)
     ORDER BY (rewards->>'credits')::int DESC, name`,
    [fieldId]
  );
}

// `contracts`/`jobs` opens Tablet OS pre-navigated to Quests → Pilot Contracts
// (the "no duplicate UI" ask) instead of text-rendering the board. `accept <n>`
// (board position, unchanged) still works as a chat shortcut.
async function cmdContracts(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'The contract board is at the airfields.' };
  const { commands: tabletCommands } = await import('../tablet/index.js');
  return tabletCommands.tabletnav(['quests', 'Pilot Contracts'], raw, player);
}

async function cmdAccept(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Accept contracts at the airfield board.' };
  const n = parseInt(args[0], 10);
  const { rows } = await boardRows(field.id);
  const q = rows[n - 1];
  if (!q) return { type: 'emote', message: 'No such job on the board. Type <b>contracts</b> to see it.' };
  const m = q.meta || {};

  // Bind to the aircraft the player is aboard / has parked here.
  let live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  let aircraftId = live?.row.id;
  if (!aircraftId) {
    const { rows: parked } = await query("SELECT id FROM aircraft WHERE parked_zone_id=$1 AND owner_id=$2 AND is_wreck=0 LIMIT 1", [field.id, player.id]);
    aircraftId = parked[0]?.id;
  }
  if (!aircraftId) return { type: 'emote', message: 'You need an aircraft here to load the job onto. Charter or buy one first.' };

  const { rows: acRows } = await query('SELECT type_id, custom_data, rental FROM aircraft WHERE id=$1', [aircraftId]);
  if (!acRows[0]) return { type: 'emote', message: 'That aircraft is no longer here to load.' };
  const { rows: tRows } = await query('SELECT * FROM aircraft_types WHERE id=$1', [acRows[0].type_id]);
  if (!tRows[0]) return { type: 'emote', message: "This aircraft's type registration is missing — can't load a job onto it." };
  const type = tRows[0];
  // Cargo cap honours the aircraft's current weight-&-balance loadout (rigged for freight vs pax).
  const holdCap = effLoadout(acRows[0], type).cargoCap;
  if (m.kind === 'cargo' && m.weight > holdCap)
    return { type: 'emote', message: `That's ${m.weight}kg — more than this aircraft's hold takes (${holdCap}kg${acRows[0].custom_data?.loadout ? ', as rigged' : ''}).` };
  if (m.kind === 'passenger') {
    const seatsNeeded = Math.max(1, Math.ceil((m.weight || 80) / 80));
    if (seatsNeeded > (type.seats || 1))
      return { type: 'emote', message: `This aircraft only seats ${type.seats || 1} — that job needs ${seatsNeeded}.` };
  }

  // Someone else may have snapped it up since it was listed.
  const { rows: already } = await query('SELECT 1 FROM player_quests WHERE quest_id=$1', [q.id]);
  if (already.length) return { type: 'emote', message: 'That job was just taken by someone else.' };

  const payout = estimateContractPayout({ type, rental: !!acRows[0].rental, dist: m.dist, weight: m.weight, deadlineMins: (m.deadlineS || 0) / 60, riskBase: m.risk });
  await query('UPDATE quests SET rewards=$1, meta = meta || $2::jsonb WHERE id=$3',
    [JSON.stringify({ credits: payout }), JSON.stringify({ aircraftId }), q.id]);

  const cd = acRows[0].custom_data || {};
  cd.cargoWeight = (cd.cargoWeight || 0) + m.weight;
  cd.contractId = q.id;
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), aircraftId]);
  if (live) live.row.custom_data = cd;

  const res = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: q.id } });
  if (res?.type === 'error') return { type: 'error', message: res.message };

  const destName = getZone(m.destZone)?.name || m.destZone;
  return { type: 'output', message: `<span class="item-grant">Job accepted — ${m.cargoName} loaded (${m.weight}kg). Deliver to <b>${destName}</b> within ${Math.round((m.deadlineS || 0) / 60)} minutes. Payout: <b>${payout}₵</b>.</span>` +
    (m.contraband ? '\n<span class="text-red">This is a dark run — kill your transponder (<b>squawk off</b>) or the cameras will make you.</span>' : '') };
}

async function cmdManifest(args, raw, player) {
  const { rows } = await query(
    `SELECT q.*, pq.started_at FROM player_quests pq JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status='active' AND q.quest_type='flight'`,
    [player.id]
  );
  if (!rows.length) return { type: 'output', message: 'No active jobs. Find a <b>contracts</b> board.' };
  const lines = rows.map(q => {
    const m = q.meta || {};
    const left = (m.deadlineS || 0) - (nowSec() - q.started_at);
    const destName = getZone(m.destZone)?.name || m.destZone;
    return `· ${m.cargoName} → <b>${destName}</b> — <span class="${left < 0 ? 'text-red' : 'text-green'}">${left < 0 ? 'OVERDUE' : Math.ceil(left / 60) + 'min left'}</span> · ${q.rewards?.credits || 0}₵`;
  });
  return { type: 'output', message: `<span class="text-cyan">MANIFEST:</span>\n${lines.join('\n')}` };
}

// Called from index.cmdLandResolve on a successful landing. Turns the matching
// active flight quest(s) in through the canonical TURN_IN action so payment,
// messaging, and flag mirroring all flow through the one path every quest uses.
export async function checkContractDelivery(player, live, fieldZoneId) {
  const { rows } = await query(
    `SELECT q.*, pq.started_at FROM player_quests pq JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status='active' AND q.quest_type='flight'
       AND q.meta->>'destZone'=$2 AND q.meta->>'aircraftId'=$3`,
    [player.id, fieldZoneId, live.row.id]
  );
  for (const q of rows) {
    const m = q.meta || {};
    const late = (nowSec() - q.started_at) > (m.deadlineS || 0);
    const fullPay = q.rewards?.credits || 0;
    const pay = late ? Math.round(fullPay * 0.5) : fullPay;
    if (pay !== fullPay) await query('UPDATE quests SET rewards=$1 WHERE id=$2', [JSON.stringify({ credits: pay }), q.id]);
    await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: q.id } });

    // Unload the weight.
    const cd = live.row.custom_data || {};
    cd.cargoWeight = Math.max(0, (cd.cargoWeight || 0) - (m.weight || 0));
    if (cd.contractId === q.id) delete cd.contractId;
    live.row.custom_data = cd;
    await persist(live);
    const how = m.contraband ? (late ? 'Late — half, in unmarked cash: ' : 'Paid in unmarked cash: ') : (late ? 'Late — half rate: ' : 'Paid in full: ');
    out(player.id, `<span class="item-grant">Delivered: ${m.cargoName}. ${how}<b>${pay}₵</b>.</span>`);
  }
}

// ── Home cargo drops — a standing crate at an airport, offered on embark ──────
// Unlike the job board (random churn, fixed authored destinations), a drop sits
// waiting at one origin field until someone loads it. The destination isn't
// authored — it's the airfield nearest the LOADING PLAYER's own home, found by
// walking the zone-exit graph (interiors have no map_world grid position, so a
// straight-line distance can't reach them; hop-count via the same pathfinder
// `pinch.js` uses to walk NPCs/players home does).
async function airfieldZones() {
  const { rows } = await query("SELECT id FROM zones WHERE map_id='map_world' AND flags ? 'airfield_id'");
  return rows.map(r => r.id);
}
async function nearestAirfieldToHome(homeZoneId) {
  const fields = await airfieldZones();
  let best = null, bestHops = Infinity;
  for (const zoneId of fields) {
    const path = findPath(homeZoneId, zoneId, { maxDistance: 80 });
    if (path && path.length - 1 < bestHops) { bestHops = path.length - 1; best = zoneId; }
  }
  return best;
}

// The waiting drop(s) at a zone the boarding player can see — public 'standard'
// jobs plus their own personal 'fence' pallets (never someone else's).
// An ordered cache pallet isn't there the instant you ask for it — somebody has to
// drive it out into the waste. The lead time is DERIVED from created_at rather than
// ticked or stored, so a restart can't lose it and no scheduler is involved.
async function waitingDropsAt(zoneId, playerId) {
  const { rows } = await query(
    `SELECT * FROM cargo_drops WHERE origin_zone=$1 AND status='waiting' AND (kind='standard' OR owner_id=$2)
       AND (kind <> 'fence' OR COALESCE(created_at,0) + $3 <= $4) ORDER BY kind ASC`,
    [zoneId, playerId || null, ORDER_LEAD_S, nowSec()]);
  return rows;
}
// What the embark hint checks for — just needs to know if there's anything at all.
export async function waitingDropAt(zoneId, playerId) {
  const rows = await waitingDropsAt(zoneId, playerId);
  return rows[0] || null;
}

// ── Fence-unlocked raw-drug dead drops ─────────────────────────────────────────
// A step beyond the ground MULE-crate raw run (smuggle plugin's checkpoint dodge):
// once you're vouched for on BOTH ends of the ground trade — the covert dealer's
// inner circle plus real standing with the fence — Amos will tell you where the
// Reach stashes its crop. It never touches a checkpoint, because it never touches
// the city ground at all; you fly it straight home.
//
// The drops are NOT at Buzzard Field. They're three caches out on the hardpan, and
// that siting IS the aircraft gate: index.js's land handler parks a rough-field-rated
// craft (VTOL/STOL) where it flares but TOWS a fixed-wing back to the nearest field,
// so only a STOL/VTOL with real hold space can service a cache. The Mule (180kg)
// lifts one CACHE_KG pallet; the 600kg Leviathan can't — it's `takeoff_mode: strip`
// and has nowhere out there to land. No new capability check was needed for any of
// that; it falls out of the existing physics.
//
// A pallet only ever exists as a cargo_drops row (no ground item — far too heavy to
// hand-carry), loaded the same `loadcargo` way as an honest freight job.
//
// NOTHING spawns unbidden: every pallet out there is one you ORDERED and paid for
// (see the catalogue + `raws` verb below). Amos takes the order, the Reach runs it
// out to a cache, and he tells you which one — so he stays in the loop for every
// run instead of being a one-time unlock.
const CACHE_KG = 150;
// Where the pallets go is content identity, so the names live here beside the ids
// (they're echoed to the player and read back in Amos's dialogue).
export const FENCE_CACHES = [
  { zone: 'zone_the_reach_865_1951', name: 'the Bonepile' },     // NW hardpan — a dead hauler over a buried pit
  { zone: 'zone_the_reach_879_1963', name: 'the Sump' },         // SE flats — a dry cistern under a slab
  { zone: 'zone_the_reach_867_1965', name: 'the Sisters' },      // SW scrub — two leaning rock teeth
];
const AIR_UNLOCK_FLAG = 'air_cargo_unlocked';
const INNER_CIRCLE_FLAG = 'dealer_inner_circle'; // the covert dealer's vouch (engine vendor.js sets it at max trust)
const CACHE_TRUST_MIN = 10;                      // …plus this much standing earned running the fence's ground orders

// ── The raws catalogue and its ladder ─────────────────────────────────────────
// You climb this ladder by flying it — every delivered pallet pays `bm_trust`
// (deliverFenceDrop), which is the same currency the gate is measured in.
//
// The bottom rung is LEGAL CROP, and that is the whole design. Every `item_raw_*`
// is tagged `contraband` + `raw_drug`, and carrying one in view of a camera is
// "Manufacturing a controlled substance" — FOUR STARS (see plugins/surveillance).
// So the entry rung can't be a precursor: it's baled tobacco and cannabis leaf,
// tagged `crop` and nothing else, which trips neither the manufacturing scan nor
// customs. Graduating from tier 0 to tier 1 is therefore the moment you accept
// felony risk for the first time — the price ladder and the risk ladder are the
// same ladder, which is why this is worth more than a shop with better stock.
//
// Both halves are CONTENT: a new crop is an item tagged `crop`, a new precursor is
// an item tagged `raw_drug` with a `cook_tier`. Neither needs a code change here.
const CROP_TAG = 'crop';
// Trust needed to order a tier, ON TOP of the CACHE_TRUST_MIN that opened the
// caches at all. Tier 0 is 0 — the legal crop is available the moment Amos talks
// to you, because nobody has to trust you with a bale of tobacco.
const TIER_TRUST = { 0: 0, 1: 4, 2: 10, 3: 18, 4: 28, 5: 40 };
// Units per pallet. Cheap bulk crop packs deep; refined precursor doesn't, so a
// tier-5 pallet is a small number of very expensive units.
const PALLET_UNITS = { 0: 60, 1: 40, 2: 30, 3: 20, 4: 12, 5: 8 };
const ORDER_MARKUP = 1.4;     // Sully charges ×2 and runs a MULE for you; here you fly it yourself
const ORDER_LEAD_S = 180;     // it has to be driven out into the waste after you ask
const MAX_OPEN_PALLETS = 6;   // outstanding, across all caches — your hold is the real limit
const TRUST_PER_PALLET_DIV = 12;  // see deliverFenceDrop — tunes how fast the ladder climbs

// The orderable catalogue: legal crop (tags.crop) plus contraband precursor
// (tags.raw_drug). NOT every raw_drug item is a raw — the smuggle plugin's MULE
// crate carries the tag too (so hauling one whole is the hardest sneak) at
// cook_tier 5, and rolled into a pallet it arrives with no custom_data: an
// unopenable dud that `unpack` calls a bad drop, whose tier 5 inflated the customs
// difficulty for nothing. A shell is not a precursor.
export async function rawsCatalogue() {
  const { rows } = await query(
    `SELECT id, name, value, COALESCE((flags->>'cook_tier')::int, 1) AS tier,
            NOT jsonb_exists(tags, 'raw_drug') AS legal
       FROM items
      WHERE (jsonb_exists(tags, 'raw_drug') OR jsonb_exists(tags, $1))
        AND NOT jsonb_exists(tags, 'mule_crate')
      ORDER BY tier, value, name`, [CROP_TAG]);
  return rows.map(r => ({ ...r, tier: Math.max(0, Math.min(5, r.tier)) }));
}

export const unitsPerPallet = (tier) => PALLET_UNITS[tier] ?? 20;
export const palletPrice = (entry) => Math.max(1, Math.round(entry.value * ORDER_MARKUP * unitsPerPallet(entry.tier)));
export const trustFor = (tier) => CACHE_TRUST_MIN + (TIER_TRUST[tier] ?? 40);

export async function isAirCargoUnlocked(player) {
  const v = await getFlag('player', AIR_UNLOCK_FLAG, player);
  return v === '1' || v === 1 || v === true;
}

// Both ends of the ground trade have to vouch for you before the Reach will tell
// you where its crop is buried: the covert dealer's inner circle (street-dealing
// the Fixer to max trust) AND real standing with the fence, earned running his
// MULE crates through a checkpoint. Belt-and-braces with the dialogue conditions
// on Amos's own option — the action must never be the only thing holding the door.
export async function hasCacheStanding(player) {
  if (!player?.id) return false;
  const [inner, trust] = await Promise.all([
    getFlag('player', INNER_CIRCLE_FLAG, player),
    getFlag('player', 'bm_trust', player),
  ]);
  const vouched = inner === '1' || inner === 1 || inner === true || inner === 'true';
  return vouched && (Number(trust) || 0) >= CACHE_TRUST_MIN;
}

// Your outstanding orders, grouped by the cache they were run out to — one line per
// cache, which is exactly what Amos reads off his ledger. `ready` is derived from
// created_at, so the lead time needs no tick and no extra column: a pallet you
// ordered ninety seconds ago is real, it just isn't out there yet.
export async function openOrders(player) {
  if (!player?.id) return [];
  const { rows } = await query(
    `SELECT origin_zone, contents, created_at FROM cargo_drops
      WHERE owner_id=$1 AND kind='fence' AND status='waiting' ORDER BY created_at`, [player.id]);
  const now = nowSec();
  const byCache = new Map();
  for (const r of rows) {
    const line = (r.contents || [])[0] || {};
    const cache = FENCE_CACHES.find(c => c.zone === r.origin_zone);
    if (!cache) continue;                       // a cache retired out from under an old order
    const key = `${cache.zone}|${line.itemId}`;
    const cur = byCache.get(key) || {
      cache, itemId: line.itemId, name: line.name || 'raw material', tier: line.tier ?? 1,
      legal: !!line.legal, pallets: 0, units: 0, readyIn: 0,
    };
    cur.pallets += 1;
    cur.units += Number(line.qty) || 0;
    cur.readyIn = Math.max(cur.readyIn, Math.max(0, (Number(r.created_at) || 0) + ORDER_LEAD_S - now));
    byCache.set(key, cur);
  }
  return [...byCache.values()];
}

// Write the pallets: one cargo_drops row each (so `loadcargo`'s per-drop weight math
// is untouched and a small aircraft can take one of three), all of them run out to
// the SAME cache so there's one place to fly. `exec` lets this run inside the vendor's
// sale transaction.
async function writePallets(player, entry, pallets, exec = query) {
  const units = unitsPerPallet(entry.tier);
  const cache = pick(FENCE_CACHES);
  const at = nowSec();
  for (let i = 0; i < pallets; i++) {
    await exec(
      `INSERT INTO cargo_drops (id, label, weight_kg, reward, origin_zone, status, kind, contents, owner_id, created_at)
       VALUES ($1,$2,$3,0,$4,'waiting','fence',$5::jsonb,$6,$7)`,
      [`cargo_fence_${randomUUID().slice(0, 8)}`,
        entry.legal ? 'A strapped bale, tarped against the sun' : 'A tarped pallet, sand-drifted and unmarked',
        CACHE_KG, cache.zone,
        JSON.stringify([{ itemId: entry.id, name: entry.name, qty: units, tier: entry.tier, legal: entry.legal }]),
        player.id, at]);
  }
  return { cache, units: units * pallets, pallets };
}

// Place an order from the text counter. Charged up front — a pre-paid load is what
// gives the customs scan on the way home its teeth.
export async function placeCacheOrder(player, entry, pallets) {
  const cost = palletPrice(entry) * pallets;
  if (!(await adjustCredits(player, -cost))) return { error: `That's ${cost}₵ and you can't cover it.` };
  return { ...(await writePallets(player, entry, pallets)), cost };
}

// ── The counter as a vendor shelf ─────────────────────────────────────────────
// The order counter is ALSO the ordinary GUI shop panel: Amos carries `trust_flag:
// bm_trust` and a `min_trust` per catalogue entry, so `getVendorStock` filters the
// shelf to the rungs the player has earned and a sealed tier simply isn't there —
// the ladder, rendered, with no client work. Quantity on the panel is pallet count.
//
// What the panel can't do on its own is deliver a 150kg pallet into someone's
// pockets, so both goods classes claim the engine's purchase-delivery seam: the
// sale writes cargo_drops rows instead of inventory rows, inside the same
// transaction, and hands back the receipt line naming the cache.
//
// `trust_per_buy` is deliberately 0 on the counter (see the content script):
// standing is earned by FLYING pallets home, never by paying for them, or a rich
// player buys their way up the ladder without ever running the customs risk.
async function deliverPalletPurchase(player, npc, item, quantity, exec) {
  // Not a pallet — he also sells a shotgun across the desk. Hand it over normally.
  if (!item.tags?.crop && !item.tags?.raw_drug) return null;
  if (!(await isAirCargoUnlocked(player))) return '!He turns the page. Whatever that is, it isn\'t for you.';
  const pallets = Math.max(1, Math.min(MAX_OPEN_PALLETS, Number(quantity) || 1));
  const already = (await openOrders(player)).reduce((s, o) => s + o.pallets, 0);
  if (already + pallets > MAX_OPEN_PALLETS)
    return `!You already have ${already} pallet${already === 1 ? '' : 's'} sitting out there. Clear some before you order more (${MAX_OPEN_PALLETS} at a time).`;

  const legal = !item.tags?.raw_drug;
  const tier = Math.max(0, Math.min(5, Number(item.flags?.cook_tier) || 0));
  const res = await writePallets(player, { id: item.id, name: item.name, tier, legal }, pallets, exec);
  const risk = legal ? 'Legal leaf — nobody will scan it.' : 'Contraband precursor — every policed field you land it at runs a scanner.';
  return `Run out to <b>${res.cache.name}</b> — ${res.pallets} pallet${res.pallets === 1 ? '' : 's'}, ${res.units}× ${item.name}. `
    + `Give it ${Math.round(ORDER_LEAD_S / 60)} minutes to get there, then set down <i>on</i> the drop and <b>loadcargo</b>. ${risk}`;
}
registerPurchaseDelivery('raws_counter', deliverPalletPurchase);

// The unlock — fired from Amos's dialogue at Buzzard Field (and from Sully's
// bm_menu "bigger hauls" node; see scripts/add-fence-air-unlock.js). One-time; a
// repeat visit routes to an "already sorted" node. The standing check is repeated
// here so a stale or hand-authored dialogue option can't hand out the caches.
registerAction({
  type: 'UNLOCK_AIR_CARGO',
  handler: async ({ actor }) => {
    if (await isAirCargoUnlocked(actor)) return { type: 'goto_node', node: 'bm_air_already' };
    if (!(await hasCacheStanding(actor))) return { type: 'goto_node', node: 'raws_unvouched' };
    await setFlag('player', AIR_UNLOCK_FLAG, '1', actor);
    // House convention: the first mention of a new verb shimmers and is clickable.
    // This is the only place a player learns `raws` exists.
    out(actor.id, `<span class="ambient">He taps the ledger cover twice. "Ask me for the list when you want something — ${teachVerb('raws')} — and I'll have it run out."</span>`);
    return { type: 'ok' };
  },
});

// Amos reading his ledger: what you have on order and which cache it went to. Fired
// as a dialogue action; the line goes out through `out()` rather than the node text,
// because the node text is authored content and this is live state.
registerAction({
  type: 'FENCE_CACHE_REPORT',
  handler: async ({ actor }) => {
    if (!(await isAirCargoUnlocked(actor))) return { type: 'goto_node', node: 'raws_unvouched' };
    const orders = await openOrders(actor);
    if (!orders.length) {
      out(actor.id, `<span class="ambient">Amos runs a finger down the ledger and finds nothing under your name. "You've nothing out there. Order it and I'll have it run out — <b>raws</b>."</span>`);
      return { type: 'ok' };
    }
    const lines = orders.map(o => {
      const when = o.readyIn > 0 ? ` <span class="text-dim">(not out there yet — ${o.readyIn}s)</span>` : '';
      return `  <b>${o.cache.name}</b> — ${o.pallets} pallet${o.pallets > 1 ? 's' : ''}, ${o.units}× ${o.name}${when}`;
    }).join('\n');
    out(actor.id, `<span class="item-grant">Amos turns the ledger a few degrees toward you and taps his own shorthand.\n${lines}\n<span class="text-dim">Set down <i>on</i> the drop — a pallet that size doesn't walk. You'll want something that can put down rough.</span></span>`);
    return { type: 'ok' };
  },
});

// "He slides the ledger across" — prints the catalogue from inside his dialogue, so
// a player who never noticed the verb can still order. Same body as `raws` with no
// argument; the verb is the fast path, this is the discoverable one.
registerAction({
  type: 'FENCE_LEDGER_OPEN',
  handler: async ({ actor }) => {
    if (!(await isAirCargoUnlocked(actor))) return { type: 'goto_node', node: 'raws_unvouched' };
    const res = await cmdRaws([], '', actor);
    if (res?.message) out(actor.id, res.message);
    return { type: 'ok' };
  },
});

// ── `raws` — the order counter ────────────────────────────────────────────────
// Ordering lives in a verb rather than in dialogue nodes, unlike Sully's ground
// black market. That's a deliberate divergence: Sully's menu is a handful of nodes
// per raw and already noted as bloat, and this catalogue is ~28 entries × a pallet
// count, which no dialogue tree should carry. Amos's dialogue TEACHES the verb
// (TEACH_VERB above); the verb does the work. He still has to be standing there.
const counterNpcHere = (player) =>
  getZoneNpcs(player.current_zone || player.zone_id).find(n => n.flags?.raws_counter && !n._dead);

async function cmdRaws(args, raw, player) {
  const npc = counterNpcHere(player);
  // A player who hasn't been let in on the trade never learns the surface exists: with
  // no counter in the room AND no unlock, the verb falls through as though it were
  // never registered. Once you're in, it answers wherever you type it — otherwise
  // learning the verb at the Layover and typing it in Coldwater reads as a bug.
  if (!npc) {
    if (!(await isAirCargoUnlocked(player))) return undefined;
    return { type: 'emote', message: `Nobody here keeps that ledger. Amos does, at the front desk of the Layover.` };
  }
  if (!(await isAirCargoUnlocked(player)))
    return { type: 'emote', message: `${npc.name} keeps the ledger closed. Whatever's in it isn't for you yet.` };

  const trust = Number(await getFlag('player', 'bm_trust', player)) || 0;
  const catalogue = await rawsCatalogue();
  if (!catalogue.length) return { type: 'emote', message: 'The ledger is empty. Nothing is growing anywhere.' };

  // `raws` with no argument = the board: what you can order, what you can't yet,
  // and what's already out in the waste.
  if (!args.length) {
    const orders = await openOrders(player);
    const rows = catalogue.map((e) => {
      const need = trustFor(e.tier);
      const locked = trust < need;
      const price = palletPrice(e);
      const label = locked
        ? `<span class="text-dim">${e.name} — sealed (standing ${need})</span>`
        : `<span class="action-link" data-action="cmd" data-cmd="raws ${e.name}">${e.name}</span> — ${unitsPerPallet(e.tier)}/pallet · <b>${price}₵</b>`;
      const grade = e.legal ? '<span class="text-dim">legal crop</span>' : `tier ${e.tier}`;
      return `  ${label} <span class="text-dim">[${grade}]</span>`;
    }).join('\n');
    const open = orders.length
      ? '\n\n<span class="text-amber">On order:</span>\n' + orders.map(o =>
        `  ${o.pallets} pallet${o.pallets > 1 ? 's' : ''} · ${o.units}× ${o.name} → <b>${o.cache.name}</b>`
        + (o.readyIn > 0 ? ` <span class="text-dim">(${o.readyIn}s out)</span>` : '')).join('\n')
      : '';
    return { type: 'output', message:
      `<span class="text-amber">${npc.name}'s ledger</span> <span class="text-dim">— standing ${trust}. `
      + `A pallet is run out to a cache and waits there; fly to it and <b>loadcargo</b>.</span>\n${rows}${open}\n`
      + `<span class="text-dim">Order with <b>raws &lt;name&gt; [pallets]</b>. Legal crop scans clean; everything else is what customs is looking for.</span>` };
  }

  // `raws <name> [pallets]`
  let pallets = 1;
  const tail = args[args.length - 1];
  if (/^\d+$/.test(tail) && args.length > 1) { pallets = Math.max(1, Math.min(MAX_OPEN_PALLETS, parseInt(tail, 10))); args = args.slice(0, -1); }
  const want = args.join(' ').toLowerCase();
  const entry = catalogue.find(e => e.name.toLowerCase() === want)
    || catalogue.find(e => e.name.toLowerCase().includes(want));
  if (!entry) return { type: 'emote', message: `Nothing in the ledger by that name. <b>raws</b> for the list.` };

  const need = trustFor(entry.tier);
  if (trust < need)
    return { type: 'emote', message: `${npc.name} doesn't even look up. "Not for you. Not yet." <span class="text-dim">(needs standing ${need}; you're at ${trust})</span>` };

  const already = (await openOrders(player)).reduce((s, o) => s + o.pallets, 0);
  if (already + pallets > MAX_OPEN_PALLETS)
    return { type: 'emote', message: `You already have ${already} pallet${already > 1 ? 's' : ''} sitting out there. Clear some before you order more (${MAX_OPEN_PALLETS} at a time).` };

  const res = await placeCacheOrder(player, entry, pallets);
  if (res.error) return { type: 'emote', message: `${npc.name} shakes his head. "${res.error}"` };

  const risk = entry.legal
    ? `<span class="text-dim">It's legal leaf. Nobody will scan it, nobody will care.</span>`
    : `<span class="text-amber">That's contraband precursor. Every policed field you land it at runs a scanner.</span>`;
  return { type: 'output', message:
    `<span class="item-grant">${npc.name} writes it down without comment and takes <b>${res.cost}₵</b>. `
    + `${res.pallets} pallet${res.pallets > 1 ? 's' : ''} — ${res.units}× ${entry.name} — run out to <b>${res.cache.name}</b>.</span>\n`
    + `<span class="ambient">"Give it a few minutes to get there. Then it's yours to fetch."</span> ${risk}` };
}

// ── Licensed freight drops — legit standing air-cargo work, bought once ──────
// The honest cousin of the fence pallets: buy an air-freight licence at any
// airfield (`freightlicense`) and a standing pool of legit cargo drops waits at
// the fields you embark from, flown to the airfield nearest your home for a flat
// fee — the same load/deliver machinery as the fence run, minus the crime.
// Owner-scoped ('freight' kind) so it's your pool, never the public board and
// never visible to anyone else. Delivery falls through checkCargoDropDelivery's
// standard (non-'fence') branch, so it pays out and unloads like any drop.
const FREIGHT_LICENSE_FLAG = 'air_freight_licensed';
const FREIGHT_LICENSE_PRICE = 2500;
const MAX_FREIGHT_WAITING = 4;
const FREIGHT_LOADS = [
  ['A sealed freight pallet', 60], ['A shrink-wrapped skid of dry goods', 90],
  ['A crate of machine parts', 120], ['A bonded cargo container', 150],
];

export async function isFreightLicensed(player) {
  const v = await getFlag('player', FREIGHT_LICENSE_FLAG, player);
  return v === '1' || v === 1 || v === true;
}

// Tops the licensed pilot's standing freight pool back up at the field they're at
// — a cheap no-op for the unlicensed. Called on embark and in loadcargo. The fence
// caches have no counterpart: an ordered pallet is inserted once, at order time.
export async function ensureFreightDrops(player, originZone) {
  if (!player?.id || !originZone || !(await isFreightLicensed(player))) return;
  const { rows } = await query(
    "SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='freight' AND status='waiting' AND origin_zone=$2",
    [player.id, originZone]);
  for (let i = rows[0]?.n || 0; i < MAX_FREIGHT_WAITING; i++) {
    const [label, weight] = pick(FREIGHT_LOADS);
    const reward = 120 + weight * 2 + Math.floor(Math.random() * 80);
    await query(
      `INSERT INTO cargo_drops (id, label, weight_kg, reward, origin_zone, status, kind, owner_id, created_at)
       VALUES ($1,$2,$3,$4,$5,'waiting','freight',$6,$7)`,
      [`cargo_freight_${randomUUID().slice(0, 8)}`, label, weight, reward, originZone, player.id, nowSec()]);
  }
}

// Buy the licence — once, at any airfield. Charged atomically; the flag is what
// ensureFreightDrops gates on.
async function cmdFreightLicense(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Air-freight licences are issued at the airfields.' };
  if (await isFreightLicensed(player))
    return { type: 'emote', message: "You already hold an air-freight licence. Board an aircraft — there'll be loads waiting." };
  if (!(await adjustCredits(player, -FREIGHT_LICENSE_PRICE)))
    return { type: 'emote', message: `An air-freight licence runs ${FREIGHT_LICENSE_PRICE}₵ — you can't cover it.` };
  await setFlag('player', FREIGHT_LICENSE_FLAG, '1', player);
  return { type: 'output', message: `<span class="item-grant">Air-freight licence issued (−${FREIGHT_LICENSE_PRICE}₵). Standing cargo loads will be on the ramp whenever you board — <b>loadcargo</b> to haul them home.</span>` };
}

// Loads EVERY waiting drop that fits the hold, one at a time (heaviest constraint
// first isn't needed — a fence pallet is a flat CACHE_KG, so it's just "as many as
// fit"), rather than a single job per call — a big enough hauler clears the whole
// pool in one visit.
async function cmdLoadCargo(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard an aircraft." };
  if (player.seat !== 'pilot') return { type: 'emote', message: "Only the pilot can take on cargo." };
  if (live.row.airborne) return { type: 'emote', message: "Land first — you can't load cargo in the air." };
  await ensureFreightDrops(player, live.row.parked_zone_id);
  const waiting = await waitingDropsAt(live.row.parked_zone_id, player.id);
  if (!waiting.length) return { type: 'emote', message: 'No cargo waiting here.' };
  if (!player.home_zone) return { type: 'emote', message: "You've nowhere to haul it to — you don't have a home set. Rent an apartment first." };

  const { rows: tRows } = await query('SELECT seats, max_takeoff_weight, cargo_capacity FROM aircraft_types WHERE id=$1', [live.type.id]);
  const holdCap = tRows[0] ? effLoadout(live.row, tRows[0]).cargoCap : 0;
  let already = live.row.custom_data?.cargoWeight || 0;
  const dest = await nearestAirfieldToHome(player.home_zone);
  if (!dest) return { type: 'emote', message: "Can't find a route from your home to any airfield — the delivery falls through." };

  const loaded = [];
  for (const drop of waiting) {
    if (drop.weight_kg > holdCap - already) continue;
    already += drop.weight_kg;
    loaded.push(drop);
  }
  if (!loaded.length) {
    const lightest = Math.min(...waiting.map(d => d.weight_kg));
    return { type: 'emote', message: `Nothing here fits your hold — ${holdCap - already}kg free and the smallest load on the ground is ${lightest}kg. You need a bigger aircraft, or a hold rigged for cargo.` };
  }

  const cd = live.row.custom_data || {};
  cd.cargoWeight = already;
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), live.row.id]);
  live.row.custom_data = cd;
  for (const drop of loaded) {
    await query("UPDATE cargo_drops SET status='loaded', owner_id=$1, aircraft_id=$2, dest_zone=$3 WHERE id=$4", [player.id, live.row.id, dest, drop.id]);
  }
  if (isContinuous(live)) pushContext(live);

  const destName = fieldName(getZone(dest)) || dest;
  const weight = loaded.reduce((s, d) => s + d.weight_kg, 0);
  return { type: 'output', message: `<span class="item-grant">${loaded.map(d => d.label).join(', ')} loaded (${weight}kg, ${loaded.length} load${loaded.length > 1 ? 's' : ''}). Fly it to <b>${destName}</b> — the last leg home is on the courier once it's on the ground there.</span>` };
}

// ── Customs scan (contraband air cargo) ────────────────────────────────────────
// Landing a hold of raw drugs at a POLICED field (any airfield whose row is NOT lawless
// — so the Reach's Buzzard strip is a safe base) triggers a customs scan: a Deception
// check whose difficulty climbs with the purest drug AND the size of the haul. Pass = it
// lands as normal; fail = the inspector flags you and you choose (bribe or bolt). A
// Smuggler's False-Bottom Hold (kit_smuggler_hold) sometimes hides the load with no roll
// at all, and eases the roll when it doesn't. A lawless field never scans.
const pendingCustoms = new Map(); // playerId → { dropIds, bribe, fieldZoneId, aircraftId, timer }
const CUSTOMS_DECIDE_MS = 45_000;

function clearCustoms(playerId) {
  const p = pendingCustoms.get(playerId);
  if (p?.timer) clearTimeout(p.timer);
  pendingCustoms.delete(playerId);
}

// Move ONE fence pallet's raws into the player's kit + bump fence standing.
async function deliverFenceDrop(player, live, d) {
  await query("UPDATE cargo_drops SET status='delivered' WHERE id=$1", [d.id]);
  const cd = live.row.custom_data || {};
  cd.cargoWeight = Math.max(0, (cd.cargoWeight || 0) - d.weight_kg);
  live.row.custom_data = cd; await persist(live);
  const manifest = d.contents || [];
  for (const m of manifest) {
    const ex = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1', [player.id, m.itemId]);
    if (ex.rows.length) await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [m.qty, ex.rows[0].id]);
    else await query('INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,$4)', [randomUUID(), player.id, m.itemId, m.qty]);
  }
  // Standing earned per pallet. Weighted by grade × volume, which lands at roughly a
  // flat 3–5 for any contraband pallet (units per pallet shrink as the tier climbs) and
  // at the floor of 1 for legal crop — tier 0 contributes nothing to the sum, so a bale
  // run builds standing slowly and honestly. That floor is what lets a newly-vouched
  // pilot climb off the legal rung at all.
  const trustGain = Math.max(1, Math.round(manifest.reduce((s, m) => s + (m.tier || 0) * m.qty, 0) / TRUST_PER_PALLET_DIV));
  const next = (Number(await getFlag('player', 'bm_trust', player)) || 0) + trustGain;
  await setFlag('player', 'bm_trust', String(next), player);
  return { list: manifest.map(m => `${m.qty}× ${m.name}`).join(', '), trustGain, next };
}
async function deliverAllFence(player, live, drops) {
  for (const d of drops) {
    const r = await deliverFenceDrop(player, live, d);
    out(player.id, `<span class="item-grant">${r.list}, quietly moved into your kit. <span class="text-dim">The fence hears about a clean run this size. (standing +${r.trustGain} → ${r.next})</span></span>`);
  }
}
// Confiscate the pallets (dumped out of the hold) + a smuggling charge — heat/wanted,
// but no arrest, so you can still fly out. Cops at the field may move on you.
async function seizeFenceDrops(player, live, drops, fieldZoneId) {
  for (const d of drops) {
    await query("UPDATE cargo_drops SET status='lost' WHERE id=$1", [d.id]);
    if (live) { const cd = live.row.custom_data || {}; cd.cargoWeight = Math.max(0, (cd.cargoWeight || 0) - d.weight_kg); live.row.custom_data = cd; await persist(live); }
  }
  await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'manufacturing', zoneId: fieldZoneId } }).catch(() => {});
}
async function customsBolt(player, live, drops, fieldZoneId, auto) {
  clearCustoms(player.id);
  await seizeFenceDrops(player, live, drops, fieldZoneId);
  out(player.id, auto
    ? `<span class="text-amber">You hang back too long. The inspector trips the alarm — the guards seize the pallets and your name goes on a list. You gun it off the ramp with the heat on you.</span>`
    : `<span class="text-amber">You leave the load and bolt for your plane. The alarm shrills behind you — the pallets are gone and you're marked, but you're rolling before they can close the gate.</span>`);
}

// Called from index.cmdLandResolve on a successful landing, alongside checkContractDelivery.
export async function checkCargoDropDelivery(player, live, fieldZoneId) {
  const { rows } = await query(
    "SELECT * FROM cargo_drops WHERE aircraft_id=$1 AND owner_id=$2 AND status='loaded' AND dest_zone=$3",
    [live.row.id, player.id, fieldZoneId]);
  if (!rows.length) return;
  const fence = rows.filter(d => d.kind === 'fence');
  const freight = rows.filter(d => d.kind !== 'fence');

  // Legit freight always clears — pay it out and unload.
  for (const d of freight) {
    await query("UPDATE cargo_drops SET status='delivered' WHERE id=$1", [d.id]);
    const cd = live.row.custom_data || {};
    cd.cargoWeight = Math.max(0, (cd.cargoWeight || 0) - d.weight_kg);
    live.row.custom_data = cd; await persist(live);
    player.credits = (player.credits || 0) + d.reward;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    out(player.id, `<span class="item-grant">${d.label} handed off to a courier here — it'll be waiting at home. Paid <b>${d.reward}₵</b>.</span>`);
  }
  if (!fence.length) return;

  // Contraband: a lawless field waves it through; a policed one runs customs.
  const policed = !airfieldOf(fieldZoneId)?.lawless;
  if (!policed) { await deliverAllFence(player, live, fence); return; }

  // Legal crop is the entry rung of the ladder and it is genuinely legal: a bale of
  // tobacco or cannabis leaf isn't contraband, so a scanner has nothing to find and
  // customs never runs. Only the contraband pallets are scanned — and they're scanned
  // on their OWN worst tier and count, so hiding one crate of Blacktar behind four
  // bales of tobacco doesn't lower the difficulty either.
  const dirty = fence.filter(d => (d.contents || []).some(m => !m.legal));
  const clean = fence.filter(d => !dirty.includes(d));
  if (clean.length) await deliverAllFence(player, live, clean);
  if (!dirty.length) return;

  const maxTier = Math.max(1, ...dirty.flatMap(d => (d.contents || []).filter(m => !m.legal).map(m => m.tier || 1)));
  const hold = installedKits(live.row.custom_data).includes('kit_smuggler_hold');

  // The false bottom sometimes hides the load outright — no roll.
  if (hold && Math.random() < 0.4) {
    out(player.id, `<span class="ambient">Customs runs a scanner over your hold. The false bottom does its job — nothing pings. You taxi in clean.</span>`);
    await deliverAllFence(player, live, dirty); return;
  }
  // Deception scan — purer drugs + bigger hauls raise it; the hold eases it.
  const diff = Math.max(1, 3 + maxTier + (dirty.length - 1) - (hold ? 2 : 0));
  const chk = await skillCheck(player, 'deception', diff);
  if (chk.success) {
    await awardSkillUse(player.id, 'deception', chk.margin);
    out(player.id, `<span class="ambient">You hold the inspector's eye and keep your hands loose. The scanner blinks green; they wave you onto the ramp.</span>`);
    await deliverAllFence(player, live, dirty); return;
  }

  // Caught. Offer bribe or bolt; a timeout auto-bolts.
  const bribe = 200 * dirty.length + 150 * maxTier;
  clearCustoms(player.id);
  const timer = setTimeout(() => { customsBolt(player, live, dirty, fieldZoneId, true).catch(() => {}); }, CUSTOMS_DECIDE_MS);
  pendingCustoms.set(player.id, { dropIds: dirty.map(d => d.id), bribe, fieldZoneId, aircraftId: live.row.id, timer });
  out(player.id, `<span class="text-amber">⚠ Customs pulls your hold aside — <b>raw material</b> lights the scanner. The inspector's hand hovers over the alarm, palm turned up.</span>\n<span class="ambient">Slip them <b>${bribe}₵</b> and it disappears — <span class="action-link" data-action="cmd" data-cmd="customs bribe">customs bribe</span> — or leave the load and run for it — <span class="action-link" data-action="cmd" data-cmd="customs bolt">customs bolt</span>. <span class="text-dim">(They move on you in 45s either way.)</span></span>`);
}

// The bribe/bolt reply to a flagged customs scan.
async function cmdCustoms(args, raw, player) {
  const p = pendingCustoms.get(player.id);
  if (!p) {
    // NOT OURS, BUT MAYBE SOMEBODY'S. `customs` is one player-facing concept and flight happens to
    // own the word; a driver stopped at a weighbridge types the same thing for the same reason. So
    // before answering "nothing of yours", ask whether another system is holding an inspection —
    // the same seam the checkpoint plugin uses to run a drug scan through smuggle without importing
    // it. If nothing answers, the original message stands and flight has learned nothing about
    // trucks.
    const r = await dispatchAction({ type: 'TRUCK_CUSTOMS', actor: player, params: { choice: args[0] } }).catch(() => null);
    if (r?.handled) { const { handled, ...out } = r; return out; }
    return { type: 'emote', message: "Customs isn't holding anything of yours right now." };
  }
  const choice = (args[0] || 'bolt').toLowerCase();
  const live = liveAircraft.get(p.aircraftId);
  const { rows: drops } = await query("SELECT * FROM cargo_drops WHERE id = ANY($1) AND status='loaded'", [p.dropIds]);

  if (choice === 'bribe') {
    if (!(await adjustCredits(player, -p.bribe, undefined, 'flight:customs-bribe')))
      return { type: 'error', message: `The inspector wants ${p.bribe}₵ and your account won't cover it. Pay up — or <b>customs bolt</b> and lose the load.` };
    clearCustoms(player.id);
    if (live && drops.length) await deliverAllFence(player, live, drops);
    return { type: 'output', message: `<span class="ambient">The credits change hands below the desk. The inspector's face goes flat; the scanner "malfunctions," and you taxi in with the load intact.</span>` };
  }
  // bolt (default)
  if (live) await customsBolt(player, live, drops, p.fieldZoneId, false);
  else clearCustoms(player.id);
  return { type: 'noop' };
}

// ── jettison — blow the cargo doors and dump the hold (fails the active job) ───
// Bound to the cockpit's J key. Useful to shed weight (climb/handle better) or ditch
// contraband before a checkpoint — at the cost of the contract and its payout.
async function cmdJettison(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard an aircraft." };
  if (player.seat !== 'pilot') return { type: 'emote', message: 'Only the pilot can blow the cargo doors.' };
  const cd = live.row.custom_data || {};
  if ((cd.cargoWeight || 0) <= 0) return { type: 'emote', message: 'Nothing in the hold to dump.' };

  const { rows } = await query(
    `SELECT q.* FROM player_quests pq JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status='active' AND q.quest_type='flight' AND q.meta->>'aircraftId'=$2`,
    [player.id, live.row.id]
  );
  const names = rows.map(q => q.meta?.cargoName).filter(Boolean);
  const contraband = rows.some(q => q.meta?.contraband);
  for (const q of rows) await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: q.id } });
  // A home drop dumped overboard doesn't quietly keep counting toward a payout.
  const { rows: drops } = await query("SELECT id, label FROM cargo_drops WHERE aircraft_id=$1 AND owner_id=$2 AND status='loaded'", [live.row.id, player.id]);
  for (const d of drops) { names.push(d.label); await query("UPDATE cargo_drops SET status='lost' WHERE id=$1", [d.id]); }

  cd.cargoWeight = 0; delete cd.contractId;
  live.row.custom_data = cd;
  await persist(live);
  if (isContinuous(live)) pushContext(live);   // continuous cockpit: reflect the empty hold

  const what = names.length ? names.join(', ') : 'the load';
  const dump = live.row.airborne
    ? `<span class="text-amber">You blow the cargo doors — ${what} tumbles away into the slipstream and is gone.</span>`
    : `<span class="text-amber">You heave ${what} out onto the ramp and kick it clear.</span>`;
  const tail = rows.length ? `\n<span class="text-red">Contract failed${contraband ? " — but there's nothing in your hold to find now" : ''}.</span>` : '';
  return { type: 'emote', message: dump + tail };
}

export const commands = {
  contracts: cmdContracts,
  jobs: cmdContracts,
  accept: cmdAccept,
  manifest: cmdManifest,
  jettison: cmdJettison,
  loadcargo: cmdLoadCargo,
  freightlicense: cmdFreightLicense,
  cargolicense: cmdFreightLicense,
  customs: cmdCustoms,
  raws: cmdRaws,
};
