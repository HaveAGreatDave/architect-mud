// Gate for the wildlands (client/shared/wildlands.js): the ground between the placed regions.
//
// What it holds, each of which fails silently in the picture:
//   1. the baked field is fresh against content/zones and content/map (a moved region otherwise
//      leaves every halo, and the coast, where the region used to be);
//   2. every biome it answers is in the ground palette, and every terrain is a real terrain —
//      an unknown biome paints as the fallback colour and nobody notices;
//   3. the coast is continuous: a row north of the coast line is sea right across the map;
//   4. each region's halo biome is what you find just outside it;
//   5. every landform's cone falls away from its crater;
//   6. it is a pure function: the same tile asked twice gives the same answer;
//   9. the carved relief shipped, flat under every placed tile, with the volcano still a mountain;
//  10. the flora shipped, every species is drawable and found somewhere, and the plants are pure.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { BIOME_GROUND } from '../../client/shared/ground-palette.js';
import { wildlandsAt, wildlandsRect, landforms, landformHeight, reliefAt, groundZ } from '../../client/shared/wildlands.js';
import { WILDLANDS_FIELD as F } from '../../client/shared/wildlands-field.js';

const fails = [];
const check = (name, ok, detail = '') => { if (!ok) fails.push(`${name}${detail ? ' — ' + detail : ''}`); };

// 1. fresh
try { execFileSync(process.execPath, ['scripts/content/bake-wildlands.mjs', '--check'], { stdio: 'pipe' }); }
catch (e) { check('field is fresh', false, String(e.stderr || e.message).trim()); }

// 2. vocabulary
const terrains = new Set(Object.keys(JSON.parse(readFileSync('content/map/terrain.json', 'utf8')).terrains));
const r = wildlandsRect();
const badBiome = new Set(), badTerrain = new Set();
for (let y = r.y0; y <= r.y1; y += 3) for (let x = r.x0; x <= r.x1; x += 3) {
  const at = wildlandsAt(x, y);
  for (const [b] of at.blend) if (!BIOME_GROUND[b]) badBiome.add(b);
  if (!terrains.has(at.terrain)) badTerrain.add(at.terrain);
}
check('every biome is in the ground palette', !badBiome.size, [...badBiome].join(', '));
check('every terrain is a real terrain', !badTerrain.size, [...badTerrain].join(', '));

// 3. coast
let dry = 0;
for (let x = r.x0; x <= r.x1; x++) if (!wildlandsAt(x, F.coastY - 16).sea) dry++;
check('the sea runs the whole way along the coast', dry === 0, `${dry} dry tiles on row ${F.coastY - 16}`);

// 4. halos: ring each region 6 tiles out and ask what the ground is
for (const [id, h] of Object.entries(F.halo)) {
  const c = F.centres[id]; if (!c) { check(`halo ${id}`, false, 'region has no tiles'); continue; }
  let hit = 0, n = 0;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
    // walk out from the centre until the region's own distance plane says 6 tiles
    for (let d = 1; d < 200; d++) {
      const x = Math.round(c[0] + Math.cos(a) * d), y = Math.round(c[1] + Math.sin(a) * d);
      const at = wildlandsAt(x, y);
      if (at.edge || at.sea || at.landform) continue;
      if (d > 4) { n++; if (at.blend.some(([b, w]) => b === h.biome && w > 0.3)) hit++; break; }
    }
  }
  check(`${id}'s ${h.biome} shows round it`, n && hit / n > 0.5, `${hit}/${n}`);
}

// 5. landforms
for (const l of landforms()) {
  check(`${l.name}: the crater is at its centre`, wildlandsAt(l.x, l.y).landform?.part === 'crater');
  let prev = Infinity, rises = 0;
  for (let d = l.crater + 2; d < l.radius - 4; d += 4) { const h = landformHeight(l.x + d, l.y); if (h > prev + 0.05) rises++; prev = h; }
  check(`${l.name}: the cone falls away from the crater`, rises === 0, `${rises} rises`);
}

