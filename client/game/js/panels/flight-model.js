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
// Dive drag-shed (feel knob, NOT physics): fraction of parasitic drag a full nose-down attitude
// removes, letting a dive accelerate faster than gravity-along-γ alone would. Lower = leans on the
// real energy loop (gravity trades height for speed) instead of faking punch by deleting drag.
// Was a hardcoded 0.9, which was pure fakery — it terminal'd dives at 3–4× Vne (a DEAD-STICK dive
// hit 4× cruise). Measured down to 0.2 with scripts/dive-tune.mjs: a committed dive still redlines
// at Vne (real gravity does it) and a dead-stick dive still builds ~1.3× cruise, but the redline is
// now reached by committing pitch, not by deleting the airframe's drag. Dive ONSET acceleration is
// unchanged (it's gravity, not this term). Per-type override via p.diveShed if an airframe wants more.
const DIVE_SHED = 0.2;
// Forward slip — CROSSED CONTROLS (a held bank against OPPOSITE rudder) fly the fuselage sideways
// to the airflow. It adds a lot of drag and spills some lift, so you sink STEEPLY WITHOUT gaining
// speed (the drag eats the descent's energy) — the classic salvage-a-high/hot-approach or crosswind
// technique. No net turn: §5's bank-turn and rudder-yaw already oppose when the controls are crossed.
const SLIP_DRAG = 0.0005;   // extra parasitic drag ∝ V² per unit slip — sized to cancel the added sink's gravity so a slip HOLDS speed while it sinks (not so draggy it bleeds you into a stall)
const SLIP_SINK = 4.0;      // extra sink per unit slip, as fpm PER KNOT of airspeed (energy-proportional: a slow light plane isn't over-sunk into a stall, a fast one drops harder)
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
    dragP: 0.000889,      // parasitic drag coeff (∝ airspeed²) — low, so it holds speed climbing. Trimmed from 0.00100 when real induced drag arrived: the fleet's dragP values were fitted to hit each type's authored top end WITHOUT an induced term, so adding one cost everyone 3–5% of top speed, climb and cruise. Each type's dragP was re-solved to put its level top speed back exactly where it was — the polar gained a back side without the fleet getting slower

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
    ceiling: 28000,       // service ceiling (ft) — climb performance fades to zero here (thin air)
    ldMax: 7.4,           // best glide RATIO — sets the induced-drag coefficient, and `bestGlide` (the BLUE yoke light) is derived from it
    gLimit: 4.4,          // structural g limit — exceed it and the model fires an `overg` event
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
    pitchStable: 0.88, rollStable: 1.0, dragP: 0.000828, flapDrag: 0.65, flapLift: 0.5, flapVs: 0.24,
    rollFric: 1.4, aoaCrit: 18, liftScale: 1.0, vsMax: 1800, vsGain: 1800, vsTau: 0.95,
    brake: 6.0, groundSteer: 26, ceiling: 34000, ldMax: 7.6, gLimit: 3.8,
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
    pitchStable: 0.58, rollStable: 0.7, dragP: 0.00321, flapDrag: 0.7, flapLift: 0.45, flapVs: 0.2,
    // Climb performance unchanged (she must still climb away from the field once rolling); the
    // faster top speed is gone but the field performance is not.
    rollFric: 1.2, aoaCrit: 16, liftScale: 1.0, vsMax: 2700, vsGain: 2500, vsTau: 1.05,
    brake: 8.0, groundSteer: 16, ceiling: 41000,   // cruises high, above the weather — the fleet's highest ceiling
    // She glides like the brick she is (no albatross float). This used to need a bespoke
    // rpm-gated `glideDrag` patch because the shared polar had no induced drag at all; now
    // it's just the fleet's lowest ldMax, and best glide (~76 kt) falls out of the polar.
    ldMax: 2.4, gLimit: 2.5,
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
    pitchStable: 1.1, rollStable: 1.3, dragP: 0.00130, flapDrag: 0.6, flapLift: 0.42, flapVs: 0.2,
    rollFric: 1.5, aoaCrit: 21, liftScale: 1.0, vsMax: 3600, vsGain: 3000, vsTau: 0.85,
    brake: 7.5, groundSteer: 28, ceiling: 34000, ldMax: 7.6, gLimit: 6.0,
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
    // vsMax is a CLAMP, not a climb rate: on the heli branch the achievable vs comes out of the
    // thrust-deficit formula below (best rate sits at the droop knee, ~0.7 collective — past that
    // Nr droops faster than the lever gains). vsGainUp is what actually sets the climb, and it is
    // the right knob because it is the climb-ONLY gain: she goes up harder without dropping away
    // any harder when you chop the lever. The ceiling fade still governs how high she gets, and
    // vsGain how twitchy the hover is. vsMax is raised to stay clear of the new rate rather than
    // quietly becoming the thing that decides it.
    vsGain: 850, vsGainUp: 1400, vsMax: 1900, vsTau: 0.9,   // ~1720 fpm at the droop knee
    vrsVs: 480,                           // settling-with-power onset (fpm sink) when slow + powered
    rollFric: 11,                         // skid friction on the ground — skids bite and stop her quickly (no long rollout)
    ceiling: 32000,
  },
  // Viper — the attack helicopter (an Apache reimagined). Flies the SAME heli branch as the
  // Dragonfly (collective + cyclic + pedals) — it is not a fixed-wing — but it's a far bigger,
  // heavier, more powerful airframe: nearly three times the mass, a slippery high-speed body
  // (fastest rotorcraft in the fleet), and a stabilised flight-control system, so it's steady
  // where the Mini 500 is twitchy — firmer self-level, slower-building cyclic, less pedal
  // authority — while still turning hard for its size. Heavy disc loading means it drops into
  // its own downwash later but sinks harder when it does.
  viper: {
    name: 'Viper', heli: true, mass: 2.6,
    vne: 190, cruise: 150, vs0: 22,       // vs0 doubles as the translational-lift (ETL) speed
    vr: 0, aoaCrit: 90, liftScale: 1,
    pitchRate: 22, pitchTau: 0.5, rollRate: 40, rollTau: 0.45,   // authoritative but heavier cyclic
    pitchStable: 1.0, rollStable: 1.15,   // stabilised FCS — she holds an attitude you set
    yawRate: 68,                          // big tail rotor on a long boom: slower pedal turns than the Mini 500
    engineLag: 1.2,                       // twin turbines spool slower than a piston kit-heli
    cyclicThrust: 5.0,                    // heavy, powerful disc — real acceleration off a lean
    dragP: 0.00105,                       // slippery armoured body: holds speed, high top end
    liftMax: 2.4, hoverThrust: 1.0,       // strong power margin even loaded on the rails
    // A GUNSHIP SHOULD OUT-CLIMB THE KIT HELI, and this line said so while doing the
    // opposite. The deficit is `coll·Nr·liftMax / hoverThrust − 1`, and the Viper's
    // liftMax (2.4) is LOWER than the Dragonfly's (2.7) because she is heavier for her
    // disc — so at the droop knee she made ~0.98 against the Mini 500's ~1.23, and the
    // old 1250 gain turned that into a slower absolute climb than the kit heli's.
    // Corrected on the gain rather than on liftMax, which would also have moved her
    // hover authority and where she falls into her own downwash.
    vsGain: 1000, vsGainUp: 2100, vsMax: 2800, vsTau: 1.0,   // ~2050 fpm at the droop knee
    vrsVs: 620,                           // high disc loading — settles later, then bites harder
    rollFric: 9,                          // wheeled gear, but she stops short (no rollout)
    ceiling: 34000,
    groundPitch: 7,   // TAILDRAGGER: mains forward, tailwheel on the boom — she squats nose-high parked, flies the tail off first
  },
  // Carcass — salvaged wreck: underpowered, draggy, unstable. A junker you nurse into the air.
  carcass: {
    name: 'Carcass', mass: 1.4, thrustMax: 14, vr: 44, vs0: 28, vne: 115, cruise: 72,
    pitchRate: 11, pitchTau: 0.5, rollRate: 50, rollTau: 0.5, engineLag: 1.5,
    pitchStable: 0.7, rollStable: 0.8, dragP: 0.00107, flapDrag: 0.55, flapLift: 0.32, flapVs: 0.17,
    rollFric: 1.7, aoaCrit: 17, liftScale: 0.95, vsMax: 900, vsGain: 1650, vsTau: 1.0,
    brake: 5.0, groundSteer: 30, ceiling: 24000, ldMax: 7.4, gLimit: 3.2,   // salvaged airframe: the weakest structure in the fleet
  },
  // Grasshopper — a PIPER L-4 analogue: a featherweight tandem liaison taildragger. Docile and
  // SLOW: floats off in a few yards, very stall-resistant, gentle rates — the forgiving scout you
  // fly hands-off. No speed and a low ceiling; the wind pushes her around.
  grasshopper: {
    name: 'Grasshopper', mass: 0.85, thrustMax: 9.5, vr: 34, vs0: 21, vne: 105, cruise: 68,
    pitchRate: 11, pitchTau: 0.62, rollRate: 44, rollTau: 0.6, engineLag: 1.35,
    pitchStable: 1.0, rollStable: 1.2, dragP: 0.00107, flapDrag: 0.5, flapLift: 0.32, flapVs: 0.16,
    rollFric: 1.7, aoaCrit: 20, liftScale: 1.0, vsMax: 480, vsGain: 1500, vsTau: 1.0,
    brake: 5.2, groundSteer: 32, ceiling: 24000, ldMax: 6.7, gLimit: 4.0,
    groundPitch: 11,   // taildragger 3-point sit (deg nose-up): rests on the tailwheel; push forward to raise the tail on the roll
  },
  // Locust — a low-wing CROP-DUSTER / ag-plane (Air Tractor analogue): a heavy, honest low-and-slow
  // worker. Flies loaded with a chemical hopper, so she's HEAVY and DOCILE — gentle, unhurried rates,
  // strong self-level (hands-off over the field), a big draggy square wing that's very stall-resistant
  // and won't run away on top. Low ceiling — she works down in the weeds, not up high.
  locust: {
    name: 'Locust', mass: 1.35, thrustMax: 13, vr: 44, vs0: 30, vne: 125, cruise: 92,
    pitchRate: 9, pitchTau: 0.65, rollRate: 42, rollTau: 0.62, engineLag: 1.4,
    pitchStable: 1.05, rollStable: 1.25, dragP: 0.00139, flapDrag: 0.55, flapLift: 0.4, flapVs: 0.2,
    rollFric: 1.7, aoaCrit: 20, liftScale: 1.0, vsMax: 750, vsGain: 1550, vsTau: 1.0,
    brake: 5.5, groundSteer: 30, ceiling: 22000, ldMax: 4.9, gLimit: 4.4,   // big draggy ag wing — she does not glide far
    groundPitch: 10,   // taildragger 3-point sit (deg nose-up): rests on the tailwheel
  },
};

