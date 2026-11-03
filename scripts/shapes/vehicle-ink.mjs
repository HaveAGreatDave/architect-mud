// GATE · THE VEHICLE INK (client/game/js/panels/gl/vehicle-ink.js, V2 of docs/proposals/vehicle-comic.md).
//
// The comic look's lines on the own ship come from an edge list built from the mesh's faces. What
// this checks, each of which fails quietly if it's wrong:
//   1. The classifier files a known shape correctly: a cube is twelve creases, two panels of one
//      part in one plane share no line, a door in a panel is a part line, a lone sheet is all seams,
//      and a strut's edges are thin. This is what makes the gate able to go red.
//   2. Every vehicle the renderer draws (VEHICLE_IDS, both details) builds an edge list: every edge
//      names a real face and a real corner, has a known kind, and the list is no longer than the
//      faces' own edges. No normal is NaN.
//   3. Off, no lines: vehicleInkOf is null unless the comic look is on.
//
// No DOM, no GL, no files written.

import { buildEdges, faceNormal, EDGE } from '../../client/game/js/panels/gl/vehicle-ink.js';
import { vehicleInkOf, HOUSE } from '../../client/game/js/panels/gl/house-style.js';
import { aircraftFaces } from '../../client/game/js/panels/aircraft3d.js';
import { VEHICLE_IDS } from '../../client/shared/vehicle-model-schema.js';

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.error('✗ ' + what); } };
const recsOf = (faces) => faces.filter((f) => f.p && f.p.length >= 3).map((f) => ({ mp: f.p, src: f }));
const kinds = (edges) => edges.reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {});

// 1. Known shapes
{
  const C = [0, 0, 0];
  const v = (x, y, z) => [x, y, z];
  const P = [v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1), v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)];
  const cube = [[0, 3, 2, 1], [4, 5, 6, 7], [1, 2, 6, 5], [0, 4, 7, 3], [0, 1, 5, 4], [3, 7, 6, 2]].map((q) => ({ p: q.map((i) => P[i]), role: 'body', cen: C }));
  const ce = buildEdges(recsOf(cube));
  check(ce.length === 12 && ce.every((e) => e.kind === EDGE.crease && e.fb >= 0), `a cube is twelve creases (got ${ce.length}: ${JSON.stringify(kinds(ce))})`);
  // Two coplanar panels of one part share an edge that draws nothing and can't be a silhouette.
  const flat = [{ p: [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)], role: 'wing', cen: [0.5, 0.5, -1] },
    { p: [v(1, 0, 0), v(2, 0, 0), v(2, 1, 0), v(1, 1, 0)], role: 'wing', cen: [1.5, 0.5, -1] }];
  const fe = buildEdges(recsOf(flat));
  check(fe.length === 6 && fe.every((e) => e.kind === EDGE.seam), `two coplanar panels of one part: six seams, no shared line (got ${JSON.stringify(kinds(fe))})`);
  const door = [flat[0], { ...flat[1], part: 'door' }];
  check(buildEdges(recsOf(door)).filter((e) => e.kind === EDGE.part).length === 1, 'a door in a panel is one part line');
  const sheet = buildEdges(recsOf([flat[0]]));
  check(sheet.length === 4 && sheet.every((e) => e.kind === EDGE.seam && e.fb < 0), 'a lone sheet is four seams');
  const strut = cube.map((f) => ({ ...f, role: 'strut' }));
  check(buildEdges(recsOf(strut)).every((e) => e.thin === 1), 'a strut\'s edges are thin');
  const glass = cube.map((f) => ({ ...f, role: 'glass' }));
  check(buildEdges(recsOf(glass)).every((e) => e.kind === EDGE.smooth), 'glass takes no crease inside itself');
  const inside = cube.map((f) => ({ ...f, role: 'interior' }));
  check(buildEdges(recsOf(inside)).length === 0, 'the cabin takes no lines');
  const n = faceNormal(cube[1].p, C);
  check(n[2] > 0.99, 'a face\'s normal points away from its centre');
}

// 2. Every vehicle the renderer draws
const classes = [];
for (const id of VEHICLE_IDS.fw) classes.push([id, false, '']);
for (const id of VEHICLE_IDS.truck) classes.push(['truck', false, id]);
for (const id of VEHICLE_IDS.boat) classes.push([id, false, '']);
for (const id of ['heli', 'ultralight', 'grasshopper', 'drake', 'wreck', 'podracer']) classes.push([id, false, '']);
classes.push(['heli', true, '']);
let total = 0;
for (const [cls, armed, variant] of classes) {
  for (const detail of [1, 0]) {
    const name = `${cls}${armed ? ' armed' : ''}${variant ? ' ' + variant : ''} detail ${detail}`;
    let faces;
    try { faces = aircraftFaces(cls, detail, armed, variant); } catch (e) { check(false, `${name}: aircraftFaces threw ${e.message}`); continue; }
    const recs = recsOf(faces);
    let edges;
    try { edges = buildEdges(recs); } catch (e) { check(false, `${name}: buildEdges threw ${e.message}`); continue; }
    const corners = recs.reduce((s, r) => s + r.mp.length, 0);
    check(edges.length > 0, `${name}: some edges`);
    check(edges.length <= corners, `${name}: no more edges (${edges.length}) than the faces' own (${corners})`);
    check(edges.every((e) => e.fa >= 0 && e.fa < recs.length && e.j >= 0 && e.j < recs[e.fa].mp.length && (e.fb === -1 || (e.fb >= 0 && e.fb < recs.length && e.fb !== e.fa))),
      `${name}: every edge names a real face and corner`);
    check(edges.every((e) => [EDGE.smooth, EDGE.crease, EDGE.part, EDGE.seam].includes(e.kind)), `${name}: every edge has a known kind`);
    check(recs.every((r) => faceNormal(r.mp, r.src.cen).every(Number.isFinite)), `${name}: no NaN normal`);
    for (let k = 1; k < edges.length; k++) if (edges[k].fa < edges[k - 1].fa) { check(false, `${name}: edges grouped by owner`); break; }
    total += edges.length;
  }
}
check(total > 0, 'some vehicle built some edges');

// 3. Off, no lines; comic, the house numbers
delete globalThis.__houseComic;
check(vehicleInkOf(1800) === null, 'off: no vehicle lines');
globalThis.__houseComic = 1;
{
  const k = vehicleInkOf(1800);
  check(k && k.sil === HOUSE.cityPx * 2 && k.detail === HOUSE.cityPx && k.weigh === HOUSE.weigh, 'comic: the city outline width, half for detail, the figures\' weight');
  check(vehicleInkOf(100).sil === 1 && vehicleInkOf(100).detail === 1, 'comic: never under a pixel');
}
delete globalThis.__houseComic;

if (fails) { console.error(`vehicle-ink: ${fails} failed`); process.exit(1); }
