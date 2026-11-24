// GLASS 2 · THE STANDS' CLOSE-UP LEVEL: the fans biggest in the picture drawn as ROOM draws people, with
// figure.js's close-up figure (gl/figure-hd.js), not the crowd's baked fan (gl/fan-vat.js).
//
// The park (gl/ballpark.js) and the rink (gl/arena.js) draw every seat's fan instanced off one bake, posed in the
// vertex shader by gl/crowd.js FAN_GLSL from hashes of his seat. That's right across the stands; the man beside you
// in a seat (stands.js) and a long lens on the stands for the broadcast are close enough to see it's a bake. So the
// biggest few on the screen, over a share of the picture tall (crowdHdLine), up to CROWD_HD.max, are left out of the
// instanced draw and drawn here instead, as the same person:
//
//   · WHO HE IS. Everything FAN_GLSL reads off his seat is read again here, the same hashes in the same order
//     (`ghash` is the shader's `hash` in float32): his side, a woman or not, his build, his hair cropped, long or
//     gone, a cap and its colour, a beard, glasses, his trousers, eyes and hair colour, and his shirt and skin off
//     the instance. That's a settled look (flags.figure's keys, gl/room-people.js lookOf) and ROOM builds him off it.
//     A fan in his club's colour wears the club's jersey, the baseball cut at the park and a hockey sweater at the
//     rink, its stripes in the club's trim; some wear a plain tee in it instead.
//   · WHAT HE'S DOING. FAN_GLSL's weights again (sat one of four ways, a clap, his head in his hands, getting up,
//     on his feet one of five ways), each the same clip (actor3d.js FAN_CLIPS, ROOM's sitting ones) at the same
//     phase, mixed on the pose (actorSkinBlend), with the same bounce, the same head turn toward the play and his
//     mouth open as the bake opens it. So the fan who comes up out of the crowd is the man who was there.
//   · BUILT OFF THE PAGE. As the street's close-up level (gl/street-hd.js): a fan is drawn here only once both his
//     figures are built (figure-ahead.js's worker) and the figure's shader has linked; until then the bake keeps him.
//     `version` moves when one comes ready, and the host's split takes it into its key so it hands him over then.
//
// The host keeps the light and the draw (it has the figure layer and knows its own light); this hands it records
// in the host's own frame, in metres: the park is feet with y up, the rink feet with z up.

import { figurePeople, figureLooks } from './room-people.js';
import { softHead } from '../actor-head.js';
import { figureAhead } from '../figure-ahead.js';
import { figureBuilt, FIGURE_CROWN } from '../figure.js';
import { FAN_CLIPS } from './fan-vat.js';
import { FT_M } from '../../../../shared/world-scale.js';

// `share`: how tall a fan stands in the picture (his FAN_H feet stood, as a share of the picture's height) before he's
// drawn close up, and never under `minPx` device px; `off` the share of that he drops back under, so nobody flickers
// on the line. A share and not pixels, so the TV on a wall makes the same choice as the whole screen: the park's crowd
// cutaway (diamond/camera.js `crowd`) has the nearest fans at about 0.16 of the picture. `max` at once, biggest
// first: 32 fills the front rows of that cutaway (2026-11-15: 12 left most of a long lens to the bake), at 0.15 to
// 0.3 ms each to pose in the browser (40 were 6 to 14 ms a frame). `hdShare` is where he goes from figure.js's `lite` level to its `hd` one. A seated fan is about 0.8 of
// his stood height.
export const CROWD_HD = { on: 1, share: 0.12, minPx: 60, off: 0.8, max: 32, hdShare: 0.5 };
// The line in device px for a picture `h` tall
export const crowdHdLine = (h) => Math.max(CROWD_HD.minPx, CROWD_HD.share * (h || 800));
export const crowdHdStats = { cand: 0, chosen: 0, waiting: 0, poseMs: 0, version: 0 };
globalThis.__crowdHD = { tune: CROWD_HD, stats: crowdHdStats };
// Phones keep the bake, as the street keeps its crowd there.
const PHONE = (() => {
  try {
    const mm = globalThis.matchMedia, sc = globalThis.screen;
    if (typeof mm !== 'function' || !sc) return false;
    return mm('(pointer: coarse)').matches && Math.min(sc.width || 0, sc.height || 0) < 600;
  } catch { return false; }
})();