// The lift-curve constants: CL0 is the coefficient at zero AoA, CL_ALPHA the per-degree slope.
// They anchor both the weight the wing carries (weightOf) and the AoA the wing needs to hold 1g
// at a given speed (the flight-path energy model in step §7).
const CL0 = 0.28, CL_ALPHA = 0.09;

// ── Stall constants — the wing lets go on ANGLE OF ATTACK, never on airspeed ──
// This is the load-bearing change of the 2026-07 realism pass. Before it, the stall
// triggered on `airspeed < stallSpeed` with AoA used only as a sign test, which made an
// ACCELERATED stall (a hard pull at a perfectly healthy speed) literally impossible and
// left `aoaCrit` doing nothing but anchoring weightOf(). Now `s.aoa` is the single state
// variable: it feeds lift, drag, the stall, the buffet and the g-meter, and the stall
// speed falls OUT of the model (a wing at 2g reaches aoaCrit at √2 × Vs on its own)
// instead of being computed with a fudged load factor.
const CL_COLLAPSE = 0.42;    // fraction of max CL a fully-developed stall destroys — this, not a scripted vs clamp, is what makes a stalled aircraft fall
const POST_STALL_BAND = 14;  // deg past aoaCrit over which the collapse completes (a deep stall is worse than a nibble)
const REATTACH = 3.5;        // deg BELOW aoaCrit the AoA must fall before flow reattaches — real aerodynamic hysteresis, and what replaces the old stallTimer grace
const STALL_ARM = 0.12;      // s above aoaCrit before the break commits — kills single-frame AoA spikes, nothing more
const BUFFET_BAND = 4.5;     // deg before aoaCrit where the burble starts shaking the airframe
const MUSH_DEG = 40;         // deg the flight path droops per unit of lift DEFICIT — the mush is now unbounded (§7) instead of saturating at aoaCrit
const SPIN_YAW = 46;         // deg/s autorotative yaw in a fully-developed, held stall
const STALL_ROLL = 50;       // deg/s wing-drop in the same
const G_LIMIT_DEFAULT = 4.4; // structural limit (g) if a type doesn't state one

