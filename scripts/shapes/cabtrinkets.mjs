// cabtrinkets — what a driver put in the cab actually reaches the canvas.
//
//   node scripts/shapes/cabtrinkets.mjs
//   node scripts/shapes/cabtrinkets.mjs --detail      # the per-item op counts
//
// ⚠ THE FAILURE THIS EXISTS FOR IS SILENT IN EVERY OTHER WAY. `client/shared/cab-trinkets.js` is a
// shelf a player spends credits at, and the renderer switches on `kind` for the two mounted places
// and on `rim`/`boss` for the wheel. A catalogue row whose kind no branch matches takes the money,
// saves the id, renders the cab, and draws NOTHING — no error, no warning, and the only person who
// can find out is the one who paid. Exactly the roaster bug `shapes:smoke` was built for, on a
// surface that now has a till attached to it.
//
// ⚠ AND `shapes:smoke` CANNOT ANSWER IT. That one proves a painter RUNS; a branch that falls through
// to `default` and draws a lozenge runs perfectly. The question here is whether the canvas got more
// than it got without the thing fitted, which needs a context that counts.
//
// ⚠ THE PHYSICS IS NOT TESTED HERE. It needs no canvas at all, so it lives where it can be checked
// properly — `plugins/trucking/regress.js` §4c drives the integrator directly. This file is only
// ever about whether ink lands.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { TRINKETS, TRINKET_IDS, CAB_SLOTS } from '../../client/shared/cab-trinkets.js';

const DETAIL = process.argv.includes('--detail');
const W = 640, H = 360;
let fails = 0, checks = 0;
const check = (name, ok, note) => {
  checks++;
  if (!ok) { fails++; console.log(`  ✗ ${name}${note ? ' — ' + note : ''}`); }
  else if (DETAIL) console.log(`  ✓ ${name}${note ? ' — ' + note : ''}`);
};

// ── A CONTEXT THAT COUNTS ────────────────────────────────────────────────────
// The same permissive proxy dom-stub hands out, with a tally on it. Only the calls that put ink
// down are counted: `save`, `translate` and friends move the pen and a painter that only ever did
// those has drawn nothing.
//
// ⚠ IT COUNTS `fill`/`stroke`/`fillRect`/`fillText`, NOT PATH BUILDING. `beginPath`+`arc`+`fill` is
// one mark and three calls, and a tally that counted all three would rank a painter by how it
// happens to be written rather than by what it put on screen.
//
// ⚠ AND THE SIGNATURE CARRIES THE COLOUR, WHICH THE COUNT CANNOT. A wheel dressing is mostly a
// PALETTE — the same faces in different colours — so a bone rim and a chain rim issue the identical
// sequence of calls and a trace of op names reports them as the same picture. Recording the fill
// and stroke style in force at each mark is what tells a bone wheel from a chrome one, and it is
// also a better test for the two mounted places: a `kind` falling through to the drawer's `default`
// would otherwise pass by being a different SHAPE of nothing.
//
// ⚠ AND A GRADIENT HAS TO RECORD ITS STOPS, OR A WHOLE SHELF IS INVISIBLE. dom-stub hands back one
// shared do-nothing gradient, so every fill through one reads as the same mark whatever colour it
// is — and the drawn wheel's rim and boss are BOTH radial gradients, which is where a wheel
// dressing's entire palette lands on that renderer. A timber rim and a stock one came out
// byte-identical to this harness for that reason alone: the fifth false positive, and the only one
// that was hiding a shelf rather than a row.
const INK = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage', 'putImageData']);
const styleOf = (v) => (typeof v === 'string' ? v : v && v.stops ? 'grad[' + v.stops.join(',') + ']' : '~');
function countingCtx(tally) {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: W, height: H };
      if (k === 'measureText') return (txt) => ({ width: String(txt ?? '').length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') {
        return () => { const g = { stops: [], addColorStop(o, c) { this.stops.push(o + '@' + c); } }; return g; };
      }
      if (k === 'createPattern') return () => null;
      if (k === 'getImageData' || k === 'createImageData') return (...a) => {
        const [w, h] = a.length >= 4 ? [a[2], a[3]] : [a[0], a[1]];
        const w2 = Math.max(1, w | 0), h2 = Math.max(1, h | 0);
        return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 };
      };
      if (INK.has(k)) return (...a) => {
        tally.n++;
        const st = k.startsWith('stroke') || k === 'stroke' ? t.strokeStyle : t.fillStyle;
        tally.log.push(k + ':' + a.length + ':' + styleOf(st));
        tally.shape.push(k + ':' + a.length);
      };
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const ws = await loadWindshield();

