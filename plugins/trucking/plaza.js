// THE LONG HAUL — the inspection plaza.
//
// THE SCALE HOUSE, BUT AS A PLACE ON THE ROAD RATHER THAN A FLAG ON A ROOM.
//
// `scale.js` is the law and it is not changing: a weighbridge detects WEIGHT, NOT CONTRABAND, and
// everything good about it falls out of that one sentence. What it never had was a BUILDING. It
// hung off `flags.weigh_station`, which is a zone flag, which means it could only ever exist on a
// tile the world had placed — so it fired exactly once in the game, at a city yard, as a paragraph
// that arrived while you were driving past a warehouse. The void highway, which is where the
// smuggling run actually happens, had no inspection on it at all.
//
// So this is the same two laws given somewhere to stand. It synthesises a real interchange out of
// the corridor's own geometry — a deceleration lane peeling off the tarmac, an apron running
// alongside it, a weighbridge deck built into that apron, a scanner arch over the deck, and a
// signal gantry over the highway telling you which of those two roads is yours. Four decisions
// carry it:
//
//  • THE APRON IS THE ROAD, PEELED. It starts ON the mainline (same centre, same half-width) and
//    walks out sideways, which is what a deceleration lane is and — the part that matters — makes
//    it 8-CONNECTED TO THE MAINLINE BY CONSTRUCTION. The paved set has to stay one connected piece
//    (see the ⚠ on the band width in corridor.js; regress flood-fills it), and an apron authored
//    as a separate band at a lateral offset would be a second island of tarmac that happened to
//    look joined at the ends. Start coincident and there is nothing to prove.
//
//  • THE LIGHT IS THE ORDER, AND IT IS READ MILES OUT. A station is OPEN or DARK for the week,
//    seeded, and it says so on a gantry over the road, on the radio, and in the log. That is the
//    whole reason the bypass can be a crime: the scale house's own design note says an inspection
//    you cannot see coming is a dice roll, and a dice roll is not a system. Blowing through a dark
//    plaza is nothing at all.
//
//  • RUNNING IT IS CHARGED WHEN YOU LEAVE, NOT AT A GORE POINT. The obvious rule — "past the nose
//    of the ramp on the mainline" — is a proximity test wearing a decision's clothes, and this road
//    is sampled at two wildly different rates (the cab reconciles 4×/sec, a text tick covers a slab
//    of road). So the plaza is ARMED when the odometer enters its footprint and SETTLED when the
//    odometer leaves it, which is one question at both rates. It also gets turning round for free:
//    leaving by the end you came in is not running anything.
//
//  • NOTHING HERE IS PERSISTED. A plaza is a function of (route, window) exactly as a sign is, so
//    it costs no rows, no tick and no teardown; and the impound it can hand you deliberately does
//    NOT park your truck at the plaza, because a transient void room is torn down with the crossing
//    and a rig held in one would be a row pointing at nothing. It is held at its own yard instead.

import { sendToPlayer } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { milesOf, pavedAt, corridorPos, SHOULDER_W } from './corridor.js';
import { weighAt, cabCheckAt, chargeAt } from './scale.js';

// ── THE SHAPE OF ONE ─────────────────────────────────────────────────────────
// Sized for the PICTURE and for the CLOCK, not for a mile count. A truck covers about 0.8 tiles a
// second at cruise and the shortest road in the network is about 95 tiles, so a plaza is ~20
// seconds of road: long enough to see it, decide, pull in, be dealt with and pull out, and short
// enough that it is an event on the haul rather than a third of it.
export const RUN_IN = 5;          // the deceleration lane — tiles the apron takes to leave the road
export const PAD = 6;             // the flat apron, which is what the deck and the arch stand on
export const RUN_OUT = 5;         // the acceleration lane back on
export const PLAZA_LEN = RUN_IN + PAD + RUN_OUT;
// How far out the apron runs, and how wide it is. 4.4 clears the shoulder (which ends at 2.15) with
// about a tile of gore island between the two roads — enough for the island to READ as one rather
// than as the two bands touching. The apron is wider than the mainline is: it holds a scale lane
// and a lane to get round a rig that is being taken apart.
export const APRON_T = 4.4;
export const APRON_W = 1.1;
// The whole footprint, laterally. Everything from the shoulder's edge out to here belongs to the
// plaza and nothing else may place inside it — which is how the gore island stays an island rather
// than sprouting the roadside shed or the sign post whose milepost happens to land here.
const PLAZA_R = 8.2;
// The deck: a sub-range of the apron you have to be STOPPED on. Short, because a weighbridge is a
// plate rather than a stretch of road, and because "stop on it" has to be a thing you can do on
// purpose at speed.
const DECK_U0 = RUN_IN + 1.6, DECK_U1 = RUN_IN + 3.4;
// Stopped enough to be weighed. Not zero: the cab streams a live sim and a rig with the brake on
// still reports a fraction of a mile an hour, and a plate that would not read a truck sitting on it
// is a plate nobody can use.
const STOPPED_MPH = 3;
// How far out the first call goes. Read on the radio, so it is over the horizon on purpose — the
// same argument passHitcher makes for its own far call.
const CALL_TILES = 26;

