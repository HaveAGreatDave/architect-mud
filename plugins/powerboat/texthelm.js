// THE BASIN, BY TEXT.
//
// The accessibility half of the seat, and the rung that decides whether this system exists at all
// for a player who is not looking at a 3-D canvas. The helm is a surface you ACT through — delete
// it and you are not reading less, you are STUCK, because there is no other way to move a boat —
// so per docs/systems-display-mode.md it sits on the `prefersTextMinigames` axis and needs a real
// way to make the passage rather than a shorter description of somebody else making it.
//
// The pattern is `textdrive.js`'s, and so is the principle that makes it cheap: `flight-model.js`
// is a pure, DOM-free module, so `stepBoat` runs here exactly as it runs in the browser. THERE IS
// NO SECOND PHYSICS, and the moment there is, the two rungs are two games.
//
// ── ⚠ A BOAT IS CONNED, NOT STEERED, AND THAT IS WHY THIS IS NOT THE TRUCK'S ─
//
// The text truck DRIVES ITSELF, because a truck's route is the road and hand-steering a corridor by
// typed command would be busywork dressed as agency. Open water is the opposite case: there is no
// route, so the bearing IS the decision, and a text helm that picked its own would be deciding the
// only interesting thing in the system. So this takes helm and engine ORDERS — the real vocabulary,
// which is a bearing and a bell — and runs the hull between them.
//
// ── ⚠ ONE VERB, BECAUSE EVERY GOOD WORD IS TAKEN ────────────────────────────
//
// `throttle` is flight's, `stop` is the wheelhouse's, `steer`, `ahead` and `astern` are each one
// plugin away from being somebody's. A plugin verb silently beats an engine builtin, so a
// collision here is not a load error — it is two systems quietly ceasing to work, which is the
// trap `refit`'s own note in this plugin records. `conn` is one word, it is the correct one (to
// conn a vessel is to direct her helm), and every order is a subcommand of it.
//
// ── ⚠ AND IT FILLS THE SAME REGISTRY THE PANEL DOES ─────────────────────────
//
// `rigs` is what `vehicle.contacts` publishes. A text driver who did not appear in it would be a
// boat nobody can see, hear or collide with — invisible to every pilot and every other driver on
// the Basin, with nothing anywhere saying so. Both rungs write the same record.

