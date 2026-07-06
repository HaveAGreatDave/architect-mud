// FLIGHT MODEL — the continuous fixed-wing energy simulation.
//
// A pure, dependency-free integrator: no DOM, no network, no plugin state. The
// client sim loop drives it at 60fps (the source of "feel"); the same math can be
// stepped headless in a test harness to validate behaviour in isolation. It is an
// ARCADE energy model, not a 6-DOF aerodynamics sim — believable, consistent, and
// tunable, per the Flight Feel doc: the player guides mass with momentum, controls
// MODIFY behaviour (they never set state instantly), and a stall comes from
// excessive pitch + insufficient airspeed, never from "throttle low".
//
// Units: airspeed/groundspeed in knots, altitude in feet (AGL), vertical speed in
// ft/min, angles in degrees, time in seconds. All the coefficients are knobs — the
// harness exists so we tune them by eye.
//
// createState(params) -> a fresh aircraft state, parked, engine off.
// step(state, input, params, dt) -> mutates + returns state advanced by dt seconds.
//   input  = { elevator:-1..1, aileron:-1..1, throttle:0..1, flaps:0..1 }
//            elevator +1 = full pull (nose up), -1 = full push (nose down).
//   params = a TYPES entry (per-airframe tuning).

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const G_KT = 19.06;               // gravity as a knots/second airspeed change (9.81 m/s²)
const wrap360 = (d) => ((d % 360) + 360) % 360;

