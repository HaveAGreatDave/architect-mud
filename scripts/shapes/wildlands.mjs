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
//   6. it is a pure function: the same tile asked twice gives the same answer.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { BIOME_GROUND } from '../../client/shared/ground-palette.js';
import { wildlandsAt, wildlandsRect, landforms, landformHeight } from '../../client/shared/wildlands.js';
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

if (fails.length) { console.error('✗ wildlands:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`✓ wildlands: fresh field, ${Object.keys(F.halo).length} halos, ${landforms().length} landform(s), a continuous coast, and a closed vocabulary.`);
