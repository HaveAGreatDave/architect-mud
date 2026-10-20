// FLIGHT MODEL: the continuous energy simulation for aircraft, trucks and boats.
// Pure: no DOM, no network, no plugin state, so it can be stepped headless. An arcade
// energy model: controls modify behaviour, never set state, and a stall comes from
// pitch plus low airspeed, never from low throttle.
//
// Units: knots, feet AGL, ft/min, degrees, seconds.
// createState(params) -> a fresh state, parked, engine off.
// step(state, input, params, dt) -> mutates and returns state.
//   input = { elevator:-1..1 (+1 = pull), aileron:-1..1, throttle:0..1, flaps:0..1 }

// The only import: sea-swell.js is the one JS copy of the sea's shape. Never sample a private
// wave or reach into windshield.js, or the hull rides a sea nobody draws and can't run on a server.
import { seaRoll, seaWind, seaSlope, seaChop } from '../../../shared/sea-swell.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const G_KT = 19.06;               // gravity as a knots/second airspeed change (9.81 m/s²)
const wrap360 = (d) => ((d % 360) + 360) % 360;
// Feel knob: fraction of parasitic drag a full nose-down attitude removes. Keep it low so a dive
// redlines by gravity, not by deleting drag (tuned with scripts/dive-tune.mjs). Override: p.diveShed.
const DIVE_SHED = 0.2;
// Forward slip (bank against opposite rudder): sink steeply without gaining speed.
const SLIP_DRAG = 0.0005;   // extra drag ∝ V² per unit slip, sized so a slip holds speed while it sinks
const SLIP_SINK = 4.0;      // extra sink per unit slip, fpm per knot of airspeed
const GROUND_EFFECT_FT = 26;      // AGL lift-cushion band; kept low so she doesn't float down the runway
const HELI_GROUND_EFFECT_FT = 40; // AGL band (~a rotor diameter) of downwash cushion

