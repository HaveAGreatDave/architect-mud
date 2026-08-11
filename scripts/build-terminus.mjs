// Build TERMINUS — the Exodus settlement, pass 1 (the apron).
//
// A one-shot content generator. It writes files under `content/` and touches no database: git is
// the source of truth, so this emits the tree and `npm run content:import` loads it. Re-runnable —
// it overwrites its own output and nothing else.
//
// See docs/proposals/terminus.md for the design. The short version: the Exodus abandoned the Basin
// and this is where they went. It is walled, it shuns outsiders, and pass 1 builds only the APRON —
// the strip outside the wall where trade happens because purity is expensive. The inside exists as
// tiles so the region stays a hole-free rectangle (the void requires that), but nothing connects to
// it. That is deliberate: in pass 1 the inside is a rumour.
//
// LAYOUT (14x14, x 1200-1213, y 910-923). You arrive from the WEST, off Coldwater's east rim.
//
//     x1200 .. 1204   1205    1206 .. 1213
//     +-------------+------+---------------+
//     |   APRON     | WALL |   INTERIOR    |
//     |  (pass 1)   | gate |   (pass 2)    |
//     +-------------+------+---------------+
//
// Tiles are cheap fill; the authored cost is the buildings and the people, which are hand-written.
//
// FIRST RUN, in order — the middle step exists because a building's two-letter map code can only be
// chosen by something that sees every building in the world at once, which this script cannot:
//
//   node scripts/build-terminus.mjs
//   npm run content:import && npm run map:derive
//   node scripts/bake-terminus-markers.mjs     ← writes the derived codes back into content
//   npm run content:import
//
// After that, re-running this script is safe: it carries any existing `marker` forward.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGION = 'region_terminus';
const X0 = 1200, X1 = 1213, Y0 = 910, Y1 = 923;
const WALL_X = 1205;                 // the wall column
const ROAD_Y = 916;                  // the one road: runs east from the roadhead to the gate
const APRON = (x) => x < WALL_X;

const id = (x, y) => `zone_terminus_${x}_${y}`;
const zonePath = (i) => join(ROOT, 'content', 'zones', `${i}.json`);
const powerPath = (i) => join(ROOT, 'content', 'power_zones', `${i}.json`);

// Canonical JSON: keys sorted, two-space indent, trailing newline — matches what `content:export`
// emits, so a later export produces no spurious diff. (A naive sorted-key REPLACER silently empties
// nested objects; sorting the KEYS during stringify does not.)
function canonical(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2) + '\n';
}
const write = (p, obj) => writeFileSync(p, canonical(obj), 'utf8');

// ── Flavour ──────────────────────────────────────────────────────────────────
// Spare and devotional. The Exodus renounce the machine and are waiting to leave; the apron is the
// part of that they let you see. NO EM DASHES anywhere in this file's prose — that punctuation is a
// voice tell reserved for the Ascendants and the Architect.
// NOTHING IS EVER NAMED. Not one of these says psionic, or cult, or creed. The unease is entirely
// in behaviour that has an innocent reading and a second one, and the player is allowed to take the
// innocent one forever. See the "how the inside reads" rule in docs/proposals/terminus.md — this is
// that rule applied at the wall, where a visitor forms their whole impression of these people from
// outside. Two beats do the heavy lifting: somebody responding to something that was not said, and
// a great many people doing one thing at one moment with no signal for it.
const AMBIENT = [
  'Wind comes off the flats in one long unbroken note and does not stop.',
  'Somebody is counting, somewhere out of sight, and does not hurry.',
  'A line of figures crosses the middle distance, walking, and none of them look over.',
  'Chalk marks on a rock face. A date, maybe. It has been corrected twice.',
  'The gate does not open. Nothing about it suggests it is going to.',
  'Two figures pass on the wall walk. Neither speaks. Both change direction.',
  'Somewhere behind the wall, a great many people stop doing something at the same moment.',
  'A child watches you from the top of the wall. An adult arrives and moves them along, and you do not hear anybody call.',
  'The light goes flat and red and every stone throws a shadow twice its length.',
  'Rope, coiled and re-coiled until it is perfect. Nobody has been near it.',
  'A hand goes up on the wall walk, in greeting, a moment before you had decided to raise yours.',
  'There is no rubbish here. Not a scrap, not anywhere, and no bins either.',
  'You get the brief and entirely unsupported sense of having been read, filed, and found uninteresting.',
];

