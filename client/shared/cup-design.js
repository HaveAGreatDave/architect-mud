// THE CUP'S DESIGN: a league's Cup as a turned profile in metres, the bands its winners are engraved on, the band
// round the bowl its own name is cut into, and the emblem that stands on top. Pure data and arithmetic, shared by the
// case in a Cup room (gl/room-cup.js, which engraves and polishes it) and Cup night on the ice (gl/arena-mesh.js
// buildCup, in feet), so the Cup you lean over in the case is the one lifted on the ice.
//
// The hockey Cup is drawn after the Stanley Cup: a barrel of five bands on a gold foot, three narrowing tiers above it
// cut with ornament, a cove up to a gold collar and knop, and a shallow bowl with a rolled gold lip. Polished chrome,
// every edge picked out in gold, and a gilt goose on a stepped plinth in the bowl (shared/goose-emblem.js).
//
// A BARREL HOLDS A HUNDRED SEASONS: five bands, each two rows of ten panels, one winner a panel. Season 101 is the
// first on a second barrel, added under the first, and the Cup stands that much taller; the case lowers its plinth to
// take it (gl/room-stadium.js trophyCup). Past MAX_BARRELS the oldest barrel's seasons are no longer shown.
//
// THE ENGRAVING IS A TEXTURE (gl/room-cup.js paintCupRoll), laid on each engraved band from one atlas whose strips
// `cupAtlas` places: a strip is its band unrolled, as wide as the atlas and as tall as keeps its letters square.
//
// ⚠ NOTHING HERE NAMES A CLUB. The winners come from the server (plugins/stands champions.js `rolls`), the name round
// the bowl from the piece (`look.inscription`).

export const PER_BARREL = 100, BANDS_PER_BARREL = 5, ROWS = 2, PANELS = 10, MAX_BARRELS = 3;
const B = 0.064, T = 0.052, BEAD = 0.006;   // a barrel band's height, a tier's, a bead's
// a half-round bead standing out of radius r from y0 to y1 (three facets up it: the renderer smooths its normals)
const bead = (r, y0, y1) => { const h = (y1 - y0) / 2, m = (y0 + y1) / 2; return Array.from({ length: 4 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; return [r + Math.cos(a) * h, m + Math.sin(a) * h]; }); };
// a quarter of an ellipse from (r0, y0) to (r1, y1), `n` steps; `bow` 1 bulges out, -1 curves in
const sweep = (r0, y0, r1, y1, n, bow) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (i / n) * Math.PI / 2;
  return bow > 0 ? [r0 + (r1 - r0) * Math.sin(a), y1 - (y1 - y0) * Math.cos(a)] : [r1 + (r0 - r1) * Math.cos(a), y0 + (y1 - y0) * Math.sin(a)];
});

function hockeyCup(barrels) {
  const parts = [], bands = [];
  const part = (metal, prof, band = null) => parts.push({ metal, prof, ...(band ? { band } : {}) });
  // an engraved band: the chrome it's cut into, and what's cut (`kind`: 'roll', 'ornament' or 'name')
  const band = (r, y0, y1, info) => { const b = { r, y0, y1, ...info }; bands.push(b); part('chrome', [[r, y0], [r, y1]], b); };
  // the foot: a gold ring, its edge rolled
  part('gold', [[0, 0], [0.212, 0], [0.216, 0.002], [0.218, 0.006], [0.218, 0.01], [0.214, 0.014], [0.207, 0.015]]);
  // the barrels, the newest at the bottom: five bands between gold beads, and a heavier bead between two barrels
  let y = 0.015;
  for (let k = barrels - 1; k >= 0; k--) {
    for (let i = BANDS_PER_BARREL - 1; i >= 0; i--) {
      band(0.205, y, y + B, { kind: 'roll', barrel: k, band: i }); y += B;
      const last = i === 0 && k > 0;
      part('gold', bead(0.205, y, y + (last ? 0.012 : BEAD))); y += last ? 0.012 : BEAD;
    }
  }
  part('chrome', [[0.205, y], [0.186, y + 0.003]]); y += 0.003;
  // the three tiers, each narrower, a bead under and over each and a ledge in to the next
  [[0.182, 0.158], [0.158, 0.134], [0.134, 0.12]].forEach(([r, next], i) => {
    part('gold', bead(r, y, y + 0.005)); y += 0.005;
    band(r, y, y + T, { kind: 'ornament', tier: i }); y += T;
    part('gold', bead(r, y, y + 0.005)); y += 0.005;
    part('chrome', [[r, y], [next, y + 0.003]]); y += 0.003;
  });
  // the cove up to the collar, the collar, the stem and its knop
  part('chrome', sweep(0.12, y, 0.072, y + 0.042, 6, -1)); y += 0.042;
  part('gold', [[0.072, y], [0.08, y + 0.002]]); y += 0.002;
  part('gold', bead(0.08, y, y + 0.02)); y += 0.02;
  part('gold', [[0.08, y], [0.064, y + 0.003]]); y += 0.003;
  part('chrome', [[0.064, y], [0.058, y + 0.005], [0.056, y + 0.029], [0.06, y + 0.033]]); y += 0.033;
  part('gold', bead(0.06, y, y + 0.02)); y += 0.02;
  // the bowl: its underside swept out to the wall (a row of gold studs two-thirds of the way out), a bead, the wall
  // with the Cup's name, the rolled lip and the inside
  const studs = { r: 0.06 + 0.098 * Math.sin(0.9), y: y + 0.06 - 0.06 * Math.cos(0.9), n: 28, size: 0.0036 };
  part('chrome', sweep(0.06, y, 0.158, y + 0.06, 8, 1)); y += 0.06;
  part('gold', bead(0.158, y, y + BEAD)); y += BEAD;
  band(0.158, y, y + 0.04, { kind: 'name' }); y += 0.04;
  part('gold', [...bead(0.158, y, y + 0.012), [0.152, y + 0.013]]);
  const lip = y + 0.013, deep = 0.038;
  part('chrome', [[0.152, lip], ...sweep(0.15, y, 0, y - deep, 8, -1)]);
  // the plinth the goose stands on, gold, in three steps up from the bowl's floor to a hair over the lip
  const fl = (r) => y - deep * Math.sqrt(Math.max(0, 1 - (r / 0.15) ** 2));
  const top = lip + 0.006;
  part('gold', [[0.046, fl(0.046)], [0.046, top - 0.042], [0.035, top - 0.042], [0.035, top - 0.022], [0.026, top - 0.022], [0.026, top], [0, top]]);
  const emblem = { kind: 'goose', y: top, h: 0.12 };
  return { sport: 'hockey', barrels, parts, bands, studs, emblem, height: top + emblem.h, radius: 0.218 };
}

