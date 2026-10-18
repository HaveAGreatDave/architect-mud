// THE SEAT, FROM THE SERVER'S SIDE.
//
// The client steps podracer-model.js at frame rate and reports four times a second; the server keeps
// the row and checks the report against an envelope. The powerboat's helm.js is the pattern, with
// one thing it lacks: a position check. A boat on open water is bounded by the water; a racer on
// hardpan is bounded by nothing, so a report that moved further than the racer could have is
// refused and the client is put back.
//
// The server trusts only the pod's position. The turbines' offset from it is for drawing other
// players' racers and is clamped to the length of the cables.

import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getZone, getAllZones, getMinimapData } from '../../server/engine/world.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { applyStrikeToPlayer } from '../../server/engine/combat.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { prefersTextMinigamesOrDefault, prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { mapWindow, skyState, worldContactsNear, skylineNear, nearbyRegions, farRoadsNear, FAR_ROAD_R, surfaceAt } from '../flight/state.js';
import { streetActors } from '../../server/engine/street-actors.js';
import { PODRACER_TYPES } from '../../client/game/js/panels/podracer-model.js';
import { typeOf, isLot, rowEng, rowCables, rowBinder, recoverFee, racerLiveryOf, hireOf, hireLeft, sweepHires, racerPanel } from './lot.js';
import { adjustCredits } from '../../server/engine/economy.js';
// A cycle with index.js, safe because `rigs` and `seated` are only read inside function bodies.
import { rigs, seated } from './index.js';

export const RADIUS = 20;               // must match RAD in client/game/js/panels/podracer-view.js
// The Scarletwastes, where a racer may run. The client treats the rim as a wall; this is the check.
export const BOX = { x0: 1000, x1: 1092, y0: 950, y1: 1001 };
const BOX_MARGIN = 1;
const FLUSH_MS = 10_000;
const CONTACT_PUSH_MS = 1000;
const ACTOR_PUSH_MS = 2000;
// How much faster than its top speed a report may claim to have moved, plus a tile of slack for
// rounding and a recentre landing between two packets.
const JUMP_SLACK = 1.5, JUMP_TILES = 1;
// The longest gap between packets the check will scale up to. A tab that was hidden for a minute
// has not earned a minute of travel.
const JUMP_MAX_S = 3;
const STOP_MPH = 5;                     // parking needs it all but stopped
const TAUGHT = 'podracer_taught';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v ?? 1)));
const inBox = (x, y, m = 0) => x >= BOX.x0 - m && x <= BOX.x1 + m && y >= BOX.y0 - m && y <= BOX.y1 + m;


// ── The bay ────────────────────────────────────────────────────────────────────
//
// A racer kept in a lot room comes out through the building's bay door: it starts on the facade
// tile, inside the shed, facing out the way the door faces (`flags.entrance`), and you drive it out
// onto the yard. The truck's own arrangement (`drive` mounts the rig inside the bay). Driven back
// onto that door and parked, it goes back up on the blocks in the lot room.
const HEADING_OF = { north: 0, east: 90, south: 180, west: 270 };
let _bays = null;
// 'x,y' of each lot room's bay door, to the lot room. Content, so built once.
function bays() {
  if (_bays) return _bays;
  _bays = new Map();
  for (const z of getAllZones()) {
    if (!isLot(z)) continue;
    const door = getZone(z.flags.world_exit_zone || z.parent_zone);
    if (door && door.map_id === 'map_world') _bays.set(door.grid_x + ',' + door.grid_y, z.id);
  }
  return _bays;
}
export const _forgetBays = () => { _bays = null; };
/** The lot room whose bay door is the tile under (x, y), or null. */
export function bayLotAt(x, y) { return bays().get(Math.round(x) + ',' + Math.round(y)) || null; }

/** Where a racer starts, in world tiles and degrees, or null if it cannot be started where it is. */
export function startOf(row) {
  const zone = getZone(row.park_zone);
  if (!zone) return null;
  if (isLot(zone)) {
    const door = getZone(zone.flags.world_exit_zone || zone.parent_zone);
    if (!door || door.map_id !== 'map_world') return null;
    return { x: door.grid_x, y: door.grid_y, heading: HEADING_OF[door.flags?.entrance] ?? 180, bay: zone.id };
  }
  if (zone.map_id !== 'map_world' || !inBox(zone.grid_x, zone.grid_y)) return null;
  return { x: zone.grid_x, y: zone.grid_y, heading: Number(row.custom_data?.heading) || 0, bay: null };
}

