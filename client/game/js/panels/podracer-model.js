// PODRACER MODEL: two turbines on a binder, towing a cockpit pod on two cables.
//
// Pure in the same sense as flight-model.js: no DOM, no network, no plugin state. The seat steps it
// at frame rate, the text rung and the regress suite step it headless.
//
// It lives beside flight-model.js rather than in its TYPES table because half a dozen loops walk
// TYPES assuming every row is an aircraft, a truck or a boat (best-glide derivation, the flight and
// trucking regress loops, the tuning scripts). A racer is none of those.
//
// THE BODIES. Three rigid bodies in the plane:
//   eng[0..1]   the left and right turbine
//   pod         the cockpit, towed
// The binder between the turbines is a stiff spring, not a bar: two links, nose to nose and tail to
// tail, solved like the cables but both ways and with a little give. So the pair flexes and shimmies
// under a hard turn or a knock and settles back, the way the films' energy binder does, and a hit
// hard enough tears it out and leaves two turbines on their own. The turbines also collide with each
// other, as three circles down each one's length, so a torn-out pair cannot pass through itself.
// Each cable joins the back of one turbine to one side of the pod's nose. A cable only pulls: it is
// a one-sided distance constraint, solved by position (XPBD) in fixed sub-steps, so it is stiff
// without going unstable and its force falls out of the solve. That force is what snaps it.
//
// Steering is the two levers. More thrust on the left turbine turns the pair right, the way a real
// twin-engine craft yaws. The pod is never steered; it follows on its cables, swings wide in a
// corner and runs up on the turbines when they brake.
//
// Units: positions in tiles, velocities in tiles/s internally, speeds reported in mph. Headings in
// degrees on the state for callers, radians inside the solve. The frame is the boat's: heading 0 is
// north (-y), forward is (sin h, -cos h) and right is (cos h, sin h).

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const SUB_DT = 1 / 240;     // the fixed sub-step
const MAX_SUBS = 24;               // 0.1 s per call at most; a hidden tab does not fast-forward the race
export const CRANK_S = 1.1;        // the starters turn both turbines over this long before they light
export const IDLE = 0.18;          // idle, as a fraction of full spool

// ── Types ──────────────────────────────────────────────────────────────────────
//
// Sizes are in tiles (a tile is about 42 m, the boat's scale). The craft is about 21 m nose to tail
// at full cable: 7.5 m turbines, 9 m of cable, a 3 m pod.
//
//   thrust     mph/s each turbine gives its own mass at full lever
//   dragE/P    aero drag as a deceleration per mph^2 on that body, solved so terminal is topSpeed:
//              2 * mE * thrust = (2 * mE * dragE + mP * dragP) * top^2
//   slideE/P   seconds for sideways way to die off. The pod slides more than the turbines, which is
//              what swings it wide in a corner; with the pod gripping as hard, it cut inside instead
//   yawTau     seconds for the turbines' spin to die off with the levers even
//   vaneE      how hard the turbines weathervane into their own airflow
//   turnRate   deg/s the split vanes turn the pair at full steer, low down; turnHi is the share of
//              it left at top speed. The vanes chase that rate (steerTau seconds to get there, no more
//              than steerMax rad/s^2) rather than pushing a torque, so a turn starts at once and holds:
//              a raw torque took half a second to bite and then spun the turbines round faster and
//              faster with nothing to stop it.
//   splitSteer how much a split between the two levers adds to the steer, so a player dragging the
//              levers apart still steers by thrust
//   redirect   the share of the sideways speed grip takes off that goes on along the nose instead
//              (redirectE the turbines, redirectP the pod). At none, a slide bled a third of the
//              speed and the slingshot could not give it back
//   slideMul   the power slide: the pod's slide time is this many times longer, so it hangs out, the
//              turbines' slideMulE times, and the vanes turn slideTurn times as fast. With the
//              turbines skating as freely as the pod, a slide turned less than a plain turn
//   boost      thrust multiplier with the boost lit. Each turbine heats at heatUp a second boosting and
//              cools at heatDown idling (twice that off the throttle); over 1 it burns, losing
//              turbine at burnHp a second until the boost comes off
//   swingDamp  seconds for the pod's sideways swing about the tow line to die away (swingSlide in a
//              slide). Without it the pod was a pendulum: it swung two or three times after every
//              turn and could wind itself right round in a slalom, and the seat swung with it
//   whip       the slingshot. Sliding with the pod hung out charges it, fully in whipCharge seconds
//              of a good slide (the more the pod hangs out, the faster); letting the slide go snaps
//              the pod back on its cables and the turbines take up to whipMax more thrust for up to
//              whipHold seconds, both in proportion to the charge. A slide is then worth taking
//   vaneMph    the airspeed the split vanes reach full authority at; below it they turn the pair
//              in proportion, down to vaneMin at a standstill. With full authority from rest, Q or a
//              lever split pivoted the turbines round in place at full rate and back over the pod
//   jackknife  degrees the turbines may swing off the line back to the pod before the vanes stop
//              turning them further out and the tow pulls them back (jackPull per second per radian)
//   revThrust  the thrust reversers (the air brake petals swung into the exhaust): mph/s backwards
//              each turbine gives at full reverse, and revMph the most way they will make astern
//   DOCKED and LAUNCHED. Docked (how it starts, and up to medium speeds), each turbine is pinned
//              alongside the pod at dockV ahead of its centre (two stiff links each, dockComp), the
//              cables reeled in and the binder idle: one compact craft, its thrust scaled by
//              dockThrust (about 150 mph flat out). Docking, the turbines fall back to their places
//              on their own (no faster than dockClose tiles a second closing, turning to the pod's
//              heading) and the pins lock when both are home; the pod is never pulled. Pins that
//              drew them in pulled the light pod forward instead, at 600 mph and more. dockTime is
//              the longest it may take before the pins simply lock Launched (F), the pins let go, the turbines are
//              kicked forward by launchKick and the cables pay out at payout tiles a second to full
//              length; the binder comes up. Docking again, the pins come back on over dockTime
//              seconds and draw the turbines back in alongside
//   binder*    the binder's power, launched: idle (binderIdle) under binderOnMph, full by
//              binderFullMph or binderFullG of the pair's own acceleration, up in binderUp seconds
//              and down in binderDown. Weak, it is a loose leash and each turbine's own vane steers it
//   cushion    the tether's floor, as a share of the cable: under it the cable pushes the pod back
//              like a strut (cushionComp compliance, cushionDamp seconds of damping). A bare rope let
//              the pod coast up into the turbines every time they slowed
//   vane       how hard the pod weathervanes into its own airflow
//   cable      length in tiles, compliance (stretch), damping in seconds, and the snap limit as the
//              pull on the pod in mph/s held for snapHold seconds. About 2300 is a yank at 110 mph of
//              closing speed; hard driving peaks under 100
//   cableU/V   where each cable leaves its turbine, from the pair's centreline: the inner face, a
//              little aft of centre. Off the
//              tail at full span, a pod swung wide pulled the tail out further and the craft spiralled
//   podAnchor  half the gap between the cables' ends on the pod's nose. Zero, one ring: with two
//              anchors the pod's own yaw lengthened one cable, and a straight run settled into a slow
//              turn on the other
//   binderMph  an impact this fast on a turbine tears the binder out
//   binderComp the binder's stretch (XPBD compliance), and binderDamp its damping in seconds: about
//              a tenth of the span in a hard slalom, and a knock shimmies at about seven a second and
//              is gone within one. At a fifth of this it read as a welded bar; at 2.5 times, a loose one
//   freeMph    impacts under this cost nothing
// What every racer shares; each type below says only how it differs. dragE is solved per type so
// its terminal speed is its topSpeed (see the line at the top), never typed in.
const RACER_BASE = {
  tileMph: 95, burn: 1, dragP: 0.0009, airBrake: 5, fricE: 1.4, fricP: 0.8,
  podAnchor: 0, slideE: 0.55, slideP: 1.5, yawTau: 0.25, vane: 9, vaneE: 15,
  turnHi: 0.6, steerTau: 0.12, steerMax: 40, splitSteer: 1.5,
  slideMul: 2, slideMulE: 1.25, slideTurn: 1.5, redirectE: 0.75, redirectP: 0.4,
  boost: 1.5, heatUp: 0.2, heatDown: 0.12, burnHp: 0.18,
  cushion: 0.7, cushionComp: 0.004, cushionDamp: 0.05,
  vaneMph: 80, vaneMin: 0.35, jackknife: 70, jackPull: 5,
  revThrust: 14, revMph: 14,
  dockV: 0.035, dockPin: 0.05, dockComp: 0.00006, dockThrust: 0.32, dockClose: 0.32, dockTime: 3, launchKick: 0.45, payout: 0.35, dockSpin: 2.2,
  binderIdle: 0.05, binderOnMph: 25, binderFullMph: 120, binderFullG: 1.5, binderUp: 0.15, binderDown: 0.8,
  swingDamp: 0.25, swingSlide: 1.2,
  whipMax: 0.4, whipCharge: 0.9, whipHold: 1.1,
  cableComp: 0.0004, cableDamp: 0.02, snapHold: 0.012,
  freeMph: 22, binderComp: 0.006, binderDamp: 0.2,
};
const racer = (row) => {
  const p = { ...RACER_BASE, ...row };
  p.dragE = (2 * p.mE * p.thrust / (p.topSpeed * p.topSpeed) - p.mP * p.dragP) / (2 * p.mE);
  return p;
};
// Three racers off the Deadleg: a light one, the Twinspool, and a heavy one. Each is drawn from its
// own mesh (content/vehicle_models/mesh_podracer*.json, by type: the mesh's `variants`), sized to the
// numbers here, and has its own factory paint.
export const PODRACER_TYPES = {
  skitter: racer({
    name: 'Skitter Dart', price: 16000, tank: 140, burn: 0.8,
    topSpeed: 275, mE: 0.7, mP: 0.36, thrust: 60,
    halfSpan: 0.066, engHalfLen: 0.075, engR: 0.028,
    podHalfLen: 0.06, podHalfW: 0.026, podR: 0.04,
    yawTau: 0.2, turnRate: 96, steerTau: 0.1, steerMax: 46,
    cableU: 0.017, cableV: 0.042, cableLen: 0.19, snapMphS: 1900,
    binderMph: 80, freeMph: 20, binderComp: 0.008,
    factory: { base: '#2f8a3a', trim: '#f0eee4', finish: 'pearl' },
    blurb: 'Two small turbines off a crop sprayer and a pod you wear more than sit in. It turns on a coin and it will not stop telling you about it. A bad knock and the binder lets go.',
  }),
  podracer: racer({
    name: 'Rasp Twinspool', price: 31000, tank: 180,
    topSpeed: 310, mE: 1, mP: 0.45, thrust: 64,
    halfSpan: 0.08, engHalfLen: 0.09, engR: 0.035,
    podHalfLen: 0.07, podHalfW: 0.03, podR: 0.045,
    turnRate: 80,
    cableU: 0.02, cableV: 0.05, cableLen: 0.22, snapMphS: 2300,
    binderMph: 95,
    factory: { base: '#aa1a14', trim: '#eec84c', finish: 'candy' },
    blurb: 'Two airliner starter turbines off the Deadleg wreck field, a binder bar welded between them, and a bathtub on two cables. It does three hundred. It does not do slower than that with any enthusiasm.',
  }),
  sledge: racer({
    name: 'Sledgehammer Twin', price: 58000, tank: 240, burn: 1.4,
    topSpeed: 345, mE: 1.4, mP: 0.6, thrust: 50,
    halfSpan: 0.095, engHalfLen: 0.11, engR: 0.045,
    podHalfLen: 0.08, podHalfW: 0.034, podR: 0.05,
    yawTau: 0.3, turnRate: 62, steerMax: 32,
    cableU: 0.024, cableV: 0.06, cableLen: 0.25, snapMphS: 3200,
    binderMph: 120, binderComp: 0.005,
    factory: { base: '#1c1c20', trim: '#d4a020', finish: 'metallic' },
    blurb: 'Two cargo-lifter turbines the size of a shed each, armoured, on a binder you could hang a truck off. Slow off the line and slow to turn, and nothing on the waste catches it flat out.',
  }),
};