// Names. The same shape as the roadside table in corridor.js: a small fixed list, seeded, so a
// plaza is in the same place with the same name for everybody all week and two drivers can talk
// about it.
const PLAZA_NAMES = ['Harrow Creek', 'Ninemile', 'Cold Fork', 'Saltpan', 'Dry Wells', 'Kettle Bend'];

// Seeded, cheap, and deliberately the same hash shape corridor.js uses so a plaza and the road it
// stands on cannot disagree about which week it is.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── WHERE THE STATIONS ARE ───────────────────────────────────────────────────
//
// Worked out once, from the FINISHED road, for the same reason the boards are (see attachSigns): a
// station placed against a segment's own length is in the wrong place the moment that segment
// becomes the middle of something longer.
//
// ⚠ ONE PER ROAD, AND ONLY ON A ROAD LONG ENOUGH TO HAVE ONE. Two inspections on a two-minute haul
// is a toll booth, not a highway; and a plaza whose footprint does not fit between the ramps at
// either end would have its apron peeling off a road that is still narrowing.
//
// ⚠ AND IT IS KEPT CLEAR OF THE BOARDS. A sign post stands at t = SIGN_OFF (3.4), which is inside
// this apron, and the plaza answers first — so a board landing in the footprint would simply cease
// to exist, silently, on whichever road happened to roll that way.
export function plazasFor(route) {
  if (!route) return [];
  const L = route.L || 0;
  const head = 34, tail = 34;                       // clear of both ramp ends, with room to spare
  if (L < head + tail + PLAZA_LEN) return [];
  const rng = mulberry32(hashSeed(`${route.voidKey}|${route.destKey}|${route.window}|plaza`));
  // Placed in the middle half of the road: far enough in that you are committed, far enough from
  // the far end that being turned back still means something.
  const span = L - head - tail - PLAZA_LEN;
  let s0 = Math.round(head + rng() * span);
  // Shove it clear of any board. A whole PLAZA_LEN of clearance either side, because the footprint
  // is what swallows the post rather than the start of it.
  for (const g of route.signs || []) {
    if (g.s > s0 - PLAZA_LEN && g.s < s0 + PLAZA_LEN * 2) s0 = Math.round(g.s + PLAZA_LEN * 1.4);
  }
  if (s0 + PLAZA_LEN > L - tail) return [];
  const name = PLAZA_NAMES[Math.floor(rng() * PLAZA_NAMES.length) % PLAZA_NAMES.length];
  // OPEN OR DARK, FOR THE WEEK. Two in three, which is enough that a driver plans around it being
  // open and enough that finding one dark is luck rather than a rule.
  //
  // ⚠ SEEDED, NEVER ROLLED PER DRIVER. Everybody on this road this week meets the same station in
  // the same state — which is what lets the radio call, the gantry and the board all be telling the
  // truth, and what stops "was it open for you?" being a question with two answers.
  const open = rng() < 0.67;
  const plaza = { s0, s1: s0 + PLAZA_LEN, name: `${name} Inspection`, open, key: `${route.destKey}|${s0}` };

  // ── ⚠ EVERY STRUCTURE IS SNAPPED TO ITS OWN TILE, HERE, ONCE ────────────────
  // The boards learned this the hard way and the note on `signsFor` says it plainly: a post matched
  // on a tolerance band in `corridorAt` comes out as three or four identical posts in a row, which
  // reads as a mistake rather than as a sign. It is worse for a gantry, because a gantry SPANS the
  // road — the carriageway is nearly two tiles across, so a band test put four of them inside each
  // other at the same milepost, and the arch and the office came out in threes.
  //
  // A band is right for the things that genuinely ARE a band (the tarmac, the ramp studs) and wrong
  // for every single structure. So the structures are resolved to integer tiles at build time and
  // matched by equality, which also survives a bend — where a row of tiles at a fixed lateral offset
  // is a diagonal and rounding lands on none of them for stretches at a time.
  const tileAt = (u, t) => { const q = corridorPos(route, s0 + u, t); return [Math.round(q.x), Math.round(q.y)]; };
  plaza.t = {
    sig0: tileAt(0.6, 0),                                  // the gantry you meet coming in
    sig1: tileAt(PLAZA_LEN - 0.6, 0),                      // …and the one facing the other way
    arch: tileAt(DECK_U0 - 0.9, APRON_T),                  // the scanner, on the apron, ahead of the plates
    deck: tileAt((DECK_U0 + DECK_U1) / 2, APRON_T),        // the plates themselves
    booth: tileAt(DECK_U1 + 0.6, APRON_T + APRON_W + 1.6), // the office, across the apron from the road
  };
  // ⚠ TWO STRUCTURES THAT ROUND ONTO ONE TILE IS A STRUCTURE THAT DOES NOT EXIST, silently: a tile
  // carries one mark, so the later test simply never fires and the arch is missing from that road
  // for the week. On a tight bend the arch and the plates are close enough for it to happen, so the
  // arch backs off along the ramp rather than the two of them sharing.
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  if (same(plaza.t.arch, plaza.t.deck)) plaza.t.arch = tileAt(DECK_U0 - 2.0, APRON_T);
  return [plaza];
}