async function seatedRow(player) {
  const id = seated.get(player.id);
  if (!id) return null;
  const r = await query('SELECT * FROM podracers WHERE id = $1 AND owner_id = $2', [id, player.id]);
  return r.rows[0] || null;
}

function farOf(x, y) {
  return { skyline: skylineNear(x, y, RADIUS), regions: nearbyRegions(x, y), roads: farRoadsNear(x, y, FAR_ROAD_R) };
}

export function seatContext(row, at, playerId) {
  const sky = skyState(at.x, at.y) || {};
  return {
    name: row.name || typeOf(row.type_id)?.name || 'racer',
    typeId: row.type_id,
    gx: at.x, gy: at.y,
    heading: at.heading ?? (Number(row.custom_data?.heading) || 0),
    map: mapWindow({ grid_x: at.x, grid_y: at.y }, RADIUS),
    params: PODRACER_TYPES[row.type_id] || PODRACER_TYPES.podracer,
    hull: clamp01(row.condition), fuel: clamp01(row.fuel), eng: rowEng(row), cables: rowCables(row), binder: rowBinder(row),
    recoverFee: typeOf(row.type_id) ? recoverFee(typeOf(row.type_id)) : 0,
    livery: racerLiveryOf(row),
    hour: sky.hour, weather: sky.weather, moon: sky.moon, wind: sky.wind,
    wxField: sky.field || null, wxGround: sky.ground || null, wxEvent: sky.event || null,
    contacts: worldContactsNear(at.x, at.y, 26, 'pod_' + playerId),
    ...farOf(at.x, at.y),
    actors: streetActors(at.x, at.y, RADIUS, playerId),
  };
}

// ── Climbing in ────────────────────────────────────────────────────────────────
export async function mountRacer(player, row) {
  const t = typeOf(row.type_id);
  if (!t) return { type: 'error', message: 'That racer is a type the yard no longer knows how to start.' };
  const at = startOf(row);
  if (!at) return { type: 'error', message: 'It is not sitting anywhere it could be started from.' };
  if (hireOf(row) && hireLeft(row) <= 0) {
    await sweepHires(player.id);
    return { type: 'error', message: 'The hire has run out. The yard has taken it back.' };
  }
  if (clamp01(row.condition) <= 0) return { type: 'error', message: 'The pod is wrecked. The yard can rebuild it: <b>podracer service</b>.' };
  if (rowEng(row).every((e) => e <= 0)) return { type: 'error', message: 'Both turbines are dead. <b>podracer service</b> in the yard.' };
  if (clamp01(row.fuel) <= 0) return { type: 'error', message: 'The tank is dry. <b>podracer service</b> in the yard fills it.' };
  if (!rowBinder(row)) {
    return { type: 'error', message: isLot(getZone(row.park_zone))
      ? 'The binder is torn out. The turbines will not light without it: <b>podracer service</b> welds a new one in.'
      : 'The binder is torn out and it is going nowhere. The racer bay at the Deadleg can send the flatbed: <b>podracer recover</b>.' };
  }
  // The racer has no text rung yet. A helm you cannot see is a helm you cannot drive, so it says so
  // rather than opening a pane nobody is looking at.
  if (await prefersTextMinigamesOrDefault(player)) {
    return { type: 'error', message: 'A racer is driven by eye, and there is no text helm for one yet. Switch display mode to visual to race.' };
  }
  seated.set(player.id, row.id);
  rigs.delete(player.id);
  svcState.delete(player.id);
  const first = !(await getFlag('player', TAUGHT, player));
  sendToPlayer(player.id, { type: 'podracer_close' });
  sendToPlayer(player.id, { type: 'podracer_sim', ...seatContext(row, at, player.id), first });
  return { type: 'emote', message: at.bay
    ? 'The yard lets the racer down off the blocks in the shed door, turbines out at the hardpan. You climb into the pod and pull the straps over your shoulders.'
    : 'You climb down into the pod and pull the straps over your shoulders. The turbines are cold.' };
}

