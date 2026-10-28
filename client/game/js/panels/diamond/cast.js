/**
 * DEADBALL — who's on the field, and where, for a payload.
 *
 * The cast of a still picture of the game (Phase 1c of docs/proposals/deadball-glass2.md): the
 * nine in the field at their positions, the batter in his box for his side of the plate, the men
 * on base leading off, the on-deck hitter, the coaches in their boxes and four umpires. Each is a
 * pose from gl/ballplayer-mesh.js, a place and a facing, and who he is.
 *
 * Who he is comes off a name where the payload has one (the batter, the pitcher, sim v2's runners)
 * and off his club and position where it doesn't (the fielders), so the same man looks the same
 * all game and on every TV. His number comes off the same id.
 *
 * Kit slots: the home side's people take 0 to 11, the away side's 12 to 23 and the umpires 24 to
 * 27, which is also each one's place in the heads' uniform arrays. Within a side a slot belongs to
 * a role, not to whoever's there (the fielding side's pitcher is 0, its shortstop 4; the batting
 * side's batter is 0, the man on first 1), so a new batter rebuilds the batter and nobody else.
 *
 * In the middle of the fifth (`crewDue`) the grounds crew are out too (diamond/crew.js): four of
 * them in work clothes in foul ground beyond third, two pairs side by side, in the batting side's
 * slots 0 to 3, which nobody has in a break; and the base umpires stand clear of their way.
 *
 * Pure: the gate runs it.
 */

import { BAGS, DEG, DUGOUT, FOUL_GROUND, offLine } from './geo.js';
import { fieldSpots, POSITIONS } from './play.js';

const RUBBER = [0, 0.833, 60.5];
// Facing home from a spot, in degrees about the vertical (0 faces +z).
export const faceHome = (p) => Math.atan2(-p[0], -p[2]) / DEG;
// The k-th man on a side's bench stands half a step past a dugout spot and 3 ft further back.
const BENCH = Object.freeze([1, 3, 5]);
export const benchSpot = (side, i) => offLine(side, DUGOUT.first + DUGOUT.step * (BENCH[i] + 0.5), FOUL_GROUND.line + DUGOUT.stand + 3);
const faceAt = (p, q) => Math.atan2(q[0] - p[0], q[2] - p[2]) / DEG;

function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// A number for the back of his jersey, 1 to 99, off his id.
export const numberOf = (id) => 1 + (hashStr('no:' + id) % 99);

// A man's build, off his id, so he's the same size all season: `scale`, his height as the rig's
// (RIG_INCHES at 1, bare-headed), and `girth`, `shoulders` and `belly` as gl/ballplayer-mesh.js and
// diamond/rig.js buildIn take them. The role leans the draw the way the game sorts men: pitchers
// tall and lean, catchers short and thick through the middle, coaches and umpires heavier and
// softer in front. A batter, a runner and the man on deck are one man, so they share a lean, and
// a hitter keeps his body from the box to the bases. A sum of three draws is near enough a bell.
const RIG_INCHES = 71.5;
const BUILDS = Object.freeze({
  //        [mean height in, its spread, heft's mean, shoulders' mean, belly a unit of heft over 1]
  player: Object.freeze([73, 2.1, 0, 1, 0.012]),
  pitcher: Object.freeze([74.5, 2.0, -0.4, 0.99, 0.008]),
  catcher: Object.freeze([71.8, 1.6, 1.1, 1.03, 0.014]),
  coach: Object.freeze([71.5, 2.0, 1.3, 1, 0.03]),
  ump: Object.freeze([71.5, 2.0, 0.9, 1, 0.02]),
  crew: Object.freeze([70.5, 2.4, 0.4, 0.99, 0.02]),
});
// any role without a lean of its own (a fielder, a batter, a runner, the man on deck) is a player's
const BUILD_OF_ROLE = (role) => (BUILDS[role] ? role : 'player');
export function buildOf(id, role) {
  let a = hashStr('build:' + id);
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const bell = () => (r() + r() + r() - 1.5) * 2;   // mean 0, spread 1, within ±3
  const [h0, hs, f0, s0, b0] = BUILDS[BUILD_OF_ROLE(role)];
  const inches = Math.max(66, Math.min(79, h0 + hs * bell())), heft = f0 + bell();
  const round = (x, n = 1000) => Math.round(x * n) / n;
  return {
    inches: round(inches, 10),
    scale: round(inches / RIG_INCHES),
    girth: round(Math.max(-0.05, Math.min(0.09, 0.03 * heft))),
    // broader on a bigger man, and a little on a taller one
    shoulders: round(Math.max(0.93, Math.min(1.08, s0 + 0.03 * bell() + 0.008 * heft + 0.004 * (inches - 73)))),
    belly: round(Math.max(0, b0 * (heft - 1))),
  };
}