export function attachPlazas(route, dests) {
  if (route) route.plazas = dests?.length ? plazasFor(route) : [];
  return route;
}

// The plaza whose footprint covers this odometer reading, or null. Called per tile of a ~73×73
// window and four times a second on the drive path, so it is a scan of a one-element array and two
// comparisons — never anything that allocates.
export function plazaOn(route, s) {
  const list = route?.plazas;
  if (!list?.length) return null;
  for (const p of list) if (s >= p.s0 && s <= p.s1) return p;
  return null;
}

// ── THE APRON, AS A FUNCTION OF HOW FAR THROUGH YOU ARE ───────────────────────
//
// `u` is tiles into the plaza. Returns the apron's own centreline offset and half-width there, or
// null outside it. At u = 0 it IS the mainline — same centre, same width — which is the whole of
// why the paved set stays connected; it then walks out, holds, and walks back.
//
// ⚠ SMOOTHSTEP RATHER THAN A STRAIGHT TAPER. A linear ramp puts a corner at each end of the
// transition, and a corner in a band that is being rasterised to tiles is a step: the apron gains a
// tile of width in one tile of length and the edge comes out notched. The cubic has zero slope at
// both ends, so the join is invisible at every heading the road can run at.
export function apronAt(route, plaza, u, s) {
  if (u < 0 || u > PLAZA_LEN) return null;
  const road = pavedAt(route, s);
  const k = u <= RUN_IN ? u / RUN_IN
    : u >= PLAZA_LEN - RUN_OUT ? (PLAZA_LEN - u) / RUN_OUT
      : 1;
  const e = k * k * (3 - 2 * k);                     // smoothstep
  return { c: APRON_T * e, w: road + (APRON_W - road) * e, e };
}