const TILE_NAMES = [
  'The Standing Flats', 'Red Shelf', 'The Waiting Ground', 'Sunstruck Pan',
  'The Long Quiet', 'Ochre Bench', 'The Patience', 'Scoured Rock',
];
const pick = (arr, x, y) => arr[Math.abs(x * 31 + y * 17) % arr.length];

// ── Buildings on the apron ───────────────────────────────────────────────────
// Every `building_type` here is one `drawTypeModel` already models, checked against the case list
// in client/game/js/panels/windshield.js. Picking a type off the fiction rather than off the
// renderer's list is how you ship a grey box (see the trucking roadside note).
const BUILDINGS = {
  // The quartermaster. The district's joke: a creed that renounces the machine still needs
  // bearings, and somebody has to buy them from Coldwater.
  [`${1202}_${915}`]: {
    name: 'Last Requisition', type: 'warehouse', entrance: 'south', floors: 1,
    desc: 'A long shed of corrugated sheet, painted the colour of the rock so it barely reads as a building at all. The doors stand open on crates stencilled with Coldwater foundry marks that somebody has made a serious effort to scrub off and then given up on. A hand-lettered board by the door lists what is wanted and what is paid, and a second board underneath it, in the same hand, lists what will not be bought at any price.',
  },
  // The gate. Shut, staffed, and the whole of pass 1's promise.
  [`${WALL_X}_${ROAD_Y}`]: {
    name: 'The Gate', type: 'civic', entrance: 'west', floors: 2,
    desc: 'Two leaves of plate steel set into the wall, taller than they need to be and blank as a closed hand. There is no handle on this side. A slot at head height is open, and somebody is behind it, and they have been watching you since the road.',
  },
};

// ── Behind the wall: the glasshouses ─────────────────────────────────────────
// The Exodus renounce the machine and refuse the city's food, so they grow their own. Two of their
// five listed values are Self-Reliance and Simplicity, and this is what those look like in glass.
//
// They sit INSIDE, unreachable in pass 1, and that is the point: the wall hides everything except
// the one thing they do not mind you knowing. Glass is taller than rammed earth, so from the apron
// you see roofs and nothing else, and at night you see them lit. It turns the wall from a bunker
// into a community you are outside of, which is a much harder thing to walk away from.
const GLASSHOUSES = [
  [1207, 913], [1207, 919], [1209, 916], [1211, 912], [1211, 920],
];
const glasshouse = (n) => ({
  name: `Glasshouse ${n}`, type: 'greenhouse', entrance: 'west', floors: 2,
  desc: 'A long glazed vault on a low stone knee-wall, its ridge lights cracked open a hand\'s width. Inside, in rows, things are growing that nobody out here has bothered to grow in thirty years.',
});

// The wall itself: a solid column, drawn as low blank structures. Not passable, not enterable.
const wallTile = (y) => ({
  name: 'The Wall',
  desc: 'Rammed earth and salvaged plate, twice the height of a man and going on out of sight in both directions. There are no windows in it. Whatever is on the other side does not want to be looked at from here.',
});

GLASSHOUSES.forEach(([gx, gy], i) => { BUILDINGS[gx + "_" + gy] = glasshouse(i + 1); });

