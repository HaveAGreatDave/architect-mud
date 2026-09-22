// BOAT AUDIO — a blown V8 on open pipes, yours and everybody else's.
//
// Two things live here: the OWN SHIP's motor, one persistent node graph ramped from the sim state,
// and a small pool of PASS-BY voices for the other hulls already arriving in the contact feed —
// each with its own doppler, its own pan and its own distance filter, so a boat crossing your bow
// bends as it goes by.
//
// ── ⚠ WHY THIS IS NOT ONE MORE `FE_VOICE` ROW ───────────────────────────────
//
// It should have been, and the truck proves it: `engine-audio.js` carries twelve layers whose own
// header makes the point that they "were never aircraft-specific — only their numbers were", and
// THE LONG HAUL's diesel is a single line in `FE_VOICE`. Two things in that graph say no here, and
// both are structural rather than a matter of taste.
//
//   `_fe` IS A SINGLETON. One `let _fe = null`, one master, one create and one stop. That is
//     exactly right for a cockpit, where there is one engine and you are sitting in it — and a
//     pass-by needs N graphs at once, each at its own pitch, pan and distance.
//   A V8 ON OPEN ZOOMIES IS NOT A DRONE. Every layer in that file is a CONTINUOUS parameter ramped
//     toward a target; the one discrete event it has (layer 12, the throttle-chop backfire) fires
//     once, on a threshold. What makes this motor recognisable is that it is a stream of separate
//     BANGS whose rate and violence are the thing that varies — which is a scheduler, not a ramp,
//     and adding one to a graph eight aircraft and four trucks share to reach one boat is a worse
//     trade than a second instrument.
//
// So the drone half here is deliberately the SAME SHAPE as that file's (a core, a detuned twin, a
// sub, an FM bite, an air layer, a chopped-noise crackle, a master tone filter and a doppler scalar
// on every oscillator base), because that shape is right and copying it is cheaper than inventing a
// worse one — and the bark on top is the part that could not have lived there.
//
// ── ⚠ EVERY FREQUENCY IS DERIVED FROM THE ENGINE, NOT PICKED ────────────────
//
// A four-stroke V8 fires four times per crank revolution, so its exhaust note is `rpm / 15` Hz and
// nothing else: 57 Hz at an 850 idle, 480 Hz at 7,200. That single line is why this reads as a
// motor rather than as a synthesiser sweep, and it is why the blower and the sub fall out for free
// (a Roots blower is a fixed multiple of crank speed; the sub is the crank order itself, half the
// firing rate). Written as a hand-chosen span it would be a tone that happens to rise, and every
// retune afterwards would be somebody's ear against somebody else's.
//
// ── ⚠ AND THE ENRICHMENT IS THE SIM'S, NOT A SECOND DERIVATIVE ──────────────
//
// `stepBoat` publishes `rich` (the lever ahead of the blower) and `bang` (the blower ahead of the
// lever, at revs) because it is the only party with a dt. Taking the difference between two frames
// here would give a number that depends on the frame rate and would disagree with the FLAME the
// renderer draws off the same two fields — you would see fire and hear nothing, or the reverse.
// One derivation, two consumers.

const AE = () => globalThis.AudioEngine;

const c01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
// ⚠ NaN-SAFE, and for sea-audio.js's reason rather than for tidiness: every number below is on its
// way to an AudioParam, which rejects a non-finite value by THROWING, mid-frame, out of whatever
// was ramping it. Written `Math.max(lo, Math.min(hi, v))` a NaN sails through; written this way it
// lands on the low bound and the boat goes quiet instead of taking the audio thread with it.
const clamp = (v, lo, hi) => (v > lo ? (v < hi ? v : hi) : lo);
const rnd = (a, b) => a + Math.random() * (b - a);