// ── The kit: what the yard can fit ─────────────────────────────────────────────
//
// A racer's kit is `custom_data.kit` on its row: only the slots changed from the factory's, so `{}`
// is a stock racer. Three kinds of slot:
//
//   tiers   the performance parts, 0 (stock) to 3. Each tier scales numbers on the type's row through
//           `fx(p, t)`, and podracerTuned re-solves the drag so the terminal speed is the new top
//           speed. Every part costs something somewhere: the turbine tune burns more and runs hotter,
//           the injectors heat faster, the fuel cell weighs. `cost` is the share of the type's price
//           each tier costs in all, so going from one tier to another costs the difference
//   choice  a part with no better or worse, only different: the pod shell (light and fragile, or
//           heavy and hard), the tether's length (a short one answers quicker, a long one whips harder)
//   look    the outside only. `ch` is the mesh channel the part's faces draw on (vehicle-mesh.js
//           `when`), `hide` the stock part's channel it replaces (`whenNot`); `rgb` is a colour the
//           renderer reads (the binder's arc, the exhaust plume, the turbine casing's paint slot)
//
// Shared by the server (the envelope, the yard's prices) and the client (the seat, the counter's
// figures), so the two never disagree about what a part does.
export const KIT_TIERS = ['Stock', 'Street', 'Race', 'Pro'];
const TIER_COST = [0, 0.05, 0.12, 0.22];
export const PODRACER_KIT = {
  engine: { kind: 'tiers', label: 'Turbine tune', cost: TIER_COST,
    blurb: 'Reground blades, a richer fuel map and the governor wired open. More thrust and more top end; it drinks and it runs hot.',
    fx: (p, t) => { p.thrust *= 1 + 0.06 * t; p.topSpeed *= 1 + 0.045 * t; p.burn *= 1 + 0.12 * t; p.heatUp *= 1 + 0.08 * t; } },
  boost: { kind: 'tiers', label: 'Injectors', cost: TIER_COST,
    blurb: 'Bigger jets in the afterburner can. The boost pulls harder and the turbines heat faster under it.',
    fx: (p, t) => { p.boost += 0.1 * t; p.heatUp *= 1 + 0.15 * t; } },
  cooling: { kind: 'tiers', label: 'Heat exchangers', cost: [0, 0.03, 0.07, 0.13],
    blurb: 'Coolant jackets round the hot section. Slower to heat, quicker to cool, and slower to burn once it is past the red.',
    fx: (p, t) => { p.heatUp *= 1 - 0.12 * t; p.heatDown *= 1 + 0.3 * t; p.burnHp *= 1 - 0.2 * t; } },
  vanes: { kind: 'tiers', label: 'Split vanes', cost: TIER_COST,
    blurb: 'Longer vanes on faster actuators. It turns harder low down, keeps more of the turn flat out, and bites with less air over it.',
    fx: (p, t) => { p.turnRate *= 1 + 0.08 * t; p.turnHi = Math.min(0.85, p.turnHi + 0.05 * t); p.steerMax *= 1 + 0.1 * t; p.vaneMph -= 8 * t; } },
  binder: { kind: 'tiers', label: 'Binder coil', cost: [0, 0.04, 0.1, 0.18],
    blurb: 'A hotter coil in the emitters. The binder comes up sooner, flexes less and takes a harder knock before it tears out.',
    fx: (p, t) => { p.binderMph += 10 * t; p.binderComp *= 1 - 0.12 * t; p.binderFullMph -= 15 * t; } },
  cables: { kind: 'tiers', label: 'Cable rope', cost: [0, 0.02, 0.05, 0.09],
    blurb: 'Heavier wire rope, swaged ends. It takes a harder yank before it snaps, and stretches less.',
    fx: (p, t) => { p.snapMphS *= 1 + 0.15 * t; p.cableComp *= 1 - 0.15 * t; } },
  brakes: { kind: 'tiers', label: 'Air brakes', cost: [0, 0.02, 0.05, 0.09],
    blurb: 'Bigger petals on the turbines and the pod. It stops shorter, and the reversers back it up a little faster.',
    fx: (p, t) => { p.airBrake *= 1 + 0.25 * t; p.revMph += 3 * t; p.revThrust += 3 * t; } },
  tank: { kind: 'tiers', label: 'Fuel cell', cost: [0, 0.02, 0.04, 0.07],
    blurb: 'A bladder cell in the pod. It goes further on a fill and the pod is that much heavier for it.',
    fx: (p, t) => { p.tank *= 1 + 0.2 * t; p.burn /= 1 + 0.2 * t; p.mP *= 1 + 0.03 * t; } },
  reel: { kind: 'tiers', label: 'Slingshot reel', cost: [0, 0.03, 0.07, 0.12],
    blurb: 'A spring reel on each cable. A slide charges the whip quicker and it kicks harder when you let it go.',
    fx: (p, t) => { p.whipMax += 0.08 * t; p.whipCharge *= 1 - 0.1 * t; p.whipHold *= 1 + 0.08 * t; } },
  shell: { kind: 'choice', label: 'Pod shell', def: 'stock', choices: {
    stock: { label: 'Stock tub', cost: 0, blurb: 'The tub it came with.' },
    light: { label: 'Lightened', cost: 0.06, blurb: 'Drilled ribs and a thinner skin. The pod is a fifth lighter, swings less and is quicker off the line; it folds up sooner when it hits something.',
      fx: (p) => { p.mP *= 0.82; p.hullK *= 1.35; p.topSpeed *= 1.015; } },
    armour: { label: 'Armoured', cost: 0.08, blurb: 'Plate bolted over the tub. The pod shrugs off what would fold a stock one; it is heavier, slower off the line and a little slower flat out.',
      fx: (p) => { p.mP *= 1.25; p.hullK *= 0.55; p.engK *= 0.8; p.topSpeed *= 0.97; } },
  } },
  tether: { kind: 'choice', label: 'Tether length', def: 'standard', choices: {
    standard: { label: 'Standard', cost: 0, blurb: 'The cables it came with.' },
    short: { label: 'Short', cost: 0.01, blurb: 'Cut a sixth shorter. The pod answers the turbines quicker and swings less, and the whip is weaker.',
      fx: (p) => { p.cableLen *= 0.85; p.swingDamp *= 0.8; p.whipMax *= 0.8; } },
    long: { label: 'Long', cost: 0.01, blurb: 'Spliced a sixth longer. The pod hangs out further, swings more and whips harder.',
      fx: (p) => { p.cableLen *= 1.15; p.swingDamp *= 1.15; p.whipMax *= 1.2; p.whipCharge *= 0.9; } },
  } },
  spinner: { kind: 'look', label: 'Spinner', def: 'stock', choices: {
    stock: { label: 'Dome', cost: 0 },
    spike: { label: 'Spike', cost: 0.008, ch: 'kit_spike', hide: 'kit_spinner' },
    twin: { label: 'Contra-rotating', cost: 0.012, ch: 'kit_twin', hide: 'kit_spinner' },
  } },
  fins: { kind: 'look', label: 'Fins', def: 'stock', choices: {
    stock: { label: 'Stock', cost: 0 },
    tall: { label: 'Tall', cost: 0.01, ch: 'kit_fins_tall', hide: 'kit_fin' },
    none: { label: 'Shaved', cost: 0.004, hide: 'kit_fin' },
  } },
  scoops: { kind: 'look', label: 'Scoops', def: 'none', choices: {
    none: { label: 'None', cost: 0 },
    ram: { label: 'Ram air', cost: 0.01, ch: 'kit_scoop' },
  } },
  pipes: { kind: 'look', label: 'Jet pipes', def: 'stock', choices: {
    stock: { label: 'Stock', cost: 0 },
    long: { label: 'Afterburner cans', cost: 0.012, ch: 'kit_pipes' },
  } },
  wings: { kind: 'look', label: 'Pod wings', def: 'none', choices: {
    none: { label: 'None', cost: 0 },
    canard: { label: 'Canards', cost: 0.01, ch: 'kit_canard' },
  } },
  casing: { kind: 'look', label: 'Turbine casing', def: 'bare', choices: {
    bare: { label: 'Bare alloy', cost: 0 },
    black: { label: 'Black chrome', cost: 0.012, rgb: '#26282e' },
    gold: { label: 'Gold anodised', cost: 0.015, rgb: '#c8a24a' },
    blued: { label: 'Heat blued', cost: 0.012, rgb: '#4a5a9a' },
    white: { label: 'White ceramic', cost: 0.012, rgb: '#e6e4de' },
  } },
  arc: { kind: 'look', label: 'Binder arc', def: 'blue', choices: {
    blue: { label: 'Blue', cost: 0, rgb: [120, 200, 255] },
    green: { label: 'Green', cost: 0.008, rgb: [110, 255, 150] },
    red: { label: 'Red', cost: 0.008, rgb: [255, 90, 70] },
    violet: { label: 'Violet', cost: 0.008, rgb: [190, 120, 255] },
    gold: { label: 'Gold', cost: 0.008, rgb: [255, 200, 90] },
    white: { label: 'White', cost: 0.008, rgb: [235, 240, 255] },
  } },
  flame: { kind: 'look', label: 'Exhaust', def: 'amber', choices: {
    amber: { label: 'Amber', cost: 0, rgb: [255, 150, 60] },
    blue: { label: 'Blue', cost: 0.008, rgb: [90, 160, 255] },
    green: { label: 'Green', cost: 0.008, rgb: [110, 255, 130] },
    violet: { label: 'Violet', cost: 0.008, rgb: [200, 110, 255] },
    white: { label: 'White hot', cost: 0.008, rgb: [240, 236, 255] },
  } },
};

