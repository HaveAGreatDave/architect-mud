// Build Norval Dynamo's package: the Ashway Civic Hall set the TV's 3-D stage draws the film on, two
// prop cards, and the film's one locked camera laid into its stored graph.
//
//   node scripts/content/build-norval-dynamo.mjs
//
// WHAT IT WRITES
//   content/media_graphics/set_ashway_hall.json      the hall (a set, `broadcasts` names bc_norval_dynamo)
//   content/media_graphics/norval_vote_teo.json      one of Norval's ninety-one posters
//   content/media_graphics/norval_result.json        the result sheet on the noticeboard
//   content/media_broadcasts/bc_norval_dynamo.json   graph only: its own nodes, ids starting `ndx_`
//
// THE PICTURE IS ONE CAMERA THAT NEVER MOVES (the .bsm's header says so, and the dance says it again).
// So the set has one camera, and the direction is the same locked wide at every scene: the 3-D stage
// would otherwise cut round the room like a sitcom. Every run strips its own `ndx_` nodes first.
// Its marks carry `for` (seat() in sequence-player.js), so the cast sit where the hall would put them.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wr = (p, obj) => fs.writeFileSync(path.join(ROOT, p), canonicalJson(obj), 'utf8');
const STAMP = '1794210000';

// ── the hall ────────────────────────────────────────────────────────────────────────────
// u across, v back from the camera, metres. The stage is at the back, the chairs face it with their
// backs to the camera, the noticeboard is on the left wall and the deck is at the stage's right.
const seat = (u, v, who, label) => ({ at: [u, v], yaw: 0, pose: 'sit', lift: 0, label, for: who });
const SET = {
  kind: 'set', format: 1, id: 'set_ashway_hall', name: 'Ashway Civic Hall',
  description: 'The Ashway Civic Hall, as one camera at the back saw it: a low plywood stage with a lectern, rows of folding chairs, a cassette deck on a trestle, the noticeboard and two bare bulbs. Norval Dynamo is shot here.',
  broadcasts: ['bc_norval_dynamo'],
  room: { w: 12, d: 11, h: 3.6 },
  focus: [0, 1.2, 8],
  brand: { name: 'ASHWAY CIVIC HALL', colour: '#d8c8a0' },
  palette: { floor: '#5a5040', wall: '#8a7c62', ceiling: '#3a342a', trim: '#4a4032', accent: '#c8b080', desk: '#6a5a40', deskTop: '#7a6a4c', chair: '#5a5448', riser: '#4a4032', line: '#d8d0c0' },
  ambient: 0.62,
  lamps: [{ p: [-2, 3.1, 6], k: 1.3 }, { p: [2, 3.1, 6], k: 1.3 }, { p: [0, 3.1, 3], k: 0.8 }],
  pieces: [
    { type: 'panelling', at: [0, 10.95], yaw: 180, w: 11.8, h: 1.2, colour: '#6a5a40' },
    { type: 'stage_deck', at: [0, 9.3], w: 6, depth: 2.6, h: 0.45, yaw: 180, step: 1.2, colour: '#7a6a4c' },
    { type: 'sign', at: [0, 10.9], yaw: 180, text: '{brand.name}', h: 0.2, y: 2.75, colour: '#d8c8a0', panel: '#3a342a', glow: 1.1 },
    { type: 'lectern', at: [-2.1, 9.2], yaw: 180, w: 0.6, h: 1.1, colour: '#6a5a40' },
    { type: 'tape_deck', at: [3.6, 8.6], yaw: 200 },
    { type: 'chair_rows', at: [0, 6.6], rows: 4, per: 8, gap: 1.1, yaw: 0, empty: 0.2, colour: '#5a5448' },
    { type: 'corkboard', at: [-5.95, 5], yaw: 90, w: 1.4, h: 1, y: 1.1 },
    { type: 'poster', at: [-5.95, 7.4], yaw: 90, w: 0.6, y: 1.3 },
    { type: 'poster', at: [5.95, 4.2], yaw: -90, w: 0.6, y: 1.3 },
    { type: 'poster', at: [5.95, 6.2], yaw: -90, w: 0.6, y: 1.2 },
    { type: 'bulb', at: [-2, 6], y: 3.0, top: 3.6 },
    { type: 'bulb', at: [2, 6], y: 3.0, top: 3.6 },
  ],
  marks: {
    norval: { at: [0.3, 9.4], yaw: 180, pose: 'stand', lift: 0.45, label: 'Centre stage', for: 'Norval Dynamo' },
    peale: { at: [-2.1, 9.7], yaw: 180, pose: 'stand', lift: 0.45, label: 'Behind the lectern', for: 'Warden Peale' },
    teo: seat(-0.8, 6.6, 'Teo Sandoval', 'Front row, by the aisle'),
    summer: seat(1.8, 6.6, 'Summer Ostrand', 'Front row, right'),
    dutch: seat(-1.8, 5.65, 'Uncle Dutch', 'Second row'),
    kipp: seat(-2.3, 5.65, 'Kipp Dynamo', 'Second row, beside his uncle'),
    deb: seat(0.8, 5.65, 'Debra Wick', 'Second row, right'),
    gran: seat(-2.8, 4.7, 'Gran Dynamo', 'Third row'),
    claw: { at: [5, 3.4], yaw: -60, pose: 'stand', label: 'Leaning on the right wall', for: 'Claw Vance' },
    don: { at: [-4.8, 2.8], yaw: 40, pose: 'stand', label: 'At the back, by the door', for: 'Don Grebe' },
  },
  // The one camera, at the back of the hall on a tripod nobody touched.
  cameras: { cam1: { label: 'The camera', at: [0, 0.6], h: 1.55 } },
};

