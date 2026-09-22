// SNOW — does it accumulate, does it reach the shaders, and is 0 an off switch?
//
//   node scripts/shapes/snow.mjs            # gate
//   node scripts/shapes/snow.mjs --report   # the curves behind it
//
// ⚠ NO HEADLESS GATE IN THIS REPO CAN SEE THE PICTURE. Every harness here installs a GL hook that
// hands back a bare canvas and never reaches a draw call, so nothing below asserts that the snow
// LOOKS right — that is the Modelshop's job and it is done by eye. What this asserts is the three
// things that can be wrong while the picture is never drawn at all, each of which is silent:
//
//   1. THE ACCUMULATION. Snow rides the else branch of a carve-out the wet road already makes, and
//      the two are one expression apart. Swap them and the road goes white in a rainstorm and the
//      world stays green in a blizzard, with every shader, uniform and slider correct.
//   2. THE UNIFORM. The depth is threaded windshield -> install -> world -> four separate layers.
//      `gl:opts` guards the second of those hops and nothing guarded the fourth: a layer that never
//      writes its uniform reads 0 for ever and looks exactly like a feature nobody switched on.
//   2b. THE SPECIES HOLD. The scatter is the fourth layer and it is the odd one — the other three
//      have a surface to test and a billboard is a flat card, so how much snow a shape keeps is a
//      number per species carried on the BATCH. A batch that skips the write inherits the one
//      before it, which is a walking figure wearing a boulder's worth of snow.
//   3. THE OFF SWITCH. `RENDER_TUNE.glSnow = 0` has to be the renderer as it shipped, and "a small
//      number" is not that.
//
// ⚠ AND CHECK 2 DRIVES THE REAL LAYERS, NOT A MODEL OF THEM. `createFloorLayer` and
// `createGroundLayer` both take a `gl` and ask it for their own uniform locations, so a recording
// stub gets a genuine answer to "does this layer write uSnow, and does it write it on a frame with
// no snow in it" without a GPU anywhere. The second half of that question is the one that matters:
// a uniform holds its last value, so a layer that sets it only when it has snow leaves the world
// white for the rest of the session after one blizzard thaws.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { createFloorLayer } from '../../client/game/js/panels/gl/floor.js';
import { createGroundLayer } from '../../client/game/js/panels/gl/ground.js';
import { createBillboardLayer } from '../../client/game/js/panels/gl/billboards.js';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();
const W = 320, H = 180;
stubCanvas('__snow', W, H);

const problems = [];
const notes = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

// ── A GL THAT RECORDS INSTEAD OF DRAWING ──────────────────────────────────────
//
// Every method is synthesised, every SCREAMING_CASE key is a number, and the only two things that
// have to be real are `getUniformLocation` (which must hand back a token this can map back to a
// name) and the two `get*Parameter` calls the layers check their own compile and link with.
function recordingGL() {
  const seen = new Map();          // token -> uniform name
  const wrote = new Map();         // uniform name -> last value written
  // ⚠ AND THE WHOLE SEQUENCE, WHICH THE LAST VALUE CANNOT STAND IN FOR. `uSnowHold` is written
  // once per BATCH, so the question "did every species get its own" is a question about the order
  // of the writes — and reading only the last one passes a layer that wrote it once.
  const hist = new Map();          // uniform name -> every value written, in order
  const real = {
    getUniformLocation: (_p, n) => { const t = { n }; seen.set(t, n); return t; },
    getAttribLocation: () => 0,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    createShader: () => ({}), createProgram: () => ({}), createVertexArray: () => ({}),
    createTexture: () => ({}), createBuffer: () => ({}),
    isContextLost: () => false,
  };
  const setU = (loc, ...v) => {
    if (!loc || !seen.has(loc)) return;
    const n = seen.get(loc), val = v.length === 1 ? v[0] : v;
    wrote.set(n, val);
    (hist.get(n) || hist.set(n, []).get(n)).push(val);
  };
  const gl = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in real) return real[k];
      // A GL enum. Any distinct number will do — nothing here compares them.
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return k.length;
      if (k.startsWith('uniform')) return setU;
      return () => {};
    },
  });
  return { gl, wrote, hist, asked: () => [...seen.values()] };
}

// ── 1-2. THE TWO GROUND LAYERS WRITE uSnow, AND WRITE IT EVERY FRAME ──────────
{
  const f = recordingGL();
  const floor = createFloorLayer(f.gl);
  ok(f.asked().includes('uSnow'), 'floor.js never asks for a uSnow location — the shader declares it and the JS does not read it.');
  // A minimal state that gets past the layer's own early return.
  const base = { n: 4, lut0: new Uint8Array(64), lut1: new Uint8Array(64), hor: [0, 0, 0], fogCol: [0, 0, 0] };
  floor.draw({ ...base, snow: 0.62 });
  ok(f.wrote.get('uSnow') === 0.62, 'floor.js did not write the snow depth it was handed (got ' + f.wrote.get('uSnow') + ').');
  floor.draw({ ...base });
  ok(f.wrote.get('uSnow') === 0, 'floor.js skipped uSnow on a frame with no snow — a uniform holds its last value, so the world stays white after a thaw.');
}
{
  const g = recordingGL();
  const ground = createGroundLayer(g.gl);
  ok(g.asked().includes('uSnow'), 'ground.js never asks for a uSnow location — the shader declares it and the JS does not read it.');
  // One quad, so `draw` gets past `if (!count) return 0`.
  ground.upload([{ p: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], rgb: [60, 60, 60], a: 1, road: 1, lat: 0, kerb: 0.5 }]);
  const cam = { proj: () => ({ sx: 0, sy: 0, f: 1 }), sinh: 0, cosh: 1, ox: 0, oy: 0, ex: 0, ey: 0, EH: 0.2, W, H, FL: 300, depth: 300, cx: W / 2, horizonY: H / 2, LAT: 1 };
  ground.draw(cam, H, { snow: 0.41 });
  ok(g.wrote.get('uSnow') === 0.41, 'ground.js did not write the snow depth it was handed (got ' + g.wrote.get('uSnow') + ').');
  ground.draw(cam, H, {});
  ok(g.wrote.get('uSnow') === 0, 'ground.js skipped uSnow on a frame with no snow — same trap as the floor.');
}


