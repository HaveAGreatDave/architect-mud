// Flight — cargo & passenger contracts (the freight economy). A field's board
// carries jobs: haul cargo or fly a passenger origin→dest airfield within a
// deadline for a payout that scales with distance × weight × risk. Cargo loads
// into the craft as weight (feeding takeoff difficulty + fuel burn via effStats).
// Contraband jobs pay more but must be flown dark — running the transponder off
// dodges SPECTER but is itself a crime in controlled airspace.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, liveAircraft, out, effStats, persist } from './state.js';

const nowSec = () => Math.floor(Date.now() / 1000);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

const CARGO_POOL = [
  'a pallet of machine parts', 'a crate of medical supplies', 'sealed drums of coolant',
  'a container of dry goods', 'crated electronics', 'a load of scrap alloy', 'refrigerated cargo',
];
const PAX_POOL = [
  'a nervous corporate auditor', 'an off-duty ripperdoc', 'a courier who won\'t say what\'s in the case',
  'a family relocating out of the Redline', 'a wounded runner who needs a clinic',
];
const CONTRABAND_POOL = [
  'an unmarked crate that ticks', 'a case of hot cyberware', 'sealed bricks of something illegal',
  'a body that needs to disappear',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function airfields() {
  const { rows } = await query("SELECT id, name, grid_x, grid_y, flags FROM zones WHERE map_id='map_world' AND flags ? 'airfield_id'");
  return rows;
}

// Keep ~3 open jobs on a field's board (lazy top-up when listed).
async function topUp(fieldZone, fields) {
  const { rows } = await query("SELECT COUNT(*)::int n FROM flight_contracts WHERE origin_zone=$1 AND status='open'", [fieldZone.id]);
  const have = rows[0]?.n || 0;
  const dests = fields.filter(f => f.id !== fieldZone.id && f.grid_x != null);
  if (!dests.length) return;
  for (let i = have; i < 3; i++) {
    const dest = pick(dests);
    const dist = cheb(fieldZone.grid_x, fieldZone.grid_y, dest.grid_x, dest.grid_y) || 1;
    const contraband = Math.random() < 0.25 ? 1 : 0;
    const kind = !contraband && Math.random() < 0.35 ? 'passenger' : 'cargo';
    const weight = kind === 'passenger' ? 80 : 40 + Math.floor(Math.random() * 240);
    const risk = Math.min(5, 1 + Math.floor(dist / 4) + (contraband ? 2 : 0) + ((dest.flags?.danger || 0) > 3 ? 1 : 0));
    const payout = Math.round(dist * (kind === 'passenger' ? 12 : weight * 0.25) * (1 + risk * 0.4) * (contraband ? 1.8 : 1)) + 60;
    const name = contraband ? pick(CONTRABAND_POOL) : kind === 'passenger' ? pick(PAX_POOL) : pick(CARGO_POOL);
    await query(
      `INSERT INTO flight_contracts (id,kind,origin_zone,dest_zone,cargo_name,weight,payout,risk,contraband,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')`,
      [randomUUID(), kind, fieldZone.id, dest.id, name, weight, payout, risk, contraband]
    );
  }
}

function fieldOf(player) {
  const zone = getZone(player.current_zone);
  return zone?.flags?.airfield_id ? zone : null;
}

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

async function cmdContracts(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'The contract board is at the airfields.' };
  const fields = await airfields();
  await topUp(field, fields);
  const { rows } = await query("SELECT * FROM flight_contracts WHERE origin_zone=$1 AND status='open' ORDER BY payout DESC", [field.id]);
  const nameOf = (id) => fields.find(f => f.id === id)?.name || id;
  const lines = rows.map((c, i) =>
    `<b>[${i + 1}]</b> ${c.contraband ? '<span class="text-red">⚠ </span>' : ''}${c.cargo_name} → <b>${nameOf(c.dest_zone)}</b>\n` +
    `      ${c.kind} · ${c.weight}kg · risk ${stars(c.risk)} · <span class="text-green">${c.payout}c</span> · ${Math.round(c.deadline_s / 60)}min` +
    ` · <span class="action-link" data-action="cmd" data-cmd="accept ${i + 1}">accept</span>`);
  const head = `<span class="text-cyan">CONTRACT BOARD — ${field.flags.airfield_name || field.name}:</span>`;
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
  const { rows: tRows } = await query('SELECT max_takeoff_weight, cargo_capacity FROM aircraft_types WHERE id=$1', [acRows[0].type_id]);
  if (c.kind === 'cargo' && c.weight > (tRows[0].cargo_capacity || 0))
    return { type: 'emote', message: `That's ${c.weight}kg — more than this aircraft's hold takes (${tRows[0].cargo_capacity}kg).` };

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
    out(player.id, `<span class="item-grant">Delivered: ${c.cargo_name}. ${late ? 'Late — half rate: ' : 'Paid in full: '}<b>${pay}c</b>.</span>`);
  }
}

export const commands = {
  contracts: cmdContracts,
  jobs: cmdContracts,
  accept: cmdAccept,
  manifest: cmdManifest,
};
