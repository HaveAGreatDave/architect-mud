// Flight — cargo & passenger contracts (the freight economy). A field's board
// carries jobs: haul cargo or fly a passenger origin→dest airfield within a
// deadline for a payout that scales with distance × weight × risk. Cargo loads
// into the craft as weight (feeding takeoff difficulty + fuel burn via effStats).
// Contraband jobs pay more but must be flown dark — running the transponder off
// dodges SPECTER but is itself a crime in controlled airspace.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, liveAircraft, out, effStats, persist, fieldFor as fieldOf, isContinuous, pushContext, effLoadout } from './state.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { registerAction } from '../../server/engine/actions.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';

const nowSec = () => Math.floor(Date.now() / 1000);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ── Authored job types — a spread of legal and illegal work ───────────────────
// legal: honest freight/charter, humanitarian, urgent premiums.
// illegal (contraband): fly it DARK (transponder off) or the cameras make you;
//   only offered at LAWLESS fields (Redline / Slagworks / Smuggler's Slip), and
//   they prefer a lawless drop. Higher pay, harder risk.
// payMult scales the base rate; wMin/wMax the load; risk adds to the distance
// risk; mins = delivery deadline (tight = urgent premium).
const JOB_TYPES = [
  // ── Legal ──────────────────────────────────────────────────────────────────
  { id: 'freight',  label: 'Freight',        kind: 'cargo',     legal: true,  payMult: 1.0, risk: 0, wMin: 60, wMax: 260, mins: 30, names: ['a pallet of machine parts', 'crated electronics', 'a container of dry goods', 'a load of milled alloy', 'baled textiles'] },
  { id: 'courier',  label: 'Priority Courier', kind: 'cargo',   legal: true,  payMult: 1.4, risk: 0, wMin: 15, wMax: 55,  mins: 14, names: ['a bonded document pouch', 'a sealed courier case', 'a signature-only parcel'] },
  { id: 'pharma',   label: 'Cold-Chain Meds', kind: 'cargo',    legal: true,  payMult: 1.4, risk: 1, wMin: 60, wMax: 160, mins: 18, names: ['a refrigerated medcrate', 'temperature-locked antivirals', 'a chilled organ box'] },
  { id: 'charter',  label: 'Passenger Charter', kind: 'passenger', legal: true, payMult: 1.1, risk: 0, wMin: 80, wMax: 80, mins: 30, names: ['a corporate auditor', 'an off-duty ripperdoc', 'a family relocating out of the sprawl'] },
  { id: 'vip',      label: 'VIP Charter',    kind: 'passenger', legal: true,  payMult: 1.9, risk: 1, wMin: 120, wMax: 120, mins: 24, names: ['a nervous executive and their bodyguard', 'a mid-tier corpo who tips well'] },
  { id: 'medevac',  label: 'Medevac (URGENT)', kind: 'passenger', legal: true, payMult: 1.7, risk: 1, wMin: 90, wMax: 90, mins: 11, names: ['a wounded runner bleeding out', 'a crash survivor who needs a real clinic'] },
  { id: 'relief',   label: 'Relief Run',     kind: 'cargo',     legal: true,  payMult: 1.5, risk: 2, wMin: 120, wMax: 300, mins: 30, names: ['crates of relief supplies', 'water and rations for the wastes', 'a mobile clinic in flatpack'] },
  { id: 'survey',   label: 'Survey Drop',    kind: 'cargo',     legal: true,  payMult: 1.2, risk: 1, wMin: 40, wMax: 80,  mins: 26, names: ['sensor pods for recovery', 'a survey drone package', 'seismic charges (permitted)'] },

  // ── Illegal (contraband; fly dark) ─────────────────────────────────────────
  { id: 'smuggle',  label: 'Smuggling',      kind: 'cargo',     legal: false, payMult: 2.1, risk: 2, wMin: 40, wMax: 120, mins: 24, names: ['an unmarked crate that ticks', 'sealed bricks of something illegal', 'a case nobody will describe'] },
  { id: 'gunrun',   label: 'Gun-Running',    kind: 'cargo',     legal: false, payMult: 2.3, risk: 3, wMin: 80, wMax: 200, mins: 24, names: ['a crate of hot iron', 'oiled rifles in a fish shipment', 'a pallet of "agricultural parts"'] },
  { id: 'chopshop', label: 'Chop-Shop Parts', kind: 'cargo',    legal: false, payMult: 2.1, risk: 2, wMin: 40, wMax: 100, mins: 20, names: ['stripped, still-warm cyberware', 'a VIN-scrubbed drive core', 'boxed black-market implants'] },
  { id: 'disposal', label: 'Disposal',       kind: 'cargo',     legal: false, payMult: 2.4, risk: 3, wMin: 90, wMax: 90,  mins: 30, names: ['a body that needs to disappear', 'a rolled tarp you were told not to open'] },
  { id: 'toxic',    label: 'Toxic Dump',     kind: 'cargo',     legal: false, payMult: 1.9, risk: 2, wMin: 150, wMax: 350, mins: 30, names: ['drums nobody will sign for', 'leaking canisters of something bright', 'unlabelled slurry'] },
  { id: 'exfil',    label: 'Exfil (HOT)',    kind: 'passenger', legal: false, payMult: 2.7, risk: 4, wMin: 90, wMax: 90,  mins: 20, names: ['a fugitive who can\'t use the front door', 'a witness who needs to vanish tonight'] },
  { id: 'datamule', label: 'Data Mule',      kind: 'passenger', legal: false, payMult: 2.4, risk: 3, wMin: 85, wMax: 85,  mins: 16, names: ['a courier wired with a case they can\'t open', 'a decker running from their last client'] },
];
const LEGAL_JOBS = JOB_TYPES.filter(j => j.legal);
const ILLEGAL_JOBS = JOB_TYPES.filter(j => !j.legal);
const jobById = (id) => JOB_TYPES.find(j => j.id === id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function airfields() {
  const { rows } = await query("SELECT id, name, grid_x, grid_y, flags FROM zones WHERE map_id='map_world' AND flags ? 'airfield_id'");
  return rows;
}

// Keep ~4 open jobs on a field's board (lazy top-up when listed). Legal fields
// carry only honest work; lawless fields also carry the shady jobs.
async function topUp(fieldZone, fields) {
  const { rows } = await query("SELECT COUNT(*)::int n FROM flight_contracts WHERE origin_zone=$1 AND status='open'", [fieldZone.id]);
  const have = rows[0]?.n || 0;
  const others = fields.filter(f => f.id !== fieldZone.id && f.grid_x != null);
  if (!others.length) return;
  const lawless = !!fieldZone.flags?.airfield_lawless;
  const lawlessDests = others.filter(f => f.flags?.airfield_lawless);
  // A lawless field's board is ~40% shady work; legal fields are all-legal.
  const pool = (n) => (lawless && Math.random() < 0.4 ? ILLEGAL_JOBS : LEGAL_JOBS);

  for (let i = have; i < 4; i++) {
    const job = pick(pool(i));
    const dest = (!job.legal && lawlessDests.length) ? pick(lawlessDests) : pick(others);
    const dist = cheb(fieldZone.grid_x, fieldZone.grid_y, dest.grid_x, dest.grid_y) || 1;
    const weight = job.wMin + Math.floor(Math.random() * (job.wMax - job.wMin + 1));
    const risk = Math.min(5, 1 + Math.floor(dist / 4) + job.risk + ((dest.flags?.airfield_lawless) ? 1 : 0));
    const rate = job.kind === 'passenger' ? 12 : weight * 0.25;
    const payout = Math.round(dist * rate * (1 + risk * 0.4) * job.payMult) + 60;
    await query(
      `INSERT INTO flight_contracts (id,kind,job_type,origin_zone,dest_zone,cargo_name,weight,payout,risk,contraband,status,deadline_s)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)`,
      [randomUUID(), job.kind, job.id, fieldZone.id, dest.id, pick(job.names), weight, payout, risk, job.legal ? 0 : 1, job.mins * 60]
    );
  }
}


const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

async function cmdContracts(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'The contract board is at the airfields.' };
  const fields = await airfields();
  await topUp(field, fields);
  const { rows } = await query("SELECT * FROM flight_contracts WHERE origin_zone=$1 AND status='open' ORDER BY payout DESC", [field.id]);
  const nameOf = (id) => fields.find(f => f.id === id)?.name || id;
  const lines = rows.map((c, i) => {
    const job = jobById(c.job_type);
    const tag = c.contraband ? '<span class="text-red">⚠ ILLEGAL</span>' : '<span class="text-green">LEGAL</span>';
    return `<b>[${i + 1}]</b> <b>${job?.label || c.kind}</b> — ${c.cargo_name} → <b>${nameOf(c.dest_zone)}</b>  [${tag}]\n` +
      `      ${c.weight}kg · risk ${stars(c.risk)} · <span class="text-green">${c.payout}c</span> · ${Math.round(c.deadline_s / 60)}min` +
      `${c.contraband ? ' · <span class="text-red">run dark</span>' : ''} · <span class="action-link" data-action="cmd" data-cmd="accept ${i + 1}">accept</span>`;
  });
  const shady = field.flags.airfield_lawless ? ' <span class="text-red">(no questions asked here)</span>' : '';
  const head = `<span class="text-cyan">CONTRACT BOARD — ${field.flags.airfield_name || field.name}:</span>${shady}`;
  return { type: 'output', message: rows.length ? `${head}\n${lines.join('\n')}` : `${head}\nThe board is empty. Check back later.` };
}

