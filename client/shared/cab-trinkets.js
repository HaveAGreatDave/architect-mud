// WHAT A DRIVER PUTS IN THE CAB — the inside half of fittings.js.
//
// plugins/trucking/fittings.js dresses the OUTSIDE of a truck: a bull bar, a light bar, a mascot on
// the bonnet. All of it is for other people. This is the half nobody else ever sees — dice on the
// header, a nodding head on the dash, a skull where the horn button is — and it's the half you're
// actually looking at for twenty minutes at a stretch.
//
// FIVE RULES. The first two are why it costs almost nothing.
//
// 1. IT IS A LIST OF IDS. `trucks.custom_data.cab` — an array of short strings in a JSONB bag that
//    is already written on every bench commit. No table, no column, no tick. Everything that could
//    have been stored per-truck (where a thing hangs, how far it swings, what colour it is) is
//    derived from the catalog id and the cab's own geometry.
//
// 2. ⚠ AND NOTHING GOES ON THE WIRE, WHICH IS THE ONE REAL DIFFERENCE FROM THE OUTSIDE HALF.
//    A fitting rides `variant` as `^ab.cd` because every pilot within CONTACT_RANGE has to draw
//    your bull bar four times a second. Nobody is ever handed the inside of your cab: the only
//    renderer of it is `drawCabInterior`, in the seat, for the driver. So the ids ride the
//    truck_sim payload once at boarding and are never broadcast at all.
//
//    ⚠ WHICH IS ALSO WHY THIS IS A SEPARATE CATALOG AND A SEPARATE `custom_data` KEY RATHER THAN
//    FOUR MORE SLOTS ON `FITTINGS`. One catalog would mean `fitSuffix` filtering interior codes out
//    of the wire string — a filter that is right until somebody adds a slot and forgets, at which
//    point a pair of fuzzy dice is being broadcast to every aircraft in the basin, permanently, and
//    nothing anywhere would say so. Two catalogs make that unwriteable: `fitSuffix` reads `fits`
//    and this reads `cab`, and neither can see the other.
//
// 3. NOTHING HERE IS MECHANICAL. Not one of these touches a parameter, a roll, a price or a
//    capacity. Same rule fittings.js runs on and load-bearing for the same reason: the moment the
//    skull wheel steers better than the stock one, taste costs lap time and everybody converges on
//    one cab again.
//
// 4. ONE PER PLACE. Two bobbleheads is not a look, it's a bug, so putting something in an occupied
//    place replaces what was there.
//
// 5. YOU CAN TAKE IT DOWN AND IT'S STILL YOURS. Putting it back costs nothing. What you paid for is
//    owning it, not wearing it.

// ── The places ───────────────────────────────────────────────────────────────
// Three, and each is a different PHYSICS rather than a different position — see MOUNTS below. That
// is what makes a place worth having: a thing that hangs and a thing that stands don't move alike,
// and drawing both as a sticker is the version of this feature that isn't worth building.
export const CAB_SLOTS = [
  { id: 'hang',  label: 'Off the header', note: 'What swings when you take a bend.' },
  { id: 'dash',  label: 'On the dash',    note: 'What nods when you get on the brakes.' },
  { id: 'wheel', label: 'The wheel',      note: "What's under your hands all day." },
];

// ── How a thing moves ────────────────────────────────────────────────────────
// Two mounts, one integrator (`stepTrinket`). Both are a damped second-order system driven by the
// truck's own acceleration; what separates them is where the mass sits relative to the pivot.
//
//   swing  — a pendant on a string. Gravity restores it, so it settles along APPARENT gravity: it
//            hangs out at the full angle of the bend and stays there for as long as the bend does.
//            Slow, and it takes a while to give up afterwards.
//   bobble — a head on a spring. A stiff spring restores it, so a sustained corner only leans it a
//            fraction of what it leans the dice, and what you actually see is the OVERSHOOT on the
//            way in and the ring on the way out. Faster and barely damped, because a critically
//            damped bobblehead is a paperweight.
//
// ⚠ A SPRING DOES NOT RETURN TO UPRIGHT UNDER A SUSTAINED LOAD, and the first cut of this said it
// did. Held at a constant g both mounts settle somewhere off centre — that is what a restoring
// force is — so the difference is HOW FAR and HOW FAST, not whether. The gains are set so a
// bobblehead holds about a third of what a pendant holds in the same bend; collapse that and the
// two slots become one object with two skins.
//
// ⚠ BOTH DEFLECT AGAINST THE ACCELERATION, which is worth stating because the two look like they
// should differ. Inertia doesn't care which side of the pivot the mass is: accelerate right and
// both the pendant and the head go left. Getting this backwards reads as the cab being driven by
// somebody else.
export const MOUNTS = {
  swing:  { w: 5.2, zeta: 0.09, gain: 1.00, hold: true },
  bobble: { w: 11.5, zeta: 0.055, gain: 0.38, hold: false },
};