// ── WHAT A TILE INSIDE THE FOOTPRINT IS ──────────────────────────────────────
//
// Called from `corridorAt` AFTER the mainline and its shoulder have had their say and BEFORE
// anything else places — so the highway is untouched and nothing else can build inside the plaza.
//
// ⚠ THE PLAZA IS ON ONE SIDE. Right-hand traffic exits right, and an apron on both sides would be
// two stations pretending to be one. `t` is signed, so this is a single comparison, and the far
// verge goes on being the far verge.
export function plazaCell(route, plaza, s, t, x, y, ctx) {
  const u = s - plaza.s0;
  const ap = apronAt(route, plaza, u, s);
  if (!ap) return null;
  const road = pavedAt(route, s);
  // Still the highway or its shoulder: not ours. The apron's own first and last tiles fall inside
  // that band by construction — it starts coincident with the road — so this is also what stops the
  // taper laying a second set of lane markings down the middle of the carriageway.
  if (Math.abs(t) <= road + SHOULDER_W) return null;
  if (t < 0 || t > PLAZA_R) return null;
  const T = plaza.t || {};
  const is = (k) => T[k] && T[k][0] === x && T[k][1] === y;
  const far = Math.abs(t - ap.c);
  const base = { terrain: ctx.terrain, corridor_s: s, corridor_node: ctx.node };
  // Carried by every drawn piece, so the client can light the whole interchange as one place and
  // run a chase along it without knowing any of the geometry above. `u` is how far through the
  // footprint this tile sits, which is all a chase needs; `deg` is the road's own heading, which a
  // gantry needs because it stands ACROSS the road and half these tiles are not carriageway and so
  // carry no `road_deg` of their own.
  const plz = { name: plaza.name, open: plaza.open ? 1 : 0, u: +(u / PLAZA_LEN).toFixed(3), deg: ctx.deg };
  const cell = (name, flags) => ({ id: ctx.id, name, danger: ctx.danger, flags });

  if (far <= ap.w) {
    // THE APRON. It is a road, so it ships the same three fields every other piece of carriageway
    // ships — its own centreline offset, its own half-width and the heading — and the renderer then
    // paints markings on the APRON's centreline. Without `road_t` measured against the apron, every
    // tile of it would lay its paint down on the highway a few tiles away, which is the exact bug
    // the multi-tile band note in corridor.js exists about.
    //
    // ⚠ THE STUDS ARE THE ONE THING HERE THAT IS STILL A BAND, and rightly: ramp lighting IS a row
    // of lamps down each edge, so it is per tile by nature and the outer band is where it belongs.
    // An inner apron tile gets no mark at all, which keeps most of the footprint free.
    const k = is('deck') ? 'deck' : is('arch') ? 'arch' : far > ap.w - 0.7 ? 'lead' : 'apron';
    return cell(k === 'deck' ? `${plaza.name} — the plates` : plaza.name, {
      ...base,
      terrain: 'road', icon: ctx.icon, road_dirt: 1, road_wear: 1,
      road_deg: ctx.deg, road_t: +(t - ap.c).toFixed(3), road_w: +ap.w.toFixed(3), road_lanes: 2,
      scale_plaza: { ...plz, k },
    });
  }
  // THE OFFICE, across the apron from the road, looking at the plates.
  //
  // ⚠ NO `scale_plaza` ON THIS TILE, and that is load-bearing rather than an omission. A cell
  // carrying a building type AND a mark is drawn as the MARK and never extrudes (see MASS_EXCEPT
  // and `massTile` in windshield.js) — right for a depot bay, which is a shed you drive into, and
  // here it would quietly delete the office's walls and leave a lit sign standing in open ground.
  // The office is an ordinary building; the light on this apron comes off the arch and the plates.
  if (is('booth')) {
    return cell(`${plaza.name} — the office`, { ...base, building_type: 'garage',
      building_name: plaza.name, floors: 1, entrance: ctx.entrance });
  }
  // Everything else in the footprint is the gore island and the apron's outer verge: the plaza's
  // own ground, deliberately empty and deliberately OWNED — this is the return that stops a
  // roadside shed, a wreck or a sign post placing in the middle of an interchange.
  return cell(plaza.name, { ...base, scale_plaza: { ...plz, k: 'apron' } });
}