// Weight the model holds up. Anchored at the STALL point — at the clean stall speed
// the wing at its max lift coefficient just holds the aircraft up. This makes the
// envelope self-consistent: you can fly (barely) at Vr just above the stall, cruise
// sits at a low trim AoA, and lift falls below weight only when you're too slow.
function weightOf(p) { return 0.5 * p.vs0 * p.vs0 * (CL0 + CL_ALPHA * p.aoaCrit) * p.liftScale; }

// The lift coefficient the wing ACTUALLY makes at this AoA — linear up to the critical
// angle, then a collapse once the flow has separated. `stalled` gates the collapse so the
// brief STALL_ARM window sits at peak CL (the wing is on the edge, not yet let go).
function clOf(p, aoa, flapLiftF, stalled) {
  const clMax = (CL0 + CL_ALPHA * p.aoaCrit) * flapLiftF;
  if (aoa <= p.aoaCrit || !stalled) return clamp((CL0 + CL_ALPHA * aoa) * flapLiftF, 0, clMax);
  return clMax * (1 - CL_COLLAPSE * clamp((aoa - p.aoaCrit) / POST_STALL_BAND, 0, 1));
}

// Per-airframe derived tuning, memoised on the params object (non-enumerable so the tuning
// harnesses' `{...p, override}` clones get a FRESH derivation instead of a stale one).
//
// INDUCED DRAG. The old polar had no honest low-speed drag rise: a `max(0,aoa)²·V` term
// (linear in V — not induced drag, which goes as 1/V²) plus a `glideDrag` 1/V² term that
// existed on the Leviathan alone and only below 0.4 rpm. So six of eight airframes had no
// back side to the power curve at all, and the one that needed one got a hand-fitted patch.
// Now every type carries a proper CDi = kInd·CL², and because CL rises with a pull it also
// replaces the aoa² term (a hard turn bleeds speed for the right reason).
//
// kInd is DERIVED, not authored: `ldMax` (the best glide ratio the airframe should manage)
// plus dragP fixes where parasitic drag equals induced drag, which is by definition the
// best-glide point — so `bestGlide` is now a measured consequence of the polar rather than
// a number typed next to it. In the sim's units the glide ratio is mass·G_KT / drag, and at
// best glide drag = 2·dragP·V², giving V_bg² = mass·G_KT/(2·dragP·ldMax).
function tuning(p) {
  if (p._tune) return p._tune;
  const weight = weightOf(p);
  const vbg2 = (p.mass * G_KT) / (2 * p.dragP * (p.ldMax || 7));
  const t = { weight, kInd: 0.25 * p.dragP * vbg2 * vbg2 / (weight * weight), bestGlide: Math.sqrt(vbg2) };
  try { Object.defineProperty(p, '_tune', { value: t, enumerable: false, configurable: true }); } catch { /* frozen params: recompute each call */ }
  return t;
}
// Publish the derived best-glide speed onto each fixed-wing type — the cockpit's blue
// yoke light reads `p.bestGlide`, and it should point at the real peak of the polar.
for (const p of Object.values(TYPES)) if (!p.heli) p.bestGlide = Math.round(tuning(p).bestGlide);