/** The kit with every slot it does not know, and every value out of range, dropped. */
export function cleanKit(kit) {
  const out = {};
  if (!kit || typeof kit !== 'object') return out;
  for (const [k, v] of Object.entries(kit)) {
    const s = PODRACER_KIT[k];
    if (!s) continue;
    if (s.kind === 'tiers') { const t = Math.round(Number(v)); if (t >= 1 && t <= 3) out[k] = t; }
    else if (s.choices[v] && v !== s.def) out[k] = v;
  }
  return out;
}
/** A slot's value on a kit: a tier, or a choice's id. */
export const kitValue = (kit, k) => { const s = PODRACER_KIT[k]; return s.kind === 'tiers' ? (kit?.[k] | 0) : (s.choices[kit?.[k]] ? kit[k] : s.def); };
/** What a slot at value `v` costs in all, as a share of the type's price. */
export const kitShare = (k, v) => { const s = PODRACER_KIT[k]; return s.kind === 'tiers' ? s.cost[v | 0] || 0 : s.choices[v]?.cost || 0; };
/** What the whole kit cost, in credits, on a racer of this price: the part of it the yard will buy back. */
export const kitWorth = (kit, price) => Math.round(Object.keys(PODRACER_KIT).reduce((a, k) => a + kitShare(k, kitValue(kit, k)), 0) * price);

// What the fitting shop charges to swap a part, whatever it is, as a share of the type's price, and
// what it gives for a part that comes off: that share of what the part cost, as part exchange.
export const FIT_LABOUR = 0.004, PART_EXCHANGE = 0.4;
/** The bill for going from kit `a` to kit `b` on a racer of this price: parts, labour, part exchange, net. */
export function kitQuote(price, a, b) {
  let parts = 0, back = 0, slots = 0;
  for (const k of Object.keys(PODRACER_KIT)) {
    const was = kitValue(a, k), now = kitValue(b, k);
    if (was === now) continue;
    slots++;
    const d = kitShare(k, now) - kitShare(k, was);
    if (d > 0) parts += d; else back += -d * PART_EXCHANGE;
  }
  const P = price || 0, pr = Math.round(parts * P), bk = Math.round(back * P), labour = Math.round(slots * FIT_LABOUR * P);
  return { parts: pr, labour, back: bk, total: pr + labour - bk, slots };
}

const TUNED = new Map();
/**
 * The type's row with the kit's parts fitted: the numbers the seat steps, the server checks and the
 * counter shows. Memoised on the type and the kit, so a caller per report costs a map lookup.
 */
export function podracerTuned(typeId, kit) {
  const base = PODRACER_TYPES[typeId] || PODRACER_TYPES.podracer;
  const k = cleanKit(kit);
  const key = (PODRACER_TYPES[typeId] ? typeId : 'podracer') + JSON.stringify(k);
  if (TUNED.has(key)) return TUNED.get(key);
  const p = { ...base, hullK: 1, engK: 1 };
  for (const [slot, v] of Object.entries(k)) {
    const s = PODRACER_KIT[slot];
    if (s.kind === 'tiers') s.fx(p, v);
    else s.choices[v]?.fx?.(p);
  }
  p.dragE = (2 * p.mE * p.thrust / (p.topSpeed * p.topSpeed) - p.mP * p.dragP) / (2 * p.mE);
  p.kit = k;
  if (TUNED.size > 200) TUNED.clear();
  TUNED.set(key, p);
  return p;
}

/**
 * How a kit looks: the mesh channels it opens (on for its own parts, on for each stock part it
 * hides, the `whenNot` side) and the colours the renderer reads. Every caller that draws a racer
 * passes `anim` and `look` from here, the seat for its own and the contact for everybody else's.
 */
export function podracerLook(kit) {
  const k = cleanKit(kit), anim = {};
  let arc = null, flame = null, casing = null;
  for (const [slot, s] of Object.entries(PODRACER_KIT)) {
    if (s.kind !== 'look') continue;
    const c = s.choices[k[slot] || s.def];
    if (c.ch) anim[c.ch] = 1;
    if (c.hide) anim[c.hide] = 1;
    if (slot === 'arc' && k.arc) arc = c.rgb;
    if (slot === 'flame') flame = c.rgb;
    if (slot === 'casing' && c.rgb) casing = c.rgb;
  }
  return { anim, arc, flame, casing };
}

/**
 * The livery the renderer is handed for a racer: its paint, with the kit's turbine casing as the
 * mesh's `casing` slot painted by name (liveryPalette `parts`). An unpainted racer with a coloured
 * casing is still factory paint everywhere else.
 */
export function podracerLivery(livery, kit) {
  const c = PODRACER_KIT.casing.choices[cleanKit(kit).casing]?.rgb;
  if (!c) return livery || null;
  return { ...(livery && livery.base ? livery : { ...(livery || {}), pattern: 'factory' }), parts: { ...(livery?.parts || {}), casing: c } };
}

/** The counter's bars for a tuned row, each 0..1 on a scale with room above the Sledgehammer at Pro. */
export function podracerStats(p) {
  const n = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
  return {
    speed: n(p.topSpeed, 150, 420),
    pull: n(p.thrust * (2 * p.mE) / (2 * p.mE + p.mP), 20, 90),
    turn: n(p.turnRate * (0.5 + p.turnHi), 30, 130),
    cable: n(p.snapMphS, 1000, 5000),
    tank: n(p.tank / (p.burn ?? 1), 80, 420),
    heat: n(p.heatDown / p.heatUp, 0.2, 1.6),
    tough: n(1 / (p.hullK ?? 1), 0.5, 2),
    binder: n(p.binderMph, 60, 160),
  };
}

// The ground under it. A racer hovers, so the ground costs drag and grip, never traction. Cliffs and
// buildings are not here: the caller's `solid(x, y)` answers those.
export const PODRACER_GROUND = {
  redrock: { drag: 1.0, grip: 1.0 },
  road:    { drag: 0.85, grip: 1.05 },
  sand:    { drag: 1.7, grip: 0.85 },
  scree:   { drag: 2.4, grip: 0.7 },
  water:   { drag: 1.3, grip: 0.6 },
};

// ── Bodies ─────────────────────────────────────────────────────────────────────

function body(x, y, a, m, I) { return { x, y, a, vx: 0, vy: 0, w: 0, m, I, px: x, py: y, pa: a }; }

// The world offset of local point (u right, v forward) on a body at heading a.
function offset(a, u, v) {
  const c = Math.cos(a), s = Math.sin(a);
  return [u * c + v * s, u * s - v * c];
}
const cross = (rx, ry, nx, ny) => rx * ny - ry * nx;

const engInertia = (p) => p.mE * p.engHalfLen * p.engHalfLen / 3;
// What the pair would weigh in yaw as one piece: the split vanes are tuned against it.
const pairInertia = (p) => 2 * (engInertia(p) + p.mE * p.halfSpan * p.halfSpan);
function podInertia(p) { return p.mP * (p.podHalfLen * p.podHalfLen + p.podHalfW * p.podHalfW) / 3; }