// ── THE GANTRY OVER THE HIGHWAY ──────────────────────────────────────────────
//
// The one part of a plaza that is on the road you are already driving, and the only part that has
// to be legible at the distance a decision is made from. Merged onto the mainline cell rather than
// placed beside it, because a signal that is not over your lane is a signal about somebody else.
//
// One at each end of the footprint, so it reads the same driving either way — the same problem the
// boards solved by authoring both faces, answered here by there being two gantries, because unlike
// a board this one is a thing you drive under.
export function plazaRoadFlags(plaza, x, y, deg) {
  const T = plaza.t;
  if (!T) return null;
  const end = T.sig0[0] === x && T.sig0[1] === y ? 0
    : T.sig1[0] === x && T.sig1[1] === y ? 1 : -1;
  if (end < 0) return null;
  return { scale_plaza: { name: plaza.name, open: plaza.open ? 1 : 0, u: end, deg, k: 'signal' } };
}

// ── THE LAW ──────────────────────────────────────────────────────────────────
//
// ⚠ CHARGED ON THE WAY OUT, ARMED ON THE WAY IN, AND NEITHER IS A PROXIMITY TEST. See the header.
// `rig._plaza` holds the arming: which station, and which END of it you came in by. Leaving by the
// end you entered is turning round, which is not an offence and which a driver out here is entitled
// to do (the odometer has not been monotonic since reverse shipped).
//
// RAM only, on the rig, like every other thing about a crossing — the road itself stops existing
// when the window rolls.
const RUN_CRIME = 'running_an_inspection';

// ── THE DECISION, WITH NOTHING ATTACHED TO IT ────────────────────────────────
//
// Did this driver run the station? Four facts answer it and none of them is a side effect: whether
// the plaza was lit, whether they went over the plates, which end they came in by, and which end
// they are leaving by. Split out because a law whose only expression is "and then a crime was
// charged" can be checked exactly one way — by charging a real crime against a real player — and a
// regression suite that has to raise somebody's wanted level to ask a question will eventually be
// the reason a different suite goes red.
//
// `entry` is the arming record: `{ from, weighed }`.
export function plazaVerdict(plaza, entry, s) {
  if (!plaza || !entry) return 'clear';
  if (!plaza.open) return 'clear';                     // a dark station is not asking for anything
  if (entry.weighed) return 'clear';                   // you stopped on the plates
  // Out by the end you came in: you turned round, which is not running anything, and which a driver
  // out here is entitled to do — the odometer has not been monotonic since reverse shipped.
  return (s <= plaza.s0 ? 0 : 1) === entry.from ? 'clear' : 'ran';
}

// Returns what just happened — 'called', 'armed', 'clear', 'ran', or null. Every caller ignores it;
// it is there so the state machine can be read back by a test without anything being charged.
export function passPlaza(player, rig) {
  if (!rig || rig.leg !== 'corridor' || !rig.route) return null;
  const from = Number.isFinite(rig._plazaAt) ? rig._plazaAt : rig.s;
  rig._plazaAt = rig.s;
  const here = plazaOn(rig.route, rig.s);
  const was = rig._plaza;

  // ── THE CALL, MILES OUT ────────────────────────────────────────────────────
  // Swept, so both rungs cross the mark exactly once at their own sample rate. It is the radio's,
  // for the same reason the far hitcher call is: nothing SEES a gantry at nine miles.
  let ev = null;
  if (!here) {
    for (const p of rig.route.plazas || []) {
      const d = p.s0 - rig.s, dPrev = p.s0 - from;
      const inbound = d > 0 && dPrev > 0 && d <= CALL_TILES && dPrev > CALL_TILES;
      const back = d < 0 && dPrev < 0 && -(p.s1 - rig.s) <= CALL_TILES && -(p.s1 - from) > CALL_TILES;
      if (!inbound && !back) continue;
      sendToPlayer(player.id, { type: 'emote', message: p.open
        ? `<span class="text-dim">The radio picks up a carrier tone and a flat synthetic voice underneath it, repeating on a loop:</span> <span class="text-amber">"${p.name} is <b>OPEN</b>. All rigs exit. ${milesOf(Math.abs(d))} miles."</span>`
        : `<span class="text-dim">A carrier tone comes up and goes away again — ${p.name}, ${milesOf(Math.abs(d))} miles up, telling nobody in particular that it's <b>closed</b>. You'll be driving straight past that one.</span>` });
      ev = 'called';
    }
  }

  // ── ARMING ─────────────────────────────────────────────────────────────────
  if (here && was?.key !== here.key) {
    rig._plaza = { key: here.key, from: rig.s <= (here.s0 + here.s1) / 2 ? 0 : 1, weighed: false };
    if (here.open) {
      sendToPlayer(player.id, { type: 'emote', message:
        `<span class="text-amber">A gantry comes over the road with its whole span lit, and the words on it are not a suggestion: <b>ALL RIGS EXIT</b>.</span>\n`
        + `<span class="text-dim">The ramp lights run away to your right, one after another, toward a lit plate and an arch standing over it. `
        + `Pull onto the apron and stop on the plates — or don't, and find out what the thing on the gantry does about it.</span>` });
    } else {
      sendToPlayer(player.id, { type: 'emote', message:
        `<span class="text-dim">${here.name} goes by on the right with its ramp dark and its arch cold. The gantry over the road says <b>BYPASS</b> in green and means it. Nobody's working tonight.</span>` });
    }
    return 'armed';
  }

  // ── SETTLING ───────────────────────────────────────────────────────────────
  if (!here && was) {
    rig._plaza = null;
    const p = (rig.route.plazas || []).find((q) => q.key === was.key);
    const verdict = plazaVerdict(p, was, rig.s);
    if (verdict === 'ran') runIt(player, rig, p);
    return verdict;
  }
  return ev;
}