// ── 1c. AND THE FOURTH CONSUMER: WHAT STANDS IN THE SNOW ─────────────────────
//
// The floor covers the open terrain, the ground pass covers the streets and the mass covers every
// up-facing surface in the city — and while there were only three, a blizzard turned the world
// white and left every tree, boulder, hoodoo and cactus standing on it in summer colours.
//
// ⚠ AND THIS LAYER HAS A SECOND WAY TO FAIL THAT THE OTHER THREE DO NOT. It is handed a per-batch
// HOLD as well as a frame depth, because a billboard is a flat card with no normal to test and so
// how much of a fall a shape keeps has to be stated per species. A uniform holds its last value,
// so a batch that skips that write does not draw with no snow — it draws with the PREVIOUS
// species' answer, and the species with no answer of its own are the walking figure and the bird.
{
  const b = recordingGL();
  const layer = createBillboardLayer(b.gl);
  for (const u of ['uSnow', 'uSnowHold', 'uSnowCol']) {
    ok(b.asked().includes(u), 'billboards.js never asks for a ' + u + ' location — the shader declares it and the JS never reads it.');
  }
  const cam = { proj: () => ({ sx: 0, sy: 0, f: 1 }), sinh: 0, cosh: 1, ox: 0, oy: 0, ex: 0, ey: 0, EH: 0.2, W, H, FL: 300, depth: 300, cx: W / 2, horizonY: H / 2, LAT: 1, near: 0.06 };
  // Two species in one frame: one that keeps a full fall, and one that says nothing about snow at
  // all — which is every billboard that is not landscape.
  const quad = (key, snow) => ({ key, img: {}, x: 0, y: 0, z: 0, w: 8, h: 8, ax: 4, ay: 7, alpha: 1, ...(snow == null ? {} : { snow }) });
  layer.upload([quad('rock', 1), quad('person')]);
  layer.draw(cam, W, H, H, null, { depth: 0.5, col: [0.9, 0.92, 0.96] });
  ok(b.wrote.get('uSnow') === 0.5, 'billboards.js did not write the snow depth it was handed (got ' + b.wrote.get('uSnow') + ').');
  ok(String(b.wrote.get('uSnowCol')) === '0.9,0.92,0.96',
    'billboards.js did not write the snow COLOUR it was handed (got ' + b.wrote.get('uSnowCol') + ') — the cap then disagrees with the field it is standing in.');
  const holds = b.hist.get('uSnowHold') || [];
  ok(holds.length >= 2 && holds[holds.length - 2] === 1 && holds[holds.length - 1] === 0,
    'the two species in one frame came out as holds [' + holds.join(', ') + '] rather than ending 1 then 0 — a batch is not getting its own '
    + 'hold, so whatever draws after a boulder wears a boulder\'s snow.');
  // …and with no snow in the frame, one write at zero and no per-batch traffic at all: that is
  // what makes `glSnowBB: 0` the layer that shipped rather than the layer running at a small number.
  const b2 = recordingGL();
  const l2 = createBillboardLayer(b2.gl);
  l2.upload([quad('rock', 1), quad('person')]);
  l2.draw(cam, W, H, H, null, { depth: 0 });
  ok(b2.wrote.get('uSnow') === 0, 'billboards.js skipped uSnow on a frame with no snow — a uniform holds its last value, so every bush in the world keeps its cap for the rest of the session after one thaw.');
  ok(String(b2.hist.get('uSnowHold') || []) === '0', 'billboards.js wrote uSnowHold [' + (b2.hist.get('uSnowHold') || []).join(', ') + '] on a bare frame — with no snow the per-batch write is meant not to be a code path.');
}