// ── The telemetry ──────────────────────────────────────────────────────────────
//
// podsync x y heading speed hull engL engR fuel leverL leverR cables binder ex ey eh
//   cables is a bitmask, bit 0 the left cable intact, bit 1 the right
//   binder is 1 while the binder holds
//   ex ey eh are the turbines' centre and heading, for other players' screens
//
// Pure, so the regress suite can drive it without a socket. Returns { ok, rig } or { ok: false, why }.
export function checkSync(was, n, now, p) {
  const [x, y, heading, speed, hull, engL, engR, fuel, leverL, leverR, cables, binder, ex, ey, eh] = n;
  if (!inBox(x, y, BOX_MARGIN)) return { ok: false, why: 'box' };
  if (Number.isFinite(was.x) && Number.isFinite(was.y) && was.at) {
    const dt = Math.min(JUMP_MAX_S, Math.max(0, (now - was.at) / 1000));
    const reach = (p.topSpeed / p.tileMph) * dt * JUMP_SLACK + JUMP_TILES;
    if (Math.hypot(x - was.x, y - was.y) > reach) return { ok: false, why: 'jump' };
  }
  const keep = (a, b) => Math.max(0, Math.min(clamp01(a), clamp01(b)));
  // The turbines' offset from the pod can be no longer than everything between them.
  const maxSep = (p.podHalfLen + p.cableLen + p.cableV + p.halfSpan) * 1.15;
  let ox = ex - x, oy = ey - y;
  const sep = Math.hypot(ox, oy);
  if (!(sep <= maxSep)) { const k = sep > 0 ? maxSep / sep : 0; ox *= k; oy *= k; }
  const rig = {
    ...was,
    x: +x.toFixed(3), y: +y.toFixed(3),
    heading: ((Math.round(heading) % 360) + 360) % 360,
    speed: Math.max(0, Math.min(p.topSpeed * 1.2, Math.round(speed))),
    hull: keep(was.hull, hull),
    eng: [keep(was.eng?.[0], engL), keep(was.eng?.[1], engR)],
    fuel: keep(was.fuel, fuel),
    lever: [clamp01(leverL), clamp01(leverR)],
    // Once snapped, a cable stays snapped, and once torn, the binder stays torn, until the yard.
    cables: [(was.cables?.[0] !== false) && !!(cables & 1), (was.cables?.[1] !== false) && !!(cables & 2)],
    binder: was.binder !== false && !!binder,
    ex: +(x + ox).toFixed(3), ey: +(y + oy).toFixed(3),
    eh: ((Math.round(eh) % 360) + 360) % 360,
    at: now,
  };
  return { ok: true, rig };
}

export async function cmdPodSync(args = [], raw, player) {
  const id = seated.get(player.id);
  if (!id) return null;
  const n = args.map(Number);
  if (n.length < 15 || n.some((v) => !Number.isFinite(v))) return null;
  const was = rigs.get(player.id) || await seedRig(player, id);
  if (!was) return null;
  const p = PODRACER_TYPES[was.typeId] || PODRACER_TYPES.podracer;
  const res = checkSync(was, n, Date.now(), p);
  if (!res.ok) {
    // Put the client back where the server last believed it was.
    if (Number.isFinite(was.x)) sendToPlayer(player.id, { type: 'podracer_ctx', snap: { x: was.x, y: was.y, heading: was.heading } });
    return null;
  }
  const rig = res.rig;
  rigs.set(player.id, rig);

  const cx = Math.round(rig.x), cy = Math.round(rig.y);
  if (!Number.isFinite(rig.mapX)) { rig.mapX = cx; rig.mapY = cy; }
  else if (Math.abs(cx - rig.mapX) > 8 || Math.abs(cy - rig.mapY) > 8) {
    rig.mapX = cx; rig.mapY = cy;
    const sky = skyState(cx, cy) || {};
    sendToPlayer(player.id, { type: 'podracer_ctx', gx: cx, gy: cy, map: mapWindow({ grid_x: cx, grid_y: cy }, RADIUS),
      hour: sky.hour, weather: sky.weather, wxField: sky.field || null, wxGround: sky.ground || null,
      contacts: worldContactsNear(cx, cy, 26, 'pod_' + player.id), ...farOf(cx, cy),
      actors: streetActors(cx, cy, RADIUS, player.id) });
    rig.actAt = Date.now(); rig.conAt = Date.now();
  } else if (Date.now() - (rig.actAt || 0) > ACTOR_PUSH_MS) {
    rig.actAt = Date.now();
    sendToPlayer(player.id, { type: 'podracer_ctx', actors: streetActors(rig.mapX, rig.mapY, RADIUS, player.id) });
  }
  if (Date.now() - (rig.conAt || 0) > CONTACT_PUSH_MS) {
    rig.conAt = Date.now();
    sendToPlayer(player.id, { type: 'podracer_ctx', contacts: worldContactsNear(rig.x, rig.y, 26, 'pod_' + player.id) });
  }
  svcTick(player, rig);
  if (Date.now() - (rig.flushed || 0) > FLUSH_MS) await flushRig(rig);
  return null;
}

