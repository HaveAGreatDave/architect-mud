// THE PAPER DOLL: you, drawn flat in the house's comic manner, wearing what you wear.
//
// The Room Stage's Pack (client/game/js/panels/room-pack.js) draws it. It's a simplified you: the body is built
// from the same columns the close-up figure is (client/shared/player-figure.js: skin, hair colour and cut, eyes,
// build, sex), standing with its weight on one leg, and each worn item is drawn on it as the kind of thing its
// name says it is (`garmentOf`), in the colour its name says, on its own layer: underwear, then clothes, then
// armour, each slot in an order that tucks a shirt into trousers and trousers into boots.
//
// Drawn the way comic-ink.md draws everybody: every shape a flat colour with one crisp shadow tone on the side away
// from the light (`#pd-shade`, a hard stop in each shape's own box), an ink line round each, and a heavier one round
// the whole silhouette.
//
// Pure: strings in, a string out, no DOM. `dollSvg` returns an <svg>; every shape of a worn item sits in a
// <g data-id="<inventory row id>"> so the panel can pick it, and `opts.ghost` draws one more item at half strength,
// for the preview while you drag it over.
//
// ⚠ A GARMENT IS READ OFF ITS NAME. Items carry no colour or cut (docs/items.md), so `garmentOf` reads the plain
// English words a name uses (jacket, boots, denim, black) and falls back to the slot and a colour off the name's
// hash. Nothing here names a particular item: a new jacket in a new region is drawn as a jacket.

import { playerFigure } from './player-figure.js';
import { SKIN_RGB } from './morphex-catalog.js';

const INK = '#17131c';
const W = 240, H = 480;
const f1 = (n) => Math.round(n * 10) / 10;
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const attr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// ── Paths ─────────────────────────────────────────────────────────────────────

// A closed Catmull-Rom path through the points: organic outlines from a handful of stations.
function smooth(pts, closed = true) {
  const n = pts.length;
  if (n < 3) return '';
  const at = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}
const poly = (pts) => 'M' + pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L') + 'Z';
const line = (pts) => 'M' + pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L');
const ellipse = (cx, cy, rx, ry) => `M${f1(cx - rx)},${f1(cy)}a${f1(rx)},${f1(ry)} 0 1,0 ${f1(rx * 2)},0a${f1(rx)},${f1(ry)} 0 1,0 ${f1(-rx * 2)},0Z`;

// A limb: a run of joints with a radius at each, from t0 to t1 of its length, `ease` wider all round. Its ends are
// round unless cut (a sleeve's cuff, a trouser's hem), so a garment's edge reads as an edge.
function chain(joints, radii, { t0 = 0, t1 = 1, ease = 0, cap0 = 'round', cap1 = 'round' } = {}) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < joints.length; i++) { const l = Math.hypot(joints[i][0] - joints[i - 1][0], joints[i][1] - joints[i - 1][1]); seg.push(l); total += l; }
  const sample = (t) => {
    let s = t * total;
    for (let i = 0; i < seg.length; i++) {
      if (s <= seg[i] || i === seg.length - 1) {
        const u = seg[i] ? Math.min(1, s / seg[i]) : 0, a = joints[i], b = joints[i + 1];
        return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], r: radii[i] + (radii[i + 1] - radii[i]) * u + ease, dir: [(b[0] - a[0]) / (seg[i] || 1), (b[1] - a[1]) / (seg[i] || 1)] };
      }
      s -= seg[i];
    }
    return null;
  };
  const K = 9, L = [], R = [];
  for (let k = 0; k <= K; k++) {
    const q = sample(t0 + (t1 - t0) * (k / K)), n = [-q.dir[1], q.dir[0]];
    L.push([q.p[0] + n[0] * q.r, q.p[1] + n[1] * q.r]);
    R.push([q.p[0] - n[0] * q.r, q.p[1] - n[1] * q.r]);
  }
  // a round end goes round the tip from the left edge to the right; a cut end goes straight across
  const arc = (q, back) => [45, 90, 135].map((deg) => {
    const a = deg * Math.PI / 180, n = [-q.dir[1], q.dir[0]], s = back ? -1 : 1;
    return [q.p[0] + s * (n[0] * Math.cos(a) + q.dir[0] * Math.sin(a)) * q.r, q.p[1] + s * (n[1] * Math.cos(a) + q.dir[1] * Math.sin(a)) * q.r];
  });
  const out = [...L];
  if (cap1 === 'round') out.push(...arc(sample(t1), false));
  out.push(...R.reverse());
  if (cap0 === 'round') out.push(...arc(sample(t0), true));
  return smooth(out);
}

// ── The body ──────────────────────────────────────────────────────────────────

// The torso's half-width at a height, viewer's left and right apart, so the hips can swing over the weight leg.
// Rows are y, then the half-width each side.
const TORSO_M = [[82, 9, 9], [88, 26, 25], [96, 41, 40], [112, 41, 40], [128, 37, 36], [150, 35, 34], [176, 29, 28], [196, 28, 27], [214, 30, 30], [232, 33, 32], [248, 32, 31], [262, 25, 25]];
const TORSO_F = [[82, 7, 7], [90, 17, 17], [98, 31, 30], [112, 32, 31], [128, 30, 29], [150, 31, 30], [176, 25, 24], [194, 24, 23], [214, 33, 33], [232, 39, 38], [248, 37, 36], [262, 27, 27]];
// the body's midline: over the weight leg at the hips (viewer's left), upright at the shoulders
const midAt = (y) => 122 - Math.max(0, Math.min(1, (y - 100) / 140)) * 5;

function makeBody(sex, weight) {
  const fem = sex === 'female', k = 0.86 + 0.32 * weight, kf = fem ? 0.9 : 1;
  const T = fem ? TORSO_F : TORSO_M;
  const half = (y, side) => {
    if (y <= T[0][0]) return T[0][side] * k;
    for (let i = 1; i < T.length; i++) if (y <= T[i][0]) { const a = T[i - 1], b = T[i], u = (y - a[0]) / (b[0] - a[0]); return (a[side] + (b[side] - a[side]) * u) * k; }
    return T[T.length - 1][side] * k;
  };
  const xs = (y) => [midAt(y) - half(y, 1), midAt(y) + half(y, 2)];
  const sw = (fem ? 29 : 36) * k;
  const B = {
    fem, k, half, xs,
    head: [123, 50], headR: [19.5, 24.5],
    neck: [[121, 92], [122, 70]],
    // contrapposto: the weight on the viewer's left leg, that hip up and that shoulder down
    armA: [[122 - sw + 2, 104], [118 - sw - 6, 180], [118 - sw - 9, 248], [118 - sw - 10, 268]],
    armB: [[122 + sw - 2, 99], [122 + sw + 12, 170], [122 + sw + 7, 234], [122 + sw + 3, 252]],
    legA: [[104, 238], [107, 342], [112, 438]],
    legB: [[136, 244], [142, 344], [153, 434]],
    footA: [[112, 440], [96, 459]],
    footB: [[153, 436], [169, 455]],
  };
  B.armR = [(fem ? 9.6 : 12.4) * k, (fem ? 8 : 9.6) * k, (fem ? 6 : 6.8) * k, 5.6 * k];
  B.legR = [20 * k * (fem ? 1.05 : 1), 11.5 * k, 7 * k];
  B.footR = [8.4 * kf, 9 * kf];
  B.handA = B.armA[3]; B.handB = B.armB[3];
  B.waist = 194; B.hip = 234; B.crotch = 262;
  return B;
}

// The torso's outline between two heights, eased out; `flare` is how far a skirt spreads per pixel below the hip.
function torsoShape(B, y0, y1, { ease = 0, flare = 0.2, neck = 'crew' } = {}) {
  const Ls = [], Rs = [];
  const below = (y) => Math.max(0, y - B.hip);
  for (let y = y0; y <= y1 + 0.1; y += 6) {
    const yy = Math.min(y, y1);
    let [l, r] = y <= B.crotch ? B.xs(yy) : B.xs(B.crotch - 14);
    if (yy > B.hip) {
      // past the hip a garment hangs straight and spreads, round both legs
      const [hl, hr] = B.xs(B.hip);
      const spread = below(yy) * flare;
      l = Math.min(l, hl - spread); r = Math.max(r, hr + spread);
    }
    Ls.push([l - ease, yy]); Rs.push([r + ease, yy]);
  }
  const top = [];
  const mid = midAt(y0);
  if (neck === 'v') top.push([mid, y0 + 26]);
  else if (neck === 'scoop') top.push([mid, y0 + 16]);
  else if (neck === 'crew') top.push([mid, y0 + 5]);
  return smooth([...Ls, ...Rs.reverse(), ...top]);
}

// ── Garments: what an item is, read off its name ──────────────────────────────