// Where turbine i (0 left, 1 right) is: its body and its local centre on that body.
function engPoint(s, p, i) { return { b: s.eng[i], u: 0, v: 0 }; }
// Each cable leaves the inner face of its turbine: toward the centreline, cableU off it.
function cableEnds(s, p, i) {
  const ua = (i ? -1 : 1) * (p.halfSpan - p.cableU);
  return { A: s.eng[i], ua, va: -p.cableV, B: s.pod, ub: (i ? 1 : -1) * p.podAnchor, vb: p.podHalfLen };
}
// The binder's two links, nose and tail, between the turbines' centrelines.
// The binder's links, nose and tail across and the two diagonals: a truss. Across only, a twist of one
// turbine against the other barely changed any link's length, and at the wide stance a lever cut on one
// side could turn the pair round each other.
const BINDER_V = [[0.6, 0.6], [-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6]];
const binderEnds = (s, p, k) => ({ A: s.eng[0], ua: 0, va: BINDER_V[k][0] * p.engHalfLen, B: s.eng[1], ub: 0, vb: BINDER_V[k][1] * p.engHalfLen });
const binderLen = (p, k) => Math.hypot(2 * p.halfSpan, (BINDER_V[k][0] - BINDER_V[k][1]) * p.engHalfLen);

export function createPodracerState(p, { docked = true } = {}) {
  const s = {
    x: 0, y: 0, heading: 0, speed: 0,
    eng: [body(0, 0, 0, p.mE, engInertia(p)), body(0, 0, 0, p.mE, engInertia(p))],
    pod: body(0, 0, 0, p.mP, podInertia(p)),
    binder: true, binderStrain: 0,
    cable: [0, 1].map(() => ({ ok: true, taut: false, t: 0, gauge: 0, over: 0 })),
    lever: [0, 0], pedal: [0, 0], rpm: [0, 0],
    engHp: [1, 1], hull: 1, heat: [0, 0], boosting: false, sliding: false, whip: 0, whipT: 0, whipK: 0,
    running: false, crank: 0, acc: 0,
    // 'docked' | 'docking' | 'launched'; how hard the pins hold (0..1); the cables' length now.
    mode: docked ? 'docked' : 'launched', dockK: docked ? 1 : 0, payoutLen: p.cableLen, binderPower: docked ? 0 : 1,
    events: [],
  };
  placePodracer(s, p, 0, 0, 0);
  return s;
}

// Where turbine i docks on the pod: alongside, its centre dockV ahead of the pod's.
const dockSide = (i) => (i ? 1 : -1);
// The two pins that hold turbine i docked: a point on the turbine and its place on the pod.
const dockPins = (s, p, i) => [1, -1].map((k) => ({ A: s.eng[i], ua: 0, va: k * p.dockPin, B: s.pod, ub: dockSide(i) * p.halfSpan, vb: p.dockV + k * p.dockPin }));
// The cables' shortest: from a docked turbine's ring to the pod's nose.
const reeledLen = (p) => Math.hypot(p.halfSpan - p.cableU, p.podHalfLen - p.dockV + p.cableV);

/** F: launch the turbines off the pod, or call them back in. Only running, with a binder. */
export function toggleDock(s, p) {
  if (!s.running || !s.binder) return false;
  if (s.mode === 'launched') {
    s.mode = 'docking';
    s.dockT = 0;
    s.events.push('docking');
  } else {
    s.mode = 'launched';
    s.dockK = 0;
    s.launchT = 0;
    s.payoutLen = Math.max(reeledLen(p), ...[0, 1].map((i) => cableSpan(s, p, i)));
    // Pushed off forward, off the pod's nose, to fly out on the paying-out cables.
    for (const b of s.eng) { b.vx += Math.sin(s.pod.a) * p.launchKick; b.vy -= Math.cos(s.pod.a) * p.launchKick; }
    s.events.push('launch');
  }
  return true;
}
// How far apart cable i's ends are now.
function cableSpan(s, p, i) {
  const e = cableEnds(s, p, i);
  const [rax, ray] = offset(e.A.a, e.ua, e.va), [rbx, rby] = offset(e.B.a, e.ub, e.vb);
  return Math.hypot((e.B.x + rbx) - (e.A.x + rax), (e.B.y + rby) - (e.A.y + ray));
}

// Put the craft down at (x, y) facing `headingDeg`, all way off: docked, the turbines alongside the
// pod; launched, out ahead on cables just short of taut.
export function placePodracer(s, p, x, y, headingDeg) {
  const a = headingDeg * D2R;
  const P = s.pod; P.x = x; P.y = y; P.a = a; P.vx = P.vy = P.w = 0;
  const docked = s.mode !== 'launched';
  if (docked) { s.mode = 'docked'; s.dockK = 1; }
  const ahead = docked ? p.dockV : p.podHalfLen + p.cableLen * 0.97 + p.cableV;
  for (let i = 0; i < 2; i++) {
    const [sx, sy] = offset(a, (i ? 1 : -1) * p.halfSpan, ahead);
    const E = s.eng[i]; E.x = x + sx; E.y = y + sy; E.a = a; E.vx = E.vy = E.w = 0;
  }
  sync(s, p);
}

// Move every body by the same step: the seat recentring its map window.
export function shiftPodracerOrigin(s, dx, dy) {
  for (const b of [...s.eng, s.pod]) { b.x += dx; b.y += dy; b.px += dx; b.py += dy; }
  s.x += dx; s.y += dy;
}

// ── Stepping ───────────────────────────────────────────────────────────────────
//
// input = { left 0..1, right 0..1, steer -1..1 (the split vanes, right positive), brake 0..1,
//           reverse 0..1 (the thrust reversers), slide bool, boost bool, starter bool, fuel, surface,
//           solid(x, y) -> bool (cliffs, buildings), now }
export function stepPodracer(s, input, p, dt) {
  s.events = [];
  s.hitThisStep = 0;
  const running = ignition(s, input, dt);
  const live = running && s.binder;
  s.lever[0] = live ? clamp(input.left || 0, 0, 1) : 0;
  s.lever[1] = live ? clamp(input.right || 0, 0, 1) : 0;
  const brake = clamp(input.brake || 0, 0, 1);
  s.steer = live ? clamp(input.steer || 0, -1, 1) : 0;
  const wasSliding = !!s.sliding;
  s.sliding = live && !!input.slide;
  s.reverse = live ? clamp(input.reverse || 0, 0, 1) : 0;
  whipStep(s, p, wasSliding, live, dt);
  // The boost lights only with both levers near full, and only on a turbine that is turning.
  s.boosting = live && !!input.boost && s.pedal[0] + s.pedal[1] > 1.7;
  if (!s.heat) s.heat = [0, 0];
  for (let i = 0; i < 2; i++) {
    if (s.boosting && s.engHp[i] > 0) s.heat[i] += p.heatUp * dt;
    else s.heat[i] -= p.heatDown * dt * (2 - s.pedal[i]);
    s.heat[i] = clamp(s.heat[i], 0, 1.25);
    if (s.heat[i] > 1 && s.boosting) {
      s.engHp[i] = clamp(s.engHp[i] - p.burnHp * dt, 0, 1);
      if (!s.burning) { s.burning = true; s.events.push({ type: 'overheat', eng: i }); }
    }
  }
  if (!s.boosting) s.burning = false;
  const ground = PODRACER_GROUND[input.surface] || PODRACER_GROUND.redrock;
  if (input.dockToggle) toggleDock(s, p);
  dockStep(s, p, dt);

  // The turbines spool. Up is slow, down is quick, as on every engine in the game.
  for (let i = 0; i < 2; i++) {
    const want = s.engHp[i] > 0 ? s.lever[i] : 0;
    const rate = want > s.pedal[i] ? 1.8 : 4.5;
    s.pedal[i] = clamp(s.pedal[i] + (want - s.pedal[i]) * Math.min(1, rate * dt), 0, 1);
    s.rpm[i] = running && s.engHp[i] > 0 ? IDLE + (1 - IDLE) * s.pedal[i] : ((s.crank || 0) > 0 ? 0.06 : s.rpm[i] * Math.exp(-dt * 0.8));
  }

  // Frame-start poses, for the world collision at the end.
  const start = [...s.eng, s.pod].map((b) => [b.x, b.y, b.a]);

  s.acc = Math.min((s.acc || 0) + dt, MAX_SUBS * SUB_DT);
  let n = 0;
  for (const c of s.cable) c.peak = 0;
  while (s.acc >= SUB_DT && n < MAX_SUBS) {
    substep(s, p, brake, ground, SUB_DT);
    s.acc -= SUB_DT; n++;
  }

  collide(s, p, input, start);
  sync(s, p);
  // The gauges read a smoothed pull; the snap reads the raw one, inside the sub-step.
  for (const c of s.cable) c.gauge += (c.peak - c.gauge) * Math.min(1, dt * 10);
  return s;
}

// Docking and launching over time, and the binder's power.
function dockStep(s, p, dt) {
  if (!s.binder && s.mode !== 'launched') { s.mode = 'launched'; s.dockK = 0; }
  if (s.mode === 'docking') {
    s.dockT = (s.dockT || 0) + dt;
    // Home once both are close to their places and lined up, or, failing that, after dockTime.
    let worst = 0;
    for (let i = 0; i < 2; i++) for (const e of dockPins(s, p, i)) {
      const [rax, ray] = offset(e.A.a, e.ua, e.va), [rbx, rby] = offset(e.B.a, e.ub, e.vb);
      worst = Math.max(worst, Math.hypot((e.B.x + rbx) - (e.A.x + rax), (e.B.y + rby) - (e.A.y + ray)));
    }
    if (worst < 0.015 || s.dockT > p.dockTime) { s.mode = 'docked'; s.dockK = 1; s.dockT = 0; s.events.push('docked'); }
  }
  if (s.mode === 'launched') {
    s.payoutLen = Math.min(p.cableLen, (s.payoutLen || p.cableLen) + p.payout * dt);
    s.launchT = (s.launchT ?? 9) + dt;
  }
  // The binder's power: idle docked; launched, whichever is higher of the speed and the g.
  const [L, R] = s.eng, vx = (L.vx + R.vx) / 2, vy = (L.vy + R.vy) / 2;
  const g = s.prevPV ? Math.hypot(vx - s.prevPV[0], vy - s.prevPV[1]) / Math.max(dt, 1e-3) * p.tileMph / 22 : 0;
  s.prevPV = [vx, vy];
  const mph = Math.hypot(vx, vy) * p.tileMph;
  const want = s.mode !== 'launched' ? 0
    : Math.max(p.binderIdle, clamp((mph - p.binderOnMph) / (p.binderFullMph - p.binderOnMph), 0, 1), clamp(g / p.binderFullG, 0, 1));
  const tau = want > (s.binderPower || 0) ? p.binderUp : p.binderDown;
  s.binderPower = clamp((s.binderPower || 0) + (want - (s.binderPower || 0)) * (1 - Math.exp(-dt / tau)), 0, 1);
}

