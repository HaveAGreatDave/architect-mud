// A CAT'S DAY (docs/proposals/pets.md, "What he does on his own"): what a pet cat is doing at any moment, worked out
// from its id and the clock alone. The server (plugins/pets) and every client that draws the cat (gl/room-beasts.js)
// call the same function, so they agree on whether he's asleep or grooming without a message between them.
//
// The day is cut into blocks of four minutes. Each block has a state (asleep, resting, sitting up, about, flopped
// out) drawn by the hour: more sleep in the small hours, more going about at dawn and dusk, when cats are busiest.
// Each block is cut again into 20-second turns, and each turn picks what he does in that state: a sitting cat sits,
// grooms, scratches, yawns, watches something, sits up; a cat that's about sniffs, stretches, claws the rug, stalks,
// wanders somewhere else, and at dawn and dusk tears round the room. Waking up starts with a stretch.
//
// Where he is: `spot` is a key the client hashes into a place on the room's floor (beastSpot). It changes each block,
// and on each turn he wanders while he's about, so he walks from one to the next.
//
// A beat from the server (greeting somebody at the door, being stroked, having had enough) goes over this; the
// client plays it until it's over and goes back to the day.
//
// Nothing here knows any particular cat. The personality's `outgoing` and `impulsive` (0..1) tilt the weights.

import { COUNTER_H, roomFree, onFoot } from './room-layout.js';

export const BLOCK_MS = 4 * 60 * 1000;
export const TURN_MS = 20 * 1000;

// FNV-1a, then murmur3's finaliser: without it two keys that differ in their last digit (block 7477729 and 7477730)
// hash a few thousandths apart, and he was in the same state for hours
const hash = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
function pick(weights, r) {
  let total = 0;
  for (const k in weights) total += Math.max(0, weights[k]);
  let x = r * total;
  for (const k in weights) { x -= Math.max(0, weights[k]); if (x <= 0) return k; }
  return Object.keys(weights)[0];
}
// the hour of day this block began at, from `hour` now
const hourAt = (hour, ago) => ((hour - ago / 3.6e6) % 24 + 24) % 24;
// A cat's day, after Smit et al. (2024), who put accelerometer collars on 28 pet cats: lying about 37% of the day,
// sitting 37%, standing 13%, eating about 5%, truly active only about 3%, with its bursts at dawn and dusk (5 to 9 in
// the morning and 4 to 9 in the evening, by the season). Most of the lying is sleep, 12 to 16 hours of it. So the day
// is mostly lying and sitting, a little standing about, and the wandering, the play and the zoomies come at the ends.
// Measured over days (blockState below): about 13 to 14 hours asleep, in bouts of about an hour, mostly at night and
// through the middle of the day.
const dusky = (h) => (h >= 5 && h < 8.5) || (h >= 16.5 && h < 21);
const night = (h) => h < 5 || h >= 23;

// What he goes to when he changes what he's doing, by the hour
function stateWeights(hour, nature) {
  const out = nature.outgoing ?? 0.5, imp = nature.impulsive ?? 0.5;
  return night(hour) ? { sleep: 0.56, rest: 0.15, sit: 0.17, about: 0.08, flop: 0.04 }
    : dusky(hour) ? { sleep: 0.2, rest: 0.13, sit: 0.27, about: 0.34 + 0.1 * imp, flop: 0.06 }
      : { sleep: 0.34, rest: 0.17, sit: 0.29 + 0.06 * out, about: 0.12 + 0.05 * imp, flop: 0.08 };
}
// How likely he is to carry on as he is into the next block. A cat sleeps in bouts of about an hour, not four minutes
// at a time, and rests and sits a while once he's settled; going about is the shortest. Each block mostly carries on
// the last, and only when it doesn't does the hour choose what's next.
const STAY = { sleep: 0.935, rest: 0.82, sit: 0.8, about: 0.62, flop: 0.8 };
// The chain runs from a fixed start every EPOCH blocks (three hours), so a block's state is a pure function of the cat,
// the clock and the hour, the same for the server and every client, and costs at most an epoch's worth of steps
// (remembered, so a frame doesn't run it again).
const EPOCH = 45;
const _states = new Map();
/** What state a block is in: 'sleep', 'rest', 'sit', 'about' or 'flop'. */
export function blockState(id, block, hour, nature = {}) {
  const key = id + ':' + block + ':' + Math.round(hour * 15) + ':' + (nature.outgoing ?? '') + ':' + (nature.impulsive ?? '');
  const had = _states.get(key);
  if (had) return had;
  const e0 = Math.floor(block / EPOCH) * EPOCH, step = BLOCK_MS / 3.6e6;
  let st = null;
  for (let j = e0; j <= block; j++) {
    if (st && hash(id + ':s' + j) < STAY[st]) continue;
    st = pick(stateWeights(((hour - (block - j) * step) % 24 + 24) % 24, nature), hash(id + ':b' + j));
  }
  if (_states.size > 4000) _states.clear();
  _states.set(key, st);
  return st;
}

