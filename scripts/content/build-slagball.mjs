// Build Slagball's broadcast package: the arena set the TV's 3-D stage draws it on, its cards, and
// the score bug and graphics laid into the film's stored graph.
//
//   node scripts/content/build-slagball.mjs
//
// WHAT IT WRITES
//   content/media_graphics/set_slagball_open.json      the Coldwater Open's arena (a set, `broadcasts`
//                                                      names bc_slagball, so stageSet picks it)
//   content/media_graphics/slagball_title.json         the title card, in the comic ink
//   content/media_graphics/slagball_open_card.json     "The Coldwater Slagball Open, live"
//   content/media_graphics/slagball_sudden_dark.json   the overtime card
//   content/media_graphics/slagball_champions.json     the result card
//   content/media_broadcasts/bc_slagball.json          graph only: see below
//
// WHY THE GRAPH IS PATCHED, NOT RECOMPILED. The film's graph predates today's compiler: compiling
// data/scripts/slagball.bsm now gives 494 nodes where the shipped graph has 483. So this touches
// only what it owns: a `scorebug` on the tournament's lines (players standing, one per side), and
// its own nodes, all with ids starting `sbx_`, spliced in by rewriting one `next`. Every run strips
// both first, so it can be run again after any change here.
//
// A say node's `scorebug` rides the line to the TV, which draws the native bug (tv.js
// _applyScorebug). `{ off: true }` takes it down, between the semifinal and the final.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wr = (p, obj) => fs.writeFileSync(path.join(ROOT, p), canonicalJson(obj), 'utf8');
const STAMP = '1794200000';

const BRAND = '#ff5a3c', GOLD = '#ffd23f', BONE = '#f2efe6', INK = '#0a0608', STEEL = '#5ad1ff';