// ── FAN_GLSL's numbers, on the CPU ──────────────────────────────────────────────────────────────────────────
const f32 = Math.fround, fract = (x) => f32(x - Math.floor(x));
// gl/crowd.js `hash`: q = fract(p.xyx * 0.1031 + (k, m) * 0.00731); q += dot(q, q.yzx + 33.33); fract((q.x + q.y) * q.z)
function ghash(px, py, kx, ky, m) {
  const a = f32(0.1031), b = f32(0.00731);
  let x = fract(f32(f32(px * a) + f32(kx * b))), y = fract(f32(f32(py * a) + f32(ky * b))), z = fract(f32(f32(px * a) + f32(f32(m) * b)));
  const d = f32(f32(f32(x * f32(y + 33.33)) + f32(y * f32(z + 33.33))) + f32(z * f32(x + 33.33)));
  x = f32(x + d); y = f32(y + d); z = f32(z + d);
  return fract(f32(f32(x + y) * z));
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const step = (edge, x) => (x < edge ? 0 : 1);
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// FAN_GLSL's clips by its names: the actor3d.js clip each plays, its seconds a cycle, and its mouth
const CLIP = Object.fromEntries(FAN_CLIPS.map((c) => [c.name, { src: c.src, dur: c.dur, jaw: c.jaw || null }]));

// What doesn't change about a fan: the hashes off his seat and who they make him. `seat` is the two coordinates
// FAN_GLSL hashes (the park's x and z, the rink's x and y).
function traitsOf(sx, sy) {
  const H = (kx, ky, m) => ghash(sx, sy, kx, ky, m);
  return {
    h: H(12.99, 78.23, 43758.5), h2: H(39.35, 11.13, 24634.6), h3: H(53.71, 27.19, 31887.3),
    h4: H(17.31, 63.77, 21357.9), h5: H(71.13, 5.29, 37771.1), h6: H(29.81, 47.53, 17093.7),
    h7: H(83.37, 13.91, 28411.3), h8: H(5.53, 41.9, 19391.7), h9: H(88.1, 23.7, 27109.3),
    hs: H(14.7, 92.1, 11939.3), hc: H(66.3, 8.41, 25117.9), hd: H(3.19, 57.7, 30011.1),
    he: H(47.2, 31.3, 18803.3), hw: H(9.71, 71.9, 22441.7), hg: H(35.9, 2.71, 15559.1),
    lag: 3 * H(31.7, 66.1, 22717.3), fidget: H(44.9, 3.71, 29399.1), side: H(7.17, 91.3, 13371.3), club: H(61.7, 19.3, 15731.9),
    // (not the shader's: the close-up's own picks, which the bake has no say in)
    cut: H(23.9, 77.1, 12011.7), kit: H(91.3, 37.7, 26111.9),
  };
}

// The colours FAN_GLSL gives him, in the host's own space (the park's linear, the rink's as displayed)
const JACKETS = [[0.025, 0.025, 0.03], [0.03, 0.045, 0.09], [0.09, 0.1, 0.06], [0.12, 0.14, 0.18]];
const jacketOf = (h7) => JACKETS[h7 < 0.4 ? 0 : h7 < 0.7 ? 1 : h7 < 0.85 ? 2 : 3];
function coloursOf(T, shirt, skin) {
  const { h, h3, h6, h7, h9 } = T;
  const pants = mix3([0.03, 0.04, 0.07], [0.12, 0.1, 0.07], h), shoes = [0.02 + 0.05 * h, 0.016 + 0.05 * h, 0.012 + 0.05 * h];
  const dark = sstep(0.35, 0.2, (skin[0] + skin[1] + skin[2]) * 0.33);
  const hair0 = h7 < 0.3 ? [0.02 + 0.03 * h, 0.016 + 0.03 * h, 0.012 + 0.03 * h] : h7 < 0.6 ? [0.09, 0.05, 0.025] : h7 < 0.8 ? [0.32, 0.22, 0.1] : h7 < 0.88 ? [0.45, 0.18, 0.06] : [0.3, 0.29, 0.27];
  const hair = mix3(hair0, [0.02, 0.016, 0.012], dark);
  const cap0 = mix3([0.03, 0.04, 0.12], [0.32, 0.03, 0.03], step(0.17, h6)).map((v) => v * (0.8 + 0.4 * h7));
  const cap = step(0.5, h3) ? shirt : cap0;
  const iris0 = h9 < 0.55 ? [0.1, 0.05, 0.025] : h9 < 0.75 ? [0.16, 0.12, 0.05] : h9 < 0.9 ? [0.08, 0.16, 0.26] : [0.1, 0.17, 0.09];
  return { pants, shoes, hair, cap, iris: mix3(iris0, [0.06, 0.03, 0.015], dark) };
}
const toSrgb = (v) => Math.round(255 * clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055, 0, 1));
const near3 = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 0.02;