// ── BLOWING THROUGH A LIT PLAZA ──────────────────────────────────────────────
//
// ⚠ IT CANNOT GO THROUGH `CHARGE_CRIME`, AND THAT IS NOT A SHORTCUT BEING TAKEN — IT IS THE VOID'S
// OWN RULE HOLDING. `raiseCrime` opens with "no law in the wastes": a zone carrying `flags.lawless`
// charges nothing, and it says in its own comment that this is true "even a forced one". Every room
// on this road is one — voidwalking stamps `lawless: true` on every corridor node it registers,
// deliberately, because dying out here clone-vats you rather than jailing you. So a plaza routed
// through the ordinary crime path would have looked correct at every call site, dispatched, been
// swallowed on the first line, and charged NOTHING, for ever, with no error anywhere. The verb
// would work, the gantry would light, the prose would print, and the one mechanic the whole
// building exists for would silently not exist.
//
// `chargeAt` (scale.js) is the one funnel all four of these charges go through, and out here it
// spends the tariff through `WANTED_RAISE` — the seam documented as "let another system put heat on
// a player without importing surveillance internals", which is how jail charges a jailbreak. It
// skips the witness roll on purpose, and skipping it is CORRECT here rather than convenient — the
// witness machinery asks whether a camera or an officer happened to see you, and out here the
// answer is neither, for ever. The plaza is not a crime somebody reported. It is an automated
// station, pointed at the road, whose entire function is to read a plate and say so on a wire; it
// is the apparatus, so there is nothing for a witness roll to decide.
//
// ⚠ THE NUMBER IS STILL THE CRIME REGISTRY'S. `running_an_inspection` stays in `CRIME_DEFAULTS` and
// is still what the dev panel's Crime tab tunes — this reads the tariff rather than holding a
// second copy of it, so the star value is authored in exactly one place whichever path spends it.
async function runIt(player, rig, plaza) {
  sendToPlayer(player.id, { type: 'emote', message:
    `<span class="text-red">You hold your lane and the ramp goes by on the right.</span>\n\n`
    + `The arch behind you lights up its whole length at once — not a flash, a steady white that stays on — and something under the gantry turns to keep you in it as you go. There is no siren. Nothing comes out of the office. A plate somewhere has your number on it and that was the entire transaction.\n\n`
    + `<span class="text-dim">${plaza.name}. There is one road out here, and they know which way you are pointing.</span>` });
  await chargeAt(player, true, RUN_CRIME, `running the inspection at ${plaza.name}`);
}