// ── Per-airframe tuning ───────────────────────────────────────────────────────
// The Mayfly is the Phase-1 reference: a light, forgiving fixed-wing. Heavier types
// (added in Phase 3) scale mass up → slower rates, longer rolls, gentler handling,
// which the Feel doc calls the "consistency" rule. Nothing here is authoritative
// content; the real per-type numbers come from aircraft_types at wiring time. These
// are the physics knobs the tuning maps onto.
export const TYPES = {
  mayfly: {
    name: 'Mayfly',
    mass: 1.0,            // relative inertia — scales every rate + the force→accel maps
    thrustMax: 11.5,      // full-power airspeed authority (kt/s) — ample power to climb & hold speed
    vr: 40,               // rotate speed (kt) — below this, pitch authority is mushy
    vs0: 24,              // clean 1g stall speed (kt) — low = very stall-resistant trainer
    vne: 120,             // never-exceed (kt) — the server envelope clamp
    cruise: 80,           // trimmed level-flight speed (kt) — lift≈weight target (roomy stall margin)
    pitchRate: 11,        // deg/s of pitch at full elevator & full authority — lower = best climb needs more back-pressure
    pitchTau: 0.6,        // how long the yoke's pitch effect takes to build (s) — heavy control
    rollRate: 52,         // deg/s of bank at full aileron & full authority
    rollTau: 0.55,        // how long the yoke's roll effect takes to build (s) — heavy control
    engineLag: 1.3,       // throttle→rpm time constant (s); turbines will be larger
    pitchStable: 0.9,     // self-level rate when elevator released (seeks stability)
    rollStable: 1.1,      // wings-level rate when aileron released
    dragP: 0.00100,       // parasitic drag coeff (∝ airspeed²) — low, so it holds speed climbing
    flapDrag: 0.55,       // extra drag per unit flap
    flapLift: 0.35,       // extra lift per unit flap
    flapVs: 0.18,         // stall-speed reduction per unit flap
    rollFric: 1.6,        // ground rolling friction (kt/s) with throttle at idle
    brake: 5.5,           // extra ground deceleration (kt/s) at full back-pressure — wheel brakes for the rollout
    groundSteer: 30,      // nosewheel/tiller authority (deg/s) while taxiing; fades out toward rotation speed
    aoaCrit: 19,          // critical angle of attack (deg) — high = forgiving, resists the stall
    liftScale: 1.0,       // scales the whole lift/weight pair (cancels; kept as a knob)
    vsMax: 525,           // max sustained climb (ft/min) — scaled ~0.7× the Cessna 172 like our other numbers
    vsGain: 1600,         // how hard excess lift converts to vertical speed
    vsTau: 1.0,           // vertical inertia (s) — vs eases toward its target; lower = climbs out off the ground faster
    ceiling: 7500,        // service ceiling (ft) — climb performance fades to zero here (thin air)
    bestGlide: 49,        // best-glide (max-range) speed (kt) — the yoke light glows BLUE here in a dead-stick glide
  },

  // ── Phase 3 fixed-wing fleet ────────────────────────────────────────────────
  // Scaled off the Mayfly by mass + character (heavier = slower rates, longer rolls,
  // higher speeds). All knobs — starting points for a by-ear tuning pass like the Mayfly.
  // The heli (Dragonfly, VTOL) is NOT here — it needs its own hover model (Phase 3b).

  // Mule — twin-TURBOPROP STOL hauler, a DHC-6 Twin Otter analogue: rugged, honest, a strong
  // climber that gets in and out of short/rough strips. Fast cruise, powerful STOL flaps, low
  // stall for its size. Ceiling 12000 (the real Otter goes ~25k; kept low for the world scale).
  mule: {
    name: 'Mule', mass: 2.8, thrustMax: 31, vr: 65, vs0: 46, vne: 185, cruise: 165,
    pitchRate: 8, pitchTau: 0.8, rollRate: 40, rollTau: 0.7, engineLag: 1.7,
    pitchStable: 0.88, rollStable: 1.0, dragP: 0.00090, flapDrag: 0.65, flapLift: 0.5, flapVs: 0.24,
    rollFric: 1.4, aoaCrit: 18, liftScale: 1.0, vsMax: 1800, vsGain: 1600, vsTau: 0.95,
    brake: 6.0, groundSteer: 26, ceiling: 12000, bestGlide: 65,
  },
  // Leviathan — 4-engine heavy-lift freighter, an ANTONOV AN-124 RUSLAN analogue: HEAVY first —
  // ponderous to accelerate and steer, a long roll, an unremarkable level cruise (no faster
  // than the Mule despite its size).
  // But it's a slippery, low-drag airframe with huge inertia and a high Vne, so it BUILDS and
  // holds real speed once it has momentum behind it in a dive. Strong brakes (biggest wheels),
  // but the ~95 kt touchdown still makes for a long rollout — it needs a real runway.
  leviathan: {
    name: 'Leviathan', mass: 5.0, thrustMax: 40, vr: 95, vs0: 64, vne: 280, cruise: 170,
    pitchRate: 5, pitchTau: 1.2, rollRate: 22, rollTau: 1.1, engineLag: 2.4,
    pitchStable: 0.7, rollStable: 0.85, dragP: 0.00065, flapDrag: 0.7, flapLift: 0.45, flapVs: 0.2,
    rollFric: 1.2, aoaCrit: 16, liftScale: 1.0, vsMax: 1600, vsGain: 1600, vsTau: 1.35,
    brake: 8.0, groundSteer: 16, ceiling: 18000,   // cruises high, above the weather — the fleet's highest ceiling
    // The slippery, low-drag airframe would otherwise float ~34:1 dead-stick (albatross-like for
    // a heavy freighter). A touch of dead-stick induced drag brings the engine-out glide to a
    // believable ~13:1 without touching its (powered) cruise or climb. Best glide ~89 kt.
    glideDrag: 0.0019, bestGlide: 89,
  },
  // Reaper — a Fairchild A-10 WARTHOG analogue: the gun IS the plane. NOT a fighter —
  // slow, draggy and heavy, but a rock-stable low-level platform that loiters over the
  // target and shrugs off ground fire. It can't run (high drag bleeds any dive), it just
  // keeps coming. Twin turbofans, forgiving low-speed handling, rough-field capable.
  reaper: {
    name: 'Reaper', mass: 3.4, thrustMax: 26, vr: 62, vs0: 40, vne: 210, cruise: 150,
    pitchRate: 9, pitchTau: 0.7, rollRate: 58, rollTau: 0.6, engineLag: 1.5,
    pitchStable: 1.1, rollStable: 1.3, dragP: 0.00110, flapDrag: 0.6, flapLift: 0.42, flapVs: 0.2,
    rollFric: 1.5, aoaCrit: 21, liftScale: 1.0, vsMax: 1500, vsGain: 1600, vsTau: 1.0,
    brake: 7.5, groundSteer: 28, ceiling: 12000, bestGlide: 69,
  },
  // Dragonfly — a REVOLUTION MINI 500 analogue: a tiny single-rotor kit helicopter. Light,
  // darty and gets into tight spots (huge cyclic + pedal authority, spins on the spot in a
  // hover), but a twitchy, unforgiving handful: weak self-level, thin power margin, and it
  // will settle-with-power (vortex ring) the instant you drop it into its own downwash. Flown
  // by the heli branch below (collective + cyclic + pedals), NOT the fixed-wing integrator.
  dragonfly: {
    name: 'Dragonfly', heli: true, mass: 0.9,
    vne: 100, cruise: 78, vs0: 14,        // vs0 doubles as the translational-lift (ETL) speed
    vr: 0, aoaCrit: 90, liftScale: 1,
    pitchRate: 30, pitchTau: 0.35, rollRate: 46, rollTau: 0.3,   // nimble, twitchy cyclic
    pitchStable: 1.5, rollStable: 1.7,    // weak-ish self-level — needs constant small corrections
    yawRate: 95,                          // pedal (tail-rotor) authority in the hover, deg/s
    engineLag: 0.9,                       // rotor spool time
    cyclicThrust: 2.4,                    // disc-tilt → horizontal accel (kt/s per deg of lean)
    dragP: 0.0019,                        // draggy body: bleeds speed, modest top end
    liftMax: 2.7, hoverThrust: 1.0,       // collective×Nr vertical lift authority vs hover weight
    // Gentle vertical response so the hover isn't twitchy: a small collective error off the
    // hover point gives a modest vs (low vsGain), and vs eases in with real inertia (higher
    // vsTau) instead of snapping to the cap the instant you lift a skid off the ground.
    vsGain: 850, vsMax: 1300, vsTau: 0.9,
    vrsVs: 480,                           // settling-with-power onset (fpm sink) when slow + powered
    rollFric: 3.2,                        // skid friction on the ground
    ceiling: 10000,
  },
  // Carcass — salvaged wreck: underpowered, draggy, unstable. A junker you nurse into the air.
  carcass: {
    name: 'Carcass', mass: 1.4, thrustMax: 11, vr: 44, vs0: 28, vne: 115, cruise: 72,
    pitchRate: 10, pitchTau: 0.5, rollRate: 50, rollTau: 0.5, engineLag: 1.5,
    pitchStable: 0.7, rollStable: 0.8, dragP: 0.00120, flapDrag: 0.55, flapLift: 0.32, flapVs: 0.17,
    rollFric: 1.7, aoaCrit: 17, liftScale: 0.95, vsMax: 760, vsGain: 1500, vsTau: 1.0,
    brake: 5.0, groundSteer: 30, ceiling: 6000, bestGlide: 45,
  },
};