// what each state does on a turn. Asleep, now and then he dreams (paws and whiskers going); sat, he may wash the base
// of a hind leg held straight up (the cello), shake his head, or give somebody the slow blink; about, he rubs his cheek
// on the corner of something (`mark`), and once in a long while brings up a hairball (about one day in two); flopped
// out, he rolls about on his back
const HAIRBALL = 0.0012;
function turnAct(state, id, block, turn, hour, nature) {
  const r = hash(id + ':t' + block + ':' + turn), imp = nature.impulsive ?? 0.5, out = nature.outgoing ?? 0.5;
  switch (state) {
    case 'sleep': return hash(id + ':dr' + block + ':' + turn) < 0.22 ? 'dream' : 'sleep';
    case 'flop': return pick({ flop: 0.78, roll: 0.22 }, r);
    case 'rest': return pick({ loaf: 0.68, knead: 0.14, flank: 0.18 }, r);
    case 'sit': return pick({ sit: 0.28, groom: 0.18, scratch: 0.07, yawn: 0.07, watch: 0.16, situp: 0.05, cello: 0.06, shake: 0.04, slowblink: 0.03 + 0.04 * out, yowl: night(hour) ? 0.09 : 0 }, r);
    default: return pick({ stand: 0.18, sniff: 0.16, stretch: 0.07, claw: 0.09, stalk: 0.07 + 0.06 * imp, wander: 0.22, mark: 0.08, shake: 0.03, hairball: HAIRBALL, zoomies: dusky(hour) ? 0.14 + 0.1 * imp : 0 }, r);
  }
}

/**
 * What the cat `id` is doing at `now` (ms) with the hour of the game's day `hour`:
 * { state, act (a clip name in gl/cat-clips.js, or 'wander' / 'zoomies' for a move), since (ms the act began),
 *   spot (a key for where he's settled), turn, block, asleep }.
 */
export function catLife(id, now, hour = 13, nature = {}) {
  const block = Math.floor(now / BLOCK_MS), turn = Math.floor((now - block * BLOCK_MS) / TURN_MS);
  const h0 = hourAt(hour, now - block * BLOCK_MS);
  const state = blockState(id, block, h0, nature), was = blockState(id, block - 1, hourAt(hour, now - (block - 1) * BLOCK_MS), nature);
  let act = turnAct(state, id, block, turn, h0, nature);
  // waking: the first turn after sleep or rest is a stretch, unless he's going back to it
  if (turn === 0 && (was === 'sleep' || was === 'rest') && state !== 'sleep' && state !== 'rest') act = 'stretch';
  // where he is: the block's spot, or the last turn he wandered to while about. A settled cat stays where it settled
  // for as long as it stays settled the same way: a long sleep is one spot, not a new bed every four minutes
  let first = block;
  if (state !== 'about') for (let k = 1; k <= 75; k++) { if (blockState(id, block - k, hourAt(hour, now - (block - k) * BLOCK_MS), nature) !== state) break; first = block - k; }
  let spot = id + ':' + first;
  if (state === 'about') for (let k = turn; k >= 0; k--) if (turnAct(state, id, block, k, h0, nature) === 'wander') { spot = id + ':' + block + ':' + k; break; }
  return { state, act, since: block * BLOCK_MS + turn * TURN_MS, spot, turn, block, asleep: state === 'sleep' };
}

// ── up on things ───────────────────────────────────────────────────────────────────────────────────
// A cat spends as much of the day up on the furniture as on the floor: asleep on the bed, loafed on the sofa, sat on
// the counter or the top of a cupboard watching the room. Which piece is worked out here from the room's layout
// (client/shared/room-layout.js roomLayout: its `placed` pieces) and the block's spot key, so the server's words
// (plugins/pets) and every client's picture (gl/room-beasts.js) pick the same one. Where on its top he settles, and the
// way he jumps up, are the picture's own.
//
// Only a piece standing on the floor counts, with a flat top big enough to settle on and low enough to jump to. How
// high a cat can jump goes down as it gets heavier (`catLeap`). Nothing on a worktop, nothing hung, nothing in the
// en-suite, and nothing he shouldn't be on (the hob, the sink, a screen).

// The highest top a cat can jump to from the floor in one go, metres. A fit cat clears five times its height; a fat
// one doesn't try.
export function catLeap(look = {}) {
  const b = look.build || {}, heavy = Math.max(0, (b.belly ?? 1) - 1) + 0.5 * Math.max(0, (b.pouch ?? 1) - 1);
  return Math.max(0.6, Math.min(1.9, 1.75 - 0.8 * heavy));
}
// what each kind of piece offers a cat, and the top he'd be on, metres (null: the piece's own height)
const PERCH = {
  bed: { top: (p) => (p.form === 'mattress' ? 0.24 : 0.55), w: { sleep: 5, rest: 3, flop: 4, sit: 1 } },
  sofa: { top: (p) => (p.form === 'lounger' ? 0.4 : 0.44), w: { sleep: 3, rest: 3, flop: 3, sit: 1.2 } },
  bench: { top: () => 0.46, w: { sleep: 0.6, rest: 1, flop: 0.6, sit: 1 } },
  seat: { top: (p) => (p.form === 'stool' || p.form === 'stools' ? null : 0.46), w: { sleep: 1.2, rest: 1.2, flop: 0.3, sit: 0.8 } },
  table: { top: () => null, w: { sleep: 0.4, rest: 1.2, flop: 0.6, sit: 1.6 } },
  surface: { top: () => null, w: { sleep: 0.3, rest: 1.5, flop: 0.4, sit: 2 } },
  cabinet: { top: () => null, w: { sleep: 0.6, rest: 1.6, flop: 0.3, sit: 2 } },
  store: { top: () => null, w: { sleep: 0.8, rest: 2, flop: 0.3, sit: 2.4 } },
  wardrobe: { top: () => null, w: { sleep: 1.5, rest: 2.5, flop: 0, sit: 3 } },
  cold: { top: () => null, w: { sleep: 0.5, rest: 2, flop: 0, sit: 2.5 } },
  small: { top: () => null, w: { sleep: 0.2, rest: 0.6, flop: 0, sit: 1.2 } },
  deck: { top: () => null, w: { sleep: 0.4, rest: 1, flop: 0, sit: 1 } },
  // the kitchen sink's worktop: never somewhere he settles, only where he goes to drink from the tap when his water
  // bowl's empty (catAtBowls `tap`)
  sink: { top: () => null, w: { sleep: 0, rest: 0, flop: 0, sit: 0 } },
};
const SKIP_FORM = new Set(['pcdesk', 'banquette']);
// how much room each state needs on top, metres across its narrow way
const ROOM_FOR = { sleep: 0.36, flop: 0.42, rest: 0.26, sit: 0.22 };
const unitsOf = (L) => (L?.spec?.unit === 'ft' ? 3.2808 : 1);
/**
 * Every top a cat could be on in this room: [{ id, name, arche, u, v, w, d, turn, top, box, free }] in the room's own
 * units. `free` is the stretch of the top along its width with nothing stood on it, [x0, x1] across the piece.
 */
