// THE SEAT, FROM THE SERVER'S SIDE.
//
// `yard.js` owns where a hull LIVES; this owns the twenty seconds after you step down into her.
// Three verbs and nothing else: one that hands the client a helm, one that takes the client's
// telemetry back four times a second, and one that reports the things the sim noticed and the
// server has to have an opinion about.
//
// ── ⚠ THE CLIENT INTEGRATES AND THE SERVER RECONCILES ────────────────────────
//
// The same arrangement `trucksync` is in, and it is not a shortcut: a boat at 138 mph moves a tile
// in two thirds of a second, so a server-stepped hull would be a slideshow at any tick rate this
// game can afford. What the server keeps is the ROW — where she is, her hull, her bottle and her
// fuel — and what it refuses to take from the client is anything it can check for itself.
//
// ⚠ AND IT TAKES A POSITION RATHER THAN A DISTANCE, which is the trucking rule quoted and matters
// more here: there is no corridor on open water, so a self-reported run would be a number with
// nothing at all to hold it against.

import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getZone } from '../../server/engine/world.js';
import { mapWindow, skyState, aircraftNearCoord } from '../flight/state.js';
import { aboard, berthKind, berthsNear, berthCapacity, myBoats, pickBoat, coveredSlot, coveredRoomAtTile, isOpenWater, MOVE_IN, recoverAboard } from './yard.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { fuelServesAt } from './fuel.js';
import { effBoatParams, boatLiveryOf, stampBoatIfMissing, wetChange, boatRentalExpired, boatRental, PROP_KNOCK } from './service.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { surfaceAt } from '../flight/state.js';
// ⚠ A CYCLE, AND IT IS SAFE FOR ONE STATED REASON: `rigs` is only ever touched inside a function
// body here, so by the time anything reads it both modules have finished evaluating. Move a use of
// it to the top level of this file and it is a temporal-dead-zone throw at plugin load — see the
// same warning on `cabContext`, which chose the other way out because its cycle would have been
// between the module that builds roads and the one that decides where their mouths are. This one is
// an entry point and a leaf, so the registry stays where the rest of the plugin already reads it.
import { rigs } from './index.js';
import { prefersTextMinigamesOrDefault } from '../../server/engine/presentation.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { startTextHelm, isConning, stopTextHelm } from './texthelm.js';

const RADIUS = 16;                     // must match `RAD` in client/game/js/panels/boat-view.js
const HULL_FLOOR = 0.0;
// Whether this character has been shown the controls. ⚠ A PLAYER FLAG AND NOT A CLIENT ONE — see
// the note on `learned` below.
const HELM_TAUGHT = 'boat_helm_taught';

/** The boat this player is sitting in, or null. */
async function myBoat(player) {
  const id = aboard.get(player.id) || await recoverAboard(player);
  if (!id) return null;
  const r = await query('SELECT * FROM boats WHERE id = $1', [id]);
  return r.rows[0] || null;
}

/**
 * Where a berthed boat sits on the world grid.
 *
 * ⚠ THE BERTH'S ZONE, NOT THE PLAYER'S. They are the same tile while you are standing on the
 * pontoon and they are not once you are aboard and moving — and a helm that opened on the player's
 * own `current_zone` would re-centre the window on the marina every time you asked for it.
 */
function berthGrid(boat) {
  const z = getZone(boat.berth_zone);
  if (!z) return null;
  // ⚠ A COVERED DOCK PUTS HER ON ITS WATER, NOT ON ITS BUILDING. The room has no grid, and its
  // parent is the boathouse's own tile — land — so every hull kept under cover used to start
  // aground in front of the shed. The slot is the room's exit onto open water (yard.js
  // `coveredSlot`), and she lies in it bow out, the way that exit points: under the roof GLASS
  // draws over it, facing the Basin.
  const slot = coveredSlot(z);
  // ⚠ BOW TOWARD OPEN WATER, NOT DOWN THE DOOR'S DIRECTION. The slot's exit direction says which
  // way you walk OUT of the hall, and at Fairweather that is east — straight at the concrete of the
  // Slip one tile on. The channel out runs north past the fuel berth, so the heading is asked of
  // the water the same way an open berth's is, with the door's direction only as the fallback.
  if (slot) return { x: slot.x, y: slot.y, heading: seawardHeading(slot.x, slot.y) ?? slot.heading, covered: true };
  // An interior berth (the covered dock) has no grid of its own — it is a room inside a building —
  // so the window centres on the building's own tile, which is what `parent_zone` is for.
  const g = (z.grid_x || z.grid_y) ? z : getZone(z.parent_zone) || z;
  const x = g.grid_x || 0, y = g.grid_y || 0;
  return { x, y, heading: seawardHeading(x, y) };
}