// A stall-shaped lift-coefficient curve: rises with AoA to the critical angle, then
// falls off hard (the wing lets go). CL0 gives a little lift at zero AoA.
const CL0 = 0.28, CL_ALPHA = 0.09, STALL_FALLOFF = 0.09;
const STALL_HOLD = 1.2;   // seconds below stall speed before lift actually collapses
function liftCoef(aoa, aoaCrit, stalled) {
  let cl = CL0 + CL_ALPHA * aoa;
  if (aoa > aoaCrit) {
    const clMax = CL0 + CL_ALPHA * aoaCrit;
    // Past critical AoA lift only PLATEAUS (mushy handling); it collapses solely in a
    // real, sustained stall — so a brief over-pull never dumps you out of the sky.
    cl = stalled ? Math.max(0, clMax * (1 - (aoa - aoaCrit) * STALL_FALLOFF)) : clMax;
  }
  return Math.max(0, cl);
}

// Weight the model holds up. Anchored at the STALL point — at the clean stall speed
// the wing at its max lift coefficient just holds the aircraft up. This makes the
// envelope self-consistent: you can fly (barely) at Vr just above the stall, cruise
// sits at a low trim AoA, and lift falls below weight only when you're too slow.
function weightOf(p) { return 0.5 * p.vs0 * p.vs0 * (CL0 + CL_ALPHA * p.aoaCrit) * p.liftScale; }