// ── THE MOTOR, AS NUMBERS ────────────────────────────────────────────────────
//
// `stepBoat` reports rpm as a 0..1 fraction with its own idle as the floor, which is the right
// shape for a gauge and says nothing an oscillator can use. These two put it back in crank
// revolutions so the derivations above mean what they say.
export const RPM_IDLE = 850;
export const RPM_MAX = 7200;
const FIRES_PER_REV = 4;                       // eight cylinders, one power stroke every two revs
export const BLOWER_RATIO = 1.22;              // overdriven off the crank, which is what makes it scream
const BLOWER_LOBES = 3;                        // a Roots rotor: three lobes, so three pulses a turn
// ⚠ AND THE PULSE RATE IS NOT THE NOTE YOU HEAR, which cost a silent blower. Three lobes at 1.22:1
// is 3.66 pulses a revolution against the motor's own four, so the rotor's FUNDAMENTAL is very
// slightly BELOW the exhaust note — and a supercharger emphatically does not sound like that. What
// carries a Roots case is its upper harmonics coming through thin alloy, which is why the thing is
// a shriek sitting on top of a motor rather than a hum buried inside one. The first cut put the
// carrier on the fundamental and its bandpass at 3.5 kHz, which is a filter listening several
// octaves above anything the oscillator was producing: correct, wired, tuned, and inaudible.
const BLOWER_HARM = 6;

export const crankRpm = (rpm01) => RPM_IDLE + (RPM_MAX - RPM_IDLE) * c01(rpm01);
export const firingHz = (rpm01) => crankRpm(rpm01) * FIRES_PER_REV / 60;
export const blowerHz = (rpm01) => crankRpm(rpm01) * BLOWER_RATIO * BLOWER_LOBES / 60;   // the rotor pulse
export const blowerToneHz = (rpm01) => blowerHz(rpm01) * BLOWER_HARM;                    // what reaches you