async function cmdAccept(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Accept contracts at the airfield board.' };
  const n = parseInt(args[0], 10);
  const { rows } = await query("SELECT * FROM flight_contracts WHERE origin_zone=$1 AND status='open' ORDER BY payout DESC", [field.id]);
  const c = rows[n - 1];
  if (!c) return { type: 'emote', message: 'No such job on the board. Type <b>contracts</b> to see it.' };

  // Bind to the aircraft the player is aboard / has parked here.
  let live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  let aircraftId = live?.row.id;
  if (!aircraftId) {
    const { rows: parked } = await query("SELECT id FROM aircraft WHERE parked_zone_id=$1 AND owner_id=$2 AND is_wreck=0 LIMIT 1", [field.id, player.id]);
    aircraftId = parked[0]?.id;
  }
  if (!aircraftId) return { type: 'emote', message: 'You need an aircraft here to load the job onto. Charter or buy one first.' };

  const { rows: acRows } = await query('SELECT type_id, custom_data FROM aircraft WHERE id=$1', [aircraftId]);
  if (!acRows[0]) return { type: 'emote', message: 'That aircraft is no longer here to load.' };
  const { rows: tRows } = await query('SELECT seats, max_takeoff_weight, cargo_capacity FROM aircraft_types WHERE id=$1', [acRows[0].type_id]);
  if (!tRows[0]) return { type: 'emote', message: "This aircraft's type registration is missing — can't load a job onto it." };
  // Cargo cap honours the aircraft's current weight-&-balance loadout (rigged for freight vs pax).
  const holdCap = effLoadout(acRows[0], tRows[0]).cargoCap;
  if (c.kind === 'cargo' && c.weight > holdCap)
    return { type: 'emote', message: `That's ${c.weight}kg — more than this aircraft's hold takes (${holdCap}kg${acRows[0].custom_data?.loadout ? ', as rigged' : ''}).` };

  const cd = acRows[0].custom_data || {};
  cd.cargoWeight = (cd.cargoWeight || 0) + c.weight;
  cd.contractId = c.id;
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), aircraftId]);
  if (live) live.row.custom_data = cd;
  await query("UPDATE flight_contracts SET status='active', player_id=$1, aircraft_id=$2, accepted_at=$3 WHERE id=$4",
    [player.id, aircraftId, nowSec(), c.id]);

  const destName = getZone(c.dest_zone)?.name || c.dest_zone;
  return { type: 'output', message: `<span class="item-grant">Job accepted — ${c.cargo_name} loaded (${c.weight}kg). Deliver to <b>${destName}</b> within ${Math.round(c.deadline_s / 60)} minutes.</span>` +
    (c.contraband ? '\n<span class="text-red">This is a dark run — kill your transponder (<b>squawk off</b>) or the cameras will make you.</span>' : '') };
}