export function catPerches(L, look = {}) {
  if (!L?.placed) return [];
  const k = unitsOf(L), leap = catLeap(look) * k, out = [];
  // a flat's kitchen counter is built in (the room's plan), not a placed piece: the same worktop roomLayout stands a
  // kettle on (counterBase there), turned to run along the kitchen
  const c = L.spec?.plan?.counter, pieces = [...L.placed];
  if (c) pieces.push({ id: 'counter', name: 'kitchen counter', arche: 'surface', form: 'counter', u: (c[0] + c[1]) / 2, v: (c[2] + c[3]) / 2, turn: 90, w: c[3] - c[2], d: c[1] - c[0], h: COUNTER_H * k });
  for (const p of pieces) {
    const P = PERCH[p.arche];
    if (!P || p.on || p.annex || SKIP_FORM.has(p.form) || p.keypad || p.lab || p.rise) continue;
    if (p.arche === 'cabinet' && p.form !== 'vitrine' && p.form !== 'humidor') continue;   // hung on the wall
    if (p.arche === 'sink' && p.form !== 'kitchen') continue;   // a basin hangs on the wall; a vanity's in the en-suite
    const t0 = P.top(p), top = (t0 == null ? p.h : t0 * k) + (p.y0 || 0);
    if (!(top > 0.15 * k) || top > leap) continue;
    if (Math.min(p.w, p.d) < 0.3 * k) continue;
    // what's stood on it takes its share of the top
    const hw = p.w / 2, taken = L.placed.filter((q) => q.on === p.id).map((q) => {
      const [fu, fv] = [Math.sin((p.turn || 0) * Math.PI / 180), -Math.cos((p.turn || 0) * Math.PI / 180)];
      const x = (q.u - p.u) * -fv + (q.v - p.v) * fu;
      return [x - q.w / 2 - 0.08 * k, x + q.w / 2 + 0.08 * k];
    });
    // the widest stretch with nothing on it
    let free = [-hw, hw];
    if (taken.length) {
      const edges = [-hw, ...taken.flat().map((x) => Math.max(-hw, Math.min(hw, x))), hw].sort((a, b) => a - b);
      let best = null;
      for (let i = 0; i + 1 < edges.length; i++) {
        const a = edges[i], b = edges[i + 1], mid = (a + b) / 2;
        if (taken.some(([x0, x1]) => mid > x0 && mid < x1)) continue;
        if (!best || b - a > best[1] - best[0]) best = [a, b];
      }
      if (!best) continue;
      free = best;
    }
    // a sun lounger's back isn't behind the seat but up at its head end, five steps rising off the flat (gl/room-decor.js
    // lounger: the last 0.62 m of its length): the top is only the flat part, or he lands in the steps and sinks into them
    const head = p.form === 'lounger' ? Math.min(0.64 * k, p.w / 2) : 0;
    if (head) free = [Math.max(free[0], -hw + head), free[1]];
    // a platform bed's width takes in the shelves either side of its headboard: its mattress is 0.42 m in from each
    // side (gl/room-fittings.js platform), and the top is only that
    const shelf = p.form === 'platform' ? Math.min(0.42 * k, hw - 0.2 * k) : 0;
    if (shelf) free = [Math.max(free[0], -hw + shelf), Math.min(free[1], hw - shelf)];
    if (free[1] - free[0] < 0.3 * k) continue;
    const face = [Math.sin((p.turn || 0) * Math.PI / 180), -Math.cos((p.turn || 0) * Math.PI / 180)];
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, bw = (q ? p.d : p.w - head - 2 * shelf) / 2, bd = (q ? p.w - head - 2 * shelf : p.d) / 2;
    const cu = p.u + face[1] * -head / 2, cv = p.v + face[0] * head / 2;
    // a chair's or a sofa's back: which way the seat faces (its back is behind) and how high the back stands, so he
    // gets up from the front or a side, and over the top of the back if that's the only way, never through it
    const backed = !head && (p.arche === 'seat' || p.arche === 'sofa') && p.h + (p.y0 || 0) > top + 0.12 * k;
    out.push({ id: p.id, name: p.name, arche: p.arche, form: p.form, u: p.u, v: p.v, w: p.w, d: p.d, turn: p.turn || 0, top, free,
      box: [cu - bw, cu + bw, cv - bd, cv + bd], face, backTop: backed ? p.h + (p.y0 || 0) : null });
  }
  return out;
}
/**
 * The piece the cat is up on for this block, or null for the floor: { ...perch, at: [u, v] where on its top }. The
 * same for the server and every client given the same room. Only a settled state goes up (asleep, resting, sat,
 * flopped out); while he's about he's on the floor.
 */