// How far apart two boats have to be before one stops being worth a voice, and the speed the
// doppler is solved against.
//
// ⚠ THE SPEED OF SOUND HERE IS A LIE, DELIBERATELY, AND cockpit.js TELLS THE SAME ONE. Real sound
// is about 767 mph; against a hull whose ceiling is 138 that is a head-on shift of 1.22 — a real
// number, and about three semitones, which is less than the ear reads as a pass-by. 430 puts a
// flat-out crossing at roughly a fourth, which is what everybody thinks a pass-by sounds like. The
// clamp is what stops two boats closing head-on from sounding like a kettle.
const DOPPLER_MPH = 430;
const DOPPLER_LO = 0.74, DOPPLER_HI = 1.34;
const HEAR_TILES = 22;                         // past this a contact gets no voice at all
const MAX_VOICES = 3;                          // nearest first — a basin full of boats is not a choir

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  ONE MOTOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Built against the documented `engineNodes()` seam and nothing else, so the whole of AudioEngine
// can be a three-line stand-in in a gate — sea-audio.js's arrangement, for the same reason.
function makeV8(ctx, bus, noise, { pan = false } = {}) {
  const now = ctx.currentTime, src = [];
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; src.push(o); return o; };
  const nz = () => { const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true; src.push(n); return n; };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q ?? 1; return b; };

  const master = gain(0);
  const tone = filt('lowpass', 7000, 0.7);
  // ⚠ THE PANNER IS OPTIONAL AND THE OWN SHIP DOES NOT GET ONE. Your own motor is behind you
  // wherever you look; panning it would swing the boat you are sitting in around your head every
  // time the orbit camera moved.
  const panner = pan ? ctx.createStereoPanner() : null;
  if (panner) master.connect(tone).connect(panner).connect(bus);
  else master.connect(tone).connect(bus);

  // 1. THE FIRING TONE. A sawtooth at rpm/15 through a resonant lowpass — the exhaust note itself,
  //    and the one layer that carries the whole read.
  const core = osc('sawtooth', firingHz(0)), coreLP = filt('lowpass', 300, 3.2), coreG = gain(0.10);
  core.connect(coreLP).connect(coreG).connect(master);

  // 2. THE OTHER BANK. ⚠ NOT A "FATTENING" DETUNE. A cross-plane V8 fires its two banks unevenly —
  //    that uneven spacing IS the burble, and it is the whole difference between this and a
  //    flat-plane engine, which screams instead. Two saws a whisker apart beat against each other
  //    at the difference frequency, which is that lope.
  const bankB = osc('sawtooth', firingHz(0) * 1.019); bankB.connect(coreLP);

  // 3. THE CRANK ORDER — half the firing rate, which is the thump you feel rather than hear.
  const sub = osc('sine', firingHz(0) / 2), subG = gain(0.05);
  sub.connect(subG).connect(master);

  // 4. THE BLOWER. FM, because a Roots case is a siren and a plain oscillator is a flute: the
  //    modulation index opening with boost is what turns a hum into a shriek.
  const blowCar = osc('sine', blowerToneHz(0)), blowMod = osc('sine', 140), blowModG = gain(30);
  blowMod.connect(blowModG).connect(blowCar.frequency);
  const blowBP = filt('bandpass', 1800, 2.6), blowG = gain(0);
  blowCar.connect(blowBP).connect(blowG).connect(master);

  // 5. THE HAT SWALLOWING AIR — broadband through a resonant band that climbs with revs.
  const airBP = filt('bandpass', 900, 1.1), airG = gain(0);
  nz().connect(airBP).connect(airG).connect(master);

  // 6. THE CRACKLE BED — noise chopped by a sawtooth at the firing rate. This is the continuous
  //    raggedness under everything; the discrete pops are layer 7.
  const crBP = filt('bandpass', 700, 1.3), crTrem = gain(0.5), crG = gain(0);
  nz().connect(crBP).connect(crTrem).connect(crG).connect(master);
  const crLFO = osc('sawtooth', firingHz(0)), crDepth = gain(0.55);
  crLFO.connect(crDepth).connect(crTrem.gain);

  // 7. THE BARK. ⚠ A POOL OF FOUR, ROUND-ROBIN, AND THAT IS NOT AN OPTIMISATION. A pop decays over
  //    about 70 ms and a hard overrun schedules one every 40 — so scheduled onto ONE envelope the
  //    second pop cancels the first and a violent backfire comes out QUIETER and smoother than a
  //    burble, which is exactly backwards. Four voices is enough that the overlap is audible and
  //    few enough that nothing is ever allocated per pop.
  const pops = [];
  for (let i = 0; i < 4; i++) {
    const bp = filt('bandpass', 420, 1.6), g = gain(0);
    nz().connect(bp).connect(g).connect(master);
    // The low half of a bang — a real one has a thump under the crack, and noise alone has none.
    const lp = filt('lowpass', 150, 1.1), lg = gain(0);
    nz().connect(lp).connect(lg).connect(master);
    pops.push({ bp, g, lg, busyUntil: 0 });
  }

  src.forEach((n) => { try { n.start(now); } catch { /* already running */ } });

  return {
    ctx, master, tone, panner, core, bankB, coreLP, coreG, sub, subG,
    blow: { car: blowCar, modG: blowModG, bp: blowBP, g: blowG },
    air: { bp: airBP, g: airG }, crackle: { g: crG, lfo: crLFO },
    pops, _pi: 0, _barkTo: 0, _src: src,
  };
}