// ⚠ SHE LIES BOW OUT. An open berth has no exit to read a direction off (that is `coveredSlot`'s
// trick), so she came up pointing north whatever the pontoon faced — often straight at the quay.
// Asked of the same window the client drives in, with the client's own water rule (water biome or
// a sub-surface tile), so the side the seat thinks is open is the side she faces. The longest
// clear run out of eight bearings wins; a tie keeps the earlier bearing.
const SEAWARD = [[0, -1, 0], [1, -1, 45], [1, 0, 90], [1, 1, 135], [0, 1, 180], [-1, 1, 225], [-1, 0, 270], [-1, -1, 315]];
export function seawardHeading(x, y) {
  const R = 10;
  let map;
  try { map = mapWindow({ grid_x: x, grid_y: y }, R); } catch { return 0; }
  const wet = (dx, dy) => {
    const c = map?.[dy + R]?.[dx + R];
    return !c || c.biome === 'water' || !!c.sub;
  };
  let best = 0, bestRun = -1;
  for (const [ux, uy, hdg] of SEAWARD) {
    let run = 0;
    for (let i = 1; i <= R && wet(ux * i, uy * i); i++) run++;
    if (run > bestRun) { bestRun = run; best = hdg; }
  }
  return best;
}

// ── THE PAYLOAD ──────────────────────────────────────────────────────────────
export function helmContext(boat, at) {
  const sky = skyState(at.x, at.y) || {};
  return {
    type: 'boat_ctx',
    name: boat.name || 'her',
    gx: at.x, gy: at.y,
    map: mapWindow({ grid_x: at.x, grid_y: at.y }, RADIUS),
    heading: at.heading ?? (Number(boat.custom_data?.heading) || 0),
    // What she handles like, with her wear on her (service.js). `boat-view` already reads
    // `ctx.params` ahead of the stock row, so a serviced boat is handed exactly the stock row.
    params: effBoatParams(boat.type_id, boat.custom_data || {}),
    livery: boatLiveryOf(boat.custom_data),
    hull: clamp01(boat.condition), fuel: clamp01(boat.fuel), nitro: clamp01(boat.custom_data?.nitro ?? 1),
    // ⚠ `skyState` CALLS THEM `field` AND `ground`, and the canopy calls the first `wxField`. The
    // trucking payload renames them in exactly this spot for the same reason; named wrong here
    // `drawVolumetricClouds` returns on its first line and the sky is empty with nothing to say so.
    hour: sky.hour, weather: sky.weather, moon: sky.moon, wind: sky.wind,
    wxField: sky.field || null, wxGround: sky.ground || null, wxEvent: sky.event || null,
    // Anything overhead, so a boat under a helicopter can see it. The same list the cockpit reads,
    // asked at the hull rather than at the player.
    contacts: aircraftNearCoord ? (aircraftNearCoord(at.x, at.y) || []) : [],
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v ?? 1)));