export function createState(p) {
  return {
    airspeed: 0, altitude: 0, pitch: 0, bank: 0, heading: 0,
    vs: 0,                 // ft/min
    rpm: 0,                // 0..1 (spooled fraction of throttle)
    elevEff: 0,            // the yoke's built-up pitch effect (lags the raw input)
    rollEff: 0,            // the yoke's built-up roll effect (lags the raw input)
    aoa: 0, stallMargin: 1, stalled: false, stallTimer: 0, stallDir: 0,
    onGround: true, groundSpeed: 0,
    // last-frame events the audio/feedback layers read (cleared each step)
    events: [],
  };
}

// ── Helicopter integrator (Dragonfly / Mini 500) ─────────────────────────────
// A separate arcade hover model — no Vr, no stall, no takeoff roll. The pilot flies
// four axes: COLLECTIVE (throttle 0..1 → rotor thrust), CYCLIC (elevator/aileron →
// disc tilt → horizontal accel), and PEDALS (yaw, tail rotor). The character comes
// from three failure modes that punish mishandling: rotor-RPM (Nr) droop under a
// greedy collective, settling-with-power (vortex ring state) in a slow powered
// descent, and its own twitchiness. All knobs — tuned by eye like the fixed-wing set.
function stepHeli(state, input, p, dt) {
  const s = state;
  s.events = [];
  const cycP = clamp(input.elevator || 0, -1, 1);   // aft (+1) = nose up / decelerate
  const cycR = clamp(input.aileron || 0, -1, 1);     // right (+1) = bank right
  const coll = clamp(input.throttle || 0, 0, 1);     // collective (already engine-gated upstream)
  const pedal = clamp(input.pedal || 0, -1, 1);

  // 1. Rotor Nr eases toward the collective demand (engine off ⇒ coll 0 ⇒ it winds down).
  //    A greedy collective outruns the little two-stroke, so Nr DROOPS at high pitch — the
  //    classic low-rotor-RPM trap (less Nr → less thrust → you sink while pulling up).
  const nrTarget = coll > 0.02 ? clamp(1 - Math.max(0, coll - 0.7) * 1.8, 0.4, 1) : 0;
  s.rpm += (nrTarget - s.rpm) * Math.min(1, dt / p.engineLag);
  const Nr = s.rpm;

  // 2. Fuselage attitude from cyclic (builds over tau; weak self-level). Planted on the skids.
  if (s.onGround) {
    s.pitch += (0 - s.pitch) * Math.min(1, dt * 5); s.bank += (0 - s.bank) * Math.min(1, dt * 5);
    s.elevEff += (cycP - s.elevEff) * Math.min(1, dt / p.pitchTau);
    s.rollEff += (cycR - s.rollEff) * Math.min(1, dt / p.rollTau);
  } else {
    s.elevEff += (cycP - s.elevEff) * Math.min(1, dt / p.pitchTau);
    s.rollEff += (cycR - s.rollEff) * Math.min(1, dt / p.rollTau);
    s.pitch += (s.elevEff * p.pitchRate - p.pitchStable * s.pitch) * dt; s.pitch = clamp(s.pitch, -35, 35);
    s.bank += (s.rollEff * p.rollRate - p.rollStable * s.bank) * dt; s.bank = clamp(s.bank, -60, 60);
  }

  // 3. Yaw: pedals swing the nose with full authority in the hover, washing out with speed as
  //    the fuselage weathervanes. On the skids the tail rotor can't pivot the airframe against
  //    ground friction — pedals do nothing until the wheels/skids are light (airborne). Past ETL,
  //    bank also curves the flight path (a plane-like turn).
  if (!s.onGround) {
    const pedalAuth = 1 - clamp(s.airspeed / p.cruise, 0, 0.85);
    s.heading = wrap360(s.heading + pedal * (p.yawRate || 60) * pedalAuth * dt);
  }
  if (!s.onGround && s.airspeed > p.vs0) {
    const turnRate = (G_KT * Math.tan(s.bank * D2R)) / Math.max(p.cruise, s.airspeed) * R2D;
    s.heading = wrap360(s.heading + turnRate * dt);
  }

  // 4. Horizontal accel: the tilted disc pushes you where the nose leans (nose down = forward).
  const accel = (s.onGround ? 0 : -s.pitch * (p.cyclicThrust || 2) * Nr);
  const drag = p.dragP * s.airspeed * Math.abs(s.airspeed);
  s.airspeed = clamp(s.airspeed + (accel - drag) * dt, -0.18 * p.cruise, p.vne * 1.03);
  if (s.onGround) s.airspeed -= Math.sign(s.airspeed) * Math.min(Math.abs(s.airspeed), p.rollFric * dt);
  s.groundSpeed = Math.abs(s.airspeed);

  // 5. Vertical: rotor thrust (collective × Nr) vs the hover weight, eased into a target vs.
  //    Translational lift (ETL) makes the same collective bite harder in forward flight — drop
  //    below it in a downwind hover and you sink. Settling-with-power: a slow, powered, fast
  //    descent lets the disc eat its own vortex and lift collapses (deepens the sink → the trap).
  let thrustV = coll * Nr * (p.liftMax || 2.6);
  thrustV *= 1 + 0.18 * clamp(Math.abs(s.airspeed) / p.vs0, 0, 1);
  // Settling-with-power (vortex ring): once you're SLOW and sinking FAST with power applied,
  // the disc falls into its own downwash. Feeding in more collective only feeds the ring — so
  // lift is CAPPED below the hover value and you can't climb out; the only escape is forward
  // cyclic (build airspeed to fly out of your own wake). This is the killer for mishandling.
  // Sticky envelope with hysteresis: you ENTER on a fast, slow, powered descent, and only
  // LEAVE by flying out (forward airspeed past ETL) or lowering the collective — never by
  // just pulling more pitch. That's what makes it a trap rather than a speed bump.
  const slow = Math.abs(s.airspeed) < p.vs0 * 0.9;
  if (!s.vrsState) {
    if (!s.onGround && s.vs < -(p.vrsVs || 480) && slow && coll > 0.4) s.vrsState = true;
  } else if (s.onGround || !slow || coll < 0.25) {
    s.vrsState = false;
  }
  let vrs = 0;
  if (s.vrsState) {
    vrs = clamp((-s.vs - 200) / 700, 0.4, 1);
    thrustV = Math.min(thrustV, (p.hoverThrust || 1) * (1 - 0.55 * vrs));
    if (!s.vrsWarn) { s.events.push({ type: 'vrs' }); s.vrsWarn = true; }
  } else s.vrsWarn = false;
  const vsTarget = clamp((thrustV / (p.hoverThrust || 1) - 1) * p.vsGain, -p.vsMax * 1.8, p.vsMax);
  if (s.onGround && vsTarget <= 0) s.vs = 0;
  else { s.vs += (vsTarget - s.vs) * Math.min(1, dt / p.vsTau); s.altitude += (s.vs / 60) * dt; }

  // 6. Warnings the HUD/horn read: low rotor RPM + settling. No aerodynamic stall on a heli.
  s.aoa = 0; s.stalled = false;
  s.lowNr = !s.onGround && Nr < 0.6;
  s.vrs = vrs > 0.25;
  s.stallMargin = clamp((Nr - 0.5) / 0.4, 0, 1);   // reuse the margin channel to drive the horn

  // 7. Ground contact — set down vertically (no rollout). A hard arrival flags a heavy touchdown.
  if (s.altitude <= 0) {
    if (!s.onGround && s.vs < -300) s.events.push({ type: 'touchdown', severity: s.vs < -600 ? 'hard' : 'firm', vs: s.vs });
    s.altitude = 0; s.onGround = true; s.vs = Math.max(0, s.vs);
  } else s.onGround = false;
  return s;
}