// ── Per-airframe tuning ───────────────────────────────────────────────────────
// The Mayfly is the reference; heavier types get slower rates and gentler handling.
export const TYPES = {
  mayfly: {
    name: 'Mayfly',
    mass: 1.0,            // relative inertia: scales every rate + the force→accel maps
    thrustMax: 11.5,      // full-power airspeed authority (kt/s): ample power to climb & hold speed
    vr: 40,               // rotate speed (kt): below this, pitch authority is mushy
    vs0: 24,              // clean 1g stall speed (kt): low = very stall-resistant trainer
    vne: 120,             // never-exceed (kt): the server envelope clamp
    cruise: 80,           // trimmed level-flight speed (kt): lift≈weight target (roomy stall margin)
    pitchRate: 11,        // deg/s of pitch at full elevator & full authority: lower = best climb needs more back-pressure
    pitchTau: 0.6,        // how long the yoke's pitch effect takes to build (s): heavy control
    rollRate: 52,         // deg/s of bank at full aileron & full authority
    rollTau: 0.55,        // how long the yoke's roll effect takes to build (s): heavy control
    engineLag: 1.3,       // throttle→rpm time constant (s); turbines will be larger
    pitchStable: 0.9,     // self-level rate when elevator released (seeks stability)
    rollStable: 1.1,      // wings-level rate when aileron released
    dragP: 0.000889,      // parasitic drag coeff (∝ airspeed²); each type's is solved for its level top speed with induced drag on

    flapDrag: 0.55,       // extra drag per unit flap
    flapLift: 0.35,       // extra lift per unit flap
    flapVs: 0.18,         // stall-speed reduction per unit flap
    rollFric: 1.6,        // ground rolling friction (kt/s) with throttle at idle
    brake: 5.5,           // extra ground deceleration (kt/s) at full back-pressure: wheel brakes for the rollout
    groundSteer: 30,      // nosewheel/tiller authority (deg/s) while taxiing; fades out toward rotation speed
    aoaCrit: 19,          // critical angle of attack (deg): high = forgiving, resists the stall
    liftScale: 1.0,       // scales the whole lift/weight pair (cancels; kept as a knob)
    vsMax: 525,           // max sustained climb (ft/min)
    vsGain: 1600,         // how hard excess lift converts to vertical speed
    vsTau: 1.0,           // vertical inertia (s)
    ceiling: 28000,       // service ceiling (ft): climb fades to zero here
    ldMax: 7.4,           // best glide ratio: sets induced drag, and `bestGlide` (the blue yoke light) derives from it
    gLimit: 4.4,          // structural g limit; exceeding it fires an `overg` event
  },

  // Mule: twin-turboprop STOL hauler (Twin Otter analogue).
  mule: {
    name: 'Mule', mass: 2.8, thrustMax: 36, vr: 65, vs0: 46, vne: 185, cruise: 165,
    pitchRate: 9, pitchTau: 0.8, rollRate: 40, rollTau: 0.7, engineLag: 1.7,
    pitchStable: 0.88, rollStable: 1.0, dragP: 0.000828, flapDrag: 0.65, flapLift: 0.5, flapVs: 0.24,
    rollFric: 1.4, aoaCrit: 18, liftScale: 1.0, vsMax: 1800, vsGain: 1800, vsTau: 0.95,
    brake: 6.0, groundSteer: 26, ceiling: 34000, ldMax: 7.6, gLimit: 3.8,
  },
  // Leviathan: 4-engine heavy freighter (An-124 analogue). Heavy and slow on top (high dragP),
  // thrust sized so takeoff accel at Vr holds; slow rates, so you fly her well ahead.
  leviathan: {
    name: 'Leviathan', mass: 5.0, thrustMax: 120, vr: 95, vs0: 64, vne: 200, cruise: 155,
    pitchRate: 5, pitchTau: 1.3, rollRate: 18, rollTau: 1.45, engineLag: 2.6,
    pitchStable: 0.58, rollStable: 0.7, dragP: 0.00321, flapDrag: 0.7, flapLift: 0.45, flapVs: 0.2,
    rollFric: 1.2, aoaCrit: 16, liftScale: 1.0, vsMax: 2700, vsGain: 2500, vsTau: 1.05,
    brake: 8.0, groundSteer: 16, ceiling: 41000,   // the fleet's highest ceiling
    ldMax: 2.4, gLimit: 2.5,   // glides like a brick; best glide (~76 kt) falls out of the polar
  },
  // Reaper: A-10 analogue. Best thrust-to-mass in the fleet (leaps off the deck), fast flat-out;
  // vs0 is raised so she settles instead of hanging when slow (weightOf ∝ vs0²).
  reaper: {
    name: 'Reaper', mass: 3.4, thrustMax: 92, vr: 54, vs0: 39, vne: 270, cruise: 165,
    pitchRate: 10, pitchTau: 0.7, rollRate: 58, rollTau: 0.6, engineLag: 1.0,
    pitchStable: 1.1, rollStable: 1.3, dragP: 0.00130, flapDrag: 0.6, flapLift: 0.42, flapVs: 0.2,
    rollFric: 1.5, aoaCrit: 21, liftScale: 1.0, vsMax: 3600, vsGain: 3000, vsTau: 0.85,
    brake: 7.5, groundSteer: 28, ceiling: 34000, ldMax: 7.6, gLimit: 6.0,
    worldPaceMult: 1.7,   // world-travel only: terrain scrolls 1.7× for the same airspeed; handling untouched
  },
  // Shrike: the dive bomber. The bomb refuses below 140 kt in a dive, so vne/dragP must let a 45°
  // part-power dive pass that in seconds; big flapDrag makes the dive holdable; gLimit 6 for the pullout.
  shrike: {
    name: 'Shrike', mass: 2.6, thrustMax: 44, vr: 58, vs0: 42, vne: 330, cruise: 150,
    pitchRate: 9.5, pitchTau: 0.72, rollRate: 46, rollTau: 0.68, engineLag: 1.5,
    pitchStable: 0.95, rollStable: 1.05, dragP: 0.00196, flapDrag: 1.15, flapLift: 0.4, flapVs: 0.2,
    rollFric: 1.5, aoaCrit: 19, liftScale: 1.0, vsMax: 1900, vsGain: 2000, vsTau: 0.9,
    brake: 7.0, groundSteer: 24, ceiling: 30000, ldMax: 6.8, gLimit: 6.0,
    groundPitch: 9,   // taildragger sit (deg nose-up); must match the `divebomber` mesh's groundPitch in aircraft3d.js
  },
  // Dragonfly: Mini 500 kit heli. Darty and twitchy, thin power margin, settles with power easily.
  dragonfly: {
    name: 'Dragonfly', heli: true, mass: 0.9,
    vne: 100, cruise: 78, vs0: 14,        // vs0 doubles as the translational-lift (ETL) speed
    vr: 0, aoaCrit: 90, liftScale: 1,
    pitchRate: 30, pitchTau: 0.35, rollRate: 46, rollTau: 0.3,   // nimble, twitchy cyclic
    pitchStable: 1.5, rollStable: 1.7,    // weak-ish self-level: needs constant small corrections
    yawRate: 95,                          // pedal (tail-rotor) authority in the hover, deg/s
    engineLag: 0.9,                       // rotor spool time
    cyclicThrust: 3.2,                    // disc-tilt → horizontal accel (kt/s per deg of lean)
    dragP: 0.0019,                        // draggy body: bleeds speed, modest top end
    liftMax: 2.7, hoverThrust: 1.0,       // collective×Nr vertical lift authority vs hover weight
    // vsGain sets hover twitchiness; vsGainUp (climb only) sets the climb rate, best at the droop
    // knee (~0.7 collective). vsMax is a clamp kept above that rate; never let it decide the climb.
    vsGain: 850, vsGainUp: 1400, vsMax: 1900, vsTau: 0.9,   // ~1720 fpm at the droop knee
    vrsVs: 480,                           // settling-with-power onset (fpm sink) when slow + powered
    rollFric: 11,                         // skid friction on the ground: skids bite and stop her quickly (no long rollout)
    ceiling: 32000,
  },
  // Viper: attack helicopter (Apache analogue). Heavy, stabilised, the fastest rotorcraft.
  viper: {
    name: 'Viper', heli: true, mass: 2.6,
    vne: 190, cruise: 150, vs0: 22,       // vs0 doubles as the translational-lift (ETL) speed
    vr: 0, aoaCrit: 90, liftScale: 1,
    pitchRate: 22, pitchTau: 0.5, rollRate: 40, rollTau: 0.45,   // authoritative but heavier cyclic
    pitchStable: 1.0, rollStable: 1.15,   // stabilised FCS: she holds an attitude you set
    yawRate: 68,                          // big tail rotor on a long boom: slower pedal turns than the Mini 500
    engineLag: 1.2,                       // twin turbines spool slower than a piston kit-heli
    cyclicThrust: 5.0,                    // heavy, powerful disc: real acceleration off a lean
    dragP: 0.00105,                       // slippery armoured body: holds speed, high top end
    liftMax: 2.4, hoverThrust: 1.0,       // strong power margin even loaded on the rails
    // Her lower liftMax gives a smaller climb deficit than the Dragonfly's, so vsGainUp is higher to
    // out-climb her. Tune climb here, not on liftMax, which also moves hover authority and VRS.
    vsGain: 1000, vsGainUp: 2100, vsMax: 2800, vsTau: 1.0,   // ~2050 fpm at the droop knee
    vrsVs: 620,                           // high disc loading: settles later, then bites harder
    rollFric: 9,                          // wheeled gear, but she stops short (no rollout)
    ceiling: 34000,
    groundPitch: 7,   // TAILDRAGGER: mains forward, tailwheel on the boom: she squats nose-high parked, flies the tail off first
  },
  // Drake: luxury compound coaxial with a ducted pusher (no tail rotor). Heavy, stable, lazy yaw.
  drake: {
    name: 'Drake', heli: true, mass: 3.2,
    convert: 'drake_wing',   // K converts: the wings sweep out and the rotor folds into the back (cockpit.js F.dk)
    vne: 180, cruise: 140, vs0: 24,
    vr: 0, aoaCrit: 90, liftScale: 1,
    pitchRate: 18, pitchTau: 0.6, rollRate: 30, rollTau: 0.55,
    pitchStable: 1.4, rollStable: 1.5,
    yawRate: 55,
    engineLag: 1.4,
    cyclicThrust: 4.4,
    dragP: 0.0012,
    liftMax: 2.5, hoverThrust: 1.0,
    vsGain: 900, vsGainUp: 1700, vsMax: 2400, vsTau: 1.1,
    vrsVs: 560,
    rollFric: 12,
    ceiling: 26000,
  },
  // Drake, wing mode (conversion past halfway): wings out, rotor folded. Convert back to land.
  drake_wing: {
    // She leaves the conversion at the hover's 40-60% lever, so thrust is sized for 50% to hold cruise.
    name: 'Drake (wing)', mass: 3.2, thrustMax: 64, vr: 55, vs0: 45, vne: 250, cruise: 185,
    pitchRate: 10, pitchTau: 0.8, rollRate: 34, rollTau: 0.75, engineLag: 1.4,
    pitchStable: 1.0, rollStable: 1.1, dragP: 0.00095, flapDrag: 0.6, flapLift: 0.5, flapVs: 0.24,
    rollFric: 1.4, aoaCrit: 17, liftScale: 1.0, vsMax: 2000, vsGain: 1800, vsTau: 0.95,
    brake: 6.0, groundSteer: 22, ceiling: 26000, ldMax: 8.5, gLimit: 3.5,
  },
  // Carcass: salvaged junker, underpowered and unstable.
  carcass: {
    name: 'Carcass', mass: 1.4, thrustMax: 14, vr: 44, vs0: 28, vne: 115, cruise: 72,
    pitchRate: 11, pitchTau: 0.5, rollRate: 50, rollTau: 0.5, engineLag: 1.5,
    pitchStable: 0.7, rollStable: 0.8, dragP: 0.00107, flapDrag: 0.55, flapLift: 0.32, flapVs: 0.17,
    rollFric: 1.7, aoaCrit: 17, liftScale: 0.95, vsMax: 900, vsGain: 1650, vsTau: 1.0,
    brake: 5.0, groundSteer: 30, ceiling: 24000, ldMax: 7.4, gLimit: 3.2,   // salvaged airframe: the weakest structure in the fleet
  },
  // Grasshopper: Piper L-4 analogue. Featherweight, slow, docile taildragger.
  grasshopper: {
    name: 'Grasshopper', mass: 0.85, thrustMax: 9.5, vr: 34, vs0: 21, vne: 105, cruise: 68,
    pitchRate: 11, pitchTau: 0.62, rollRate: 44, rollTau: 0.6, engineLag: 1.35,
    pitchStable: 1.0, rollStable: 1.2, dragP: 0.00107, flapDrag: 0.5, flapLift: 0.32, flapVs: 0.16,
    rollFric: 1.7, aoaCrit: 20, liftScale: 1.0, vsMax: 480, vsGain: 1500, vsTau: 1.0,
    brake: 5.2, groundSteer: 32, ceiling: 24000, ldMax: 6.7, gLimit: 4.0,
    groundPitch: 11,   // taildragger 3-point sit (deg nose-up): rests on the tailwheel; push forward to raise the tail on the roll
  },
  // Locust: crop-duster (Air Tractor analogue). Heavy, docile, draggy, low-and-slow.
  locust: {
    name: 'Locust', mass: 1.35, thrustMax: 13, vr: 44, vs0: 30, vne: 125, cruise: 92,
    pitchRate: 9, pitchTau: 0.65, rollRate: 42, rollTau: 0.62, engineLag: 1.4,
    pitchStable: 1.05, rollStable: 1.25, dragP: 0.00139, flapDrag: 0.55, flapLift: 0.4, flapVs: 0.2,
    rollFric: 1.7, aoaCrit: 20, liftScale: 1.0, vsMax: 750, vsGain: 1550, vsTau: 1.0,
    brake: 5.5, groundSteer: 30, ceiling: 22000, ldMax: 4.9, gLimit: 4.4,   // big draggy ag wing: she does not glide far
    groundPitch: 10,   // taildragger 3-point sit (deg nose-up): rests on the tailwheel
  },
  // ── Ground vehicles ────────────────────────────────────────────────────────
  // `ground: true` dispatches stepTruck, as `heli: true` dispatches stepHeli.
  // tileMph is road speed (mph) covering one corridor tile per second: it sets how long a haul takes.
  // ⚠ Speeds scale together: thrustMax × drive must beat rollFric × drag (regress checks it), and
  // ratios meet tileMph only as quotients except engine braking. See
  // docs/systems-trucking.md#truck-fleet-tuning-and-scaling before rescaling anything.
  //   `kg` trailer capacity, `tank` range in tiles on a full fill, `price` dealer price.
  // Tune tank range against the real route (~495 tiles one way to the Reach), never the regress fixture.
  hauler: {
    name: 'Ostrek Courier', ground: true, tier: 1,
    mass: 2.4,
    thrustMax: 4.62,      // mph/s at full throttle
    topSpeed: 104,        // mph on good asphalt; SURFACES.cap lowers it off the paved centreline
    tileMph: 112,         // mph that covers one corridor tile per second
    wheelbase: 0.24,      // tiles between axles; the yaw rate divides by it
    engineLag: 1.4,       // throttle→rpm time constant (s)
    rollFric: 0.714,      // rolling resistance (mph/s) at idle
    dragP: 0.000361,      // aero drag (∝ speed²)
    brake: 5.75,          // service-brake deceleration (mph/s) at full pedal
    kg: 1800, tank: 1100, price: 3400,
    // Eight forward gears (0 is neutral), geometric; 1st is a deeper crawler, and reverse borrows it.
    gears: [0, 4.85, 2.96, 2.26, 1.73, 1.33, 1.02, 0.78, 0.59], band: [0.42, 0.68],
    engBrake: 1, jake: 1.4,   // retarding force per unit ratio; the Jake multiplies it
    trailerLen: 0.17, hitchOffset: 0.055, trailerKg: 1400,   // kingpin geometry, and the empty box itself
    blurb: 'A stubby rigid box on a short wheelbase. Turns in like something half its age and carries about as much.',
  },
  drayman: {
    name: 'Vachon Drayman', ground: true, tier: 2,
    mass: 3.2, thrustMax: 3.78, topSpeed: 96, tileMph: 112, wheelbase: 0.31,
    engineLag: 1.9, rollFric: 0.882, dragP: 0.000314, brake: 5.25,
    kg: 3500, tank: 1400, price: 7200,
    gears: [0, 5.3, 3.22, 2.46, 1.89, 1.44, 1.1, 0.85, 0.65], band: [0.42, 0.68],   // 1st is the crawler
    engBrake: 1.25, jake: 1.4,   // retarding force per unit ratio; the Jake multiplies it
    trailerLen: 0.29, hitchOffset: 0.08, trailerKg: 3200,   // kingpin geometry, and the empty box itself
    blurb: "The one everybody learns on. Nothing about it is remarkable and nothing about it has ever stopped working.",
  },
  // Make a heavy truck ponderous with mass, engineLag and wheelbase, never by starving thrustMax.
  continental: {
    name: 'Orlov Continental', ground: true, tier: 3,
    mass: 4.6, thrustMax: 3.864, topSpeed: 88, tileMph: 112, wheelbase: 0.41,
    engineLag: 2.6, rollFric: 0.966, dragP: 0.000374, brake: 4.5,
    kg: 6200, tank: 2100, price: 16500,
    gears: [0, 5.7, 3.47, 2.66, 2.04, 1.56, 1.19, 0.91, 0.7], band: [0.42, 0.68],   // 1st is the crawler
    engBrake: 1.5, jake: 1.4,   // retarding force per unit ratio; the Jake multiplies it
    trailerLen: 0.37, hitchOffset: 0.10, trailerKg: 5200,   // kingpin geometry, and the empty box itself
    blurb: "A long-nose sleeper built for people who see their own bed twice a month. Slow to wind up, slower to stop, and it'll take a whole market with it.",
  },
  // The bottom rung: a first truck a new player can afford.
  scrapper: {
    name: 'Krell Barrow', ground: true, tier: 0,
    mass: 2.8, thrustMax: 3.528, topSpeed: 82, tileMph: 112, wheelbase: 0.28,
    engineLag: 2.4, rollFric: 0.924, dragP: 0.000387, brake: 4.2,
    kg: 1200, tank: 850, price: 1300,
    gears: [0, 6.2, 3.77, 2.89, 2.21, 1.69, 1.3, 0.99, 0.76], band: [0.42, 0.68],   // 1st is the crawler
    engBrake: 1.05, jake: 1.4,   // retarding force per unit ratio; the Jake multiplies it
    trailerLen: 0.15, hitchOffset: 0.05, trailerKg: 900,   // kingpin geometry, and the empty box itself
    blurb: 'Krell stopped making these long enough ago that nobody agrees which decade. Three of them in a trenchcoat. The heater works, which the previous owner mentioned first and at length.',
  },

  // ── Boats ──────────────────────────────────────────────────────────────────
  // `water: true` dispatches the boat step. Knobs beyond the truck's:
  //   dragP      solved a hair under thrustMax / topSpeed², so terminal sits just above the clamp
  //   tileMph    the scale knob, as on the truck
  //   hump       mph where the hull starts planing; below it `humpDrag` adds the bow wave
  //   turnLock/turnFade  rudder lock at rest and how fast its authority dies with speed
  //   driftTau   seconds the hull keeps carrying its old direction (the slide)
  hydro: {
    name: 'Vaskin Rooster', water: true, tier: 1,
    mass: 0.55,                        // relative inertia
    thrustMax: 22, topSpeed: 138, tileMph: 95,
    waterFric: 2.2,                    // hull friction with the throttle shut
    dragP: 0.001100, brake: 3.4,       // no brakes; this is what shutting the throttle buys
    hump: 48, humpDrag: 5.4,
    turnLock: 34, turnFade: 0.72,
    driftTau: 1.35,
    hullLen: 0.036, hullBeam: 0.015,   // HALF-length and HALF-beam in tiles, for the swell sample
    nitroMul: 1.35, nitroBurn: 0.22, nitroCool: 0.11,   // the bottle: how much, how fast out, how fast back
    // Vertical speed off a crest, tiles/s per unit of slope × speed. Fitted to the wind-derived sea;
    // sea.mjs holds it. Raise launch height here, never by lowering the kick threshold (that only skitters).
    launchVs: 0.9,
    hullKg: 700, tank: 260, price: 14500,
    blurb: 'Vaskin build about nine of these a year and will not tell you who buys them. A deep-V, a pilothouse, and a blown V8 standing open in the well. It does not have brakes. It was never going to have brakes.',
  },

  // Spur: stepped deep-V on outboards; quicker, slides further, more lock, bigger tank.
  // Gamecock: offshore tunnel cat; fastest, flatter corners, leaves the water easily, thirsty.
  // `burn` scales fuel use per second (absent = 1, the Rooster's).
  spur: {
    name: 'Vaskin Spur', water: true, tier: 2,
    mass: 0.74,
    thrustMax: 26.5, topSpeed: 152, tileMph: 95,
    waterFric: 2.0,
    dragP: 0.001135, brake: 3.0,
    hump: 44, humpDrag: 4.9,
    turnLock: 40, turnFade: 0.70,
    driftTau: 1.6,
    hullLen: 0.040, hullBeam: 0.0156,
    nitroMul: 1.28, nitroBurn: 0.20, nitroCool: 0.12,
    launchVs: 0.82,
    burn: 0.85,
    hullKg: 1150, tank: 420, price: 26800,
    blurb: "Vaskin's stepped deep-V, four outboards across the transom. The steps put air under her at speed, so she outruns the Rooster and slides further in a corner. A hardtop, a bench for three, and a bigger tank she empties faster.",
  },
  gamecock: {
    name: 'Vaskin Gamecock', water: true, tier: 3,
    mass: 0.62,
    thrustMax: 34, topSpeed: 176, tileMph: 95,
    waterFric: 1.7,
    dragP: 0.001085, brake: 2.8,
    hump: 38, humpDrag: 3.8,
    turnLock: 28, turnFade: 0.80,
    driftTau: 1.05,
    hullLen: 0.035, hullBeam: 0.0162,
    nitroMul: 1.30, nitroBurn: 0.25, nitroCool: 0.10,
    launchVs: 1.05,
    burn: 1.35,
    hullKg: 1350, tank: 520, price: 52000,
    blurb: 'An offshore tunnel cat with a fighter canopy, two blown motors under the deck and a wing over the stern. Past ninety the tunnel packs air under her and she leaves the water off swell the Rooster would cut through. There is a hammer clipped inside the canopy.',
  },
};

// Every water type, cheapest first: the boatyard's stock list.
export const BOAT_TYPES = Object.entries(TYPES)
  .filter(([, t]) => t.water)
  .sort((a, b) => a[1].price - b[1].price)
  .map(([id, t]) => ({ id, ...t }));

// Every ground type, cheapest first: the dealer's stock list.
export const TRUCK_TYPES = Object.entries(TYPES)
  .filter(([, t]) => t.ground)
  .sort((a, b) => a[1].price - b[1].price)
  .map(([id, t]) => ({ id, ...t }));

// Lift curve: CL0 at zero AoA, CL_ALPHA per degree. Anchors weightOf and the 1g AoA in step §7.
const CL0 = 0.28, CL_ALPHA = 0.09;