// The slingshot: charged by a slide with the pod hung out, fired by letting the slide go.
function whipStep(s, p, wasSliding, live, dt) {
  if (s.whipT > 0) s.whipT = Math.max(0, s.whipT - dt);
  if (!live) { s.whip = 0; s.whipT = 0; return; }
  if (s.sliding) {
    const P = s.pod, v = Math.hypot(P.vx, P.vy) * p.tileMph;
    const out = v > 60 ? clamp(Math.abs(wrapPi(Math.atan2(P.vx, -P.vy) - P.a)) / (35 * D2R), 0, 1) : 0;
    s.whip = clamp((s.whip || 0) + out * dt / p.whipCharge, 0, 1);
  } else if (wasSliding) {
    if (s.whip > 0.15) {
      s.whipK = s.whip; s.whipT = p.whipHold * s.whip;
      s.events.push({ type: 'whip', k: +s.whip.toFixed(2) });
    }
    s.whip = 0;
  }
}

function ignition(s, input, dt) {
  if (s.running) { s.crank = 0; return true; }
  // No binder, no start: the turbines' controls run through it.
  if (!s.binder) {
    if (input.starter && !s.saidNoBinder) { s.events.push('nobinder'); s.saidNoBinder = true; }
    if (!input.starter) s.saidNoBinder = false;
    s.crank = 0;
    return false;
  }
  const dry = input.fuel != null && input.fuel <= 0;
  if (input.starter && !dry && s.engHp.some((h) => h > 0)) {
    s.crank = (s.crank || 0) + dt;
    if (s.crank >= CRANK_S) { s.running = true; s.crank = 0; s.events.push('started'); }
  } else {
    if (input.starter && dry && !s.wasDry) { s.events.push('dry'); s.wasDry = true; }
    s.crank = 0;
  }
  if (!input.starter) s.wasDry = false;
  return false;
}

// The pair's heading, as a heading: forward is (sin a, -cos a), so it is the mean of the two noses.
function pairHeading(L, R) { return Math.atan2(Math.sin(L.a) + Math.sin(R.a), Math.cos(L.a) + Math.cos(R.a)); }

function applyAt(b, rx, ry, fx, fy, h) {
  b.vx += fx / b.m * h; b.vy += fy / b.m * h;
  b.w += cross(rx, ry, fx, fy) / b.I * h;
}

// Drag, friction and sideways grip on one body, at its centre.
function resist(b, drag, fric, slide, grip, mph, h, redirect = 0) {
  const v = Math.hypot(b.vx, b.vy);
  if (v > 1e-6) {
    // drag in mph/s is dragX * vmph^2; in tiles it is dragX * tileMph * v^2.
    const dec = (drag * mph * v * v + fric / mph) * h;
    const k = Math.max(0, 1 - dec / v);
    b.vx *= k; b.vy *= k;
  }
  const rx = Math.cos(b.a), ry = Math.sin(b.a);
  const lat = b.vx * rx + b.vy * ry;
  const keep = Math.exp(-h * grip / slide);
  b.vx -= rx * lat * (1 - keep); b.vy -= ry * lat * (1 - keep);
  // Grip turns way rather than only eating it: `redirect` of the sideways speed it takes off goes
  // on along the body's nose, so a turn, or a slide caught, keeps most of its speed.
  if (redirect > 0) {
    const fx = Math.sin(b.a), fy = -Math.cos(b.a), fwd = b.vx * fx + b.vy * fy;
    if (fwd > 0) {
      const gain = Math.sqrt(fwd * fwd + redirect * lat * lat * (1 - keep * keep)) - fwd;
      b.vx += fx * gain; b.vy += fy * gain;
    }
  }
}

// A body turns into its own airflow, harder the faster it goes.
function vane(b, k, h) {
  const v = Math.hypot(b.vx, b.vy);
  if (!(v > 0.02)) return;
  const into = wrapPi(Math.atan2(b.vx, -b.vy) - b.a);
  b.w += k * Math.sin(into) * Math.min(v, 3) * h;
}

