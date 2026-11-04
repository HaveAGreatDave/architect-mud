// medialot: the Media Lot's rules a picture can't prove (docs/proposals/media-lot.md).
//
//   node scripts/shapes/medialot.mjs
//
// The buildings stay inside the wall and on one line; an aircraft hits the water tower; the map's
// wall and the windscreen's come from one rule; the barrier lifts for a rig and the news vans leave
// their bays empty. Rendering is `markRenderSmoke` and `smoke.mjs`; this is the arithmetic.
import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';
import { lotSides } from '../content/derive.mjs';

const ws = await loadWindshield();
const { LOT, lotSolidAt, lotAirTopAt, lotArmSense, lotArmTravel, lotTicker, lotTickerLine, lotVans } = await import('../../client/game/js/panels/glass/media-lot.js');

let bad = 0;
const check = (ok, what) => { if (!ok) { bad++; console.error('  ✗ ' + what); } };

// ── The buildings ──
const reg = new Map(ws.shapeModelRegistry().map(({ key, m }) => [key, m]));
const tops = {};
for (const key of ['named:ksabtvstudiostage', 'named:ksab5', 'named:coldwatersentinel']) {
  const m = reg.get(key);
  check(!!m && m.noKit, `${key} is a kitless arm`);
  if (!m) continue;
  check(!m.type.startsWith('authored'), `${key} draws from its arm, not an authored file`);
  const segs = ws.shapeWireList(m, 200);
  let top = 0;
  for (const s of segs) {
    // In constants: a term in fh or h would put the building on a different line on each tile.
    for (const k of ['cx', 'cy', 'hx', 'hy', 'z0', 'z1']) check(!s[k][0] && !s[k][1], `${key}: ${k} isn't a constant`);
    const reach = Math.max(Math.abs(s.cx[2]) + s.hx[2], s.hy[2] - s.cy[2]);   // the sides and the street; a door's canopy reaches out over the lot
    // ⚠ A building's mass stops short of the wall's inner face, or the wall stands inside it.
    if (s.z0[2] < LOT.WALL_H) check(reach <= LOT.WALL_C - LOT.WALL_T / 2 + 0.002, `${key}: mass reaches ${reach.toFixed(3)}, into the lot's wall`);
    top = Math.max(top, s.z1[2]);
  }
  tops[key] = top;
}
check(tops['named:ksabtvstudiostage'] > LOT.ROOF_Z + 0.2, 'only the stage rises above the parapet');

// ── The water tower ──
const park = { ml: { p: 'p', w: 'es' } };
check(ws.lotRoofFtAt(0, 0, park, LOT.TOWER_X, LOT.TOWER_Y) > 0, 'an aircraft hits the water tower');
check(ws.lotRoofFtAt(0, 0, park, -0.3, -0.3) === 0, 'and flies over the rest of the car park');
check(ws.lotRoofFtAt(0, 0, { ml: { p: 'c' } }, LOT.TOWER_X, LOT.TOWER_Y) === 0, 'the court has no tower');
check(lotAirTopAt(LOT.TOWER_X, LOT.TOWER_Y, park.ml) > LOT.TOWER_TOP_Z, 'the post goes to the top of the cone');
check(/lotRoofFtAt\s*\(/.test(readFileSync(new URL('../../client/game/js/panels/cockpit.js', import.meta.url), 'utf8')), 'the CFIT sweep asks about the tower');

// ── One rule for the wall ──
const world = (id) => (id.startsWith('zone_district') || id.startsWith('zone_medialot') ? 'map_world' : 'map_int');
check(JSON.stringify(lotSides({ wall: 'ws' }, { east: 'zone_medialot_913_911', west: 'zone_studio' }, world)) === '{"wall":"ws"}', "a building's link into its rooms doesn't open its wall");
check(lotSides({ wall: 'es' }, { east: 'zone_district_915_911' }, world).wall === 's', 'a wall goes where the tile has no way out');
check(lotSides({ gate: 's' }, { south: 'zone_district_913_912' }, world).gate === 's', 'a gate needs a way onto the map');
check(lotSides({ gate: 's' }, {}, world).gate === undefined, 'and has none on a blocked side');
for (const f of ['client/game/js/panels/minimap.js', 'client/game/js/panels/minimap-canvas.js', 'client/game/js/panels/tablet-os.js']) {
  const s = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  check(s.includes('lot_wall') && s.includes('lot_gate'), `${f} paints the lot's wall and gate`);
}

// ── The barrier ──
check(lotArmSense(-0.1, 0.8, 's') === 1, 'it senses a rig in the lane');
check(lotArmSense(-0.1, 0.1, 's') === 1, 'from inside as well');
check(lotArmSense(3, 1, 's') === 0, 'and not one down the road');
lotArmTravel(0, 0);
check(lotArmTravel(1, 200) < 0.3, 'it takes time to lift, so a rig going by leaves it down');
check(lotArmTravel(1, 1200) > 0.9 && lotArmTravel(1, 2200) === 1, 'and a rig that turns in finds it up');

// ── The news vans ──
const BAY = [-0.37, 0.30], lot = { p: 'p' };
lotVans(false, 0);
check(lotSolidAt(BAY[0], BAY[1], lot) > 0, 'a van in its bay is solid');
lotVans(true, 1000);
lotVans(true, 1000 + 5000);
check(lotSolidAt(BAY[0], BAY[1], lot) === 0, 'a van pulling out is no mass');
lotVans(true, 1000 + 120000);
check(lotSolidAt(BAY[0], BAY[1], lot) === 0, 'an empty bay is open');
lotVans(false, 200000);
lotVans(false, 200000 + 120000);
check(lotSolidAt(BAY[0], BAY[1], lot) > 0, 'and solid again when the van is back');

// ── The ticker ──
const line = lotTickerLine(['Gunfire on Marrow Street', 'Bakery "wins" 3-0']);
check(line.startsWith('GUNFIRE ON MARROW STREET') && !line.includes('"'), 'a headline is capitals, with nothing a glyph bake lacks');
check(lotTickerLine([]) === '', 'no headlines, no line');
for (const t of [0, 1234, 99999, 7e6]) {
  const cells = lotTicker(line, t);
  check(cells.length > 10, 'the band is full of letters');
  check(cells.every(([, u]) => Math.abs(u) + LOT.TICKER_CELL / 2 <= LOT.TICKER_HW + 1e-9), 'a letter is drawn only wholly inside the band');
}
const uOf = (t) => lotTicker(line, t).find(([c]) => c === 'F')[1];
const u0 = uOf(0), u1 = uOf(40);
check(u1 < u0, 'it runs right to left');
check(LOT.TICKER_Z0 > LOT.WALL_H + LOT.COPE_H, 'it stands over the wall');

if (bad) { console.error(`✗ medialot — ${bad} problem(s)`); process.exit(1); }
console.log('✓ medialot');