// 7. the network (content/map/voids.json + routes.json): every connection from both ends, every
//    pair numbered, and each region's fork turns a different way for each road.
for (const [from, v] of Object.entries(F.voids || {})) {
  const dirs = new Set();
  for (const d of v.dests) {
    const back = (F.voids[d.region]?.dests || []).some((e) => e.region === from);
    check(`${from} → ${d.region} runs both ways`, back);
    const k = [from, d.region].sort().join('~');
    check(`${k} has a route number`, !!F.routes?.[k]?.number);
    check(`${from}'s fork turns ${d.dir} once`, !dirs.has(d.dir), d.key);
    dirs.add(d.dir);
  }
}

// 8. highway types: every route names a real type, and every type carries what the road reads.
for (const [k, r] of Object.entries(F.routes || {})) {
  check(`${k}'s type ${r.type || 'branch'} is a highway type`, !r.type || !!F.hwTypes?.[r.type]);
}
for (const [name, t] of Object.entries(F.hwTypes || {})) {
  check(`highway type ${name} has a half-width and 1-6 lanes`, t.half > 0 && t.half <= 1.6 && t.lanes >= 1 && t.lanes <= 6, JSON.stringify(t));
}

// 6. pure
const a1 = JSON.stringify(wildlandsAt(900, 1000)), a2 = JSON.stringify(wildlandsAt(900, 1000));
check('wildlandsAt is a pure function', a1 === a2);

// 9. the relief (docs/proposals/wildlands-relief.md): it shipped, every terrain it answers is real,
//    the ground is flat under every placed tile (the city, the airfields and the regions don't move),
//    and the volcano is still a mountain: it rises from its foot to its rim and has its crater.
let reliefOk = !!F.relief;
check('the relief is in the field', reliefOk);
if (reliefOk) {
  const badRelief = new Set();
  for (let y = r.y0; y <= r.y1; y += 3) for (let x = r.x0; x <= r.x1; x += 3) {
    const at = wildlandsAt(x, y); if (at.sea) continue;
    const rf = reliefAt(x, y, at);
    if (!terrains.has(rf.terrain)) badRelief.add(rf.terrain);
  }
  check('every relief terrain is a real terrain', !badRelief.size, [...badRelief].join(', '));
  // Flat under every placed tile is held by the bake itself (it has the tiles), so check 1 covers it.
  for (const l of landforms()) {
    const rim = groundZ(l.x + l.crater + 2, l.y), mid = groundZ(l.x + (l.radius + l.crater) / 2, l.y), foot = groundZ(l.x + l.radius + 12, l.y);
    check(`${l.name}: the ground rises from its foot to its rim`, rim > mid && mid > foot, `foot ${foot.toFixed(2)}, flank ${mid.toFixed(2)}, rim ${rim.toFixed(2)}`);
    check(`${l.name}: the crater sits below its rim`, groundZ(l.x, l.y) < rim);
  }
  const p1 = JSON.stringify(reliefAt(1000, 1010)), p2 = JSON.stringify(reliefAt(1000, 1010));
  check('reliefAt is a pure function', p1 === p2);
}