// ── the arena ────────────────────────────────────────────────────────────────────────────
// u across, v back from the cameras, metres. The court runs across the picture with its centre
// line pointing back, so the cameras see both halves; the bleachers are behind it, the booth is
// front left, the scoreboard hangs over the back row.
const left = (u, v, label, who) => ({ at: [u, v], yaw: 90, pose: 'stand', label, ...(who ? { for: who } : {}) });
const right = (u, v, label) => ({ at: [u, v], yaw: -90, pose: 'stand', label });
const SET = {
  kind: 'set', format: 1, id: 'set_slagball_open', name: 'The Coldwater Slagball Open',
  description: 'The Open\'s arena for Slagball: a two-tone court with a glowing centre line and its rack of slags, cage fences down both sides, a full bleacher behind, the scoreboard over it and Sub-Channel 2½\'s booth at the front left.',
  broadcasts: ['bc_slagball'],
  room: { w: 18, d: 16, h: 7 },
  focus: [0, 1.2, 8],
  brand: { name: 'SLAGBALL', tagline: 'THE COLDWATER OPEN', colour: BRAND },
  palette: { floor: '#141016', wall: '#100c12', ceiling: '#060507', trim: '#1c1a20', accent: BRAND, desk: '#1a1420', deskTop: '#2a2430', chair: '#201a24', riser: '#1e1a22', line: BONE },
  ambient: 0.42,
  lamps: [
    { p: [-3, 5.6, 8], k: 2.3 }, { p: [3, 5.6, 8], k: 2.3 }, { p: [0, 5.8, 5], k: 1.5 },
    { p: [-6.8, 3.2, 3.4], k: 1.2 }, { p: [0, 4.6, 13.5], k: 1.1 },
  ],
  pieces: [
    { type: 'ball_court', at: [0, 8], w: 11, depth: 6, left: '#5a2620', right: '#1c3456', line: BONE, glow: 2.4 },
    { type: 'ball_rack', at: [0, 8], n: 6, r: 0.13, yaw: 90 },
    { type: 'fence_run', at: [-6.2, 8], w: 7.2, h: 2.4, yaw: 90, posts: 6 },
    { type: 'fence_run', at: [6.2, 8], w: 7.2, h: 2.4, yaw: -90, posts: 6 },
    { type: 'bleachers', at: [0, 12.1], w: 16, rows: 5, yaw: 180, full: 0.85 },
    { type: 'video_wall', at: [0, 15.85], yaw: 180, w: 6, h: 1.9, y: 4.7 },
    { type: 'sign', at: [0, 15.8], yaw: 180, text: '{brand.name}', h: 0.42, y: 3.9, panel: '#0c0a0e', glow: 2 },
    { type: 'sign', at: [-6.2, 4.3], yaw: 90, text: 'COLDWATER OPEN', h: 0.2, y: 2.55, colour: GOLD, glow: 1.8 },
    { type: 'truss_grid', at: [0, 8], w: 12, depth: 7, y: 5.6, top: 7, lamps: 6 },
    { type: 'riser', at: [-6.8, 3.7], r: 1.5, h: 0.3 },
    { type: 'desk_straight', at: [-6.8, 3.25], w: 2.3, depth: 0.7, h: 0.8, yaw: 180, text: '{brand.name}', panel: '#20161a' },
    { type: 'chair', at: [-7.4, 3.95], yaw: 180, seat: 0.5 },
    { type: 'chair', at: [-6.2, 3.95], yaw: 180, seat: 0.5 },
    { type: 'monitors', at: [-6.8, 2.7], yaw: 0, cols: 2, rows: 1, size: 0.45, y: 0.82 },
    { type: 'studio_cam', at: [7.4, 4.2], yaw: -60, h: 1.35, text: '2' },
  ],
  marks: {
    // `for` reserves a mark for a speaker (seat() in sequence-player.js): the film's cast are display names
    a: { at: [-7.4, 3.95], yaw: 180, pose: 'sit', lift: 0.3, label: 'Booth, left chair', for: 'Blurt' },
    b: { at: [-6.2, 3.95], yaw: 180, pose: 'sit', lift: 0.3, label: 'Booth, right chair', for: 'Cass' },
    ref: { at: [1.3, 4.6], yaw: 200, pose: 'stand', label: 'The ref, on the centre line', for: 'The Ref' },
    rail: { at: [-5.6, 5.2], yaw: 120, pose: 'sit', lift: 0.1, label: 'Coach Rusk on his cot at the rail', for: 'Coach Rusk' },
    vip: { at: [6.9, 5.6], yaw: 240, pose: 'sit', lift: 0.1, label: 'Courtside VIP seat', for: 'Maxim Vigo' },
    c: left(-3.4, 7, 'Left half, front', 'Dutch'),
    l1: left(-3.6, 5.6, 'Left half, front corner', 'Lottie'),
    l2: left(-1.4, 6.2, 'Left half, near the line', 'Vess'),
    l3: left(-4.6, 7.9, 'Left half, deep', 'Barnacle Bash'),
    l4: left(-1.2, 10.2, 'Left half, back by the line', 'Giles'),
    d: right(3.4, 7, 'Right half, front'),
    e: left(-2.2, 9.2, 'Left half, on the attack line', 'Merv'),
    f: right(2.2, 9.2, 'Right half, on the attack line'),
    g: left(-4.4, 9.8, 'Left half, back', 'Pip'),
    h: right(4.4, 9.8, 'Right half, back'),
  },
  // a plain video wall letters these; tv.js feeds {score} and {scoreSub} from the score bug
  wallText: '{score}', wallSub: '{scoreSub}',
  cameras: {
    cam1: { label: 'Centre', at: [0, 0.6], h: 1.6 },
    cam2: { label: 'Booth', at: [-4.6, 1.4], h: 1.3 },
    cam3: { label: 'Courtside, low', at: [5.6, 3.6], h: 0.7 },
    cam4: { label: 'End line', at: [-8.2, 8], h: 1.5 },
    cam5: { label: 'Jib, high', at: [0, -0.6], h: 4.4 },
  },
};

// ── the cards ────────────────────────────────────────────────────────────────────────────
// The comic ink (gl/house-style.js) in SVG: a heavy black keyline round everything, two flat
// tones, hatching for the shade, a halftone in the sky, the type offset over its own black drop.
const DEFS = `<defs>
  <pattern id="ht" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.6" fill="#ffffff" opacity="0.07"/></pattern>
  <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="7" stroke="${INK}" stroke-width="2.2"/></pattern>
</defs>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" font-family="'Arial Black','Impact',sans-serif">\n${DEFS}\n${body}\n</svg>`;
// a word in the ink: black drop, keyline, flat face, a lit top band
const inked = (x, y, size, text, face, spacing = 4) => [
  `<text x="${x + 5}" y="${y + 6}" text-anchor="middle" font-size="${size}" letter-spacing="${spacing}" fill="${INK}">${text}</text>`,
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" letter-spacing="${spacing}" fill="${face}" stroke="${INK}" stroke-width="${Math.max(3, size / 14)}" paint-order="stroke">${text}</text>`,
].join('\n');
const orb = (cx, cy, r) => [
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${BRAND}" stroke="${INK}" stroke-width="5"/>`,
  `<path d="M ${cx - r * 0.2} ${cy + r * 0.95} A ${r} ${r} 0 0 0 ${cx + r * 0.95} ${cy - r * 0.2} A ${r * 0.8} ${r * 0.8} 0 0 1 ${cx - r * 0.2} ${cy + r * 0.95} Z" fill="url(#hatch)"/>`,
  `<ellipse cx="${cx - r * 0.35}" cy="${cy - r * 0.4}" rx="${r * 0.28}" ry="${r * 0.16}" fill="${BONE}" opacity="0.85" transform="rotate(-35 ${cx - r * 0.35} ${cy - r * 0.4})"/>`,
].join('\n');
const streaks = (x, y, n) => Array.from({ length: n }, (_, i) => `<line x1="${x - 40 - i * 18}" y1="${y + 26 + i * 9}" x2="${x - 150 - i * 30}" y2="${y + 80 + i * 22}" stroke="${INK}" stroke-width="${5 - i}" stroke-linecap="round"/>`).join('\n');