// ── ONE POP ──────────────────────────────────────────────────────────────────
//
// ⚠ SCHEDULED, NEVER PLAYED. `t` is an absolute context time in the future, because the whole point
// of the scheduler below is to put pops on the audio clock rather than on the frame clock — a bark
// fired from rAF lands on a 16 ms grid at best and on a 60 ms one during a collection pause, which
// turns a stutter into a limp.
function fireBark(N, t, level, low) {
  const v = N.pops[N._pi = (N._pi + 1) % N.pops.length];
  if (t < v.busyUntil) return false;                  // this voice is still ringing — let it
  const dec = 0.045 + low * 0.075;
  v.busyUntil = t + dec;
  try {
    v.bp.frequency.setValueAtTime(rnd(240, 1100) * (1 - low * 0.55), t);
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setValueAtTime(0, t);
    v.g.gain.linearRampToValueAtTime(level, t + 0.004);
    v.g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    v.lg.gain.cancelScheduledValues(t);
    v.lg.gain.setValueAtTime(0, t);
    v.lg.gain.linearRampToValueAtTime(level * low * 1.35, t + 0.006);
    v.lg.gain.exponentialRampToValueAtTime(0.0001, t + dec * 1.5);
  } catch { /* a context that went away mid-schedule */ }
  return true;
}

// How many pops a second this motor is making, and how heavy each one is.
//
// ⚠ THE TWO CASES ARE DIFFERENT SOUNDS AND NOT ONE SOUND AT TWO VOLUMES. Coming ON the throttle is
// a fast light crackle — unburnt fuel lighting in a hot pipe. Coming OFF it at revs is a few very
// heavy bangs. A single rate scaled by a single level gives a machine gun that gets louder, which
// is the one thing a V8 never does.
export function barkRate(s) {
  const rich = c01(s.rich), bang = c01(s.bang), rpm = c01(s.rpm);
  const idle = rpm < 0.12 ? 3 : 0;               // a big cam will not idle clean, ever
  return {
    hz: clamp(idle + rich * 17 + bang * 9 + Math.max(0, rpm - 0.62) * 7, 0, 30),
    level: clamp(0.035 + rich * 0.055 + bang * 0.20, 0, 0.30),
    low: c01(bang),                              // 0 = a crackle in the pipe, 1 = a bang in the engine
  };
}

// Ramp one graph from a state block. `s` = { rpm, pedal, rich, bang, nitroOn, doppler, distance,
// perspective, pan, gain }.
function rampV8(N, s) {
  const now = N.ctx.currentTime;
  const set = (p, v, tau) => { try { p.setTargetAtTime(v, now, tau); } catch { /* dead context */ } };
  const rpm = c01(s.rpm), pedal = c01(s.pedal);
  const dop = Number.isFinite(s.doppler) ? clamp(s.doppler, DOPPLER_LO, DOPPLER_HI) : 1;
  const dist = c01(s.distance);
  // ⚠ INSIDE AN ENCLOSED HELM IS NOT "THE SAME, QUIETER". This hull's house is glazed on five sides
  // with a door in the back — see the pilothouse note in aircraft3d.js — so what reaches the driver
  // is the bottom half of the motor and very little of the top. Quiet-and-full-range reads as the
  // engine having moved away; muffled-and-present reads as YOU having got inside something.
  const inside = s.perspective === 'interior';
  const highs = inside ? 0.30 : 1;
  const lows = inside ? 1.35 : 1;

  set(N.core.frequency, firingHz(rpm) * dop, 0.07);
  set(N.bankB.frequency, firingHz(rpm) * dop * 1.019, 0.07);
  set(N.sub.frequency, firingHz(rpm) * dop * 0.5, 0.10);
  // The lowpass opens with revs, which is most of why a motor sounds like it is TRYING as it climbs
  // rather than just being played back faster.
  set(N.coreLP.frequency, clamp(260 + rpm * 2600 + pedal * 700, 120, 9000), 0.10);
  set(N.coreG.gain, (0.085 + rpm * 0.055) * lows, 0.10);
  set(N.subG.gain, (0.035 + rpm * 0.045) * lows, 0.15);

  // The blower's level follows the LEVER, not the revs: it is being driven hard the instant you ask
  // for it, which is why the whine arrives before the speed does.
  const bTone = blowerToneHz(rpm) * dop;
  set(N.blow.car.frequency, bTone, 0.07);
  set(N.blow.modG.gain, 30 + rpm * 210, 0.10);
  // ⚠ THE BAND FOLLOWS THE CARRIER. Pinned to a sweep of its own it is a filter listening several
  // octaves above anything the oscillator is producing, which is how this layer shipped silent.
  set(N.blow.bp.frequency, clamp(bTone * 1.08, 200, 11000), 0.10);
  set(N.blow.g.gain, (0.004 + pedal * 0.030 + (s.nitroOn ? 0.018 : 0)) * highs, 0.10);

  set(N.air.bp.frequency, clamp(600 + rpm * 1500, 120, 9000), 0.12);
  set(N.air.g.gain, (0.006 + pedal * 0.026) * highs, 0.12);

  set(N.crackle.lfo.frequency, clamp(firingHz(rpm), 1, 900), 0.08);
  set(N.crackle.g.gain, (0.010 + rpm * 0.022) * highs, 0.12);

  // Distance eats the top end long before it eats the level — which is why a boat a long way off is
  // a thump and the same boat alongside is a crack.
  set(N.tone.frequency, clamp((inside ? 900 : 8000) * (1 - dist * 0.86), 260, 12000), 0.20);
  if (N.panner) set(N.panner.pan, clamp(s.pan || 0, -1, 1), 0.10);
}