// ── The catalog ──────────────────────────────────────────────────────────────
// Priced on what it is, not on a ladder. A paper tree is forty credits because it's a paper tree,
// and the wheels cost real money because a wheel is a fabricated part somebody made. Nobody should
// be able to read this as a progression and feel they're meant to end up at the bottom of it.
//
// `mount` picks the physics. `mass` is a multiplier on the mount's frequency — heavy things swing
// slower, which is most of what tells a bone from a paper tree at a glance. `len` is how far below
// the header a pendant's bob sits, as a fraction of frame height, and `sway` how far it's allowed
// to go. `pal` is the colour set the drawer reads; nothing here is a canvas call.
export const TRINKETS = {
  // ── Off the header ──
  dice: {
    slot: 'hang', mount: 'swing', price: 120, name: 'Fuzzy Dice',
    desc: 'A pair on a cord, red, gone bald on the corners where they beat against the screen. The oldest thing anybody has ever hung in a truck.',
    mass: 1.00, len: 0.062, sway: 0.085,
    pal: { body: '#a8242a', pip: '#f2e6d8', cord: '#c9b48a', edge: '#6d1418' }, kind: 'dice',
  },
  tree: {
    slot: 'hang', mount: 'swing', price: 40, name: 'Paper Tree',
    desc: "Card, pine-shaped, printed green, on a loop of elastic. It stopped smelling of anything about four hundred miles ago and it's still up there.",
    mass: 0.55, len: 0.072, sway: 0.085,
    pal: { body: '#3f7a46', pip: '#8ec98f', cord: '#d8d2c2', edge: '#24512c' }, kind: 'tree',
  },
  beads: {
    slot: 'hang', mount: 'swing', price: 180, name: 'String of Beads',
    desc: 'Wooden beads on a knotted cord with a tassel on the end. Somebody counted their way down a long road on these, and it may not have been you.',
    mass: 1.30, len: 0.105, sway: 0.060,
    pal: { body: '#7a4a24', pip: '#c79a5e', cord: '#8a7a5a', edge: '#3a1f0f' }, kind: 'beads',
  },
  bones: {
    slot: 'hang', mount: 'swing', price: 260, name: 'Finger Bones',
    desc: "Three of them on a leather thong, drilled through and strung in order. They knock against each other on a bad surface and that's the reason they're up there.",
    mass: 1.45, len: 0.098, sway: 0.058,
    pal: { body: '#ddd2b8', pip: '#8c7f64', cord: '#5a4632', edge: '#9a8d72' }, kind: 'bones',
  },
  boots: {
    slot: 'hang', mount: 'swing', price: 150, name: 'A Pair of Boots',
    desc: "Child's boots, the size of a thumb, laced together and hung by the laces. Nobody asks about these twice.",
    mass: 1.15, len: 0.086, sway: 0.064,
    pal: { body: '#4a3526', pip: '#c2b291', cord: '#6d5c44', edge: '#241a12' }, kind: 'boots',
  },
  medal: {
    slot: 'hang', mount: 'swing', price: 340, name: 'Saint on a Chain',
    desc: "Stamped brass, worn smooth, on a chain that's been shortened twice. Whoever it is has their arms out and their face is gone.",
    mass: 0.90, len: 0.078, sway: 0.072,
    pal: { body: '#c8a24e', pip: '#f2dfa8', cord: '#9a8c6a', edge: '#6a5220' }, kind: 'medal',
  },

  // ── On the dash ──
  reaper: {
    slot: 'dash', mount: 'bobble', price: 340, name: 'Nodding Reaper',
    desc: 'A hooded figure the length of your hand, scythe over one shoulder, with a spring where its neck should be. It agrees with everything you do and it is keeping count.',
    mass: 1.15, h: 0.112,
    pal: { body: '#1b1b22', pip: '#ded3b8', cord: '#b8bcc4', edge: '#0c0c10' }, kind: 'reaper',
  },
  dog: {
    slot: 'dash', mount: 'bobble', price: 220, name: 'Nodding Dog',
    desc: 'Moulded, tan, sitting down, with a head that never stops agreeing. Somebody has drawn eyebrows on it in pen.',
    mass: 1.25, h: 0.086,
    pal: { body: '#b58a4e', pip: '#f0e2c8', cord: '#8a6a3a', edge: '#6a4a20' }, kind: 'dog',
  },
  hula: {
    slot: 'dash', mount: 'bobble', price: 300, name: 'Hula Figure',
    desc: "Green skirt, both arms up, hips on a separate spring from the head so the two of them disagree about every corner.",
    mass: 0.70, h: 0.110,
    pal: { body: '#2f7a5a', pip: '#e6c49c', cord: '#c2a878', edge: '#1a4a34' }, kind: 'hula',
  },
  skullbob: {
    slot: 'dash', mount: 'bobble', price: 380, name: 'Nodding Skull',
    desc: "A small bleached skull on a chromed spring, bolted through the dash top. It nods at everything you do and it is not encouraging.",
    mass: 1.35, h: 0.092,
    pal: { body: '#e0d6bd', pip: '#3a3228', cord: '#b8bcc4', edge: '#9a8f76' }, kind: 'skullbob',
  },

  // ── The wheel ──
  // A wheel dressing is a PALETTE plus a boss motif plus what the rim is made of, and it reaches
  // both wheel renderers (the raked geometry and the drawn fallback) through the same record —
  // see `wheelStyle`. The rim being a chain is a colour pattern on segments that already exist
  // rather than new geometry, which is the mechanism drawCabWheel3D already documents for its
  // twelve o'clock mark.
  skullwheel: {
    slot: 'wheel', price: 900, name: 'Skull Wheel',
    desc: "Chain welded round the rim, a pair of cast hands for spokes, and a skull looking back at you off the boss. It was somebody's whole winter.",
    rim: 'chain', boss: 'skull', spoke: 'bone', spokeShape: 'spear', bone: '#e8dfc6',
    pal: { rim: [188, 194, 202], rimAlt: [96, 102, 112], spoke: [222, 214, 194], boss: [176, 166, 140], cap: [228, 220, 198], grip: [120, 126, 136] },
  },
  chainwheel: {
    slot: 'wheel', price: 750, name: 'Chain Rim',
    desc: 'Drive chain wrapped and welded the whole way round. It is cold in the morning, it is hot by noon, and it is the only wheel that tells you where your hands are without looking.',
    rim: 'chain', boss: 'plain', spoke: 'steel',
    pal: { rim: [176, 182, 190], rimAlt: [84, 90, 100], spoke: [110, 116, 126], boss: [62, 68, 76], cap: [150, 156, 166], grip: [96, 102, 112] },
  },
  bonewheel: {
    slot: 'wheel', price: 820, name: 'Bone Rim',
    desc: "Bleached and lacquered, laid in short sections round the rim with the joins showing. It doesn't get cold, which is the reason it started and not the reason it stayed.",
    rim: 'segment', boss: 'skull', spoke: 'bone', spokeShape: 'spear', bone: '#f0e8d2',
    pal: { rim: [226, 218, 198], rimAlt: [186, 176, 152], spoke: [214, 206, 186], boss: [182, 172, 146], cap: [236, 228, 208], grip: [168, 158, 136] },
  },
  chromewheel: {
    slot: 'wheel', price: 600, name: 'Polished Chrome',
    desc: 'Plated and buffed until it throws the dash back at you. Show truck through and through, and impossible to look at with the sun over your shoulder.',
    rim: 'plain', boss: 'star', spoke: 'chrome',
    pal: { rim: [206, 214, 224], rimAlt: [150, 158, 170], spoke: [196, 204, 216], boss: [72, 78, 88], cap: [226, 232, 240], grip: [140, 148, 160] },
  },
  woodwheel: {
    slot: 'wheel', price: 700, name: 'Timber Rim',
    desc: 'Laminated hardwood over the steel, varnished, with the lacquer gone milky where two hands have sat on it for years.',
    rim: 'plain', boss: 'plain', spoke: 'chrome',
    pal: { rim: [138, 86, 44], rimAlt: [94, 56, 26], spoke: [188, 196, 208], boss: [66, 44, 24], cap: [206, 214, 224], grip: [84, 50, 24] },
  },
};