// ── The bay overlay ────────────────────────────────────────────────────────────
//
// Stopped on a bay door, the counter's payload goes onto the seat as its overlay (`service: 'bay'`):
// the depot standard's bay, the truck's `pushBayService` and the marina's `svcTick`. It only says
// where the payload goes; every button on it is still a verb. Pushed on a change, never per sync.
export const svcState = new Map();
const BAY_STOP_MPH = 3;
function svcTick(player, rig) {
  const lot = rig.speed <= BAY_STOP_MPH ? bayLotAt(rig.x, rig.y) : null;
  const cur = svcState.get(player.id) || null;
  if (cur === lot) return;
  if (lot) { svcState.set(player.id, lot); pushBay(player, lot).catch(() => {}); }
  else { svcState.delete(player.id); sendToPlayer(player.id, { type: 'podracer_service_close' }); }
}
export async function pushBay(player, lotId = svcState.get(player.id)) {
  if (!lotId || await prefersLoggedPanelsOrDefault(player)) return false;
  const panel = await racerPanel(player, lotId, { seatedId: seated.get(player.id) || null });
  if (!panel) return false;
  sendToPlayer(player.id, { ...panel, service: 'bay', serviceId: seated.get(player.id) || null });
  return true;
}

async function seedRig(player, racerId) {
  const r = await query('SELECT * FROM podracers WHERE id = $1', [racerId]);
  const b = r.rows[0];
  if (!b) return null;
  const rig = {
    playerId: player.id, racerId: b.id, typeId: b.type_id, name: b.name || 'racer',
    hull: clamp01(b.condition), fuel: clamp01(b.fuel), eng: rowEng(b), cables: rowCables(b), binder: rowBinder(b),
    livery: racerLiveryOf(b),
    x: null, y: null, heading: 0, speed: 0, lever: [0, 0],
    flushed: Date.now(),
  };
  rigs.set(player.id, rig);
  return rig;
}

export async function flushRig(rig) {
  if (!rig?.racerId) return;
  rig.flushed = Date.now();
  await query(
    `UPDATE podracers SET condition = $2, fuel = $3,
       custom_data = jsonb_set(jsonb_set(jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{eng}', $4::jsonb), '{cables}', $5::jsonb), '{binder}', to_jsonb($6::boolean))
     WHERE id = $1`,
    [rig.racerId, rig.hull, rig.fuel, JSON.stringify(rig.eng), JSON.stringify(rig.cables), rig.binder !== false]);
}

// ── Where you climb out ────────────────────────────────────────────────────────
//
// The nearest tile to (x, y) a person can stand on: a mapped zone in the region that is not a
// building facade and not high ground. Searched outward in rings, so a racer stopped against a
// cliff leaves you at its foot.
export function standTileNear(x, y) {
  const cx = Math.round(x), cy = Math.round(y);
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const c = surfaceAt(cx + dx, cy + dy);
      if (!c?.id || !inBox(cx + dx, cy + dy)) continue;
      const t = c.flags?.terrain;
      if (c.flags?.building_type || t === 'cliff' || t === 'plateau' || t === 'water') continue;
      return c.id;
    }
  }
  return null;
}

async function leaveSeat(player, rig, zoneId, line, broadcast) {
  seated.delete(player.id);
  rigs.delete(player.id);
  sendToPlayer(player.id, { type: 'podracer_sim_close' });
  if (zoneId && player.current_zone !== zoneId) {
    await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: zoneId }, context: { broadcast } }).catch(() => {});
  }
  const zone = zoneId ? getZone(zoneId) : null;
  if (!zone) return { type: 'emote', message: line };
  return { type: 'move', message: `<span class="text-cyan">${line}</span>\n${await describeZone(zone, player)}`,
    zone: zoneId, minimap: getMinimapData(zoneId, 8, player) };
}