// His look as a settled figure (gl/room-people.js lookOf), off his traits and the colours he wears. `kit` is how
// his shirt is a club's: { cut, trim } or null.
function figureOf(T, shirt, skin, kit, rgb) {
  const woman = T.hw < 0.42, C = coloursOf(T, shirt, skin);
  // a woman's hair mostly long, a man's cropped, a few long and a few bald
  const hair = woman ? (T.hg < 0.7 ? 2 : 1) : T.hg < 0.14 ? 0 : T.hg < 0.2 ? 2 : 1;
  const cap = T.h6 < 0.34, beard = !woman && T.h7 < 0.25, specs = T.he > 0.91;
  // the bake's build runs slight, average, heavy off h4: a weight, in fifths so fans share meshes
  const weight = Math.round(T.h4 * 5) / 5;
  const cut = kit ? kit.cut : T.h2 < 0.25 ? 'jacket' : T.cut < 0.45 ? 'tee' : T.cut < 0.7 ? 'hoodie' : T.cut < 0.85 ? 'longsleeve' : 'sweater';
  return {
    head: woman ? 3 : Math.min(2, Math.floor(T.h3 * 3)), build: woman ? 'woman' : 'average', weight, age: 0, grit: 0.15,
    // bald is the shortest crop in his skin's colour
    hair_style: hair === 2 ? 3 : (T.hg * 7) % 1 < 0.5 ? 0 : 1, hair: rgb(hair === 0 ? skin.map((v) => v * 0.85) : C.hair),
    hat: cap ? 'cap' : '', ...(cap ? { hat_col: rgb(C.cap) } : {}),
    facial: beard ? (T.h7 < 0.12 ? 'full' : 'trimmed') : 'clean', ...(specs ? { glasses: [24, 24, 28] } : {}),
    skin: rgb(skin), iris: rgb(C.iris), top: rgb(shirt), shirt: rgb(shirt), legs: rgb(C.pants), shoes: rgb(C.shoes),
    trim: rgb(kit?.trim || shirt), cut, gear: false, bottoms: '', scarf: '',
    fabric_top: cut === 'sweater' ? 'knit' : 'plain', fabric_legs: 'denim', fabric_shoes: 'canvas',
  };
}

// What he's doing at t, as FAN_GLSL has it: the clips and their weights ([[actor3d clip, phase, weight], …]), how
// far his mouth is open, his bounce (ft) and how far up he is. `roar` and `anti` are his side's level as he hears
// it and the other side's; `base` the pose he rests in (0 sat, 1 stood, 2 cheering); `move` 0 for less motion.
function doingOf(T, roar, anti, base, towelOn, t, move) {
  const thr = 0.2 + 0.72 * Math.sqrt(T.h2), up = sstep(thr, thr + 0.12, roar);
  const k = Math.max(Math.min(base, 1) * 0.5, up), s = clamp(k * 2, 0, 1), c = clamp(k * 2 - 1, 0, 1);
  const clap = sstep(thr * 0.5, thr * 0.5 + 0.1, roar) * step(T.hd, 0.65);
  const despair = (1 - clap) * sstep(0.55, 0.75, anti) * step(T.hd, 0.33) * (1 - sstep(0.1, 0.25, roar));
  const pace = (0.85 + 0.3 * T.h8) * move, at = T.h * 7;
  const rest = 1 - clap - despair, blend = sstep(0, 0.35, s), sitW = (1 - blend) * (1 - c);
  const sv = T.hs < 0.4 ? 'sit' : T.hs < 0.65 ? 'rest' : T.hs < 0.8 ? 'lean' : 'fold';
  const towel = towelOn && T.he < 0.7;
  const cv = towel ? 'towel' : T.hc < 0.35 ? 'cheer' : T.hc < 0.65 ? 'clap' : T.hc < 0.85 ? 'fist' : 'cup';
  const loop = (name, pc) => t / CLIP[name].dur * pc + at;
  const parts = [[sv, loop(sv, pace), sitW * rest], ['sitClap', loop('sitClap', pace), sitW * clap], ['despair', loop('despair', pace), sitW * despair],
    ['rise', s, blend * (1 - c)], [cv, loop(cv, (0.85 + 0.3 * T.h9) * move), c]];
  const blendList = [];
  let open = 0, top = null;
  for (const [name, ph, w] of parts) {
    if (!(w > 0.001)) continue;
    const C = CLIP[name];
    blendList.push([C.src, ph, w]);
    if (C.jaw) open += w * C.jaw(((ph % 1) + 1) % 1);
    if (!top || w > top[1]) top = [C.src, w];
  }
  const joy = up * move, bounce = joy * 0.22 * Math.pow(0.5 + 0.5 * Math.sin(t * 7 * (0.85 + 0.3 * T.h8) + T.h * 6.283), 1.6);
  return { blend: blendList, clip: top ? top[0] : 'fanSit', open: clamp(open, 0, 1), bounce, up };
}