export function createState(p) {
  return {
    airspeed: 0, altitude: 0, pitch: p.groundPitch || 0, bank: 0, heading: 0,   // taildraggers start parked nose-high on the tailwheel
    tailDown: 1,           // taildragger heli: tailwheel planted (the parked 3-point sit) — see stepHeli §2
    vs: 0,                 // ft/min
    rpm: 0,                // 0..1 (spooled fraction of throttle)
    elevEff: 0,            // the yoke's built-up pitch effect (lags the raw input)
    rollEff: 0,            // the yoke's built-up roll effect (lags the raw input)
    aoa: 0, stallMargin: 1, stalled: false, stallTimer: 0, stallDir: 0,
    stallDepth: 0,         // 0..1 — how far past the critical angle the wing is (drives the CL collapse, the wing-drop and the sink)
    buffet: 0,             // 0..1 — pre-stall burble; the cockpit shakes on it
    g: 1,                  // load factor — real, derived from the AoA the wing is actually at (§6a)
    overG: false,          // latched so the airframe groans ONCE per excursion past gLimit, not every frame

    slip: 0,               // forward-slip intensity (0..1), eased from crossed-control input
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
    s.elevEff += (cycP - s.elevEff) * Math.min(1, dt / p.pitchTau);
    s.rollEff += (cycR - s.rollEff) * Math.min(1, dt / p.rollTau);
    s.bank += (0 - s.bank) * Math.min(1, dt * 5);
    if (p.groundPitch) {
      // TAILDRAGGER heli (the Viper): three points of contact, mains forward and a small tailwheel
      // right at the end of the boom — so the whole airframe sits nose-high at `groundPitch`, and
      // the tail is the light end. `tailDown` is that tailwheel's contact (1 = planted, 0 = flown):
      //  • LIFT-OFF — as the collective takes the weight off the wheels, the tail (out at the end
      //    of a long boom, far behind the mains) comes up FIRST and she rotates FLAT to the
      //    horizon, still rolling on her mains, before she breaks ground. That's the attitude
      //    change you see out the canopy and from the chase cam.
      //  • TOUCHDOWN — she arrives level and lands on the two mains; the tail stays up until you
      //    PULL BACK (or lower the lever) and walk it down onto the tailwheel into the 3-point sit.
      const liftFrac = coll * Nr * (p.liftMax || 2.6) / (p.hoverThrust || 1);
      // Tail-up band deliberately sits BELOW the hover point (liftFrac 1) — she's flat on her
      // mains by ~0.35 collective and only breaks ground past ~0.42, so you always see the
      // rotation happen on the wheels first rather than simultaneously with the lift-off.
      const light = clamp((liftFrac - 0.6) / 0.25, 0, 1);    // weight coming off the wheels
      const pull = clamp(s.elevEff, 0, 1);                   // aft cyclic settles the tail
      let tailTgt;
      if (light > 0.15) tailTgt = 0;                             // flying the tail
      else if (pull > 0.1 || coll < 0.3) tailTgt = 1;            // pulled back / lever down → tail comes home
      else tailTgt = s.tailDown ?? 1;                            // otherwise she holds what she's rolling on
      s.tailDown = (s.tailDown ?? 1) + (tailTgt - (s.tailDown ?? 1)) * Math.min(1, dt * 2.2);
      s.pitch += (p.groundPitch * s.tailDown - s.pitch) * Math.min(1, dt * 4);
    } else s.pitch += (0 - s.pitch) * Math.min(1, dt * 5);   // skids: flat on the deck
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
  // Service ceiling. Rotor thrust falls with air density, so the POWER MARGIN over the hover
  // weight — not the thrust itself — is what thins out with height: at the ceiling any
  // collective you pull buys exactly hover and nothing more, so she simply stops going up.
  // Sink is untouched (same convention as the fixed-wing branch §7), because thin air must
  // never stop you coming DOWN.
  //
  // This branch used to ignore `p.ceiling` entirely — it was an authored number no heli code
  // read, so a helicopter climbed at a constant rate to any altitude you had the patience for,
  // and raising the figure in TYPES changed nothing at all.
  const hoverT = p.hoverThrust || 1;
  if (thrustV > hoverT) {
    const thin = clamp(1 - s.altitude / (p.ceiling || 20000), 0, 1);   // 1 on the deck → 0 at the ceiling
    thrustV = hoverT + (thrustV - hoverT) * thin;
  }
  // Sink HARDER than she climbs — chop the collective (or droop Nr) and the underpowered kit
  // heli drops away in a deep autorotative descent instead of mushing down gently.
  // Climb and sink read SEPARATE gains: `vsGainUp` (falling back to vsGain) is the up side, so a
  // type can be given more rate on a full lever without also dropping away harder when you chop it.
  const deficit = thrustV / hoverT - 1;
  let vsTarget = clamp(deficit * (deficit < 0 ? p.vsGain * 1.9 : (p.vsGainUp || p.vsGain)), -p.vsMax * 2.6, p.vsMax);
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
  s.aoa = 0; s.stalled = false; s.stallDepth = 0; s.buffet = 0; s.g = 1;
  s.autorot = !powered && !s.onGround;               // engine-out: flying it down on the freewheeling rotor
  s.lowNr = !s.onGround && Nr < 0.6;
  s.vrs = vrs > 0.25;
  s.stallMargin = clamp((Nr - 0.5) / 0.4, 0, 1);   // reuse the margin channel to drive the horn

  // 7. Ground contact — set down vertically (no rollout). A hard arrival flags a heavy touchdown.
  if (s.altitude <= 0) {
    if (!s.onGround && s.vs < -300) s.events.push({ type: 'touchdown', severity: s.vs < -600 ? 'hard' : 'firm', vs: s.vs });
    // Taildragger: she rolls onto the mains at whatever attitude she arrived in, so seed the
    // tailwheel's contact from the touchdown pitch rather than snapping into the 3-point sit —
    // the pilot walks the tail down from there (§2).
    if (!s.onGround && p.groundPitch) s.tailDown = clamp(s.pitch / p.groundPitch, 0, 1);
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
  // `noThrust` (Leviathan visor lock) severs the thrust FORCE without touching the spool: the engines
  // still run, rev and sound off the rpm above — she just makes no thrust to roll on until it clears.
  const thrust = (input.noThrust ? 0 : s.rpm) * p.thrustMax;

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
    // A separated wing barely answers the ailerons — and the down-going aileron on the
    // dropping wing only drives it DEEPER into the stall (see §6c). This is why "pick the
    // wing up with aileron" is the wrong instinct and rudder is the recovery input.
    const rollCmd = s.rollEff * p.rollRate * auth * rollResist * (1 - 0.75 * s.stallDepth);
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

  // 5b. Forward slip — CROSSED CONTROLS: a held bank against OPPOSITE rudder (bank and pedal of
  //     opposing sign). Intensity scales with BOTH — you need a real bank AND real opposite rudder,
  //     full by ~22° of bank with full rudder. A sheared rudder can't slip; grounded can't slip. It
  //     eases in/out over ~0.5s so it's a deliberate cross, not a flick. The drag + lift-spill it
  //     drives (§7/§8) are what make a slip SINK without gaining speed; the no-net-turn falls out of
  //     §5 (the bank's turn and the rudder's yaw already oppose). This is the approach-salvage tool.
  const slipCross = (!rudderGone && !s.onGround && s.bank * pedal < 0)
    ? clamp(Math.min(Math.abs(s.bank) / 22, 1) * Math.abs(pedal), 0, 1) : 0;
  s.slip += (slipCross - s.slip) * Math.min(1, dt / 0.5);

  // 6. ANGLE OF ATTACK — the one state variable the whole wing model runs on.
  //    α = pitch − γ, where γ is the actual flight-path angle (from vs and airspeed). It is
  //    a definition, not an approximation, and it is now the SAME number that sets lift (§7),
  //    drag (§8), the stall (§6b), the buffet and the g-meter — the old model carried two
  //    unreconciled AoAs (this one for drag, a separately-solved `aoaTrim` for lift) which is
  //    why the stall could never be tested against `aoaCrit`.
  //    The dynamics come free: γ chases the nose with the vertical inertia `vsTau`, so a fast
  //    pull outruns the flight path and α SPIKES — which is exactly an accelerated stall.
  //    Vertical speed is ft/min; 1 kt = 101.33 ft/min.
  const flapLiftF = 1 + flaps * p.flapLift;                       // flaps buy lift → less AoA to stay up → fly slower with the nose lower (eases the approach)
  const wingLiftMult = bothWings ? 0.15 : (oneWing ? 0.55 : 1);   // a sheared wing gives up half the lift budget → she sinks and stalls sooner; both gone = a brick
  const gamma = Math.atan2(s.vs / 101.33, Math.max(1, s.airspeed)) * R2D;
  s.aoa = clamp(s.pitch - gamma, -25, 60);

  // 6a. LOAD FACTOR — real, and derived from how much MORE lift the wing's actual α buys than
  //     holding 1g at this speed costs. 1.0 in level cruise; a level 60° bank settles at 2g on
  //     its own, because holding the nose up in the bank is what raises α, and 1/cos 60° = 2
  //     falls straight out. Nothing fudges it and nothing needs to: the old
  //     `1 + (1/cos φ − 1)·(0.3+0.7·pull)` produced exactly 1.0 for a wings-level pull, which
  //     is why a hard yank could never stall anything.
  //     It is NOT raw lift/weight. This is an arcade lift model whose trim α floors at 0, so a
  //     wing in fast level flight still shows CL0 and raw lift/weight reads ~2g in a perfectly
  //     level cruise. So g is assembled from the two things that genuinely load the wing: the
  //     bank's own demand (clNeed/clLevel, i.e. 1/cos φ), plus whatever α the pilot is pulling
  //     ABOVE the trim α. Exact in all four regimes — level cruise 1g, a level 60° bank 2g, a
  //     wings-level haul >1g, and a bank steeper than the wing can hold reads the g it is being
  //     ASKED for while §7 drops the aircraft out of it.
  const T = tuning(p), weight = T.weight;
  const dynBank = 0.5 * s.airspeed * s.airspeed * p.liftScale * Math.cos(s.bank * D2R) * wingLiftMult;   // vertical dynamic-pressure budget (a bank spills it; battle damage steals it)
  const clNeed = weight / Math.max(20, dynBank);             // lift coefficient the wing must make to hold 1g in THIS bank
  const clLevel = weight / Math.max(20, 0.5 * s.airspeed * s.airspeed * p.liftScale * wingLiftMult);   // …and wings-level, the 1g reference
  const aoaTrim = clamp((clNeed / flapLiftF - CL0) / CL_ALPHA, 0, p.aoaCrit);   // AoA that buys it, up to the critical angle
  const clNow = clOf(p, s.aoa, flapLiftF, s.stalled);
  s.g = (clNeed + Math.max(0, clNow - clOf(p, aoaTrim, flapLiftF, false))) / Math.max(0.05, clLevel);
  const gLimit = p.gLimit ?? G_LIMIT_DEFAULT;
  if (s.g > gLimit && !s.onGround) { if (!s.overG) { s.events.push({ type: 'overg', g: s.g }); s.overG = true; } }
  else if (s.g < gLimit * 0.9) s.overG = false;

  // 6b. THE STALL — α past the critical angle, full stop. No speed threshold, no fudged load
  //     factor, no multi-second timer: the stall speed is now an OUTPUT (a wing pulling 2g
  //     reaches aoaCrit at √2 × Vs by itself) and an accelerated stall at cruise speed is
  //     possible for the first time. STALL_ARM only rejects single-frame α spikes.
  //     Recovery is REATTACH degrees of genuine hysteresis — a real separated wing does not
  //     re-fly the instant α dips back under the critical angle, and that hysteresis is what
  //     the old 1.9 s `STALL_HOLD` grace was standing in for.
  s.buffet = s.onGround ? 0 : clamp((s.aoa - (p.aoaCrit - BUFFET_BAND)) / BUFFET_BAND, 0, 1);
  s.stallMargin = s.onGround ? 1 : clamp((p.aoaCrit - s.aoa) / (BUFFET_BAND * 2), 0, 1);
  const wasStalled = s.stalled;
  if (s.onGround) { s.stalled = false; s.stallTimer = 0; }
  else if (!s.stalled) {
    s.stallTimer = s.aoa > p.aoaCrit ? s.stallTimer + dt : 0;
    if (s.stallTimer >= STALL_ARM) s.stalled = true;
  } else if (s.aoa < p.aoaCrit - REATTACH) { s.stalled = false; s.stallTimer = 0; }
  s.stallDepth = s.stalled ? clamp((s.aoa - p.aoaCrit) / POST_STALL_BAND, 0.15, 1) : 0;
  if (s.stalled && !wasStalled) {
    s.events.push({ type: 'stall' });
    // Which wing lets go first — follow any existing bank/aileron, else drop the left. Held for this stall.
    s.stallDir = Math.abs(s.bank) > 1 ? Math.sign(s.bank) : (aileron !== 0 ? Math.sign(aileron) : -1);
  }

  // 6c. POST-STALL DEPARTURE. The SINK is no longer scripted — it falls out of the CL collapse
  //     in §7, so it now scales with speed, weight, bank and flap instead of being a fixed
  //     multiple of vsMax. What stays authored here is the pitching MOMENT (the tail still
  //     flies, so a stalled wing drops its nose) and the autorotation, because this is an
  //     energy model with no moment arms. The two things that changed:
  //       • RUDDER RECOVERS IT. The old wing-over marched heading at a flat 42°/s while the
  //         pedal was worth 4–18°/s, so opposite rudder — the actual spin-recovery input —
  //         was mathematically unable to stop it. Now the departure scales with stall DEPTH
  //         and the pedal gets extra authority against it, so the real drill works: neutralise
  //         the ailerons, opposite rudder, unload, and she comes back.
  //       • AILERON MAKES IT WORSE. Fighting the drop with the stick (§4 already halves its
  //         authority) drives the down-going wing deeper — the classic trap.
  if (s.stalled) {
    const held = clamp(s.elevEff, 0, 1);
    const depth = s.stallDepth;
    s.pitch -= (10 + 26 * (1 - held)) * depth * dt;                   // let go of the stick and she noses over hard into her own recovery
    s.bank += s.stallDir * STALL_ROLL * depth * (0.18 + 0.82 * held) * dt;
    if (aileron * s.stallDir < 0) s.bank += s.stallDir * 11 * depth * Math.abs(aileron) * dt;   // picking the wing up with aileron deepens the drop
    // The pedal's anti-spin authority scales with the DEPTH it's fighting rather than with the
    // airframe's cruise rudder power alone — otherwise the lazy rudder of a heavy (the Leviathan's
    // is worth 6.7°/s) could never touch a 46°/s departure and the recovery drill would be a lie
    // on exactly the aircraft that most needs it.
    let spin = s.stallDir * SPIN_YAW * depth * held;
    if (!rudderGone) spin += pedal * (rudderYaw * 1.2 + SPIN_YAW * 0.75 * depth);
    s.heading = wrap360(s.heading + spin * dt);
    s.pitch = clamp(s.pitch, -60, 48);
    s.bank = clamp(s.bank, -85, 85);
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
  let gammaCmd = s.pitch - aoaTrim;   // dynBank / clNeed / aoaTrim are computed once in §6a and shared with the g-meter
  // THE MUSH IS NO LONGER CAPPED. `aoaTrim` saturating at aoaCrit used to throw the lift
  // DEFICIT away at the clamp, so once the wing couldn't hold 1g the sink stopped deepening —
  // slow, heavy, dirty and stalled configurations all under-sank, and the stall had to be
  // faked back in with a fixed `-vsMax × 1.4` clamp. Now the shortfall between the CL the wing
  // needs and the most it can make droops the flight path in proportion, and because
  // `clMaxNow` carries the post-stall CL COLLAPSE, the falling-out-of-the-sky sink of a real
  // stall is the SAME term — which is why it now scales with speed, weight, bank and flap.
  const clMaxNow = (CL0 + CL_ALPHA * p.aoaCrit) * flapLiftF
    * (s.stalled ? 1 - CL_COLLAPSE * clamp((s.aoa - p.aoaCrit) / POST_STALL_BAND, 0, 1) : 1);
  if (clNeed > clMaxNow) gammaCmd -= MUSH_DEG * clamp(clNeed / clMaxNow - 1, 0, 2.5);
  let vsTarget = s.airspeed * 101.33 * Math.sin(Math.max(-85, gammaCmd) * D2R);   // ft/min along the commanded flight path (1 kt = 101.33 ft/min)
  vsTarget -= s.slip * SLIP_SINK * s.airspeed;   // forward slip spills lift → an extra sink (energy-proportional, so a slow plane isn't over-sunk) you can plant on final (§5b); ground effect still cushions it below
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
  const diveClean = s.pitch < 0 ? clamp(-s.pitch / 11, 0, 1) : 0;   // ramps in with how far the nose is below the horizon (full by ~11° down)
  const diveShed = p.diveShed ?? DIVE_SHED;   // how much parasitic drag a dive sheds (feel knob; low = real gravity carries the dive)
  // Gear drag: extended RETRACTABLE gear hangs into the airstream and bleeds speed (∝ V²), a real
  // penalty for cruising with the wheels down. Scaled as a fraction of the airframe's own parasitic
  // drag (per-type via gearDragFrac, default 0.35) so it's proportioned to each craft. `input.gear`
  // is the extended fraction (0 = up, 1 = down); fixed-gear craft pass 0 (drag already in dragP).
  const gearExt = clamp(input.gear || 0, 0, 1);
  const drag = (p.dragP + flaps * p.flapDrag * 0.0022) * s.airspeed * s.airspeed * (1 - diveShed * diveClean)  // parasitic drag ∝ V² (a dive sheds `diveShed` of it → gravity-along-γ does the rest of the work). Flap drag term raised so extending flaps bleeds speed decisively on final — you can get slow for the touchdown zone instead of floating past it (overshoot)
             + gearExt * (p.gearDragFrac ?? 0.35) * p.dragP * s.airspeed * s.airspeed                     // gear-down parasitic drag (retractable craft only)
             + T.kInd * clNow * clNow * s.airspeed * s.airspeed                  // INDUCED DRAG, CDi = kInd·CL², for every airframe. Replaces BOTH the old `aoa²·V` fudge (wrong exponent on V, so it wasn't induced drag) and the Leviathan-only, rpm-gated `glideDrag` patch. Because CL rises with a pull it still penalises a hard haul-back — harder, in fact, since CL² is where the g goes — and because it goes as 1/V² at a fixed load it finally gives the whole fleet a back side to the power curve: slow down past best glide and the sink gets WORSE, which is the "region of reversed command" a low, slow approach is supposed to fear. A nose-down push unloads the wing (low CL), so it still never penalises a dive. kInd is derived per type from `ldMax` — see tuning().
             + s.slip * (p.slipDrag ?? SLIP_DRAG) * s.airspeed * s.airspeed      // forward slip (§5b): the sideways fuselage adds big drag → you SINK without the descent building speed
             + s.stallDepth * 0.9 * p.dragP * s.airspeed * s.airspeed;           // separated flow is a barn door — a developed stall bleeds energy on top of the CL collapse
  // Gravity accelerates the airframe along its actual VELOCITY VECTOR (the flight-path angle γ),
  // not along where the NOSE points. Fast/powered/diving the wing carries its weight at a low AoA
  // so γ≈pitch and this is identical to before (cruise, climb, top speed, dive all untouched). They
  // only diverge when the wing MUSHES (slow, high AoA): the nose sits shallow but the plane sinks
  // steeply — and that steep descent must build speed back. Crediting pitch instead of γ there made
  // the sink "free" energy loss, so a shallow glide bled off into a stall instead of settling; using
  // γ closes the energy loop, so a slightly-nose-down attitude self-trims to a stable glide speed.
  // Uses the flight path as it stands AFTER §7's update, not the previous frame's — the stale
  // read cost a step of energy closure, which matters when the harness steps at a coarse dt.
  const grav = G_KT * Math.sin(Math.atan2(s.vs / 101.33, Math.max(1, s.airspeed)));
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
    // Arrival severity scales with the airframe: a flat absolute fpm judged a Grasshopper and a
    // 5.0-mass freighter identically, when the gear that carries the freighter is built for it.
    const firmVs = -300 * (0.8 + 0.2 * (p.mass || 1)), hardVs = -700 * (0.8 + 0.2 * (p.mass || 1));
    if (!s.onGround && s.vs < firmVs) s.events.push({ type: 'touchdown', severity: s.vs < hardVs ? 'hard' : 'firm', vs: s.vs });
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
    buffet: +(s.buffet || 0).toFixed(2),
    g: +(s.g ?? 1).toFixed(2),
    aoaCrit: p.aoaCrit,
    slip: +s.slip.toFixed(2),
    onGround: s.onGround,
    vr: p.vr, vs0: p.vs0, vne: p.vne,
  };
}