const TITLE = svg(`<rect width="640" height="360" fill="#1a0f14"/>
<polygon points="0,0 640,0 640,150 0,230" fill="#2a1420"/>
<rect width="640" height="360" fill="url(#ht)"/>
<polygon points="0,236 640,156 640,360 0,360" fill="#140a0e"/>
<polygon points="0,236 640,156 640,166 0,246" fill="${BRAND}" stroke="${INK}" stroke-width="3"/>
<line x1="320" y1="200" x2="320" y2="360" stroke="${BRAND}" stroke-width="6"/>
${streaks(566, 74, 4)}
${orb(568, 96, 34)}
<text x="320" y="62" text-anchor="middle" fill="${STEEL}" font-size="15" letter-spacing="6">SUB-CHANNEL 2½ PRESENTS</text>
${inked(296, 170, 84, 'SLAGBALL', GOLD, 6)}
<rect x="120" y="200" width="400" height="34" fill="${BONE}" stroke="${INK}" stroke-width="4" transform="rotate(-3 320 217)"/>
<text x="320" y="225" text-anchor="middle" fill="${INK}" font-size="17" letter-spacing="3" textLength="372" lengthAdjust="spacingAndGlyphs" transform="rotate(-3 320 217)">A COLDWATER UNDERDOG STORY</text>
<text x="320" y="318" text-anchor="middle" fill="#8a8f98" font-size="13" letter-spacing="3" font-family="'Courier New',monospace">you throw · you get hit · you come back</text>`);

const OPEN = svg(`<rect width="640" height="360" fill="#10161e"/>
<rect width="640" height="360" fill="url(#ht)"/>
<rect x="0" y="0" width="320" height="360" fill="#3a1c18" opacity="0.55"/>
<rect x="320" y="0" width="320" height="360" fill="#16263a" opacity="0.55"/>
<rect x="314" y="0" width="12" height="360" fill="${BRAND}" stroke="${INK}" stroke-width="3"/>
<rect x="60" y="92" width="520" height="150" fill="${INK}" transform="translate(6 6)"/>
<rect x="60" y="92" width="520" height="150" fill="#1c1218" stroke="${INK}" stroke-width="5"/>
<rect x="60" y="92" width="520" height="34" fill="${BRAND}" stroke="${INK}" stroke-width="5"/>
<text x="320" y="117" text-anchor="middle" fill="${INK}" font-size="18" letter-spacing="8">THE COLDWATER</text>
${inked(320, 196, 60, 'SLAGBALL OPEN', GOLD, 3)}
<text x="320" y="228" text-anchor="middle" fill="${BONE}" font-size="14" letter-spacing="5">ONE BRACKET · SIX A SIDE · NO REFUNDS</text>
<rect x="250" y="268" width="140" height="34" fill="#d0202a" stroke="${INK}" stroke-width="4"/>
<circle cx="272" cy="285" r="7" fill="${BONE}"/>
<text x="330" y="293" text-anchor="middle" fill="${BONE}" font-size="20" letter-spacing="4">LIVE</text>`);

const DARK = svg(`<rect width="640" height="360" fill="#020203"/>
<polygon points="300,0 340,0 420,360 220,360" fill="#ffffff" opacity="0.05"/>
<polygon points="312,0 328,0 360,360 280,360" fill="#ffffff" opacity="0.06"/>
${inked(320, 186, 64, 'SUDDEN DARK', '#e8eef6', 3)}
<line x1="120" y1="222" x2="520" y2="222" stroke="${BRAND}" stroke-width="5"/>
<text x="320" y="258" text-anchor="middle" fill="#8a96a6" font-size="16" letter-spacing="6">HOUSE LIGHTS DOWN · ONE THROW EACH</text>
<text x="320" y="300" text-anchor="middle" fill="#4a525e" font-size="12" letter-spacing="4" font-family="'Courier New',monospace">charter, page forty</text>`);