async function cmdManifest(args, raw, player) {
  const { rows } = await query("SELECT * FROM flight_contracts WHERE player_id=$1 AND status='active'", [player.id]);
  if (!rows.length) return { type: 'output', message: 'No active jobs. Find a <b>contracts</b> board.' };
  const lines = rows.map(c => {
    const left = c.deadline_s - (nowSec() - c.accepted_at);
    const destName = getZone(c.dest_zone)?.name || c.dest_zone;
    return `· ${c.cargo_name} → <b>${destName}</b> — <span class="${left < 0 ? 'text-red' : 'text-green'}">${left < 0 ? 'OVERDUE' : Math.ceil(left / 60) + 'min left'}</span> · ${c.payout}c`;
  });
  return { type: 'output', message: `<span class="text-cyan">MANIFEST:</span>\n${lines.join('\n')}` };
}

// Called from index.cmdLandResolve on a successful landing.
export async function checkContractDelivery(player, live, fieldZoneId) {
  const { rows } = await query(
    "SELECT * FROM flight_contracts WHERE aircraft_id=$1 AND player_id=$2 AND status='active' AND dest_zone=$3",
    [live.row.id, player.id, fieldZoneId]
  );
  for (const c of rows) {
    const late = (nowSec() - c.accepted_at) > c.deadline_s;
    const pay = late ? Math.round(c.payout * 0.5) : c.payout;
    player.credits = (player.credits || 0) + pay;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    await query("UPDATE flight_contracts SET status='delivered' WHERE id=$1", [c.id]);
    // Unload the weight.
    const cd = live.row.custom_data || {};
    cd.cargoWeight = Math.max(0, (cd.cargoWeight || 0) - c.weight);
    if (cd.contractId === c.id) delete cd.contractId;
    live.row.custom_data = cd;
    await persist(live);
    const how = c.contraband ? (late ? 'Late — half, in unmarked cash: ' : 'Paid in unmarked cash: ') : (late ? 'Late — half rate: ' : 'Paid in full: ');
    out(player.id, `<span class="item-grant">Delivered: ${c.cargo_name}. ${how}<b>${pay}c</b>.</span>`);
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
const FENCE_ORIGIN = 'zone_waste_scald';     // the Scald — same lawless drop the smuggle plugin uses
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
    "SELECT id, cargo_name, contraband FROM flight_contracts WHERE aircraft_id=$1 AND player_id=$2 AND status='active'",
    [live.row.id, player.id]
  );
  const names = rows.map(c => c.cargo_name);
  const contraband = rows.some(c => c.contraband);
  for (const c of rows) await query("UPDATE flight_contracts SET status='failed' WHERE id=$1", [c.id]);
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
};