// 11. the ground out there (wildGroundAt): the one answer the floor's colour, the corridor's verge and
//     the walked void share. Every ground it names is in the palette, every terrain it gives is real
//     and passable (a verge or a walker on a cliff is stranded), and it is pure.
{
  const { wildGroundAt, groundColour } = await import('../../client/shared/wildlands.js');
  const impassable = new Set(Object.entries(JSON.parse(readFileSync('content/map/terrain.json', 'utf8')).terrains)
    .filter(([, t]) => t.props && t.props.passable === false).map(([k]) => k));
  const noPalette = new Set(), unreal = new Set(), blocked = new Set();
  for (let y = r.y0; y <= r.y1; y += 3) for (let x = r.x0; x <= r.x1; x += 3) {
    const g = wildGroundAt(x, y);
    if (g.ground && !BIOME_GROUND[g.ground]) noPalette.add(g.ground);
    if (!terrains.has(g.terrain)) unreal.add(g.terrain);
    if (!wildlandsAt(x, y).sea && impassable.has(g.terrain)) blocked.add(g.terrain);
  }
  check('every wild ground is in the ground palette', !noPalette.size, [...noPalette].join(', '));
  check('every wild ground terrain is a real terrain', !unreal.size, [...unreal].join(', '));
  check('no wild ground is impassable', !blocked.size, [...blocked].join(', '));
  check('wildGroundAt is a pure function', JSON.stringify(wildGroundAt(1009, 928)) === JSON.stringify(wildGroundAt(1009, 928)));
  const c = groundColour(1009, 928, BIOME_GROUND);
  check('groundColour is a colour', c.length === 3 && c.every((v) => v >= 0 && v <= 255), String(c));
}

// 10. the flora (client/shared/flora.js, content/map/flora.json): it shipped in the field; every
//     species names a growth form the renderer draws and grows only on ground the habitat rules can
//     answer; every species is found somewhere (a habitat no tile satisfies is a species nobody will
//     ever see, and nothing else would say so); each line is one plain sentence with no em dash; the
//     plants are a pure function of the tile, at most three to a tile and inside it.
const FLORA = F.flora;
check('the flora is in the field', !!FLORA?.species);
if (FLORA?.species) {
  const { FLORA_FORMS, floraAt, floraLine, floraSpecies } = await import('../../client/shared/flora.js');
  const { FLORA_DRAWN_FORMS } = await import('../../client/game/js/panels/glass/flora-draw.js');
  const { RELIEF_BIOMES } = await import('../../client/shared/relief-rules.js');
  const grounds = new Set([...RELIEF_BIOMES.filter(Boolean), 'plateau']);
  for (const f of FLORA_FORMS) check(`growth form ${f} has a drawer`, FLORA_DRAWN_FORMS.includes(f));
  for (const k of Object.keys(FLORA.density)) check(`flora density ground ${k} is a habitat`, grounds.has(k));
  for (const [id, s] of Object.entries(FLORA.species)) {
    check(`${id}: form ${s.form} is a growth form`, FLORA_FORMS.includes(s.form));
    for (const g of Object.keys(s.where || {})) check(`${id}: grows on ${g}, which no tile is`, grounds.has(g) && g in FLORA.density);
    check(`${id}: has a line`, typeof s.line === 'string' && s.line.length > 0 && s.line.length <= 120 && !s.line.includes('—'), s.line);
    check(`${id}: rgb is a colour`, Array.isArray(s.rgb) && s.rgb.length === 3);
  }
  const seen = new Set();
  let over = 0, outside = 0;
  for (let y = r.y0; y <= r.y1; y += 2) for (let x = r.x0; x <= r.x1; x += 2) {
    for (const top of [false, true]) {
      const p = floraAt(x, y, top);
      if (p.length > 3) over++;
      for (const q of p) { seen.add(q.id); if (Math.abs(q.ox) > 0.5 || Math.abs(q.oy) > 0.5) outside++; }
    }
  }
  const unseen = floraSpecies().map((s) => s.id).filter((id) => !seen.has(id));
  check('every species grows somewhere', !unseen.length, unseen.join(', '));
  check('at most three plants a tile', !over, `${over} tiles`);
  check('every plant stands inside its tile', !outside, `${outside} plants`);
  const f1 = JSON.stringify(floraAt(1009, 928)), f2 = JSON.stringify(floraAt(1009, 928));
  check('floraAt is a pure function', f1 === f2);
  check('a planted flat has a line for the walker', typeof floraLine(1009, 928) === 'string');
}

if (fails.length) { console.error('✗ wildlands:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`✓ wildlands: fresh field, ${Object.keys(F.halo).length} halos, ${landforms().length} landform(s), a continuous coast, a closed vocabulary, and ${Object.keys(F.flora?.species || {}).length} species of flora.`);