const COLOURS = [
  [/\b(black|midnight|onyx|shadow|night|lace veil)\b/, [40, 38, 46]], [/\b(charcoal|graphite|gunmetal)\b/, [66, 68, 76]],
  [/\b(grey|gray|steel|ash|concrete)\b/, [126, 128, 134]], [/\b(white|ribbed cotton|undershirt|bone|ivory)\b/, [224, 220, 210]],
  [/\b(red|crimson|scarlet|festive|blood)\b/, [174, 42, 40]], [/\b(cobalt|blue|azure)\b/, [44, 86, 172]],
  [/\b(denim|jeans)\b/, [72, 100, 142]], [/\bnavy\b/, [36, 46, 84]], [/\b(green|olive|kevlar|field|drab|military)\b/, [88, 100, 62]],
  [/\b(khaki|cargo|tan|canvas|sand)\b/, [170, 150, 106]], [/\b(brown|leather|synth-leather|suede|work gloves|drover)\b/, [104, 66, 42]],
  [/\b(gold|golden|brass)\b/, [214, 172, 62]], [/\b(silver|chrome|liquid-chrome|metallic)\b/, [192, 198, 206]],
  [/\b(pink|rose|satin)\b/, [216, 150, 170]], [/\b(purple|violet|plum)\b/, [112, 60, 150]], [/\b(orange|prison|hi-vis|safety)\b/, [226, 118, 36]],
  [/\b(yellow|hazard|biohazard|acid)\b/, [214, 186, 40]], [/\b(arctic|snow|ice)\b/, [214, 222, 228]], [/\b(iridescent|opal)\b/, [86, 166, 172]],
  [/\b(wool|fleece|alpaca|knit|knitted)\b/, [150, 130, 108]], [/\b(thermal|thermex|long johns)\b/, [150, 66, 54]], [/\b(neoprene|latex|wetsuit)\b/, [32, 34, 42]],
  [/\b(scrap|rag|ragplate|rusty|patched|motley)\b/, [128, 88, 58]], [/\b(vat)\b/, [130, 150, 136]], [/\b(monster|fuzzy)\b/, [112, 178, 92]],
  [/\b(cat-print)\b/, [204, 124, 162]],
];
const MUTED = [[82, 86, 96], [104, 70, 58], [70, 96, 88], [120, 108, 82], [92, 70, 106], [58, 76, 110], [132, 92, 72], [96, 104, 74]];
const MATS = [
  [/\b(leather|latex|synth-leather|vinyl|patent|chrome|liquid-chrome|stiletto)\b/, 'gloss'],
  [/\b(kevlar|plate|riot|helmet|steel|scrap|gauntlets?|ballistic|armou?r|shellcoat)\b/, 'plate'],
  [/\b(denim|jeans)\b/, 'denim'], [/\b(lace|fishnet|mesh|sheer|veil)\b/, 'sheer'],
  [/\b(knit|knitted|wool|fleece|sweater|balaclava|mittens|socks|alpaca)\b/, 'knit'],
];