export const TRINKET_IDS = Object.keys(TRINKETS);

// ── Reading a truck ──────────────────────────────────────────────────────────
// Filtered against the catalog (a row naming something since retired wears nothing rather than
// crashing the renderer) and deduplicated by PLACE, first mention winning. The place filter is here
// rather than at the write because the write isn't the only way a row reaches this state: a
// hand-edited bag, an old row, or a trinket that changes place in a later build would all otherwise
// put two heads on one dash.
export function installedTrinkets(cd) {
  const raw = Array.isArray(cd?.cab) ? cd.cab : [];
  const seen = new Set(), out = [];
  for (const id of raw) {
    const t = TRINKETS[id];
    if (!t || seen.has(t.slot)) continue;
    seen.add(t.slot); out.push(id);
  }
  return out;
}

export const trinketIn = (cd, slot) =>
  installedTrinkets(cd).find((id) => TRINKETS[id].slot === slot) || null;

// The wheel dressing as one record, or null for the wheel the truck left the factory with. Both
// wheel renderers call this rather than reading `cab` themselves, so neither can be dressed while
// the other isn't — which is what stops the whole feature vanishing the day somebody flips
// `RENDER_TUNE.cabWheel3d`.
export function wheelStyle(cab) {
  const id = (Array.isArray(cab) ? cab : []).find((k) => TRINKETS[k]?.slot === 'wheel');
  return id ? { id, ...TRINKETS[id] } : null;
}