const CHAMPS = svg(`<rect width="640" height="360" fill="#1a0f14"/>
<rect width="640" height="360" fill="url(#ht)"/>
${Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8; return `<polygon points="320,150 ${320 + Math.cos(a) * 700},${150 + Math.sin(a) * 700} ${320 + Math.cos(a + 0.18) * 700},${150 + Math.sin(a + 0.18) * 700}" fill="${GOLD}" opacity="0.09"/>`; }).join('\n')}
<text x="320" y="70" text-anchor="middle" fill="${STEEL}" font-size="16" letter-spacing="7">THE COLDWATER OPEN · FINAL</text>
${inked(320, 160, 80, 'THE SUMP', GOLD, 6)}
<rect x="150" y="186" width="340" height="80" fill="${INK}" transform="translate(6 6)"/>
<rect x="150" y="186" width="340" height="80" fill="${BONE}" stroke="${INK}" stroke-width="5"/>
<rect x="150" y="186" width="170" height="80" fill="#3a1c18" stroke="${INK}" stroke-width="5"/>
<text x="235" y="214" text-anchor="middle" fill="${BONE}" font-size="16" letter-spacing="3">SUMP</text>
<text x="235" y="254" text-anchor="middle" fill="${GOLD}" font-size="34">2</text>
<text x="405" y="214" text-anchor="middle" fill="${INK}" font-size="16" letter-spacing="3">APEX PRIME</text>
<text x="405" y="254" text-anchor="middle" fill="${INK}" font-size="34">0</text>
<text x="320" y="310" text-anchor="middle" fill="${BONE}" font-size="15" letter-spacing="5">STILL STANDING · CHAMPIONS</text>`);

const graphic = (id, desc, content, tags) => ({ content, created_at: STAMP, description: desc, id, name: id, tags, type: 'svg', updated_at: STAMP });

// ── the graph ────────────────────────────────────────────────────────────────────────────
// Players standing, the Sump first. A key is the say node the bug changes on; it holds until the
// next key. The rounds: the warm-up squad, the debt collectors, round three, the APEX juniors in
// the semifinal, then APEX PRIME in the final and Sudden Dark.
// `lights` (0..1) dims the 3-D set's lamps; the CSS fade sits under the stage, so this is the 3-D blackout
const bug = (opp, abbr, sump, them, status, lights) => ({ sport: 'slagball', away: 'The Sump', awayAbbr: 'SUMP', home: opp, homeAbbr: abbr, awayScore: sump, homeScore: them, status, ...(lights != null ? { lights } : {}) });
const R1 = (s, t, st = 'ROUND 1') => bug('APEX Warm-Up', 'APX', s, t, st);
const R2 = (s, t) => bug('Debt Collectors', 'DBT', s, t, 'ROUND 2');
const R3 = (s, t) => bug('Round Three', 'R3', s, t, 'ROUND 3');
const SF = (s, t, st = 'SEMIFINAL') => bug('APEX Juniors', 'APJ', s, t, st);
const FN = (s, t, st = 'FINAL', lights) => bug('APEX Prime', 'PRM', s, t, st, lights);
const BUGS = [
  [245, R1(6, 6)], [250, R1(6, 5)], [253, R1(6, 1)], [256, R1(6, 0, 'R1 FINAL')],
  [259, R2(6, 6)], [261, R2(6, 3)],
  [264, R3(5, 6)],
  [267, SF(6, 6)], [270, SF(6, 3)], [271, SF(6, 0)], [275, SF(6, 0, 'SF FINAL')],
  [276, { off: true }],
  [336, FN(6, 6)], [354, FN(4, 6)], [357, FN(2, 6)], [371, FN(2, 5)], [374, FN(2, 3)], [379, FN(2, 2)],
  [386, FN(2, 2, 'SUDDEN DARK', 0.12)], [400, FN(2, 1, 'SUDDEN DARK', 0.12)], [404, FN(2, 0, 'FINAL', 1)],
];
// Nodes spliced in before a say node: [before, id, node]. Two before one node go in this order. The
// blackout is a dip, not a hold: the fade paints over the lines too, so the dark lasts one breath.
const INSERTS = [
  [244, 'sbx_open', { type: 'title_card', graphic_id: 'slagball_open_card', duration: 6 }],
  [245, 'sbx_lt_blurt', { type: 'overlay', overlayType: 'lower_third', graphic_id: '', text: 'BLURT', subtext: 'Play-by-play · Sub-Channel 2½', duration_s: 6 }],
  [246, 'sbx_lt_cass', { type: 'overlay', overlayType: 'lower_third', graphic_id: '', text: 'CASS', subtext: 'Colour · contract under review', duration_s: 6 }],
  [384, 'sbx_dark', { type: 'title_card', graphic_id: 'slagball_sudden_dark', duration: 6 }],
  [388, 'sbx_fade_out', { type: 'overlay', overlayType: 'fade', fade: 'out', graphic_id: '', duration_s: 2.5 }],
  [388, 'sbx_fade_in', { type: 'overlay', overlayType: 'fade', fade: 'in', graphic_id: '', duration_s: 1.5 }],
  [406, 'sbx_champs', { type: 'title_card', graphic_id: 'slagball_champions', duration: 7 }],
];

