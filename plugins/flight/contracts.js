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
import { getZone, liveAircraft, out, persist, fieldFor as fieldOf, isContinuous, pushContext, effLoadout, BAND_BURN, REFUEL_PRICE_PER_UNIT, rentalOpFee } from './state.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { adjustCredits } from '../../server/engine/economy.js';

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
  const lawless = !!fieldZone.flags?.airfield_lawless;
  const lawlessDests = others.filter(f => f.flags?.airfield_lawless);
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
    const risk = Math.min(5, 1 + Math.floor(dist / 4) + (m.riskBase || 0) + ((dest.flags?.airfield_lawless) ? 1 : 0));
    const names = Array.isArray(m.names) && m.names.length ? m.names : ['a shipment'];
    const cargoName = pick(names);
    const deadlineMins = m.deadlineMins || 20;
    const destName = dest.flags?.airfield_name || dest.name;
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
  return { type: 'output', message: `<span class="item-grant">Job accepted — ${m.cargoName} loaded (${m.weight}kg). Deliver to <b>${destName}</b> within ${Math.round((m.deadlineS || 0) / 60)} minutes. Payout: <b>${payout}c</b>.</span>` +
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
    return `· ${m.cargoName} → <b>${destName}</b> — <span class="${left < 0 ? 'text-red' : 'text-green'}">${left < 0 ? 'OVERDUE' : Math.ceil(left / 60) + 'min left'}</span> · ${q.rewards?.credits || 0}c`;
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
    out(player.id, `<span class="item-grant">Delivered: ${m.cargoName}. ${how}<b>${pay}c</b>.</span>`);
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
async function waitingDropsAt(zoneId, playerId) {
  const { rows } = await query(
    "SELECT * FROM cargo_drops WHERE origin_zone=$1 AND status='waiting' AND (kind='standard' OR owner_id=$2) ORDER BY kind ASC",
    [zoneId, playerId || null]);
  return rows;
}
// What the embark hint checks for — just needs to know if there's anything at all.
export async function waitingDropAt(zoneId, playerId) {
  const rows = await waitingDropsAt(zoneId, playerId);
  return rows[0] || null;
}

// ── Fence-unlocked raw-drug air pallets ────────────────────────────────────────
// A step beyond the ground MULE-crate raw run (smuggle plugin's checkpoint dodge):
// once the fence trusts you enough to open this branch of his dialogue
// (UNLOCK_AIR_CARGO sets AIR_UNLOCK_FLAG), a standing pool of sealed pallets waits
// at the Scald — no MULE roll, no checkpoint, because it never touches the ground
// in the city at all; you fly it straight home. Too heavy to hand-carry: it only
// ever exists as a cargo_drops row (no ground item), loaded the same `loadcargo`
// way as an honest freight job. Every pallet weighs exactly SLOT_KG, so an
// aircraft's hold naturally caps you at floor(cargoCap / SLOT_KG) of them —
// "one per cargo slot" falls straight out of the existing weight math.
const FENCE_ORIGIN = 'zone_district_925_903'; // Coldwater Regional — the smuggle/fence drop, consolidated onto the district airfield
const SLOT_KG = 100;
const AIR_UNLOCK_FLAG = 'air_cargo_unlocked';
const MAX_FENCE_WAITING = 6;                 // the standing pool size, topped up as pallets get flown out
const TIER_BUCKETS = { low: [1, 2], mid: [3, 3], high: [4, 5] };

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

async function rawsByTier() {
  const { rows } = await query(
    `SELECT id, name, COALESCE((flags->>'cook_tier')::int, 1) tier FROM items WHERE jsonb_exists(tags, 'raw_drug')`);
  const bucket = ([lo, hi]) => rows.filter(r => r.tier >= lo && r.tier <= hi);
  return { low: bucket(TIER_BUCKETS.low), mid: bucket(TIER_BUCKETS.mid), high: bucket(TIER_BUCKETS.high) };
}

// A pallet is mostly low-tier bulk, a handful of mid-tier, and a rare shot of
// something high-tier — never all one grade, never mostly the rare stuff.
async function rollFenceManifest() {
  const { low, mid, high } = await rawsByTier();
  const manifest = [];
  for (let i = 0; i < randInt(3, 5) && low.length; i++) {
    const it = pick(low); manifest.push({ itemId: it.id, name: it.name, qty: randInt(4, 10), tier: it.tier });
  }
  for (let i = 0; i < randInt(1, 2) && mid.length; i++) {
    const it = pick(mid); manifest.push({ itemId: it.id, name: it.name, qty: randInt(2, 5), tier: it.tier });
  }
  if (high.length && Math.random() < 0.3) {
    const it = pick(high); manifest.push({ itemId: it.id, name: it.name, qty: randInt(1, 2), tier: it.tier });
  }
  return manifest;
}

export async function isAirCargoUnlocked(player) {
  const v = await getFlag('player', AIR_UNLOCK_FLAG, player);
  return v === '1' || v === 1 || v === true;
}

// Tops the unlocked player's standing pool back up to MAX_FENCE_WAITING — a cheap
// no-op for anyone who hasn't unlocked it. Called on every embark (see index.js
// boardFound) so the pool is always current by the time `loadcargo` looks for it.
export async function ensureFenceDrops(player) {
  if (!player?.id || !(await isAirCargoUnlocked(player))) return;
  const { rows } = await query("SELECT COUNT(*)::int n FROM cargo_drops WHERE owner_id=$1 AND kind='fence' AND status='waiting'", [player.id]);
  for (let i = rows[0]?.n || 0; i < MAX_FENCE_WAITING; i++) {
    const manifest = await rollFenceManifest();
    if (!manifest.length) break;
    await query(
      `INSERT INTO cargo_drops (id, label, weight_kg, reward, origin_zone, status, kind, contents, owner_id, created_at)
       VALUES ($1,$2,$3,0,$4,'waiting','fence',$5::jsonb,$6,$7)`,
      [`cargo_fence_${randomUUID().slice(0, 8)}`, 'A sealed pallet (unmarked)', SLOT_KG, FENCE_ORIGIN, JSON.stringify(manifest), player.id, nowSec()]);
  }
}

// The fence's unlock — fired from Sully's dialogue (bm_menu → "bigger hauls",
// gated behind bm_trust like his top drug tier; see scripts/add-fence-air-unlock.js
// for the node itself). One-time; a repeat visit routes to a "already sorted" node.
registerAction({
  type: 'UNLOCK_AIR_CARGO',
  handler: async ({ actor }) => {
    if (await isAirCargoUnlocked(actor)) return { type: 'goto_node', node: 'bm_air_already' };
    await setFlag('player', AIR_UNLOCK_FLAG, '1', actor);
    return { type: 'ok' };
  },
});

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
// — a cheap no-op for the unlicensed. Called on embark and in loadcargo, mirroring
// ensureFenceDrops.
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
    return { type: 'emote', message: `An air-freight licence runs ${FREIGHT_LICENSE_PRICE}c — you can't cover it.` };
  await setFlag('player', FREIGHT_LICENSE_FLAG, '1', player);
  return { type: 'output', message: `<span class="item-grant">Air-freight licence issued (−${FREIGHT_LICENSE_PRICE}c). Standing cargo loads will be on the ramp whenever you board — <b>loadcargo</b> to haul them home.</span>` };
}