// The two hosts. `seat(src, o)` is the two coordinates FAN_GLSL hashes; `place(src, o)` his origin and turn as
// the host's basis for ROOM's frame (room x, y, z as host axes) and his tread (metres); `space` how its colours are.
const HOSTS = {
  // feet, y up, a fan facing (sin w, 0, cos w) (gl/crowd.js CROWD_VS)
  park: {
    seat: (A, o) => [A[o], A[o + 2]],
    basis: (w) => { const c = Math.cos(w), s = Math.sin(w); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; },
    up: [0, 1, 0], space: 'linear',
  },
  // feet, z up, a fan facing (cos w, sin w, 0) (gl/arena-crowd.js RINK_CROWD_VS)
  rink: {
    seat: (A, o) => [A[o], A[o + 1]],
    basis: (w) => { const c = Math.cos(w), s = Math.sin(w); return [[-s, c, 0], [0, 0, 1], [c, s, 0]]; },
    up: [0, 0, 1], space: 'display',
  },
};
// ROOM's frame, about each fan's own origin: he's posed facing +z at the origin and carried to his seat after
const FRAME = { world: (a, b, h) => [a, h, b], r: [1, 0, 0], f: [0, 0, 1], baseAt: () => 0 };

// `host` 'park' or 'rink'; `layer()` the host's figure layer (gl/figure-hd.js createFigureLayer) or null while it
// has none, whose `ready` says the shader has linked.
export function createCrowdHD(hostName, layer) {
  const host = HOSTS[hostName];
  const rgb = host.space === 'linear' ? (c) => c.map(toSrgb) : (c) => c.map((v) => Math.round(255 * clamp(v, 0, 1)));
  const fans = new Map();          // by id: { T, figure, body, ready, sig }
  const held = new Set();
  // `wanted` once anybody has been big enough: the layer (and figure-hd.js's 114k-character shader) isn't asked for before
  let chosen = [], version = 0, layerWas = false, wanted = false;
  const pending = new Set();       // ids whose figures are being built

  const idOf = (A, o) => `fan|${hostName}|${A[o].toFixed(1)},${A[o + 1].toFixed(1)},${A[o + 2].toFixed(1)}`;
  // His record: who he is, settled once (and again when what he wears changes: the clubs' colours arrive late)
  function fanOf(A, o, ctx) {
    const id = idOf(A, o), [sx, sy] = host.seat(A, o);
    let F = fans.get(id);
    const T = F ? F.T : traitsOf(sx, sy);
    const { shirt, away, kit } = ctx.dress(T, A, o);
    const skin = [A[o + 8], A[o + 9], A[o + 10]];
    const sig = shirt.map((v) => v.toFixed(3)).join() + (kit ? kit.cut + kit.trim.map((v) => v.toFixed(3)).join() : '');
    if (!F || F.sig !== sig) {
      const figure = figureOf(T, shirt, skin, kit, rgb);
      const body = { id, sex: softHead(figure.head) ? 'female' : 'male', figure, sculpt: true, at: [0, 0], yaw: 0, seated: false };
      F = { id, T, figure, body, sig, ready: false, keys: figureLooks(body), away, level: 'lite' };
      fans.set(id, F);
    }
    F.away = away;
    return F;
  }
  function lookReady(F) {
    if (F.ready) return true;
    let ok = true;
    for (const k of F.keys) if (!figureAhead(k)) ok = false;
    F.ready = ok;
    if (ok) pending.delete(F.id); else pending.add(F.id);
    return ok;
  }

  // Call once a frame: moves `version` when a fan waiting for his figure has it, or the shader has linked, so the
  // host's split hands him over.
  function poll() {
    const L = wanted ? layer() : null, on = !!(L && L.ready);
    if (on !== layerWas) { layerWas = on; version++; }
    for (const id of pending) {
      const F = fans.get(id);
      if (!F) { pending.delete(id); continue; }
      if (F.keys.every((k) => figureBuilt(k))) { F.ready = true; pending.delete(id); version++; }
    }
    crowdHdStats.version = version;
    return version;
  }

  // From the host's split: `cands` [{ src, o, px }] are the fans in the picture at least crowdHdLine · off tall
  // (`px` as the host measures him stood), and `ctx.h` the picture's height. Returns those drawn here, which the host
  // leaves out of its own draw.
  function pick(cands, ctx) {
    chosen = [];
    if (cands.length && CROWD_HD.on && !PHONE) wanted = true;
    const L = wanted ? layer() : null;
    if (!CROWD_HD.on || PHONE || !L || !L.ready) { held.clear(); crowdHdStats.cand = cands.length; crowdHdStats.chosen = 0; return chosen; }
    const list = [], line = crowdHdLine(ctx.h), hdPx = CROWD_HD.hdShare * (ctx.h || 800);
    for (const c of cands) {
      const id = idOf(c.src, c.o), need = held.has(id) ? line * CROWD_HD.off : line;
      if (c.px >= need) list.push(c);
    }
    list.sort((a, b) => b.px - a.px);
    held.clear();
    let waiting = 0;
    for (const c of list) {
      // the biggest `max` and a few behind them asked for, no more: a seat sees hundreds over the line, and each
      // one asked for is two figures for the worker to build
      if (chosen.length >= CROWD_HD.max || chosen.length + waiting >= CROWD_HD.max * 1.5) break;
      const F = fanOf(c.src, c.o, ctx);
      if (!lookReady(F)) { waiting++; continue; }
      // the lite level unless he's big, with a margin either way
      F.level = c.px > hdPx * (F.level === 'hd' ? 0.85 : 1) ? 'hd' : 'lite';
      c.fan = F; held.add(F.id); chosen.push(c);
    }
    crowdHdStats.cand = list.length; crowdHdStats.chosen = chosen.length; crowdHdStats.waiting = waiting;
    return chosen;
  }

  // This frame's records for the chosen, in the host's frame (metres): ctx gives each fan's roar as he hears it
  // (`heard(F, away)`), `base(c)`, `look(c, F)` (his head's yaw), `towel`, `t` and `move`.
  function records(ctx) {
    if (!chosen.length) return [];
    const t0 = performance.now(), t = ctx.t, out = [];
    for (const level of ['hd', 'lite']) {
      const group = chosen.filter((c) => c.fan.level === level);
      if (!group.length) continue;
      const bodies = group.map((c) => {
        const F = c.fan, T = F.T, A = c.src, o = c.o;
        const D = doingOf(T, ctx.heard(F, F.away), ctx.heard(F, 1 - F.away), ctx.base(c), ctx.towel, t, ctx.move);
        c.doing = D;
        const scale = Math.abs(A[o + 7]) * (0.95 + 0.1 * T.h5);
        return { ...F.body, blend: D.blend, clip: D.clip, phase: 0, look: [ctx.look(c, F), 0], mouth: { open: D.open }, height: FIGURE_CROWN * scale };
      });
      const recs = figurePeople(FRAME, bodies, t, { level });
      for (let i = 0; i < recs.length; i++) out.push(carry(recs[i], group[i]));
    }
    crowdHdStats.poseMs = performance.now() - t0;
    return out;
  }
  // A record posed at ROOM's origin, carried onto his seat: every bone's rows, and the cloth's lag and bounces with them
  function carry(r, c) {
    const A = c.src, o = c.o, B = host.basis(A[o + 3]), up = host.up, b = c.doing.bounce;
    const T = [(A[o] + up[0] * b) * FT_M, (A[o + 1] + up[1] * b) * FT_M, (A[o + 2] + up[2] * b) * FT_M];
    const src = r.rows, rows = new Float32Array(src.length);
    // B[k] is room axis k in host coordinates: host = Σ_k B[k] · room_k
    for (let bn = 0; bn < src.length / 12; bn++) for (let i = 0; i < 3; i++) for (let cc = 0; cc < 4; cc++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += B[k][i] * src[bn * 12 + k * 4 + cc];
      rows[bn * 12 + i * 4 + cc] = s + (cc === 3 ? T[i] : 0);
    }
    const turn = (v) => (v ? [0, 1, 2].map((i) => B[0][i] * v[0] + B[1][i] * v[1] + B[2][i] * v[2]) : v);
    // (the coat's hem rests on a floor along Y; nobody here wears one long enough for it)
    return { ...r, rows, sway: turn(r.sway), jiggle: turn(r.jiggle), seatJ: turn(r.seatJ), hairJ: turn(r.hairJ), hairJ2: turn(r.hairJ2), floor: hostName === 'park' ? T[1] : -1e4 };
  }

  return {
    poll, pick, records,
    get count() { return chosen.length; },
    get version() { return version; },
    // forget everybody: a new house, a new night
    clear() { fans.clear(); held.clear(); pending.clear(); chosen = []; version++; },
  };
}