// ── 1b. AND BOTH LAYERS TAKE THE TRACK BUFFER, EVERY FRAME ───────────────────
//
// Same trap as uSnow one block up and worth restating because it is louder here: a uniform holds
// its last value, so a layer that uploads the path only when it HAS one leaves the last track
// carved into the snow for the rest of the session — a set of wheel marks standing in a field
// nobody has driven through, following you from map to map.
function trackProbe(layer, drawIt) {
  const path = { n: 3, half: 0.16, w: 0.03, box: [-9, -9, 9, 9],
    pts: new Float32Array([0, 0, 1, 1, 1, 0, 1, 1, 2, 0, 1, 0]) };
  drawIt(layer, { tracks: path });
  const on = layer.wrote.get('uNTrack');
  drawIt(layer, {});
  return { on, off: layer.wrote.get('uNTrack') };
}
{
  const f = recordingGL();
  const floor = createFloorLayer(f.gl);
  ok(f.asked().includes('uNTrack'), 'floor.js never asks for a uNTrack location — the shader declares the array and the JS never fills it.');
  const base = { n: 4, lut0: new Uint8Array(64), lut1: new Uint8Array(64), hor: [0, 0, 0], fogCol: [0, 0, 0] };
  const r = trackProbe(f, (L, extra) => floor.draw({ ...base, ...extra }));
  ok(r.on === 3, 'floor.js did not upload the 3-point path it was handed (uNTrack came out ' + r.on + ').');
  ok(r.off === 0, 'floor.js skipped uNTrack on a frame with no path — the last track stays carved into the snow for the session.');
}
{
  const g = recordingGL();
  const ground = createGroundLayer(g.gl);
  ok(g.asked().includes('uNTrack'), 'ground.js never asks for a uNTrack location — the shader declares the array and the JS never fills it.');
  ground.upload([{ p: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], rgb: [60, 60, 60], a: 1, road: 1, lat: 0, kerb: 0.5 }]);
  const cam = { proj: () => ({ sx: 0, sy: 0, f: 1 }), sinh: 0, cosh: 1, ox: 0, oy: 0, ex: 0, ey: 0, EH: 0.2, W, H, FL: 300, depth: 300, cx: W / 2, horizonY: H / 2, LAT: 1 };
  const r = trackProbe(g, (L, extra) => ground.draw(cam, H, extra));
  ok(r.on === 3, 'ground.js did not upload the 3-point path it was handed (uNTrack came out ' + r.on + ').');
  ok(r.off === 0, 'ground.js skipped uNTrack on a frame with no path — same trap as the floor.');
}
// ── 3. world.js HANDS IT TO ALL THREE CONSUMERS ───────────────────────────────
//
// The hop `gl:opts` cannot see. That gate checks install.js -> world.js; this is world.js -> the
// layers, and it fails in exactly the same way — the tune key exists, the uniform is declared, the
// layer writes it, and the value written is always zero because nobody put one in the bag.
{
  const src = await (await import('node:fs')).promises.readFile('client/game/js/panels/gl/world.js', 'utf8');
  // ⚠ LOCATED, NEVER COUNTED. A first cut asserted that `snow: opts.glSnow` appeared at least twice
  // and it is worth nothing: there are three hand-offs, so deleting any one of them leaves two and
  // the gate stays green. It was mutation-tested, it MISSED exactly that, and counting occurrences
  // of a string that appears in several places is the reason. Each consumer is brace-matched and
  // asked separately.
  // The object literal CONTAINING a key only that one call site carries. Walks out to the enclosing
  // `{` rather than in to the next one, because the next one after any given key is a nested
  // ternary's object or the following property's — which is a bag, and never the right bag.
  const bagAround = (anchor) => {
    const at = src.indexOf(anchor);
    if (at < 0) return null;
    let d = 0, open = -1;
    for (let i = at; i >= 0; i--) {
      if (src[i] === '}') d++;
      else if (src[i] === '{') { if (!d) { open = i; break; } d--; }
    }
    if (open < 0) return null;
    d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (!d) return src.slice(open, i + 1); }
    }
    return null;
  };
  ok(src.includes('fl.snow'), 'world.js never hands the snow depth to the FLOOR state — the open terrain stays bare, because the floor is the only pass that draws it.');
  const groundBag = bagAround('pudRoad: opts.glPudRoad');
  ok(groundBag && /\bsnow\s*:/.test(groundBag), 'world.js never hands the snow depth to the GROUND pass — every road and pavement in the city stays bare, because GROUND_FULL paints them over the floor.');
  const massBag = bagAround('matStr: opts.glMat');
  ok(massBag && /\bsnow\s*:/.test(massBag), 'world.js never hands the snow depth to the MASS pass — no roof, coping, parapet or sill in the city takes any.');
  // ⚠ AND THE FOURTH, WHICH IS AN ARGUMENT RATHER THAN A BAG KEY — so it is paren-matched from the
  // call rather than brace-matched from a literal, and located rather than counted for the same
  // reason the three above are.
  const callAround = (name) => {
    const at = src.indexOf(name + '(');
    if (at < 0) return null;
    let d = 0;
    for (let i = at + name.length; i < src.length; i++) {
      if (src[i] === '(') d++;
      else if (src[i] === ')') { d--; if (!d) return src.slice(at, i + 1); }
    }
    return null;
  };
  const bbCall = callAround('drawBillboards');
  ok(bbCall && /\bsnowBB\b/.test(bbCall), 'world.js never hands the snow depth to the BILLBOARD layer — the ground goes white and every tree, boulder and cactus standing on it stays green.');
  ok(bbCall && /\bsnowCol\b/.test(bbCall), 'world.js never hands the snow COLOUR to the BILLBOARD layer — the layer falls back to its own daylight white, so a capped bush glows against a dusk field.');
  ok(src.includes('fl.tracks'), 'world.js never hands the wheel path to the FLOOR state — tracks stop at the kerb, because the floor is the only pass that draws open ground.');
  ok(groundBag && /\btracks\s*:/.test(groundBag), 'world.js never hands the wheel path to the GROUND pass — tracks appear on the verge and vanish on the road.');
  // ⚠ AND THE MASS MUST NOT GET ONE. Nothing drives on a roof, and a track array walked per
  // fragment over every wall in the city is a real cost for a picture that cannot exist.
  ok(massBag && !/\btracks\s*:/.test(massBag), 'world.js hands the wheel path to the MASS pass — nothing drives on a roof, and that is a per-fragment loop over every wall in the city for nothing.');
  notes.push('world.js hands snow to the floor state, the ground bag and the mass bag');
}

// ── 4. THE ACCUMULATION, THROUGH A RECORDING WORLD HOOK ───────────────────────
//
// ⚠ THE CLOCK HAS TO ADVANCE OR THERE IS NOTHING TO INTEGRATE. `dt` is the wall-clock delta between
// paints capped at 50 ms, so a pinned clock gives dt 0 and every weather in the sweep comes back at
// exactly 0.0 — which reads as the feature being dead rather than as the harness standing still.
const clock = globalThis.performance;
let T = 1e6;
globalThis.performance = { ...clock, now: () => T };
const realDateNow = Date.now;
Date.now = () => T;
const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor, snow: ws.RENDER_TUNE.glSnow, force: ws.RENDER_TUNE.snowForce, bb: ws.RENDER_TUNE.glSnowBB };
const tWas = ws.RENDER_TUNE.glTracks;

const N = 15, R = 7;
const mapOf = (biome) => Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome, flr: 0 })));
const map = mapOf('parkland');
const view = (weather, o = {}) => ({
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12,
  hour: 12, weather, speed: 0, map, heading: 0, resFloor: 1,
  mapCenter: { x: 900, y: 900 }, mapOffset: { x: 0.3, y: -0.2 }, tune: { gl: 1, perfDS: 0 },
  ...o,
});

let got = null;
const canvas = globalThis.document.createElement('canvas');
canvas.width = W; canvas.height = H;
ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
ws.installGLWorld((cells, cam, o) => { got = { snow: o.glSnow, wet: o.glWet, tracks: o.tracks, snowBB: o.snowBB, snowCol: o.snowCol, scatter: o.scatter }; return { faces: 1, canvas }; });

// Paint `frames` frames of one weather and hand back what the last one asked the GL pass for.
function run(weather, frames, o) {
  for (let i = 0; i < frames; i++) { T += 50; ws.paintWindshield('__snow', view(weather, o)); }
  return got || { snow: 0, wet: 0 };
}