const MADE = new Map();
// A league's Cup for `seasons` winners: as many barrels as they fill, one at least.
export function cupDesign(sport, seasons = 0) {
  if (sport !== 'hockey') return null;
  const barrels = Math.max(1, Math.min(MAX_BARRELS, Math.ceil((Number(seasons) || 0) / PER_BARREL)));
  const key = `${sport}:${barrels}`;
  if (!MADE.has(key)) MADE.set(key, hockeyCup(barrels));
  return MADE.get(key);
}
export const CUP_DESIGNS = { get hockey() { return cupDesign('hockey'); } };

// Where each winner is cut, oldest first: barrel 0 is the top one, and in it the top band, its top row, round from
// the front. [{ roll, barrel, band, row, panel }]. Past MAX_BARRELS × PER_BARREL only the newest are kept.
export function cupSlots(design, rolls) {
  const list = (Array.isArray(rolls) ? rolls : []).filter((r) => r && typeof r.name === 'string' && r.name.trim());
  const keep = list.slice(Math.max(0, list.length - design.barrels * PER_BARREL));
  return keep.map((roll, i) => ({
    roll, barrel: Math.floor(i / PER_BARREL), band: Math.floor((i % PER_BARREL) / (ROWS * PANELS)),
    row: Math.floor((i % (ROWS * PANELS)) / PANELS), panel: i % PANELS,
  }));
}

// The engraving's atlas: every engraved band a strip `W` wide (the whole way round) and as tall as keeps it square,
// a gap between strips so a mip doesn't bleed one into the next. { W, H, strips: [{ band, v0, v1 }] } in pixels.
export function cupAtlas(design, W = 4096) {
  const gap = Math.round(W / 512);
  let v = gap;
  const strips = design.bands.map((band) => {
    const h = Math.ceil((W * (band.y1 - band.y0)) / (2 * Math.PI * band.r));
    const s = { band, v0: v, v1: v + h };
    v += h + gap;
    return s;
  });
  return { W, H: v, strips };
}
// Round a band, the texture's u: the front (angle 0) in the middle of the strip, and rightward as you face it
// (clockwise from above) is further along. Never wrapped: the texture repeats, so the seam is at the back.
export const cupU = (angle) => 0.5 - angle / (2 * Math.PI);

// A winner's lines as they're cut: the year (or the season, with no date), the club's name, and the season under it.
const CLEAN = /[\u0000-\u001f<>|{}\\]/g;
export const cupClean = (s, n = 40) => String(s || '').replace(CLEAN, '').replace(/\s+/g, ' ').trim().slice(0, n);
export function cupLines(roll) {
  const name = cupClean(roll.name), year = Number.isFinite(roll.year) ? String(roll.year) : null;
  return { head: year || (roll.season ? `Season ${roll.season}` : ''), name, foot: year && roll.season ? `Season ${roll.season}` : '' };
}