// A canvas the renderer will find by id, handing back OUR context rather than the stub's.
//
// ⚠ ONE TALLY OBJECT FOR THE WHOLE RUN, RESET BETWEEN PAINTS — NEVER A NEW ONE PER PAINT. The
// renderer asks for its context ONCE and holds it for the life of the canvas, so a `getContext` that
// hands back a fresh proxy bound to a fresh tally is called exactly once and every op after the
// first frame lands in an object nothing reads. That reports every trinket in the catalogue as
// drawing nothing, which is indistinguishable from the bug this file exists to find — and it was
// the first thing this harness said.
//
// ⚠ AND THE COUNTER HAS TO REACH EVERY CANVAS, NOT THE WORLD ONE. The cab interior is drawn on the
// INSTRUMENT layer — its own canvas at its own device-pixel ratio, deliberately not the world's
// (see "The instrument layer" in windshield.js) — which the renderer mints with
// `document.createElement`. A harness that only instruments the canvas it looks up by id counts the
// sky, the road and the buildings and not one pixel of the dash, so every trinket in the catalogue
// reports as drawing nothing. That is the second thing this harness said, and it is the same
// false positive as the first wearing different clothes.
//
// ⚠ AND THE INTERIOR NEEDS ITS OWN CANVAS REGISTERED, WHICH NOTHING IN THIS REPO HAD EVER DONE.
// `paintCabDash` opens with `dashCanvas(id)` — `getElementById(id + '-dash')` — and returns on that
// line when it finds nothing. Every cab view in `viewRenderSmoke` registers the WORLD canvas and
// not that one, so the whole interior (the dials, the wheel, the mirrors, thirteen hundred lines of
// it) has never run outside a browser: those views prove the world renders out of a truck window
// and say nothing whatever about the truck. That is the third false negative this harness produced
// and the only one that was not its own fault.
const ID = '__cab-trinkets';
const el = stubCanvas(ID, W, H);
stubCanvas(ID + '-dash', W, H);
const TALLY = { n: 0, log: [], shape: [] };
const CTX = countingCtx(TALLY);
el.getContext = () => CTX;
// Everything minted from here on. The texture bakes are already cached — they ran at import, above
// this line — so what is left to create is the layers a frame actually draws on.
const realCreate = globalThis.document.createElement;
globalThis.document.createElement = (t) => {
  const e = realCreate(t);
  if (String(t).toLowerCase() === 'canvas') e.getContext = () => CTX;
  return e;
};

const R = 10, N = R * 2 + 1;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  x === R ? { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 }
    : { kind: 'land', biome: 'citycore', flr: 0 }
)));

// ⚠ THE CLOCK IS PINNED, AND THAT IS WHAT MAKES TWO RENDERS COMPARABLE. The swing is integrated off
// `performance.now()`, so a harness that let it run would measure a different pose every time and
// a difference of one op would read as a finding. Pinned, the integrator sees dt 0 and everything
// hangs where it started — which is also the claim the shape gates depend on.
//
// ⚠ AND THE DICE ARE RESEEDED BEFORE EVERY FRAME, NOT MERELY PINNED ONCE. Pinning `Math.random` to a
// generator with a running seed makes the SEQUENCE reproducible and leaves each frame starting
// wherever the last one stopped — so two renders of the same scene come out with identical op
// COUNTS and different colours all the way through, which is exactly what a real difference looks
// like. Reseeded, frame two is frame one to the byte.
const realNow = performance.now.bind(performance);
const realRnd = Math.random, realDate = Date.now;
let CLOCK = 1000;
performance.now = () => CLOCK;
Date.now = () => 1758000000000;
let SEED = 0;
Math.random = () => { SEED = (SEED * 1103515245 + 12345) & 0x7fffffff; return SEED / 0x7fffffff; };

function paint(cab, gee) {
  TALLY.n = 0; TALLY.log.length = 0; TALLY.shape.length = 0;
  SEED = 0x2545f49;
  paintInto(cab, gee);
  return TALLY.n;
}
// The same frame, as the sequence of marks it made. Everything below compares SIGNATURES rather
// than counts, because a dressing that only changes a colour leaves the count exactly where it was
// — which is most of what the wheel shelf sells.
function sig(cab, gee) { paint(cab, gee); return TALLY.log.join('|'); }
function paintInto(cab, gee) {
  ws.paintWindshield(ID, {
    map, cls: 'truck', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12,
    hour: 13, weather: 'clear', speed: 0.3, heading: 0, tier: 2, variant: 'rigid',
    mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
    resFloor: 1, perfDS: 0,
    ...(cab ? { cab } : {}), ...(gee ? { gee } : {}),
  });
  return TALLY.n;
}

console.log('cabtrinkets — every row on the inside shelf reaches the canvas');