try {
  // A clean start, then a fixed stretch of each weather. ⚠ The SAME number of frames for each, or
  // this compares exposure rather than classification.
  const FR = 120;   // 6 s of sim time — enough to separate from zero, fast enough to run in a gate
  ws.RENDER_TUNE.glSnow = 1; ws.RENDER_TUNE.snowForce = null;

  const snowy = run('snow', FR);
  ok(snowy.snow > 0.001, 'six seconds of `weather: snow` accumulated nothing (' + snowy.snow.toFixed(4) + ') — the world stays green in a blizzard.');
  notes.push('snow  ' + FR + ' frames -> depth ' + snowy.snow.toFixed(4) + ', wet ' + snowy.wet.toFixed(4));

  // ⚠ AND IT MUST THAW RATHER THAN SWITCH OFF. The whole reason this is an accumulation and not a
  // film is that clear sky does not undo it; a depth that falls to 0 the moment the weather clears
  // is `WET_NOW` wearing a different name.
  const clear1 = run('clear', 20);
  ok(clear1.snow > snowy.snow * 0.5, 'the snow vanished as soon as the sky cleared (' + snowy.snow.toFixed(4) + ' -> ' + clear1.snow.toFixed(4) + ') — it is being driven as a film rather than integrated as a depth.');
  ok(clear1.snow < snowy.snow, 'the snow did not thaw at all under clear sky (' + clear1.snow.toFixed(4) + ') — it will never go.');
  notes.push('clear 20 frames -> depth ' + clear1.snow.toFixed(4) + ' (thawing)');

  // ⚠ THE CARVE-OUT, IN BOTH DIRECTIONS. This is the pair that would silently swap.
  const before = clear1.snow;
  const rainy = run('rain', FR);
  ok(rainy.snow < before, 'rain ADDED to the snow depth (' + before.toFixed(4) + ' -> ' + rainy.snow.toFixed(4) + ') — the carve-out is inverted.');
  ok(rainy.wet > 0.5, 'six seconds of rain left the road dry (' + rainy.wet.toFixed(4) + ') — the snow branch has eaten the wet one.');
  notes.push('rain  ' + FR + ' frames -> depth ' + rainy.snow.toFixed(4) + ' (still thawing), wet ' + rainy.wet.toFixed(4));

  // The alias: WX_ALIAS folds blizzard into snow, and a gate that only ever says `snow` would not
  // notice if it stopped doing so.
  const blizz = run('blizzard', FR);
  ok(blizz.snow > rainy.snow, 'a blizzard did not accumulate (' + rainy.snow.toFixed(4) + ' -> ' + blizz.snow.toFixed(4) + ') — WX_ALIAS no longer folds it into `snow`.');
  notes.push('blizzard ' + FR + ' frames -> depth ' + blizz.snow.toFixed(4));

  // ── THE OFF SWITCH, AND THE BENCH SEAM ──────────────────────────────────────
  ws.RENDER_TUNE.glSnow = 0;
  const off = run('snow', 4);
  ok(off.snow === 0, '`glSnow: 0` still asked for ' + off.snow + ' — the off switch has to be exact, not small.');
  ws.RENDER_TUNE.glSnow = 1;

  ws.RENDER_TUNE.snowForce = 0.73;
  const forced = run('clear', 4);
  ok(Math.abs(forced.snow - 0.73) < 1e-9, '`snowForce` did not pin the depth (asked for ' + forced.snow + ') — every bench and the Modelshop have no weather at all and this is their only way in.');
  ws.RENDER_TUNE.snowForce = null;

  // ⚠ AND THE FORCE STILL GOES THROUGH THE MASTER FLAG, which is what makes `glSnow: 0` mean the
  // renderer as it shipped rather than "unless somebody set the other knob".
  ws.RENDER_TUNE.glSnow = 0; ws.RENDER_TUNE.snowForce = 1;
  const both = run('clear', 4);
  ok(both.snow === 0, '`snowForce` overrode `glSnow: 0` (asked for ' + both.snow + ') — the off switch is not an off switch.');
  ws.RENDER_TUNE.glSnow = 1;

  // ── 4b. AND WHAT IS STANDING IN IT ──────────────────────────────────────────
  //
  // Everything above this asks whether the DEPTH is right. This asks whether the scatter hears
  // about it, and it is the half a rasteriser would be needed to see the rest of — so it checks
  // the three things that are silent when wrong: every billboard carries a hold, the hold is a
  // property of the species rather than a constant somebody put back, and the sub-flag is an
  // exact off switch that does not take the ground's snow with it.
  ws.RENDER_TUNE.glSnow = 1; ws.RENDER_TUNE.glSnowBB = 1; ws.RENDER_TUNE.snowForce = 0.8;
  const holdsOf = (r) => [...new Set((r.scatter || []).map((q) => q.snow))].sort((a, b) => a - b);
  const park = run('clear', 4);
  ok((park.scatter || []).length > 0, 'a parkland map put nothing in the scatter sink at all, so nothing below checks the snow on it.');
  ok((park.scatter || []).every((q) => typeof q.snow === 'number' && q.snow >= 0 && q.snow <= 1),
    'a scatter billboard reached the layer with no snow hold on it — an undefined hold is read as 0, which is a tree that stays green in a blizzard and says nothing about it.');
  ok(holdsOf(park).every((h) => h > 0), 'the parkland trees claim a hold of ' + holdsOf(park).join('/') + ' — a wood in a blizzard is the one thing this feature is for.');
  notes.push('parkland: ' + park.scatter.length + ' billboards, holds ' + holdsOf(park).join('/'));

  // ⚠ MORE THAN ONE ANSWER IN ONE FRAME, which is what says the hold is per SPECIES. The scrub
  // table hands out saguaro, brush, tumbleweed and stone off one seed, and those hold wildly
  // different amounts of the same fall — so a single value here means somebody has put a constant
  // back, and it also means the bake is leaking one species' hold into the next.
  const scrub = run('clear', 4, { map: mapOf('scrub') });
  const sh = holdsOf(scrub);
  ok(sh.length > 1, 'a whole scrub map came back with one hold (' + sh.join('/') + ') — the scatter is taking a constant rather than each species\' own.');
  ok(!sh.some((h) => holdsOf(park).includes(h)) || sh.length > 1,
    'the scrub scatter reports the parkland tree\'s hold.');
  notes.push('scrub: ' + scrub.scatter.length + ' billboards, holds ' + sh.join('/'));

  // ⚠ THE SUB-FLAG IS ITS OWN OFF SWITCH AND TAKES NOTHING WITH IT. The point of it being separate
  // from `glSnow` is to be able to put the scatter back to the renderer that shipped while the
  // ground keeps its cover — so both halves are asserted, not just the zero.
  ws.RENDER_TUNE.glSnowBB = 0;
  const bbOff = run('clear', 4);
  ok(bbOff.snowBB === 0, '`glSnowBB: 0` still asked the layer for ' + bbOff.snowBB + ' — the off switch has to be exact, not small.');
  ok(bbOff.snow > 0.001, '`glSnowBB: 0` took the GROUND\'s snow with it (' + bbOff.snow + ') — the two are meant to be independent.');
  ws.RENDER_TUNE.glSnowBB = 1;
  // …and the master flag still reaches it, or `glSnow: 0` is not the renderer as it shipped.
  ws.RENDER_TUNE.glSnow = 0;
  const allOff = run('clear', 4);
  ok(allOff.snowBB === 0, '`glSnow: 0` left the scatter asking for ' + allOff.snowBB + ' — the master flag does not reach the billboards.');
  ws.RENDER_TUNE.glSnow = 1;

  // ⚠ AND THE COLOUR CARRIES THE HOUR. Snow is the sky, so the cap has to darken with the field it
  // stands in; a constant white here is a tree wearing a cap that glows at midnight, which is
  // exactly what a wrong answer looks like and is the easiest one to write.
  const noon = run('clear', 4, { hour: 12 }).snowCol;
  const midnight = run('clear', 4, { hour: 0 }).snowCol;
  ok(Array.isArray(noon) && noon.length === 3 && noon.every(Number.isFinite),
    'the snow colour did not reach the bag as three finite numbers (got ' + JSON.stringify(noon) + ').');
  ok(midnight[0] < noon[0] * 0.9,
    'snow is the same colour at midnight as at noon (' + midnight[0].toFixed(1) + ' vs ' + noon[0].toFixed(1)
    + ') — it is a constant rather than the frame\'s own sky, so a capped tree glows in the dark.');
  notes.push('snow colour: noon ' + noon.map((v) => v.toFixed(0)).join(',') + ' -> midnight ' + midnight.map((v) => v.toFixed(0)).join(','));
  ws.RENDER_TUNE.snowForce = null;

  // ── 5. WHEEL TRACKS ─────────────────────────────────────────────────────────
  //
  // The one stateful thing in the whole feature, and therefore the only part that can be wrong in a
  // way the cover cannot: it has to record the right things, stop recording the moment there is no
  // snow to record into, and — the part that has no analogue anywhere else here — build OTHER
  // people's tracks out of the contact feed rather than out of anything the server stores.
  const contact = (x, y, onGround) => ([{
    id: 'T1', cls: 'truck', x, y, hdg: 90, ias: 30, alt: 0, band: 'ground',
    onGround, groundZ: 0, altDiff: 0, bank: 0, pitch: 0, vs: 0, hullPct: 100, reg: 'TEST',
  }]);
  // Drive east, painting a frame at a time. `height` decides whether the OWN ship lays anything, so
  // lifting it is how a case isolates the contact.
  function drive(frames, { height = 0, contacts = null, step = 0.3, path = null, variant = 'hauler', weather = 'snow' } = {}) {
    for (let i = 0; i < frames; i++) {
      T += 50;
      const [px, py] = path ? path(i) : [900 + i * step, 900];
      ws.paintWindshield('__snow', { ...view(weather), height, variant,
        mapCenter: { x: px, y: py },
        contacts: typeof contacts === 'function' ? contacts(i) : contacts });
    }
    return got || {};
  }
  // The worst angle between consecutive drawn segments, in degrees. Run breaks (the 4th component
  // at 0) are skipped, because two runs meeting is not a bend.
  const worstKink = (t) => {
    let worst = 0;
    for (let i = 1; i + 1 < t.n; i++) {
      if (t.pts[(i - 1) * 4 + 3] < 0.5 || t.pts[i * 4 + 3] < 0.5) continue;
      const ax = t.pts[i * 4] - t.pts[(i - 1) * 4], ay = t.pts[i * 4 + 1] - t.pts[(i - 1) * 4 + 1];
      const bx = t.pts[(i + 1) * 4] - t.pts[i * 4], by = t.pts[(i + 1) * 4 + 1] - t.pts[i * 4 + 1];
      worst = Math.max(worst, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI);
    }
    return worst;
  };
  const tailFade = (t) => { let m = 1; for (let i = 0; i < t.n; i++) m = Math.min(m, t.pts[i * 4 + 2]); return m; };
  // ⚠ THE RESET IS A REAL BEHAVIOUR, NOT A TEST HOOK. The store is emptied whenever there is no snow
  // to hold a track, so painting one bare frame is both how a case starts clean and an assertion in
  // its own right — see the no-snow case below.
  const clearStore = () => { ws.RENDER_TUNE.snowForce = 0; run('clear', 2); ws.RENDER_TUNE.snowForce = 0.5; };

  clearStore();
  const own = drive(40);
  ok(own.tracks && own.tracks.n > 1,
    'driving 12 tiles through snow recorded no track (' + (own.tracks ? own.tracks.n : 'null') + ' points) — nothing remembers where the wheels went.');
  notes.push('own ship, 40 frames over 12 tiles -> ' + (own.tracks ? own.tracks.n : 0) + ' points');

  // ⚠ NO SNOW, NO TRACK. A wheel on bare ground leaves nothing, and the store must be EMPTY rather
  // than merely unread — otherwise it accumulates all summer for a feature that is switched off.
  ws.RENDER_TUNE.snowForce = 0;
  const bare = drive(20);
  ok(!bare.tracks, 'wheels recorded a track on bare ground (' + (bare.tracks ? bare.tracks.n + ' points' : '') + ') — the store should be empty whenever there is no snow.');
  ws.RENDER_TUNE.snowForce = 0.5;

  // ⚠ THE OFF SWITCH IS EXACT, and it also has to stop the RECORDING rather than only the drawing.
  clearStore();
  ws.RENDER_TUNE.glTracks = 0;
  const offT = drive(30);
  ok(!offT.tracks, '`glTracks: 0` still built a buffer — 0 has to be the snow exactly as it lies, and it has to stop the store as well as the shader.');
  ws.RENDER_TUNE.glTracks = 1;

  // ── OTHER PEOPLE, OUT OF THE CONTACT FEED ───────────────────────────────────
  //
  // The whole point: no server state, no new packet. A contact already carries a stable id, a
  // sub-tile float position and `onGround`, so a second vehicle's track is a DERIVATION of what the
  // cockpit is already being sent. The own ship is lifted off the ground here so anything recorded
  // can only have come from the contact.
  clearStore();
  const other = drive(40, { height: 0.5, contacts: (i) => contact(906 + i * 0.3, 900, true) });
  ok(other.tracks && other.tracks.n > 1,
    'a contact with its wheels down laid no track (' + (other.tracks ? other.tracks.n : 'null') + ') — other players\' tracks are the reason this reads the contact feed at all.');
  notes.push('contact on the ground, own ship airborne -> ' + (other.tracks ? other.tracks.n : 0) + ' points');

  // ⚠ `onGround` IS THE GATE, and it is the contact's own field rather than anything invented here —
  // which is what makes an aircraft lay track exactly while it is rolling and not one frame of it
  // while airborne, with nothing in the store knowing what an aircraft is.
  clearStore();
  const flying = drive(40, { height: 0.5, contacts: (i) => contact(906 + i * 0.3, 900, false) });
  ok(!flying.tracks, 'an AIRBORNE contact laid a track (' + (flying.tracks ? flying.tracks.n + ' points' : '') + ') — `onGround` is the gate and it is being ignored.');

  // ⚠ A RUN BREAKS RATHER THAN DRAWING A SCAR ACROSS A JUMP. A contact that drops out of range and
  // returns somewhere else, a respawn, a relay gap: joined up, the two positions become one straight
  // gouge through the snow between them. The break rides the 4th component of the point itself.
  clearStore();
  // ⚠ THE WINDOW HAS TO HOLD BOTH RUNS. `trackUpload` clips to the map window, so a jump bigger
  // than that clips the second run away entirely and this measures the CLIP — which reads as a
  // missing break and looks exactly like the bug it is meant to catch. `step: 0` pins the window.
  drive(20, { height: 0.5, step: 0, contacts: (i) => contact(890 + i * 0.3, 900, true) });
  const jumped = drive(20, { height: 0.5, step: 0, contacts: (i) => contact(903 + i * 0.3, 900, true) });
  if (jumped.tracks && jumped.tracks.pts) {
    const p = jumped.tracks.pts;
    let breaks = 0;
    for (let i = 0; i < jumped.tracks.n; i++) if (p[i * 4 + 3] < 0.5) breaks++;
    // One per run for the final point, plus one at the jump itself.
    ok(breaks >= 2, 'a contact that jumped 7 tiles left ' + breaks + ' run break(s) — under two means the two positions were joined into one straight gouge through the snow between them.');
    notes.push('after a 7-tile jump: ' + jumped.tracks.n + ' points, ' + breaks + ' run break(s)');
  } else {
    problems.push('the jump case recorded nothing at all, so the run-break rule was never exercised.');
  }
  // ── ⚠ THE GAUGE IS THE RIG'S OWN, AND THAT IS THE HALF OF THIS THAT WAS WRONG ───────────────
  //
  // The pair's spacing and one mark's width were two constants, 0.16 and 0.032 tiles, derived
  // METRICALLY: a lane is LANE_W across, so a tile is about seven metres and a two-and-a-half-metre
  // axle is 0.18 of one. Every step of that is right and the answer is five times too big, because
  // a vehicle in GLASS is not drawn at its metric size — so a metrically honest wheel track ran a
  // full truck's width clear of the truck on either side. It comes off `podGlow` now, which is
  // where the lifters are.
  //
  // ⚠ AND WHAT A HEADLESS GATE CAN SEE IS THAT THE NUMBER MOVES WITH THE RIG. There is no
  // rasteriser here and no way to hold a mark up against a drawn cab, but a continental is wider
  // across the lifters than a scrapper — so if the two ever report one gauge, somebody has put a
  // constant back, whatever its value.
  clearStore();
  const wide = drive(30, { variant: 'continental' });
  clearStore();
  const narrow = drive(30, { variant: 'scrapper' });
  if (wide.tracks && narrow.tracks) {
    ok(wide.tracks.half > narrow.tracks.half,
      'a continental and a scrapper laid the same wheel track (' + wide.tracks.half.toFixed(5) + ' vs '
      + narrow.tracks.half.toFixed(5) + ') — the gauge is a constant again rather than the rig\'s own lifter stations.');
    // …and it is the LIFTERS rather than something that merely grows with the rig: the ratio of the
    // pair's spacing to one mark's width is a property of the model, and no fallback reproduces it.
    const { vehicleLamps } = await import('../../client/game/js/panels/aircraft3d.js');
    for (const [name, r] of [['continental', wide], ['scrapper', narrow]]) {
      const pods = vehicleLamps('truck', name).podGlow;
      const want = Math.max(...pods.map((q) => Math.abs(q.p[1]))) / Math.max(...pods.map((q) => q.hw));
      ok(Math.abs(r.tracks.half / r.tracks.w - want) < 1e-6,
        'the ' + name + '\'s marks are ' + (r.tracks.half / r.tracks.w).toFixed(3) + ' of a mark apart against its own '
        + want.toFixed(3) + ' — the gauge is not being read off podGlow.');
    }
    notes.push('gauge: continental ' + wide.tracks.half.toFixed(5) + ' / scrapper ' + narrow.tracks.half.toFixed(5) + ' tiles');
  } else {
    problems.push('the gauge case recorded nothing, so nothing about the wheel track was ever checked.');
  }

  // ── ⚠ A BEND COMMITS POINTS THAT A STRAIGHT DOES NOT ────────────────────────────────────────
  //
  // A point every TRACK_STEP is right for a straight and draws a corner in three straight lines —
  // a rig takes a junction in about 25° a point at that spacing, and a pair of rails kinking
  // through 25° at a time is what "the tracks do not turn" looks like. The head is committed early
  // once the run has TURNED far enough instead. Two things are visible without drawing anything:
  // the same arc length costs MORE points round a bend than in a straight line, and the worst
  // angle between consecutive segments comes down with it.
  clearStore();
  const straight = drive(80, { path: (i) => [900 + i * 0.06, 900] });
  clearStore();
  const bent = drive(80, { path: (i) => { const a = (Math.PI / 2) * (i / 79); return [900 + 3 * Math.sin(a), 900 + 3 * (1 - Math.cos(a))]; } });
  if (straight.tracks && bent.tracks) {
    ok(bent.tracks.n > straight.tracks.n,
      'a 90° bend cost ' + bent.tracks.n + ' points against ' + straight.tracks.n + ' for the same arc length in a straight line — '
      + 'the turn is not committing a point, so a corner is drawn as three straight rails.');
    ok(worstKink(bent.tracks) < 15,
      'the worst angle between consecutive segments round a bend is ' + worstKink(bent.tracks).toFixed(1)
      + '° — a rail kinking that hard reads as a corner nobody steered through.');
    notes.push('bend: ' + bent.tracks.n + ' points vs ' + straight.tracks.n + ' straight, worst kink '
      + worstKink(bent.tracks).toFixed(1) + '°');
  } else {
    problems.push('the bend case recorded nothing, so the turn rule was never exercised.');
  }

  // ── ⚠ AND IT FILLS IN WHILE IT IS SNOWING ───────────────────────────────────────────────────
  //
  // Burial was `depth - laid`: the cover now against the cover then, which is the obvious reading
  // and is ZERO for as long as a fall is at its steady state — and a fall reaches its steady state
  // within a couple of minutes. So the single condition under which a rut has to fill in (it is
  // snowing, hard, now) was the single condition under which nothing ever buried one. It is the
  // accumulated FALL now, which keeps rising for as long as it keeps snowing.
  //
  // ⚠ THE DEPTH IS PINNED EITHER SIDE OF THIS, which is what makes it a real test: `snowForce` is
  // the same in both runs, so a burial that keyed on the depth would measure exactly 0 in both and
  // the two would be indistinguishable. The only difference between them is whether anything is
  // coming down.
  const buried = (weather) => {
    clearStore();
    drive(40, { path: (i) => [900 + i * 0.1, 900] });                     // four tiles of track
    const r = drive(300, { weather, path: () => [904, 900] });            // …then parked, fifteen seconds
    return r.tracks ? tailFade(r.tracks) : null;
  };
  const underSnow = buried('snow'), underClear = buried('clear');
  if (underSnow != null && underClear != null) {
    ok(underSnow < underClear - 0.1,
      'fifteen seconds of snow buried a track to ' + underSnow.toFixed(2) + ' against ' + underClear.toFixed(2)
      + ' in the clear — burial is reading the DEPTH, which does not move once a fall has settled, rather than the fall.');
    notes.push('burial after 15 s parked: snowing ' + underSnow.toFixed(2) + ', clear ' + underClear.toFixed(2));
  } else {
    problems.push('the burial case recorded nothing, so nothing checks that a track ever goes away.');
  }

  ws.RENDER_TUNE.snowForce = null; ws.RENDER_TUNE.glTracks = tWas;

  // ── 6. THE CELL OVERHEAD DECIDES THE TYPE, NOT THE HEADLINE WORD ───────────────────────────
  //
  // ⚠ THE BUG THIS EXISTS FOR DREW A PERFECTLY GOOD PICTURE OF THE WRONG WEATHER. The wet branch
  // and the snow branch each OR'd a headline test with a cell test, and only the cell halves knew
  // about each other — so a snow HEADLINE with a rain CELL over you drew rain streaks out of the
  // window, wet the road AND deepened the snow at full rate, all three at once. Reported as
  // puddles gathering on the grass in the rain, which is what a field of lying snow looks like
  // when nobody is expecting one.
  //
  // ⚠ AND IT NEEDS A REAL FIELD, not a weather word: 'wxSample' is null without both 'wxField'
  // and 'acX', so every other case in this file exercises the headline path alone and not one of
  // them could have caught it.
  const cellField = (ptype) => ({
    tick: 30, bounds: { minX: 880, minY: 880, maxX: 920, maxY: 920 },
    baseCloud: 0.8, precipFloor: 0, floorType: 'none',
    cells: [{ x: 900, y: 900, r: 20, vx: 0, vy: 0, type: 'precip', intensity: 0.8, precip: ptype }],
  });
  const overhead = (headline, ptype, frames) =>
    run(headline, frames, { wxField: cellField(ptype), acX: 900, acY: 900 });

  {
    const before = run('clear', 400).snow;   // let whatever is lying thaw well down first
    const r = overhead('snow', 'rain', 120);
    ok(r.wet > 0.5, 'a rain cell under a snow headline left the road dry (' + r.wet.toFixed(3) + ') — the local cell is not reaching the wet branch.');
    ok(r.snow < before, 'a rain cell under a snow HEADLINE went on deepening the snow (' + before.toFixed(4) + ' -> ' + r.snow.toFixed(4)
      + ') — the headline word is crediting the snow branch behind the cell\'s back, which is rain falling on a snowfield that should not be there.');
    notes.push('snow headline + rain cell -> wet ' + r.wet.toFixed(3) + ', depth ' + before.toFixed(4) + ' -> ' + r.snow.toFixed(4));
  }
  {
    // …and the mirror, or the fix above could simply be "a cell always means rain".
    //
    // ⚠ THE ROAD IS ASKED TO BE DRYING, NOT TO BE DRY. The film dries at 0.06/s, so six seconds
    // after the downpour above it is still over half wet whatever this case does — a threshold
    // here fails on the PREVIOUS case's water and says nothing about this one.
    const before = run('clear', 40);
    const r = overhead('rain', 'snow', 120);
    ok(r.snow > before.snow, 'a snow cell under a rain headline accumulated nothing (' + before.snow.toFixed(4) + ' -> ' + r.snow.toFixed(4) + ').');
    ok(r.wet < before.wet, 'a snow cell under a rain HEADLINE went on wetting the road (' + before.wet.toFixed(3) + ' -> ' + r.wet.toFixed(3)
      + ') — the same blindness, pointed the other way.');
    notes.push('rain headline + snow cell -> depth ' + before.snow.toFixed(4) + ' -> ' + r.snow.toFixed(4) + ', wet ' + before.wet.toFixed(3) + ' -> ' + r.wet.toFixed(3));
  }

  // ── 7. AND RAIN TAKES THE SNOW AWAY ────────────────────────────────────────────────────────
  //
  // 'SNOW_THAW_S' is the CLEAR-SKY thaw — how long the city keeps a fall once the sky clears — and
  // for a while it was the only way snow could ever go. So rain fell on lying snow for a full
  // seven minutes and removed none of it, which is the other half of the report above: rain in
  // the air, a wet road, and a snowfield underneath all three.
  //
  // ⚠ COMPARED AS A RATIO, NOT A DEPTH. With no snow falling both cases are a pure exponential
  // decay, so after/before is scale-free and the two runs need not start from the same depth —
  // which they cannot be made to, short of a reset hook this module does not have.
  {
    const decayUnder = (weather) => {
      run('snow', 200);                       // build some depth back up
      const before = run('clear', 2).snow;    // two frames to settle, so this is a real reading
      const after = run(weather, 200).snow;
      return before > 0.02 ? after / before : null;
    };
    const clearRatio = decayUnder('clear');
    const rainRatio = decayUnder('rain');
    if (clearRatio != null && rainRatio != null) {
      ok(rainRatio < clearRatio * 0.9,
        'ten seconds of rain took the snow to ' + rainRatio.toFixed(4) + ' of its depth against ' + clearRatio.toFixed(4)
        + ' under clear sky — rain is not melting it, so a downpour leaves the ground white for the full clear-sky thaw.');
      notes.push('10 s decay: clear x' + clearRatio.toFixed(4) + ', rain x' + rainRatio.toFixed(4));
    } else {
      problems.push('the melt case never built enough depth to measure, so nothing checks that rain removes snow.');
    }
  }

  // ── 8. AND A CLIENT THAT HAS JUST OPENED ITS EYES IS HANDED THE GROUND ─────────────────────
  //
  // Everything here integrates forward from where the ground already is, and that used to be ZERO
  // on every page load — so a player logging in ten minutes into a blizzard stood on bare grass
  // beside somebody standing in snow, and the two did not converge until it thawed.
  //
  // ⚠ ONCE, NEVER AGAIN. The server's figure is the day's headline and the renderer's is refined
  // by the cell the player is standing under, so re-seating every push would drag a pilot inside a
  // rain cell back to the global answer several times a second. Both halves are asserted, because
  // a seed that keeps firing looks exactly like a seed that works.
  //
  // ⚠ AND IT GOES LAST, because it writes the module's own accumulator and nothing above would
  // survive that.
  {
    const seeded = run('clear', 1, { wxGround: { wet: 0.4, pond: 0.3, snow: 0.66, fell: 12 } });
    ok(Math.abs(seeded.snow - 0.66) < 0.01,
      'the depth the server sent was not adopted (asked for ' + seeded.snow.toFixed(4) + ' against 0.66) — every client starts bare, which is the bug.');
    ok(Math.abs(seeded.wet - 0.4) < 0.05,
      'the wetness the server sent was not adopted (' + seeded.wet.toFixed(4) + ' against 0.4).');
    const again = run('clear', 1, { wxGround: { wet: 0, pond: 0, snow: 0.05, fell: 0 } });
    ok(again.snow > 0.5,
      'a second ground packet re-seated the accumulator (' + again.snow.toFixed(4) + ') — it is meant to seed once and integrate from there, '
      + 'or a local cell is overwritten by the global answer on every push.');
    notes.push('seed: adopted 0.66 -> ' + seeded.snow.toFixed(4) + ', second packet ignored (' + again.snow.toFixed(4) + ')');
  }
} finally {
  ws.RENDER_TUNE.gl = was.gl; ws.RENDER_TUNE.glFloor = was.floor;
  ws.RENDER_TUNE.glSnow = was.snow; ws.RENDER_TUNE.snowForce = was.force; ws.RENDER_TUNE.glSnowBB = was.bb;
  ws.RENDER_TUNE.glTracks = tWas;
  ws.installGLWorld(null);
  globalThis.performance = clock; Date.now = realDateNow;
}