// ── Stall constants: the wing lets go on angle of attack, never on airspeed ──
// See docs/systems-flight.md#stall-on-angle-of-attack.
const CL_COLLAPSE = 0.42;    // fraction of max CL a developed stall destroys; this is what makes a stalled aircraft fall
const POST_STALL_BAND = 14;  // deg past aoaCrit over which the collapse completes
const REATTACH = 3.5;        // deg below aoaCrit before flow reattaches (hysteresis)
const STALL_ARM = 0.12;      // s above aoaCrit before the break commits; filters single-frame spikes
const BUFFET_BAND = 4.5;     // deg before aoaCrit where the buffet starts
const MUSH_DEG = 40;         // deg the flight path droops per unit of lift deficit (unbounded, §7)
const SPIN_YAW = 46;         // deg/s autorotative yaw in a fully-developed, held stall
const STALL_ROLL = 50;       // deg/s wing-drop in the same
const G_LIMIT_DEFAULT = 4.4; // structural limit (g) if a type doesn't state one

// Weight the model holds up, anchored at the clean stall: at vs0 and max CL lift just equals weight.
function weightOf(p) { return 0.5 * p.vs0 * p.vs0 * (CL0 + CL_ALPHA * p.aoaCrit) * p.liftScale; }

// Lift coefficient at this AoA: linear to aoaCrit, then collapses once `stalled` (so the
// STALL_ARM window sits at peak CL).
function clOf(p, aoa, flapLiftF, stalled) {
  const clMax = (CL0 + CL_ALPHA * p.aoaCrit) * flapLiftF;
  if (aoa <= p.aoaCrit || !stalled) return clamp((CL0 + CL_ALPHA * aoa) * flapLiftF, 0, clMax);
  return clMax * (1 - CL_COLLAPSE * clamp((aoa - p.aoaCrit) / POST_STALL_BAND, 0, 1));
}

// Per-airframe derived tuning, memoised non-enumerable so `{...p, override}` clones re-derive.
// kInd (induced drag) and bestGlide derive from ldMax and dragP: see
// docs/systems-flight.md#induced-drag-and-best-glide.
function tuning(p) {
  if (p._tune) return p._tune;
  const weight = weightOf(p);
  const vbg2 = (p.mass * G_KT) / (2 * p.dragP * (p.ldMax || 7));
  const t = { weight, kInd: 0.25 * p.dragP * vbg2 * vbg2 / (weight * weight), bestGlide: Math.sqrt(vbg2) };
  // AoA that holds weight at best glide; the power-off nose drop (§3) restores toward it.
  t.aoaGlide = clamp((weight / (0.5 * vbg2 * p.liftScale) - CL0) / CL_ALPHA, 0, p.aoaCrit * 0.8);
  try { Object.defineProperty(p, '_tune', { value: t, enumerable: false, configurable: true }); } catch { /* frozen params: recompute each call */ }
  return t;
}
// Publish bestGlide onto each fixed-wing type for the cockpit's blue yoke light.
for (const p of Object.values(TYPES)) if (!p.heli) p.bestGlide = Math.round(tuning(p).bestGlide);

export function createState(p) {
  return {
    airspeed: 0, altitude: 0, pitch: p.groundPitch || 0, bank: 0, heading: 0,   // taildraggers start parked nose-high on the tailwheel
    // Floor under the wheels (ft). 0 except on a rooftop pad, where the owner sets it per frame
    // (cockpit.js deckFloorFt) from the roof geometry CFIT reads.
    groundFt: 0,
    tailDown: 1,           // taildragger heli: tailwheel planted (the parked 3-point sit): see stepHeli §2
    vs: 0,                 // ft/min
    rpm: 0,                // 0..1 (spooled fraction of throttle)
    elevEff: 0,            // the yoke's built-up pitch effect (lags the raw input)
    rollEff: 0,            // the yoke's built-up roll effect (lags the raw input)
    aoa: 0, stallMargin: 1, stalled: false, stallTimer: 0, stallDir: 0,
    stallDepth: 0,         // 0..1: how far past the critical angle the wing is (drives the CL collapse, the wing-drop and the sink)
    buffet: 0,             // 0..1: pre-stall burble; the cockpit shakes on it
    g: 1,                  // load factor: real, derived from the AoA the wing is actually at (§6a)
    overG: false,          // latched so the airframe groans ONCE per excursion past gLimit, not every frame

    slip: 0,               // forward-slip intensity (0..1), eased from crossed-control input
    onGround: true, groundSpeed: 0,
    // last-frame events the audio layer reads (cleared each step)
    events: [],
  };
}