// Where a man on a bag stands while the pitcher is set: a few strides off it toward the next one,
// and off third in foul ground.
export function leadOff(bag) {
  const b = BAGS[bag];
  const next = bag === 3 ? [0, 0, 0] : BAGS[bag + 1];
  const d = [next[0] - b[0], 0, next[2] - b[2]], l = Math.hypot(d[0], d[2]) || 1, k = bag === 1 ? 10 : bag === 2 ? 12 : 7;
  const p = [b[0] + d[0] / l * k, 0, b[2] + d[2] / l * k];
  if (bag === 3) { p[0] += 2.1; p[2] -= 2.1; }
  return p;
}

// The middle of the fifth, when the grounds crew drag the infield (diamond/crew.js): the break
// before the bottom of the fifth, when it holds `CREW_HOLD` seconds or more, room for the drag and
// the infielders out after it.
export const CREW_HOLD = 84;
export const crewDue = (p) => p?.phase === 'half' && (p.inning | 0) === 5 && p.half === 'bottom' && Number.isFinite(p.hold) && p.hold / 1000 >= CREW_HOLD;
// The crew's two arcs round the skirt (diamond/crew.js), the inner pair's and the outer's: each
// one's radius from the rubber and the angle either side of the line to second base it starts and
// ends at, the inner clear of second base, the outer of the grass; the turn (ft) each pair takes
// onto its arc and off it; how far out in foul ground (ft) they come in, beyond third, and go out,
// beyond first; and how far each man walks off his pair's middle (ft).
export const CREW_ARCS = Object.freeze([Object.freeze({ r: 72, th: 82 }), Object.freeze({ r: 79, th: 78 })]);
export const CREW_TURN = 5, CREW_GATE = 100, CREW_GAP = 1.6;
// The lane across foul ground a pair walks to its arc and from it, the z of its middle: square to
// the line to third, and onto the arc round its turn.
export const crewLane = (a) => RUBBER[2] + (a.r + CREW_TURN) * Math.cos(a.th * DEG) - CREW_TURN;
// Where the base umpire on each side (-1 first, +1 third) stands for the break, clear of the crew.
const UMP_BREAK = (side) => [side * 84, 0, 54];