// The floor: a cab with nothing in it. Rendered twice, because the first paint of anything in this
// renderer fills caches (textures, patterns, the shape memo) and the second is the steady state.
paint(null, null);
const bareSig = sig(null, null);
const bare = TALLY.n;
check('a bare cab renders and is stable between two frames', bare > 100 && bareSig === sig(null, null),
  String(bare));

// ── EVERY ROW DRAWS, AND DRAWS SOMETHING OF ITS OWN ──────────────────────────
// One place at a time, so a row that draws nothing cannot hide behind a neighbour that draws plenty,
// and every row in a place compared against every other — a `kind` that falls through to a drawer's
// `default` is NOT silent (it draws whatever the default draws), so "it put ink down" passes for it
// and "it drew the same picture as its neighbour" is what actually catches it.
const load = { lat: 0.25, lon: -0.3 };
//
// ⚠ AND THE TWO MOUNTED PLACES ARE COMPARED COLOUR-BLIND, WHICH IS NOT FUSSINESS. Every row carries
// its own palette, so a `kind` that falls through to the drawer's `default` draws the LOZENGE in
// the fuzzy dice's red and comes out different from every other row on colour alone — the check
// passes and the dice are a red blob. Held against the shape trace, a fall-through is exactly what
// it is: two rows drawing the same geometry. The wheel shelf is the opposite case (a dressing is
// MEANT to share the wheel's geometry) and is compared on the full signature below.
for (const s of CAB_SLOTS) {
  const ids = TRINKET_IDS.filter((id) => TRINKETS[id].slot === s.id);
  const seen = new Map(), silent = [], dupes = [];
  for (const id of ids) {
    const g = sig([id], load);
    const shape = TALLY.shape.join('|');
    if (DETAIL) console.log(`    ${id.padEnd(12)} ${String(TALLY.n - bare).padStart(5)} ops`);
    if (g === bareSig) silent.push(id);
    else {
      const key = s.id === 'wheel' ? g : shape;
      if (seen.has(key)) dupes.push(`${id}=${seen.get(key)}`); else seen.set(key, id);
    }
  }
  check(`everything in "${s.label}" reaches the canvas`, silent.length === 0, silent.join(' '));
  check(`…and no two of them draw the same ${s.id === 'wheel' ? 'picture' : 'shape'}`,
    dupes.length === 0, dupes.join(' '));
}

// ── THE WHEEL IS DRESSED ON BOTH RENDERERS ───────────────────────────────────
// ⚠ RENDER_TUNE.cabWheel3d PICKS BETWEEN TWO WHEEL DRAWERS, so a dressing wired into one of them is
// a wheel somebody paid for that vanishes the day the flag is flipped. Both are checked, because
// neither is reachable from the other's code path.
//
// ⚠ AND IT IS CHECKED BY SIGNATURE, NEVER BY COUNT. Three of the five wheels are a pure palette —
// same faces, different colours — so the op count is IDENTICAL to a stock wheel's and a count test
// reports them as undressed. That was this harness's fourth false positive.
const wheels = TRINKET_IDS.filter((id) => TRINKETS[id].slot === 'wheel');
for (const flag of [1, 0]) {
  const prev = ws.RENDER_TUNE.cabWheel3d;
  ws.RENDER_TUNE.cabWheel3d = flag;
  paint(null, null);
  const b2 = sig(null, null);
  const dead = wheels.filter((id) => sig([id], null) === b2);
  const seen = new Map(), same = [];
  for (const id of wheels) {
    const g = sig([id], null);
    if (seen.has(g)) same.push(`${id}=${seen.get(g)}`); else seen.set(g, id);
  }
  check(`every wheel is dressed with cabWheel3d ${flag}`, dead.length === 0, dead.join(' '));
  check(`…and no two wheels look alike with cabWheel3d ${flag}`, same.length === 0, same.join(' '));
  ws.RENDER_TUNE.cabWheel3d = prev;
}
paint(null, null);