export function catPerchOf(L, life, look = {}) {
  if (!life || life.state === 'about') return null;
  const st = life.state, need = (ROOM_FOR[st] || 0.25) * unitsOf(L);
  const r = hash(life.spot + ':up');
  // how often a settled cat is up on something rather than on the floor
  if (r > ({ sleep: 0.62, rest: 0.55, sit: 0.6, flop: 0.45 }[st] ?? 0.5)) return null;
  const all = catPerches(L, look).filter((p) => (PERCH[p.arche].w[st] || 0) > 0 && Math.min(p.free[1] - p.free[0], p.d) >= need);
  if (!all.length) return null;
  // each kind weighs the same however many of it there are: a room of six dining chairs isn't six times a bed
  const per = {};
  for (const p of all) per[p.arche] = (per[p.arche] || 0) + 1;
  const weights = Object.fromEntries(all.map((p, i) => [i, PERCH[p.arche].w[st] / Math.sqrt(per[p.arche])]));
  const p = all[+pick(weights, hash(life.spot + ':on'))];
  // where on it: along the free stretch, and across its depth (a sofa's or a chair's seat is the front of it, clear
  // of the back)
  const k = unitsOf(L), a = hash(life.spot + ':x'), b = hash(life.spot + ':z'), m = need / 2 + 0.04 * k;
  const x = p.free[0] + m + (p.free[1] - p.free[0] - 2 * m) * a;
  const z0 = p.arche === 'sofa' && p.form !== 'lounger' ? -p.d / 2 + 0.42 * k : p.backTop ? -p.d / 2 + Math.max(m, 0.2 * k) : -p.d / 2 + m, z1 = p.d / 2 - m;
  const z = z1 > z0 ? z0 + (z1 - z0) * b : 0;
  const t = (p.turn || 0) * Math.PI / 180, fu = Math.sin(t), fv = -Math.cos(t);
  return { ...p, at: [p.u - fv * x + fu * z, p.v + fu * x + fv * z] };
}
/** What a piece is called in a sentence: its own name when it's a plain one (a "card chair", a "platform bed"), else its
 * kind; a brand name off a label ("polaris executive cassette theatre") reads wrong said of a cat sitting on it. */
export function perchWord(p) {
  const n = String(p?.name || '').trim().replace(/^(the|a|an)\s+/i, '').toLowerCase();
  if (n && n.split(/\s+/).length <= 3 && n.length <= 18) return n;
  return ({ bed: 'bed', sofa: 'sofa', bench: 'bench', seat: 'chair', table: 'table', surface: 'counter', cabinet: 'cabinet', store: 'shelves', wardrobe: 'wardrobe', cold: 'fridge', small: 'side table', deck: 'cabinet under the TV', sink: 'sink', prop: 'stand' })[p?.arche] || 'furniture';
}

// ── marking ────────────────────────────────────────────────────────────────────────────────────────
// Going about, a cat rubs the side of his face along the corner of the furniture, leaving his smell on it (bunting).
// Which corner of which piece is picked here from the room and the turn, so the words and the picture agree:
// { id, name, arche, corner: [u, v], at: [u, v] where he stands, face: [u, v] what he rubs }, or null.
const MARK_SKIP = new Set(['screen', 'cabinet', 'top', 'shower', 'toilet', 'urinal', 'stall']);
export function catMarkOf(L, life) {
  if (!L?.placed || life?.act !== 'mark') return null;
  const k = unitsOf(L), F = onFoot(L);
  const all = L.placed.filter((p) => !p.on && !p.annex && !MARK_SKIP.has(p.arche) && p.h > 0.3 * k && Math.min(p.w, p.d) > 0.25 * k);
  if (!all.length) return null;
  const r = hash(life.spot + ':mark:' + life.since);
  for (let i = 0; i < 6; i++) {
    const p = all[Math.floor(hash(r + ':' + i) * all.length) % all.length];
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
    const c0 = Math.floor(hash(r + ':c' + i) * 4);
    for (let j = 0; j < 4; j++) {
      const c = (c0 + j) % 4, su = c & 1 ? 1 : -1, sv = c & 2 ? 1 : -1, corner = [p.u + su * hw, p.v + sv * hd];
      // stood off the corner, square to one of its faces
      const at = j % 2 ? [corner[0] + su * 0.22 * k, corner[1] - sv * 0.12 * k] : [corner[0] - su * 0.12 * k, corner[1] + sv * 0.22 * k];
      if (roomFree(F, at[0], at[1])) return { id: p.id, name: p.name, arche: p.arche, corner, at, face: corner };
    }
  }
  return null;
}