// ── `helm` ───────────────────────────────────────────────────────────────────
//
// ⚠ A SEPARATE VERB FROM `embark`, DELIBERATELY. Getting into a boat and driving it are two acts:
// you can sit in her at the pontoon with the cover on and the engine cold, which is the state the
// yard's own embark line describes. It also means a player who closed the pane has a way back into
// the seat that is not climbing out and in again.
// ⚠ THE SIGNATURE IS `(args, raw, player)`, WHICH IS THE ENGINE'S AND NOT A CHOICE. The
// dispatcher calls `handler(args, raw, player, broadcast)`; written `(player)` the verb receives the
// ARGUMENT ARRAY where it expects a person, every lookup keyed on `player.id` reads undefined, and
// the command answers its own "you are not aboard anything" to somebody standing in their boat.
// ⚠ AND IT PASSES A NAIVE TEST, which is how it survived a green suite: a check that only asserts
// the refusal gets the refusal, for the wrong reason.
export async function cmdHelm(args, raw, player) {
  const boat = await myBoat(player);
  // ⚠ ONE VERB FROM ANYWHERE IN THE MARINA. `helm` used to need you to have walked to her berth and
  // typed `board` first, and refused a hull on a cradle outright: three verbs and a crane for "take
  // my boat out". Not aboard, or aboard her on a cradle, at a marina, it IS `boat take` — the walk,
  // the step down, the crane if she needs it, then back in here seated.
  if ((!boat || berthKind(getZone(boat.berth_zone)) === 'hard') && berthsNear(player.current_zone).length) {
    return boatTake(player, (args || []).join(' '));
  }
  if (!boat) return { type: 'error', message: 'You are not aboard anything. <b>helm</b> works from anywhere in a marina where your boat is lying.' };
  const at = berthGrid(boat);
  if (!at) return { type: 'error', message: 'She is not berthed anywhere you could get under way from.' };
  // ⚠ ON A CRADLE SHE IS ON LAND. Taken from the hardstanding she used to start on the concrete,
  // aground, with the throttle doing nothing — the yard has a crane for exactly this.
  if (berthKind(getZone(boat.berth_zone)) === 'hard') {
    return { type: 'error', message: `${boat.name || 'She'} is up on a cradle. Have her craned into the covered dock first: <b>berth</b> from the Dock Hall.` };
  }
  // A HIRE THAT HAS RUN OUT goes back when you reach for the key — unless she is out on the water,
  // where the desk would rather you brought her in than swam.
  if (boatRentalExpired(boat) && !isOpenWater(getZone(boat.berth_zone))) {
    await query("DELETE FROM boats WHERE id = $1 AND custom_data->'rental' IS NOT NULL", [boat.id]).catch(() => {});
    aboard.delete(player.id);
    return { type: 'error', message: 'The hire has run out. The desk has her key back on its hook.' };
  }
  // A service baseline, and she is in the water now — fouling's clock (service.js).
  {
    const cd0 = boat.custom_data || {};
    const cd1 = stampBoatIfMissing(cd0, { afloat: true }) || wetChange(cd0, true);
    if (cd1) {
      boat.custom_data = cd1;
      await query('UPDATE boats SET custom_data = $2::jsonb WHERE id = $1', [boat.id, JSON.stringify(cd1)]).catch(() => {});
    }
  }
  if (clamp01(boat.condition) <= HULL_FLOOR) {
    return { type: 'error', message: `${boat.name || 'She'} is holed. Nothing is going anywhere until the yard has had her.` };
  }
  if (clamp01(boat.fuel) <= 0) {
    return { type: 'error', message: `${boat.name || 'She'} is dry. There is a pump on the fuel float.` };
  }
  // ⚠ A BILL FOR GETTING HER BACK IS PAID BEFORE SHE GOES OUT AGAIN, which is the one place the
  // debt can be collected without inventing a verb to collect it. A tow she could not pay for is
  // the only way this number is ever written (see adrift.js), and the yard that went out for her
  // is not handing the key over until it is settled.
  const owed = Math.max(0, Math.round(Number(boat.custom_data?.recovery_fee) || 0));
  if (owed) {
    return { type: 'error', message: `They have her, and they are not giving her back yet. `
      + `<span class="text-red">₵${owed.toLocaleString()}</span> outstanding on the recovery: <b>tow</b> settles it.` };
  }
  // ── ⚠ THE RUNG IS PICKED HERE AND LATCHED, NEVER ASKED PER TICK ────────────
  //
  // A helm is a surface you ACT through — take it away and you cannot move a boat at all — so it
  // is `prefersTextMinigames` rather than `prefersLoggedPanels`, and the two rungs are two ways
  // to make the SAME passage rather than one of them being a description of the other. Latched at
  // this entry moment per docs/systems-display-mode.md: a predicate called from the tick would be
  // a DB read four times a second and could change rung mid-passage.
  if (await prefersTextMinigamesOrDefault(player)) {
    await startTextHelm(player, boat, at);
    return { type: 'emote', message: 'You settle into the seat and put your hand on the lever.' };
  }
  // ⚠ READ HERE AND NOT IN `helmContext`, WHICH IS SYNC AND HAS THREE READERS INCLUDING THE GATE.
  // Making it async to fetch one flag would make every one of them await a database round trip on
  // a payload that is otherwise assembled entirely out of memory.
  const first = !(await getFlag('player', HELM_TAUGHT, player));
  sendToPlayer(player.id, { ...helmContext(boat, at), type: 'boat_sim', first });
  // ── THE SHIPWRIGHT COMES TO THE SLOT ───────────────────────────────────────
  // Taken from under cover, the marina's bench arrives as an overlay on the glass: servicing,
  // repairs, paint and name, and casting off is the lever. The telemetry tick takes it down when
  // she leaves the slot (svcTick) and puts the pump up when she stops at the fuel float.
  svcState.delete(player.id);
  if (at.covered) {
    svcState.set(player.id, { mode: 'dock' });
    const { pushMarinaService } = await import('./shopfront.js');
    await pushMarinaService(player, 'dock', { spawn: true });
  }
  return { type: 'emote', message: at.covered
    ? 'The slings let her down into the slot and she floats. You settle into the seat and put your hand on the lever.'
    : 'You settle into the seat and put your hand on the lever.' };
}