// Loads EVERY waiting drop that fits the hold, one at a time (heaviest constraint
// first isn't needed — a fence pallet is a flat SLOT_KG, so it's just "as many as
// fit"), rather than a single job per call — a big enough hauler clears the whole
// pool in one visit.
async function cmdLoadCargo(args, raw, player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { type: 'emote', message: "You're not aboard an aircraft." };
  if (player.seat !== 'pilot') return { type: 'emote', message: "Only the pilot can take on cargo." };
  if (live.row.airborne) return { type: 'emote', message: "Land first — you can't load cargo in the air." };
  await ensureFenceDrops(player);
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
  if (!loaded.length) return { type: 'emote', message: `Nothing here fits your hold (${holdCap - already}kg free).` };

  const cd = live.row.custom_data || {};
  cd.cargoWeight = already;
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), live.row.id]);
  live.row.custom_data = cd;
  for (const drop of loaded) {
    await query("UPDATE cargo_drops SET status='loaded', owner_id=$1, aircraft_id=$2, dest_zone=$3 WHERE id=$4", [player.id, live.row.id, dest, drop.id]);
  }
  if (isContinuous(live)) pushContext(live);

  const destName = getZone(dest)?.flags?.airfield_name || getZone(dest)?.name || dest;
  const weight = loaded.reduce((s, d) => s + d.weight_kg, 0);
  return { type: 'output', message: `<span class="item-grant">${loaded.map(d => d.label).join(', ')} loaded (${weight}kg, ${loaded.length} load${loaded.length > 1 ? 's' : ''}). Fly it to <b>${destName}</b> — the last leg home is on the courier once it's on the ground there.</span>` };
}

// Called from index.cmdLandResolve on a successful landing, alongside checkContractDelivery.
export async function checkCargoDropDelivery(player, live, fieldZoneId) {
  const { rows } = await query(
    "SELECT * FROM cargo_drops WHERE aircraft_id=$1 AND owner_id=$2 AND status='loaded' AND dest_zone=$3",
    [live.row.id, player.id, fieldZoneId]);
  for (const d of rows) {
    await query("UPDATE cargo_drops SET status='delivered' WHERE id=$1", [d.id]);
    const cd = live.row.custom_data || {};
    cd.cargoWeight = Math.max(0, (cd.cargoWeight || 0) - d.weight_kg);
    live.row.custom_data = cd;
    await persist(live);

    if (d.kind === 'fence') {
      const manifest = d.contents || [];
      for (const m of manifest) {
        const ex = await query('SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1', [player.id, m.itemId]);
        if (ex.rows.length) await query('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [m.qty, ex.rows[0].id]);
        else await query('INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,$4)', [randomUUID(), player.id, m.itemId, m.qty]);
      }
      const trustGain = Math.max(1, Math.round(manifest.reduce((s, m) => s + (m.tier || 1) * m.qty, 0) / 6));
      const next = (Number(await getFlag('player', 'bm_trust', player)) || 0) + trustGain;
      await setFlag('player', 'bm_trust', String(next), player);
      const list = manifest.map(m => `${m.qty}× ${m.name}`).join(', ');
      out(player.id, `<span class="item-grant">The pallet's waiting when you touch down — ${list}, quietly moved into your kit. <span class="text-dim">The fence hears about a clean run this size. (standing +${trustGain} → ${next})</span></span>`);
    } else {
      player.credits = (player.credits || 0) + d.reward;
      await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
      out(player.id, `<span class="item-grant">${d.label} handed off to a courier here — it'll be waiting at home. Paid <b>${d.reward}c</b>.</span>`);
    }
  }
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
};