function substep(s, p, brake, ground, h) {
  const mph = p.tileMph;
  const P = s.pod;
  // 1. Forces into velocities.
  for (let i = 0; i < 2; i++) {
    if (!(s.pedal[i] > 0)) continue;
    const { b, u, v } = engPoint(s, p, i);
    const [rx, ry] = offset(b.a, u, v);
    const f = p.thrust * s.pedal[i] * (s.boosting ? p.boost : 1) * (s.whipT > 0 ? 1 + p.whipMax * s.whipK : 1)
      * (s.mode === 'launched' ? 1 : p.dockThrust) * p.mE / mph;
    applyAt(b, rx, ry, Math.sin(b.a) * f, -Math.cos(b.a) * f, h);
  }
  // Docking: each turbine falls back to its place beside the pod on its own vanes and brakes, closing
  // at no more than dockClose and turning to the pod's heading. The pod is left to coast.
  if (s.mode === 'docking') {
    const k = 1 - Math.exp(-h / 0.12);
    for (let i = 0; i < 2; i++) {
      const b = s.eng[i];
      const [ox, oy] = offset(P.a, dockSide(i) * p.halfSpan, p.dockV);
      const rx = P.x + ox - b.x, ry = P.y + oy - b.y, d = Math.hypot(rx, ry);
      const close = d > 1e-6 ? Math.min(d * 4, p.dockClose) / d : 0;
      b.vx += (P.vx + rx * close - b.vx) * k;
      b.vy += (P.vy + ry * close - b.vy) * k;
      b.w += (wrapPi(P.a - b.a) * 6 + P.w - b.w) * k;
    }
  }
  // The thrust reversers: the petals in the exhaust push each turbine astern, gently, up to revMph.
  if (s.reverse > 0) for (const b of s.eng) {
    const fx = Math.sin(b.a), fy = -Math.cos(b.a), fwd = (b.vx * fx + b.vy * fy) * mph;
    if (fwd > -p.revMph) {
      const f = p.revThrust * s.reverse * p.mE / mph * clamp((fwd + p.revMph) / 4, 0, 1);
      applyAt(b, 0, 0, -fx * f, -fy * f, h);
    }
  }
  // The split vanes turn the pair: they chase a turn rate set by the steer and the lever split, and
  // with nothing asked they hold the pair straight. A torque on the pair is a pair of opposite forces
  // along the turbines, the left one forward for a right turn; the binder makes them a rotation.
  s.steerCmd = 0;
  if (s.binder && s.running) {
    const [L, R] = s.eng;
    const spd01 = clamp(Math.hypot(L.vx + R.vx, L.vy + R.vy) / 2 * mph / p.topSpeed, 0, 1);
    const cmd = clamp(s.steer + (s.pedal[0] - s.pedal[1]) * p.splitSteer, -1, 1);
    s.steerCmd = cmd;
    // The vanes need air over them: full authority from vaneMph, a fraction of it at a standstill.
    const air = p.vaneMin + (1 - p.vaneMin) * clamp(spd01 * p.topSpeed / p.vaneMph, 0, 1);
    const rate = p.turnRate * D2R * (1 - (1 - p.turnHi) * spd01) * (s.sliding ? p.slideTurn : 1) * air;
    const w = (L.w + R.w) / 2;
    let want = cmd * rate;
    const launched = s.mode === 'launched';
    // The jackknife limit: how far the pair has swung off the line back to the pod. Past most of
    // the limit the vanes stop turning it further out; past all of it the tow pulls it back.
    const mx = (L.x + R.x) / 2 - P.x, my = (L.y + R.y) / 2 - P.y;
    // Only once the pair is out on its cables: just launched, still almost on the pod, the line back to
    // it is a few centimetres pointing anywhere, and the limit spun the heavy racer round.
    const reach = Math.hypot(mx, my), clear = p.podHalfLen + p.cableV + 0.03;
    const jk = clamp((reach - clear) / (p.cableLen * 0.5), 0, 1);
    if (launched && jk > 0) {
      // The tow line's heading, from the pod up to the pair: (x, -y) is (sin, cos) of a heading.
      const dev = wrapPi(pairHeading(L, R) - Math.atan2(mx, -my));
      const lim = p.jackknife * D2R, soft = lim * 0.6, ad = Math.abs(dev);
      if (ad > soft && Math.sign(want) === Math.sign(dev)) want *= 1 - jk + jk * clamp(1 - (ad - soft) / (lim - soft), 0, 1);
      if (ad > lim) want -= Math.sign(dev) * (ad - lim) * p.jackPull * jk;
      s.jack = ad / lim;
    }
    const alpha = clamp((want - w) / p.steerTau, -p.steerMax, p.steerMax);
    // Docked, the vanes turn the whole craft, pod and all, so they push harder. Launched, they turn
    // the pair as one through the binder in proportion to its power, and each turbine on its own
    // vane for the rest, the way two loose turbines on a weak leash would have to be steered.
    const pw = launched ? s.binderPower : 1;
    const F = alpha * pairInertia(p) / (2 * p.halfSpan) * (launched ? pw : p.dockSpin);
    for (const [b, sg] of [[L, 1], [R, -1]]) applyAt(b, 0, 0, Math.sin(b.a) * F * sg, -Math.cos(b.a) * F * sg, h);
    if (launched && pw < 1) for (const b of s.eng) b.w += clamp((want - b.w) / p.steerTau, -p.steerMax, p.steerMax) * (1 - pw) * h;
  }
  const eDrag = p.dragE * (1 + brake * p.airBrake) * ground.drag;
  // While the whip fires the pod barely grips, so the swing back is carried by the tether (which keeps
  // the way) and not scrubbed off sideways.
  const whipping = s.whipT > 0;
  const slip = s.sliding ? p.slideMul : whipping ? 6 : 1, slipE = s.sliding ? p.slideMulE : 1;
  for (const b of s.eng) {
    resist(b, eDrag, p.fricE * ground.drag, p.slideE * slipE, ground.grip, mph, h, p.redirectE);
    // A turn asked for is the vanes set across the flow, so the turbines stop weathervaning into it.
    vane(b, p.vaneE * (1 - 0.85 * Math.abs(s.steerCmd)), h);
    b.w *= Math.exp(-h / p.yawTau);
  }
  // The pod has air brakes too, or it coasts on into the turbines every time they slow.
  resist(P, p.dragP * (1 + brake * p.airBrake) * ground.drag, p.fricP * ground.drag, p.slideP * slip, ground.grip, mph, h, p.redirectP);
  vane(P, p.vane, h);
  P.w *= Math.exp(-h / 0.25);

  // 2. Predict positions.
  const all = [...s.eng, P];
  for (const b of all) {
    b.px = b.x; b.py = b.y; b.pa = b.a;
    b.x += b.vx * h; b.y += b.vy * h; b.a += b.w * h;
  }

  // 3. Constraints. The cables pull; the pod and the turbines cannot pass through each other.
  // Docked or docking, the pins hold them alongside instead and the cables are reeled in.
  const launched = s.mode === 'launched';
  if (s.mode === 'docked') {
    const comp = p.dockComp / (h * h);
    for (let i = 0; i < 2; i++) for (const e of dockPins(s, p, i)) solveLink(e, 0, comp);
  }
  for (let i = 0; i < 2; i++) {
    const c = s.cable[i];
    c.taut = false; c.t = 0;
    if (!c.ok || !launched) continue;
    const e = cableEnds(s, p, i);
    // The reel's brake: for the first second after a launch the cables give, and take up the jolt of
    // the turbines reaching the end of them rather than snapping on it.
    const reeling = (s.launchT ?? 9) < 1;
    const [ra, rb] = solveRope(e, s.payoutLen || p.cableLen, p.cableComp * (reeling ? 12 : 1) / (h * h));
    if (ra === null) continue;
    c.taut = true; c.t = rb;
    c.n = ra;
  }
  // The tether's floor: closer than the cushion, each cable pushes back like a soft strut.
  for (let i = 0; i < 2; i++) {
    const c = s.cable[i];
    // Only once the turbine's end of the cable is out ahead of the pod's nose: just launched, it starts
    // behind the ring, the cable shortens before it lengthens, and a cushion then held the turbines in.
    const e = cableEnds(s, p, i), [ax, ay] = offset(e.A.a, e.ua, e.va);
    const ahead = ((e.A.x + ax - P.x) * Math.sin(P.a) - (e.A.y + ay - P.y) * Math.cos(P.a)) > p.podHalfLen + 0.01;
    c.push = c.ok && launched && ahead && solveApart(e, p.cushion * Math.min(p.cableLen, s.payoutLen || p.cableLen), p.cushionComp / (h * h)) > 0;
  }
  if (launched) for (let i = 0; i < 2; i++) {
    const { b, u, v } = engPoint(s, p, i);
    solveContact(b, u, v, P, p.engR + p.podR);
  }
  // The binder: every link pulled back to its length, either way, with give.
  let strain = 0;
  // Its stiffness goes with its power: at idle a loose leash, at full the truss it always was.
  const bk = p.binderIdle + (1 - p.binderIdle) * (s.binderPower || 0);
  if (s.binder && launched) {
    for (let k = 0; k < BINDER_V.length; k++) {
      // The diagonals give more, so the span still flexes while the twist is held.
      const r = solveLink(binderEnds(s, p, k), binderLen(p, k), p.binderComp * (k < 2 ? 1 : 4) / (bk * bk) / (h * h));
      if (r) strain = Math.max(strain, Math.abs(r.C) / (2 * p.halfSpan) * (s.binderPower || 0));
    }
  }
  // The turbines against each other: three circles down each one.
  let clash = 0;
  for (const va of [-0.6, 0, 0.6]) for (const vb of [-0.6, 0, 0.6]) {
    const c = solveApart({ A: s.eng[0], ua: 0, va: va * p.engHalfLen, B: s.eng[1], ub: 0, vb: vb * p.engHalfLen }, 2 * p.engR);
    if (c > clash) clash = c;
  }

  // 4. Velocities from the positions.
  for (const b of all) {
    b.vx = (b.x - b.px) / h; b.vy = (b.y - b.py) / h; b.w = (b.a - b.pa) / h;
  }

  // The pins' damping, so a docked turbine sits still on them.
  if (s.mode === 'docked') for (let i = 0; i < 2; i++) for (const e of dockPins(s, p, i)) {
    const n = linkNormal(e);
    if (n) dampRope(e, n, 1 - Math.exp(-h / 0.12));
  }
  for (let i = 0; i < 2; i++) {
    if (!s.cable[i].push) continue;
    const e = cableEnds(s, p, i), n = linkNormal(e);
    if (n) dampRope(e, n, 1 - Math.exp(-h / p.cushionDamp));
  }
  // The swing damper: the pod's motion across the tow line, against the turbines', dies away. Equal
  // and opposite, so it costs the craft no way.
  if (launched && (s.cable[0].ok || s.cable[1].ok)) {
    const [L, R] = s.eng, mE = L.m + R.m;
    const ex = (L.x + R.x) / 2 - P.x, ey = (L.y + R.y) / 2 - P.y, d = Math.hypot(ex, ey);
    if (d > 1e-6) {
      const tx = -ey / d, ty = ex / d;
      const rel = (P.vx - (L.vx * L.m + R.vx * R.m) / mE) * tx + (P.vy - (L.vy * L.m + R.vy * R.m) / mE) * ty;
      const k = 1 - Math.exp(-h / (s.sliding ? p.swingSlide : s.whipT > 0 ? 0.08 : p.swingDamp));
      const J = rel * k * (P.m * mE) / (P.m + mE);
      P.vx -= tx * J / P.m; P.vy -= ty * J / P.m;
      for (const b of s.eng) { b.vx += tx * J / mE; b.vy += ty * J / mE; }
    }
  }
  // The binder's damping, along each link, so a shimmy dies away.
  if (s.binder && launched) for (let k = 0; k < BINDER_V.length; k++) {
    const e = binderEnds(s, p, k), n = linkNormal(e);
    if (n) dampRope(e, n, 1 - Math.exp(-h / (p.binderDamp / (0.3 + 0.7 * bk))));
  }
  s.binderStrain = Math.max(s.binderStrain * Math.exp(-h * 6), strain);
  // A clash between the turbines, once they are loose, is a hit like any other.
  if (clash > 0 && !s.binder) {
    const [L, R] = s.eng;
    const rel = Math.hypot(L.vx - R.vx, L.vy - R.vy) * mph;
    if (rel > p.freeMph && !s.clashed) {
      s.clashed = true;
      const cost = rel - p.freeMph;
      for (let i = 0; i < 2; i++) s.engHp[i] = clamp(s.engHp[i] - cost * cost * 0.00006, 0, 1);
      s.events.push({ type: 'hit', part: 'turbines', mph: Math.round(rel) });
    }
  } else if (clash === 0) s.clashed = false;

  // 5. Cable damping along the taut line, then the snap.
  for (let i = 0; i < 2; i++) {
    const c = s.cable[i];
    if (!c.ok || !c.taut) { c.over = 0; continue; }
    dampRope(cableEnds(s, p, i), c.n, 1 - Math.exp(-h / p.cableDamp));
    // The pull on the pod, in mph/s.
    const pull = c.t / (h * h) / p.mP * mph;
    if (pull > c.peak) c.peak = pull;
    c.over = pull > p.snapMphS && (s.launchT ?? 9) >= 1 ? c.over + h : 0;
    if (c.over > p.snapHold) {
      c.ok = false; c.taut = false; c.over = 0;
      s.events.push({ type: 'snap', cable: i, pull: Math.round(pull) });
      // Both cables gone: nobody is holding the throttle, so the turbines fall to idle.
      if (!s.cable[0].ok && !s.cable[1].ok) { s.lever[0] = s.lever[1] = 0; s.running = false; s.events.push('cutout'); }
    }
  }
}

// One-sided distance constraint between two body points. Returns [n, correction] when it acted.
function solveRope(e, len, compH) {
  const [rax, ray] = offset(e.A.a, e.ua, e.va);
  const [rbx, rby] = offset(e.B.a, e.ub, e.vb);
  const dx = (e.B.x + rbx) - (e.A.x + rax), dy = (e.B.y + rby) - (e.A.y + ray);
  const d = Math.hypot(dx, dy);
  const C = d - len;
  if (C <= 0 || d < 1e-9) return [null, 0];
  const nx = dx / d, ny = dy / d;
  const ca = cross(rax, ray, nx, ny), cb = cross(rbx, rby, nx, ny);
  const w = 1 / e.A.m + ca * ca / e.A.I + 1 / e.B.m + cb * cb / e.B.I;
  const dl = C / (w + compH);
  e.A.x += nx * dl / e.A.m; e.A.y += ny * dl / e.A.m; e.A.a += ca * dl / e.A.I;
  e.B.x -= nx * dl / e.B.m; e.B.y -= ny * dl / e.B.m; e.B.a -= cb * dl / e.B.I;
  return [[nx, ny], dl];
}