// The director's cuts. A camera_cut with no zone is a direction: the TV's 3-D stage cuts to that
// camera on the arena set (parseCamLabel in client/shared/sequence.js reads the label), and the text
// picture ignores it. 1 centre, 2 booth, 3 courtside low, 4 end line, 5 the jib.
const CAMS = [
  [242, '5 CRANE'], [245, '2 MEDIUM on Blurt'], [248, '1 WIDE'], [250, '3 SNAP'], [253, '4 PUSH_IN'],
  [256, '2 MEDIUM on Blurt'], [259, '1 ESTABLISHING'], [261, '3 HANDHELD'], [262, '2 MEDIUM on Blurt'],
  [264, '4 SNAP'], [267, '5 CRANE'], [270, '4 SIDE_PROFILE'], [271, '2 SNAP on Blurt'], [275, '1 PULL_BACK'],
  [334, '5 CRANE'], [336, '2 MEDIUM on Blurt'], [339, '1 PUSH_IN'], [353, '3 HANDHELD'], [358, '2 SNAP_TIGHT on Blurt'],
  [371, '3 SNAP'], [374, '4 TRACK'], [379, '3 PUSH_IN'], [386, '5 PULL_BACK'], [397, '2 TIGHT on Blurt'],
  [403, '1 WIDE'], [405, '5 CRANE'],
];
for (const [before, words] of CAMS) INSERTS.push([before, `sbx_cam_${before}`, { type: 'camera_cut', label: `CAM - ${words.replace(/^(\d+) /, '$1 - ')}` }]);

const ROW = 'content/media_broadcasts/bc_slagball.json';
const row = JSON.parse(rd(ROW));
const nodes = row.broadcast_graph.nodes;
// strip a previous run: re-link around our nodes, drop our bugs
for (const id of Object.keys(nodes)) if (id.startsWith('sbx_')) {
  for (const n of Object.values(nodes)) if (n.next === id) n.next = nodes[id].next;
  delete nodes[id];
}
for (const n of Object.values(nodes)) delete n.scorebug;
for (const [i, sb] of BUGS) {
  const n = nodes[`bsm_${i}`];
  if (!n || n.type !== 'say') throw new Error(`bsm_${i} is ${n ? n.type : 'missing'}, not a say node: the film's graph moved`);
  n.scorebug = sb;
}
for (const [before, id, node] of INSERTS) {
  const target = `bsm_${before}`;
  const into = Object.entries(nodes).filter(([, n]) => n.next === target);
  if (into.length !== 1) throw new Error(`${target} has ${into.length} nodes leading into it; expected one`);
  const v = nodes[target]._vine || { x: 0, y: 0 };
  nodes[id] = { ...node, _vine: { x: v.x - 110, y: v.y + 60 }, next: target };
  into[0][1].next = id;
}
wr(ROW, row);

const SET_ROW = { content: JSON.stringify(SET, null, 1), created_at: STAMP, description: SET.description, id: SET.id, name: SET.name, tags: [], type: 'set', updated_at: STAMP };
wr(`content/media_graphics/${SET.id}.json`, SET_ROW);
for (const g of [
  graphic('slagball_title', 'Title card for the SLAGBALL feature.', TITLE, ['movie']),
  graphic('slagball_open_card', 'SLAGBALL: the Coldwater Slagball Open, live. Shown as the tournament opens.', OPEN, ['movie']),
  graphic('slagball_sudden_dark', 'SLAGBALL: the Sudden Dark overtime card.', DARK, ['movie']),
  graphic('slagball_champions', 'SLAGBALL: the result card after Sudden Dark.', CHAMPS, ['movie']),
]) wr(`content/media_graphics/${g.id}.json`, g);

console.log(`✓ ${SET.id}, 4 cards, ${BUGS.length} score-bug changes and ${INSERTS.length} spliced nodes in ${ROW}`);