function main() {
  for (const d of ['zones', 'power_zones', 'regions', 'generators', 'airfields', 'connections']) {
    const p = join(ROOT, 'content', d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  let zones = 0;
  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      const me = id(x, y);
      const key = `${x}_${y}`;
      const bld = BUILDINGS[key];
      const isWall = x === WALL_X && !bld;
      const road = APRON(x) && y === ROAD_Y;

      // EXITS. Reciprocal orthogonal links to neighbours in the same tier only. Nothing crosses the
      // wall column: the apron cannot reach the interior, which is what makes the inside a rumour.
      // A facade carries no exits of its own (you enter it from the street via world_exit_zone).
      const exits = {};
      if (!bld && !isWall) {
        const link = (dx, dy, dir) => {
          const nx = x + dx, ny = y + dy;
          if (nx < X0 || nx > X1 || ny < Y0 || ny > Y1) return;
          if (BUILDINGS[`${nx}_${ny}`]) return;             // never walk into a facade
          if (nx === WALL_X && !BUILDINGS[`${nx}_${ny}`]) return;   // never walk into the wall
          if (APRON(x) !== APRON(nx)) return;               // never cross the wall
          exits[dir] = id(nx, ny);
        };
        link(0, -1, 'north'); link(0, 1, 'south'); link(1, 0, 'east'); link(-1, 0, 'west');
      }

      // A BUILDING FOOTPRINT IS NOT GROUND. Painted terrain on a building tile suppresses the
      // tile's map code, so the wall and every facade would vanish from the map and the tablet.
      // content:lint catches this; it is listed here because it is easy to re-add by reflex.
      const flags = { region_id: REGION };
      if (!bld && !isWall) flags.terrain = road ? 'dirt_road' : 'redrock';
      // NOT tagged `facade`. That tag promises an ENTERABLE interior: the linter checks for a
      // matching interior map and a world_exit_zone, and rightly refuses a door that opens on
      // nothing. Pass 1 has no interiors — the quartermaster works at the open shed doors and the
      // warden stands in the road, because a frontier apron does its business in the light. These
      // are `is_building` MASS: solid, rendered, on the map, not enterable. Pass 2 adds the
      // interiors and the facade tags together, which is the only way they should ever be added.
      //
      // The cost of not being a facade is edges. `derive.mjs` has exactly one geometric rule —
      // "a facade opens at flags.entrance and nowhere else" — so a plain building tile projects an
      // adjacency on all four sides. Every one of those is un-said by a blocked connection file
      // below, which is what those files are for (190 of the shipped world's 404 are walls).
      if (bld) {
        Object.assign(flags, {
          building_name: bld.name, building_type: bld.type,
          entrance: bld.entrance,            // orients the 3D model toward the street
          is_building: true, floors: bld.floors,
        });
      } else if (isWall) {
        // The wall MUST be building tiles along its whole length: `groundObstructionAt` gates
        // solidity on `building_type`, and without it a truck drives straight through into the
        // interior — exits stop walkers, not vehicles.
        //
        // But `building_name` is what derives the two-letter map code, and it has to be UNIQUE per
        // tile: thirteen tiles called "The Wall" exhausted the W-space and produced W2..W8 and then
        // WA six times over. So the wall carries a unique building_name (the map's identity) while
        // the zone's own `name` stays "The Wall" (what a player reads in the room). Those two are
        // allowed to differ, and this is exactly the case they differ for.
        Object.assign(flags, {
          building_name: `Terminus Wall ${y - Y0 + 1}`,
          building_type: 'ruins', is_building: true, floors: 1,
        });
      }
      // THE DEPOT. On the drivable street tile, never on a facade: a facade carries building_type
      // and is therefore solid, so a truck would collide with its own yard.
      if (x === 1202 && y === ROAD_Y) {
        flags.truck_depot = { name: 'The Roadhead' };
        flags.truck_fuel = true;    // the only diesel between here and Coldwater, sold reluctantly
      }
      // THE GANTRY. A VTOL pad, not an airstrip: they built it to leave the planet.
      if (x === 1203 && y === 919) {
        Object.assign(flags, { airfield_id: 'terminus_gantry' });
      }

      const name = bld ? bld.name : isWall ? 'The Wall' : road ? 'The Roadhead' : pick(TILE_NAMES, x, y);
      const description = bld ? bld.desc : isWall ? wallTile(y).desc
        : road ? 'Graded dirt, wide enough for something with a trailer on it, running east toward a wall that does not appear to have a way through. Tyre ruts, and the marks where heavy things have been dragged off the road and left.'
        : 'Red rock under a sky that goes on being enormous about it. Nothing grows here that anybody planted. Off east there is a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.';

      // PRESERVE THE MARKER. A building tile ships with the two-letter map code it will derive, and
      // that code can only be chosen by something that sees every building in the world at once
      // (assignBuildingMarkers) — which this script, seeing only Terminus, cannot do. So the codes
      // are baked in after the first derive (see the header) and carried forward here. Without this
      // line a rebuild silently strips them and the map loses every landmark in the region again.
      let marker = null;
      try { marker = JSON.parse(readFileSync(zonePath(me), 'utf8')).marker ?? null; } catch { /* new tile */ }

      // `marker` is OMITTED when null rather than written as null — the content registry marks it
      // omitWhenNull, so an explicit null is a value where the absence of the key is the default.
      write(zonePath(me), {
        ambient_events: AMBIENT, ambient_theme: 'wasteland', description, exits, flags,
        grid_x: x, grid_y: y, grid_z: 0, id: me, map_id: 'map_world',
        ...(marker ? { marker } : {}),
        name, parent_zone: null,
      });
      write(powerPath(me), {
        capacity_kw: 10000, flags: {}, generator_id: 'gen_region_region_terminus',
        id: me, max_capacity_kw: 1000, name, source_type: 'city_grid',
      });
      zones++;
    }
  }

  // ── The walls the geometry cannot un-say ───────────────────────────────────
  // `derive.mjs` projects an edge between any two orthogonally adjacent tiles on the same map, and
  // then subtracts the facade rule. Everything this region deliberately does NOT connect — into the
  // wall, into a building's mass, across the wall from apron to interior — has to be declared, or
  // the derive pass invents the exit and quietly demolishes the wall the whole district is about.
  //
  // One file per PAIR, deterministically named so a re-run overwrites rather than accumulates.
  let walls = 0;
  const declared = (x, y, dir, to) => {
    try {
      const z = JSON.parse(readFileSync(zonePath(id(x, y)), 'utf8'));
      return z.exits?.[dir] === to;
    } catch { return false; }
  };
  const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      for (const [dx, dy, dir] of [[1, 0, 'east'], [0, 1, 'south']]) {   // each pair once
        const nx = x + dx, ny = y + dy;
        if (nx > X1 || ny > Y1) continue;
        const a = id(x, y), b = id(nx, ny);
        if (declared(x, y, dir, b) || declared(nx, ny, OPP[dir], a)) continue;   // a real link
        const cid = `conn_terminus_${x}_${y}_${dir}`;
        write(join(ROOT, 'content', 'connections', `${cid}.json`),
          { a, b, blocked: true, dir, id: cid, lockable: false, one_way: false });
        walls++;
      }
    }
  }
  console.log(`  walls  ${walls} blocked connection file(s)`);

  write(join(ROOT, 'content', 'regions', `${REGION}.json`), {
    base_terrain: 'redrock', climate_bias: null, defaults: {}, grid_z: 0,
    id: REGION, name: 'Terminus',
  });
  write(join(ROOT, 'content', 'generators', 'gen_region_region_terminus.json'), {
    capacity_kw: 10000, city_generator_id: null, connection_range: 0, flags: {},
    fuel_burn_rate: 0, fuel_remaining: 0, fuel_type: null, generator_type: 'city_plant',
    id: 'gen_region_region_terminus', name: 'The Standing Charge', owner_id: null,
    zone_id: id(1201, 920),
  });
  // vtol_only is the whole point: the circle-H pad renders instead of a strip, and anything with a
  // wing cannot use it. They were never building for aeroplanes.
  write(join(ROOT, 'content', 'airfields', 'terminus_gantry.json'), {
    charter: false, charter_vtol_only: true, dealer: false, fuels: ['biofuel'],
    id: 'terminus_gantry', lawless: true, name: 'The Gantry', rental: false,
    residents_only: null, surface: 'dust', theme: 'wastes', vtol_only: true,
  });

  console.log(`terminus: wrote ${zones} zones + ${zones} power_zones, 1 region, 1 generator, 1 airfield`);
  console.log(`  apron  x${X0}-${WALL_X - 1}  (reachable)`);
  console.log(`  wall   x${WALL_X}          (solid, one gate at y${ROAD_Y})`);
  console.log(`  inside x${WALL_X + 1}-${X1}  (exists for the rectangle; nothing connects to it — pass 2)`);
}

main();