const KINDS = {
  torso: [
    [/\b(bra|bralette|pasties)\b/, 'bra'], [/\bblouse\b/, 'shirt'], [/\bbinder\b/, 'binder'], [/\bharness\b/, 'harness'], [/\bapron\b/, 'apron'],
    [/\b(gown|dress)\b/, 'gown'], [/\b(jumpsuit|snowsuit|wetsuit|coverall|overalls)\b/, 'jumpsuit'],
    [/\b(slicker|duster|overcoat|opera coat|analyst's coat|long coat|trench)\b/, 'longcoat'], [/\b(coat|parka|raincoat|shellcoat|wrap)\b/, 'coat'],
    [/\b(vest|plate)\b/, 'vest'], [/\bhoodie\b/, 'hoodie'], [/\b(sweater|jumper)\b/, 'sweater'], [/\bsuit\b/, 'suit'],
    [/\b(jacket|blazer|overshirt)\b/, 'jacket'], [/\b(crop top|halter|tube top)\b/, 'crop'], [/\b(undershirt|tank|singlet|underlayer)\b/, 'undershirt'],
    [/\b(tee|t-shirt)\b/, 'tee'], [/\b(shirt|blouse|top)\b/, 'shirt'],
  ],
  legs: [
    [/\b(long johns|leggings|tights|underlayer)\b/, 'leggings'], [/\b(micro shorts|hot pants)\b/, 'micro'], [/\bshorts\b/, 'shorts'],
    [/\b(skirt|kilt)\b/, 'skirt'], [/\b(boxers|boxer briefs)\b/, 'boxers'],
    [/\b(briefs|panties|thong|jockstrap|underpants|knickers)\b/, 'briefs'], [/\b(jeans)\b/, 'jeans'], [/\b(pants|trousers|sweatpants|slacks)\b/, 'pants'],
  ],
  feet: [
    [/\b(waders)\b/, 'waders'], [/\b(thigh-high)\b/, 'thighboots'], [/\b(heels|stiletto|pumps)\b/, 'heels'], [/\b(boots?)\b/, 'boots'],
    [/\b(sandals?|flip-flops)\b/, 'sandals'], [/\b(slippers)\b/, 'slippers'], [/\b(socks)\b/, 'socks'], [/\b(sneakers|trainers)\b/, 'sneakers'],
  ],
  hands: [
    [/\brings\b/, 'rings'], [/\b(wraps)\b/, 'wraps'], [/\b(mittens)\b/, 'mittens'], [/\b(gauntlets?)\b/, 'gauntlets'],
    [/\b(opera|opera-length)\b/, 'opera'], [/\b(fingerless|split-finger)\b/, 'fingerless'],
  ],
  head: [
    [/\b(balaclava)\b/, 'balaclava'], [/\b(helmet|bump cap)\b/, 'helmet'], [/\b(hood)\b/, 'hood'], [/\b(veil)\b/, 'veil'],
    [/\b(domino)\b/, 'domino'], [/\bmask\b/, 'facemask'], [/\b(ear defenders|earmuffs)\b/, 'muffs'], [/\b(bucket hat|sun hat)\b/, 'bucket'],
    [/\b(watch cap|beanie|toque)\b/, 'beanie'], [/\b(cap)\b/, 'cap'], [/\b(hair)\b/, 'hairpiece'], [/\b(iris|eye|lens)\b/, 'eyering'], [/\bhat\b/, 'bucket'],
  ],
  accessory: [
    [/\b(knee ?pads?|knee ?guards?)\b/, 'kneepads'], [/\b(scarf|gaiter|snood)\b/, 'scarf'], [/\b(collar|choker)\b/, 'collar'], [/\b(chain|necklace|pendant)\b/, 'chain'],
    [/\b(watch|wristband|bracelets?|bangle|cuff)\b/, 'wrist'], [/\b(earmuffs)\b/, 'muffs'], [/\b(earplugs|nose plugs)\b/, 'plugs'],
    [/\b(tote|bag|satchel)\b/, 'tote'], [/\b(fanny pack|bum bag|belt pouch)\b/, 'fanny'], [/\b(harness)\b/, 'strapharness'],
    [/\b(lenses|glasses|goggles|shades)\b/, 'glasses'], [/\b(respirator|gas mask)\b/, 'respirator'], [/\b(ring)\b/, 'ring'],
    [/\b(tattoo)\b/, 'tattoo'], [/\b(sleeve)\b/, 'sleeve'], [/\b(foot|charm|keyring)\b/, 'charm'],
  ],
};
const DEFAULT_KIND = { torso: 'shirt', legs: 'pants', feet: 'shoes', hands: 'gloves', head: 'cap', accessory: 'charm', weapon_hand: 'weapon' };

const hexRgb = (h) => (typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);

// What the doll draws an item as: { kind, col, mat }. `it` is a Pack row ({ name, slot, layer, covers, skill }).
export function garmentOf(it) {
  const name = String(it?.name || '').toLowerCase(), slot = it?.slot || '';
  let kind = null;
  for (const [re, k] of KINDS[slot] || []) if (re.test(name)) { kind = k; break; }
  if (!kind) kind = DEFAULT_KIND[slot] || 'charm';
  // a one-piece that covers the legs is drawn down them, whatever it's called
  if (slot === 'torso' && Array.isArray(it?.covers) && it.covers.includes('legs') && !['longcoat', 'coat', 'gown'].includes(kind)) kind = 'jumpsuit';
  if (slot === 'torso' && Array.isArray(it?.covers) && it.covers.includes('head') && kind === 'longcoat') kind = 'slicker';
  if (slot === 'weapon_hand') kind = it?.skill === 'blades' ? (/(longsword|sabre|shortsword|chainblade|machete)/.test(name) ? 'sword' : 'knife')
    : it?.skill === 'clubs' ? (/(lash|flail)/.test(name) ? 'flail' : 'club')
      : it?.skill === 'firearms' ? (/(shotgun|riot gun|speargun|projector|rifle)/.test(name) ? 'longgun' : 'pistol')
        : it?.skill === 'science' ? 'lance' : 'club';
  // an item that says its colour (tags.wear_look.col, sent as `look`) is that colour; otherwise it's read off the name
  let col = hexRgb(it?.look?.col);
  if (!col) for (const [re, c] of COLOURS) if (re.test(name)) { col = c; break; }
  if (!col) col = it?.layer === 1 && slot !== 'feet' ? [214, 208, 198] : MUTED[hashOf(name) % MUTED.length];
  let mat = 'cloth';
  for (const [re, m] of MATS) if (re.test(name)) { mat = m; break; }
  return { kind, col, mat };
}

// ── The same clothes on the close-up figure ──────────────────────────────────
// The Pack turns the 3D you (room-stage.js) as well as drawing this doll, and a player's figure carries no clothes of
// its own (player-figure.js is the body only), so `figureWorn` reads what's worn into the overrides the close-up
// figure takes on a settled look (gl/room-people.js lookOf): the cut of the outermost top, its colour and cloth, a
// shirt showing under a jacket, the bottoms, the shoes, a hat and a scarf. `skin` is the body's own colour, when
// it's been chosen, for what's bare. The names are figure.js FIGURE_CUTS, FIGURE_BOTTOMS, FIGURE_HATS and
// FIG_FABRIC keys, as strings, so this file stays free of the renderer.
const TORSO_CUT = {
  longcoat: 'trench', slicker: 'mac', coat: 'coat', jumpsuit: 'coverall', gown: 'dress', suit: 'suit', jacket: 'jacket', hoodie: 'hoodie',
  sweater: 'sweater', vest: 'vest', shirt: 'oxford', tee: 'tee', crop: 'crop', undershirt: 'tank', binder: 'tank', apron: 'tee', harness: 'strapwrap', bra: 'briefs',
};
const TORSO_OUTER = ['longcoat', 'slicker', 'coat', 'jumpsuit', 'gown', 'suit', 'jacket', 'hoodie', 'sweater', 'vest', 'apron', 'shirt', 'tee', 'crop', 'undershirt', 'binder', 'harness', 'bra'];
const OPEN_FRONT = new Set(['longcoat', 'slicker', 'coat', 'suit', 'jacket', 'vest']);
const LEG_BOTTOMS = { shorts: 'shorts', micro: 'cutoffs', skirt: 'aline', boxers: 'cutoffs', briefs: 'cutoffs' };
const HAT = { cap: 'cap', beanie: 'beanie', helmet: 'hardhat', bucket: 'bucket' };
const FABRIC = { denim: 'denim', knit: 'knit', plate: 'canvas' };
const UNDIES = [214, 208, 198];
const fabricOf = (it, g) => (g.mat === 'gloss' ? (/leather|suede/.test(String(it.name).toLowerCase()) ? 'leather' : 'rubber') : FABRIC[g.mat] || 'plain');

export function figureWorn(items, { sex = 'male', skin = null } = {}) {
  const worn = (items || []).filter((it) => it.worn && it.slot), bare = skin || null;
  const top = (slot) => worn.filter((it) => it.slot === slot).map((it) => ({ it, g: garmentOf(it) }));
  const torso = top('torso').sort((a, b) => ((b.it.layer || 2) - (a.it.layer || 2)) || (TORSO_OUTER.indexOf(a.g.kind) - TORSO_OUTER.indexOf(b.g.kind)));
  const legs = top('legs').sort((a, b) => (b.it.layer || 2) - (a.it.layer || 2));
  const out = { hat: '', scarf: '' };
  const lg = legs[0], under = !lg || ['briefs', 'boxers', 'micro'].includes(lg.g.kind), ft0 = top('feet')[0];
  // only what's on you is drawn: a garment slot with nothing in it is left off the figure (bare skin; outside the
  // mature layer gl/figure-hd.js censor() covers what has to be)
  out.wear = { top: torso.length > 0, legs: !!lg, shoes: !!ft0 };
  if (!torso.length && under) {
    // down to your underwear, or less: an underwear cut whose legs are your briefs, its top left off
    out.cut = lg?.g.kind === 'boxers' ? 'boxers' : 'briefs';
    out.top = lg?.g.col || UNDIES;
    out.bottoms = '';
  } else {
    const o = torso[0];
    if (o) {
      out.cut = TORSO_CUT[o.g.kind] || 'tee'; out.top = o.g.col; out.fabric_top = fabricOf(o.it, o.g);
      // an item that names its own cut and cloth (tags.wear_look.cut, .fabric: the vat suits' seasons) is drawn as it says
      if (typeof o.it.look?.cut === 'string' && /^[a-z_]+$/.test(o.it.look.cut)) out.cut = o.it.look.cut;
      if (typeof o.it.look?.fabric === 'string' && /^[a-z]+$/.test(o.it.look.fabric)) out.fabric_top = o.it.look.fabric;
      // the batch tape on a vat suit is white (the shirt's slot, which shows nowhere else on a closed top)
      if (out.cut.startsWith('vatsuit')) out.shirt = [232, 228, 216];
      // a printed top: gl/figure-hd.js uPrint's names (the reaper goes on a plain tee's back)
      if (typeof o.it.look?.print === 'string') out.print = o.it.look.print;
      // what's under an open front shows at the collar
      const inner = OPEN_FRONT.has(o.g.kind) && torso.find((x) => x !== o && !OPEN_FRONT.has(x.g.kind));
      if (inner) out.shirt = inner.g.col;
    } else {
      // trousers and nothing on top: a vest the colour of you, or a pale one if your skin's not been chosen
      out.cut = 'tank'; out.top = bare || UNDIES;
    }
    // a one-piece that covers the legs (tags.covers) is its own trousers, whatever's worn under it
    const whole = o && Array.isArray(o.it.covers) && o.it.covers.includes('legs');
    if (whole) { out.legs = o.g.col; out.bottoms = ''; out.fabric_legs = out.fabric_top; out.wear.legs = true; }
    else if (lg) { out.legs = lg.g.col; out.bottoms = LEG_BOTTOMS[lg.g.kind] || ''; out.fabric_legs = fabricOf(lg.it, lg.g); }
    else { out.legs = UNDIES; out.bottoms = 'cutoffs'; }
  }
  const ft = top('feet')[0];
  out.shoes = ft ? ft.g.col : bare || [196, 160, 136];
  if (ft) out.fabric_shoes = fabricOf(ft.it, ft.g);
  const hd = top('head').find((x) => HAT[x.g.kind]);
  if (hd) out.hat = HAT[hd.g.kind];
  // a scarf wrapped round the neck with both ends down the front, in its own colour (the figure's shirt slot,
  // which nothing shows on a closed top; under an open front the shirt keeps it); a chain in its own (the
  // glasses' frame slot)
  const sc = top('accessory').find((x) => x.g.kind === 'scarf');
  if (sc) { out.scarf = 'wrap'; if (!out.shirt) out.shirt = sc.g.col; }
  const ch = top('accessory').find((x) => x.g.kind === 'chain');
  if (ch) out.chain = ch.g.col;
  // the gear a stranger rolls off their id (figure.js figureGear) is what you wear: knee pads only with a pair on,
  // a pouch with a bum bag, gloves with something on your hands, and no strap. The belt stays as rolled.
  const acc = top('accessory');
  out.gear = { pads: acc.some((x) => x.g.kind === 'kneepads'), pouch: acc.some((x) => x.g.kind === 'fanny'), strap: false, gloves: top('hands').length > 0 };
  return out;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

// A drawn shape: its path, its flat colour, whether it takes the shadow tone, and the item it belongs to.
function shape(d, col, extra = {}) { return { d, col, shade: true, ...extra }; }
function detail(d, extra = {}) { return { d, detail: true, w: 1.4, ...extra }; }

// Which way the light falls: from the viewer's upper left, so the shadow is each shape's right-hand side.
const DEFS = `<defs>
  <linearGradient id="pd-shade" x1="0" y1="0" x2="1" y2="0.32">
    <stop offset="0" stop-color="#2a1d48" stop-opacity="0"/><stop offset="0.6" stop-color="#2a1d48" stop-opacity="0"/>
    <stop offset="0.6" stop-color="#2a1d48" stop-opacity="0.36"/><stop offset="1" stop-color="#2a1d48" stop-opacity="0.44"/>
  </linearGradient>
  <linearGradient id="pd-gloss" x1="0" y1="0" x2="1" y2="0.2">
    <stop offset="0.16" stop-color="#fff" stop-opacity="0"/><stop offset="0.16" stop-color="#fff" stop-opacity="0.34"/>
    <stop offset="0.26" stop-color="#fff" stop-opacity="0.34"/><stop offset="0.26" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <pattern id="pd-mesh" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <path d="M0,0H6M0,0V6" stroke="${INK}" stroke-width="1" opacity="0.7"/>
  </pattern>
  <pattern id="pd-knit" width="5" height="5" patternUnits="userSpaceOnUse">
    <path d="M0,2.5L2.5,5L5,2.5" fill="none" stroke="#000" stroke-width="0.7" opacity="0.18"/>
  </pattern>
  <pattern id="pd-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
    <path d="M0,0V4" stroke="${INK}" stroke-width="0.7" opacity="0.2"/>
  </pattern>
</defs>`;

// A hood up, or a balaclava: the head covered, with a hole cut for the face (a hood) or only the eyes (a balaclava),
// so the face drawn under it shows through the hole.
function hoodShape(B, c, mat, eyesOnly) {
  const [hx, hy] = B.head, [rx, ry] = B.headR;
  const outer = smooth([[hx - rx - 6, hy + 10], [hx - rx - 5, hy - 14], [hx - rx * 0.4, hy - ry - 6], [hx + rx * 0.4, hy - ry - 6], [hx + rx + 5, hy - 14], [hx + rx + 6, hy + 10], [hx + rx - 2, hy + ry + 14], [hx - rx + 2, hy + ry + 14]]);
  const hole = eyesOnly
    ? smooth([[hx - 14, hy - 7], [hx + 14, hy - 7], [hx + 13, hy + 4], [hx - 13, hy + 4]])
    : smooth([[hx - rx + 3, hy], [hx - rx * 0.5, hy - ry + 8], [hx + rx * 0.5, hy - ry + 8], [hx + rx - 3, hy], [hx + rx * 0.5, hy + ry - 1], [hx - rx * 0.5, hy + ry - 1]]);
  return shape(outer + hole, c, { mat, front: true, evenodd: true });
}

// One garment's shapes, by kind, on body B.
function garmentShapes(B, it, g) {
  const out = [], c = g.col, dark = mix(c, [0, 0, 0], 0.45), lite = mix(c, [255, 255, 255], 0.35);
  const add = (d, extra) => out.push(shape(d, c, { mat: g.mat, ...extra }));
  const line_ = (d, extra) => out.push(detail(d, extra));
  // Sleeves go on before the body of the garment, so its shoulder line covers their tops (a set-in sleeve).
  // `sleeves` returns the shapes; the case that calls it puts them first.
  const sleeves = (t1, ease = 2, cuff = true) => {
    const at = out.length;
    for (const arm of [B.armA, B.armB]) {
      add(chain(arm, B.armR, { t1, ease, cap0: 'round', cap1: 'flat' }));
      if (cuff && t1 > 0.6) { const q = arm[2]; line_(`M${f1(q[0] - 8)},${f1(q[1] - 10)}l16,2`, { w: 1.2 }); }
    }
    // moved to the front of the list, under the body
    const sl = out.splice(at);
    out.unshift(...sl);
  };
  const legs = (t1, ease = 2.5, pelvisTop = B.waist) => {
    // the legs cut flat at the hip, then the seat over their tops, down to a V at the crotch
    add(chain(B.legA, B.legR, { t1, ease, cap0: 'flat', cap1: 'flat' }));
    add(chain(B.legB, B.legR, { t1, ease, cap0: 'flat', cap1: 'flat' }));
    const e = ease + 0.5, m = midAt(B.crotch), pts = [];
    for (let y = pelvisTop; y <= B.hip + 10; y += 6) pts.push([B.xs(Math.min(y, B.hip))[0] - e, y]);
    pts.push([m - 3, B.crotch + 4], [m + 3, B.crotch + 4]);
    for (let y = B.hip + 10 - ((B.hip + 10 - pelvisTop) % 6); y >= pelvisTop; y -= 6) pts.push([B.xs(Math.min(y, B.hip))[1] + e, y]);
    add(poly(pts));
  };
  const mid = midAt(B.waist);
  switch (g.kind) {
    // ── torso
    case 'bra': {
      // two cups and a band; the straps over the shoulders
      const y = B.fem ? 140 : 132, m = midAt(y), [l, r] = B.xs(y);
      const cl = (l + m) / 2, cr = (r + m) / 2;
      line_(line([[l + 1, y + 10], [r - 1, y + 10]]), { w: 3.2, col: c });
      for (const cx of [cl, cr]) add(smooth([[cx - 13, y + 9], [cx - 11, y - 3], [cx, y - 11], [cx + 11, y - 3], [cx + 13, y + 9], [cx, y + 13]]));
      const [sl, sr] = B.xs(96);
      line_(line([[sl + 13, 96], [cl - 6, y - 8]]), { w: 2, col: dark }); line_(line([[sr - 13, 96], [cr + 6, y - 8]]), { w: 2, col: dark });
      break;
    }
    case 'binder': add(torsoShape(B, 114, 172, { ease: 1, neck: 'none' })); break;
    case 'harness': {
      const [l, r] = B.xs(150);
      for (const d of [line([[l + 10, 100], [mid, 150], [r - 6, 210]]), line([[r - 10, 100], [mid, 150], [l + 6, 210]]), line([[l, 150], [r, 150]])]) line_(d, { w: 4.5, col: c });
      out.push(shape(ellipse(mid, 150, 5, 5), lite));
      break;
    }
    case 'undershirt': add(torsoShape(B, 92, 238, { ease: 1, neck: 'scoop' })); break;
    case 'crop': add(torsoShape(B, 100, 172, { ease: 1.5, neck: 'scoop' })); if (g.mat === 'sheer') out[out.length - 1].mesh = true; break;
    case 'tee': add(torsoShape(B, 88, 244, { ease: 2.5 })); sleeves(0.24, 3.5); line_(`M${f1(mid - 9)},94q9,7 18,0`, { w: 1.2 }); break;
    case 'shirt': add(torsoShape(B, 88, 246, { ease: 2.5, neck: 'v' })); sleeves(0.9, 2.5);
      line_(line([[midAt(114), 114], [midAt(240), 240]]), { w: 1.1 });
      for (const y of [130, 160, 190, 220]) out.push(shape(ellipse(midAt(y) + 2, y, 1.5, 1.5), dark, { shade: false }));
      line_(line([[mid - 12, 88], [mid - 2, 112], [mid - 6, 98]]), { w: 1.4 }); line_(line([[mid + 12, 88], [mid + 2, 112], [mid + 6, 98]]), { w: 1.4 });
      break;
    case 'sweater': add(torsoShape(B, 88, 248, { ease: 3.5 })); sleeves(0.92, 3.5); out.forEach((s) => { s.mat = 'knit'; });
      line_(line([[B.xs(240)[0] - 3, 240], [B.xs(240)[1] + 3, 240]]), { w: 1.2 });
      break;
    case 'hoodie': {
      add(torsoShape(B, 88, 250, { ease: 4 })); sleeves(0.92, 4);
      // the hood down, bunched behind the neck
      out.push(shape(smooth([[mid - 24, 96], [mid - 14, 82], [mid, 80], [mid + 14, 82], [mid + 24, 96], [mid, 104]]), mix(c, [0, 0, 0], 0.2)));
      line_(`M${f1(mid - 6)},100l-1,30M${f1(mid + 6)},100l1,30`, { w: 1.4 });
      add(smooth([[mid - 22, 206], [mid + 22, 206], [mid + 26, 232], [mid - 26, 232]]), { shade: false });
      break;
    }
    case 'jacket': case 'suit': {
      add(torsoShape(B, 86, 252, { ease: 4, neck: 'v' })); sleeves(0.94, 4);
      line_(line([[midAt(112), 112], [midAt(252), 252]]), { w: 1.6 });
      line_(line([[mid - 14, 88], [mid - 4, 140], [mid - 16, 120], [mid - 14, 88]]), { w: 1.4 }); line_(line([[mid + 14, 88], [mid + 4, 140], [mid + 16, 120], [mid + 14, 88]]), { w: 1.4 });
      if (g.kind === 'suit') out.push(shape(poly([[mid - 3, 112], [mid + 3, 112], [mid + 5, 168], [mid, 176], [mid - 5, 168]]), [150, 30, 36]));
      else for (const y of [204, 224]) line_(`M${f1(B.xs(y)[0] + 6)},${y}h14M${f1(B.xs(y)[1] - 20)},${y}h14`, { w: 1.2 });
      break;
    }
    case 'coat': case 'longcoat': case 'slicker': {
      const hem = g.kind === 'coat' ? 330 : 404;
      add(torsoShape(B, 86, hem, { ease: 5, neck: 'v', flare: g.kind === 'coat' ? 0.12 : 0.17 })); sleeves(0.95, 5);
      line_(line([[midAt(112), 112], [mid - 3, hem]]), { w: 1.6 });
      line_(line([[mid - 16, 88], [mid - 4, 150], [mid - 20, 126], [mid - 16, 88]]), { w: 1.5 }); line_(line([[mid + 16, 88], [mid + 4, 150], [mid + 20, 126], [mid + 16, 88]]), { w: 1.5 });
      line_(line([[B.xs(B.waist)[0] - 4, B.waist], [B.xs(B.waist)[1] + 4, B.waist]]), { w: 3, col: dark });
      if (g.kind === 'slicker') out.push(hoodShape(B, c, g.mat, false));
      break;
    }
    case 'vest': {
      add(torsoShape(B, 94, 242, { ease: 6, neck: 'scoop' }));
      if (g.mat === 'plate' || /kevlar|riot|plate/.test(it.name?.toLowerCase())) {
        for (const y of [130, 168, 206]) line_(line([[B.xs(y)[0] - 2, y], [B.xs(y)[1] + 2, y]]), { w: 1.4 });
        line_(line([[midAt(100), 112], [midAt(240), 240]]), { w: 1.2 });
      }
      break;
    }
    case 'apron': {
      add(smooth([[mid - 26, 118], [mid + 26, 118], [mid + 34, 200], [mid + 38, 330], [mid - 38, 330], [mid - 34, 200]]));
      line_(`M${f1(mid - 22)},118L${f1(mid - 12)},88M${f1(mid + 22)},118L${f1(mid + 12)},88`, { w: 2.5, col: c });
      break;
    }
    case 'gown': add(torsoShape(B, 100, 446, { ease: 2, neck: 'scoop', flare: 0.26 }));
      line_(line([[B.xs(100)[0] + 10, 100], [B.xs(96)[0] + 16, 90]]), { w: 2, col: c }); line_(line([[B.xs(100)[1] - 10, 100], [B.xs(96)[1] - 16, 90]]), { w: 2, col: c });
      break;
    case 'jumpsuit': legs(0.97, 3.5, B.waist); add(torsoShape(B, 88, 250, { ease: 3.5, neck: 'v' })); sleeves(0.93, 3.5);
      line_(line([[midAt(108), 108], [midAt(250), 250]]), { w: 1.4 });
      break;
    // ── legs
    case 'briefs': {
      // a band at the hips and the leg openings cut up from the crotch to the hip bone
      const y0 = B.hip - 14, [l, r] = B.xs(y0), m = midAt(B.crotch);
      add(poly([[l - 0.5, y0], [r + 0.5, y0], [r + 0.5, y0 + 9], [r - 4, y0 + 15], [m + 10, B.crotch - 2], [m + 6, B.crotch + 3], [m - 6, B.crotch + 3], [m - 10, B.crotch - 2], [l + 4, y0 + 15], [l - 0.5, y0 + 9]]));
      line_(line([[l, y0 + 4], [r, y0 + 4]]), { w: 1 });
      break;
    }
    case 'boxers': legs(0.18, 1.5, B.hip - 16); break;
    case 'leggings': legs(0.97, 0.6); break;
    case 'micro': legs(0.08, 2, B.waist + 10); break;
    case 'shorts': legs(0.34, 4); break;
    case 'skirt': add(torsoShape(B, B.waist, 320, { ease: 2, neck: 'none', flare: 0.32 })); break;
    case 'jeans': case 'pants': {
      legs(0.97, g.kind === 'jeans' ? 2 : 3.2);
      line_(line([[B.xs(B.waist)[0] - 3, B.waist + 6], [B.xs(B.waist)[1] + 3, B.waist + 6]]), { w: 1.2 });
      if (g.kind === 'jeans' || g.mat === 'denim') { line_(`M${f1(B.legA[0][0] - 12)},${B.hip + 4}q8,14 14,12M${f1(B.legB[0][0] + 12)},${B.hip + 6}q-8,14 -14,12`, { w: 1.1, col: [214, 170, 80] }); }
      if (/cargo/.test(it.name?.toLowerCase())) for (const L of [B.legA, B.legB]) out.push(shape(poly([[L[1][0] - 10, L[1][1] - 52], [L[1][0] + 8, L[1][1] - 52], [L[1][0] + 8, L[1][1] - 26], [L[1][0] - 10, L[1][1] - 26]]), mix(c, [0, 0, 0], 0.12)));
      break;
    }
    // ── feet
    case 'socks': for (const [L, F] of [[B.legA, B.footA], [B.legB, B.footB]]) { add(chain(L, B.legR, { t0: 0.86, t1: 1, ease: 1, cap0: 'flat' })); add(chain(F, B.footR, { ease: 0.8 })); } break;
    case 'sandals': for (const F of [B.footA, B.footB]) { out.push(shape(chain(F, B.footR, { ease: 1.2 }), mix(c, [0, 0, 0], 0.3), { sole: true })); line_(line([[F[0][0] - 6, F[0][1] + 2], [F[0][0] + 6, F[0][1] + 6]]), { w: 3, col: c }); } break;
    case 'slippers': for (const F of [B.footA, B.footB]) add(chain(F, [B.footR[0] + 4, B.footR[1] + 5], { ease: 1.5 })); break;
    case 'heels': for (const F of [B.footA, B.footB]) { add(chain(F, B.footR, { ease: 1 })); out.push(shape(poly([[F[0][0] - 2, F[0][1] + 4], [F[0][0] + 3, F[0][1] + 4], [F[0][0] + 1, F[0][1] + 20], [F[0][0], F[0][1] + 20]]), dark)); } break;
    case 'boots': case 'thighboots': case 'waders': {
      const t0 = g.kind === 'thighboots' ? 0.18 : g.kind === 'waders' ? 0 : 0.7;
      if (g.kind === 'waders') add(torsoShape(B, B.waist - 6, B.crotch + 6, { ease: 3, neck: 'none', flare: 0 }));
      for (const [L, F] of [[B.legA, B.footA], [B.legB, B.footB]]) {
        add(chain(L, B.legR, { t0, t1: 1, ease: 3.5, cap0: 'flat' }));
        add(chain(F, [B.footR[0] + 1.5, B.footR[1] + 2.5], { ease: 1.5 }));
        line_(line([[F[0][0] - 9, F[0][1] + 6], [F[1][0] + (F[1][0] > F[0][0] ? 8 : -8), F[1][1] + 6]]), { w: 3, col: [30, 26, 30] });
      }
      if (g.kind === 'waders') line_(`M${f1(B.xs(B.waist)[0] + 8)},${B.waist - 6}L${f1(B.xs(100)[0] + 14)},100M${f1(B.xs(B.waist)[1] - 8)},${B.waist - 6}L${f1(B.xs(100)[1] - 14)},100`, { w: 3, col: c });
      break;
    }
    case 'sneakers': case 'shoes':
      for (const F of [B.footA, B.footB]) { add(chain(F, [B.footR[0] + 1, B.footR[1] + 2], { ease: 1.4 })); line_(line([[F[0][0] - 8, F[0][1] + 7], [F[1][0] + (F[1][0] > F[0][0] ? 9 : -9), F[1][1] + 6]]), { w: 2.6, col: g.kind === 'sneakers' ? [236, 232, 224] : [28, 24, 28] }); }
      break;
    // ── hands
    case 'rings': for (const h of [B.handA, B.handB]) out.push(shape(ellipse(h[0], h[1] + 7, 2.4, 2.4), [214, 172, 62])); break;
    case 'wraps': for (const [arm, h] of [[B.armA, B.handA], [B.armB, B.handB]]) { add(chain([arm[2], h], [B.armR[2] + 1, B.armR[3] + 2], { ease: 1 })); line_(`M${f1(h[0] - 6)},${f1(h[1] - 6)}l12,4M${f1(h[0] - 6)},${f1(h[1])}l12,4`, { w: 1 }); } break;
    case 'opera': for (const arm of [B.armA, B.armB]) add(chain(arm, B.armR, { t0: 0.38, ease: 1.2, cap0: 'flat' })); break;
    case 'gauntlets': for (const arm of [B.armA, B.armB]) { add(chain(arm, B.armR, { t0: 0.62, ease: 4, cap0: 'flat' })); line_(`M${f1(arm[2][0] - 8)},${f1(arm[2][1] - 14)}l16,2`, { w: 1.3 }); } break;
    case 'mittens': for (const [arm, h] of [[B.armA, B.handA], [B.armB, B.handB]]) add(chain([arm[2], [h[0], h[1] + 6]], [B.armR[2] + 2.5, B.armR[3] + 5], { t0: 0.1, ease: 1, cap0: 'flat' })); break;
    case 'fingerless': case 'gloves':
      for (const [arm, h] of [[B.armA, B.handA], [B.armB, B.handB]]) {
        add(chain([arm[2], [h[0], h[1] + (g.kind === 'fingerless' ? 0 : 6)]], [B.armR[2] + 1.5, B.armR[3] + 3], { t0: 0, ease: 0.8, cap0: 'flat', cap1: g.kind === 'fingerless' ? 'flat' : 'round' }));
      }
      break;
    // ── head
    case 'cap': case 'beanie': case 'helmet': case 'bucket': {
      const [hx, hy] = B.head, [rx, ry] = B.headR, big = g.kind === 'helmet' ? 4 : 1.5;
      const brow = g.kind === 'beanie' ? hy - 8 : g.kind === 'helmet' ? hy - 6 : hy - 10;
      out.push(shape(smooth([[hx - rx - big, brow + 2], [hx - rx - big + 1, hy - ry * 0.55], [hx - rx * 0.5, hy - ry - big - 2], [hx + rx * 0.4, hy - ry - big - 3], [hx + rx + big - 1, hy - ry * 0.5], [hx + rx + big, brow], [hx, brow - 3]]), c, { mat: g.mat, front: true }));
      if (g.kind === 'cap') out.push(shape(smooth([[hx - rx * 0.6, brow - 2], [hx + rx + 14, brow - 4], [hx + rx + 16, brow + 2], [hx - rx * 0.6, brow + 3]]), dark, { front: true }));
      if (g.kind === 'bucket') out.push(shape(smooth([[hx - rx - 12, brow + 8], [hx, brow - 3], [hx + rx + 12, brow + 8], [hx, brow + 4]]), mix(c, [0, 0, 0], 0.1), { front: true }));
      if (g.kind === 'beanie') out.push(detail(line([[hx - rx - 1, brow - 4], [hx + rx + 1, brow - 5]]), { w: 1.2, front: true }));
      if (g.kind === 'helmet') out.push(detail(`M${f1(hx - rx - 3)},${f1(brow)}Q${f1(hx)},${f1(brow - 7)} ${f1(hx + rx + 3)},${f1(brow)}`, { w: 2, front: true }));
      break;
    }
    case 'hood': case 'balaclava': out.push(hoodShape(B, c, g.mat, g.kind === 'balaclava')); break;
    case 'veil': out.push(shape(smooth([[B.head[0] - 26, B.head[1] - 18], [B.head[0] + 26, B.head[1] - 18], [B.head[0] + 22, B.head[1] + 30], [B.head[0] - 22, B.head[1] + 30]]), c, { mesh: true, front: true, op: 0.55 })); break;
    case 'domino': out.push(shape(smooth([[B.head[0] - 18, B.head[1] - 6], [B.head[0], B.head[1] - 3], [B.head[0] + 18, B.head[1] - 6], [B.head[0] + 15, B.head[1] + 4], [B.head[0], B.head[1] + 1], [B.head[0] - 15, B.head[1] + 4]]), c, { front: true, face: true })); break;
    case 'facemask': case 'respirator': out.push(shape(smooth([[B.head[0] - 16, B.head[1] + 4], [B.head[0] + 16, B.head[1] + 4], [B.head[0] + 12, B.head[1] + 22], [B.head[0], B.head[1] + 27], [B.head[0] - 12, B.head[1] + 22]]), g.kind === 'respirator' ? [70, 74, 80] : c, { front: true, face: true, mat: 'plate' }));
      if (g.kind === 'respirator') for (const s of [-1, 1]) out.push(shape(ellipse(B.head[0] + s * 13, B.head[1] + 18, 5, 6), [44, 46, 52], { front: true, face: true }));
      break;
    case 'muffs': {
      const [hx, hy] = B.head, [rx, ry] = B.headR;
      out.push(detail(`M${f1(hx - rx - 2)},${f1(hy)}Q${f1(hx)},${f1(hy - ry - 14)} ${f1(hx + rx + 2)},${f1(hy)}`, { w: 3.5, col: dark, front: true }));
      for (const s of [-1, 1]) out.push(shape(ellipse(hx + s * (rx + 3), hy + 2, 6, 8), c, { front: true, mat: g.mat }));
      break;
    }
    case 'hairpiece': out.push(shape(smooth([[B.head[0] - 22, B.head[1] - 4], [B.head[0] - 14, B.head[1] - 30], [B.head[0] + 10, B.head[1] - 32], [B.head[0] + 24, B.head[1] - 8], [B.head[0] + 26, B.head[1] + 30], [B.head[0] + 20, B.head[1] - 8], [B.head[0], B.head[1] - 18], [B.head[0] - 18, B.head[1] + 30]]), [120, 220, 240], { front: true, glow: true })); break;
    case 'eyering': out.push(shape(ellipse(B.head[0] + 7, B.head[1] - 2, 4.5, 4.5), [90, 220, 255], { front: true, face: true, glow: true, op: 0.8 })); break;
    // ── accessories
    case 'scarf': {
      const n = B.neck[0];
      out.push(shape(smooth([[n[0] - 18, n[1] - 10], [n[0] + 18, n[1] - 12], [n[0] + 20, n[1] + 2], [n[0] - 18, n[1] + 4]]), c, { mat: 'knit', front: true }));
      out.push(shape(smooth([[n[0] + 4, n[1]], [n[0] + 16, n[1]], [n[0] + 20, n[1] + 60], [n[0] + 8, n[1] + 62]]), mix(c, [0, 0, 0], 0.1), { mat: 'knit', front: true }));
      break;
    }
    case 'collar': out.push(shape(smooth([[B.neck[0][0] - 10, B.neck[0][1] - 13], [B.neck[0][0] + 11, B.neck[0][1] - 14], [B.neck[0][0] + 11, B.neck[0][1] - 6], [B.neck[0][0] - 10, B.neck[0][1] - 5]]), c, { mat: 'gloss', front: true })); break;
    case 'chain': out.push(detail(`M${f1(B.neck[0][0] - 12)},${f1(B.neck[0][1])}Q${f1(B.neck[0][0])},${f1(B.neck[0][1] + 34)} ${f1(B.neck[0][0] + 12)},${f1(B.neck[0][1])}`, { w: 2.6, col: c, front: true })); break;
    case 'wrist': { const q = B.armA[2]; out.push(shape(smooth([[q[0] - 8, q[1] - 6], [q[0] + 8, q[1] - 5], [q[0] + 8, q[1] + 1], [q[0] - 8, q[1]]]), c, { front: true, mat: g.mat })); break; }
    case 'ring': out.push(shape(ellipse(B.handB[0], B.handB[1] + 7, 2.4, 2.4), c, { front: true })); break;
    case 'plugs': for (const s of [-1, 1]) out.push(shape(ellipse(B.head[0] + s * (B.headR[0] + 1), B.head[1] + 2, 2.5, 2.5), [230, 150, 40], { front: true })); break;
    case 'glasses': out.push(shape(`${ellipse(B.head[0] - 8, B.head[1] - 2, 7, 5)}${ellipse(B.head[0] + 9, B.head[1] - 2, 7, 5)}`, [20, 22, 30], { front: true, face: true, mat: 'gloss' }));
      out.push(detail(line([[B.head[0] - 1, B.head[1] - 3], [B.head[0] + 2, B.head[1] - 3]]), { w: 1.6, front: true }));
      break;
    case 'tote': {
      const h = B.xs(B.hip)[1];
      out.push(detail(line([[B.xs(100)[0] + 14, 100], [h + 6, B.hip - 8]]), { w: 3, col: c, front: true }));
      out.push(shape(smooth([[h - 6, B.hip - 10], [h + 26, B.hip - 12], [h + 30, B.hip + 34], [h - 4, B.hip + 36]]), c, { front: true }));
      break;
    }
    case 'kneepads': for (const k of [B.legA[1], B.legB[1]]) out.push(shape(smooth([[k[0] - 9, k[1] - 9], [k[0] + 9, k[1] - 9], [k[0] + 8, k[1] + 9], [k[0] - 8, k[1] + 9]]), c, { front: true, mat: g.mat })); break;
    case 'fanny': out.push(detail(line([[B.xs(B.waist + 8)[0] - 3, B.waist + 8], [B.xs(B.waist + 8)[1] + 3, B.waist + 8]]), { w: 3, col: dark, front: true }));
      out.push(shape(smooth([[mid - 18, B.waist + 2], [mid + 18, B.waist + 2], [mid + 16, B.waist + 22], [mid - 16, B.waist + 22]]), c, { front: true }));
      break;
    case 'strapharness': {
      const [l, r] = B.xs(150);
      out.push(detail(line([[l + 10, 100], [r - 4, 230]]), { w: 4.5, col: c, front: true }), detail(line([[l - 2, B.waist], [r + 2, B.waist]]), { w: 4.5, col: c, front: true }));
      out.push(shape(poly([[r - 16, B.waist - 8], [r - 2, B.waist - 8], [r - 2, B.waist + 14], [r - 16, B.waist + 14]]), dark, { front: true }));
      break;
    }
    case 'tattoo': out.push(detail(`M${f1(B.armB[1][0] - 3)},${f1(B.armB[1][1] - 40)}l6,10l-6,10l6,10`, { w: 1.6, col: [30, 60, 110], front: true, under: true })); break;
    case 'sleeve': add(chain(B.armA, B.armR, { t0: 0.5, t1: 0.88, ease: 2, cap0: 'flat', cap1: 'flat' }), { front: true }); break;
    case 'charm': out.push(shape(ellipse(B.xs(B.hip)[0] - 2, B.hip + 10, 4, 7), c, { front: true })); break;
    default: break;
  }
  return out;
}

// What's in your hand, drawn in the hand by the hip.
function weaponShapes(B, it, g) {
  const [x, y] = B.handB, out = [];
  const metal = [176, 182, 190], grip = [52, 44, 40];
  switch (g.kind) {
    case 'knife': out.push(shape(poly([[x - 2, y + 4], [x + 3, y + 4], [x + 4, y + 52], [x, y + 64], [x - 3, y + 50]]), metal, { mat: 'gloss' }), shape(poly([[x - 4, y - 10], [x + 5, y - 10], [x + 5, y + 6], [x - 4, y + 6]]), grip)); break;
    case 'sword': out.push(shape(poly([[x - 3, y + 6], [x + 3, y + 6], [x + 6, y + 150], [x, y + 166], [x - 4, y + 148]]), metal, { mat: 'gloss' }), shape(poly([[x - 12, y + 2], [x + 12, y + 2], [x + 12, y + 8], [x - 12, y + 8]]), [140, 110, 60]), shape(poly([[x - 3, y - 14], [x + 4, y - 14], [x + 4, y + 2], [x - 3, y + 2]]), grip)); break;
    case 'club': {
      const n = it.name?.toLowerCase() || '';
      if (/bat/.test(n)) out.push(shape(smooth([[x - 3, y - 16], [x + 3, y - 16], [x + 4, y + 30], [x + 9, y + 118], [x + 1, y + 128], [x - 8, y + 118], [x - 4, y + 30]]), /aluminum/.test(n) ? metal : [168, 128, 82], { mat: 'gloss' }));
      else if (/hammer/.test(n)) out.push(shape(poly([[x - 3, y - 14], [x + 3, y - 14], [x + 3, y + 104], [x - 3, y + 104]]), [110, 84, 60]), shape(poly([[x - 16, y + 100], [x + 16, y + 100], [x + 16, y + 124], [x - 16, y + 124]]), [72, 76, 84], { mat: 'gloss' }));
      else out.push(shape(poly([[x - 3, y - 14], [x + 3, y - 14], [x + 4, y + 100], [x + 12, y + 108], [x + 8, y + 114], [x - 4, y + 106]]), /wrench|iron/.test(n) ? [120, 124, 132] : [98, 84, 74], { mat: 'gloss' }));
      break;
    }
    case 'flail': out.push(shape(poly([[x - 3, y - 12], [x + 3, y - 12], [x + 3, y + 26], [x - 3, y + 26]]), grip), detail(`M${f1(x)},${f1(y + 26)}q-12,40 6,80q8,20 -4,40`, { w: 2.4, col: [90, 70, 50] })); break;
    case 'pistol': out.push(shape(poly([[x - 4, y - 8], [x + 6, y - 8], [x + 6, y + 10], [x + 26, y + 10], [x + 26, y + 20], [x - 6, y + 20], [x - 10, y + 6]]), [54, 56, 62], { mat: 'gloss' })); break;
    case 'longgun': out.push(shape(poly([[x - 30, y - 50], [x - 20, y - 56], [x + 46, y + 96], [x + 38, y + 102]]), [56, 58, 64], { mat: 'gloss' }), shape(poly([[x - 36, y - 64], [x - 18, y - 70], [x - 8, y - 40], [x - 24, y - 34]]), [110, 76, 50])); break;
    case 'lance': out.push(shape(poly([[x - 3, y - 30], [x + 3, y - 30], [x + 4, y + 110], [x - 4, y + 110]]), [90, 96, 106], { mat: 'gloss' }), shape(ellipse(x, y + 112, 6, 6), [110, 220, 255], { glow: true })); break;
    default: break;
  }
  return out;
}

// The body's own shapes, skin and hair, before anything is put on it.
function bodyShapes(B, look) {
  const skin = look.skin, hair = look.hair, out = [];
  const add = (d, extra) => out.push(shape(d, skin, { skin: true, ...extra }));
  // long hair falls behind the shoulders
  const cut = look.cut, [hx, hy] = B.head, [rx, ry] = B.headR;
  const backHair = { 3: 150, 16: 158, 18: 112, 11: 160, 6: 84, 19: 104 }[cut];
  if (backHair) out.push(shape(smooth([[hx - rx - 6, hy - 6], [hx - rx * 0.4, hy - ry - 5], [hx + rx * 0.5, hy - ry - 5], [hx + rx + 6, hy - 4], [hx + rx + 10, backHair - 10], [hx + rx - 2, backHair], [hx - rx + 2, backHair], [hx - rx - 10, backHair - 10]]), hair, { hair: true }));
  if (cut === 7) out.push(shape(smooth([[hx + rx - 4, hy - 16], [hx + rx + 14, hy - 10], [hx + rx + 12, hy + 46], [hx + rx + 4, hy + 50], [hx + rx + 2, hy - 2]]), hair, { hair: true }));
  // legs and arms, then the torso over their tops, so a shoulder is the torso's line with the deltoid under it
  for (const [L, F] of [[B.legA, B.footA], [B.legB, B.footB]]) { add(chain(L, B.legR)); add(chain(F, B.footR)); }
  for (const arm of [B.armA, B.armB]) add(chain(arm.slice(0, 3), B.armR.slice(0, 3)));
  add(chain(B.neck, [8.5 * B.k, 8 * B.k]));
  add(torsoShape(B, 84, B.crotch, { neck: 'none' }));
  for (const arm of [B.armA, B.armB]) {
    // the hand, with a thumb on the side toward the body
    const w = arm[2], h = arm[3];
    add(chain([w, [h[0], h[1] + 6]], [B.armR[2] * 0.95, B.armR[3] * 1.35]));
    out.push(detail(`M${f1(h[0] + (arm === B.armA ? 4 : -4))},${f1(h[1] - 2)}l${arm === B.armA ? 3 : -3},9`, { w: 1.1 }));
  }
  // the body's own lines, kept to a mannequin's: the collarbones, a chest or a bust, the navel, the knees
  const mid = midAt(110);
  out.push(detail(`M${f1(mid - 22)},100q10,6 18,3M${f1(mid + 22)},99q-10,6 -18,3`, { w: 1, under: true }));
  if (B.fem) out.push(detail(`M${f1(mid - 30)},150q14,12 26,0M${f1(mid + 28)},150q-14,12 -26,0`, { w: 1.2, under: true }));
  else out.push(detail(`M${f1(mid - 28)},140q14,8 26,2M${f1(mid + 26)},140q-14,8 -26,2`, { w: 1.1, under: true }));
  out.push(detail(`M${f1(midAt(206))},204v4`, { w: 1.2, under: true }));
  out.push(detail(`M${f1(B.legA[1][0] - 5)},${B.legA[1][1]}q5,4 10,0M${f1(B.legB[1][0] - 5)},${B.legB[1][1]}q5,4 10,0`, { w: 1, under: true }));
  // the head: a square comic jaw, ears, the face
  const jaw = smooth([[hx - rx, hy - 6], [hx - rx * 0.62, hy - ry], [hx + rx * 0.62, hy - ry], [hx + rx, hy - 6], [hx + rx * 0.86, hy + ry * 0.5], [hx + rx * 0.4, hy + ry * 0.95], [hx - rx * 0.4, hy + ry * 0.95], [hx - rx * 0.86, hy + ry * 0.5]]);
  for (const s of [-1, 1]) add(ellipse(hx + s * (rx - 1), hy + 2, 4.5, 7.5));
  add(jaw, { head: true });
  return out;
}

// The face and the hair on top: drawn after the clothes, under a hat.
function faceShapes(B, look) {
  const out = [], [hx, hy] = B.head, [rx, ry] = B.headR, hair = look.hair, cut = look.cut;
  const iris = look.iris, browW = 1.4 + look.brow * 1.6;
  for (const s of [-1, 1]) {
    out.push(shape(smooth([[hx + s * 4, hy - 2], [hx + s * 8.5, hy - 5], [hx + s * 13, hy - 2], [hx + s * 8.5, hy + 1]]), [240, 236, 228], { shade: false, face: true }));
    out.push(shape(ellipse(hx + s * 8.5, hy - 2, 2.4, 2.6), iris, { shade: false, face: true, noInk: true }));
    out.push(detail(`M${f1(hx + s * 3)},${f1(hy - 10)}Q${f1(hx + s * 9)},${f1(hy - 13.5)} ${f1(hx + s * 14)},${f1(hy - 9)}`, { w: browW, col: mix(hair, [0, 0, 0], 0.35), face: true }));
  }
  out.push(detail(`M${f1(hx + 1)},${f1(hy - 3)}l3,12l-4,2`, { w: 1.2, face: true }));
  out.push(detail(`M${f1(hx - 6)},${f1(hy + 15)}q6,2 12,-1`, { w: 1.4, face: true }));
  // hatching down the shadowed cheek, the house's comic manner
  out.push({ d: smooth([[hx + rx * 0.45, hy - 6], [hx + rx - 1, hy - 4], [hx + rx * 0.8, hy + ry * 0.55], [hx + rx * 0.35, hy + ry * 0.85]]), hatch: true, face: true });
  const facial = String(look.facial || '');
  const beard = mix(hair, [0, 0, 0], 0.15);
  if (/stubble|shadow/.test(facial)) out.push(shape(smooth([[hx - rx + 2, hy + 4], [hx + rx - 2, hy + 4], [hx + rx * 0.4, hy + ry * 0.95], [hx - rx * 0.4, hy + ry * 0.95]]), beard, { op: 0.28, shade: false, noInk: true, face: true }));
  if (/moustache|handlebar|vandyke|full|long|trimmed|horseshoe|anchor|walrus|fumanchu|friendly_mutton|bushy|forked|braided/.test(facial)) out.push(shape(smooth([[hx - 9, hy + 12], [hx, hy + 9], [hx + 9, hy + 12], [hx + (facial === 'handlebar' ? 13 : 8), hy + 15], [hx, hy + 13], [hx - (facial === 'handlebar' ? 13 : 8), hy + 15]]), beard, { face: true }));
  if (/goatee|vandyke|soulpatch|anchor/.test(facial)) out.push(shape(smooth([[hx - 5, hy + 18], [hx + 5, hy + 18], [hx + 4, hy + ry - 1], [hx - 4, hy + ry - 1]]), beard, { face: true }));
  if (/chinstrap|sideburns|full|long|trimmed|mutton|chin_curtain|bushy|forked|braided/.test(facial)) {
    const low = /^(long|forked|braided)$/.test(facial) ? ry + 16 : /mutton/.test(facial) ? ry - 6 : facial === 'sideburns' ? 4 : ry + 2;
    out.push(shape(smooth([[hx - rx, hy - 2], [hx - rx + 4, hy - 2], [hx - rx * 0.5, hy + Math.min(low, ry) - 4], [hx, hy + low - 2], [hx + rx * 0.5, hy + Math.min(low, ry) - 4], [hx + rx - 4, hy - 2], [hx + rx, hy - 2], [hx + rx * 0.6, hy + low], [hx, hy + low + 2], [hx - rx * 0.6, hy + low]]), beard, { face: true }));
  }
  // the hair over the top
  const top = hy - ry, line0 = hy - ry * 0.45;
  const cap = (vol = 0, side = 0) => smooth([[hx - rx - 1.5, hy - 2 + side], [hx - rx - 1, line0 - 6], [hx - rx * 0.55, top - 4 - vol * 0.6], [hx + rx * 0.1, top - 5 - vol], [hx + rx * 0.7, top - 3 - vol * 0.4], [hx + rx + 1.5, line0 - 4], [hx + rx + 1.5, hy - 2 + side], [hx + rx - 3, line0 + 2], [hx + rx * 0.2, line0 - 2], [hx - rx * 0.5, line0 + 3], [hx - rx + 3, line0 + 4]]);
  const H = (d, extra) => out.push(shape(d, hair, { hair: true, mat: 'gloss', ...extra }));
  if (look.shaved || cut === 12) H(cap(-3), { op: 0.55, noInk: cut !== 12 });
  else if (cut === 9) { H(cap(-3), { op: 0.4, noInk: true }); H(smooth([[hx - 5, line0 - 2], [hx - 4, top - 18], [hx + 4, top - 20], [hx + 6, line0 - 2]])); }
  else if (cut === 10) H(smooth([[hx - rx - 12, hy + 4], [hx - rx - 14, top - 4], [hx - rx * 0.3, top - 22], [hx + rx * 0.5, top - 22], [hx + rx + 14, top - 4], [hx + rx + 12, hy + 4], [hx + rx - 2, line0 + 2], [hx, line0 - 2], [hx - rx + 2, line0 + 2]]));
  else {
    const vol = cut === 4 || cut === 14 ? 10 : cut === 2 ? 5 : cut === 0 ? -1 : 3;
    H(cap(vol, cut === 6 || cut === 3 || cut === 16 || cut === 19 || cut === 11 ? 18 : cut === 15 ? 4 : 0));
    if (look.spikes) for (let i = -2; i <= 2; i++) H(poly([[hx + i * 8 - 4, top + 2], [hx + i * 9, top - 12 - (2 - Math.abs(i)) * 3], [hx + i * 8 + 4, top + 2]]));
    if (cut === 8 || cut === 17) H(ellipse(hx + 2, top - 10, 9, 8));
    if (cut === 20) for (const s of [-1, 1]) H(ellipse(hx + s * 14, top - 2, 7, 7));
    if (cut === 11) for (let i = 0; i < 4; i++) out.push(detail(`M${f1(hx - rx + i * 13)},${f1(line0)}v${30 + i * 4}`, { w: 2.6, col: mix(hair, [0, 0, 0], 0.4), hair: true }));
  }
  return out;
}

// The look the doll is drawn by, from the Pack's `look` (the MORPHEX columns) and sex.
export function dollLook({ look = {}, sex = 'male', you = '' } = {}) {
  const f = playerFigure(look) || {};
  const tones = Object.values(SKIN_RGB).slice(0, 8);
  return {
    sex: sex === 'female' ? 'female' : 'male',
    weight: Number.isFinite(f.weight) ? f.weight : 0.4,
    skin: f.skin || tones[hashOf(you || 'you') % tones.length],
    hair: f.hair || [86, 58, 36],
    iris: f.iris || [96, 60, 36],
    brow: Number.isFinite(f.brow) ? Math.min(1, Math.max(0, (f.brow - 0.45) / 0.95)) : 0.4,
    cut: Number.isFinite(f.hair_style) ? f.hair_style : 2,
    shaved: look.hair_length === 'shaved',
    spikes: f.spikes || 0,
    facial: f.facial || '',
  };
}

// The order a worn thing goes on: layer first, then a slot order that tucks a shirt into trousers and trousers into
// boots, and leaves shoes under a trouser's hem.
const SLOT_ORDER = { legs: 1, feet: 0, torso: 2, hands: 3, head: 5, accessory: 6, weapon_hand: 7 };
const BOOTS = new Set(['boots', 'thighboots', 'waders']);
function wearOrder(a, b) {
  const la = a.it.slot === 'accessory' || a.it.slot === 'weapon_hand' ? 9 : (a.it.layer || 2), lb = b.it.slot === 'accessory' || b.it.slot === 'weapon_hand' ? 9 : (b.it.layer || 2);
  if (la !== lb) return la - lb;
  const sa = SLOT_ORDER[a.it.slot] + (BOOTS.has(a.g.kind) ? 1.5 : 0), sb = SLOT_ORDER[b.it.slot] + (BOOTS.has(b.g.kind) ? 1.5 : 0);
  return sa - sb;
}

// Render one shape list into SVG: the silhouette's heavy ink behind everything, then each shape's fill, shadow and
// line. `ink` is the outline's weight.
function render(list, { ink = 2 } = {}) {
  let back = '', front = '';
  for (const s of list) {
    if (s.hatch) { front += `<path d="${s.d}" fill="url(#pd-hatch)" class="pd-hatch"/>`; continue; }
    if (s.detail) { front += `<path d="${s.d}" fill="none" stroke="${s.col ? rgb(s.col) : INK}" stroke-width="${s.w}" stroke-linecap="round" stroke-linejoin="round"/>`; continue; }
    const eo = s.evenodd ? ' fill-rule="evenodd"' : '';
    const op = (s.op != null ? ` opacity="${s.op}"` : '') + eo;
    if (!s.noInk && !s.face && s.op == null) back += `<path d="${s.d}"${eo}/>`;
    let p = `<path d="${s.d}" fill="${rgb(s.col)}"${op}${s.noInk ? '' : ` stroke="${INK}" stroke-width="${ink}" stroke-linejoin="round"`}/>`;
    if (s.mesh || s.mat === 'sheer') p = `<path d="${s.d}" fill="url(#pd-mesh)"/>` + p.replace(`fill="${rgb(s.col)}"`, `fill="${rgb(s.col)}" fill-opacity="0.5"`);
    if (s.shade && s.op == null) p += `<path d="${s.d}" fill="url(#pd-shade)"${eo}/>`;
    if (s.mat === 'knit') p += `<path d="${s.d}" fill="url(#pd-knit)"${eo}/>`;
    if (s.mat === 'gloss' || s.mat === 'plate') p += `<path d="${s.d}" fill="url(#pd-gloss)"${eo}/>`;
    if (s.glow) p = `<g class="pd-glow">${p}</g>`;
    front += p;
  }
  return { back, front };
}

// The doll. `items` are the Pack's rows; the worn ones are drawn. opts: { selected: rowId, ghost: row, hover: rowId }.
export function dollSvg(pack, opts = {}) {
  const look = dollLook(pack);
  const B = makeBody(look.sex, look.weight);
  const worn = (pack.items || []).filter((it) => it.worn && it.slot);
  if (opts.ghost?.slot && !worn.some((w) => w.id === opts.ghost.id)) worn.push({ ...opts.ghost, ghost: true });
  const pieces = worn.map((it) => ({ it, g: garmentOf(it) })).sort(wearOrder);
  // a hood or a balaclava hides the hair under it; a hat sits on it
  const hoodUp = pieces.some((p) => p.g.kind === 'hood' || p.g.kind === 'balaclava' || p.g.kind === 'slicker');
  let svg = '';
  const body = render(bodyShapes(B, look));
  const face = render(hoodUp ? faceShapes(B, look).filter((s) => !s.hair) : faceShapes(B, look));
  const groups = [], backs = [body.back];
  const fronts = [];
  for (const { it, g } of pieces) {
    const list = it.slot === 'weapon_hand' ? weaponShapes(B, it, g) : garmentShapes(B, it, g);
    const under = list.filter((s) => !s.front), over = list.filter((s) => s.front);
    const cls = `pd-item${it.id === opts.selected ? ' sel' : ''}${it.id === opts.hover ? ' hov' : ''}${it.ghost ? ' ghost' : ''}`;
    const r1 = render(under), r2 = render(over);
    if (!it.ghost) backs.push(r1.back, r2.back);
    if (r1.front) groups.push(`<g class="${cls}" data-id="${attr(it.id)}"><title>${attr(it.name)}</title>${r1.front}</g>`);
    if (r2.front) fronts.push(`<g class="${cls}" data-id="${attr(it.id)}"><title>${attr(it.name)}</title>${r2.front}</g>`);
  }
  svg += `<g class="pd-ink" fill="${INK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round">${backs.join('')}</g>`;
  svg += `<g class="pd-body">${body.front}</g>${groups.join('')}<g class="pd-face">${face.front}</g>${fronts.join('')}`;
  return `<svg class="pd-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="You, as you're dressed">${DEFS}`
    + `<ellipse cx="128" cy="462" rx="62" ry="8" fill="#000" opacity="0.28"/>${svg}</svg>`;
}

export const _test = { makeBody, garmentShapes, weaponShapes, bodyShapes, faceShapes, chain, KINDS };