// ── 9. AND EVERY SEAT THAT PAINTS THE WINDSHIELD ACTUALLY PASSES IT ──────────────────────────
//
// The seed above is worth nothing to a seat that never receives one, and there are five call
// sites across four view files plus the server end. A missed one is not an error anywhere: that
// seat simply starts bare, for ever, and looks exactly like the seat that works until you put two
// players side by side. Same shape as 'gl:opts' one layer over — an allowlist handing a bag on,
// where a key added at one end and not the other is dropped silently in the middle.
//
// ⚠ PAIRED WITH 'wxField', NEVER COUNTED. Both ride the same object literal at every site, so the
// question is "does this literal carry both" rather than "how many are there" — a budget passes a
// new site the moment somebody deletes an old one.
{
  const fs = await import('node:fs');
  const SEATS = [
    'client/game/js/panels/cockpit.js',
    'client/game/js/panels/cab-view.js',
    'client/game/js/panels/freelook-view.js',
    'client/game/js/panels/helm-view.js',
    // ⚠ A HARD-CODED LIST IS A LIST SOMEBODY HAS TO REMEMBER TO ADD TO, and the fifth seat proved
    // it: `boat-view.js` shipped sending `ground` instead of `wxGround` and this gate — whose
    // entire job is that pairing — could not see the file. Derive it from who calls
    // `windshieldHTML(` if this happens again; for now, a new seat goes here.
    'client/game/js/panels/boat-view.js',
  ];
  let sites = 0;
  for (const f of SEATS) {
    const src = await fs.promises.readFile(f, 'utf8');
    for (const line of src.split(/\r?\n/)) {
      // The declaration of the prop, not a mention of it: a comment about 'wxField' is not a site.
      if (!/(^|[\s{,])wxField\s*:/.test(line)) continue;
      sites++;
      ok(/(^|[\s{,])wxGround\s*:/.test(line),
        f + ' hands the renderer a wxField with no wxGround beside it — that seat starts on dry, bare ground for ever:\n      ' + line.trim());
    }
  }
  ok(sites >= 6, 'only ' + sites + ' wxField hand-offs found across the four seats — the scan has stopped matching, so it is checking nothing.');
  const sky = await fs.promises.readFile('plugins/flight/state.js', 'utf8');
  ok(/\bground:\s*groundAccum\(\)/.test(sky),
    'plugins/flight/state.js never puts the ground on the sky payload — nothing reaches any of the seats above, however well they are wired.');
  const env = await fs.promises.readFile('server/engine/environment.js', 'utf8');
  // ⚠ AND THE RATE HAS TO BE CLOSED OFF BEFORE IT MOVES. groundAccum integrates one constant-rate
  // stretch exactly; without this the whole interval since the last read is integrated at the NEW
  // rate, so a shower that stopped an hour ago is still filling the gutters for anyone who asks.
  const setFrom = env.indexOf('export function setCurrentPrecip');
  const setTo = env.indexOf('export function', setFrom + 24);
  const setBody = env.slice(setFrom, setTo > setFrom ? setTo : setFrom + 600);
  ok(setBody.includes('groundAccum()'),
    'setCurrentPrecip changes the precipitation without bringing the ground up to date first — every rate change is then back-applied to the whole stretch before it.');
  notes.push('seats: ' + sites + ' wxField hand-offs, all carrying wxGround');
}
if (REPORT) for (const n of notes) console.log('   ' + n);
if (problems.length) {
  console.error('✗ snow — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('✓ snow: accumulates under snow and blizzard, thaws rather than switching off, never under rain; '
  + 'both ground layers write uSnow every frame; the scatter carries a per-species hold and the frame\'s own '
  + 'snow colour; glSnow and glSnowBB are both exact.');