// ── THE SERVICE OVERLAY'S STATE ──────────────────────────────────────────────
// Which overlay, if any, is up over a helmsman's glass: 'dock' in a covered slot, 'fuel' stopped at
// the float. RAM only — it is a fact about a pane, and a restart closes every pane anyway.
export const svcState = new Map();

/**
 * The overlay follows the hull. ⚠ SYNC AND ON THE FOUR-TIMES-A-SECOND PATH: a `surfaceAt` and two
 * flag reads; the only async work it starts (building the panel) is on a TRANSITION and is never
 * awaited, so a slow panel can never hold the telemetry.
 */
function svcTick(player, rig) {
  const cell = surfaceAt(Math.round(rig.x), Math.round(rig.y));
  const tile = cell?.id ? getZone(cell.id) : null;
  const want = !tile ? null : coveredRoomAtTile(tile.id) ? 'dock' : fuelServesAt(tile) ? 'fuel' : null;
  const cur = svcState.get(player.id);
  if (cur && cur.mode !== want) {
    svcState.delete(player.id);
    sendToPlayer(player.id, { type: 'marina_service_close' });
  }
  if (want && !svcState.has(player.id) && (rig.speed || 0) < 2) {
    svcState.set(player.id, { mode: want });
    import('./shopfront.js').then(({ pushMarinaService }) => pushMarinaService(player, want, { zoneId: tile.id })).catch(() => {});
  }
}

// ── `boat take` — the card on the marina's first screen ──────────────────────
// Seats you in a hull where she lies and gets you under way: the walk across the yard to her, the
// step down into her, and the helm, as one act — because on the first screen they are one choice.
// ⚠ EVERY PIECE OF IT IS THE ORDINARY VERB'S. The walk is TELEPORT (the same move `overboard`
// makes), the step down is the `aboard` record `embark` writes, and the helm is `cmdHelm`, so the
// covered slot, the cradle refusal and the hire clock all apply here without a second copy.
export async function boatTake(player, arg) {
  const reach = berthsNear(player.current_zone);
  if (!reach.length) return { type: 'output', message: '<span class="text-dim">You would need to be at the marina she is lying at.</span>' };
  const pick = pickBoat(await myBoats(player.id), arg);
  if (pick.none) return { type: 'output', message: '<span class="text-dim">You do not own a boat.</span>' };
  if (!pick.boat) return { type: 'output', message: '<span class="text-dim">Which one?</span>' };
  const boat = pick.boat;
  const seated = aboard.get(player.id);
  if (seated && seated !== boat.id) return { type: 'error', message: 'You are sitting in another boat. Step off her first.' };
  if (!reach.some((z) => z.id === boat.berth_zone)) {
    return { type: 'error', message: `${boat.name || 'She'} is not lying at this marina.` };
  }
  // ⚠ ON A CRADLE, THE CRANE IS PART OF THE ASK — the card said what it costs before you clicked.
  // Into the covered dock, which is a move-in like any other (home_berth moves with her) at the
  // yard's own fee, and only if the shed has room.
  if (berthKind(getZone(boat.berth_zone)) === 'hard') {
    const shed = reach.find((z) => berthKind(z) === 'covered');
    if (!shed) return { type: 'error', message: `${boat.name || 'She'} is on a cradle and there is no covered dock here to crane her into.` };
    const r = await query('SELECT count(*)::int AS n FROM boats WHERE berth_zone = $1', [shed.id]);
    if ((r.rows[0]?.n ?? 0) >= berthCapacity(shed)) return { type: 'error', message: 'The covered dock is full. Nothing can be craned in until a slot frees up.' };
    const fee = MOVE_IN.covered;
    if ((player.credits ?? 0) < fee) return { type: 'error', message: `The crane is ₵${fee.toLocaleString()} and you have ₵${(player.credits ?? 0).toLocaleString()}.` };
    await adjustCredits(player, -fee, query, 'berth fee');
    await query(`UPDATE boats SET berth_zone = $1, custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{home_berth}', to_jsonb($1::text), true) WHERE id = $2`, [shed.id, boat.id]);
    boat.berth_zone = shed.id;
    sendToPlayer(player.id, { type: 'emote', message: `The travel crane walks ${boat.name || 'her'} off the cradle and into the covered dock. ₵${fee.toLocaleString()}.` });
  }
  if (player.current_zone !== boat.berth_zone) {
    await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: boat.berth_zone } }).catch(() => {});
  }
  aboard.set(player.id, boat.id);
  return cmdHelm([], 'helm', player);
}