// Schedule whatever barks are due between now and `BARK_AHEAD` seconds out.
//
// ⚠ IT SCHEDULES A WINDOW AND REMEMBERS WHERE IT GOT TO, which is the whole difference between this
// and firing one pop per frame. Per frame, the bark rate can never exceed the frame rate and every
// pop lands on a video boundary; over a window, thirty a second is thirty a second whether the
// renderer managed 144 frames or 8.
const BARK_AHEAD = 0.28;
function scheduleBarks(N, s, mul = 1) {
  const now = N.ctx.currentTime;
  const { hz, level, low } = barkRate(s);
  if (hz <= 0 || level <= 0 || mul <= 0.02) { N._barkTo = Math.max(N._barkTo, now); return 0; }
  let t = Math.max(N._barkTo, now + 0.01);
  const end = now + BARK_AHEAD;
  let n = 0;
  while (t < end && n < 24) {
    // ⚠ THE GAPS ARE RANDOM AND THE RATE IS NOT. An even 1/hz spacing is a drum machine; what makes
    // a V8 crackle is that the pops are ragged around a rate, which is a Poisson-ish jitter on the
    // interval rather than a jitter on the level.
    fireBark(N, t, level * mul * rnd(0.6, 1.25), low);
    t += (1 / hz) * rnd(0.45, 1.75);
    n++;
  }
  N._barkTo = t;
  return n;
}

function stopV8(N, fast) {
  if (!N) return;
  try {
    const now = N.ctx.currentTime, r = fast ? 0.12 : 0.5;
    N.master.gain.cancelScheduledValues(now);
    N.master.gain.setValueAtTime(N.master.gain.value, now);
    N.master.gain.linearRampToValueAtTime(0, now + r);
    setTimeout(() => {
      try { N._src.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }); N.master.disconnect(); } catch { /* gone */ }
    }, (r + 0.1) * 1000);
  } catch { /* context went away — nothing to wind down */ }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  THE OWN SHIP
// ═══════════════════════════════════════════════════════════════════════════════════════════════

let _own = null;

function nodes() {
  const ae = AE(); if (!ae?.engineNodes) return null;
  try { ae.init?.(); } catch { /* already up, or no audio at all */ }
  const eng = ae.engineNodes();
  if (!eng?.ctx || !eng.bus) return null;
  if (eng.ctx.state === 'suspended') { try { eng.ctx.resume(); } catch { /* needs a gesture */ } }
  return eng;
}