// ── the cards: props, not broadcast graphics. Card stock and paint, typed sheets. ─────────
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" font-family="'Courier New',monospace">\n${body}\n</svg>`;
const VOTE = svg(`<rect width="640" height="360" fill="#7a6a4c"/>
<rect x="150" y="30" width="340" height="300" fill="#e2d6b4" stroke="#2a2418" stroke-width="3" transform="rotate(-2 320 180)"/>
<circle cx="170" cy="48" r="5" fill="#8a8c90" transform="rotate(-2 320 180)"/>
<circle cx="470" cy="48" r="5" fill="#8a8c90" transform="rotate(-2 320 180)"/>
<g transform="rotate(-2 320 180)" font-family="'Arial Black','Impact',sans-serif" text-anchor="middle">
  <text x="320" y="150" font-size="76" fill="#2c4a8a" stroke="#1a1410" stroke-width="2" letter-spacing="4">VOTE</text>
  <text x="320" y="246" font-size="92" fill="#a83a2a" stroke="#1a1410" stroke-width="2" letter-spacing="6">TEO</text>
  <line x1="200" y1="270" x2="440" y2="266" stroke="#2c4a8a" stroke-width="4"/>
  <text x="320" y="306" font-size="14" fill="#4a4030" font-family="'Courier New',monospace" letter-spacing="2">FOR BLOCK STEWARD</text>
</g>`);
const RESULT = svg(`<rect width="640" height="360" fill="#6a5a40"/>
<rect x="130" y="24" width="380" height="312" fill="#efe8d4" stroke="#3a3020" stroke-width="2" transform="rotate(1 320 180)"/>
<g transform="rotate(1 320 180)" fill="#2a2418">
  <text x="320" y="78" text-anchor="middle" font-size="20" letter-spacing="3">BLOCK STEWARD</text>
  <text x="320" y="104" text-anchor="middle" font-size="14" letter-spacing="2">RESULT OF THE VOTE</text>
  <line x1="170" y1="122" x2="470" y2="122" stroke="#2a2418" stroke-width="1.5"/>
  <text x="180" y="180" font-size="24">TEO SANDOVAL</text><text x="460" y="180" text-anchor="end" font-size="24">88</text>
  <text x="180" y="226" font-size="24">SUMMER OSTRAND</text><text x="460" y="226" text-anchor="end" font-size="24">31</text>
  <text x="180" y="300" font-size="12">Posted by W. Peale. Do not remove.</text>
</g>`);
const graphic = (id, desc, content) => ({ content, created_at: STAMP, description: desc, id, name: id, tags: ['movie'], type: 'svg', updated_at: STAMP });

// ── the graph ──────────────────────────────────────────────────────────────────────────
const LOCKED = (n) => ({ type: 'camera_cut', label: `CAM - 1 - ${n}` });
const INSERTS = [
  [119, 'ndx_vote_teo', { type: 'title_card', graphic_id: 'norval_vote_teo', duration: 5 }],
  [150, 'ndx_result', { type: 'title_card', graphic_id: 'norval_result', duration: 6 }],
];
const ROW = 'content/media_broadcasts/bc_norval_dynamo.json';
const row = JSON.parse(rd(ROW));
const nodes = row.broadcast_graph.nodes;
for (const id of Object.keys(nodes)) if (id.startsWith('ndx_')) {
  for (const n of Object.values(nodes)) if (n.next === id) n.next = nodes[id].next;
  delete nodes[id];
}
// every scene's slug is followed by the same locked wide; the dance by the same camera, locked
for (const [id, n] of Object.entries(nodes)) if (n.type === 'overlay' && n.overlayType === 'lower_third' && n.next) INSERTS.push([Number(n.next.slice(4)), `ndx_cam_${id.slice(4)}`, LOCKED('WIDE')]);
INSERTS.push([141, 'ndx_cam_dance', LOCKED('LOCKED')]);
for (const [before, id, node] of INSERTS) {
  const target = `bsm_${before}`;
  const into = Object.entries(nodes).filter(([, n]) => n.next === target);
  if (!nodes[target] || into.length !== 1) throw new Error(`${target}: ${into.length} nodes lead into it; expected one`);
  const v = nodes[target]._vine || { x: 0, y: 0 };
  nodes[id] = { ...node, _vine: { x: v.x - 110, y: v.y + 60 }, next: target };
  into[0][1].next = id;
}
wr(ROW, row);

wr(`content/media_graphics/${SET.id}.json`, { content: JSON.stringify(SET, null, 1), created_at: STAMP, description: SET.description, id: SET.id, name: SET.name, tags: [], type: 'set', updated_at: STAMP });
wr('content/media_graphics/norval_vote_teo.json', graphic('norval_vote_teo', 'NORVAL DYNAMO: one of the ninety-one VOTE TEO posters.', VOTE));
wr('content/media_graphics/norval_result.json', graphic('norval_result', 'NORVAL DYNAMO: the Block Steward result sheet.', RESULT));
console.log(`✓ ${SET.id}, 2 cards, ${INSERTS.length} spliced nodes in ${ROW}`);