// The cast for a payload. Returns [{ id, pose, at, yaw, mirror, look }], where `look` is what
// buildPlayer needs besides the face: { id, side, role, slot, number, glove, helmet, flapSide, mask, battingGloves }.
export function castOf(p) {
  if (!p) return [];
  const top = p.half === 'top';
  const fieldSide = top ? 'home' : 'away', batSide = top ? 'away' : 'home';
  const fieldTeam = p.fieldingTeam || (top ? 'Home' : 'Away'), batTeam = p.battingTeam || (top ? 'Away' : 'Home');
  const BASE = { home: 0, away: 12, ump: 24 };
  const out = [];
  // `k` is his slot within his side; `look` is what he wears; `how` is { mirror } for the pose. His
  // height is his pose's scale and the rest of his build is on his look (buildOf); a girth the look
  // already has (the plate umpire's protector) goes on top of his own.
  const person = (k, id, side, role, pose, at, yaw, look = {}, how = {}) => {
    const b = buildOf(id, role);
    const girth = Math.round(Math.min(0.09, b.girth + (look.girth || 0)) * 1000) / 1000;
    out.push({ id, pose, at, yaw, mirror: !!how.mirror, scale: b.scale, look: { id, side, role, slot: BASE[side] + k, number: numberOf(id), ...look, girth, shoulders: b.shoulders, belly: b.belly } });
  };
  // the battery
  const lefty = p.throws === 'L';
  person(0, p.pitcher || `${fieldTeam}:P`, fieldSide, 'pitcher', 'pSet', RUBBER, lefty ? -90 : 90, { glove: lefty ? 'R' : 'L' }, { mirror: lefty });
  person(1, `${fieldTeam}:C`, fieldSide, 'catcher', 'catcher', [0, 0, -2.75], 0, { glove: 'L' });
  // the seven others where the play's fielders start (diamond/play.js), shaded to the hitter's pull side
  const spots = fieldSpots(p.bats);
  ['1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'].forEach((pos, i) => {
    const at = spots[POSITIONS.indexOf(pos)];
    person(2 + i, `${fieldTeam}:${pos}`, fieldSide, 'fielder', pos.length === 2 && /F$/.test(pos) ? 'outfield' : 'infield', at, faceHome(at), { glove: 'L', ...(pos === '1B' ? { mitt: 'first' } : {}) });
  });
  // the batter, in the box for his side; a play on the bases has him standing in it too
  const left = p.bats === 'L';
  if (p.phase !== 'half' && p.batter) {
    person(0, p.batter, batSide, 'batter', 'batStance', [left ? -3.25 : 3.25, 0, 0.75], left ? 90 : -90, { helmet: true, flapSide: left ? -1 : 1, battingGloves: '#c9c4b8' }, { mirror: left });
  }
  // the men on base, named where the play names them; a break starts a fresh half with nobody on
  const before = p.phase !== 'half' && Array.isArray(p.basesBefore) ? p.basesBefore : [false, false, false];
  const names = {};
  for (const m of Array.isArray(p.moves) ? p.moves : []) if (m && m.from >= 1 && m.from <= 3 && m.name) names[m.from] = m.name;
  for (const bag of [1, 2, 3]) {
    if (!before[bag - 1]) continue;
    const at = leadOff(bag);
    // his helmet's flap and his batting gloves stay his own from bag to bag, so he keeps his body
    const id = names[bag] || `${batTeam}:R${bag}`;
    person(bag, id, batSide, 'runner', 'runner', at, faceAt(at, RUBBER) + 25, { helmet: true, flapSide: hashStr('flap:' + id) % 10 < 4 ? -1 : 1, battingGloves: '#c9c4b8' });
  }
  if (p.phase !== 'half') {
    // the on-deck hitter by his own side's dugout: the visitors' is on the third-base side
    const deck = batSide === 'away' ? [31, 0, -9] : [-31, 0, -9];
    person(4, `${batTeam}:deck`, batSide, 'ondeck', 'ondeck', deck, batSide === 'away' ? -60 : 60, { helmet: true, flapSide: 1 }, { mirror: batSide !== 'away' });
  }
  // the base coaches, in their boxes
  person(5, `${batTeam}:coach1`, batSide, 'coach', 'coach', [-78, 0, 47], faceHome([-78, 0, 47]) - 10, {});
  person(6, `${batTeam}:coach3`, batSide, 'coach', 'coach', [77, 0, 45], faceHome([77, 0, 45]) + 10, {});
  // the bench: three men from each side at the back of their dugout's recess, arms folded, in
  // between the spots the men coming off take (bases.js dugoutSpot), so nobody walks into them;
  // the visitors' dugout is on the third-base side
  for (const [side, team, k0] of [[batSide, batTeam, 7], [fieldSide, fieldTeam, 9]]) {
    const s = side === 'away' ? 1 : -1;
    BENCH.forEach((_, i) => { const at = benchSpot(s, i); person(k0 + i, `${team}:bench${i}`, side, 'bench', 'coach', at, faceAt(at, [0, 0, 60]), {}); });
  }
  // the umpires: behind the plate in his mask, and at the bases (off the skirt for the drag)
  const crew = crewDue(p), u1 = crew ? UMP_BREAK(-1) : [-74, 0, 76], u3 = crew ? UMP_BREAK(1) : [74, 0, 78];
  person(0, 'ump:plate', 'ump', 'ump', 'umpire', [1.2, 0, -5.4], -6, { mask: true, girth: 0.06 });
  person(1, 'ump:1B', 'ump', 'ump', 'outfield', u1, faceHome(u1), {});
  person(2, 'ump:2B', 'ump', 'ump', 'outfield', [16, 0, 150], faceHome([16, 0, 150]), {});
  person(3, 'ump:3B', 'ump', 'ump', 'outfield', u3, faceHome(u3), {});
  // the grounds crew in foul ground beyond third, each pair in its lane facing the infield, the
  // inner pair's two in slots 0 and 1, the outer's in 2 and 3, the first of each on its right
  if (crew) {
    CREW_ARCS.forEach((a, i) => {
      for (const [j, off] of [[0, -CREW_GAP], [1, CREW_GAP]]) person(2 * i + j, `crew:${2 * i + j}`, batSide, 'crew', 'stand', [CREW_GATE, 0, crewLane(a) + off], -90, {});
    });
  }
  return out;
}

// A key for one cast member as a still: what he looks like, how he stands and where. Two payloads
// that share a key share a posed body (gl/ballplayer-mesh.js buildPlayer).
export const castKey = (c) => JSON.stringify([c.id, c.pose, c.at, Math.round(c.yaw * 100), c.mirror, c.scale, c.look.side, c.look.slot, c.look.glove, c.look.helmet, c.look.flapSide, c.look.mask]);
// A key for his skinned body (buildBody), which the GPU poses: who he is and what he wears, not
// where he stands or which slot he's in, so a man keeps his body from one payload to the next.
export const bodyKey = (c) => JSON.stringify([c.id, c.scale, c.look.side, c.look.role === 'catcher' || c.look.role === 'ump' || c.look.role === 'crew' ? c.look.role : '',
  c.look.glove, c.look.helmet, c.look.flapSide, c.look.mask, c.look.battingGloves, c.look.girth, c.look.mitt, c.look.shoulders, c.look.belly]);
