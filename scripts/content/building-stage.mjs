// The Building Stage's gate (docs/proposals/building-stage.md, steps 1 and 2).
//
// Builds every building's graph from the content tree (client/shared/building-graph.js) and lays out
// the ready ones, whose entry room has a Room Stage spec, as one floor plan. A ready building fails
// when its walk has a bent door or no way out to the street, or when its plan can't be drawn: a room
// that isn't square to the compass, a diagonal door, a door offset past the end of its wall, a room
// reached two ways landing in two places, or two rooms on the same floor space. The plan must also come
// out the same whatever order the content is read in.
//
// A building that isn't ready is reported, never failed: most of the city is text, and that's fine.
//
//   node scripts/content/building-stage.mjs              the gate: quiet unless a ready building is broken
//   node scripts/content/building-stage.mjs --report     readiness counts and the ready and partial buildings
//   node scripts/content/building-stage.mjs <map id>     one building's graph and plan, with the plan drawn
import fs from 'node:fs';
import path from 'node:path';
import { buildingGraph, buildingDefects, buildingLayout, placeFrom, zoneSpecOf } from '../../client/shared/building-graph.js';

const C = path.resolve(process.cwd(), 'content');
const read = (dir) => {
  const d = path.join(C, dir), out = [];
  for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) out.push(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
  return out;
};
const fails = [];
const rule = (ok, why) => { if (!ok) fails.push(why); };

// The rules on made-up buildings first, so they're pinned while no real one trips them.
{
  // the graph: a lobby off the street, a hall straight north, a bar bent (in one way, west back), a
  // cupboard with no spec, and a lift serving two floors
  const z = (id, exits, spec = true) => ({ id, name: id, map_id: id === 'st' ? 'map_world' : id === 'gone' ? 'map_set_aside' : 'm', exits, flags: spec ? { room: { w: 4, d: 4, h: 3 } } : {} });
  const fake = [
    z('st', { north: 'lobby' }), z('lobby', { south: 'st', north: 'hall', down: 'cup', in: 'lift' }),
    z('hall', { south: 'lobby', in: 'bar' }), z('bar', { west: 'hall' }), z('cup', { up: 'lobby' }, false),
    z('lift', { out: ['lobby', 'roof'] }), z('roof', { in: 'lift' }),
  ];
  const spec = (r) => r.flags.room || null;
  const b = buildingGraph({ zones: fake, maps: [{ id: 'm', parent_zone_id: 'st', entry_zone_id: 'lobby' }], specOf: spec }).get('m');
  const kind = (from, to) => b.doors.find((d) => d.from === from && d.to === to)?.kind;
  rule(kind('lobby', 'hall') === 'straight', 'a door answered by its opposite is straight');
  rule(kind('hall', 'bar') === 'bent', 'a door answered by another direction is bent');
  rule(kind('lift', 'roof') === 'lift', 'one exit with several targets is a lift');
  rule(!b.walk.includes('cup') && b.walk.includes('bar'), 'a room with no spec is a shut door, not part of the walk');
  rule(b.readiness === 'ready' && b.front.length === 1, 'a specced entry with a street exit is ready');
  rule(buildingDefects(b).some((d) => d.kind === 'bent'), 'a bent door inside the walk is a defect');
  const gone = buildingGraph({ zones: [...fake, z('gone', {})], maps: [{ id: 'm', parent_zone_id: 'gone', entry_zone_id: 'lobby' }], specOf: spec }).get('m');
  rule(gone.readiness === 'stored' && !buildingDefects(gone).length, 'a building on a set-aside facade is stored and never failed');
}
{
  // the plan: every room faces north (face 0), so a room's x is its w and its z its d
  const z = (id, exits, w = 4, d = 4, extra = {}) => ({ id, name: id, map_id: id === 'st' ? 'map_world' : 'm', exits, flags: id === 'st' ? {} : { room: { w, d, h: 3, face: 0, ...extra } } });
  const plan = (zones) => {
    const b = buildingGraph({ zones, maps: [{ id: 'm', parent_zone_id: 'st', entry_zone_id: 'a' }], specOf: (r) => r.flags.room || null }).get('m');
    return buildingLayout(b, { zones, specOf: (r) => r.flags.room || null });
  };
  const has = (L, k) => L.problems.some((p) => p.kind === k);
  // a square: a, east to e, north from both to n and ne, meeting; a door moved along a wall; a floor up
  const good = plan([
    z('st', { south: 'a' }), z('a', { north: 'n', east: 'e', up: 'top', west: 'w', south: 'st' }),
    z('n', { south: 'a', east: 'ne' }), z('e', { west: 'a', north: 'ne' }), z('ne', { west: 'n', south: 'e' }),
    z('w', { east: 'a' }, 6, 4, { doors: { east: 1 } }), z('top', { down: 'a' }),
  ]);
  rule(!good.problems.length, `a square of rooms and a moved door lay out clean (got ${good.problems.map((p) => p.kind).join(', ')})`);
  rule(good.rooms.ne?.box.join() === '2.28,6.28,0,3,2.28,6.28', 'a room reached two ways lands once, square to both');
  rule(good.rooms.w?.box.join() === '-8.28,-2.28,0,3,-3,1', 'a door offset moves the room behind it so the openings meet');
  rule(good.rooms.top?.floor === 3, 'a room up is stood on the ceiling of the room below');
  rule(good.doors.some((d) => d.kind === 'front' && d.from === 'a'), 'the street door is in the plan');
  rule(good.doors.filter((d) => d.kind === 'door').length === 5, 'a door pair is one opening, not two');
  const an = good.doors.find((d) => d.from === 'a' && d.to === 'n')?.sides;
  rule(an?.a?.wall === 'front' && an?.n?.wall === 'back' && an.a.a === an.n.a, `each side of a door is on its own room's wall, across the gap (got ${JSON.stringify(an)})`);
  const seen = placeFrom(good, 'a', 'n'), up = placeFrom(good, 'a', 'top');
  rule(seen?.at.join() === '0,4.28' && seen.face === 0 && seen.floor === 0 && up?.floor === 3, `the next room is placed from yours (got ${JSON.stringify({ seen, up })})`);
  // a loop that doesn't close: p's east door moved, so ne lands twice
  const loose = plan([
    z('st', { south: 'a' }), z('a', { north: 'p', east: 'q', south: 'st' }), z('p', { south: 'a', east: 'r' }, 4, 4, { doors: { east: 1 } }),
    z('q', { west: 'a', north: 'r' }), z('r', { west: 'p', south: 'q' }),
  ]);
  rule(has(loose, 'mismatch'), 'a room reached two ways in two places is a mismatch');
  // a wide room south and a room west-then-south on the same ground
  const crowd = plan([
    z('st', { north: 'a' }), z('a', { south: 's', west: 'w', north: 'st' }), z('s', { north: 'a' }, 12, 4),
    z('w', { east: 'a', south: 'ws' }, 8, 4), z('ws', { north: 'w' }),
  ]);
  rule(has(crowd, 'overlap'), 'two rooms on the same floor space overlap');
  const off = plan([z('st', { south: 'a' }), z('a', { south: 'st', north: 'n' }, 4, 4, { doors: { north: 1.9 } }), z('n', { south: 'a' })]);
  rule(has(off, 'door_off_wall'), 'a door moved past the end of its wall is caught');
}
if (fails.length) { for (const why of fails) console.error(`✗ building-stage rule: ${why}`); process.exit(1); }