// ── AND IT SHADOWS ITSELF WHERE THERE IS ANYTHING TO SHADOW ──────────────────
// Nothing in this cab is lit by anything but , which is SHADING: a face turned away goes
// dark and a face standing in front of another does nothing to it. Three places have a real
// receiver and therefore a real shadow — the wheel pad under its spokes and its casting, the far
// die under the near one, and a bobblehead body under its own head.
//
// ⚠ COUNTED AS BLACK FILLS, WHICH IS WHAT A SHADOW IS HERE. Every shadow pass in the cab fills
// #000 at a low alpha and nothing else does, so the count is an exact census rather than a proxy —
// and it is the instrument that caught the badge casting NOTHING, which no picture showed because
// a missing shadow looks like a flat pad.
const dark = (cab, gee) => { sig(cab, gee); return TALLY.log.filter((l) => l.endsWith(":#000")).length; };
{
  // ⚠ A/B'D ON `RENDER_TUNE.cabShadow`, NOT AGAINST A NEIGHBOUR. The first cut compared a dressed
  // wheel against a bare one and passed with the pad shadow ripped out entirely — because the wheel
  // ALSO shadows the dash, that one reads the same spoke profile, and a spear wheel therefore throws
  // far more ink at the board whether or not it shadows its own boss. Two different shadows, one
  // count. The flag is the only thing that separates them.
  const prev = ws.RENDER_TUNE.cabShadow;
  const both = (cab) => {
    ws.RENDER_TUNE.cabShadow = 1; const on = dark(cab, null);
    ws.RENDER_TUNE.cabShadow = 0; const off = dark(cab, null);
    return { on, off };
  };
  const pad = both(['skullwheel']), die = both(['dice']), head = both(['reaper']);
  const bare = both(null);
  ws.RENDER_TUNE.cabShadow = prev;
  // ⚠ AND EACH ONE IS ISOLATED AGAINST THE BARE CAB, because the flag turns off EVERY cab shadow at
  // once — including the one the stock pad already casts on itself. Compared on the raw on/off pair,
  // a pair of dice "shadows itself" by eight fills it had nothing to do with, and the check passes
  // with the die shadow ripped out. The item's own contribution is the difference of differences.
  const own = (x) => (x.on - bare.on) - (x.off - bare.off);
  check('a stock pad catches its own maker\'s plaque',
    bare.on > bare.off, `${bare.on} vs ${bare.off}`);
  check('the wheel pad catches its own spokes and the casting bolted to it',
    own(pad) > 0, `own contribution ${own(pad)}`);
  check('one die shadows the other', own(die) > 0, `own contribution ${own(die)}`);
  check('a nodding head lays a shadow on its own body', own(head) > 0, `own contribution ${own(head)}`);
  // ⚠ AND 0 IS THE CAB THAT SHIPPED BEFORE ANY OF IT. A flag whose off state is not the old picture
  // is not an A/B, it is a second feature.
  check('…and switching it off leaves only the shadows that were always there',
    die.off === bare.off && head.off === bare.off,
    `${die.off} / ${head.off} / ${bare.off}`);
}
// ── A CAB WITH NOTHING IN IT IS THE CAB THAT ALWAYS SHIPPED ──────────────────
// The trinkets reach the interior through one list, and an empty list must take exactly none of the
// new paths. This is the case that would catch a drawer being reached on a truck nobody has bought
// anything for, which would show up as a stray mark on every cab in the game.
check('an empty list renders the bare cab', sig([], null) === bareSig);
check('…so does a missing one', sig(null, null) === bareSig);
check('…and so does a junk id, rather than crashing', sig(['nonesuch'], null) === bareSig);

// ── NOTHING MOVES WITHOUT A LOAD ─────────────────────────────────────────────
// The same pose under no acceleration however long the clock runs, which is what lets every other
// shape gate render a cab and get the same answer twice.
{
  const a = sig(['dice', 'reaper'], { lat: 0, lon: 0 });
  CLOCK += 5000;
  check('five seconds of standing still changes nothing in the picture',
    a === sig(['dice', 'reaper'], { lat: 0, lon: 0 }));
}

// ⚠ REDUCED MOTION KEEPS THE OBJECT AND STOPS THE SWING. `data-motion=off` deleting somebody's
// trinket would be an accessibility setting taking away a thing they bought.
//
// ⚠ IT IS COMPARED AGAINST A BARE CAB WITH THE SWITCH ALSO OFF. The stub answers `getAttribute` for
// every attribute, so the override changes more than this one flag and a motion-off frame is not
// comparable with a motion-on one. Held against its own baseline, the only difference left is the
// trinket.
{
  const doc = globalThis.document.documentElement;
  const prev = doc.getAttribute;
  doc.getAttribute = (k) => (k === 'data-motion' ? 'off' : null);
  paint(null, null);
  const offBare = sig(null, null);
  const offWith = sig(['dice', 'reaper', 'skullwheel'], { lat: 0.5, lon: -0.5 });
  const a = sig(['dice', 'reaper', 'skullwheel'], { lat: 0.5, lon: -0.5 });
  const b = sig(['dice', 'reaper', 'skullwheel'], { lat: -0.5, lon: 0.5 });
  doc.getAttribute = prev;
  check('reduced motion still draws what the driver bought', offWith !== offBare);
  check('…and draws it in the same place whatever the truck is doing', a === b);
}



performance.now = realNow; Math.random = realRnd; Date.now = realDate;

if (fails) { console.log(`\ncabtrinkets FAILED — ${fails} of ${checks}`); process.exit(1); }
console.log(`✓ cabtrinkets: ${checks} checks passed — all ${TRINKET_IDS.length} rows across ${CAB_SLOTS.length} places draw, on both wheel renderers`);
