// The Vat Hall (zone_start), the clone facility's ground floor in ROOM (docs/proposals/clone-facility-depths.md,
// phase 2): where every respawn happens. A tall machine room: eighteen growing vats in two deep rows down each
// wall, every one with a body asleep in it; four release vats round the dressing gantry in the middle of the floor,
// standing empty until a body comes down a tube; tubes from every crown to the ceiling and in to one trunk over the
// middle; monitoring towers between the wall vats; the plant that feeds them at either end. Its walls and floor are
// marked all over (client/game/js/panels/room-marks.js): wayfinding, labels, placards, readouts, stencils, tags,
// posters, stains and a scrawl or two, lettered in the house font library.
// Idempotent: every id is fixed and a file is only written when it would change. Edit this and run it again, not
// the JSON.
//
//   node scripts/content/vat-hall.mjs
//   npm run content:lint
//
// The frame: `at` is [u, v] in metres, u across the room (-7 to 7), v back from the front wall (0 to 16). The back
// wall (v 16) is the street side, where the exit is. `turn` 0 faces the front wall, 180 the back, 90 toward +u.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const file = (dir, id) => path.join(CONTENT_DIR, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
let wrote = 0;
const save = (dir, row) => {
  const f = file(dir, row.id), text = canonicalJson(row);
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === text) return;
  fs.writeFileSync(f, text, 'utf8');
  wrote++;
};
const ZONE = 'zone_start', W = 14, D = 16, H = 8;
const GREEN = '#4dffb0', AMBER = '#ffc86a', BONE = '#d8dcd6';

// ── the furniture ──────────────────────────────────────────────────────────────────────────────────
const deco = (id, name, description, look, spot, extra = {}) => ({
  description, flags: { look, spot }, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name,
  object_type: 'decoration', power_draw_kw: null, price: null, zone_id: ZONE, ...extra,
});
// keeps a row's own fields (a light's wiring, a poster's text) and replaces only what the hall decides
const keep = (id, patch) => {
  const f = file('furniture', id);
  const row = fs.existsSync(f) ? read('furniture', id) : {};
  return { ...row, ...patch, flags: { ...(row.flags || {}), ...(patch.flags || {}) } };
};
const rows = [];
const VAT_DIMS = [1.2, 1.2, 3.0], RELEASE_DIMS = [1.2, 1.2, 2.9];
const growDesc = 'A tall glass vat of lit green fluid over a drain in the floor. A body floats asleep in it, masked, its hose running up through the crown into the tubes overhead. The plate gives its number.';
// the growing vats: a row against each wall, a row staggered in front of it. The two at the street end of each side
// are gone (fewer sleepers, each the close-up figure with the fine head), but the numbering keeps its gaps, so a vat
// keeps its id and its plate: 6, 11, 17 and 22 stand nowhere. Deleting this file's rows doesn't delete their
// furniture files; those were removed by hand
const WALL_V = [2.2, 4.4, 6.6, 8.8, 11.0, 13.2], INNER_V = [3.3, 5.5, 7.7, 9.9, 12.1], GONE_V = new Set([13.2, 12.1]);
let n = 0;
const vatId = (k) => `furn_clone_vat_${k}`;
for (const side of [-1, 1]) {
  const row = side < 0 ? 'A' : 'B';
  for (const v of WALL_V) { n++; if (GONE_V.has(v)) continue; rows.push(deco(vatId(n), 'growing vat', growDesc, { arche: 'prop', form: 'vat', dims: VAT_DIMS, tag: `${row}-${String(n).padStart(2, '0')}` }, { wall: side < 0 ? 'left' : 'right', along: v })); }
  for (const v of INNER_V) { n++; if (GONE_V.has(v)) continue; rows.push(deco(vatId(n), 'growing vat', growDesc, { arche: 'prop', form: 'vat', dims: VAT_DIMS, tag: `${row}-${String(n).padStart(2, '0')}` }, { at: [side * 4.3, v], turn: side < 0 ? 90 : -90 })); }
}
// the release vats, round the gantry, their fronts to the street
const RELEASE = [[-1.9, 5.9], [1.9, 5.9], [-1.9, 10.1], [1.9, 10.1]];
RELEASE.forEach(([u, v], i) => rows.push(deco(`furn_clone_release_${i + 1}`, 'release vat',
  'A release vat, empty and dry, its grille floor lit amber from below and a big tube coming down into its crown. Your next body comes down that tube in a gush of fluid, and the drain takes the fluid away.',
  { arche: 'prop', form: 'vat', dims: RELEASE_DIMS, state: 'release', tag: `R-${i + 1}` }, { at: [u, v], turn: 180 })));