export function startBoatEngine() {
  if (_own) return true;
  const eng = nodes(); if (!eng) return false;
  _own = makeV8(eng.ctx, eng.bus, eng.noise, { pan: false });
  const now = eng.ctx.currentTime;
  // Swell in under whatever one-shot the panel fired for the start, rather than arriving at full
  // chat — the same ramp `createFlightEngine` opens with.
  try {
    _own.master.gain.setValueAtTime(0, now);
    _own.master.gain.linearRampToValueAtTime(1, now + 0.9);
  } catch { /* dead context */ }
  return true;
}

export function updateBoatEngine(s = {}) {
  if (!_own) return false;
  rampV8(_own, s);
  scheduleBarks(_own, s, 1);
  return true;
}

export function stopBoatEngine(fast = false) { const n = _own; _own = null; stopV8(n, fast); }
export function isBoatEngineRunning() { return !!_own; }

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  EVERYBODY ELSE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The cool half, and it needed no new wire: `vehicle.contacts` already puts every hull within range
// into the windscreen with a position, a heading, a speed and (now) `power`/`rich`/`bang`. A voice
// per contact is a derivation of what the seat is already being sent — nothing is stored, nothing
// is requested, and a boat you cannot see does not get one.
//
// ⚠ AND THE DOPPLER IS RELATIVE, WHICH IS THE ONLY VERSION WORTH HAVING. Solved off the contact's
// speed alone, a boat overtaking you at two knots of closure screams past like a bullet — and two
// boats running abreast at ninety, which is the whole point of a race, shift not at all. What bends
// the note is the rate the RANGE is changing, so both craft's velocities go into it.

const _voices = new Map();   // contact id -> { N, seen }
let _tick = 0;

// The along-the-line-of-sight closing rate, in mph, positive when the gap is OPENING. Exported
// because the gate asserts the sign, and getting a doppler sign backwards is a bug that sounds
// plausible in both directions until two boats pass each other.
export function closingMph(me, them) {
  const dx = (them.x - me.x), dy = (them.y - me.y);
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-4)) return 0;
  const ux = dx / d, uy = dy / d;
  const vel = (hdgDeg, mph) => {
    const r = (hdgDeg || 0) * Math.PI / 180;
    return [Math.sin(r) * (mph || 0), -Math.cos(r) * (mph || 0)];   // the sim's own heading frame
  };
  const [tvx, tvy] = vel(them.hdg, them.speed);
  const [mvx, mvy] = vel(me.hdg, me.speed);
  return (tvx - mvx) * ux + (tvy - mvy) * uy;
}

export const dopplerFor = (closeMph) =>
  clamp(DOPPLER_MPH / (DOPPLER_MPH + (closeMph || 0)), DOPPLER_LO, DOPPLER_HI);

// ⚠ KNOTS ON THE WIRE, MPH IN HERE, AND THE WIRE DOES NOT SAY WHICH. A contact carries `ias`, and
// the two producers that existed before this one fill it in different units — aircraft send knots
// off `cont.airspeed`, trucks send mph off `rig.speed` — which the renderer's own note flags as a
// live divergence. `boatContactsNear` picked knots and says so, so this is the one place the
// conversion happens; every number below is mph, including the listener's own.
export const KT_TO_MPH = 1.15078;

// Is this contact a hull rather than an aeroplane? ⚠ A FLAG THE PRODUCER STAMPS, never a guess off
// `cls`. A contact feed carries aircraft, trucks and boats through one shape, and a class-name
// allowlist here would be a second register of what floats — out of date the first time somebody
// adds a second hull, and silent about it, because the failure is a boat that makes no noise.
export const isBoatContact = (c) => !!(c && c.marine);