// What a fan wears, per host, as FAN_GLSL dresses him: { shirt, away, kit } off his traits and his instance.
// The park: `fanKit` { home, away, on } linear, the clubs' colours a third of the fans wear and every visitor.
export function parkDress(fanKit) {
  return (T, A, o) => {
    const away = step(T.side, A[o] > 0 ? 0.16 : 0.04);
    const club = fanKit.on * Math.max(away, step(T.club, 1 / 3));
    if (club > 0.5) {
      const shirt = away ? fanKit.away.slice() : fanKit.home.slice();
      // most in the club's jersey; the rest in a tee of its colour
      return { shirt, away, kit: T.kit < 0.65 ? { cut: 'jersey', trim: shirt.map((v) => v * 0.35) } : null };
    }
    return { shirt: T.h2 < 0.25 ? jacketOf(T.h7) : [A[o + 4], A[o + 5], A[o + 6]], away, kit: null };
  };
}
// The rink: the shirt is on the instance (gl/arena-crowd.js crowdInstances), a visitor's size negative. `kits` is
// { h: [jersey, trim], a: [jersey, trim] } as displayed: one in a club's jersey colour wears its sweater with the
// trim's stripes, and some in the trim wear the sweater the other way round.
export function rinkDress(kits) {
  return (T, A, o) => {
    const away = A[o + 7] < 0 ? 1 : 0, shirt = [A[o + 4], A[o + 5], A[o + 6]], K = kits && (away ? kits.a : kits.h);
    let kit = null;
    if (K && near3(shirt, K[0])) kit = { cut: 'hockey', trim: K[1] };
    else if (K && near3(shirt, K[1]) && T.kit < 0.5) kit = { cut: 'hockey', trim: K[0] };
    return { shirt, away, kit };
  };
}
// His head's turn in the park (CROWD_VS): toward the play (`look` { x, z, w }) as far as his interest takes him, and a
// wander for one in eight. In the rink only the wander, for one in five.
export function parkLook(look, t, move) {
  return (c, F) => {
    const A = c.src, o = c.o, T = F.T, cw = Math.cos(A[o + 3]), sw = Math.sin(A[o + 3]);
    const dx = look.x - A[o], dz = look.z - A[o + 2], want = Math.atan2(cw * dx - sw * dz, sw * dx + cw * dz);
    const fidget = step(T.fidget, 0.125);
    return clamp(want, -0.9, 0.9) * look.w * (0.45 + 0.55 * T.h3) + 0.22 * fidget * move * Math.sin(t * 0.31 * (0.6 + 0.8 * T.h9) + T.h * 6.283) * (1 - 0.7 * look.w);
  };
}
export function rinkLook(t, move) {
  return (c, F) => { const T = F.T; return 0.3 * step(T.fidget, 0.2) * move * Math.sin(t * 0.31 * (0.6 + 0.8 * T.h9) + T.h * 6.283); };
}
// The roar as he hears it. The park: each side's level at the four lags (gl/crowd.js createRoarLag), and he sits
// between two of them by his own lag. The rink: everybody at once, [home, away].
export function parkHeard(lag) {
  return (F, away) => {
    const l = F.T.lag, r = [0, 1, 2, 3].map((i) => lag.home[i] + (lag.away[i] - lag.home[i]) * away);
    const a = l < 1 ? r[0] : l < 2 ? r[1] : r[2], b = l < 1 ? r[1] : l < 2 ? r[2] : r[3];
    return a + (b - a) * fract(l);
  };
}
export function rinkHeard(roar) { return (F, away) => roar[0] + (roar[1] - roar[0]) * away; }