import { schedule } from '../../server/engine/scheduler.js';
import { getZone, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { stepBoat, TYPES } from '../../client/game/js/panels/flight-model.js';
import { surfaceAt } from '../flight/state.js';
import { aboard } from './yard.js';
import { rigs } from './index.js';

const TICK = '1s';
// The bells, as fractions of the lever. ⚠ NOT EVENLY SPACED, because a bell is not a percentage.
//
// ⚠ AND THE GAP BETWEEN SLOW AND HALF IS THE HUMP, WHICH IS THE BOAT RATHER THAN A BADLY CHOSEN
// TABLE. Measured, the lever settles at 9.4 / 91.7 / 118.3 / 134.2 mph on these four, and the
// reason there is nothing between ten and ninety is that there is nothing between them to have: at
// 0.40 she settles at 33 mph still pushing her own bow wave and at 0.45 she is planing at 84. A
// fifth bell in that band would be an order you cannot hold.
const BELLS = { stop: 0, slow: 0.22, half: 0.52, full: 0.80, flank: 1 };
const BELL_WORDS = Object.keys(BELLS);

/** Everyone conning by text. Keyed on player id, exactly as `aboard` and `rigs` are. */
export const conning = new Map();

const D2R = Math.PI / 180;
const norm = (d) => ((d % 360) + 360) % 360;

// ── STARTING AND STOPPING ────────────────────────────────────────────────────

export function isConning(playerId) { return conning.has(playerId); }

export async function startTextHelm(player, boat, at) {
  if (conning.has(player.id)) return true;
  const p = TYPES[boat.type_id] || TYPES.hydro;
  conning.set(player.id, {
    playerId: player.id, boatId: boat.id, name: boat.name || 'her', p,
    // The sim state, seeded from the row exactly as the panel seeds it.
    s: {
      x: at.x, y: at.y, heading: Number(boat.custom_data?.heading) || 0,
      speed: 0, drift: 0, pedal: 0, hull: clamp01(boat.condition),
      nitro: clamp01(boat.custom_data?.nitro ?? 1), nitroHeat: 0,
      vs: 0, z: 0, airborne: false, pitch: 0, roll: 0, clock: 0,
      // ⚠ SHE COMES UP DEAD HERE TOO, AND THAT IS THE RUNG RULE RATHER THAN A COPIED LINE. The two
      // rungs are two ways to make the SAME passage; a boat that needs a key on the panel and
      // starts herself in the log is not a second presentation of one boat, it is two boats.
      running: false, crank: 0,
    },
    fuel: clamp01(boat.fuel),
    want: { bearing: Number(boat.custom_data?.heading) || 0, bell: 'stop', bottle: false, trim: 0 },
    last: Date.now(), said: {}, sinceSay: 0,
  });
  sendToPlayer(player.id, { type: 'message',
    message: `<span class="text-green">You take the helm of ${boat.name || 'her'}. `
      + `Orders: <b>conn 270</b> for a bearing, <b>conn full</b> for a bell (${BELL_WORDS.join('/')}), `
      + `<b>conn tabs up/down/flat</b>, <b>conn bottle</b>, <b>conn moor</b> to tie up. `
      + `She is cold — <b>conn start</b> first.</span>` });
  return true;
}

/**
 * End a text helm AND get her state into the row.
 *
 * ⚠ THE ONE TO CALL FROM ANYWHERE THAT ENDS A PASSAGE, because `stopTextHelm` alone drops the
 * hull, the tank and the bottle on the floor: the tick flushes on a slow clock, so up to ten
 * seconds of a run can be in RAM and nowhere else when somebody climbs out. Logout, death and
 * disembark all come through here.
 */
export async function endTextHelm(playerId) {
  const c = conning.get(playerId);
  if (!c) return false;
  await flush(c).catch(() => {});
  stopTextHelm(playerId);
  return true;
}

export function stopTextHelm(playerId) {
  const c = conning.get(playerId);
  conning.delete(playerId);
  rigs.delete(playerId);
  return c;
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v ?? 1)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * How much rudder to ask for, given how far off the ordered bearing she is.
 *
 * ⚠ A NAMED FUNCTION SO THE GATE TESTS THE REAL ONE. Inline in the tick, the only way to assert
 * that she settles rather than weaves would be to write the gain down a second time in regress.js
 * — and a test that reimplements its subject passes whatever the subject does. See the note at the
 * call site for why the divisor is the hull's own lock times the tick.
 */
export function steerFor(err, p, dt) {
  return clamp(err / Math.max(6, (p?.turnLock ?? 34) * dt), -1, 1);
}

// ── THE ORDER ────────────────────────────────────────────────────────────────

// ⚠ `(args, raw, player)` — the engine's signature. See the note on `cmdHelm`.
export async function cmdConn(args = [], raw, player) {
  const c = conning.get(player.id);
  if (!c) {
    return { type: 'error', message: aboard.has(player.id)
      ? 'You are aboard but not at the helm. `helm` takes her.'
      : 'You are not conning anything.' };
  }
  const word = String(args[0] || '').toLowerCase();
  if (!word) return { type: 'emote', message: statusLine(c) };

  if (word === 'moor' || word === 'tie') return await moor(player, c);
  // ── THE KEY ────────────────────────────────────────────────────────────────
  //
  // ⚠ IT IS `start` AND `kill`, AND `stop` IS NOT AVAILABLE FOR IT. `stop` is already the bottom
  // BELL on this helm — ring off, lever to the stop — and two meanings for one order on the one
  // surface where every order is typed is the collision this plugin's own README records against
  // `helm`, `fuel` and `refit`. A helmsman rings STOP and kills the engines; they are not the same
  // instruction and never have been.
  if (word === 'start') {
    if (c.s.running) return { type: 'error', message: 'She is already running.' };
    if (c.fuel <= 0) return { type: 'error', message: 'She turns over and never catches. The tank is dry.' };
    // ⚠ HELD BY THE TICK RATHER THAN BY A FINGER, which is the same answer the tabs note above
    // gives: a typed order cannot be held down, so the order arms the starter and the tick turns
    // her over until she catches. One model, two ways of holding the key.
    c.starting = true;
    return { type: 'emote', message: 'You turn the key. She churns.' };
  }
  if (word === 'kill' || word === 'shutdown') {
    if (!c.s.running) return { type: 'error', message: 'She is already dead.' };
    c.s.running = false; c.starting = false; c.want.bell = 'stop'; c.want.bottle = false;
    return { type: 'emote', message: 'You shut her down. The silence afterwards is startling.' };
  }
  if (word === 'bottle' || word === 'nitro') {
    if (c.s.nitro <= 0) return { type: 'error', message: 'The bottle is empty.' };
    c.want.bottle = !c.want.bottle;
    return { type: 'emote', message: c.want.bottle
      ? 'You put your thumb on the button. She squats and goes.'
      : 'You come off the button.' };
  }
  // ⚠ THE TABS ARE A NOTCH HERE AND A HELD ROCKER ON THE PANEL, and that is the rung difference
  // done properly rather than a second control: the panel's is continuous because a thumb is, and
  // a typed order cannot be held, so this moves her a notch per order over the SAME -1..1 range the
  // model reads. Both end up handing `stepBoat` one number.
  if (word === 'tabs' || word === 'trim') {
    const dir = String(args[1] || '').toLowerCase();
    if (dir === 'flat' || dir === 'level') c.want.trim = 0;
    else if (dir === 'up' || dir === 'out') c.want.trim = clamp(c.want.trim + 0.25, -1, 1);
    else if (dir === 'down' || dir === 'in') c.want.trim = clamp(c.want.trim - 0.25, -1, 1);
    else return { type: 'error', message: 'Tabs up, down or flat.' };
    return { type: 'emote', message: trimWord(c.want.trim) };
  }
  if (word in BELLS) {
    // ⚠ AN ORDER SHE CANNOT OBEY IS REFUSED RATHER THAN ACCEPTED AND IGNORED, which is this file's
    // own rule about a bearing two branches down: the model cuts the lever on a dead motor, so a
    // bell accepted here would be a helm that says "you ring for full" over a boat that does not
    // move — and there would be nothing anywhere to say why.
    if (!c.s.running && word !== 'stop') {
      return { type: 'error', message: 'Nothing happens. She is not running — <b>conn start</b>.' };
    }
    c.want.bell = word;
    return { type: 'emote', message: word === 'stop'
      ? 'You pull the lever back to the stop. The blower drops to a mutter.'
      : `You ring for <b>${word}</b>.` };
  }
  // ⚠ A BEARING IS A NUMBER AND EVERY OTHER WORD IS AN ERROR, never a silent no-op: an order that
  // is quietly ignored on open water is the one thing a helm may not do.
  const deg = Number(word);
  if (Number.isFinite(deg)) {
    c.want.bearing = norm(deg);
    return { type: 'emote', message: `You come round onto <b>${Math.round(c.want.bearing)}°</b>.` };
  }
  return { type: 'error', message: `No such order. A bearing (0-359), a bell (${BELL_WORDS.join('/')}), start, kill, tabs, bottle, or moor.` };
}

/** Which way the tabs are set, in the words a helm would use rather than as a percentage. */
function trimWord(t) {
  if (Math.abs(t) < 0.08) return 'Flat';
  const hard = Math.abs(t) > 0.6 ? 'Hard ' : '';
  return hard + (t > 0 ? 'bow up' : 'bow down');
}

function statusLine(c) {
  const s = c.s;
  // ⚠ A DEAD MOTOR REPLACES THE BELL RATHER THAN SITTING BESIDE IT, the panel's own rule: "0 mph on
  // stop" is what a running boat at the pontoon says too, and the one question somebody staring at
  // a stationary hull is asking is whether she is alive.
  const drive = s.running === false
    ? (c.starting ? '<b>cranking…</b>' : '<b class="text-red">engine off</b> — conn start')
    : `${Math.round(s.speed)} mph on <b>${c.want.bell}</b>`;
  return `<b>${c.name}</b> — heading ${Math.round(norm(s.heading))}°, ordered ${Math.round(c.want.bearing)}°, `
    + drive + '. '
    + `Tabs ${trimWord(c.want.trim).toLowerCase()}. `
    + `Hull ${Math.round(s.hull * 100)}%, fuel ${Math.round(c.fuel * 100)}%, bottle ${Math.round(s.nitro * 100)}%.`;
}

// ── TYING UP ─────────────────────────────────────────────────────────────────
//
// ⚠ THE SAME ROW THE PANEL WRITES AND THE SAME BERTH THE YARD KNOWS ABOUT. A text passage that
// ended by inventing its own mooring would put a hull somewhere `berthsNear` cannot find it, which
// is a boat you own and cannot reach.
async function moor(player, c) {
  const z = surfaceAt(Math.round(c.s.x), Math.round(c.s.y));
  if (Math.abs(c.s.speed) > 6) return { type: 'error', message: 'Too much way on. Ring for stop first.' };
  const zone = z && z.zoneId ? getZone(z.zoneId) : null;
  const f = zone?.flags || {};
  const berth = f.marina_berths || f.boat_covered || f.boat_hardstanding;
  if (!berth) return { type: 'error', message: 'Nothing to tie up to here.' };
  await flush(c, zone.id);
  stopTextHelm(player.id);
  return { type: 'emote', message: `You bring her alongside and make fast. ${statusFuel(c)}` };
}
const statusFuel = (c) => `Hull ${Math.round(c.s.hull * 100)}%, fuel ${Math.round(c.fuel * 100)}%.`;

async function flush(c, berthZone = null) {
  const sets = ['condition = $2', 'fuel = $3',
    "custom_data = jsonb_set(jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{nitro}', to_jsonb($4::real)), '{heading}', to_jsonb($5::real))"];
  const vals = [c.boatId, c.s.hull, c.fuel, c.s.nitro, norm(c.s.heading)];
  if (berthZone) { sets.push('berth_zone = $6'); vals.push(berthZone); }
  await query(`UPDATE boats SET ${sets.join(', ')} WHERE id = $1`, vals);
}

// ── THE TICK ─────────────────────────────────────────────────────────────────
//
// ⚠ THE RATE IS THE ONE THING THAT DIFFERS FROM THE PANEL, AND IT IS NOT A SECOND MODEL. The panel
// steps at the frame rate; this steps once a second with the real elapsed dt, and `stepBoat` is an
// integrator, so the same orders produce the same passage to within the step. What it must not do
// is step with a dt it did not measure, or a lagging server would sail the boat further than the
// clock says.
async function tick() {
  if (!conning.size) return;
  const now = Date.now();
  for (const [pid, c] of [...conning]) {
    const live = getLivePlayer(pid);
    // ⚠ A BODY THAT LEFT THE GAME LEAVES THE HELM, the same rule `aboard` follows — otherwise the
    // tick sails an unattended hull across the Basin for ever.
    if (!live) { await flush(c).catch(() => {}); stopTextHelm(pid); continue; }

    const dt = Math.min(5, Math.max(0.05, (now - c.last) / 1000));
    c.last = now;

    // The order, as an input. ⚠ THE RUDDER IS DERIVED FROM THE ERROR AND CLAMPED, which is what
    // makes this a helmsman rather than a teleport: she comes round at the rate the hull allows,
    // and a hard order at speed is a slide, exactly as it is in the panel.
    const err = ((norm(c.want.bearing) - norm(c.s.heading) + 540) % 360) - 180;
    const cell = surfaceAt(Math.round(c.s.x), Math.round(c.s.y));
    const wet = cell && (cell.biome === 'water' || cell.sub);
    // ⚠ THE GAIN IS THE HULL'S OWN LOCK TIMES THE TICK, AND A CONSTANT MADE HER WEAVE. At `err / 25`
    // she settled cleanly on every bell except SLOW, where she crossed her ordered bearing nineteen
    // times in two minutes — and that is not a tuning problem, it is discrete time: rudder authority
    // FALLS with speed (`turnFade`), so at ten knots the lock is near its maximum ~30°/s while the
    // tick is a whole second, and a controller asking for full rudder at 25° of error commands more
    // turn than the error in one step. Divided by what she can actually swing in a tick it is
    // deadbeat at every bell — measured 0 overshoots on all four, settling in 5/7/10/12 s against
    // the hot gain's 5/6/8/10.
    //
    // ⚠ IT READS `turnLock` AND DOES NOT RE-DERIVE THE FADE. Computing the live authority here
    // would be a second copy of the steering model, which is the one thing this rung may not have —
    // the type's own worst-case lock is a parameter, and using it is conservative by construction.
    const input = {
      throttle: BELLS[c.want.bell] ?? 0,
      steer: steerFor(err, c.p, dt),
      nitro: c.want.bottle && c.s.nitro > 0,
      trim: c.want.trim,
      surface: wet ? 'open' : 'land',
      aground: !wet,
      // The key, held by the tick. See the note on `conn start`.
      starter: !!c.starting,
      fuel: c.fuel,
      now,
    };
    if (c.fuel <= 0) { input.throttle = 0; c.want.bell = 'stop'; }
    // ⚠ AND A DEAD MOTOR BURNS NOTHING HERE EITHER — the base figure is the IDLE burn, so left
    // unconditional a hull left conned but shut down would drink her tank dry sitting still.
    else if (c.s.running) c.fuel = Math.max(0, c.fuel - (0.00042 + 0.0035 * c.s.pedal) * dt);
    if (c.s.nitro <= 0) c.want.bottle = false;

    stepBoat(c.s, input, c.p, dt);
    // ⚠ THE STARTER LETS GO ON AN ANSWER EITHER WAY, the panel's own click-crank rule: a dry motor
    // never catches, so a flag cleared only on success would leave the starter engaged for the
    // rest of the passage and quietly burn nothing while reporting nothing.
    if (c.starting && (c.s.running || (c.s.events || []).includes('dry'))) c.starting = false;

    // ⚠ THE SAME RECORD THE PANEL FILLS. See the header: a text driver missing from `rigs` is a
    // boat that does not exist to anybody else on the water.
    rigs.set(pid, Object.assign(rigs.get(pid) || {}, {
      playerId: pid, boatId: c.boatId, typeId: c.p.id || 'hydro', name: c.name,
      topSpeed: c.p.topSpeed || 138,
      x: c.s.x, y: c.s.y, heading: norm(c.s.heading), speed: Math.abs(c.s.speed),
      pedal: c.s.pedal, rich: c.s.rich || 0, bang: c.s.bang || 0,
      roll: c.s.roll || 0, pitch: c.s.pitch || 0, nitroOn: !!c.s.nitroOn,
      hull: c.s.hull, fuel: c.fuel, nitro: c.s.nitro,
    }));

    await narrate(live, c, dt);
  }
}

// ── WHAT YOU HEAR ────────────────────────────────────────────────────────────
//
// ⚠ EVENTS ALWAYS, THE RUNNING LINE RARELY. The model's own `events` are the things that HAPPEN —
// a landing, a slam, the bottom coming up — and every one of them reaches the log the moment it
// fires, because that is the record this rung exists to be. The cruising readout is on a much
// longer clock and is suppressed while nothing is changing, because a line a second is not a
// passage, it is a wall of text with a boat somewhere in it.
async function narrate(live, c, dt) {
  const say = (m) => sendToPlayer(c.playerId, { type: 'message', message: m });
  for (const ev of c.s.events || []) {
    if (ev === 'started') say('<span class="text-green">She catches, and the whole hull starts shaking.</span>');
    else if (ev === 'dry') say('<span class="text-red">She turns over and turns over and never catches. The tank is dry.</span>');
    else if (ev === 'aground') say('<span class="text-red">The bottom comes up and takes the way off her. That will have cost you.</span>');
    else if (ev === 'slam') say('<span class="text-yellow">She comes off the back of it flat and the whole hull rings.</span>');
    else if (ev === 'land') say('She drops off the face and finds the water again.');
    else if (ev === 'nitroheat') say('<span class="text-red">The bottle is cooking. Something under the hatch is not enjoying this.</span>');
    else if (ev === 'holed') {
      say('<span class="text-red">Something lets go under your feet.</span>');
      const { dispatchAction } = await import('../../server/engine/actions.js');
      // ⚠ ONE OBJECT, AND THE NUMBERS GO IN `params` — see the same note in helm.js. Called as two
      // arguments it answers "Unknown action: undefined" and returns it rather than throwing, so
      // the hull reaches zero, the line prints and nothing whatever happens.
      //
      // ⚠ AND THE SPEED IS TAKEN BEFORE THE HELM IS TORN DOWN. `stopTextHelm` drops the record, so
      // reading it afterwards sizes every wreck at zero — which is the gentlest possible one, on
      // the one event that is supposed to hurt.
      const speed = Math.abs(c.s.speed), topSpeed = c.p.topSpeed || 138;
      stopTextHelm(c.playerId);
      await dispatchAction({
        type: 'BOAT_BREAKUP',
        actor: live,
        params: { boatId: c.boatId, boatName: c.name, speed, topSpeed },
      });
      return;
    }
  }
  // Fuel and hull get a warning each, once, on the way down — a state you can act on rather than a
  // number you have to keep asking for.
  if (c.fuel < 0.12 && !c.said.fuel) { c.said.fuel = 1; say('<span class="text-yellow">The tank is nearly out.</span>'); }
  // ⚠ RUNNING DRY USED TO BE SILENT, WHICH IS THE WORST SHAPE A STRANDING CAN HAVE. The tick
  // clamped the throttle to zero and said nothing, so an order to go faster produced a boat that
  // slowly stopped and a helm that went on answering as though everything were fine. Said once,
  // with both ways out in it — the float if you can still reach it, the launch if you cannot.
  if (c.fuel <= 0 && !c.said.dry) {
    c.said.dry = 1;
    say('<span class="text-red">The blower leans out, catches once and stops. She is dry.</span> '
      + '<span class="text-dim">You can go over the side and swim for it (<b>disembark</b>), or wait for somebody to come out (<b>tow</b>).</span>');
  }
  if (c.s.hull < 0.30 && !c.said.hull) { c.said.hull = 1; say('<span class="text-red">She is taking water. Get her in.</span>'); }

  c.sinceSay += dt;
  const moving = Math.abs(c.s.speed) > 1;
  if (c.sinceSay >= (moving ? 8 : 30)) { c.sinceSay = 0; say(statusLine(c)); }
}

// ⚠ IDLE-GATED BY `schedule` ITSELF — see scheduler.js, which skips a callback when nobody is on.
// The guard at the top of `tick` is the second half of that: no helms, no work, so this costs
// nothing at all on a server where nobody is afloat.
schedule(TICK, () => tick().catch((e) => console.error('[powerboat] text helm tick error:', e.message)));

export const _test = { BELLS, statusLine, trimWord, steerFor, conning, tick };