// the dressing gantry, in the middle
rows.push(deco('furn_clone_gantry', 'dressing gantry',
  'A turret hung off the trunk on a telescoping boom, eight jointed arms folded round it. A hose feeds vat suits down through its middle and fires them out of a nozzle underneath. When a body comes out of a release vat, the arms come down and catch.',
  { arche: 'prop', form: 'gantry', dims: [2.4, 2.4, 3.6] }, { at: [0, 8], turn: 180 }));
// monitoring towers between the wall vats
[[-1, 3.3, 'MON-A1'], [-1, 7.7, 'MON-A2'], [-1, 12.1, 'MON-A3'], [1, 3.3, 'MON-B1'], [1, 7.7, 'MON-B2'], [1, 12.1, 'MON-B3']].forEach(([side, v, tag], i) => rows.push(deco(`furn_clone_rack_${i + 1}`, 'monitoring tower',
  'A steel tower of screens: vitals for the vats either side of it, a column of status lights, a keyboard nobody uses. A harness of cable leaves its top for the ceiling.',
  { arche: 'prop', form: 'vatrack', dims: [0.9, 0.62, 2.3], tag }, { wall: side < 0 ? 'left' : 'right', along: v })));
// the plant at either end
[['front', -5.2], ['front', 5.2], ['back', 2.6], ['back', 5.4]].forEach(([wall, along], i) => rows.push(deco(`furn_clone_manifold_${i + 1}`, 'pump manifold',
  'The plant that feeds the vats: two pumps on a skid, a header of pipe overhead, hand wheels painted red, and gauges whose needles never settle.',
  { arche: 'prop', form: 'manifold', dims: [1.8, 0.9, 1.9] }, { wall, along })));
// what was here before, moved to fit: the MORPHEX pod in the middle of the front wall, under its sign (the soylent
// dispenser that stood beside it is gone)
rows.push(keep('furniture_morphex_start', { flags: { spot: { wall: 'front', along: 0 } } }));
rows.push(keep('furniture_shoddy_tv_start', { flags: { spot: { wall: 'back', along: 3.0, y: 2.0 } } }));
rows.push(keep('furn_clone_bench', { flags: { spot: { at: [2.4, 14.6], turn: 180 } } }));

