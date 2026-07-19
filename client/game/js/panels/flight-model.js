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
const GROUND_EFFECT_FT = 26;      // AGL band (~a wingspan) where the wing rides a lift cushion → float + flare to land (kept close to the deck so the cushion doesn't arrest the sink a whole wingspan up and float her down the runway)
const HELI_GROUND_EFFECT_FT = 40; // AGL band (~a rotor diameter) where the downwash piles into a lift cushion → soft settle onto the skids

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
    ceiling: 12500,       // service ceiling (ft) — climb performance fades to zero here (thin air)
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
    name: 'Mule', mass: 2.8, thrustMax: 36, vr: 65, vs0: 46, vne: 185, cruise: 165,
    pitchRate: 9, pitchTau: 0.8, rollRate: 40, rollTau: 0.7, engineLag: 1.7,
    pitchStable: 0.88, rollStable: 1.0, dragP: 0.00090, flapDrag: 0.65, flapLift: 0.5, flapVs: 0.24,
    rollFric: 1.4, aoaCrit: 18, liftScale: 1.0, vsMax: 1800, vsGain: 1800, vsTau: 0.95,
    brake: 6.0, groundSteer: 26, ceiling: 17000, bestGlide: 65,
  },
  // Leviathan — 4-engine heavy-lift freighter, an ANTONOV AN-124 RUSLAN analogue: HEAVY first —
  // ponderous to accelerate and steer, a long roll, an unremarkable level cruise (no faster
  // than the Mule despite its size).
  // But it's a slippery, low-drag airframe with huge inertia and a high Vne, so it BUILDS and
  // holds real speed once it has momentum behind it in a dive. Strong brakes (biggest wheels),
  // but the ~95 kt touchdown still makes for a long rollout — it needs a real runway.
  leviathan: {
    // Character (per author direction): HEAVY and SLOW ON TOP, but a strong hauler with the
    // longest legs in the fleet. Three levers set that without touching her takeoff:
    //  • SLOWER TOP SPEED — the top end is where thrust==parasitic drag, so dragP is raised
    //    hard (0.00065→0.0034). At full power she now tops out ~185 kt (slowest of the mid/heavy
    //    set) instead of running away. vne dropped to 200 as the matching redline reference.
    //  • GOOD ACCELERATION + SAME TAKEOFF — the extra drag barely bites at the low speeds of the
    //    ground roll, but to keep the exact rotation-speed accel the takeoff was tuned for, thrust
    //    is bumped (104→120) to offset the new drag at Vr. Net force at 95 kt is ~unchanged, so
    //    she still reaches rotation before the end of the strip; low-speed punch is if anything
    //    a touch stronger.
    //  • FLIES HEAVY — slower control rates + longer build-up + weaker self-level, so she's
    //    ponderous to react (you fly her well ahead of the aircraft).
    name: 'Leviathan', mass: 5.0, thrustMax: 120, vr: 95, vs0: 64, vne: 200, cruise: 155,
    pitchRate: 5, pitchTau: 1.3, rollRate: 18, rollTau: 1.45, engineLag: 2.6,
    pitchStable: 0.58, rollStable: 0.7, dragP: 0.0034, flapDrag: 0.7, flapLift: 0.45, flapVs: 0.2,
    // Climb performance unchanged (she must still climb away from the field once rolling); the
    // faster top speed is gone but the field performance is not.
    rollFric: 1.2, aoaCrit: 16, liftScale: 1.0, vsMax: 2700, vsGain: 2500, vsTau: 1.05,
    brake: 8.0, groundSteer: 16, ceiling: 23000,   // cruises high, above the weather — the fleet's highest ceiling
    // A touch of dead-stick induced drag keeps the engine-out glide believable for a heavy
    // (no albatross float) without touching powered cruise or climb. Best glide ~89 kt.
    glideDrag: 0.0019, bestGlide: 89,
  },
  // Reaper — a Fairchild A-10 WARTHOG analogue: the gun IS the plane. NOT a fighter —
  // slow, draggy and heavy, but a rock-stable low-level platform that loiters over the
  // target and shrugs off ground fire. It can't run (high drag bleeds any dive), it just
  // keeps coming. Twin turbofans, forgiving low-speed handling, rough-field capable.
  reaper: {
    // ROCKET OFF THE DECK (per author direction): thrustMax 50→92 gives her by far the best
    // thrust-to-mass in the fleet (~27 kt/s), so she practically leaps off the runway and
    // climbs out like she's shot from a rail (vsMax 2400→3600, vsGain 2200→3000, engineLag
    // 1.3→1.0 for a snappier spool).
    // NOW SHE RUNS TOO (per author direction): dragP dropped 0.00209→0.00140 so thrust==drag
    // lands the level top end near √(92/0.00140)≈256 kt — much faster flat-out — and vne is
    // opened to 270 to match. The extra speed barely touches the ground roll (drag ∝ V²).
    // LESS FLOATY SLOW: vs0 34→39 raises the weight anchor (weightOf ∝ vs0²) so she flies
    // heavier — at low speed the lift deficit bites sooner and she settles instead of hanging —
    // and vsTau 1.0→0.85 makes her vertical response snappier (less wallow), while a strong
    // thrust-to-mass keeps takeoff punch intact despite the extra weight.
    name: 'Reaper', mass: 3.4, thrustMax: 92, vr: 54, vs0: 39, vne: 270, cruise: 165,
    pitchRate: 10, pitchTau: 0.7, rollRate: 58, rollTau: 0.6, engineLag: 1.0,
    pitchStable: 1.1, rollStable: 1.3, dragP: 0.00140, flapDrag: 0.6, flapLift: 0.42, flapVs: 0.2,
    rollFric: 1.5, aoaCrit: 21, liftScale: 1.0, vsMax: 3600, vsGain: 3000, vsTau: 0.85,
    brake: 7.5, groundSteer: 28, ceiling: 17000, bestGlide: 76,
    // COVERS GROUND FAST (per author direction): the strike platform eats distance between targets.
    // A pure world-travel multiplier — the terrain scrolls past ~1.7× for the same airspeed, so she
    // gets across the map without touching handling/stall/energy (read in the sim's world-translate).
    worldPaceMult: 1.7,
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
    cyclicThrust: 3.2,                    // disc-tilt → horizontal accel (kt/s per deg of lean)
    dragP: 0.0019,                        // draggy body: bleeds speed, modest top end
    liftMax: 2.7, hoverThrust: 1.0,       // collective×Nr vertical lift authority vs hover weight
    // Gentle vertical response so the hover isn't twitchy: a small collective error off the
    // hover point gives a modest vs (low vsGain), and vs eases in with real inertia (higher
    // vsTau) instead of snapping to the cap the instant you lift a skid off the ground.
    vsGain: 850, vsMax: 1300, vsTau: 0.9,
    vrsVs: 480,                           // settling-with-power onset (fpm sink) when slow + powered
    rollFric: 11,                         // skid friction on the ground — skids bite and stop her quickly (no long rollout)
    ceiling: 15000,
  },
  // Carcass — salvaged wreck: underpowered, draggy, unstable. A junker you nurse into the air.
  carcass: {
    name: 'Carcass', mass: 1.4, thrustMax: 14, vr: 44, vs0: 28, vne: 115, cruise: 72,
    pitchRate: 11, pitchTau: 0.5, rollRate: 50, rollTau: 0.5, engineLag: 1.5,
    pitchStable: 0.7, rollStable: 0.8, dragP: 0.00120, flapDrag: 0.55, flapLift: 0.32, flapVs: 0.17,
    rollFric: 1.7, aoaCrit: 17, liftScale: 0.95, vsMax: 900, vsGain: 1650, vsTau: 1.0,
    brake: 5.0, groundSteer: 30, ceiling: 11000, bestGlide: 45,
  },
  // Grasshopper — a PIPER L-4 analogue: a featherweight tandem liaison taildragger. Docile and
  // SLOW: floats off in a few yards, very stall-resistant, gentle rates — the forgiving scout you
  // fly hands-off. No speed and a low ceiling; the wind pushes her around.
  grasshopper: {
    name: 'Grasshopper', mass: 0.85, thrustMax: 9.5, vr: 34, vs0: 21, vne: 105, cruise: 68,
    pitchRate: 11, pitchTau: 0.62, rollRate: 44, rollTau: 0.6, engineLag: 1.35,
    pitchStable: 1.0, rollStable: 1.2, dragP: 0.00120, flapDrag: 0.5, flapLift: 0.32, flapVs: 0.16,
    rollFric: 1.7, aoaCrit: 20, liftScale: 1.0, vsMax: 480, vsGain: 1500, vsTau: 1.0,
    brake: 5.2, groundSteer: 32, ceiling: 11000, bestGlide: 44,
    groundPitch: 11,   // taildragger 3-point sit (deg nose-up): rests on the tailwheel; push forward to raise the tail on the roll
  },
  // Locust — a low-wing CROP-DUSTER / ag-plane (Air Tractor analogue): a heavy, honest low-and-slow
  // worker. Flies loaded with a chemical hopper, so she's HEAVY and DOCILE — gentle, unhurried rates,
  // strong self-level (hands-off over the field), a big draggy square wing that's very stall-resistant
  // and won't run away on top. Low ceiling — she works down in the weeds, not up high.
  locust: {
    name: 'Locust', mass: 1.35, thrustMax: 13, vr: 44, vs0: 30, vne: 125, cruise: 92,
    pitchRate: 9, pitchTau: 0.65, rollRate: 42, rollTau: 0.62, engineLag: 1.4,
    pitchStable: 1.05, rollStable: 1.25, dragP: 0.00150, flapDrag: 0.55, flapLift: 0.4, flapVs: 0.2,
    rollFric: 1.7, aoaCrit: 20, liftScale: 1.0, vsMax: 750, vsGain: 1550, vsTau: 1.0,
    brake: 5.5, groundSteer: 30, ceiling: 9500, bestGlide: 55,
    groundPitch: 10,   // taildragger 3-point sit (deg nose-up): rests on the tailwheel
  },
};