const zones = read('zones'), maps = read('maps');
// with its en-suite, as the game draws it, so a flat's bathroom standing in the next room is an overlap here
const byId = new Map(zones.map((z) => [z.id, z]));
const specOf = (z) => zoneSpecOf(byId, z);
const graph = buildingGraph({ zones, maps, specOf });
const planOf = (b) => buildingLayout(b, { zones, specOf });

const args = process.argv.slice(2);
const one = args.find((a) => !a.startsWith('--'));
if (one) {
  const b = graph.get(one);
  if (!b) { console.error(`no building ${one}`); process.exit(2); }
  const L = planOf(b);
  console.log(JSON.stringify({ ...b, plan: L }, null, 2));
  console.log(draw(L));
  process.exit(0);
}

const all = [...graph.values()];
// the same plan whatever order the files are read in
const backward = buildingGraph({ zones: [...zones].reverse(), maps: [...maps].reverse(), specOf });
const broken = [];
for (const b of all) {
  const defects = buildingDefects(b);
  if (b.readiness === 'ready') {
    const L = planOf(b);
    defects.push(...L.problems);
    const R = buildingLayout(backward.get(b.id), { zones: [...zones].reverse(), specOf });
    if (JSON.stringify(L) !== JSON.stringify(R)) defects.push({ kind: 'unstable', note: 'the plan changes with the order the content is read in' });
  }
  if (defects.length) broken.push({ b, defects });
}

