// Authoring pass for the Echelon in ROOM (docs/proposals/building-stage.md): writes every room's `flags.room`
// so the yacht is one building in the Building Stage, three decks and a roof stacked by their stairs.
// Idempotent: a file is only written when it would change. Edit this, not the JSON.
//
//   node scripts/content/echelon-rooms.mjs
//
// The hull runs north-south with the bow north, about 11 m in the beam and 23 m long:
//
//   sun deck   y 9.4   open teak terrace over the landing
//   upper      y 6.2   owner's suite (bow) · stair landing · helipad cantilevered over the stern
//   main       y 0     bridge (bow) · boarding foyer, double height, gangway on the starboard side · stern lounge
//   lower      y -2.6  engine room (bow) · engineering spine · broadcast complex
//
// `up`/`down` stack a room middle over middle (building-graph.js), so the grand stair is in the middle of the
// atrium and every deck's stair lines up over the one below. The upper deck stands on the atrium's 6.2 m, so the
// bridge and the stern lounge have the deck's structure between their ceilings and the suite and helipad above.
// Frame (room-layout.js): `face` is the way the front wall looks, u to its right, v back from it.
import fs from 'fs';
import { canonicalJson } from './lib.mjs';

const ZONES = 'content/zones/';
const BRASS = '#b8913e', TITANIUM = '#9aa3ab';
const black = { accent: BRASS, ceiling: '#141414', trim: '#0b0b0b', wall: '#1d1d1f' };
const steel = { accent: '#d9a441', ceiling: '#2a2e31', trim: '#16191b', wall: '#3a4045' };