export async function parkRacer(player, broadcast) {
  const row = await seatedRow(player);
  if (!row) { seated.delete(player.id); sendToPlayer(player.id, { type: 'podracer_sim_close' }); return null; }
  const rig = rigs.get(player.id);
  if (rig && rig.speed > STOP_MPH) {
    return { type: 'error', message: 'Not at this speed. Take the levers off and let it stop.' };
  }
  // On a bay door it goes back up on the blocks in that lot. Never moved, it is still in its bay.
  const bay = rig && Number.isFinite(rig.x) ? bayLotAt(rig.x, rig.y) : (isLot(getZone(row.park_zone)) ? row.park_zone : null);
  const zoneId = bay || (rig && Number.isFinite(rig.x) ? standTileNear(rig.x, rig.y) || row.park_zone : row.park_zone);
  if (rig) await flushRig(rig);
  await query(`UPDATE podracers SET park_zone = $2,
      custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{heading}', to_jsonb($3::int))
    WHERE id = $1`, [row.id, zoneId, Math.round(rig?.heading || 0)]);
  svcState.delete(player.id);
  sendToPlayer(player.id, { type: 'podracer_service_close' });
  const out = await leaveSeat(player, rig, zoneId, bay
    ? 'You run it back in under the shed roof and shut it down. The yard puts it up on the blocks in the racer bay.'
    : 'You shut the turbines down and climb out of the pod. The heat comes off the casings in waves.', broadcast);
  // Back in the bay, the counter is dealt again.
  if (bay) { const { pushDepot } = await import('./index.js'); await pushDepot(player).catch(() => {}); }
  return out;
}

// ── The wreck ──────────────────────────────────────────────────────────────────
//
// A pod beaten to nothing. The racer is gone and the person in it takes strikes sized by how fast it
// was going, through applyStrikeToPlayer so armour and soak apply. A lethal strike goes to the
// engine's death path. A torn binder is not this: see breakdownRacer.
export function wreckPlan(speed, top) {
  const s = Math.max(0, Math.min(1, speed / Math.max(1, top)));
  const sev = s * s;
  return { hits: 2 + Math.round(4 * sev), min: Math.round(4 + 16 * sev), max: Math.round(10 + 40 * sev), sev };
}

export async function wreckRacer(player, why, broadcast) {
  const row = await seatedRow(player);
  if (!row) return null;
  const rig = rigs.get(player.id);
  const t = typeOf(row.type_id) || PODRACER_TYPES.podracer;
  const speed = rig?.speed ?? 0;
  await query('DELETE FROM podracers WHERE id = $1', [row.id]).catch(() => {});
  const zoneId = rig && Number.isFinite(rig.x) ? standTileNear(rig.x, rig.y) || row.park_zone : row.park_zone;
  const plan = wreckPlan(speed, t.topSpeed);
  const parts = [];
  let killed = false;
  for (let i = 0; i < plan.hits && !killed; i++) {
    const r = await applyStrikeToPlayer(player, { min: plan.min, max: plan.max, damageType: 'explosive' });
    parts.push(r.partLabel || r.part);
    killed = !!r.killed;
  }
  const how = 'The pod folds up around you and the whole thing comes down in a cloud of red grit.';
  const hurt = parts.length ? ` It got your ${[...new Set(parts)].join(', ')}.` : '';
  const out = await leaveSeat(player, rig, zoneId, how + hurt, broadcast);
  if (killed) await handlePlayerDeath(player, null, { type: 'crash', label: `Killed racing a ${t.name}` });
  return out;
}

// ── The flatbed ────────────────────────────────────────────────────────────────
//
// Called from the seat (the breakdown panel's button, or podracer recover typed): the yard's flatbed
// comes out, the racer goes up on its back and you ride home in the cab, to the racer's own bay.
export async function recoverSeated(player, broadcast) {
  const row = await seatedRow(player);
  if (!row) return null;
  const rig = rigs.get(player.id);
  if (rig && rig.speed > STOP_MPH) return { type: 'error', message: 'The flatbed will not chase you. Stop first.' };
  const t = typeOf(row.type_id) || PODRACER_TYPES.podracer;
  const fee = recoverFee(t);
  if ((player.credits ?? 0) < fee) return { type: 'error', message: `The flatbed is ₵${fee.toLocaleString()}. You have ₵${Math.round(player.credits ?? 0).toLocaleString()}.` };
  if (fee && !(await adjustCredits(player, -fee, query, 'podracer recovery'))) return { type: 'error', message: 'The money does not go through.' };
  // Home is the bay it lives in; a racer that has only ever been parked outside goes to the first bay.
  const lot = isLot(getZone(row.park_zone)) ? row.park_zone : ([...bays().values()][0] || row.park_zone);
  if (rig) await flushRig(rig);
  await query(`UPDATE podracers SET park_zone = $2, custom_data = COALESCE(custom_data, '{}'::jsonb) - 'heading' WHERE id = $1`, [row.id, lot]);
  svcState.delete(player.id);
  sendToPlayer(player.id, { type: 'podracer_service_close' });
  const out = await leaveSeat(player, rig, lot,
    `The yard's flatbed grinds out across the waste and winches the racer up onto its back, turbines strapped down either side. You ride back in the cab. ₵${fee.toLocaleString()}.`
    + (rig && rig.binder === false ? ' The binder is still torn out: podracer service welds it.' : ''), broadcast);
  const { pushDepot } = await import('./index.js');
  await pushDepot(player).catch(() => {});
  return out;
}