// `me` = { x, y, hdg, speed } in tiles, degrees and MPH; `list` = raw contact payloads, which may
// hold anything the seat can see.
export function updateBoatContacts(me, list = []) {
  const eng = _voices.size || (list && list.length) ? nodes() : null;
  if (!eng) { if (_voices.size) stopBoatContacts(); return 0; }
  _tick++;

  const near = [];
  for (const c of list) {
    if (!isBoatContact(c) || c.x == null || c.y == null) continue;
    const d = Math.hypot(c.x - me.x, c.y - me.y);
    if (d > HEAR_TILES) continue;
    near.push({ c, d });
  }
  // ⚠ NEAREST FIRST AND HARD-CAPPED. A voice is nine oscillators and a bark pool; a basin with a
  // dozen hulls on it would be a hundred oscillators and a choir nobody can pick a boat out of.
  near.sort((a, b) => a.d - b.d);
  near.length = Math.min(near.length, MAX_VOICES);

  for (const { c, d } of near) {
    let v = _voices.get(c.id);
    if (!v) {
      const N = makeV8(eng.ctx, eng.bus, eng.noise, { pan: true });
      try {
        const t = eng.ctx.currentTime;
        N.master.gain.setValueAtTime(0, t);
        N.master.gain.linearRampToValueAtTime(1, t + 0.35);   // fade IN, or a boat entering range pops
      } catch { /* dead context */ }
      v = { N, seen: 0 };
      _voices.set(c.id, v);
    }
    v.seen = _tick;

    const dist = c01(d / HEAR_TILES);
    // Inverse-square-ish, floored so a boat at the edge of hearing is faint rather than absent.
    const lvl = clamp(0.85 / (1 + (d / 3.2) * (d / 3.2)), 0.02, 1);
    // Bearing relative to where the listener is FACING, so turning your head moves the boat.
    const rel = Math.atan2(c.x - me.x, -(c.y - me.y)) - (me.hdg || 0) * Math.PI / 180;
    const pan = Math.sin(rel);
    const dop = dopplerFor(closingMph(me, { ...c, speed: c.speed != null ? c.speed : (c.ias || 0) * KT_TO_MPH }));

    rampV8(v.N, {
      rpm: c.rpm != null ? c.rpm : c01((c.ias || 0) / 120),
      pedal: c.power != null ? c.power : 0,
      rich: c.rich, bang: c.bang, nitroOn: c.nitroOn,
      doppler: dop, distance: dist, pan, perspective: 'exterior',
    });
    try { v.N.master.gain.setTargetAtTime(lvl, eng.ctx.currentTime, 0.12); } catch { /* dead */ }
    // ⚠ BARKS FADE WITH DISTANCE TOO, and they must fade FASTER than the drone: a pop is nearly all
    // high end, so at range it is the first thing the air takes. Scaled by the level squared, the
    // far boats rumble and the near one is the only thing cracking.
    scheduleBarks(v.N, { rpm: c.rpm ?? 0, rich: c.rich, bang: c.bang }, lvl * lvl);
  }

  // Anything not seen this pass has gone out of range or been deleted — wind it down.
  for (const [id, v] of _voices) {
    if (v.seen === _tick) continue;
    _voices.delete(id);
    stopV8(v.N, false);
  }
  return _voices.size;
}

export function stopBoatContacts() {
  for (const [, v] of _voices) stopV8(v.N, true);
  _voices.clear();
}

export function stopBoatAudio() { stopBoatEngine(true); stopBoatContacts(); }

export function boatAudioState() {
  return { own: !!_own, voices: _voices.size, ids: [..._voices.keys()] };
}

// Test seam. ⚠ The gate drives the scheduler and reads the pops back off the node graph, so it
// needs the live handles rather than a summary — the same arrangement `sea-audio.js`'s `_test` is
// in, and for the same reason: a smoke that can only see what this file chose to report cannot
// catch this file reporting the wrong thing.
export const _test = {
  ownNode: () => _own,
  voice: (id) => _voices.get(id)?.N || null,
  makeV8, rampV8, scheduleBarks, fireBark, stopV8,
  HEAR_TILES, MAX_VOICES, DOPPLER_MPH, DOPPLER_LO, DOPPLER_HI, BARK_AHEAD,
};