// ── Helicopter integrator (Dragonfly / Mini 500) ─────────────────────────────
// Arcade hover model: collective, cyclic and pedals. Its failure modes are rotor-RPM droop under
// a greedy collective and settling-with-power in a slow powered descent.
function stepHeli(state, input, p, dt) {
  const s = state;
  s.events = [];
  // Cyclic folds in trim so a centred stick holds the trimmed attitude.
  const cycP = clamp((input.elevator || 0) + (input.trim || 0), -1, 1);   // aft (+1) = nose up / decelerate
  const cycR = clamp(input.aileron || 0, -1, 1);     // right (+1) = bank right
  const coll = clamp(input.collRaw ?? input.throttle ?? 0, 0, 1);   // collective lever: the pilot works it even engine-out (for autorotation)
  const powered = input.power !== false;             // engine driving the rotor (false ⇒ dead engine, autorotation)
  const pedal = clamp(input.pedal || 0, -1, 1);

  // 1. Rotor Nr.
  // Powered: Nr droops if the collective outruns the engine (less Nr, less thrust).
  // Engine out: descent upflow drives the rotor; flat pitch holds Nr, pulling collective bleeds it.
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
      // Taildragger heli: `tailDown` is tailwheel contact (1 planted, 0 flown). On lift-off the tail
      // comes up first and she rolls flat on her mains; on landing she stays tail-up until you pull back.
      const liftFrac = coll * Nr * (p.liftMax || 2.6) / (p.hoverThrust || 1);
      // Tail-up band sits below the hover point so the rotation shows on the wheels before lift-off.
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

  // 3. Yaw: pedals wash out with speed and do nothing on the ground. Past ETL, bank turns the path.
  if (!s.onGround) {
    const pedalAuth = 1 - clamp(s.airspeed / p.cruise, 0, 0.85);
    s.heading = wrap360(s.heading + pedal * (p.yawRate || 60) * pedalAuth * dt);
  }
  if (!s.onGround && s.airspeed > p.vs0) {
    const turnRate = (G_KT * Math.tan(s.bank * D2R)) / Math.max(p.cruise, s.airspeed) * R2D;
    s.heading = wrap360(s.heading + turnRate * dt);
  }

  // 4. Horizontal accel: disc tilt, plus gravity when nose-low so a dive builds real speed.
  const accel = s.onGround ? 0 : (-s.pitch * (p.cyclicThrust || 2) * Nr) + clamp(-s.pitch, 0, 35) * 0.16;
  const drag = p.dragP * s.airspeed * Math.abs(s.airspeed);
  s.airspeed = clamp(s.airspeed + (accel - drag) * dt, -0.18 * p.cruise, p.vne * 1.03);
  if (s.onGround) s.airspeed -= Math.sign(s.airspeed) * Math.min(Math.abs(s.airspeed), p.rollFric * dt);
  s.groundSpeed = Math.abs(s.airspeed);

  // 5. Vertical: rotor thrust vs hover weight, with translational lift (ETL) adding bite in forward flight.
  let thrustV = coll * Nr * (p.liftMax || 2.6);
  thrustV *= 1 + 0.18 * clamp(Math.abs(s.airspeed) / p.vs0, 0, 1);
  // Vortex ring: entered on a slow, fast, powered descent; lift is capped below hover. Exit only by
  // flying out past ETL or lowering the collective, never by pulling more pitch.
  const slow = Math.abs(s.airspeed) < p.vs0 * 0.9;
  if (!s.vrsState) {
    // Powered only: an engine-out descent can't enter it.
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
  // Service ceiling: the power margin over hover thins to zero at p.ceiling. Sink is untouched,
  // since thin air must never stop you coming down.
  const hoverT = p.hoverThrust || 1;
  if (thrustV > hoverT) {
    const thin = clamp(1 - s.altitude / (p.ceiling || 20000), 0, 1);   // 1 on the deck → 0 at the ceiling
    thrustV = hoverT + (thrustV - hoverT) * thin;
  }
  // Sinks harder than she climbs. Climb reads `vsGainUp` (falls back to vsGain), sink reads vsGain.
  const deficit = thrustV / hoverT - 1;
  let vsTarget = clamp(deficit * (deficit < 0 ? p.vsGain * 1.9 : (p.vsGainUp || p.vsGain)), -p.vsMax * 2.6, p.vsMax);
  // Rising air (thermals.js): the whole air mass moves, so it carries a helicopter too.
  if (!s.onGround && input.lift) vsTarget += input.lift;
  // Ground cushion softens a descent near the deck. ⚠ Measured from the floor (groundFt), not zero.
  const agl = s.altitude - (s.groundFt || 0);
  if (!s.onGround && vsTarget < 0 && agl < HELI_GROUND_EFFECT_FT) {
    const ge = clamp(1 - agl / HELI_GROUND_EFFECT_FT, 0, 1);   // 0 at the top of the band → 1 on the deck
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

  // 7. Ground contact: set down vertically (no rollout). A hard arrival flags a heavy touchdown.
  const floor = s.groundFt || 0;
  if (s.altitude <= floor) {
    if (!s.onGround && s.vs < -300) s.events.push({ type: 'touchdown', severity: s.vs < -600 ? 'hard' : 'firm', vs: s.vs });
    // Taildragger: seed tailwheel contact from the touchdown pitch; the pilot walks the tail down (§2).
    if (!s.onGround && p.groundPitch) s.tailDown = clamp(s.pitch / p.groundPitch, 0, 1);
    s.altitude = floor; s.onGround = true; s.vs = Math.max(0, s.vs);
  } else s.onGround = false;
  return s;
}

// ── Ground integrator (the truck) ─────────────────────────────────────────────
// A bicycle model: a front axle you point, a rear axle that follows, and the surface under the
// tyres. Same contract as the rest of the file: mutate and return state, allocate nothing.
// The truck integrates its own (x, y) in corridor space (plugins/trucking/corridor.js), so position
// and heading move together. Heading: 0 = north = −y, 90 = east = +x.
// ── LOCK ─────────────────────────────────────────────────────────────────────
// A fixed mechanical lock: never fade it with speed. Wheel travel (helm-wheel.js TRUCK_LOCK_TURNS)
// is what stops a flick into a slide at speed. Radius is L / tan(δ), so lock near the stops is
// nonlinear. Coupled stays at 50 because a kingpin scrubbing the drives is a real limit, and it
// makes dropping the box before shuffling worth doing.
const TRUCK_STEER_LOCK = 50;     // coupled: a real steer axle
// Bobtail: pivots near the spot so a tractor can turn inside a yard; tan δ keeps mid-travel unchanged.
const TRUCK_STEER_BOB  = 78;
// Backing bobtail at walking pace: more lock, so the tail comes round hard.
const TRUCK_STEER_BACK = 85;
function truckSteerLock(speed, hitched) {
  if (hitched) return TRUCK_STEER_LOCK;
  return (speed || 0) < -0.01 ? TRUCK_STEER_BACK : TRUCK_STEER_BOB;
}
// Exported so the cab's lights key off the one idle speed; never copy it into a panel.
export const IDLE = 0.16;        // idle, as a fraction of redline
const STALL_RPM = 0.11;          // below this in gear, clutch out, it dies
// ⚠ Absolute mph: scale these with the fleet's speeds, or a truck can feather away in top gear.
const LAUNCH_MPH = 8.4;          // below this, ON THE THROTTLE, a driver is feathering the clutch
const CRAWL_MPH  = 2.8;          // below this the clutch is always in: parking must not stall you
const REVERSE_RATIO = 1.35;    // reverse is deeper than first: the slowest, strongest gear there is
// First gets back some of the spread the sqrt in 'ratioBoost' flattens: more shove on launches and
// hill starts, applied to the ratio term rather than the pedal lag. Reverse borrows it.
const FIRST_BOOST = 1.9;
// ⚠ First spools faster than second on purpose (~0.55 s to full pull) so launch torque arrives when
// wanted. A named exception; the other ratios keep the spool gradient. Reverse borrows it.
const FIRST_SPOOL = 1.8;
const REVERSE_CAP = 0.18;        // reverse is geared low and you cannot see: a fraction of top speed
export const FADE_AT = 0.62;            // brake temperature at which the pedal starts lying to you
// ── Longitudinal inertia ─────────────────────────────────────────────────────
// Slows how long the rig takes to work through the box. Drive and passive resistances scale
// together, so top speed is untouched. Never use thrustMax for this: it breaks the verge invariant
// and the authored top speeds. ⚠ Brakes, the Jake and the shrouds sit outside it, or every stopping
// distance and brake fade would change.
const INERTIA = 2;
const JACKKNIFE_DEG = 55;        // where the restoring term gives up and the trailer drives the fold
const PHI_MAX = 88;              // trailer against the cab; there is no forward through this

// Torque curve, as a multiplier on thrustMax: flat between band[0] and band[1], lugging below,
// falling off above.
function torqueAt(rpm, p) {
  const [lo, hi] = p.band;
  if (rpm >= lo && rpm <= hi) return 1;
  if (rpm < lo) {
    // Lugging: falls to nearly nothing at stall.
    const t = clamp((rpm - STALL_RPM) / Math.max(0.01, lo - STALL_RPM), 0, 1);
    return 0.12 + 0.88 * t * t;
  }
  // Over-revving.
  const t = clamp((rpm - hi) / Math.max(0.01, 1 - hi), 0, 1);
  return 1 - 0.75 * t * t;
}

// ── The splitter box ─────────────────────────────────────────────────────────
// The surface is three verbs (shift up, shift down, split) over a flat ratio ladder. Gear 0 is
// neutral. Skip-shifting works or doesn't purely through the torque curve.
export function truckShift(s, p, delta) {
  const next = clamp((s.gear ?? 1) + delta, -1, p.gears.length - 1);
  if (next === s.gear) return s.gear;
  s.gear = next;
  s.shifted = true;                       // one frame's flag: the cab clunks, the audio bumps
  return s.gear;
}
// Select a gear directly (the H-gate), with the same writes as truckShift. Reverse is −1, neutral 0;
// the gate's legality rules (no reverse while rolling) live in the cab, never here.
export function truckSelectGear(s, p, gear) {
  const next = clamp(gear | 0, -1, p.gears.length - 1);
  if (next === s.gear) return s.gear;
  s.gear = next;
  s.shifted = true;
  return s.gear;
}
// The splitter: half a step. Don't chain on truckShift's return: it's a gear number, and neutral is falsy.
export function truckSplit(s, p) {
  truckShift(s, p, s.split ? -1 : 1);
  s.split = !s.split;
  return s.gear;
}
// The gear that would hold the band at this speed: a suggestion for the cab, never an automatic.
export function bestGear(speed, p) {
  const mid = (p.band[0] + p.band[1]) / 2;
  let best = 1, err = Infinity;
  for (let g = 1; g < p.gears.length; g++) {
    const e = Math.abs((speed / p.tileMph) * p.gears[g] - mid);
    if (e < err) { err = e; best = g; }
  }
  return best;
}
// ── The fifth wheel ──────────────────────────────────────────────────────────
// Hitching needs a stop and rough alignment; HITCH_PHI is generous on purpose.
export const HITCH_MPH = 3, HITCH_PHI = 25;
export function canHitch(s) { return Math.abs(s.speed) <= HITCH_MPH && Math.abs(s.phi || 0) <= HITCH_PHI; }
export function truckHitch(s, p, trailer = {}) {
  if (s.hitched || !canHitch(s)) return false;
  s.hitched = true;
  s.trailerKg = trailer.kg ?? p.trailerKg;
  // Clamp to the deck rating (p.kg, the same number `market buy` sizes against), or the truck can't move.
  s.loadKg = clamp(trailer.loadKg || 0, 0, p.kg);
  // The box starts straight behind you.
  s.trailerHeading = s.heading; s.phi = 0;
  return true;
}
// Dropping needs the same stillness and a roughly straight box.
export function truckUnhitch(s) {
  if (!s.hitched || Math.abs(s.speed) > HITCH_MPH || Math.abs(s.phi) > 12) return null;
  const dropped = { kg: s.trailerKg, loadKg: s.loadKg, heading: s.trailerHeading, x: s.x, y: s.y };
  s.hitched = false; s.trailerKg = 0; s.loadKg = 0; s.phi = 0;
  return dropped;
}
function stepTruck(state, input, p, dt) {
  const s = state;
  s.events = [];
  // The wheel reports an absolute axle position, not a rate (helm-wheel.js `absolute` mode).
  const steer = clamp(input.steer || 0, -1, 1);
  const brake = clamp(input.brake || 0, 0, 1);

  // The pedal is a first-order follower (`s.pedal`, boost) so the truck doesn't answer like a go-kart.
  // Lag is gear-dependent; lifting is quick so you can park. Everything below reads the boosted value.
  const pedal = clamp(input.throttle || 0, 0, 1);
  const gearIdx = Math.abs(clamp(s.gear ?? 1, -1, p.gears.length - 1));
  // Top ≈ 0.34 s to full pull; first is FIRST_SPOOL (~0.55 s). Reverse takes first's.
  const spool = gearIdx <= 1
    ? FIRST_SPOOL
    : 0.95 + 2.0 * ((gearIdx - 1) / Math.max(1, p.gears.length - 2));
  const rate = pedal > (s.pedal ?? 0) ? spool : 6.0;
  s.pedal = clamp((s.pedal ?? 0) + (pedal - (s.pedal ?? 0)) * Math.min(1, rate * dt), 0, 1);
  const throttle = s.pedal;

  // 1. Surface: grip scales cornering, drag holding speed, cap the top speed. The verge slows, never walls.
  const surf = SURFACES[input.surface] || SURFACES.road;

  // Auto: shifts for you (cab assist, headless harnesses), a little late up and early down so manual is faster.
  if (input.auto && !s.stalled) {
    const want = bestGear(s.speed, p);
    if (want !== s.gear && !s.autoHold) { s.gear = want; s.shifted = true; s.autoHold = 0.35; }
  }
  if (s.autoHold > 0) s.autoHold = Math.max(0, s.autoHold - dt);

  // 2. Gearbox: engine speed derives from road speed through the gear, and the throttle makes torque.
  // Lugging, over-revving, stalling and engine braking fall out of one curve and one ratio.
  // Gear −1 is reverse, borrowing first's ratio.
  const gear = s.gear = clamp(s.gear ?? 1, -1, p.gears.length - 1);
  // Reverse is deeper than first (REVERSE_RATIO) or it can't back a loaded trailer out of a bay.
  const ratio = gear === 0 ? 0 : p.gears[Math.abs(gear)] * (gear < 0 ? REVERSE_RATIO : 1);
  const clutch = clamp(input.clutch || 0, 0, 1);          // 1 = fully in, engine disconnected
  const engaged = 1 - clutch;

  // Engine speed, 0..1 of redline. Neutral or a depressed clutch leaves the engine free.
  const geared = ratio > 0 ? (Math.abs(s.speed) / p.tileMph) * ratio : 0;
  // A free engine is held at the band, not run to redline, or a loaded truck can't pull away in first.
  const freeRpm = IDLE + throttle * (p.band[1] - IDLE);

  // Auto-clutch slip windows, keyed on speed (never rpm, or tall gears slip forever and stalls vanish):
  // LAUNCH: below LAUNCH_MPH on the throttle, the clutch feathers and the gear can't drag the engine.
  // CRAWL: below CRAWL_MPH the clutch is always in, so parking never stalls.
  const launching = ratio === 0 || engaged < 0.05 || Math.abs(s.speed) < CRAWL_MPH
    || (Math.abs(s.speed) < LAUNCH_MPH && throttle > 0.05);
  const slipping = launching && geared < p.band[0];
  s.rpm = slipping ? freeRpm : geared * engaged + freeRpm * (1 - engaged);

  const torque = torqueAt(s.rpm, p);
  // A slipping clutch passes only part of the drive, so a tall gear has to slip longer.
  const SLIP_TRANSMIT = 0.45;
  // A gear multiplies torque: normalised to top gear (top = 1) and square-rooted to tame the spread.
  const ratioBoost = ratio > 0
    ? Math.sqrt(ratio / p.gears[p.gears.length - 1]) * (Math.abs(gear) === 1 ? FIRST_BOOST : 1)
    : 0;
  const drive = p.thrustMax * throttle * torque * engaged * surf.drive * ratioBoost * (slipping ? SLIP_TRANSMIT : 1);

  // Stall: clutch out, rolling, and the road drags the engine under STALL_RPM. Slipping never stalls.
  if (!s.stalled && !slipping && geared < STALL_RPM) {
    s.stalled = true;
    s.events.push('stall');
  }
  if (s.stalled) {
    // Dead. The clutch (or neutral) lets you restart; `starter` is the cab holding the key.
    if (clutch > 0.5 || ratio === 0) { if (input.starter) { s.stalled = false; s.events.push('start'); } }
    s.rpm = 0;
  }
  const power = s.stalled ? 0 : drive;

  // Engine braking: off the throttle in gear, stronger in low gears. Keeps service brakes cold on a descent.
  const jake = (input.jake && !s.stalled && ratio > 0 && engaged > 0.5) ? p.jake : 0;
  // A slipping clutch transmits no engine drag either, or launches fight themselves.
  const engBrake = (s.stalled || slipping) ? 0
    : (ratio > 0 ? engaged * (1 - throttle) * ratio * p.engBrake * (1 + jake) : 0);

  // Mass ratio: blunts the engine, lengthens the stop, heats the brakes, slows the trailer swing.
  const mass = (p.kg + (s.trailerKg || 0) + (s.loadKg || 0)) / p.kg;   // 1 = bobtail, ~2.5 = loaded

  // Brake temperature: service brakes heat, the engine brake and Jake don't. Past FADE_AT the pedal fades.
  const braking = brake * (Math.abs(s.speed) / p.tileMph);
  s.brakeTemp = clamp((s.brakeTemp || 0) + (braking * mass * 0.13 - (s.brakeTemp || 0) * 0.22) * dt, 0, 1.4);
  const fade = s.brakeTemp <= FADE_AT ? 1 : Math.max(0.35, 1 - (s.brakeTemp - FADE_AT) * 1.6);
  if (s.brakeTemp > FADE_AT && !s.wasFading) { s.events.push('brakefade'); s.wasFading = true; }
  else if (s.brakeTemp < FADE_AT * 0.8) s.wasFading = false;

  // Direction is the gear's sign; speed is signed, so the trailer term flips on its own in reverse.
  const dir = gear < 0 ? -1 : 1;
  // Resistances oppose the direction of travel. ⚠ At a dead stop they oppose nothing (sign 0), or the
  // truck drifts backwards; when pulling away they oppose the asked-for direction.
  const moving = Math.sign(s.speed) || (power > 0 ? dir : 0);
  // Rolling resistance isn't divided by mass (it grows with weight); aero, brakes and engine brake are.
  // Dead engine means dead lifters: the rig sits on its shrouds, the ground bites (SETTLED_DRAG) and
  // nothing turns. You still roll and can still brake.
  const SETTLED_DRAG = 5.5;
  // Rolling and aero ride the INERTIA divisor; brakes, Jake and the settled extra over rolling don't.
  const roll = p.rollFric * surf.drag;
  const aero = p.dragP * s.speed * s.speed;
  const retard = brake * p.brake * fade + engBrake + (s.stalled ? roll * (SETTLED_DRAG - 1) * mass : 0);
  const before = s.speed;
  s.speed += ((power * dir / mass - (roll + aero / mass) * moving) / INERTIA
              - (retard / mass) * moving) * dt;
  // Resistance stops you; it never drags you back through zero.
  if (before !== 0 && Math.sign(s.speed) !== Math.sign(before) && power === 0) s.speed = 0;
  // Snap a tiny residual to a stop, off the throttle only so it never eats a pull-away.
  // never eat a genuine pull-away.
  if (power === 0 && Math.abs(s.speed) < 0.05) s.speed = 0;
  const cap = p.topSpeed * surf.cap;
  s.speed = clamp(s.speed, -cap * REVERSE_CAP, cap);
  s.inBand = torque > 0.85 && !s.stalled;             // the cab lights this; you learn to drive on it

  // 3. Bicycle model: yaw = v·tan(δ)/L.
  const delta = steer * truckSteerLock(s.speed, s.hitched) * D2R;
  const tps = s.speed / p.tileMph;                    // tiles per second: the sim's real velocity
  // ⚠ Grip fades in with speed: a crawl is pure kinematics, or full lock in the dirt depot does nothing.
  // `p.tread` is tyre wear (plugins/trucking/service.js); absent means 1.
  const grip = surf.grip * (p.tread ?? 1);
  const gripAuth = grip + (1 - grip) * (1 - Math.min(1, Math.abs(s.speed) / 22));
  // Engine off: no yaw (see SETTLED_DRAG).
  const yaw = (!s.stalled && Math.abs(tps) > 0.001) ? (tps * Math.tan(delta) / p.wheelbase) * R2D * gripAuth : 0;
  s.heading = wrap360(s.heading + yaw * dt);
  s.yawRate = yaw;

  // 3b. Trailer: one free variable, the articulation angle φ = θ − ψ.
  //     ψ̇ = (v·sin φ − a·θ̇·cos φ) / Lt
  // Jackknife isn't coded: past ~55° the sin term drives the fold. Reversing (v < 0) makes it diverge.
  if (s.hitched) {
    const phi = s.phi * D2R;
    const psiDot = ((tps * Math.sin(phi) - p.hitchOffset * (yaw * D2R) * Math.cos(phi)) / p.trailerLen) * R2D;
    // Heavier trailers swing and recover more slowly.
    s.trailerHeading = wrap360(s.trailerHeading + psiDot / Math.sqrt(mass) * dt);
    let d = s.heading - s.trailerHeading;
    s.phi = ((d + 540) % 360) - 180;
    if (Math.abs(s.phi) > JACKKNIFE_DEG && !s.wasFolding) { s.events.push('jackknife'); s.wasFolding = true; }
    else if (Math.abs(s.phi) < JACKKNIFE_DEG * 0.6) s.wasFolding = false;
    // Past PHI_MAX the trailer is against the cab: the one clamp.
    if (Math.abs(s.phi) >= PHI_MAX) {
      s.phi = Math.sign(s.phi) * PHI_MAX;
      s.trailerHeading = wrap360(s.heading - s.phi);
      if (s.speed > 6) s.speed *= 0.94;
    }
  }

  // 4. Position, in corridor tiles.
  const h = s.heading * D2R;
  s.x += Math.sin(h) * tps * dt;
  s.y += -Math.cos(h) * tps * dt;

  // 5. Feedback for the cab and audio. `slip` is the tyres losing the surface in a corner.
  const lat = Math.abs(yaw) * tps / 60;
  s.slip = clamp(lat / Math.max(0.05, grip), 0, 1);
  if (s.slip > 0.85 && !s.wasSliding) { s.events.push('slide'); s.wasSliding = true; }
  else if (s.slip < 0.5) s.wasSliding = false;
  s.onRoad = input.surface === 'road';
  s.groundSpeed = s.speed;
  return s;
}
// Per-surface handling: `cap` fraction of top speed, `grip` cornering, `drag` rolling resistance,
// `drive` engine reaching the ground. ⚠ Every row must satisfy thrustMax × drive > rollFric × drag
// with headroom, or the truck can't move on it.
export const SURFACES = {
  road:     { cap: 1.00, grip: 1.00, drag: 1.00, drive: 1.00 },
  // Unpaved road (only the city leg's `dirt_road`, see surfaceUnder): slower than tarmac, unlike the verge.
  dirt:     { cap: 0.86, grip: 0.86, drag: 1.12, drive: 0.96 },
  shoulder: { cap: 0.72, grip: 0.68, drag: 1.30, drive: 0.88 },   // gravel: it rumbles, and it pulls
  offroad:  { cap: 0.34, grip: 0.42, drag: 1.60, drive: 0.62 },   // the verge: passable, and a mistake
};

export function createTruckState(p) {
  return {
    speed: 0, heading: 180, x: 0, y: 0,          // parked at the gate, pointed down-corridor (south)
    rpm: IDLE, yawRate: 0, slip: 0, wasSliding: false,
    pedal: 0,                                    // boost, not pedal position
    gear: 1, split: false, stalled: false, inBand: false, shifted: false,
    onRoad: true, groundSpeed: 0,
    // `hitched` false is bobtail; φ and trailer heading only mean anything while hitched.
    hitched: false, phi: 0, trailerHeading: 180, trailerKg: 0, loadKg: 0,
    brakeTemp: 0, wasFading: false, wasFolding: false,
    events: [],
  };
}

// The truck's half of `readout`.
export function truckReadout(s, p) {
  return {
    speed: Math.round(s.speed),
    heading: Math.round(s.heading),
    rpm: Math.round(s.rpm * 100),
    gear: s.gear, gears: p.gears.length - 1,
    inBand: !!s.inBand, stalled: !!s.stalled,
    pedal: +(s.pedal || 0).toFixed(2),
    rich: +(s.rich || 0).toFixed(2),
    bang: +(s.bang || 0).toFixed(2),           // BOOST, not pedal position: what the engine is actually making

    best: bestGear(s.speed, p),                 // a suggestion, never an automatic
    slip: +s.slip.toFixed(2),
    hitched: !!s.hitched, phi: +(s.phi || 0).toFixed(1),
    folding: Math.abs(s.phi || 0) > JACKKNIFE_DEG,
    brakeTemp: +(s.brakeTemp || 0).toFixed(2), fading: (s.brakeTemp || 0) > FADE_AT,
    reversing: s.gear < 0,
    onRoad: s.onRoad,
    x: +s.x.toFixed(3), y: +s.y.toFixed(3),
    topSpeed: p.topSpeed,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// THE BOAT
// ════════════════════════════════════════════════════════════════════════════
//
// The truck's shape (client-sim integrator the server reconciles, surface table, `tileMph` dial)
// without the gearbox: one drive, no ratios.

// ── WATER, AS A SURFACE ─────────────────────────────────────────────────────
// Same columns and invariant as SURFACES: thrustMax × drive > waterFric × drag on every row.
// ⚠ Land is deliberately not a row (it would be a violation inside the gate's sweep); aground is
// its own branch in stepBoat.
export const WATER = {
  open:     { cap: 1.00, grip: 1.00, drag: 1.00, drive: 1.00 },
  // Chop only costs speed here; the damage model reads the sea.
  chop:     { cap: 0.88, grip: 0.92, drag: 1.18, drive: 0.97 },
  // Over the bar: drive half out of the water. Passable, and a mistake.
  shallows: { cap: 0.55, grip: 0.70, drag: 1.70, drive: 0.78 },
};

// Hull costs are fractions of a full hull (the 0..1 bar).
const HULL_LAND = 0.34;        // driving it onto the beach
// ⚠ Slam cost is quadratic in the excess over HULL_FREE_VS, and the free drop is tuned below what an
// ordinary sea produces, or the slam branch is dead code.
// Lip launch (step 6): water fall-away needed (tiles/s²), least upward speed that counts, share kept, chop share.
const LIP_G = 0.11, LIP_MIN_UP = 0.06, LIP_THROW = 2.0, LIP_CHOP = 0.25;
// Ride attitude spring toward the sea (step 9): stiffness rad/s, damping ratio, chop share.
const RIDE_W = 7, RIDE_Z = 0.85, RIDE_CHOP = 0.3;
// Climbing a face the bow rises past it (step 9): slope share, full by CLIMB_TPS, lead (s), max (rad).
// Airborne the nose follows the path at AIR_UP/AIR_DOWN, eased over AIR_TAU s.
const CLIMB_LIFT = 0.9, CLIMB_TPS = 1.0, CLIMB_LEAD = 0.12, CLIMB_MAX = 0.5;
const AIR_UP = 1.4, AIR_DOWN = 0.45, AIR_TAU = 0.12;
// Per unit of squared excess. Tuned so a 45 kt gale head-on costs about a quarter of the hull in five minutes.
const HULL_SLAM = 0.035;
// An ordinary swell's landings are free; a big sea or a gale still costs.
const HULL_FREE_VS = 0.55;
// The most one landing can cost, however it was arrived at.
const HULL_SLAM_MAX = 0.02;
// Seconds the sea clock may differ from dt before the step counts as a jump in the water (step 3).
const SEA_JUMP_S = 0.1;
// Per second, beam-on hull cost; worst case about a tenth of the hull a minute.
const HULL_BEAM = 0.004;
// Deadband: the swell's faces reach 25°, so only a real lean counts.
const HULL_BEAM_FROM = 0.35, HULL_BEAM_FULL = 0.70;   // radians: ~20 deg to ~40 deg
const NITRO_HEAT_HURT = 0.82;  // where leaning on the bottle starts costing hull

export function createBoatState(p) {
  return {
    speed: 0, heading: 0, x: 0, y: 0,
    pedal: 0,                     // the blower follower: what the engine is making, not the lever
    rich: 0, bang: 0,             // see step 4b
    rpm: IDLE,
    yawRate: 0, drift: 0, slip: 0,
    // `z` is height above the local surface: 0 floating, positive is air.
    z: 0, vs: 0, airborne: false,
    heave: 0, pitch: 0, roll: 0,
    // The swell the caller draws. ⚠ Zero (flat water) is the default, so harnesses get no waves.
    seaRoll: 0, seaWind: 0, ssx: 0, ssy: 0, clock: 0,
    nitro: 1, nitroOn: false, nitroHeat: 0,
    hull: 1, hullHit: 0,
    aground: false, planing: false,
    events: [],
  };
}

// ── HOW THE SEA IS HOLDING THE HULL, RIGHT NOW ──────────────────────────────
//
// The tangent plane at her centre, unlike the Echelon's three-point fit (`yachtRide`): this hull is
// a fiftieth of the swell, so a short boat rides tangent to the face. `seaSlope` is closed form.
export function boatSeaPose(s, p, t) {
  const rollA = s.seaRoll || 0, windA = s.seaWind || 0;
  if (!(rollA > 1e-4 || windA > 1e-4)) return { heave: 0, pitch: 0, roll: 0, du: 0, dv: 0 };
  const u = s.x + (s.ssx || 0), v = s.y + (s.ssy || 0);
  // ⚠ Roll and wind sea only, the terms the mesh and `seaPoseAt` use. Height rides the chop via
  // `hullChopAt`; attitude takes a low-passed share (step 9).
  const [du, dv] = seaSlope(u, v, t, rollA, 0, windA);
  const h = (s.heading || 0) * D2R, sh = Math.sin(h), ch = Math.cos(h);
  // Forward is (sin h, -cos h), right is (cos h, sin h): the integrator's own basis, or she leans wrong.
  const alongF = du * sh + dv * -ch;
  const alongR = du * ch + dv * sh;
  return {
    heave: seaRoll(u, v, t, rollA) + seaWind(u, v, t, windA),
    pitch: Math.atan(alongF),    // bow up when the water ahead is rising
    roll: Math.atan(alongR),     // starboard up when the water to starboard is higher
    du, dv,
  };
}

// ── THE RIDE THE PICTURE SHOWS ───────────────────────────────────────────────────────────────
//
// ⚠ The picture is posed differently from the physics: the drawn hull is much longer than `hullLen`,
// so it's posed by a least-squares plane through the drawn sea (swell, wind sea, chop) at fifteen
// points over the drawn footprint (checked by scripts/shapes/boatride.mjs). See `ownHullWash` too.
//
//   vr     drawn vertical over plan scale (CONTACT_VS), so a water slope b is a pitch of atan(b / vr)
//   trim   the tabs, -1..1: bow-up running trim
//   spd01  speed, 0..1 of her ceiling
//
// Airborne, the sim's attitude takes over, handing back over a quarter second after landing.
// ⚠ Roll is starboard-up positive; the renderer's `bank` is starboard down, so callers negate it.
// `r` is per-view caller state, so a camera that changes scale doesn't inherit a ride.
export function boatFitPose(s, t, halfLen, halfBeam) {
  const rollA = s.seaRoll || 0, windA = s.seaWind || 0, chopA = s.seaChopH > 0 ? s.seaChopH : 0;
  if (!(rollA > 1e-4 || windA > 1e-4 || chopA > 0)) return { heave: 0, slopeF: 0, slopeR: 0 };
  const h = (s.heading || 0) * D2R, sh = Math.sin(h), ch = Math.cos(h);
  const u0 = s.x + (s.ssx || 0), v0 = s.y + (s.ssy || 0);
  let n = 0, sz = 0, sFz = 0, sGz = 0, sFF = 0, sGG = 0;
  for (const fu of [-1, -0.5, 0, 0.5, 1]) for (const gu of [-1, 0, 1]) {
    const F = fu * halfLen, G = gu * halfBeam;
    // The integrator's basis.
    const u = u0 + sh * F + ch * G, v = v0 - ch * F + sh * G;
    const z = seaRoll(u, v, t, rollA) + seaWind(u, v, t, windA) + (chopA ? seaChop(u, v, t) * chopA : 0);
    n++; sz += z; sFz += F * z; sGz += G * z; sFF += F * F; sGG += G * G;
  }
  // Symmetric samples, so the plane's three terms separate exactly.
  return { heave: sz / n, slopeF: sFF > 0 ? sFz / sFF : 0, slopeR: sGG > 0 ? sGz / sGG : 0 };
}
const RIDE_HEAVE_TAU = 0.05, RIDE_TILT_TAU = 0.09, RIDE_LAND_TAU = 0.25, RIDE_RUN_TRIM = 2.5 * D2R, RIDE_TAB_TRIM = 1.5 * D2R;
export function stepBoatRide(r, s, dt, { halfLen, halfBeam, vr = 1, trim = 0, spd01 = 0 } = {}) {
  const fit = boatFitPose(s, s.clock || 0, halfLen, halfBeam);
  let pitch = Math.atan(fit.slopeF / vr), roll = Math.atan(fit.slopeR / vr);
  // Running trim: bow-up on the plane, set by the tabs (down is -1, bow down).
  const plane = clamp((spd01 - 0.15) / 0.35, 0, 1);
  pitch += plane * (RIDE_RUN_TRIM + RIDE_TAB_TRIM * clamp(trim, -1, 1)) / vr;
  const k = (tau) => (dt > 0 ? 1 - Math.exp(-dt / tau) : 1);
  r.air = (r.air ?? 0) + ((s.airborne ? 1 : 0) - (r.air ?? 0)) * k(s.airborne ? 0.04 : RIDE_LAND_TAU);
  // ⚠ Airborne, tilt off the water's plane is limited by height over half length/beam, or the drawn
  // transom swings down through the water.
  const zAir = Math.max(0, s.z || 0);
  const limP = Math.asin(Math.min(1, zAir / Math.max(1e-6, vr * halfLen)));
  const limR = Math.asin(Math.min(1, zAir / Math.max(1e-6, vr * halfBeam)));
  pitch += clamp((s.pitch || 0) / vr - pitch, -limP, limP) * r.air;
  roll += clamp((s.roll || 0) / vr - roll, -limR, limR) * r.air;
  if (r.heave == null) { r.heave = fit.heave; r.pitch = pitch; r.roll = roll; }
  r.heave += (fit.heave - r.heave) * k(RIDE_HEAVE_TAU);
  r.pitch += (pitch - r.pitch) * k(RIDE_TILT_TAU);
  r.roll += (roll - r.roll) * k(RIDE_TILT_TAU);
  return { heave: r.heave + (s.z || 0), pitch: r.pitch, roll: r.roll };
}

// The chop under her centre; `seaChopH` is its drawn amplitude from the seat. Absent means none.
function hullChopAt(s, t) {
  if (!(s.seaChopH > 0)) return 0;
  return seaChop(s.x + (s.ssx || 0), s.y + (s.ssy || 0), t) * s.seaChopH;
}

// ── MOVING HER ORIGIN ────────────────────────────────────────────────────────
//
// ⚠ The sea is drawn in the map window's frame, so on a recentre everything that remembers the water
// moves by the same step, or the jump reads as a launch or a mid-air landing.
export function shiftBoatOrigin(s, p, dx, dy) {
  const t = s.clock || 0;
  const w0 = boatSeaPose(s, p, t).heave, c0 = hullChopAt(s, t);
  s.x += dx; s.y += dy;
  const dw = boatSeaPose(s, p, t).heave - w0, dc = hullChopAt(s, t) - c0;
  // `heave` is the swell alone; `alt` is measured against the swell plus the chop.
  if (s.heave !== undefined) s.heave += dw;
  if (s.prevHeave !== undefined) s.prevHeave += dw;
  if (s.chopH !== undefined) s.chopH += dc;
  if (s.alt !== undefined) s.alt += dw + dc;
  // Rates restart rather than read the jump as a lip.
  if (s.rideUp !== undefined) s.rideUp = undefined;
  s.seaPitch0 = undefined;
}

export function boatReadout(s, p) {
  return {
    speed: Math.round(s.speed),
    heading: Math.round(s.heading),
    rpm: Math.round(s.rpm * 100),
    pedal: +(s.pedal || 0).toFixed(2),
    slip: +(s.slip || 0).toFixed(2),
    planing: !!s.planing,
    airborne: !!s.airborne,
    air: +(s.z || 0).toFixed(3),
    vs: +(s.vs || 0).toFixed(3),
    pitch: +((s.pitch || 0) * R2D).toFixed(1),
    roll: +((s.roll || 0) * R2D).toFixed(1),
    // Stored as 0..1 condition, reported as a percentage: the one place the two conventions meet.
    hullPct: Math.max(0, Math.round((s.hull ?? 1) * 100)),
    nitro: +(s.nitro || 0).toFixed(2),
    nitroHeat: +(s.nitroHeat || 0).toFixed(2),
    nitroOn: !!s.nitroOn,
    aground: !!s.aground,
    // Same reading as the model: absent means running.
    running: s.running !== false,
    cranking: (s.crank || 0) > 0,
    x: +s.x.toFixed(3), y: +s.y.toFixed(3),
    topSpeed: p.topSpeed,
  };
}

// ── THE IGNITION ─────────────────────────────────────────────────────────────
//
// ⚠ Absent `running` means running: existing callers never set it. Always read `s.running !== false`.
// A dead engine cuts the drive only; the hull keeps its way, rides the sea and steers while water passes.
export const CRANK_S = 0.85;            // how long the starter turns her over before she catches
export const CRANK_RPM = 0.07;          // what the tacho shows while it is cranking: under idle

function ignitionStep(s, input, dt) {
  // The caller owns `s.running` (panel K, `conn start`); the starter is a held input.
  if (s.running === false) {
    // Dry: turns over forever and never fires. `fuel` comes from the caller.
    const dry = input.fuel != null && input.fuel <= 0;
    if (input.starter && !dry) {
      s.crank = (s.crank || 0) + dt;
      if (s.crank >= CRANK_S) { s.running = true; s.crank = 0; s.events.push('started'); }
    } else {
      if (input.starter && dry && !s.wasDry) { s.events.push('dry'); s.wasDry = true; }
      s.crank = 0;
    }
    if (!input.starter) s.wasDry = false;
    return false;
  }
  s.crank = 0; s.wasDry = false;
  return true;
}

export function stepBoat(s, input, p, dt) {
  s.events = [];
  s.hullHit = 0;
  const steer = clamp(input.steer || 0, -1, 1);
  const running = ignitionStep(s, input, dt);
  const lever = running ? clamp(input.throttle || 0, 0, 1) : 0;
  const surf = WATER[input.surface] || WATER.open;
  const tPrev = s.clock;
  s.clock = input.now != null ? input.now * 0.001 : (s.clock || 0) + dt;
  const t = s.clock;

  // ── 0. AGROUND ─────────────────────────────────────────────────────────────
  // Hard law: way is scrubbed off and the hull pays once per grounding.
  const aground = !!input.aground || input.surface === 'land';
  if (aground && !s.aground) {
    const bite = Math.min(1, Math.abs(s.speed) / Math.max(1, p.topSpeed));
    s.hullHit += HULL_LAND * bite;
    s.events.push('aground');
  }
  s.aground = aground;

  // ── 1. THE BLOWER FOLLOWS THE LEVER ────────────────────────────────────────
  // Spools up slower than it dumps.
  const rate = lever > s.pedal ? 2.6 : 6.0;
  s.pedal = clamp(s.pedal + (lever - s.pedal) * Math.min(1, rate * dt), 0, 1);

  // ── 2. THE BOTTLE ──────────────────────────────────────────────────────────
  // No new resource: overheating the bottle costs hull.
  const want = running && !!input.nitro && s.nitro > 0 && !aground && s.pedal > 0.35;
  s.nitroOn = want;
  if (want) {
    s.nitro = Math.max(0, s.nitro - (p.nitroBurn ?? 0.22) * dt);
    s.nitroHeat = Math.min(1.4, s.nitroHeat + 0.30 * dt);
    if (s.nitroHeat > NITRO_HEAT_HURT) {
      s.hullHit += (s.nitroHeat - NITRO_HEAT_HURT) * 0.055 * dt;
      if (!s.wasCooking) { s.events.push('nitroheat'); s.wasCooking = true; }
    }
  } else {
    s.nitro = Math.min(1, s.nitro + (p.nitroCool ?? 0.11) * dt * 0.45);
    s.nitroHeat = Math.max(0, s.nitroHeat - (p.nitroCool ?? 0.11) * dt);
    if (s.nitroHeat < NITRO_HEAT_HURT * 0.7) s.wasCooking = false;
  }
  const boost = want ? (p.nitroMul ?? 1.55) : 1;

  // ── 3. THE SEA ─────────────────────────────────────────────────────────────
  const pose = boatSeaPose(s, p, t);
  s.prevHeave = s.heave;
  s.heave = pose.heave;
  // Height rides the drawn chop; the launch doesn't (step 6), or chop faces would make most jumps.
  const chop0 = s.chopH || 0;
  s.chopH = hullChopAt(s, t);
  const surfZ = pose.heave + s.chopH;
  // ⚠ The sea runs on the wall clock, the hull on capped dt. A clock jump (hitch, hidden tab) is a new
  // sea under her: keep her height above it and restart the rates, or she launches and slams.
  if (tPrev !== undefined && dt > 0 && Math.abs((t - tPrev) - dt) > SEA_JUMP_S) {
    if (s.alt !== undefined) s.alt += surfZ - ((s.prevHeave ?? pose.heave) + chop0);
    s.prevHeave = pose.heave;
    s.rideUp = undefined;
    s.seaPitch0 = undefined;
  }

  // ── 4. LONGITUDINAL ────────────────────────────────────────────────────────
  // Thrust only reaches the water while the drive is in it.
  // race rather than win it.
  const wet = s.airborne ? 0 : 1;
  const drive = p.thrustMax * s.pedal * boost * surf.drive * wet;
  const v = Math.abs(s.speed);

  // ── 3b. THE TABS ───────────────────────────────────────────────────────────
  //
  // Trim tabs set attitude, not power. Down (-1): more wetted hull, more drag, easier over the hump,
  // more grip. Up (+1): faster, worse hump, flies off faces. ⚠ Every term is `1 + k * trim`, so
  // trim 0 is exactly neutral.
  const trim = clamp(input.trim || 0, -1, 1);
  const TRIM_DRAG = 0.16;      // bow up sheds parasitic drag: the top-speed half
  const TRIM_HUMP = 0.30;      // …and makes the hump worse, which is the price out of the hole
  const TRIM_GRIP = 0.22;      // bow down puts the forefoot in: authority and less slide
  const TRIM_FLY  = 0.45;      // …and bow up is what actually throws her off a face
  s.trim = trim;

  // The hump: bow-wave drag below planing speed, as a smooth shoulder.
  const humpAt = p.hump ?? 48;
  const over = clamp((v - humpAt * 0.55) / (humpAt * 0.75), 0, 1);
  s.planing = over > 0.92;
  // ⚠ A bump, zero at rest and once planing, peaking near 0.72 of hump speed. Max drag at rest stops
  // the boat leaving the dock.
  const hx = clamp(v / humpAt, 0, 1.6) - 0.72;
  const hump = (p.humpDrag ?? 5.4) * (1 + TRIM_HUMP * trim) * Math.max(0, 1 - (hx / 0.72) * (hx / 0.72));
  const fric = (p.waterFric ?? 2.2) * surf.drag * wet;
  const aero = p.dragP * (1 - TRIM_DRAG * trim) * s.speed * s.speed;
  const moving = Math.sign(s.speed) || (drive > 0 ? 1 : 0);
  // Aground: a very large drag.
  const scrub = aground ? 26 : 0;
  s.speed += ((drive - (fric + hump * wet + scrub) * moving) / Math.max(0.2, p.mass) - aero * moving / Math.max(0.2, p.mass)) * dt;
  if (drive === 0 && Math.abs(s.speed) < 0.05) s.speed = 0;
  // Boosted cap sits just above nitro terminal, sqrt(thrustMax × nitroMul / dragP), so it stays a backstop.
  s.speed = clamp(s.speed, 0, p.topSpeed * surf.cap * (want ? 1.19 : 1));
  // The tacho reads CRANK_RPM while the starter turns; shift lights and engine note follow it.
  s.rpm = running
    ? IDLE + (1 - IDLE) * clamp(s.pedal * 0.55 + (v / Math.max(1, p.topSpeed)) * 0.45, 0, 1)
    : ((s.crank || 0) > 0 ? CRANK_RPM : 0);

  // ── 4b. HOW FAR OUT OF STEP THE MOTOR IS WITH THE LEVER ────────────────────
  //
  // From the blower's asymmetric lag: `rich` (lever ahead of blower: header flame) and `bang` (blower
  // ahead of lever, at revs: backfire). Derived here because this is the only place with a dt, and
  // kept in state because the wire carries them to other players.
  s.rich = clamp((lever - s.pedal) * 2.6, 0, 1);
  s.bang = clamp((s.pedal - lever) * 1.7, 0, 1) * clamp((s.rpm - IDLE) / (1 - IDLE || 1), 0, 1);

  const tps = s.speed / (p.tileMph || 95);        // tiles per second: the sim's real velocity

  // ── 5. STEERING, AND WHY IT IS BAD ─────────────────────────────────────────
  // Rudder authority falls with speed, and way doesn't follow the bow: `drift` is a real lateral
  // velocity decaying over `driftTau`.
  const fade = 1 / (1 + (p.turnFade ?? 0.72) * (v / Math.max(1, humpAt)));
  const lock = (p.turnLock ?? 34) * fade * surf.grip * (1 - TRIM_GRIP * trim);
  // ⚠ A rudder needs water going past it: none when stopped, airborne or aground.
  const auth = (s.airborne || aground) ? 0 : clamp(v / 6, 0, 1);
  const yaw = steer * lock * auth;
  s.heading = wrap360(s.heading + yaw * dt);
  s.yawRate = yaw;

  // Swinging the bow puts way on the beam (the slide). ⚠ It's a rate, so times dt.
  s.drift += (-yaw * D2R) * tps * dt;
  s.drift *= Math.exp(-dt / Math.max(0.05, p.driftTau ?? 1.35));
  // Beaching: scrub way fast enough that she runs a hull-length up the shore.
  if (aground) {
    s.speed *= Math.exp(-dt * 3.5);
    s.drift *= Math.exp(-dt * 8);
    if (s.speed < 0.4) { s.speed = 0; s.drift = 0; }
    if (s.speed === 0 && !s.beached) { s.beached = true; s.events.push('beached'); }
  } else s.beached = false;
  s.slip = clamp(Math.abs(s.drift) / Math.max(0.02, Math.abs(tps) + 0.02), 0, 1);
  if (s.slip > 0.5 && !s.wasSliding) { s.events.push('slide'); s.wasSliding = true; }
  else if (s.slip < 0.28) s.wasSliding = false;

  // ── 6. AIR ─────────────────────────────────────────────────────────────────
  // She leaves at the lip: riding a face her vs is the water's (`surfUp`); when the water falls away
  // faster than LIP_G she keeps her upward speed and flies. A jump is a place on the wave you aim at.
  const GRAV = 1.35;                                 // tiles/s², tuned for a readable hang
  const surfUp = dt > 0 && s.prevHeave !== undefined ? (pose.heave - s.prevHeave) / dt : 0;
  if (!s.airborne) {
    // The chop adds only a share (LIP_CHOP), or it would be nearly every jump.
    let chopUp = 0;
    if (s.seaChop > 0 && tps > 0.45) {
      const hh = (s.heading || 0) * D2R, fx = Math.sin(hh), fy = -Math.cos(hh), e = 0.08;
      const u0 = s.x + (s.ssx || 0), v0 = s.y + (s.ssy || 0);
      const g = (seaChop(u0 + fx * e, v0 + fy * e, t) - seaChop(u0 - fx * e, v0 - fy * e, t)) / (2 * e) * s.seaChop;
      chopUp = Math.max(0, g) * tps * LIP_CHOP;
    }
    // Her upward speed: the face's a frame ago (she has mass) plus the chop's share.
    const hullUp = (s.rideUp ?? surfUp) + chopUp;
    const accel = dt > 0 ? (surfUp - (s.rideUp ?? surfUp)) / dt : 0;
    const bonus = (p.launchVs ?? 0.55) / 0.9 * (1 + (want ? 0.35 : 0)) * (1 + TRIM_FLY * trim);
    if (tps > 0.45 && hullUp > LIP_MIN_UP && accel < -LIP_G / bonus) {
      // Flown in world height (`alt`); see below.
      s.airborne = true; s.vs = hullUp * LIP_THROW * bonus; s.z = 0.0001; s.alt = surfZ + s.z;
      s.events.push('launch');
    }
  }
  s.rideUp = s.airborne ? undefined : surfUp;
  if (s.airborne) {
    // The hang: gravity eases over the top of the arc; the landing comes in at full rate.
    const apex = clamp(Math.abs(s.vs) / 0.35, 0, 1);
    s.vs -= GRAV * (0.5 + 0.5 * apex) * dt;
    if (s.alt === undefined) s.alt = surfZ + s.z;
    s.alt += s.vs * dt;
    // ⚠ World height first, then height above water, so she flies over a trough instead of tracing it.
    s.z = s.alt - surfZ;
    if (s.z <= 0) {
      // The hit is the closing speed against the water, not the fall alone.
      const surfVs = dt > 0 ? (pose.heave - (s.prevHeave ?? pose.heave)) / dt : 0;
      const impact = Math.abs(s.vs - surfVs);
      s.airborne = false; s.z = 0; s.vs = 0; s.alt = undefined;
      s.fromAir = true;        // the ride spring restarts from the air attitude, not the lip's rate
      s.landImpact = impact;   // for the seat's landing thump
      // Beam-on landings break boats: the sea's roll multiplies the slam.
      const beam = Math.min(1, Math.abs(pose.roll) * 2.2);
      const over2 = Math.max(0, impact - HULL_FREE_VS);
      if (over2 > 0) {
        s.hullHit += Math.min(HULL_SLAM_MAX, over2 * over2 * HULL_SLAM * (1 + beam));
        s.events.push(over2 > 0.18 ? 'slam' : 'land');
      } else s.events.push('land');
      // A hard landing scrubs way.
      s.speed *= clamp(1 - over2 * 0.22, 0.45, 1);
    }
  }

  // ── 7. TAKING A SEA BADLY ──────────────────────────────────────────────────
  // Slow bleed for running fast while held over by a steep face.
  if (!s.airborne && !aground) {
    const lean = clamp((Math.abs(pose.roll) - HULL_BEAM_FROM) / (HULL_BEAM_FULL - HULL_BEAM_FROM), 0, 1);
    const fast = clamp((v - humpAt) / Math.max(1, p.topSpeed - humpAt), 0, 1);
    if (lean > 0 && fast > 0.25) s.hullHit += HULL_BEAM * lean * fast * dt;
  }

  // ── 8. POSITION ────────────────────────────────────────────────────────────
  // Forward plus the slide on the beam, in boatSeaPose's basis.
  const h = s.heading * D2R, shh = Math.sin(h), chh = Math.cos(h);
  s.x += (shh * tps + chh * s.drift) * dt;
  s.y += (-chh * tps + shh * s.drift) * dt;

  // ── 9. THE HULL ────────────────────────────────────────────────────────────
  // ⚠ The model accrues damage and reports 'holed'; the plugin decides what zero hull means.
  if (s.hullHit > 0) {
    s.hull = clamp((s.hull ?? 1) - s.hullHit, 0, 1);
    if (s.hull <= 0 && !s.wasHoled) { s.events.push('holed'); s.wasHoled = true; }
  }
  // How fast the water under her tilts bow-up: the ride spring's lead into a face.
  const seaTiltUp = dt > 0 && s.seaPitch0 !== undefined ? Math.max(0, (pose.pitch - s.seaPitch0) / dt) : 0;
  s.seaPitch0 = pose.pitch;
  // Aground: settles on her keel with a slight list.
  if (aground) { s.pitch = 0.04; s.roll = 0.06; s.heave = 0; s.chopH = 0; }
  // Airborne the nose follows the flight path, more up than down, eased: she flies bow-high and lands flat.
  else if (s.airborne) {
    const path = Math.atan2(s.vs, Math.max(0.3, tps));
    const aim = clamp(path * (path > 0 ? AIR_UP : AIR_DOWN), -0.2, 0.6);
    s.pitch += (aim - s.pitch) * (1 - Math.exp(-dt / AIR_TAU));
    s.roll = pose.roll * 0.5;
  } else {
    // The chop in the attitude, low-passed (~0.12 s). Only the seat hands `seaChop` over.
    let cp = 0, cr = 0;
    if (s.seaChop > 0) {
      const hh = (s.heading || 0) * D2R, fx = Math.sin(hh), fy = -Math.cos(hh), e = 0.08;
      const u0 = s.x + (s.ssx || 0), v0 = s.y + (s.ssy || 0);
      const gF = (seaChop(u0 + fx * e, v0 + fy * e, t) - seaChop(u0 - fx * e, v0 - fy * e, t)) / (2 * e) * s.seaChop;
      const gR = (seaChop(u0 - fy * e, v0 + fx * e, t) - seaChop(u0 + fy * e, v0 - fx * e, t)) / (2 * e) * s.seaChop;
      const spd = clamp(Math.abs(tps) / 2, 0, 1);
      cp = Math.atan(gF) * (0.4 + 0.6 * spd); cr = Math.atan(gR) * 0.5;
    }
    const kf = 1 - Math.exp(-dt / 0.12);
    s.chopPitch = (s.chopPitch || 0) + (cp - (s.chopPitch || 0)) * kf;
    s.chopRoll = (s.chopRoll || 0) + (cr - (s.chopRoll || 0)) * kf;
    // `stab`: share of the sea's pitch and roll the hull answers to (absent 1). ⚠ Attitude only, never
    // the swell amplitude, or she sits inside the crests and rarely launches.
    const sk = s.stab ?? 1;
    // Under way she climbs a face bow-high, leading the water's tilt by CLIMB_LEAD, or the lagging
    // spring sits her bow in the face. Bow-up only, with way on.
    const way = clamp((Math.abs(tps) - 0.3) / (CLIMB_TPS - 0.3), 0, 1);
    const climb = way * (Math.max(0, pose.pitch) * (CLIMB_LIFT + 1 - sk) + Math.min(0.25, seaTiltUp * CLIMB_LEAD));
    // Sprung, not traced, or every ripple twitches the bow.
    const tp0 = (pose.pitch + s.chopPitch * RIDE_CHOP) * sk;
    const tp = tp0 + Math.min(climb, Math.max(0, CLIMB_MAX - tp0));
    const tr = (pose.roll + s.chopRoll * RIDE_CHOP) * sk;
    if (s.pitchV === undefined || s.fromAir) { s.pitchV = 0; s.rollV = 0; s.fromAir = false; }
    const h = Math.min(dt, 0.05);
    s.pitchV += (RIDE_W * RIDE_W * (tp - s.pitch) - 2 * RIDE_Z * RIDE_W * s.pitchV) * h; s.pitch += s.pitchV * h;
    s.rollV += (RIDE_W * RIDE_W * (tr - s.roll) - 2 * RIDE_Z * RIDE_W * s.rollV) * h; s.roll += s.rollV * h;
  }
  return s;
}

export function step(state, input, p, dt) {
  if (p.ground) return stepTruck(state, input, p, dt);
  if (p.water) return stepBoat(state, input, p, dt);
  if (p.heli) return stepHeli(state, input, p, dt);
  const s = state;
  s.events = [];
  // Trim biases the yoke's neutral point, so a centred yoke holds the trimmed attitude.
  const elevator = clamp((input.elevator || 0) + (input.trim || 0), -1, 1);
  const aileron = clamp(input.aileron || 0, -1, 1);
  const throttle = clamp(input.throttle || 0, 0, 1);
  const flaps = clamp(input.flaps || 0, 0, 1);
  const pedal = clamp(input.pedal || 0, -1, 1);   // rudder: flat yaw airborne, nosewheel on the ground

  // Battle damage: input.dmgSurf = {leftWing, rightWing, tail, rudder}, 0 = gone. A missing wing rolls
  // and yaws her toward the dead side and sinks; tail/rudder loss costs pitch/yaw authority.
  const surf = input.dmgSurf || null;
  const lwGone = surf?.leftWing === 0, rwGone = surf?.rightWing === 0;
  const tailGone = surf?.tail === 0, rudderGone = surf?.rudder === 0;
  const bothWings = lwGone && rwGone;
  const wingDead = bothWings ? 0 : (lwGone ? -1 : (rwGone ? 1 : 0));   // sign toward the missing wing (0 = none/both)
  const oneWing = wingDead !== 0;
  const WING_ROLL = 34, WING_YAW = 26;   // deg/s toward the dead wing; fightable with full opposite aileron

  // 1. Engine inertia.
  s.rpm += (throttle - s.rpm) * Math.min(1, dt / p.engineLag);
  // `noThrust` (Leviathan visor lock) cuts thrust force only; the engines still spool and sound.
  const thrust = (input.noThrust ? 0 : s.rpm) * p.thrustMax;

  // 2. Control authority grows with airspeed; mushy below Vr.
  const auth = clamp(s.airspeed / p.vr, 0, 1.2);

  // 3. Pitch: the yoke's effect builds over pitchTau, fades toward the limits, self-levels when released.
  s.elevEff += (elevator - s.elevEff) * Math.min(1, dt / p.pitchTau);
  if (s.onGround && p.groundPitch) {
    // Taildragger on the ground: rests at groundPitch; forward stick with airflow raises the tail.
    const tailAuth = clamp(s.airspeed / p.vr, 0, 1);
    const push = clamp(-s.elevEff, 0, 1);                                     // forward yoke lifts the tail
    const target = p.groundPitch - push * tailAuth * (p.groundPitch + 4);     // full forward + rolling → tail up (~−4°)
    s.pitch += (target - s.pitch) * Math.min(1, dt * 3.5);
    s.pitch = clamp(s.pitch, -4, p.groundPitch);
  } else {
    const pitchResist = 1 - 0.55 * Math.abs(s.pitch) / 48;
    const pitchCmd = s.elevEff * p.pitchRate * auth * pitchResist * (tailGone ? 0.35 : 1);   // sheared tailplane → mushy elevator
    s.pitch += (pitchCmd - p.pitchStable * s.pitch * (1 - Math.abs(s.elevEff))) * dt;
    // Low-energy nose drop (static stability): as α climbs past aoaGlide, the nose is pulled toward
    // the trim α, so a power-off glide settles near best glide instead of mushing on the back side.
    // Cruise, dives and commanded attitudes are untouched.
    const aoaGlide = tuning(p).aoaGlide;
    const droopIn = clamp((s.aoa - aoaGlide) / Math.max(1, p.aoaCrit - aoaGlide), 0, 1);
    if (droopIn > 0 && !s.onGround) {
      const gammaNow = Math.atan2(s.vs / 101.33, Math.max(1, s.airspeed)) * R2D;
      const target = gammaNow + aoaGlide;    // toward the trim α, never zero α
      s.pitch += (target - s.pitch) * droopIn * (p.pitchStable ?? 1) * 1.6 * (1 - Math.abs(s.elevEff)) * dt;
    }
    if (tailGone && !s.onGround) s.pitch -= 16 * dt;   // lost tail downforce → the nose tucks under
    // Gear-limited rotation (15°) on the ground, or a held pull drives AoA drag up and pins her short
    // of flying speed.
    s.pitch = clamp(s.pitch, s.onGround ? -5 : -48, s.onGround ? 15 : 48);
  }

  // 4. Bank: builds over rollTau, resists toward full bank; wings held level on the ground.
  if (s.onGround) {
    s.bank += (0 - s.bank) * Math.min(1, dt * 4);
    s.rollEff += (0 - s.rollEff) * Math.min(1, dt / p.rollTau);
  } else {
    s.rollEff += (aileron - s.rollEff) * Math.min(1, dt / p.rollTau);
    const rollResist = 1 - 0.4 * Math.abs(s.bank) / 70;
    // A stalled wing barely answers aileron, and aileron drives the dropping wing deeper (§6c).
    const rollCmd = s.rollEff * p.rollRate * auth * rollResist * (1 - 0.75 * s.stallDepth);
    s.bank += (rollCmd - p.rollStable * s.bank * (1 - Math.abs(s.rollEff))) * dt;
    if (oneWing) s.bank += wingDead * WING_ROLL * dt;
    s.bank = clamp(s.bank, oneWing ? -85 : -70, oneWing ? 85 : 70);
  }

  // 5. Heading: coordinated turn from bank plus direct rudder yaw, authority growing with airspeed.
  const rudderYaw = p.rudderYaw ?? clamp(15 / Math.sqrt(p.mass || 1), 4, 18);   // deg/s at full rudder, mass-scaled
  if (s.airspeed > 1 && !s.onGround) {
    const turnRate = (G_KT * Math.tan(s.bank * D2R)) / Math.max(p.vs0, s.airspeed) * R2D;
    let yaw = turnRate + pedal * rudderYaw * auth * (rudderGone ? 0 : 1);
    if (oneWing) yaw += wingDead * WING_YAW;
    s.heading = wrap360(s.heading + yaw * dt);
  } else if (s.onGround && s.airspeed > 0.3) {
    // Nosewheel steering: aileron or pedals (mobile has no pedals), fading toward Vr.
    const steerAuth = clamp(s.airspeed / 5, 0, 1) * clamp((p.vr - s.airspeed) / p.vr, 0, 1);
    const steer = clamp(aileron + pedal, -1, 1);
    s.heading = wrap360(s.heading + steer * (p.groundSteer || 0) * steerAuth * dt);
  }

  // 5b. Forward slip: bank against opposite rudder, full by ~22° with full rudder, eased over 0.5 s.
  // Its drag and lift spill (§7/§8) sink her without gaining speed.
  const slipCross = (!rudderGone && !s.onGround && s.bank * pedal < 0)
    ? clamp(Math.min(Math.abs(s.bank) / 22, 1) * Math.abs(pedal), 0, 1) : 0;
  s.slip += (slipCross - s.slip) * Math.min(1, dt / 0.5);

  // 6. Angle of attack: α = pitch − γ, the one number for lift, drag, stall, buffet and g. γ lags the
  //    nose by vsTau, so a fast pull spikes α (an accelerated stall). 1 kt = 101.33 ft/min.
  const flapLiftF = 1 + flaps * p.flapLift;                       // flaps: less AoA to stay up
  const wingLiftMult = bothWings ? 0.15 : (oneWing ? 0.55 : 1);   // sheared wing loses lift
  const gamma = Math.atan2(s.vs / 101.33, Math.max(1, s.airspeed)) * R2D;
  s.aoa = clamp(s.pitch - gamma, -25, 60);

  // 6a. Load factor: the bank's demand (clNeed/clLevel = 1/cos φ) plus any α pulled above trim.
  //     Not raw lift/weight, which reads ~2g in fast cruise because trim α floors at 0.
  const T = tuning(p), weight = T.weight;
  const dynBank = 0.5 * s.airspeed * s.airspeed * p.liftScale * Math.cos(s.bank * D2R) * wingLiftMult;   // vertical dynamic-pressure budget
  const clNeed = weight / Math.max(20, dynBank);             // CL needed for 1g in this bank
  const clLevel = weight / Math.max(20, 0.5 * s.airspeed * s.airspeed * p.liftScale * wingLiftMult);   // wings-level 1g reference
  const aoaTrim = clamp((clNeed / flapLiftF - CL0) / CL_ALPHA, 0, p.aoaCrit);
  const clNow = clOf(p, s.aoa, flapLiftF, s.stalled);
  s.g = (clNeed + Math.max(0, clNow - clOf(p, aoaTrim, flapLiftF, false))) / Math.max(0.05, clLevel);
  const gLimit = p.gLimit ?? G_LIMIT_DEFAULT;
  if (s.g > gLimit && !s.onGround) { if (!s.overG) { s.events.push({ type: 'overg', g: s.g }); s.overG = true; } }
  else if (s.g < gLimit * 0.9) s.overG = false;

  // 6b. The stall: α past aoaCrit for STALL_ARM; reattach REATTACH below it.
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
    // Which wing drops: follow bank or aileron, else the left.
    s.stallDir = Math.abs(s.bank) > 1 ? Math.sign(s.bank) : (aileron !== 0 ? Math.sign(aileron) : -1);
  }

  // 6c. Post-stall departure. The sink comes from the CL collapse in §7; authored here are the nose
  //     drop and autorotation. Opposite rudder recovers (it gains authority with depth); aileron deepens it.
  if (s.stalled) {
    const held = clamp(s.elevEff, 0, 1);
    const depth = s.stallDepth;
    s.pitch -= (10 + 26 * (1 - held)) * depth * dt;                   // let go and she noses over into recovery
    s.bank += s.stallDir * STALL_ROLL * depth * (0.18 + 0.82 * held) * dt;
    if (aileron * s.stallDir < 0) s.bank += s.stallDir * 11 * depth * Math.abs(aileron) * dt;
    // Anti-spin pedal scales with depth, or a heavy's lazy rudder could never stop a departure.
    let spin = s.stallDir * SPIN_YAW * depth * held;
    if (!rudderGone) spin += pedal * (rudderYaw * 1.2 + SPIN_YAW * 0.75 * depth);
    s.heading = wrap360(s.heading + spin * dt);
    s.pitch = clamp(s.pitch, -60, 48);
    s.bank = clamp(s.bank, -85, 85);
  }

  // 7. Flight-path energy model: γ_target = pitch − α_trim. Fast, she goes where she's pointed; slow
  //    or banked, the path droops below the nose. Energy trades between height and speed (§8).
  let gammaCmd = s.pitch - aoaTrim;
  // Lift deficit droops the path, unbounded; clMaxNow carries the stall collapse, so a stall's sink is this term.
  const clMaxNow = (CL0 + CL_ALPHA * p.aoaCrit) * flapLiftF
    * (s.stalled ? 1 - CL_COLLAPSE * clamp((s.aoa - p.aoaCrit) / POST_STALL_BAND, 0, 1) : 1);
  if (clNeed > clMaxNow) gammaCmd -= MUSH_DEG * clamp(clNeed / clMaxNow - 1, 0, 2.5);
  let vsTarget = s.airspeed * 101.33 * Math.sin(Math.max(-85, gammaCmd) * D2R);
  vsTarget -= s.slip * SLIP_SINK * s.airspeed;   // forward slip sink (§5b)
  // Service ceiling fades climb only; a zoom can still trade speed for height.
  const ceil = p.ceiling || 20000;
  if (vsTarget > 0) vsTarget *= clamp((ceil - s.altitude) / (ceil * 0.4), 0, 1);
  // Rising air (thermals.js), after the ceiling fade and not scaled by mass.
  if (!s.onGround && input.lift) vsTarget += input.lift;
  // Ground effect: the band scales with mass (a wingspan), and inside it the vertical lag shortens so
  // the sink actually comes off before touchdown.
  const geBand = GROUND_EFFECT_FT * (0.7 + 0.3 * (p.mass || 1));
  let geLift = 0;
  if (!s.onGround && vsTarget < 0 && s.altitude < geBand) {
    geLift = 1 - s.altitude / geBand;      // 0 at the top of the band → 1 on the deck
    vsTarget *= 1 - 0.6 * geLift * geLift; // softens the sink without cancelling it
  }
  if (s.onGround && vsTarget <= 0) {
    s.vs = 0;                                 // on the wheels
  } else {
    const tau = p.vsTau * (1 - 0.6 * geLift);   // the cushion acts now, not after the vertical lag
    s.vs += (vsTarget - s.vs) * Math.min(1, dt / tau);
    s.altitude += (s.vs / 60) * dt;
  }

  // 8. Airspeed: thrust − drag − gravity along the path − ground friction. A nose-down attitude sheds
  //    some parasitic drag (diveShed), full by ~11° down and gone when level.
  const diveClean = s.pitch < 0 ? clamp(-s.pitch / 11, 0, 1) : 0;
  const diveShed = p.diveShed ?? DIVE_SHED;
  // Retractable gear drag, a fraction (gearDragFrac, default 0.35) of dragP. `input.gear` is 0 up..1 down;
  // fixed-gear craft pass 0 (their drag is already in dragP).
  const gearExt = clamp(input.gear || 0, 0, 1);
  const drag = (p.dragP + flaps * p.flapDrag * 0.0022) * s.airspeed * s.airspeed * (1 - diveShed * diveClean)  // parasitic ∝ V², less the dive shed; flap drag sized to bleed speed on final
             + gearExt * (p.gearDragFrac ?? 0.35) * p.dragP * s.airspeed * s.airspeed                     // gear down
             + T.kInd * clNow * clNow * s.airspeed * s.airspeed                  // induced drag, CDi = kInd·CL² (see tuning())
             + s.slip * (p.slipDrag ?? SLIP_DRAG) * s.airspeed * s.airspeed      // forward slip (§5b)
             + s.stallDepth * 0.9 * p.dragP * s.airspeed * s.airspeed;           // separated flow drag in a stall
  // Gravity acts along the flight path γ (after §7's update), not the nose, which closes the energy
  // loop: a mushing descent builds speed back, so a shallow glide settles instead of stalling.
  const grav = G_KT * Math.sin(Math.atan2(s.vs / 101.33, Math.max(1, s.airspeed)));
  // Ground friction plus wheel brakes on forward yoke (opposite to the rotate gesture). Not on a
  // taildragger, where forward stick raises the tail.
  const brake = (s.onGround && !p.groundPitch) ? clamp(-elevator, 0, 1) * (p.brake || 0) : 0;
  const fric = s.onGround ? p.rollFric * (1 - s.rpm) + brake : 0;
  s.airspeed = Math.max(0, s.airspeed + ((thrust - drag) / p.mass - grav - fric) * dt);
  s.groundSpeed = s.airspeed;

  // 9. Ground contact. Liftoff is emergent; a hard arrival is flagged by sink rate.
  const floor = s.groundFt || 0;
  if (s.altitude <= floor) {
    // Arrival severity scales with mass.
    const firmVs = -300 * (0.8 + 0.2 * (p.mass || 1)), hardVs = -700 * (0.8 + 0.2 * (p.mass || 1));
    if (!s.onGround && s.vs < firmVs) s.events.push({ type: 'touchdown', severity: s.vs < hardVs ? 'hard' : 'firm', vs: s.vs });
    s.altitude = floor;
    s.onGround = true;
    s.vs = Math.max(0, s.vs);
  } else {
    s.onGround = false;
  }

  return s;
}

// Read-out for the harness and HUD.
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