// The lift-curve constants: CL0 is the coefficient at zero AoA, CL_ALPHA the per-degree slope.
// They anchor both the weight the wing carries (weightOf) and the AoA the wing needs to hold 1g
// at a given speed (the flight-path energy model in step §7).
const CL0 = 0.28, CL_ALPHA = 0.09;
const STALL_HOLD = 1.9;   // seconds below stall speed before lift actually collapses (raised: a slow flare has more grace before it lets go, so you can bleed to touchdown speed without stalling)

// Weight the model holds up. Anchored at the STALL point — at the clean stall speed
// the wing at its max lift coefficient just holds the aircraft up. This makes the
// envelope self-consistent: you can fly (barely) at Vr just above the stall, cruise
// sits at a low trim AoA, and lift falls below weight only when you're too slow.
function weightOf(p) { return 0.5 * p.vs0 * p.vs0 * (CL0 + CL_ALPHA * p.aoaCrit) * p.liftScale; }

export function createState(p) {
  return {
    airspeed: 0, altitude: 0, pitch: p.groundPitch || 0, bank: 0, heading: 0,   // taildraggers start parked nose-high on the tailwheel
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
  // Cyclic folds in TRIM so a centred stick holds the trimmed attitude hands-off — roll in a
  // little forward (nose-down) trim and she cruises forward without holding the stick.
  const cycP = clamp((input.elevator || 0) + (input.trim || 0), -1, 1);   // aft (+1) = nose up / decelerate
  const cycR = clamp(input.aileron || 0, -1, 1);     // right (+1) = bank right
  const coll = clamp(input.collRaw ?? input.throttle ?? 0, 0, 1);   // collective lever — the pilot works it even engine-out (for autorotation)
  const powered = input.power !== false;             // engine driving the rotor (false ⇒ dead engine, autorotation)
  const pedal = clamp(input.pedal || 0, -1, 1);

  // 1. Rotor Nr.
  //  • POWERED: Nr eases toward the governed demand, DROOPING if a greedy collective outruns the
  //    little two-stroke — the classic low-rotor trap (less Nr → less thrust → you sink pulling up).
  //  • ENGINE-OUT (autorotation): the rotor is an autogyro — the UPFLOW of a real descent drives it.
  //    FLAT pitch (collective down) lets it freewheel and hold Nr; pulling collective loads the disc
  //    and BLEEDS the rpm. So the drill is: drop the lever, drop the nose to keep air flowing up
  //    through the disc, and the rotor keeps turning all the way down — energy you spend in the flare.
  let nrTarget;
  if (powered) {
    nrTarget = coll > 0.02 ? clamp(1 - Math.max(0, coll - 0.7) * 1.8, 0.4, 1) : 0;
  } else {
    const airDrive = clamp(Math.max(0, -s.vs) / 900 + Math.abs(s.airspeed) / p.cruise * 0.45, 0, 1.15);
    nrTarget = clamp(airDrive * (1 - coll * 0.8), 0, 1);   // low collective = full autorotative Nr; over-pitch and it winds down
  }
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

  // 4. Horizontal accel: the tilted disc pushes you where the nose leans (nose down = forward),
  //    AND a nose-low attitude lets gravity pull you into the dive — so pushing the nose down
  //    builds real speed (an autorotative dive), not just the gentle disc-tilt nudge.
  const accel = s.onGround ? 0 : (-s.pitch * (p.cyclicThrust || 2) * Nr) + clamp(-s.pitch, 0, 35) * 0.16;
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
    // Vortex ring is a POWERED phenomenon — an engine-out autorotative descent can't fall into it.
    if (powered && !s.onGround && s.vs < -(p.vrsVs || 480) && slow && coll > 0.4) s.vrsState = true;
  } else if (s.onGround || !slow || coll < 0.25 || !powered) {
    s.vrsState = false;
  }
  let vrs = 0;
  if (s.vrsState) {
    vrs = clamp((-s.vs - 200) / 700, 0.4, 1);
    thrustV = Math.min(thrustV, (p.hoverThrust || 1) * (1 - 0.55 * vrs));
    if (!s.vrsWarn) { s.events.push({ type: 'vrs' }); s.vrsWarn = true; }
  } else s.vrsWarn = false;
  // Sink HARDER than she climbs — chop the collective (or droop Nr) and the underpowered kit
  // heli drops away in a deep autorotative descent instead of mushing down gently.
  const deficit = thrustV / (p.hoverThrust || 1) - 1;
  let vsTarget = clamp(deficit * (deficit < 0 ? p.vsGain * 1.9 : p.vsGain), -p.vsMax * 2.6, p.vsMax);
  // Ground cushion (in-ground-effect): within ~a rotor-diameter of the deck the downwash piles
  // into a lift cushion, so a descent SOFTENS as you near the ground — she eases onto the skids
  // instead of dropping the last few feet. Sink only; hover and climb are untouched.
  if (!s.onGround && vsTarget < 0 && s.altitude < HELI_GROUND_EFFECT_FT) {
    const ge = 1 - s.altitude / HELI_GROUND_EFFECT_FT;   // 0 at the top of the band → 1 on the deck
    vsTarget *= 1 - 0.5 * ge * ge;
  }
  if (s.onGround && vsTarget <= 0) s.vs = 0;
  else { s.vs += (vsTarget - s.vs) * Math.min(1, dt / p.vsTau); s.altitude += (s.vs / 60) * dt; }

  // 6. Warnings the HUD/horn read: low rotor RPM + settling. No aerodynamic stall on a heli.
  s.aoa = 0; s.stalled = false;
  s.autorot = !powered && !s.onGround;               // engine-out: flying it down on the freewheeling rotor
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
  // Elevator + trim: the trim wheel biases the yoke's neutral point, so a centred yoke
  // holds the attitude the trim commands (hands-off cruise/climb). Combined, then clamped.
  const elevator = clamp((input.elevator || 0) + (input.trim || 0), -1, 1);
  const aileron = clamp(input.aileron || 0, -1, 1);
  const throttle = clamp(input.throttle || 0, 0, 1);
  const flaps = clamp(input.flaps || 0, 0, 1);
  const pedal = clamp(input.pedal || 0, -1, 1);   // rudder: yaws the nose (flat/skidding turn) airborne, steers the nosewheel on the ground
  const weight = weightOf(p);

  // Battle damage: sheared structural surfaces (from the server, via input.dmgSurf = {leftWing,
  // rightWing,tail,rudder} where 0 = gone). A missing wing makes no lift on its side, so she rolls
  // AND yaws toward the dead side and sinks — you fight the stick to limp home. Tail/rudder loss
  // costs pitch/yaw authority. This is the same asymmetry the stall wing-drop below already models,
  // just from lost structure instead of a stalled wing. See §4/§5/§7 for where each bites.
  const surf = input.dmgSurf || null;
  const lwGone = surf?.leftWing === 0, rwGone = surf?.rightWing === 0;
  const tailGone = surf?.tail === 0, rudderGone = surf?.rudder === 0;
  const bothWings = lwGone && rwGone;
  const wingDead = bothWings ? 0 : (lwGone ? -1 : (rwGone ? 1 : 0));   // sign toward the missing wing (0 = none/both)
  const oneWing = wingDead !== 0;
  const WING_ROLL = 34, WING_YAW = 26;   // deg/s roll & yaw pulled toward the dead wing — tuned to be fightable with full opposite aileron, not an instant unrecoverable spiral

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
  if (s.onGround && p.groundPitch) {
    // TAILDRAGGER ground attitude: she rests nose-high on the tailwheel at `groundPitch`. Forward
    // stick + airflow over the tail (which needs roll speed to bite) RAISES THE TAIL — pitch comes
    // down toward level; neutral/back stick pins the 3-point sit (you can't rotate past it, the
    // tailwheel's already planted). Left alone she flies off in the 3-point at ~Vr; raise the tail
    // for a faster wheel-takeoff. Overrides the tricycle rotate below while the wheels are down.
    const tailAuth = clamp(s.airspeed / p.vr, 0, 1);                          // no airflow, no tail authority
    const push = clamp(-s.elevEff, 0, 1);                                     // forward yoke lifts the tail
    const target = p.groundPitch - push * tailAuth * (p.groundPitch + 4);     // full forward + rolling → tail up (~−4°)
    s.pitch += (target - s.pitch) * Math.min(1, dt * 3.5);
    s.pitch = clamp(s.pitch, -4, p.groundPitch);
  } else {
    const pitchResist = 1 - 0.55 * Math.abs(s.pitch) / 48;   // scaled to the wider ±48° envelope
    const pitchCmd = s.elevEff * p.pitchRate * auth * pitchResist * (tailGone ? 0.35 : 1);   // sheared tailplane → mushy elevator
    s.pitch += (pitchCmd - p.pitchStable * s.pitch * (1 - Math.abs(s.elevEff))) * dt;
    if (tailGone && !s.onGround) s.pitch -= 16 * dt;   // lost tail downforce → the nose tucks under
    // Rotation attitude is gear-limited while the mains are still down — without this a held
    // back-pressure keeps pitching (and AoA) up toward the full airborne limit before liftoff,
    // and since the airborne stall-collapse never engages on the ground, the AoA² drag term
    // below climbs unbounded and can pin airspeed short of flying speed forever. 15° is a
    // generous real-world rotation attitude; airborne gets the full ±48° envelope (more yoke
    // play — you can push the nose noticeably further down and haul it further up).
    s.pitch = clamp(s.pitch, s.onGround ? -5 : -48, s.onGround ? 15 : 48);
  }

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
    if (oneWing) s.bank += wingDead * WING_ROLL * dt;   // the lift-less side drops away — hold full opposite aileron to keep her level
    s.bank = clamp(s.bank, oneWing ? -85 : -70, oneWing ? 85 : 70);
  }

  // 5. Heading: a coordinated turn from bank (rate ∝ tan(bank)/speed) PLUS a direct yaw from the
  //    rudder — a flat, skidding turn that swings the nose without banking. Rudder authority builds
  //    with airspeed like the yoke (mushy below Vr), so it's a real control in the air: crab the
  //    crosswind, skid a flat turn, or kick the nose straight on final. No airspeed → no yaw.
  const rudderYaw = p.rudderYaw ?? clamp(15 / Math.sqrt(p.mass || 1), 4, 18);   // deg/s at full rudder & full authority (mass-scaled: heavier = lazier)
  if (s.airspeed > 1 && !s.onGround) {
    const turnRate = (G_KT * Math.tan(s.bank * D2R)) / Math.max(p.vs0, s.airspeed) * R2D;
    let yaw = turnRate + pedal * rudderYaw * auth * (rudderGone ? 0 : 1);   // sheared rudder → no pedal yaw
    if (oneWing) yaw += wingDead * WING_YAW;   // adverse yaw dragging the nose toward the dead wing (into the incipient spin)
    s.heading = wrap360(s.heading + yaw * dt);
  } else if (s.onGround && s.airspeed > 0.3) {
    // Nosewheel/tiller steering on the ground — aileron OR rudder pedals swing the nose to taxi
    // (mobile has no pedals, so aileron still steers). Needs a little roll speed to bite and fades
    // toward rotation so you don't swerve at Vr.
    const steerAuth = clamp(s.airspeed / 5, 0, 1) * clamp((p.vr - s.airspeed) / p.vr, 0, 1);
    const steer = clamp(aileron + pedal, -1, 1);
    s.heading = wrap360(s.heading + steer * (p.groundSteer || 0) * steerAuth * dt);
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
  // A banked turn only loads the wing (raising the stall speed) to the extent you're pulling
  // to hold/gain altitude. Geometric level-turn load is 1/cos(bank); we scale the EXTRA load
  // above 1g by how hard you're actually hauling back (elevEff). Hands-off or nose-down — i.e.
  // NOT climbing — the turn stays nearly unloaded, so you can crank it around near the stall
  // speed without dropping out of the sky; only a sustained climbing turn bites like before.
  const pull = clamp(s.elevEff, 0, 1);
  const loadFactor = 1 + (1 / Math.max(0.35, Math.cos(s.bank * D2R)) - 1) * (0.3 + 0.7 * pull);
  const stallSpeed = p.vs0 * Math.sqrt(loadFactor) / (1 + flaps * p.flapVs);
  s.stallMargin = clamp((s.airspeed / stallSpeed - 1) / 0.3, 0, 1);
  const wasStalled = s.stalled;
  // Stall needs slow AND high AoA (nose up). Nosing DOWN drops the AoA, so a dive
  // always builds speed and recovers — it can never stall.
  // HYSTERESIS so she breaks crisply AT the stall speed instead of far below it: as the wing bleeds
  // toward Vs it mushes and sinks, and that sink builds speed back over Vs (§8) — which kept nudging
  // airspeed a hair above the threshold and RESETTING the timer, so the break only ever committed
  // once energy was truly gone (~½ Vs, a long parachuting mush). Once she first dips below Vs at high
  // AoA the break ARMS and stays armed through that mush jitter; it only disarms when speed genuinely
  // recovers (>1.08·Vs) or the nose drops (AoA < 4). Net: a clean wing-drop right at the stall speed.
  // FLARE = flaps out or in ground effect: keep the ORIGINAL forgiving behaviour untouched (plain
  // threshold, the long STALL_HOLD grace) so you can bleed to touchdown speed without letting go.
  // The crisp break + hysteresis apply ONLY up high & clean — that's where the classic wing-drop lives.
  const flareRegime = flaps > 0.2 || s.altitude < GROUND_EFFECT_FT;
  const armSpeed = flareRegime ? stallSpeed : (s.stallTimer > 0 ? stallSpeed * 1.08 : stallSpeed * 1.04);
  const preStall = !s.onGround && s.airspeed < armSpeed && s.aoa > 4;
  // Recovers FAST the instant you unload — level out with power (speed climbs back over
  // the stall speed) or nose down (AoA drops below 4) and the timer bleeds off quickly.
  const stallHold = flareRegime ? STALL_HOLD : 0.5;
  s.stallTimer = preStall ? s.stallTimer + dt : Math.max(0, s.stallTimer - dt * 6);
  s.stalled = s.stallTimer >= stallHold;
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

  // 7. Vertical motion — a FLIGHT-PATH ENERGY model (the rollercoaster). The velocity vector
  //    chases where the NOSE points, offset by the angle of attack the wing needs to carry its
  //    own weight at this speed:  γ_target = pitch − α_trim.
  //      • FAST → the wing needs little AoA → γ ≈ pitch, so she goes exactly where she's pointed.
  //        Nose DOWN and you DESCEND — and §8's gravity term trades that height for speed. You can
  //        NOT hold altitude with the nose down (no "nose-low hover" — no level nose-down strafe).
  //      • SLOW → the wing needs a big AoA → γ droops well below the nose (she mushes and sinks);
  //        a hard BANK spills lift the same way (a steep turn sinks unless you pull / add power).
  //    Because a climb bleeds speed (§8) which RAISES α_trim, a sustained zoom tapers itself off as
  //    the energy runs out, and a dive builds speed you can zoom back into height — the coaster:
  //    energy sloshes between altitude and airspeed instead of appearing out of the yoke. Hands-off
  //    the nose self-levels toward pitch 0 (§3) → γ→0 → she holds altitude, no ballooning term needed.
  const flapLiftF = 1 + flaps * p.flapLift;                  // flaps buy lift → less AoA to stay up → fly slower with the nose lower (eases the approach)
  const wingLiftMult = bothWings ? 0.15 : (oneWing ? 0.55 : 1);   // a sheared wing gives up half the lift budget → she sinks and stalls sooner; both gone = a brick
  const dynBank = 0.5 * s.airspeed * s.airspeed * p.liftScale * Math.cos(s.bank * D2R) * wingLiftMult;   // vertical dynamic-pressure budget (a bank spills it; battle damage steals it)
  const clNeed = weight / Math.max(20, dynBank);             // lift coefficient the wing must make to hold 1g
  const aoaTrim = clamp((clNeed / flapLiftF - CL0) / CL_ALPHA, 0, p.aoaCrit);   // AoA that buys it; saturates at the critical angle → mush/sink
  let vsTarget = s.airspeed * 101.33 * Math.sin((s.pitch - aoaTrim) * D2R);     // ft/min along the commanded flight path (1 kt = 101.33 ft/min)
  // A real, sustained stall dumps the wing: the path collapses well past even the mushing sink so
  // the eye-height drops away (the "falling out of the sky" feel). A held stall sinks hardest.
  if (s.stalled) vsTarget = Math.min(vsTarget, -p.vsMax * (s.elevEff > 0.3 ? 2.4 : 1.4));
  // Service ceiling: climb authority fades to zero as the air thins toward p.ceiling (descent is
  // untouched). A brief zoom can still trade speed for height above it — you just can't SUSTAIN a climb.
  const ceil = p.ceiling || 20000;
  if (vsTarget > 0) vsTarget *= clamp((ceil - s.altitude) / (ceil * 0.4), 0, 1);
  // Ground effect: within ~a wingspan of the deck the wing rides a cushion of trapped air — the
  // sink softens so she FLOATS and you FLARE her on instead of driving her into the runway. A firm,
  // wide cushion makes the touchdown forgiving — a slightly-fast/high-sink arrival still settles.
  if (!s.onGround && vsTarget < 0 && s.altitude < GROUND_EFFECT_FT) {
    const ge = 1 - s.altitude / GROUND_EFFECT_FT;   // 0 at the top of the band → 1 on the deck
    vsTarget *= 1 - 0.45 * ge * ge;                 // softens the sink near the deck without cancelling it — she still settles onto the runway instead of floating
  }
  if (s.onGround && vsTarget <= 0) {
    s.vs = 0;                                 // sitting on the wheels — no lift to climb on
  } else {
    s.vs += (vsTarget - s.vs) * Math.min(1, dt / p.vsTau);
    s.altitude += (s.vs / 60) * dt;
  }

  // 8. Airspeed: thrust − drag − the gravity component of pitch (climbing bleeds
  //    speed) − ground friction while rolling.
  // Nose-down at low power the airframe is clean + unloaded, so it sheds parasitic drag and a
  // descent BUILDS speed (gravity beats drag) — a real glide/dive accelerates well past cruise.
  // Fades in with how far the nose is below the horizon and only at low throttle, so powered
  // level flight, cruise and top speed are all untouched; it's gone the moment you level out.
  // A nose-down attitude cleans and unloads the airframe: parasitic drag falls away so gravity
  // wins and ANY dive accelerates hard past cruise — regardless of power, not just a dead-stick
  // glide. Ramps in with how far the nose is below the horizon and is gone the instant you level
  // out (pitch → 0), so powered level flight, cruise and top speed stay untouched.
  const diveClean = s.pitch < 0 ? clamp(-s.pitch / 11, 0, 1) : 0;   // ramps in FAST — nose down and she cleans up and accelerates hard (full by ~11° down)
  // Gear drag: extended RETRACTABLE gear hangs into the airstream and bleeds speed (∝ V²), a real
  // penalty for cruising with the wheels down. Scaled as a fraction of the airframe's own parasitic
  // drag (per-type via gearDragFrac, default 0.35) so it's proportioned to each craft. `input.gear`
  // is the extended fraction (0 = up, 1 = down); fixed-gear craft pass 0 (drag already in dragP).
  const gearExt = clamp(input.gear || 0, 0, 1);
  const drag = (p.dragP + flaps * p.flapDrag * 0.0022) * s.airspeed * s.airspeed * (1 - 0.9 * diveClean)  // parasitic drag ∝ V² (almost all shed in a dive → gravity wins and speed builds quickly). Flap drag term raised so extending flaps bleeds speed decisively on final — you can get slow for the touchdown zone instead of floating past it (overshoot)
             + gearExt * (p.gearDragFrac ?? 0.35) * p.dragP * s.airspeed * s.airspeed                     // gear-down parasitic drag (retractable craft only)
             + Math.max(0, s.aoa) ** 2 * 0.0016 * s.airspeed                    // profile-drag rise with a hard PULL only — a nose-down push (negative AoA) doesn't load the wing, so it never penalises a dive
             + (p.glideDrag || 0) * Math.max(0, 1 - s.rpm / 0.4) * (weight * weight) / (s.airspeed * s.airspeed + 40);   // DEAD-STICK induced drag (∝ 1/V²): engages only as the powerplant winds down toward idle (rpm below ~0.4), full at a stopped/windmilling engine. It penalises the SLOW end of a glide, so best-glide sits at a sensible speed with a realistic ratio instead of floating forever just above the stall — and because it's gated to low rpm it leaves ALL powered cruise/climb untouched. Per-type; unset ⇒ 0 (legacy floaty glide).
  // Gravity accelerates the airframe along its actual VELOCITY VECTOR (the flight-path angle γ),
  // not along where the NOSE points. Fast/powered/diving the wing carries its weight at a low AoA
  // so γ≈pitch and this is identical to before (cruise, climb, top speed, dive all untouched). They
  // only diverge when the wing MUSHES (slow, high AoA): the nose sits shallow but the plane sinks
  // steeply — and that steep descent must build speed back. Crediting pitch instead of γ there made
  // the sink "free" energy loss, so a shallow glide bled off into a stall instead of settling; using
  // γ closes the energy loop, so a slightly-nose-down attitude self-trims to a stable glide speed.
  const grav = G_KT * Math.sin(gamma * D2R);
  // Ground friction: idle rolling drag, plus wheel brakes from FORWARD pressure (push the
  // yoke, elevator < 0). Pushing also pins the nose to the runway, so braking never fights
  // the back-pressure you use to rotate and lift off — they're opposite gestures.
  // Forward yoke works the wheel brakes — EXCEPT on a taildragger, where forward stick is the
  // tail-raise gesture on the takeoff roll (toe brakes, not stick brakes), so it must not fight it.
  const brake = (s.onGround && !p.groundPitch) ? clamp(-elevator, 0, 1) * (p.brake || 0) : 0;
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