// ── the marks (room-marks.js) ────────────────────────────────────────────────────────────────────
const marks = [
  // the front wall, behind you as you step out of a release vat
  { kind: 'neon', wall: 'front', at: 0, y: 5.7, w: 6.4, h: 1.15, text: 'Coldwater Clone Facility', sub: 'Printed while you wait', font: 'Michroma', tint: GREEN },
  // the MORPHEX 9000's own sign over the pod, lit: the company's mark (room-marks.js logo)
  { kind: 'logo', wall: 'front', at: 0, y: 3.42, w: 3.5, h: 1.02, text: 'Morphex|9000', sub: 'BioSculpt Systems · You, but better', font: 'Michroma', num_font: 'Oxanium', tint: '#2fd8ff', accent: '#9ff4ff' },
  { kind: 'poster', wall: 'front', at: -5.2, y: 3.3, w: 1.15, h: 1.65, text: 'Your backup|is 94% you', sub: 'Ask about Continuity Plus.|Memories not included.', small: 'Continuity Plus is a product of the Algorithm. No refunds on self.', tint: '#1d3a5c', accent: AMBER },
  { kind: 'poster', wall: 'front', at: 5.2, y: 3.3, w: 1.15, h: 1.65, text: 'Die|responsibly', sub: 'Every reprint is logged.|Every log is billed.', small: 'Complimentary cloning subject to review.', tint: '#5c1d2a', accent: '#ff6a5a' },
  { kind: 'tag', wall: 'front', at: -4.55, y: 1.35, w: 0.62, h: 0.34, text: 'Out of service|Pump 2 · seal weeping', sub: 'do not restart - K.V. 3rd shift' },
  { kind: 'label', wall: 'front', at: 5.2, y: 2.15, w: 1.1, h: 0.32, text: 'Hot pipe', sub: 'Growth medium at 37°C' },
  // the back wall: the way out
  { kind: 'wayfinding', wall: 'back', at: -4.2, y: 3.15, w: 1.9, h: 0.5, text: 'Exit', sub: 'Street · Coldwater', arrow: 'down', tint: GREEN },
  { kind: 'readout', wall: 'back', at: 0, y: 4.75, w: 3.4, h: 1.35, text: 'Release queue|Bay 1 · ready|Bay 2 · ready|Bay 3 · cycling|Bay 4 · ready', sub: 'Next print --:--', tint: '#5affc8' },
  // O'Toole's advert: Rusty himself, photographed from below (the picture is his figure, shot in the Figure Lab)
  { kind: 'poster', wall: 'back', at: -1.5, y: 2.65, w: 1.2, h: 1.75, img: 'posters/grady-two-cell.webp', text: "O'Toole's|Surplus", sub: 'East along the street.|Family run since 1924.', small: 'Keep the rain off.', tint: '#2a1a10', accent: '#ff8a2a', font: 'Tektur' },
  { kind: 'scrawl', wall: 'back', at: -1.4, y: 1.15, w: 1.3, h: 0.3, text: 'they keep the first one' },
  { kind: 'stain', wall: 'back', at: 5.4, y: 3.8, w: 0.9, h: 2.4, drip: true, tint: '#4a3a24' },
  // the left wall: growth row A
  { kind: 'stencil', wall: 'left', at: 8, y: 6.4, w: 3.6, h: 0.7, text: 'Growth row A', font: 'Big Shoulders Stencil Display', tint: BONE },
  { kind: 'readout', wall: 'left', at: 1.1, y: 4.3, w: 1.5, h: 0.7, text: 'Row A · 9 in growth|Mean gestation 31h|Defects 0.4%', tint: '#5ad8ff' },
  { kind: 'label', wall: 'left', at: 5.5, y: 3.6, w: 1.4, h: 0.4, text: 'Do not tap the glass', sub: 'They can hear it' },
  { kind: 'placard', wall: 'left', at: 9.9, y: 3.7, w: 0.62, h: 0.62, text: '6.2', sub: 'Infectious', tint: '#f5f3ee' },
  { kind: 'stain', wall: 'left', at: 10.9, y: 5.2, w: 0.7, h: 2.2, drip: true, tint: '#2a4a32' },
  { kind: 'stain', wall: 'left', at: 4.4, y: 5.6, w: 0.5, h: 1.6, drip: true, tint: '#3a3426' },
  { kind: 'scrawl', wall: 'left', at: 14.6, y: 1.1, w: 1.4, h: 0.32, text: '#4471 was here #4471 was here', tint: '#262630' },
  { kind: 'poster', wall: 'left', at: 14.6, y: 2.7, w: 0.95, h: 1.35, text: 'Grief is|a symptom', sub: 'Symptoms are billable.|Report it at the counter.', small: 'The Algorithm cares about your outcomes.', tint: '#2a4a3a', accent: GREEN },
  // the right wall: growth row B
  { kind: 'stencil', wall: 'right', at: 8, y: 6.4, w: 3.6, h: 0.7, text: 'Growth row B', font: 'Big Shoulders Stencil Display', tint: BONE },
  { kind: 'readout', wall: 'right', at: 1.1, y: 4.3, w: 1.5, h: 0.7, text: 'Row B · 9 in growth|Next decant 00:41|Medium 97% nominal', tint: '#5ad8ff' },
  { kind: 'label', wall: 'right', at: 5.5, y: 3.6, w: 1.4, h: 0.4, text: 'Biohazard', sub: 'Growth medium · do not drink' },
  { kind: 'label', wall: 'right', at: 8.0, y: 2.3, w: 1.3, h: 0.36, text: 'Pinch point', sub: 'Keep your limbs in your body', tint: '#ff8a3a' },
  { kind: 'placard', wall: 'right', at: 9.9, y: 3.7, w: 0.62, h: 0.62, text: '8', sub: 'Corrosive', tint: '#202020' },
  { kind: 'stain', wall: 'right', at: 6.7, y: 5.4, w: 0.6, h: 2.0, drip: true, tint: '#2a4a32' },
  { kind: 'scrawl', wall: 'right', at: 13.8, y: 1.25, w: 1.2, h: 0.3, text: 'count your fingers', tint: '#1a1a22' },
  { kind: 'tag', wall: 'right', at: 12.9, y: 1.45, w: 0.6, h: 0.33, text: 'Inspected|Seals · lines · faith', sub: 'ok for now - P.' },
  // the floor: the release bays, the gantry's reach, and what's been spilt
  ...RELEASE.map(([u, v], i) => ({ kind: 'stencil', floor: [u, v + (v < 8 ? -1.05 : 1.05)], turn: 180, w: 1.1, h: 0.32, text: `Release ${i + 1}`, tint: AMBER })),
  { kind: 'stencil', floor: [0, 6.45], turn: 180, w: 1.9, h: 0.3, text: 'Keep clear · gantry', tint: '#e8b818' },
  { kind: 'stencil', floor: [0, 9.55], turn: 0, w: 1.9, h: 0.3, text: 'Keep clear · gantry', tint: '#e8b818' },
  { kind: 'stencil', floor: [-4.2, 14.6], turn: 180, w: 1.3, h: 0.35, text: 'Exit', tint: GREEN },
  ...RELEASE.map(([u, v], i) => ({ kind: 'stain', floor: [u + (i % 2 ? 0.35 : -0.35), v + 0.2], turn: i * 37, w: 1.7, h: 1.4, tint: '#2f6a48' })),
  { kind: 'stain', floor: [-5.0, 1.4], turn: 20, w: 1.6, h: 1.0, tint: '#4a3018' },
  { kind: 'stain', floor: [5.3, 14.8], turn: 70, w: 1.4, h: 1.1, tint: '#4a3018' },
  { kind: 'stain', floor: [-4.3, 8.9], turn: 110, w: 1.2, h: 0.9, tint: '#2f5a40' },
  { kind: 'stain', floor: [4.3, 4.6], turn: 15, w: 1.1, h: 0.8, tint: '#2f5a40' },
  { kind: 'label', floor: [2.5, 12.6], turn: 180, w: 0.9, h: 0.26, text: 'Wet floor', sub: 'it is always wet', tint: '#f2c230' },
];