/**
 * The yard changed something about the hull you are sitting in: the hull, her paint, her name, her
 * servicing. ⚠ RAM AND THE SEAT, NOT JUST THE ROW — the telemetry's one-way clamp compares the
 * client's hull against `rigs`, so a repair written only to the row is undone by the next flush, and
 * a livery written only to the row is a boat the seat and every stranger still draw the old colour.
 */
export async function applyLive(player, boatId, { hull = null, cd = null, name = null } = {}) {
  if (aboard.get(player.id) !== boatId) return;
  const rig = rigs.get(player.id);
  const out = { type: 'boat_ctx' };
  if (hull != null) { if (rig) rig.hull = hull; out.hull = hull; }
  if (cd) { const lv = boatLiveryOf(cd); if (rig) rig.livery = lv; out.livery = lv; out.params = effBoatParams(rig?.typeId || 'hydro', cd); }
  if (name) { if (rig) rig.name = name; out.name = name; }
  sendToPlayer(player.id, out);
}

// ── `boatsync` ───────────────────────────────────────────────────────────────
//
// x y heading speed hull nitro fuel pedal roll pitch rich bang flags — the order `boat-view.js`
// packs them in, and the only place the two files have to agree.
//
// ⚠ IT WRITES RAM AND NOT THE ROW, which is this plugin's own stated design and not a shortcut:
// `rigs`' comment says a position on the water is per-tick state and the persistence tiers forbid
// it in the database, and the `boats` table proves the point by having no x, y or heading columns
// to put it in. What survives a restart is where she is BERTHED — a boat that was out on the water
// comes back tied up, which is the same answer the truck gives.
//
// ⚠ AND FILLING `rigs` IS WHAT MAKES HER EXIST TO ANYBODY ELSE. The `vehicle.contacts` hook reads
// exactly this map, so every field `boatContactsNear` publishes has to arrive here — including the
// two small ones. `rich` and `bang` are the sim's own derivative of the lever against the blower,
// and the renderer draws a flame off the gap, so a boat two hundred yards away stabbing the
// throttle lights up in your screen. Dropped here, she runs silently and cleanly for ever.
//
// ⚠ AND THE SPENT FIELDS ARE ONE-WAY. Hull, bottle and fuel are spent by the sim and refilled only
// by the yard, so a client may report them DOWN and never up. That is the whole of the anti-cheat
// and it is one comparison rather than a second model of the boat.
export async function cmdBoatSync(args = [], raw, player) {
  const id = aboard.get(player.id) || await recoverAboard(player);
  if (!id) return null;                                    // silent: the pane can outlive the seat
  const n = args.map(Number);
  if (n.length < 13 || n.some((v) => !Number.isFinite(v))) return null;
  const [x, y, heading, speed, hull, nitro, fuel, pedal, roll, pitch, rich, bang, flags] = n;

  const was = rigs.get(player.id) || await seedRig(player, id);
  if (!was) return null;
  // THE DISTANCE SHE COVERS, which is what the oil wears on (service.js). Accrued in RAM and
  // flushed with the tank. ⚠ A JUMP IS NOT DISTANCE — a recentre or a first packet can move the
  // reported position a long way in one step, and three tiles in a quarter second is 130 mph.
  if (Number.isFinite(was.x) && Number.isFinite(was.y)) {
    const d = Math.hypot(x - was.x, y - was.y);
    if (d < 3) was.run = (was.run || 0) + d;
  }
  const keep = (a, b) => Math.max(0, Math.min(clamp01(a), clamp01(b)));
  Object.assign(was, {
    x: +x.toFixed(3), y: +y.toFixed(3),
    heading: ((Math.round(heading) % 360) + 360) % 360,
    speed: Math.max(0, Math.round(speed)),
    hull: keep(was.hull, hull), nitro: keep(was.nitro, nitro), fuel: keep(was.fuel, fuel),
    pedal: clamp01(pedal), roll, pitch,
    rich: clamp01(rich), bang: clamp01(bang),
    nitroOn: !!(flags & 1),
    at: Date.now(),
  });
  rigs.set(player.id, was);

  // ── A FRESH WINDOW OF THE WORLD WHEN SHE NEARS THE EDGE OF THE LAST ONE ───
  // The seat re-centres itself every six tiles and its comment has always said the server streams a
  // fresh window 'on the next sync' — nothing did, so past the first 33 tiles every unknown cell
  // read as open water and the fuel float she was coming back to did not exist. ⚠ THE WORLD AND
  // THE SKY ONLY, never the hull or the tank: the row is up to ten seconds stale against the sim,
  // and adopting it would wind the tank back UP four times a second.
  const cx = Math.round(was.x), cy = Math.round(was.y);
  if (!Number.isFinite(was.mapX)) { was.mapX = cx; was.mapY = cy; }
  else if (Math.abs(cx - was.mapX) > 8 || Math.abs(cy - was.mapY) > 8) {
    was.mapX = cx; was.mapY = cy;
    const sky = skyState(cx, cy) || {};
    sendToPlayer(player.id, { type: 'boat_ctx', gx: cx, gy: cy, map: mapWindow({ grid_x: cx, grid_y: cy }, RADIUS),
      hour: sky.hour, weather: sky.weather, wxField: sky.field || null, wxGround: sky.ground || null,
      contacts: aircraftNearCoord ? (aircraftNearCoord(cx, cy) || []) : [] });
  }
  svcTick(player, was);

  // ⚠ THE ROW IS FLUSHED ON A CLOCK OF ITS OWN, AND IT IS A SLOW ONE. Four writes a second per
  // driver is a hot path in the sense the persistence tiers mean; what actually has to survive is
  // the hull and the tank, and those change slowly enough that ten seconds loses nothing anybody
  // could notice. A wreck and a disembark both flush immediately, so the only thing this cadence
  // can cost is a few seconds of fuel on a hard crash.
  if (Date.now() - (was.flushed || 0) > FLUSH_MS) await flushRig(was);
  return null;
}