// A two-sided distance constraint between two body points: back to `len` from either side.
function solveLink(e, len, compH) {
  const [rax, ray] = offset(e.A.a, e.ua, e.va);
  const [rbx, rby] = offset(e.B.a, e.ub, e.vb);
  const dx = (e.B.x + rbx) - (e.A.x + rax), dy = (e.B.y + rby) - (e.A.y + ray);
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return null;
  const C = d - len, nx = dx / d, ny = dy / d;
  const ca = cross(rax, ray, nx, ny), cb = cross(rbx, rby, nx, ny);
  const w = 1 / e.A.m + ca * ca / e.A.I + 1 / e.B.m + cb * cb / e.B.I;
  const dl = C / (w + compH);
  e.A.x += nx * dl / e.A.m; e.A.y += ny * dl / e.A.m; e.A.a += ca * dl / e.A.I;
  e.B.x -= nx * dl / e.B.m; e.B.y -= ny * dl / e.B.m; e.B.a -= cb * dl / e.B.I;
  return { C, dl };
}
// Two body points kept at least `min` apart, with give when compH is set. Returns how far short
// of `min` they were.
function solveApart(e, min, compH = 0) {
  const [rax, ray] = offset(e.A.a, e.ua, e.va);
  const [rbx, rby] = offset(e.B.a, e.ub, e.vb);
  const dx = (e.B.x + rbx) - (e.A.x + rax), dy = (e.B.y + rby) - (e.A.y + ray);
  const d = Math.hypot(dx, dy);
  if (d >= min || d < 1e-9) return 0;
  const C = d - min, nx = dx / d, ny = dy / d;
  const ca = cross(rax, ray, nx, ny), cb = cross(rbx, rby, nx, ny);
  const w = 1 / e.A.m + ca * ca / e.A.I + 1 / e.B.m + cb * cb / e.B.I;
  const dl = C / (w + compH);
  e.A.x += nx * dl / e.A.m; e.A.y += ny * dl / e.A.m; e.A.a += ca * dl / e.A.I;
  e.B.x -= nx * dl / e.B.m; e.B.y -= ny * dl / e.B.m; e.B.a -= cb * dl / e.B.I;
  return -C;
}
function linkNormal(e) {
  const [rax, ray] = offset(e.A.a, e.ua, e.va);
  const [rbx, rby] = offset(e.B.a, e.ub, e.vb);
  const dx = (e.B.x + rbx) - (e.A.x + rax), dy = (e.B.y + rby) - (e.A.y + ray);
  const d = Math.hypot(dx, dy);
  return d < 1e-9 ? null : [dx / d, dy / d];
}

function dampRope(e, n, k) {
  const [nx, ny] = n;
  const [rax, ray] = offset(e.A.a, e.ua, e.va);
  const [rbx, rby] = offset(e.B.a, e.ub, e.vb);
  const vax = e.A.vx - e.A.w * ray, vay = e.A.vy + e.A.w * rax;
  const vbx = e.B.vx - e.B.w * rby, vby = e.B.vy + e.B.w * rbx;
  const vn = (vbx - vax) * nx + (vby - vay) * ny;
  const ca = cross(rax, ray, nx, ny), cb = cross(rbx, rby, nx, ny);
  const w = 1 / e.A.m + ca * ca / e.A.I + 1 / e.B.m + cb * cb / e.B.I;
  const P = vn * k / w;
  e.A.vx += nx * P / e.A.m; e.A.vy += ny * P / e.A.m; e.A.w += ca * P / e.A.I;
  e.B.vx -= nx * P / e.B.m; e.B.vy -= ny * P / e.B.m; e.B.w -= cb * P / e.B.I;
}

// Keep a turbine's centre and the pod's centre at least `min` apart.
function solveContact(A, ua, va, B, min) {
  const [rax, ray] = offset(A.a, ua, va);
  const dx = B.x - (A.x + rax), dy = B.y - (A.y + ray);
  const d = Math.hypot(dx, dy);
  if (d >= min || d < 1e-9) return;
  const nx = dx / d, ny = dy / d, C = min - d;
  const ca = cross(rax, ray, nx, ny);
  const w = 1 / A.m + ca * ca / A.I + 1 / B.m;
  const dl = C / w;
  A.x -= nx * dl / A.m; A.y -= ny * dl / A.m; A.a -= ca * dl / A.I;
  B.x += nx * dl / B.m; B.y += ny * dl / B.m;
}

// ── The world ─────────────────────────────────────────────────────────────────
//
// Once a frame, not per sub-step: at top speed a frame moves about 0.05 tiles and the smallest wall
// is a tile, so nothing tunnels. Every wall is a tile's face, so a body that ends the frame in
// something solid is put back along one axis, the one it crossed the face on: the frame's move is
// tried along x alone and along y alone. Across the face its way reverses at WALL_BOUNCE; along it
// the racer keeps going, less the scrape (WALL_GRIP of the knock), so a glancing touch skims the rock
// and only a square hit stops it. Putting the whole body back and reversing all of its way stopped a
// racer dead on a 15° touch at 180 mph. A body that fits neither way, into a corner or turned into
// the rock, still goes back to where it started the frame with its way reversed.
// The damage is quadratic in the excess of the speed into the face over freeMph, so scraping a wall
// is cheap and hitting one is not.
const WALL_BOUNCE = 0.2, WALL_GRIP = 0.3;
function collide(s, p, input, start) {
  if (typeof input.solid !== 'function') return;
  const mph = p.tileMph;
  const bodies = [...s.eng, s.pod];
  // Where each body is probed: a turbine's nose and centre, the pod's centre and nose.
  const probes = (b) => [[0, b === s.pod ? p.podHalfLen : p.engHalfLen], [0, 0]];
  const clear = (b, x, y, a) => probes(b).every(([u, v]) => { const [rx, ry] = offset(a, u, v); return !input.solid(x + rx, y + ry); });
  const pointVel = (b, v) => { const [rx, ry] = offset(b.a, 0, v); return [b.vx - b.w * ry, b.vy + b.w * rx]; };
  // Put b back out of the rock; returns the speed it hit with, in mph, across the face it hit.
  const bounce = (b) => {
    const [sx, sy, sa] = start[bodies.indexOf(b)];
    const [pvx, pvy] = pointVel(b, probes(b)[0][1]);
    // Which face: the axis whose move alone reaches the rock. Both alone clear is a corner taken
    // square-on, and the smaller move is the one across the face.
    let axis = null;
    for (const a of [b.a, sa]) {
      const xOk = clear(b, b.x, sy, a), yOk = clear(b, sx, b.y, a);
      if (xOk && yOk) axis = Math.abs(b.x - sx) < Math.abs(b.y - sy) ? 'x' : 'y';
      else if (xOk) axis = 'y';
      else if (yOk) axis = 'x';
      if (axis) { b.a = a; break; }
    }
    if (!axis) {
      [b.x, b.y, b.a] = start[bodies.indexOf(b)];
      b.vx *= -WALL_BOUNCE; b.vy *= -WALL_BOUNCE; b.w *= 0.3;
      return Math.hypot(pvx, pvy) * mph;
    }
    const into = axis === 'x' ? Math.sign(b.x - sx) : Math.sign(b.y - sy);
    if (axis === 'x') b.x = sx; else b.y = sy;
    const vn = axis === 'x' ? b.vx : b.vy;
    // Already on its way out (a cable pulled it back this frame): only the position is put right.
    if (vn * into <= 0) return 0;
    const knock = (1 + WALL_BOUNCE) * Math.abs(vn);
    const vt = axis === 'x' ? b.vy : b.vx;
    const vt2 = Math.sign(vt) * Math.max(0, Math.abs(vt) - WALL_GRIP * knock);
    if (axis === 'x') { b.vx = -WALL_BOUNCE * vn; b.vy = vt2; } else { b.vy = -WALL_BOUNCE * vn; b.vx = vt2; }
    b.w *= 0.5;
    return Math.abs(axis === 'x' ? pvx : pvy) * mph;
  };
  // Each turbine: its nose and its centre.
  for (let i = 0; i < 2; i++) {
    const { b } = engPoint(s, p, i);
    if (clear(b, b.x, b.y, b.a)) continue;
    const hit = bounce(b);
    const cost = Math.max(0, hit - p.freeMph);
    if (cost > 0) s.engHp[i] = clamp(s.engHp[i] - cost * cost * 0.00012 * (p.engK ?? 1), 0, 1);
    s.events.push({ type: 'hit', part: i ? 'right' : 'left', mph: Math.round(hit) });
    s.hitThisStep = Math.max(s.hitThisStep, hit);
    if (s.engHp[i] <= 0) s.events.push({ type: 'engineout', engine: i });
    // Docked, the pins take a knock that would tear a binder out; only a launched one tears.
    if (s.binder && s.mode === 'launched' && hit > p.binderMph) breakBinder(s, p);
  }
  const P = s.pod;
  if (!clear(P, P.x, P.y, P.a)) {
    const hit = bounce(P);
    const cost = Math.max(0, hit - p.freeMph);
    if (cost > 0) s.hull = clamp(s.hull - cost * cost * 0.00009 * (p.hullK ?? 1), 0, 1);
    s.events.push({ type: 'hit', part: 'pod', mph: Math.round(hit) });
    s.hitThisStep = Math.max(s.hitThisStep, hit);
    if (s.hull <= 0 && !s.wrecked) { s.wrecked = true; s.events.push('wrecked'); }
  }
}