// ── the room ───────────────────────────────────────────────────────────────────────────────────────
const zone = read('zones', ZONE);
const was = zone.flags.room || {};
// the release floor: the four release vats and the gantry stand in a sunken bay a step down from the hall's floor
// (room-layout.js `pit`: the rectangle, how deep, and the ledge round its inside you step down onto)
const PIT = { at: [-3.3, 3.3, 4.2, 11.8], depth: 0.5, step: 0.42 };
const paint = [
  // hazard round each release vat's drain and the gantry's sweep, down on the release floor
  ...RELEASE.map(([u, v]) => ({ kind: 'box', rect: [u - 0.95, u + 0.95, v - 0.95, v + 0.95], t: 0.06, hex: '#e8b818', y: -PIT.depth })),
  { kind: 'hazard', rect: [-1.0, 1.0, 6.6, 9.4], t: 0.12, y: -PIT.depth },
  // the release floor's edge, banded so nobody walks off it
  { kind: 'hazard', rect: [PIT.at[0] - 0.14, PIT.at[1] + 0.14, PIT.at[2] - 0.14, PIT.at[3] + 0.14], t: 0.12 },
  // the walk from the release floor to the street, and from the bench
  { kind: 'line', from: [0, 12.1], to: [-4.2, 15.6], t: 0.09, hex: GREEN, arrows: true },
  { kind: 'line', from: [-1.9, 11.25], to: [-0.3, 11.25], t: 0.07, hex: GREEN, y: -PIT.depth },
  { kind: 'line', from: [1.9, 11.25], to: [0.3, 11.25], t: 0.07, hex: GREEN, y: -PIT.depth },
  // the yellow line past which it's machines only, in front of each row
  { kind: 'line', from: [-3.45, 1.2], to: [-3.45, 12.6], t: 0.06, hex: '#e8b818' },
  { kind: 'line', from: [3.45, 1.2], to: [3.45, 14.6], t: 0.06, hex: '#e8b818' },
];
zone.flags.room = {
  balcony: false, studio: false, finish: 'plain', ground: 'plant', windowless: true,
  w: W, d: D, h: H,
  // the lamps turned well down, so the vats light the hall (room-layout.js `dim`)
  dim: 0.18,
  pit: PIT,
  // the street door under ARRIVALS, left of the middle from the street (the clone arm's lxD), so south: u -4.2
  doors: { ...(was.doors || {}), east: -4.2, down: [6.2, 0.9] },
  tone: { wall: '#c4ccc8', trim: '#3a4248', ceiling: '#c8ccca', accent: GREEN },
  decor: {
    rug: false,
    paint,
    // light from high up over the aisle; the vats light the rest
    strips: [{ at: [0, 3.2] }, { at: [0, 12.8] }],
    // a picture light over each poster, so the adverts stand out of the gloom (gl/room-hotel.js piclights); the
    // room takes six lamps, the strips' two and these four
    piclights: marks.filter((m) => m.kind === 'poster' && m.wall).slice(0, 4).map(({ wall, at, y, w, h }) => ({ wall, at, y, w, h, k: 0.8 })),
    marks,
    // the growing vats bubbling: the tank's bed under everything, and a bubble now and then out of one of the vats
    // (room-sound.js ambience; the recordings are CC0, scripts/audio/build-field-recordings.mjs)
    sound: {
      bed: 'tank_bubbling', level: -27, calls: 'bubbles', call_level: -24, every: [1.2, 4],
      spots: rows.filter((r) => r.flags?.look?.form === 'vat' && !r.flags?.look?.state && Array.isArray(r.flags?.spot?.at)).map((r) => [r.flags.spot.at[0], r.flags.spot.at[1], 1.8]),
    },
  },
};
zone.description = "A hall built for machines, with room left over for you. Growing vats stand two deep down both walls, each lit green and holding a sleeping body. Tubes climb from every crown to the ceiling and in to a trunk over the floor. A step down in the middle of the hall, four release vats stand empty round the dressing gantry. The street is east.";

save('zones', zone);
for (const r of rows) save('furniture', r);
console.log(`vat-hall: ${rows.length} rows, ${marks.length} marks, ${wrote} file(s) written`);