const ROOMS = {
  // ── main deck ──
  // the atrium: black marble, titanium trim, one vast chandelier; the gangway hatch is in the starboard (east) wall
  zone_echelon_foyer: {
    face: 90, w: 9, d: 10, h: 6.2, finish: 'fine', ground: 'marble', doors: { up: [0, 5], down: [0, 5] }, studio: false, balcony: false, windowless: true,
    tone: { ...black, accent: TITANIUM },
    decor: {
      walls: { kind: 'stone', hex: '#161616', on: ['left', 'back', 'right'] },
      ceiling: { kind: 'cove', hex: '#141414', trim: TITANIUM, band: 0.5, drop: 0.2 },
      floor: { border: '#2b2b2b', medallion: { r: 1.6, hex: '#c9c4bb' } },
      downlights: false, rug: false,
      lights: [{ at: [0, 5], r: 1.1, tiers: 3, drop: 2.2, k: 2 }],
      sconces: { y: 2.4, points: [['left', 2], ['left', 8], ['right', 2], ['right', 8]] },
      plants: [[3.7, 9.1, 1.1], [-3.7, 9.1, 1.1]],
    },
  },
  // the bow: smoked glass wrapped round three walls, the helm in the middle
  zone_echelon_bridge: {
    face: 0, w: 9, d: 7, h: 3.2, finish: 'fine', ground: 'stone', studio: false, balcony: false,
    glass: ['front', 'left', 'right'], tone: { ...black, accent: '#4fb3c9' },
    decor: { ceiling: { kind: 'slot', hex: '#101214', trim: '#4fb3c9' }, rug: false },
  },
  // aft: a crescent of leather under the helipad's overhang, the Basin on three sides
  zone_echelon_stern: {
    face: 180, w: 10, d: 6, h: 3.2, finish: 'fine', studio: false, balcony: false,
    glass: ['front', 'left', 'right'], tone: { ...black, accent: '#e0902e', wall: '#2a2420' },
    decor: { walls: { kind: 'walnut', hex: '#3b2a1e', on: ['back'] }, ceiling: { kind: 'cove', hex: '#1a1714', trim: '#e0902e', band: 0.4, drop: 0.15 } },
  },

  // ── lower deck: below the waterline, no glass ──
  zone_echelon_engineering: {
    face: 0, w: 2.6, d: 9, h: 2.6, finish: 'plain', ground: 'rubber', doors: { up: [0, 4.5] }, studio: false, balcony: false, windowless: true,
    tone: steel, decor: { ceiling: { kind: 'slot', hex: '#2a2e31', trim: '#d9a441' }, rug: false },
  },
  zone_echelon_engine: {
    face: 0, w: 9, d: 7, h: 2.6, finish: 'plain', ground: 'stone', studio: false, balcony: false, windowless: true,
    tone: { ...steel, wall: '#1c1f22', ceiling: '#141618' }, decor: { rug: false },
  },
  zone_echelon_broadcast: {
    face: 180, w: 9, d: 6, h: 2.6, finish: 'plain', studio: false, balcony: false, windowless: true,
    tone: { accent: '#c8302a', ceiling: '#151515', trim: '#0d0d0d', wall: '#222426' }, decor: { rug: false },
  },

  // ── upper deck ──
  // the landing sits on the atrium; smoked glass port and starboard
  zone_echelon_landing: {
    face: 0, w: 6, d: 4, h: 3, finish: 'fine', doors: { up: [0, 2], down: [0, 2] }, studio: false, balcony: false,
    glass: ['left', 'right'], tone: { ...black, wall: '#1a1820' },
    decor: { runner: { hex: '#2a1f2e' }, downlights: true },
  },
  // Cyd's suite in the bow, glass on three sides, the head behind its back wall
  zone_echelon_suite: {
    face: 0, w: 9, d: 6.5, h: 3, finish: 'fine', doors: { south: 0 }, studio: false, balcony: false,
    glass: ['front', 'left', 'right'], ensuite: { w: 3, d: 2.4, finish: 'fine' },
    tone: { accent: BRASS, ceiling: '#120f12', trim: '#0a080a', wall: '#1e1a1f' },
    decor: { ceiling: { kind: 'cove', hex: '#120f12', trim: BRASS, band: 0.4, drop: 0.15 } },
  },
  // cantilevered over the stern, open to the sky
  zone_echelon_helipad: {
    face: 180, w: 11, d: 10, h: 3, finish: 'plain', ground: 'rubber', open: true, studio: false, balcony: false,
    tone: { accent: '#f2f2f2', ceiling: '#1a1a1a', trim: '#111111', wall: '#2c2f33' },
    decor: { pad: { r: 3.6 }, rug: false, downlights: false },
  },

  // ── sun deck ──
  zone_echelon_sundeck: {
    face: 0, w: 9, d: 8, h: 3, finish: 'fine', open: true, doors: { down: [0, 4] }, studio: false, balcony: false,
    tone: { accent: '#3fd0d4', ceiling: '#1a1a1a', trim: '#e9e3d6', wall: '#d8d0c0' },
    decor: { rug: false, downlights: false, plants: [[3.9, 7.4, 0.9], [-3.9, 7.4, 0.9]] },
  },

  // ── off the suite, each a Stage of its own ──
  zone_echelon_suite_bath: {
    face: 0, w: 3, d: 2.4, h: 3, finish: 'fine', ground: 'marble', studio: false, balcony: false, windowless: true,
    tone: { accent: BRASS, ceiling: '#141414', trim: '#0b0b0b', wall: '#1d1d1f' },
  },
  zone_echelon_suite_boudoir: {
    face: 0, w: 3.2, d: 2.8, h: 2.6, finish: 'fine', studio: false, balcony: false, windowless: true,
    tone: { accent: '#d4708f', ceiling: '#2a1520', trim: '#1a0d14', wall: '#4a2232' },
  },
};

let wrote = 0;
for (const [id, room] of Object.entries(ROOMS)) {
  const file = ZONES + id + '.json', data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.flags = { ...(data.flags || {}), room };
  const text = canonicalJson(data);
  if (text === fs.readFileSync(file, 'utf8')) continue;
  fs.writeFileSync(file, text, 'utf8');
  wrote++;
}
console.log(`echelon-rooms: ${wrote} of ${Object.keys(ROOMS).length} rooms written`);