// ── meals ──────────────────────────────────────────────────────────────────────────────────────────
// A cat's food dish holds two meals and its water bowl a day's water: he eats twice a day and drinks the bowl dry over
// four goes. The times are real time (the game's clock can run fast; a cat's stomach doesn't), hours past midnight UTC,
// nudged a little per cat and per day. A bowl's whole state is when it was last filled (`at`, ms) and, when he'd been
// left waiting by an empty one, the time of the meal he makes up for once it's filled again (`due`, ms or null), so
// how full it is and what he's doing at it are worked out here, the same on the server (plugins/pets) and every client
// (gl/room-beasts.js), with nothing written while he eats.
export const DAY_MS = 24 * 3600 * 1000;
export const BOWL = {
  food: { at: [7.5, 18.5], portion: 0.5, ms: 150 * 1000 },
  water: { at: [3.5, 10, 14.5, 21], portion: 0.25, ms: 50 * 1000 },
};
/** The times in (from, to] that the cat `id` goes to its `kind` bowl, oldest first. */
export function bowlTimes(id, kind, from, to) {
  const B = BOWL[kind], out = [];
  if (!B || !(to > from)) return out;
  for (let day = Math.floor(from / DAY_MS); day * DAY_MS <= to; day++) {
    B.at.forEach((h, i) => {
      const t = day * DAY_MS + Math.round((h + (hash(id + ':' + kind + ':' + day + ':' + i) - 0.5) * 1.5) * 3.6e6);
      if (t > from && t <= to) out.push(t);
    });
  }
  return out.sort((a, b) => a - b);
}
// every go at the bowl since it was filled, up to `to`, the made-up meal with them
function goesSince(id, kind, s, to) {
  const ts = bowlTimes(id, kind, s.at, to);
  if (s.due && s.due > s.at && s.due <= to) ts.push(s.due);
  return ts.sort((a, b) => a - b);
}
/** How full a bowl is at `now`, 0 to 1. `s` is { at, due }. */
export function bowlLevel(id, kind, s, now) {
  if (!s || !Number.isFinite(s.at)) return 0;
  return Math.max(0, 1 - goesSince(id, kind, s, now).length * BOWL[kind].portion);
}
/** The last go at the bowl before `now` that found it empty, ms, or null: he'd been left waiting. */
export function missedSince(id, kind, s, now, back = 12 * 3600 * 1000) {
  if (!s || !Number.isFinite(s.at)) return null;
  const ts = bowlTimes(id, kind, Math.max(s.at, now - back), now);
  for (let i = ts.length - 1; i >= 0; i--) if (bowlLevel(id, kind, s, ts[i] - 1) <= 1e-6) return ts[i];
  return null;
}
/**
 * What the cat is doing at its bowls at `now`, or null: { kind, act: 'eat' | 'drink' | 'beg', since }. `bowls` is
 * { food: { at, due }, water: { at, due } }. A go lasts BOWL[kind].ms; at an empty bowl he sits by it and complains.
 */
export function catAtBowls(id, now, bowls) {
  if (!bowls) return null;
  let best = null;
  for (const kind of ['food', 'water']) {
    const s = bowls[kind];
    if (!s || !Number.isFinite(s.at)) continue;
    const B = BOWL[kind], ts = [...bowlTimes(id, kind, now - B.ms, now), ...(s.due && s.due > now - B.ms && s.due <= now ? [s.due] : [])];
    for (const t of ts) {
      if (t <= s.at) continue;   // filled since: whatever he was waiting for, the made-up meal (`due`) covers it
      const full = bowlLevel(id, kind, s, t - 1) > 1e-6;
      if (!best || t > best.since) best = { kind, act: full ? (kind === 'food' ? 'eat' : 'drink') : 'beg', since: t };
    }
    // hungry or thirsty at an empty one, he goes back to it between times to complain again (catNeeds)
    const P = pesterAt(id, kind, now, s);
    if (P && (!best || P > best.since)) best = { kind, act: 'beg', since: P, pester: true, ...(kind === 'water' && hash(id + ':tap:' + P) < 0.5 ? { tap: true } : {}) };
  }
  return best;
}

// ── hunger and thirst ──────────────────────────────────────────────────────────────────────────────
// Worked out when they're read, never on a tick, from the one thing anybody does about them: filling his bowls. When he
// last ate (or drank) is the last of his goes since the bowl was filled that found something in it; with no go since
// the fill, the last go before it, since nobody had left him waiting (a bowl he'd been waiting at is filled with a
// made-up meal, `due`). How hungry he is follows from how long ago that was: nothing for a few hours after a meal, then
// rising, so on an ordinary day he's a little peckish by his next one and after a day without food he's starving.
// Thirst rises quicker.
const NEED = { food: { grace: 4 * 3.6e6, span: 20 * 3.6e6 }, water: { grace: 3 * 3.6e6, span: 15 * 3.6e6 } };
// how hungry (or thirsty) he has to be before he goes back to an empty bowl to complain, and how often he does
const PESTER = { food: { at: 0.4, every: 35 * 60 * 1000, ms: 60 * 1000 }, water: { at: 0.35, every: 45 * 60 * 1000, ms: 50 * 1000 } };
/** When the cat `id` last ate (`kind` 'food') or drank ('water') from a bowl last filled as `s`, ms, before `now`. */
export function lastFed(id, kind, s, now) {
  if (!s || !Number.isFinite(s.at)) return null;
  const n = Math.round(1 / BOWL[kind].portion), goes = goesSince(id, kind, s, now).slice(0, n);
  if (goes.length) return goes[goes.length - 1];
  const prev = bowlTimes(id, kind, s.at - DAY_MS, s.at);
  return prev.length ? prev[prev.length - 1] : s.at;
}
const _needs = new Map();
/**
 * How hungry and thirsty the cat is at `now`, 0 (just fed) to 1 (a day or more without), from his bowls (`bowls` as
 * catAtBowls takes them): { hunger, thirst, ate, drank } (when he last ate and drank, ms), or null with no bowls.
 */