// The binder tears out: the links go, and the turbines kick apart, each spinning outward.
export function breakBinder(s, p) {
  if (!s.binder) return;
  s.eng.forEach((b, i) => {
    const [ox, oy] = offset(b.a, (i ? 1 : -1), 0);
    b.vx += ox * 0.15; b.vy += oy * 0.15;
    b.w += i ? 2 : -2;
  });
  s.binder = false;
  s.lever[0] = s.lever[1] = 0;
  // The turbines cut out with it: the breakdown, not the end (plugins/podracer/seat.js breakdownRacer).
  s.running = false;
  s.events.push('binder');
}

// A racer that comes out of the shed with its binder already torn: the turbines lie a little apart
// and nothing lights. No kick and no event; it happened last time.
export function tornBinder(s, p) {
  s.binder = false;
  s.running = false;
  s.lever[0] = s.lever[1] = 0;
  s.eng.forEach((b, i) => {
    const [ox, oy] = offset(b.a, (i ? 1 : -1) * 0.03, 0);
    b.x += ox; b.y += oy; b.px = b.x; b.py = b.y;
  });
  sync(s, p);
}

// The yard welds a new binder in: the turbines go back to the span, ahead of the pod as it stands.
export function mendBinder(s, p) {
  s.mode = 'docked';
  placePodracer(s, p, s.pod.x, s.pod.y, s.pod.a * R2D);
  s.binder = true;
  s.binderStrain = 0;
}

// ── Reading it back ───────────────────────────────────────────────────────────

function sync(s, p) {
  const P = s.pod;
  s.x = P.x; s.y = P.y;
  s.heading = ((P.a * R2D) % 360 + 360) % 360;
  s.speed = Math.hypot(P.vx, P.vy) * p.tileMph;
}

// Every part's pose, for the renderer and the wire: turbine and pod centres and headings in tiles
// and degrees, and the two cables' ends.
export function podracerParts(s, p) {
  const pose = (b, u = 0, v = 0) => {
    const [rx, ry] = offset(b.a, u, v);
    return { x: b.x + rx, y: b.y + ry, h: ((b.a * R2D) % 360 + 360) % 360 };
  };
  const L = (() => { const e = engPoint(s, p, 0); return pose(e.b, e.u, e.v); })();
  const R = (() => { const e = engPoint(s, p, 1); return pose(e.b, e.u, e.v); })();
  const cables = [0, 1].map((i) => {
    const e = cableEnds(s, p, i);
    const a = pose(e.A, e.ua, e.va), b = pose(e.B, e.ub, e.vb);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return { a: [a.x, a.y], b: [b.x, b.y], ok: s.cable[i].ok, slack: Math.max(0, p.cableLen - d) / p.cableLen };
  });
  return { L, R, pod: pose(s.pod), cables, binder: s.binder };
}

// ── The picture ────────────────────────────────────────────────────────────────
//
// content/vehicle_models/mesh_podracer.json is authored at this many tiles per model unit (its
// `classFacts.contactSize`), with the pod's centre at the origin and the turbines laid out as
// placePodracer lays them out. So a turbine's offset from the pod in tiles, divided by this, is its
// offset in model units, and the drawn craft is the simulated one.
export const PODRACER_UNIT = 1 / 3;
// Heights in model units: turbine centres and the ring on the pod's nose the cables meet at.
export const PODRACER_ENG_H = 0.09, PODRACER_RING_H = 0.075;
// A type's scale against the Twinspool its mesh is cut from: [turbine length, turbine thickness, pod].
export const podracerScale = (p) => [p.engHalfLen / 0.09, p.engR / 0.035, p.podHalfLen / 0.07];
// A type's turbine-centre height, in model units.
export const podracerEngH = (p) => PODRACER_ENG_H * podracerScale(p)[1];
// Where each binder emitter ends, off a turbine's centre in model units (mesh_podracer.json
// 'binder emitter'): a little ahead, above, and BINDER_TIP_G in toward the other turbine. The arc
// jumps the gap between the two ends.
const BINDER_TIP_F = 0.06, BINDER_TIP_H = 0.12, BINDER_TIP_G = 0.094;

// Where each turbine's centre sits in the mesh, in model units [f, g].
export function podracerRest(p) {
  const f = (p.podHalfLen + p.cableLen * 0.97 + p.cableV) / PODRACER_UNIT;
  return { L: [f, -p.halfSpan / PODRACER_UNIT], R: [f, p.halfSpan / PODRACER_UNIT] };
}

// What the wire and the renderer carry: each turbine's offset from the pod in tiles and its heading,
// and the cables' state. From the sim's own state.
export function podracerPose(s, p) {
  const parts = podracerParts(s, p);
  const rel = (e) => ({ dx: +(e.x - parts.pod.x).toFixed(4), dy: +(e.y - parts.pod.y).toFixed(4), h: +e.h.toFixed(1) });
  return {
    L: rel(parts.L), R: rel(parts.R),
    cables: parts.cables.map((c) => c.ok), slack: parts.cables.map((c) => +c.slack.toFixed(3)),
    binder: s.binder, live: !!s.running, strain: +(s.binderStrain || 0).toFixed(3),
    docked: s.mode !== 'launched', power: +(s.binderPower || 0).toFixed(2),
    thr: +(((s.pedal[0] || 0) + (s.pedal[1] || 0)) / 2).toFixed(2), boost: !!s.boosting,
  };
}

// The same pose from a contact, which carries only the turbines' centre and heading.
export function podracerPoseFrom(ex, ey, eh, p, cables = [true, true], binder = true) {
  const a = eh * D2R, rx = Math.cos(a) * p.halfSpan, ry = Math.sin(a) * p.halfSpan;
  // Turbines this close in are docked alongside: no cables out and no arc to draw.
  const docked = Math.hypot(ex, ey) < p.podHalfLen + p.cableV + 0.05;
  return { L: { dx: ex - rx, dy: ey - ry, h: eh }, R: { dx: ex + rx, dy: ey + ry, h: eh }, cables, slack: [0, 0], binder, docked };
}

// Pose to model units, for a pod drawn at heading `podHdg`: each turbine as a function moving a rest
// point [f, g, h] to where it is now, and the two cable ends.
export function podracerModelPose(pose, podHdg, p) {
  const U = PODRACER_UNIT, a = podHdg * D2R, sa = Math.sin(a), ca = Math.cos(a);
  const rest = podracerRest(p);
  const mover = (k) => {
    const e = pose[k], c0 = rest[k];
    const f = (e.dx * sa - e.dy * ca) / U, g = (e.dx * ca + e.dy * sa) / U;
    const d = (e.h - podHdg) * D2R, cs = Math.cos(d), sn = Math.sin(d);
    return (v) => {
      const df = v[0] - c0[0], dg = v[1] - c0[1];
      return [f + df * cs - dg * sn, g + df * sn + dg * cs, v[2]];
    };
  };
  const L = mover('L'), R = mover('R');
  // The binder's two emitters stop short of the centreline; the arc between their tips is the
  // energy binder (drawPodracerArc in windshield.js).
  const [ls, rs, ps] = podracerScale(p), eh = PODRACER_ENG_H * rs;
  const tip = (k, mv) => mv([rest[k][0] + BINDER_TIP_F * ls, rest[k][1] + (k === 'L' ? 1 : -1) * BINDER_TIP_G * rs, BINDER_TIP_H * rs]);
  const att = (k, mv) => mv([rest[k][0] - p.cableV / U, (k === 'L' ? -1 : 1) * p.cableU / U, eh]);
  const ring = [p.podHalfLen / U, 0, PODRACER_RING_H * ps];
  return {
    L, R,
    // Each turbine's own centre, posed: a face measures which way is out from its own solid, never
    // from the pod, or a turbine docked beside the pod turned its inner side inside out (see-through).
    cen: { L: L([rest.L[0], rest.L[1], eh]), R: R([rest.R[0], rest.R[1], eh]) },
    binder: pose.binder !== false && !pose.docked ? { a: tip('L', L), b: tip('R', R), live: pose.live !== false, strain: pose.strain || 0, power: pose.power ?? 1, rgb: pose.arc || null } : null,
    docked: !!pose.docked,
    // The exhaust plumes (drawPodracerPlume in windshield.js): each turbine's nozzle and a point
    // straight aft of it, posed, and how hard it is burning.
    plume: pose.live !== false && (pose.thr || 0) > 0.02 ? {
      thr: pose.thr || 0, boost: !!pose.boost, rgb: pose.flame || null,
      ends: ['L', 'R'].map((k) => {
        // Off the nozzle, or off the afterburner can's lip with the kit's jet pipes (mesh 'kit:afterburner can').
        const mv = k === 'L' ? L : R, f0 = rest[k][0] - (pose.pipes ? 0.39 : 0.285) * ls;
        return { a: mv([f0, rest[k][1], eh]), b: mv([f0 - 0.4 * ls, rest[k][1], eh]), r: 0.04 * rs };
      }),
    } : null,
    cables: [
      { a: att('L', L), b: ring, ok: pose.cables?.[0] !== false, slack: pose.slack?.[0] || 0 },
      { a: att('R', R), b: ring, ok: pose.cables?.[1] !== false, slack: pose.slack?.[1] || 0 },
    ],
  };
}

// The tank, as a share of it, a lit racer burns over dt seconds: an idle draw and the rest with the
// spools. The seat and the text helm (plugins/podracer/texthelm.js) both burn through this, so the
// two rungs run dry at the same moment.
export function podracerBurn(s, p, dt) {
  if (!s.running) return 0;
  return (0.0005 + 0.0045 * (s.pedal[0] + s.pedal[1]) / 2) * (p.burn ?? 1) * dt;
}
