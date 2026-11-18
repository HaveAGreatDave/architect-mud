// One-shot: the Yards Tenement's rooms brought into line with its GLASS model (content/building_models/yardstenement.json).
// The model stays as it is; the rooms change to fit it.
//
//   node scripts/content/yards-fit.mjs [--write]
//
// The model at 922,902 (921,902 before the column at x 914 went in) has `flags.floors: 10`, so it's ten storeys: the
// ground floor, then nine. The rooms
// had a lobby and ten floors of flats, eleven storeys, so the top floor stood above the roof. At this tile's seed the
// shaft is 14.3 m square up to 27.6 m and the top block 11.8 m square above that, storeys of 3.6 m (at the old tile
// 13.8 m, 25 m, 11.4 m and 3.3 m: a tile's seed jitters its building), so floors 7 to 9 are in the narrow
// block. The model also has a lift housing on the roof, a glazed shopfront under an awning at street level (the
// street kit's, glass/derived-kit.js), and soot-dark brick banded in lighter brick.
//
//   1. Floor 10 (zone_yards_tenement_f10 and its six flats) goes onto the holding map, map_set_aside, at z 10 and
//      grid 31 to 33 by 1 to 3, in the same pattern round its landing, with `set_aside` and `set_aside_from`.
//      Floor 9's way up and its connection file go. scripts/oneshots/set-aside-players.mjs moves anybody left in
//      those rooms on prod and lists any rented one (it reads the holding map, so it needs no change).
//   2. The four people who lived on floor 10 move to the same doors on floor 9, which stood empty: 1001 to 901 and
//      1002 to 902. Their npc_residences rows move with them.
//   3. Text: the street front (brick, the narrow top, the lift housing, shop glass), the lobby (the dead lift), the
//      utility room (no floor count), and the landings and flats on floors 7 to 9 (smaller, in the narrow top).
//
// It refuses to run twice: once floor 10 is on the holding map there's nothing to do.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';

const C = path.resolve(process.cwd(), 'content');
const WRITE = process.argv.includes('--write');
const file = (dir, id) => path.join(C, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
const P = 'zone_yards_tenement_';

if (read('zones', `${P}f10`).map_id === 'map_set_aside') { console.log('yards-fit: already done'); process.exit(0); }

const writes = new Map(), deletes = [];
const put = (dir, obj) => writes.set(`${dir}/${obj.id}`, obj);

// ── 1. floor 10 onto the holding map ────────────────────────────────────────────────────────────────
const AT = [32, 2];
for (const id of [`${P}f10`, ...[1, 2, 3, 4, 5, 6].map((u) => `${P}u10_${u}`)]) {
  const z = read('zones', id);
  const from = `map_int_yards_tenement ${z.grid_x},${z.grid_y},${z.grid_z}`;
  const exits = { ...z.exits };
  if (id === `${P}f10`) delete exits.down;
  // the holding map has no anchor, so a room on it has no parent (content:lint); set_aside_from says where it was
  put('zones', { ...z, exits, map_id: 'map_set_aside', parent_zone: null, grid_x: AT[0] + z.grid_x, grid_y: AT[1] + z.grid_y, flags: { ...z.flags, set_aside: true, set_aside_from: from } });
}
const f9 = read('zones', `${P}f9`), f9exits = { ...f9.exits };
delete f9exits.up;
put('zones', { ...f9, exits: f9exits });
deletes.push('connections/conn_yards_tenement_f10_down_3i9q');

// ── 2. floor 10's people down a floor ───────────────────────────────────────────────────────────────
const MOVE = { [`${P}u10_1`]: `${P}u9_1`, [`${P}u10_2`]: `${P}u9_2` };
for (const f of fs.readdirSync(path.join(C, 'npcs'))) {
  const n = JSON.parse(fs.readFileSync(path.join(C, 'npcs', f), 'utf8'));
  if (MOVE[n.home_zone]) put('npcs', { ...n, home_zone: MOVE[n.home_zone] });
  if (n.work_zone_id && MOVE[n.work_zone_id]) throw new Error(`${n.id} works in ${n.work_zone_id}; move that by hand`);
}
for (const [was, to] of Object.entries(MOVE)) {
  if (fs.existsSync(file('npc_residences', to))) throw new Error(`${to} already has a residence row`);
  const r = read('npc_residences', was);
  writes.set(`npc_residences/${to}`, { ...r, zone_id: to });
  deletes.push(`npc_residences/${was}`);
}

// ── 3. the text ────────────────────────────────────────────────────────────────────────────────────
const text = (id, description) => { const z = writes.get(`zones/${id}`) || read('zones', id); put('zones', { ...z, description }); };
text('zone_district_921_902', "A ten-storey block of soot-black brick banded in lighter brick, shoved in between the freight lanes. It steps in for the top floors under a cornice, with a lift housing on the roof. Grimy shop glass runs along the ground floor under an awning, and most of the windows above are dark, cracked or gone. A board wired to the door reads ROOMS TO LET, and under it, in a shakier hand, NO REFUNDS NO EXCEPTIONS. It's the closest thing the Yards has to somewhere to live.");
text(`${P}lobby`, "A cramped ground-floor lobby: a wall of dented mailboxes, half of them hanging open and empty, a buzzer panel with every wire yanked out, and lift doors chained shut so long ago the chain has rusted to them. The concrete stairwell beside it smells of damp, mildew, and somebody else's dinner three floors up. A strip light overhead flickers as if it's thinking it over.");
text(`${P}util`, "The tenement's guts: a low, sweating concrete sub-basement of riser conduits, a long-dead boiler, and a floor drain choked with grit. A single junction box feeds every floor and trips if you so much as breathe on it wrong.");
const NARROW_LANDING = "A narrow landing off the stairwell, tighter than the ones below where the building steps in, six numbered doors crowded round it, the stencilled numbers worn to grey ghosts. The carpet gave up years ago and the smell never will. A bare bulb buzzes overhead, throwing more shadow than light.";
text(`${P}f7`, NARROW_LANDING);
text(`${P}f8`, NARROW_LANDING);
text(`${P}f9`, `${NARROW_LANDING} This is the top floor. The stairs end at a roof door with a padlock on it.`);
const NARROW_FLAT = "One room, smaller than the ones downstairs because the building steps in up here. A steel-frame bed with a mattress that has seen things, a hot plate on an upturned crate, a sink that drips on its own schedule, and a window painted shut over a view of the container stacks. The radiator is cold and the lock is cheap, but the door closes, and in the Yards that's the whole of what a home has to do.";
for (const f of [7, 8, 9]) for (const u of [1, 2, 3, 4, 5, 6]) text(`${P}u${f}_${u}`, NARROW_FLAT);

// ── write ─────────────────────────────────────────────────────────────────────────────────────────
let wrote = 0;
for (const [rel, obj] of writes) {
  const f = path.join(C, `${rel}.json`), json = canonicalJson(obj);
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === json) continue;
  if (WRITE) fs.writeFileSync(f, json);
  wrote++;
  if (!WRITE) console.log(`would write content/${rel}.json`);
}
for (const rel of deletes) {
  const f = path.join(C, `${rel}.json`);
  if (!fs.existsSync(f)) continue;
  if (WRITE) fs.unlinkSync(f);
  else console.log(`would delete content/${rel}.json`);
}
console.log(`yards-fit: ${wrote} files ${WRITE ? 'written' : 'to write'}, ${deletes.length} ${WRITE ? 'deleted' : 'to delete'}${WRITE ? '' : ' (dry run; pass --write)'}`);