export function catNeeds(id, now, bowls) {
  if (!bowls?.food && !bowls?.water) return null;
  const f = bowls.food, w = bowls.water, key = id + ':' + (f?.at ?? '') + ':' + (f?.due ?? '') + ':' + (w?.at ?? '') + ':' + (w?.due ?? '') + ':' + Math.floor(now / 1000);
  const had = _needs.get(key);
  if (had) return had;
  const ate = lastFed(id, 'food', f, now), drank = lastFed(id, 'water', w, now);
  const level = (kind, t) => (t == null ? 0 : Math.max(0, Math.min(1, (now - t - NEED[kind].grace) / NEED[kind].span)));
  const out = { hunger: level('food', ate), thirst: level('water', drank), ate, drank };
  if (_needs.size > 500) _needs.clear();
  _needs.set(key, out);
  return out;
}
// The go at an empty bowl he's on at `now` because he's hungry (or thirsty), ms it began, or null. Each PESTER.every
// slot of the clock has one, at a time in it hashed off the cat, while the bowl's empty and he needs it.
function pesterAt(id, kind, now, s) {
  const P = PESTER[kind], slot = Math.floor(now / P.every), t = slot * P.every + Math.floor(hash(id + ':pest:' + kind + ':' + slot) * (P.every - P.ms));
  if (now < t || now >= t + P.ms || t <= s.at) return null;
  if (bowlLevel(id, kind, s, t) > 1e-6) return null;
  const n = catNeeds(id, t, { [kind]: s });
  return n && (kind === 'food' ? n.hunger : n.thirst) >= P.at ? t : null;
}

// ── the tray ───────────────────────────────────────────────────────────────────────────────────────
// A cat pees three or four times a day and does the other once, most often an hour or two after breakfast, and some
// days again in the evening. The times are real time, nudged per cat and per day, like his meals. The tray's whole state
// is when it was last scooped (`at`, ms, the `pet_trays` row): every go since is in it. Past TRAY_FUSSY goes he digs
// longer and sniffs it over first; at TRAY_FULL he won't get in, and goes on the floor beside it instead. Scooping clears
// both. Nothing is written while he goes.
export const TRAY = {
  pee: { at: [0.8, 6.2, 12.6, 19.6], ms: 75 * 1000, p: [1, 0.8, 1, 0.9] },
  poo: { at: [9.3, 20.4], ms: 115 * 1000, p: [1, 0.35] },
};
export const TRAY_FUSSY = 4, TRAY_FULL = 7;
/** Every go at the tray in (from, to], oldest first: [{ t, kind: 'pee' | 'poo' }]. */
export function trayTimes(id, from, to) {
  const out = [];
  if (!(to > from)) return out;
  for (let day = Math.floor(from / DAY_MS); day * DAY_MS <= to; day++) {
    for (const kind of ['pee', 'poo']) TRAY[kind].at.forEach((h, i) => {
      if (hash(id + ':tray:' + kind + ':' + day + ':' + i + ':p') >= TRAY[kind].p[i]) return;
      const t = day * DAY_MS + Math.round((h + (hash(id + ':tray:' + kind + ':' + day + ':' + i) - 0.5) * 1.4) * 3.6e6);
      if (t > from && t <= to) out.push({ t, kind });
    });
  }
  return out.sort((a, b) => a.t - b.t);
}
/**
 * How the tray last scooped as `s` ({ at }) stands at `now`: { pee, poo (the goes in it), mess: [{ t, kind }] (the
 * goes beside it, since it was full), dirt (every go since it was scooped) }.
 */
export function trayState(id, s, now) {
  const goes = s && Number.isFinite(s.at) ? trayTimes(id, s.at, now) : [];
  const inIt = goes.slice(0, TRAY_FULL);
  return { pee: inIt.filter((g) => g.kind === 'pee').length, poo: inIt.filter((g) => g.kind === 'poo').length, mess: goes.slice(TRAY_FULL), dirt: goes.length };
}
/**
 * The go at his tray the cat is on at `now`, or null: { kind: 'tray', act: 'pee' | 'poo', since, fussy (it wants
 * scooping: he sniffs it over and digs longer), mess (it's full: he goes beside it), zoom (after the other, he tears
 * off round the flat, as cats do) }. `tray` is { at } or null.
 */
export function catAtTray(id, now, tray) {
  if (!tray || !Number.isFinite(tray.at)) return null;
  const goes = trayTimes(id, Math.max(tray.at, now - TRAY.poo.ms), now);
  for (let i = goes.length - 1; i >= 0; i--) {
    const g = goes[i];
    if (now - g.t >= TRAY[g.kind].ms) continue;
    const before = trayTimes(id, tray.at, g.t - 1).length;
    return { kind: 'tray', act: g.kind, since: g.t, fussy: before >= TRAY_FUSSY, mess: before >= TRAY_FULL, zoom: g.kind === 'poo' && hash(id + ':pz:' + g.t) < 0.45 };
  }
  return null;
}
/** What he's at now of his bowls and his tray, whichever he went to last, or null. */
export function catAtChores(id, now, bowls, tray) {
  const a = catAtBowls(id, now, bowls), b = catAtTray(id, now, tray);
  return a && b ? (b.since >= a.since ? b : a) : a || b;
}