const FLUSH_MS = 10_000;

/** The RAM record, built from the row the first time a sync arrives. */
async function seedRig(player, boatId) {
  const r = await query('SELECT * FROM boats WHERE id = $1', [boatId]);
  const b = r.rows[0];
  if (!b) return null;
  const rig = {
    playerId: player.id, boatId: b.id, typeId: b.type_id || 'hydro',
    name: b.name || 'boat', livery: b.custom_data?.livery || null,
    topSpeed: 138,
    hull: clamp01(b.condition), fuel: clamp01(b.fuel), nitro: clamp01(b.custom_data?.nitro ?? 1),
    x: null, y: null, heading: Number(b.heading) || 0, speed: 0,
    pedal: 0, rich: 0, bang: 0, roll: 0, pitch: 0, nitroOn: false,
    flushed: Date.now(),
  };
  rigs.set(player.id, rig);
  return rig;
}

/** Hull, tank and bottle back to the row. The bottle rides `custom_data`, having no column. */
export async function flushRig(rig) {
  if (!rig || !rig.boatId) return;
  rig.flushed = Date.now();
  const run = rig.run || 0;
  rig.run = 0;
  await query(
    `UPDATE boats SET condition = $2, fuel = $3,
       custom_data = jsonb_set(jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{nitro}', to_jsonb($4::real)),
         '{run}', to_jsonb(COALESCE((custom_data->>'run')::real, 0) + $5::real), true)
     WHERE id = $1`,
    [rig.boatId, rig.hull, rig.fuel, rig.nitro, run]);
}

