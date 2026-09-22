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
import { aboard } from './yard.js';
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
  const id = aboard.get(player.id);
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
  // An interior berth (the covered dock) has no grid of its own — it is a room inside a building —
  // so the window centres on the building's own tile, which is what `parent_zone` is for.
  const g = (z.grid_x || z.grid_y) ? z : getZone(z.parent_zone) || z;
  return { x: g.grid_x || 0, y: g.grid_y || 0 };
}

// ── THE PAYLOAD ──────────────────────────────────────────────────────────────
export function helmContext(boat, at) {
  const sky = skyState(at.x, at.y) || {};
  return {
    type: 'boat_ctx',
    name: boat.name || 'her',
    gx: at.x, gy: at.y,
    map: mapWindow({ grid_x: at.x, grid_y: at.y }, RADIUS),
    heading: Number(boat.custom_data?.heading) || 0,
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
  if (!boat) return { type: 'error', message: 'You are not aboard anything.' };
  const at = berthGrid(boat);
  if (!at) return { type: 'error', message: 'She is not berthed anywhere you could get under way from.' };
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
      + `<span class="text-red">₵${owed.toLocaleString()}</span> outstanding on the recovery — <b>tow</b> settles it.` };
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
  return { type: 'emote', message: 'You settle into the seat and put your hand on the lever.' };
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
  const id = aboard.get(player.id);
  if (!id) return null;                                    // silent: the pane can outlive the seat
  const n = args.map(Number);
  if (n.length < 13 || n.some((v) => !Number.isFinite(v))) return null;
  const [x, y, heading, speed, hull, nitro, fuel, pedal, roll, pitch, rich, bang, flags] = n;

  const was = rigs.get(player.id) || await seedRig(player, id);
  if (!was) return null;
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
  await query(
    `UPDATE boats SET condition = $2, fuel = $3,
       custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{nitro}', to_jsonb($4::real))
     WHERE id = $1`,
    [rig.boatId, rig.hull, rig.fuel, rig.nitro]);
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
  if (what === 'aground') return { type: 'emote', message: 'You feel the bottom come up and take the way off her.' };
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