// ── STOPPING ON THE PLATES ───────────────────────────────────────────────────
//
// The physical act, on the cab rung: be on the deck, and be stopped. Checked on the drive tick
// beside everything else that is about where the wheels are.
//
// ⚠ IT RUNS THE SAME TWO LAWS THE SCALE HOUSE RUNS, BY CALLING THEM. `weighAt` and `cabCheckAt` are
// scale.js's own functions with the zone lookup lifted out of them — one weighbridge, one cab
// check, two places they can happen. A plaza with its own copy of either would be a second law
// nobody would notice drifting.
export async function tryDeck(player, rig) {
  if (!rig || rig.leg !== 'corridor' || !rig.route) return false;
  const p = plazaOn(rig.route, rig.s);
  if (!p?.open) return false;
  const st = rig._plaza;
  if (!st || st.weighed) return false;
  const u = rig.s - p.s0;
  if (u < DECK_U0 || u > DECK_U1) return false;
  const ap = apronAt(rig.route, p, u, rig.s);
  if (!ap || Math.abs((rig.t || 0) - ap.c) > ap.w) return false;
  if ((rig.speed || 0) > STOPPED_MPH) return false;
  return weighHere(player, rig, p);
}

// Everything that happens once the truck is standing on the plate, in the order it happens in.
// Shared by the cab (which got here by stopping) and the text rung (which got here by saying so),
// because the alternative is two stations that inspect you differently.
export async function weighHere(player, rig, plaza) {
  // ⚠ ARM IT IF IT IS NOT ARMED, rather than only stamping an existing record. The arming happens
  // in passPlaza on the frame the odometer enters the footprint, which is almost always first — but
  // "almost always" is the wrong standard here, because a lost `weighed` flag charges four stars to
  // a driver who DID stop on the plates, which is the worst failure this feature has available. The
  // entry side is taken from where the rig is now: you are inside, so the near end is the one you
  // came in by.
  const st = rig._plaza || (rig._plaza = { key: plaza.key, from: rig.s <= (plaza.s0 + plaza.s1) / 2 ? 0 : 1, weighed: false });
  st.weighed = true;
  const cfg = { name: plaza.name, plaza: true };
  sendToPlayer(player.id, { type: 'emote', message:
    `<span class="ambient">You bring it over the joint in the tarmac and the plate takes the weight with a sound you feel through the seat. Ahead, the arch wakes up: a curtain of pale light drops the width of the apron and holds there, waiting for you to be entirely inside it.</span>` });
  // THE ARCH — the contraband half, and the reason this is not just the weighbridge outdoors.
  //
  // ⚠ IT IS NOT THE SCALE AND IT MUST NEVER BE FOLDED INTO IT. The weighbridge compares your
  // trailer against your paper and does not know what the difference IS; teaching it to recognise
  // goods collapses "weight, not contraband" into a generic scanner, which is the thing the scale
  // house was designed not to be. So the arch is a separate law at the same gate — the same shape
  // as the cab check already sitting beside it — and it is the CHECKPOINT plugin's law, asked for
  // by name rather than imported, exactly as the yard gate asks smuggle for a drug scan.
  // ⚠ ITS OWN CHARGE IS SWALLOWED OUT HERE, so the plaza spends the tariff itself. The checkpoint
  // plugin charges `contraband_possession` inside the check, which is correct at a city gate and a
  // no-op on a lawless road — the same trap as `runIt`, one layer out, and worth naming because the
  // scan would otherwise detect perfectly, shrill, apprehend, and cost nothing. It is not a double
  // charge: the branch below only runs where the one inside the check cannot.
  const scan = await dispatchAction({ type: 'CONTRABAND_SCAN', actor: player,
    params: { guards: 'the plaza officers', where: plaza.name } }).catch(() => null);
  if (scan?.caught) await chargeAt(player, true, 'contraband_possession', `contraband found at ${plaza.name}`);
  // THE CAB, then the box. Same order the scale house runs them in, and for the same reason: the
  // officer opening the passenger door has nothing to do with what the plate says.
  await cabCheckAt(player, rig, cfg);
  return weighAt(player, rig, cfg);
}

// Is this rig standing in a plaza right now, and which one — for the `weigh` verb and for anything
// that wants to say where you are. Sync and free.
export function plazaHere(rig) {
  if (!rig || rig.leg !== 'corridor' || !rig.route) return null;
  return plazaOn(rig.route, rig.s);
}

export const _test = { PLAZA_R, DECK_U0, DECK_U1, STOPPED_MPH, CALL_TILES, RUN_CRIME, PLAZA_NAMES, apronAt };