export function step(state, input, p, dt) {
  if (p.heli) return stepHeli(state, input, p, dt);
  const s = state;
  s.events = [];
  const elevator = clamp(input.elevator || 0, -1, 1);
  const aileron = clamp(input.aileron || 0, -1, 1);
  const throttle = clamp(input.throttle || 0, 0, 1);
  const flaps = clamp(input.flaps || 0, 0, 1);
  const weight = weightOf(p);

  // 1. Engine inertia — rpm eases toward the throttle lever, never snaps.
  s.rpm += (throttle - s.rpm) * Math.min(1, dt / p.engineLag);
  const thrust = s.rpm * p.thrustMax;

  // 2. Control authority grows with airspeed. Below Vr the yoke is mushy — this is
  //    what forces you to build speed on the roll before rotation does anything.
  const auth = clamp(s.airspeed / p.vr, 0, 1.2);

  // 3. Pitch: the yoke's effect BUILDS over ~pitchTau, so a quick jab does little —
  //    it takes a firm, sustained pull to rotate or climb (heavy control). The
  //    airframe also resists extreme attitudes: authority fades toward the pitch
  //    limits, so it takes a lot of input to put yourself in danger. Released, it
  //    self-levels toward stability.
  s.elevEff += (elevator - s.elevEff) * Math.min(1, dt / p.pitchTau);
  const pitchResist = 1 - 0.55 * Math.abs(s.pitch) / 35;
  const pitchCmd = s.elevEff * p.pitchRate * auth * pitchResist;
  s.pitch += (pitchCmd - p.pitchStable * s.pitch * (1 - Math.abs(s.elevEff))) * dt;
  s.pitch = clamp(s.pitch, -35, 35);

  // 4. Bank: like pitch, the roll effect BUILDS over ~rollTau and the airframe
  //    resists toward full bank, so it takes a sustained full throw to reach the
  //    limit. On the ground the gear holds the wings level — no roll until flying.
  if (s.onGround) {
    s.bank += (0 - s.bank) * Math.min(1, dt * 4);
    s.rollEff += (0 - s.rollEff) * Math.min(1, dt / p.rollTau);
  } else {
    s.rollEff += (aileron - s.rollEff) * Math.min(1, dt / p.rollTau);
    const rollResist = 1 - 0.4 * Math.abs(s.bank) / 70;
    const rollCmd = s.rollEff * p.rollRate * auth * rollResist;
    s.bank += (rollCmd - p.rollStable * s.bank * (1 - Math.abs(s.rollEff))) * dt;
    s.bank = clamp(s.bank, -70, 70);
  }

  // 5. Heading: a coordinated turn from bank (rate ∝ tan(bank)/speed). No airspeed →
  //    no turn (you can't steer a parked plane with the yoke).
  if (s.airspeed > 1 && !s.onGround) {
    const turnRate = (G_KT * Math.tan(s.bank * D2R)) / Math.max(p.vs0, s.airspeed) * R2D;
    s.heading = wrap360(s.heading + turnRate * dt);
  } else if (s.onGround && s.airspeed > 0.3) {
    // Nosewheel/tiller steering on the ground — the raw aileron swings the nose to taxi.
    // Needs a little roll speed to bite and fades toward rotation so you don't swerve at Vr.
    const steerAuth = clamp(s.airspeed / 5, 0, 1) * clamp((p.vr - s.airspeed) / p.vr, 0, 1);
    s.heading = wrap360(s.heading + aileron * (p.groundSteer || 0) * steerAuth * dt);
  }

  // 6. Angle of attack from the current flight path (uses last frame's vs — fine at
  //    small dt). Pitch up faster than the plane can climb → AoA rises → toward stall.
  //    Vertical speed is ft/min; 1 kt = 101.33 ft/min, so vs/101.33 is the vertical
  //    component in knots against the horizontal airspeed.
  const gamma = Math.atan2(s.vs / 101.33, Math.max(1, s.airspeed)) * R2D;
  s.aoa = clamp(s.pitch - gamma, -25, 45);

  // 6b. Stall requires a SUSTAINED hold below the (loaded, flap-adjusted) stall speed.
  //     A momentary over-pull just mushes; you must hold a full pull (~5s) to stall.
  //     The timer builds while too slow and recovers fast the instant you ease off.
  const loadFactor = 1 / Math.max(0.35, Math.cos(s.bank * D2R));
  const stallSpeed = p.vs0 * Math.sqrt(loadFactor) / (1 + flaps * p.flapVs);
  s.stallMargin = clamp((s.airspeed / stallSpeed - 1) / 0.3, 0, 1);
  const wasStalled = s.stalled;
  // Stall needs slow AND high AoA (nose up). Nosing DOWN drops the AoA, so a dive
  // always builds speed and recovers — it can never stall.
  const preStall = !s.onGround && s.airspeed < stallSpeed && s.aoa > 4;
  // Recovers FAST the instant you unload — level out with power (speed climbs back over
  // the stall speed) or nose down (AoA drops below 4) and the timer bleeds off quickly.
  s.stallTimer = preStall ? s.stallTimer + dt : Math.max(0, s.stallTimer - dt * 6);
  s.stalled = s.stallTimer >= STALL_HOLD;
  if (s.stalled && !wasStalled) {
    s.events.push({ type: 'stall' });
    // Which wing lets go first — follow any existing bank/aileron, else drop the left. Held for this stall.
    s.stallDir = Math.abs(s.bank) > 1 ? Math.sign(s.bank) : (aileron !== 0 ? Math.sign(aileron) : -1);
  }
  // A stalled wing quits flying: the nose falls and a wing drops. KEEP hauling back and it
  // deepens into a wing-over / incipient spin (rolls off and yaws around). EASE OFF or push
  // and it just noses into a dive; once speed rebuilds the stall breaks and it self-levels.
  if (s.stalled && !s.onGround) {
    const held = s.elevEff > 0.3;
    s.pitch = Math.max(held ? -55 : -35, s.pitch - (held ? 22 : 34) * dt);
    if (held) {
      s.bank = clamp(s.bank + s.stallDir * 52 * dt, -85, 85);       // a wing drops, rolls off
      s.heading = wrap360(s.heading + s.stallDir * 42 * dt);         // yaws around the wing-over
    } else {
      s.bank += s.stallDir * 9 * dt;                                 // mild wing drop into the recovery dive
    }
  }

  // 7. Lift vs weight → a bounded target vertical speed the aircraft eases toward
  //    (vertical inertia — vs never jumps). Excess lift climbs; a deficit sinks.
  const cl = liftCoef(s.aoa, p.aoaCrit, s.stalled) * (1 + flaps * p.flapLift);
  const lift = 0.5 * s.airspeed * s.airspeed * cl * p.liftScale;
  // Only the vertical component holds you up — in a steep bank the lift vector tilts,
  // so a hard turn bleeds climb (add power or back-pressure to hold altitude).
  const vLift = lift * Math.cos(s.bank * D2R);
  // Release the yoke (centred) and the aircraft trims toward LEVEL flight — with power
  // it holds altitude; small power differences give a gentle climb/descent, not a plunge.
  const handsOff = clamp(1 - Math.abs(s.elevEff) * 3, 0, 1);
  // A stall FALLS faster than it can climb — let the sink run well past the climb cap so the
  // eye-height drops rapidly (the "falling out of the sky" feel). Held stalls sink hardest.
  const sinkFloor = s.stalled ? -p.vsMax * 2.4 : -p.vsMax;
  // Service ceiling: full climb until the top ~40% of the envelope, then it tapers to zero at
  // p.ceiling as the air thins — you can't climb past it (descent is unaffected). Emergent, no cap.
  const ceil = p.ceiling || 20000;
  const climbCap = p.vsMax * clamp((ceil - s.altitude) / (ceil * 0.4), 0, 1);
  const vsTarget = clamp((vLift / weight - 1) * p.vsGain, sinkFloor, climbCap) * (1 - handsOff * 0.8);
  if (s.onGround && vsTarget <= 0) {
    s.vs = 0;                                 // sitting on the wheels — no lift to climb on
  } else {
    s.vs += (vsTarget - s.vs) * Math.min(1, dt / p.vsTau);
    s.altitude += (s.vs / 60) * dt;
  }

  // 8. Airspeed: thrust − drag − the gravity component of pitch (climbing bleeds
  //    speed) − ground friction while rolling.
  const drag = (p.dragP + flaps * p.flapDrag * 0.0016) * s.airspeed * s.airspeed  // parasitic drag ∝ V²
             + s.aoa * s.aoa * 0.0016 * s.airspeed                               // profile-drag rise with a hard pull
             + (p.glideDrag || 0) * Math.max(0, 1 - s.rpm / 0.4) * (weight * weight) / (s.airspeed * s.airspeed + 40);   // DEAD-STICK induced drag (∝ 1/V²): engages only as the powerplant winds down toward idle (rpm below ~0.4), full at a stopped/windmilling engine. It penalises the SLOW end of a glide, so best-glide sits at a sensible speed with a realistic ratio instead of floating forever just above the stall — and because it's gated to low rpm it leaves ALL powered cruise/climb untouched. Per-type; unset ⇒ 0 (legacy floaty glide).
  const grav = G_KT * Math.sin(s.pitch * D2R);
  // Ground friction: idle rolling drag, plus wheel brakes from FORWARD pressure (push the
  // yoke, elevator < 0). Pushing also pins the nose to the runway, so braking never fights
  // the back-pressure you use to rotate and lift off — they're opposite gestures.
  const brake = s.onGround ? clamp(-elevator, 0, 1) * (p.brake || 0) : 0;
  const fric = s.onGround ? p.rollFric * (1 - s.rpm) + brake : 0;
  s.airspeed = Math.max(0, s.airspeed + ((thrust - drag) / p.mass - grav - fric) * dt);
  s.groundSpeed = s.airspeed;

  // 9. Ground contact. Liftoff is emergent: once lift ≥ weight at rotation, altitude
  //    climbs off zero. Coming back down, a hard arrival is flagged by sink rate.
  if (s.altitude <= 0) {
    if (!s.onGround && s.vs < -300) s.events.push({ type: 'touchdown', severity: s.vs < -700 ? 'hard' : 'firm', vs: s.vs });
    s.altitude = 0;
    s.onGround = true;
    s.vs = Math.max(0, s.vs);
  } else {
    s.onGround = false;
  }

  return s;
}

// A convenience read-out the harness / HUD can format (the shared state contract).
export function readout(s, p) {
  return {
    airspeed: Math.round(s.airspeed),
    altitude: Math.round(s.altitude),
    vs: Math.round(s.vs),
    pitch: +s.pitch.toFixed(1),
    bank: +s.bank.toFixed(1),
    heading: Math.round(s.heading),
    rpm: Math.round(s.rpm * 100),
    aoa: +s.aoa.toFixed(1),
    stallMargin: +s.stallMargin.toFixed(2),
    stalled: s.stalled,
    onGround: s.onGround,
    vr: p.vr, vs0: p.vs0, vne: p.vne,
  };
}