// ── biscuits ───────────────────────────────────────────────────────────────────────────────────────
// A cat kneads ("makes biscuits") on something soft: a bed, a sofa, a cushioned chair, a rug. Up on a hard top he loafs
// instead, and on something soft he kneads more. On the floor, a settled cat in a room with a rug mostly settles on the
// rug, and only kneads there.
const HARD_SEAT = new Set(['stool', 'stools', 'office']);
/** Whether a top is soft enough to knead: a bed, a sofa, a cushioned chair or a booth. */
export const perchSoft = (p) => !!p && (p.arche === 'bed' || p.arche === 'sofa' || (p.arche === 'seat' && !HARD_SEAT.has(p.form)) || (p.arche === 'bench' && p.form === 'booth'));
/** The room's rug as a box in its own units, or null (spec.decor.rug: { at, w, d }, metres). */
export function rugOf(L) {
  const r = L?.spec?.decor?.rug, k = unitsOf(L);
  if (!Array.isArray(r?.at) || !(r.w > 0) || !(r.d > 0)) return null;
  return [r.at[0] * k - r.w * k / 2, r.at[0] * k + r.w * k / 2, r.at[1] * k - r.d * k / 2, r.at[1] * k + r.d * k / 2];
}
// a free spot on the rug for this key, the same for everybody, or null when the furniture covers it
function rugSpot(L, key) {
  const b = rugOf(L);
  if (!b) return null;
  const F = onFoot(L), m = 0.2 * unitsOf(L);
  for (let i = 0; i < 16; i++) {
    const u = b[0] + m + (b[1] - b[0] - 2 * m) * hash(key + ':rug:u' + i), v = b[2] + m + (b[3] - b[2] - 2 * m) * hash(key + ':rug:v' + i);
    if (roomFree(F, u, v)) return [u, v];
  }
  return null;
}
/**
 * What he does this turn where he's settled, and where on the floor if it's the rug: { act, rug: [u, v] | null }.
 * `perch` is catPerchOf's answer for the same life (null on the floor). The server's words and the picture both read
 * this, not life.act, for a settled cat.
 */
export function catSettle(L, life, perch = null) {
  let act = life.act, rug = null;
  if (!perch && (life.state === 'rest' || life.state === 'sleep' || life.state === 'flop') && hash(life.spot + ':onrug') < 0.7) rug = rugSpot(L, life.spot);
  const soft = perch ? perchSoft(perch) : !!rug;
  if (act === 'knead' && !soft) act = 'loaf';
  // on something soft, some of the lying about turns into biscuits
  else if (soft && life.state === 'rest' && act === 'loaf' && hash(life.spot + ':kn:' + life.turn) < 0.3) act = 'knead';
  return { act, rug };
}

// ── two cats ───────────────────────────────────────────────────────────────────────────────────────
// Cats that share a home get on, or don't, in a few ways (Crowell-Davis et al. 2004; van den Bos 1998): friends greet
// nose to nose and then sniff each other's back end, rub heads and flanks (allorubbing), groom each other, mostly the
// head and neck and mostly the bigger personality grooming the other, sleep in contact, and play-fight and chase. A pair
// that doesn't get on stares, one puffs up and hisses, and the other flattens and gets out of the way.
//
// Which of those happens is worked out here from the two ids, their natures and the clock, the same on the server
// (plugins/pets says it) and every client (gl/room-beasts.js plays it), as a cat's own day is. An encounter takes a
// turn or two (MEET_KINDS[kind].turns) and starts on a turn that's a multiple of that; sleeping in a heap lasts as long
// as both sleeps do. While it runs it goes over both cats' days; a cat at its bowls or on a beat is left out of it.
//
// Roles: `a` stays where it is (its day puts it there) and `b` comes to it. In a greeting `b` is the one that was up
// and about; in a groom `b` is the groomer, the more dominant; in a spat `a` is the more dominant, the one hissing.
export const MEET_KINDS = {
  greet: { turns: 2, awake: true },
  play: { turns: 2, awake: true },
  spat: { turns: 1, awake: true },
  groom: { turns: 2, settled: true },
  pile: { turns: 0, asleep: true },
};
/** How well two cats get on, 0..1, from their natures (the Feline Five): friendly cats get on; two bossy ones don't. */
export function catBond(na = {}, nb = {}) {
  const f = ((na.friendly ?? 0.5) + (nb.friendly ?? 0.5)) / 2, clash = Math.min(na.dominant ?? 0.5, nb.dominant ?? 0.5);
  const nerves = Math.max(na.skittish ?? 0.5, nb.skittish ?? 0.5);
  return Math.max(0.05, Math.min(0.95, 0.2 + 0.75 * f - 0.4 * clash - 0.15 * nerves + 0.1));
}
const AWAKE = new Set(['about', 'sit']), SETTLED = new Set(['rest', 'sit', 'flop']);
// the block a settled spell began in, off its spot key (`id:block`)
const firstBlock = (life) => +String(life.spot).slice(String(life.spot).lastIndexOf(':') + 1) || life.block;
/**
 * Who's with whom at `now`: a Map of cat id → { kind, with (the other's id), role ('a' | 'b'), since (ms), until (ms or
 * null while it lasts), key (the same for both), on (the piece both are on, for `b` to come up onto, or null) }.
 * `cats`: [{ id, nature, look, bowls, busy }] in one room, `busy` for a cat on a beat. `L` the room's layout, or null
 * (then nothing is up on anything, and every encounter is on the floor).
 */