// Everything in a place, in catalog order, for the shelf.
export const trinketsIn = (slot) =>
  TRINKET_IDS.filter((id) => TRINKETS[id].slot === slot).map((id) => ({ id, ...TRINKETS[id] }));

// Owned once. Putting back something already in the drawer is free — rule 5 — so the price is only
// ever charged on an id that isn't in the bag.
export const ownsTrinket = (cd, id) =>
  Array.isArray(cd?.owned_cab) && cd.owned_cab.includes(id);
export function trinketPrice(cd, id) {
  const t = TRINKETS[id];
  if (!t) return null;
  return ownsTrinket(cd, id) ? 0 : t.price;
}

// ── The physics ──────────────────────────────────────────────────────────────
// One integrator, two mounts, and it lives here rather than in the renderer because the renderer is
// the one place it can't be checked: `drawCabInterior` needs a canvas, and this needs nothing at
// all. plugins/trucking/regress.js drives it headlessly.
//
// The state is `{ a, v }` per axis — angle and angular rate, in radians — and the step is the
// standard damped driven oscillator, integrated semi-implicitly so it stays stable at the long dt a
// dropped frame hands it.
//
// ⚠ IT IS SEMI-IMPLICIT (velocity first, then position) FOR A REASON THAT ONLY SHOWS UP ON A BAD
// FRAME. Explicit Euler on an oscillator gains energy every step, and at 60fps with zeta 0.055 the
// gain is small enough to hide behind the damping — so a bobblehead tuned on a good machine is
// correct, and on a machine dropping to 20fps it winds itself up until it's spinning. Swapping the
// two lines costs nothing and makes that unreachable.
export const trinketState = () => ({ x: { a: 0, v: 0 }, y: { a: 0, v: 0 } });

// ⚠ `dt` IS CLAMPED HERE RATHER THAN AT THE CALLER. A tab that was in the background hands back a
// dt of several seconds on its first frame, and an oscillator integrated across that in one step is
// a trinket that arrives somewhere absurd and then rings for a second and a half. Clamped, the worst
// a hidden tab costs is that the dice are where you left them.
export function stepTrinket(st, mount, mass, ax, ay, dt) {
  const m = MOUNTS[mount] || MOUNTS.swing;
  const h = Math.max(0, Math.min(0.05, dt || 0));
  if (!h) return st;
  const w = trinketFreq(mount, mass);
  // A pendant settles along apparent gravity and stays there for the length of the bend; a head on
  // a spring is always pulled back to upright and only ever gets knocked. That one boolean is the
  // whole behavioural difference between the two mounts.
  const eqx = m.hold ? -ax * m.gain : 0;
  const eqy = m.hold ? -ay * m.gain : 0;
  const kick = m.hold ? 0 : m.gain * w * w;
  const w2 = w * w, c = 2 * m.zeta * w;
  for (const [k, eq, drive] of [['x', eqx, ax], ['y', eqy, ay]]) {
    const s = st[k];
    s.v += (-w2 * (s.a - eq) - c * s.v - kick * drive) * h;
    s.a += s.v * h;
  }
  return st;
}

// What the drawer actually wants: the deflection, scaled by the item's own mass and clamped so a
// crash can never throw a pendant through the roof lining.
//
// ⚠ MASS SLOWS A THING DOWN, IT DOESN'T MOVE IT LESS. A heavy pendant hangs at the same angle as a
// light one — that's what a pendulum is — and what tells them apart is how long it takes to get
// there and how long it rings afterwards. So `mass` divides the FREQUENCY and the deflection is
// left alone; scaling the amplitude by it instead is the version that reads as the bones being
// glued down.
export const trinketFreq = (mount, mass) =>
  (MOUNTS[mount] || MOUNTS.swing).w / Math.max(0.35, mass || 1);