if (args.includes('--report')) {
  const n = (r) => all.filter((b) => b.readiness === r).length;
  const rooms = all.reduce((s, b) => s + b.rooms.length, 0), specd = all.reduce((s, b) => s + b.rooms.filter((r) => r.spec).length, 0);
  console.log(`${all.length} buildings, ${rooms} rooms, ${specd} with a Stage spec`);
  console.log(`  ready ${n('ready')}  partial ${n('partial')}  none ${n('none')}  stored ${n('stored')}`);
  const kinds = {};
  for (const b of all) for (const d of b.doors) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
  console.log(`  doors: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  links to another building: ${all.reduce((s, b) => s + b.links.length, 0)}`);
  console.log('\nready (the entry has a spec), by rooms you can walk:');
  const ready = all.filter((b) => b.readiness === 'ready').sort((x, y) => y.walk.length - x.walk.length);
  for (const b of ready) console.log(`  ${b.id}  ${b.name}  walk ${b.walk.length} of ${b.rooms.length}`);
  console.log('\npartial (a room has a spec, the entry doesn\'t):');
  for (const b of all.filter((b) => b.readiness === 'partial')) {
    const has = b.rooms.filter((r) => r.spec).length;
    console.log(`  ${b.id}  ${b.name}  ${has} of ${b.rooms.length}; entry ${b.entry || '(none)'}`);
  }
}

if (broken.length) {
  console.error(`\n✗ building-stage: ${broken.length} ready building(s) can't be walked:`);
  for (const { b, defects } of broken) {
    console.error(`  ${b.id} (${b.name})`);
    for (const d of defects) console.error(`    ${d.kind}${d.zone ? ` ${d.zone}` : ''}${d.dir ? ` ${d.dir}` : ''}${d.to ? ` -> ${d.to}` : ''}${d.note ? `: ${d.note}` : ''}`);
  }
  process.exit(1);
}
if (args.includes('--report')) console.log('\n✓ every ready building can be walked');

// The plan from above, one floor at a time, a character a metre: north up, rooms lettered, `+` a door
// between rooms, `=` the street door, `#` a shut one.
function draw(L) {
  const ids = Object.keys(L.rooms).sort(), out = [];
  const floors = [...new Set(ids.map((id) => L.rooms[id].floor))].sort((a, b) => a - b);
  for (const y of floors) {
    const here = ids.filter((id) => L.rooms[id].floor === y);
    // what each room covers past its floor (its en-suite, hall and balcony) is drawn in its small letter
    const foot = (id) => L.rooms[id].foot || [L.rooms[id].box[0], L.rooms[id].box[1], L.rooms[id].box[4], L.rooms[id].box[5]];
    const x0 = Math.floor(Math.min(...here.map((id) => foot(id)[0]))), x1 = Math.ceil(Math.max(...here.map((id) => foot(id)[1])));
    const z0 = Math.floor(Math.min(...here.map((id) => foot(id)[2]))), z1 = Math.ceil(Math.max(...here.map((id) => foot(id)[3])));
    const grid = [];
    for (let z = z1; z >= z0; z--) grid.push([...' '.repeat(x1 - x0 + 1)]);
    const put = (x, z, ch) => { const r = z1 - Math.round(z), c = Math.round(x) - x0; if (grid[r] && c >= 0 && c < grid[r].length) grid[r][c] = ch; };
    here.forEach((id) => {
      const [fx0, fx1, fz0, fz1] = foot(id), ch = String.fromCharCode(97 + ids.indexOf(id));
      for (let x = fx0; x <= fx1 + 1e-6; x++) for (let z = fz0; z <= fz1 + 1e-6; z++) put(x, z, ch);
    });
    here.forEach((id, i) => {
      const [bx0, bx1, , , bz0, bz1] = L.rooms[id].box, ch = String.fromCharCode(65 + ids.indexOf(id));
      for (let x = bx0; x <= bx1 + 1e-6; x++) for (let z = bz0; z <= bz1 + 1e-6; z++) {
        const edge = Math.abs(x - bx0) < 1e-6 || Math.abs(x - bx1) < 1e-6 || Math.abs(z - bz0) < 1e-6 || Math.abs(z - bz1) < 1e-6;
        put(x, z, edge ? '.' : ch);
      }
    });
    for (const d of L.doors) if (d.at[1] === y && !['stairs'].includes(d.kind)) put(d.at[0], d.at[2], d.kind === 'door' ? '+' : d.kind === 'front' ? '=' : '#');
    out.push(`floor ${y} m`, ...grid.map((r) => '  ' + r.join('')));
  }
  out.push(...ids.map((id, i) => `  ${String.fromCharCode(65 + i)} ${id}  face ${L.rooms[id].face}`));
  return out.join('\n');
}