// ── The breakdown ──────────────────────────────────────────────────────────────
//
// A torn binder. The turbines cut out and flail apart on their cables, the pod skids to a stop behind
// them, and you are jolted in the straps: a lighter beating than a wreck, and the racer is kept. It
// is saved torn, so it will not start again until the yard welds it, wherever you leave it.
export function breakdownPlan(speed, top) {
  const s = Math.max(0, Math.min(1, speed / Math.max(1, top)));
  if (s < 0.15) return { hits: 0, min: 0, max: 0 };
  return { hits: 1 + Math.round(2 * s * s), min: Math.round(2 + 4 * s), max: Math.round(5 + 15 * s * s) };
}

export async function breakdownRacer(player, broadcast) {
  const rig = rigs.get(player.id);
  if (!rig || rig.binder === false) return null;
  const t = PODRACER_TYPES[rig.typeId] || PODRACER_TYPES.podracer;
  rig.binder = false;
  await flushRig(rig).catch(() => {});
  const plan = breakdownPlan(rig.speed ?? 0, t.topSpeed);
  const parts = [];
  let killed = false;
  for (let i = 0; i < plan.hits && !killed; i++) {
    const r = await applyStrikeToPlayer(player, { min: plan.min, max: plan.max, damageType: 'blunt' });
    parts.push(r.partLabel || r.part);
    killed = !!r.killed;
  }
  if (killed) {
    await dropSeat(player.id);
    sendToPlayer(player.id, { type: 'podracer_sim_close' });
    await handlePlayerDeath(player, null, { type: 'crash', label: `Killed when a ${t.name}'s binder tore out` });
    return null;
  }
  const hurt = parts.length ? ` The straps bite and you take it in the ${[...new Set(parts)].join(', ')}.` : '';
  return { type: 'emote', message: 'The binder tears out with a bang and a flash. Both turbines cut out and flail apart on their cables, and the pod skids to a stop behind them.'
    + hurt + ' <span class="text-dim">It will not start again without a binder. Climb out (Esc), then <b>podracer recover</b> at the racer bay sends the flatbed.</span>' };
}

// ── podevent ───────────────────────────────────────────────────────────────────
//
// What the model reported that the server has to act on. A claim is checked against the speed the
// server holds, so a binder that tore at walking pace is not believed.
export async function cmdPodEvent(args = [], raw, player, broadcast) {
  if (!seated.has(player.id)) return null;
  const what = String(args[0] || '').toLowerCase();
  const rig = rigs.get(player.id);
  if (what === 'park') return parkRacer(player, broadcast);
  if (what === 'started') return { type: 'emote', message: 'The starters wind up and both turbines light with a bang you feel in your teeth.' };
  if (what === 'stopped') return { type: 'emote', message: 'You shut the turbines down. They run down through a long falling whine.' };
  if (what === 'snap') return { type: 'emote', message: 'A cable lets go with a crack like a rifle and whips away into the dust.' };
  // A torn binder only ever costs the person reporting it, so it needs no speed check: the jolt is
  // sized by the speed the server holds.
  if (what === 'binder') return breakdownRacer(player, broadcast);
  if (what === 'wrecked') return wreckRacer(player, what, broadcast);
  if (what === 'learned') { await setFlag('player', TAUGHT, 1, player); return null; }
  return null;
}

/** Drop the seat without a word: logout, login, death. Flushes what the racer had. */
export async function dropSeat(playerId) {
  const rig = rigs.get(playerId);
  svcState.delete(playerId);
  seated.delete(playerId);
  rigs.delete(playerId);
  if (rig) await flushRig(rig).catch(() => {});
}

export const _test = { checkSync, wreckPlan, breakdownPlan, standTileNear, inBox, BOX, startOf, bayLotAt };