// ── `boatevent` ──────────────────────────────────────────────────────────────
//
// The three things the model reports that the server has to do something about. ⚠ THE PLUGIN
// SPENDS AND THE MODEL ONLY REPORTS — `stepBoat`'s own note — so `holed` is routed to the action
// that owns the consequence rather than being handled here.
export async function cmdBoatEvent(args = [], raw, player) {
  const boat = await myBoat(player);
  if (!boat) return null;
  const what = String(args[0] || '').toLowerCase();
  if (what === 'holed') {
    // Dispatched BY NAME so this file does not import the wreck, exactly as demolition reaches the
    // crime it charges.
    // ⚠ `dispatchAction` TAKES ONE OBJECT, NOT (type, payload). Called as two arguments the
    // destructure reads `type` off a STRING, comes back undefined and the registry answers
    // "Unknown action: undefined" — so the hull reaches zero, the client says so, and NOTHING
    // HAPPENS: no wreck, no injuries, and the row stays in your fleet at zero condition pretending
    // to be a boat. It returns an error object rather than throwing, which is why it is silent.
    //
    // ⚠ AND THE HANDLER READS `params`, not the top level. It wants the speed to size the wreck by
    // and the id to delete the row — both of which live in the RAM registry rather than on the row,
    // because a position and a speed are per-tick state.
    const { dispatchAction } = await import('../../server/engine/actions.js');
    const rig = rigs.get(player.id);
    return await dispatchAction({
      type: 'BOAT_BREAKUP',
      actor: player,
      params: {
        boatId: boat.id,
        boatName: boat.name || 'the boat',
        speed: rig?.speed ?? 0,
        topSpeed: rig?.topSpeed ?? 138,
      },
    });
  }
  // ⚠ THE PROP PAYS FOR BOTH (service.js), and the seat is told what she now handles like.
  if (what === 'aground' || what === 'slam') {
    const knock = PROP_KNOCK[what];
    const r = await query(
      `UPDATE boats SET custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{prop}',
         to_jsonb(GREATEST(0, COALESCE((custom_data->>'prop')::real, 1) - $2::real)), true)
       WHERE id = $1 RETURNING custom_data`, [boat.id, knock]).catch(() => null);
    const cd = r?.rows?.[0]?.custom_data;
    if (cd) sendToPlayer(player.id, { type: 'boat_ctx', params: effBoatParams(boat.type_id, cd) });
  }
  if (what === 'aground') return { type: 'emote', message: 'You feel the bottom come up and take the way off her. Something in the prop does not sound right.' };
  if (what === 'slam') return { type: 'emote', message: 'She comes off the back of it flat and the whole hull rings.' };
  // ── THE KEY, AND WHAT THE ROOM HEARS OF IT ─────────────────────────────────
  //
  // ⚠ THE ENGINE IS THE CLIENT'S AND THE NOISE IT MAKES IS EVERYBODY'S. `running` is sim state and
  // stays in the panel — the whole arrangement of this plugin is that the client integrates and
  // the server keeps the row — but a blown V8 starting up beside a pontoon is a thing the people
  // standing on it can hear, and nothing else in the system would ever tell them.
  if (what === 'started') return { type: 'emote', message: 'She turns over twice and catches, and the whole shed fills with it.' };
  if (what === 'stopped') return { type: 'emote', message: 'You shut her down. The silence afterwards is startling.' };
  // ⚠ AND `learned` WRITES A FLAG AND SAYS NOTHING. The first-time card is a client surface; this
  // is only the record that it has been seen, so it fires once per character and never again —
  // localStorage would have lost it on another machine and re-taught somebody who has owned a boat
  // for a month.
  if (what === 'learned') { await setFlag('player', HELM_TAUGHT, 1, player); return null; }
  return null;
}

export const _test = { berthGrid, helmContext, RADIUS };