export function catMeets(L, cats, now, hour = 13) {
  const out = new Map();
  if (!cats || cats.length < 2) return out;
  const all = cats.filter((c) => c?.id).slice().sort((x, y) => (x.id < y.id ? -1 : 1)).map((c) => {
    const life = catLife(c.id, now, hour, c.nature || {});
    const perch = L ? catPerchOf(L, life, c.look || {}) : null;
    return { ...c, life, perch, free: !c.busy && !catAtChores(c.id, now, c.bowls, c.tray) };
  });
  const k = unitsOf(L);
  const pairs = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) pairs.push([all[i], all[j]]);
  // a cat in a heap stays in it, so the heaps go first
  pairs.sort((p, q) => (p[0].life.asleep && p[1].life.asleep ? 0 : 1) - (q[0].life.asleep && q[1].life.asleep ? 0 : 1));
  for (const [x, y] of pairs) {
    if (!x.free || !y.free || out.has(x.id) || out.has(y.id)) continue;
    const pk = x.id + '+' + y.id, bond = catBond(x.nature, y.nature), lx = x.life, ly = y.life;
    let m = null;
    if (lx.asleep && ly.asleep) {
      // asleep together: one goes and curls up against the other, for the whole of the sleep, if they're close enough
      // friends and there's room for two where the other is
      const roomy = (p) => !p || (p.free[1] - p.free[0] >= 0.62 * k && p.d >= 0.32 * k);
      if (bond > 0.35 && hash(pk + ':pile:' + lx.spot + ':' + ly.spot) < 0.7 * bond * bond) {
        const [a, b] = hash(pk + ':pr:' + lx.spot) < 0.5 ? [x, y] : [y, x];
        if (roomy(a.perch)) m = { kind: 'pile', a, b, since: Math.max(firstBlock(lx), firstBlock(ly)) * BLOCK_MS, until: null };
      }
    } else {
      const span = (kind) => MEET_KINDS[kind].turns;
      const at = (n) => { const t0 = lx.turn - (lx.turn % n); return { t0, since: lx.block * BLOCK_MS + t0 * TURN_MS, until: lx.block * BLOCK_MS + (t0 + n) * TURN_MS }; };
      const awake = AWAKE.has(lx.state) && AWAKE.has(ly.state), settled = SETTLED.has(lx.state) && SETTLED.has(ly.state) && (lx.state !== 'sit' || ly.state !== 'sit');
      const dusk = (hour >= 5 && hour < 8.5) || (hour >= 16.5 && hour < 21);
      const imp = ((x.nature?.impulsive ?? 0.5) + (y.nature?.impulsive ?? 0.5)) / 2;
      if (awake) {
        // one roll a turn for what, if anything, the two of them do (the play and the spat on their own clocks: each
        // spans its own turns)
        const w = {
          greet: 0.01 + 0.11 * bond,
          play: bond > 0.3 ? (dusk ? 0.1 : 0.03) * (0.5 + imp) : 0,
          spat: bond < 0.45 ? 0.035 * (0.45 - bond) / 0.45 + 0.01 : 0,
        };
        for (const kind of ['play', 'greet', 'spat']) {
          const T = at(span(kind));
          if (hash(pk + ':' + kind + ':' + lx.block + ':' + T.t0) >= w[kind]) continue;
          // the one that stays put is on the floor
          let a, b;
          if (kind === 'spat') [a, b] = (x.nature?.dominant ?? 0.5) >= (y.nature?.dominant ?? 0.5) ? [x, y] : [y, x];
          else if (kind === 'greet') [a, b] = lx.state === 'about' && ly.state !== 'about' ? [y, x] : ly.state === 'about' && lx.state !== 'about' ? [x, y] : hash(pk + ':g' + T.t0) < 0.5 ? [x, y] : [y, x];
          else [a, b] = hash(pk + ':p' + T.t0) < 0.5 ? [x, y] : [y, x];
          if (a.perch) continue;
          m = { kind, a, b, since: T.since, until: T.until };
          break;
        }
      } else if (settled) {
        const T = at(span('groom'));
        if (bond > 0.35 && hash(pk + ':groom:' + lx.block + ':' + T.t0) < 0.18 * bond) {
          // the groomer is the bossier of the two; it comes to the other, up onto the piece if that's where it is and
          // there's room
          const [b, a] = (x.nature?.dominant ?? 0.5) >= (y.nature?.dominant ?? 0.5) ? [x, y] : [y, x];
          if (!a.perch || (a.perch.free[1] - a.perch.free[0] >= 0.58 * k && a.perch.d >= 0.3 * k)) m = { kind: 'groom', a, b, since: T.since, until: T.until };
        }
      }
    }
    if (!m) continue;
    const key = pk + ':' + m.kind + ':' + m.since, on = m.a.perch?.id || null;
    out.set(m.a.id, { kind: m.kind, with: m.b.id, role: 'a', since: m.since, until: m.until, key, on });
    out.set(m.b.id, { kind: m.kind, with: m.a.id, role: 'b', since: m.since, until: m.until, key, on });
  }
  return out;
}
