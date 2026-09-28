// World Map — the whole surface world on one screen: the placed regions, the wildlands between
// them, and this week's numbered highways. A tablet app, and a `worldmap` verb that prints the same
// picture as text so it reaches the log at every Display Mode rung.
//
// The server sends only what it alone knows: the placed tiles (one character per tile, by biome)
// and the roads. The ground between the regions is drawn by the client from
// client/shared/wildlands.js, the same function that decides it for the flight floor, the highway
// and the walked void, so the map cannot disagree with the ground.
import { registerTabletApp } from '../tablet/registry.js';
import { getZone } from '../../server/engine/world.js';
import { powerAnchorOf } from '../../server/engine/environment.js';
import { listRegions, surfaceAt, isRoadCell } from '../flight/state.js';
import { biomeOf } from '../flight/biomes.js';
import { roadNetwork } from '../trucking/roadnet.js';
import { corridorPos, milesOf, trailFor } from '../trucking/corridor.js';
import { VOIDS, currentWindow } from '../voidwalking/index.js';
import { wildlandsAt, wildlandsRect, routeNumber, landforms } from '../../client/shared/wildlands.js';
import { concurrency, typeOf } from '../../client/shared/highways.js';

// Row characters. Biomes get letters in a fixed order; the three man-made marks get their own.
const BIOME_CHARS = ['water', 'docks', 'ruins', 'oldcoldwater', 'badlands', 'industrial', 'infra', 'freight', 'marquee',
  'citycore', 'parkland', 'park', 'forest', 'uptown', 'civic', 'airport', 'scrub', 'redrock', 'ash', 'hardpan', 'alkali',
  'cliff', 'plateau', 'basalt', 'deadwood', 'sinter', 'hotspring', 'asphalt', 'concrete', 'pier'];
const KEY = { R: 'road', B: 'building', A: 'airfield' };
BIOME_CHARS.forEach((b, i) => { KEY[String.fromCharCode(97 + i)] = b; });   // a, b, c …
const CHAR_OF = Object.fromEntries(Object.entries(KEY).map(([c, b]) => [b, c]));

function tileChar(z) {
  if (!z) return ' ';
  const f = z.flags || {};
  if (f.airfield_id && !(f.building_type || f.is_building)) return 'A';
  if (isRoadCell(z)) return 'R';
  if (f.building_type || f.is_building) return 'B';
  return CHAR_OF[biomeOf(z)] || CHAR_OF.badlands;
}

// The region display names, by id, for the road labels.
const regionName = (id) => listRegions().find((r) => r.id === id)?.name || id;
const destRegion = (from, key) => (VOIDS[from]?.dests || []).find((d) => d.key === key)?.region || null;

// Built once per (week, placed map); both are static between those.
let _cache = null, _cacheWeek = -1, _cacheRegions = null;
function worldPayload() {
  const regions = listRegions(), week = currentWindow();
  if (_cache && _cacheWeek === week && _cacheRegions === regions) return _cache;
  const regs = regions.map((r) => {
    const rows = [];
    for (let y = r.minY; y <= r.maxY; y++) {
      let row = '';
      for (let x = r.minX; x <= r.maxX; x++) row += tileChar(surfaceAt(x, y));
      rows.push(row.replace(/ +$/, ''));
    }
    return { id: r.id, name: r.name, minX: r.minX, minY: r.minY, maxX: r.maxX, maxY: r.maxY, rows };
  });
  const net = roadNetwork();
  // ── THE ROAD AS PIECES OF TARMAC, NOT AS JOURNEYS ──
  // A journey (Coldwater → Deadwater) is trunk + ramp + branch, and the trunk is shared with every
  // other road through that gate. The map draws each piece ONCE, at its own type, carrying every
  // route number that runs on it (the trunk out of Coldwater is 1/2/3).
  const numberOf = (rt) => { const b = destRegion(rt.voidKey, rt.destKey); return b ? routeNumber(rt.voidKey, b) : null; };
  const numbersOn = concurrency(net.routes, numberOf);
  const pieces = new Map();
  for (const rt of net.routes) {
    for (const g of rt.segments || []) {
      if (g.s0 == null) continue;
      // ⚠ A PIECE IS ITS SEED *AND* WHERE IT RUNS. Two spokes out of one gate share a seed name and
      // go to different interchanges, so the seed alone would draw one and drop the other. The same
      // stretch driven either way round is still one piece: the end points are keyed unordered.
      const a0 = corridorPos(rt, g.s0), a1 = corridorPos(rt, g.s0 + g.L);
      const ends = [`${Math.round(a0.x)},${Math.round(a0.y)}`, `${Math.round(a1.x)},${Math.round(a1.y)}`].sort().join('~');
      const id = `${g.seedKey}@${ends}`;
      if (pieces.has(id)) continue;
      const pts = [];
      for (let q = g.s0; q < g.s0 + g.L; q += 3) { const p = corridorPos(rt, q); pts.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10); }
      const e = corridorPos(rt, g.s0 + g.L); pts.push(Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10);
      pieces.set(id, { type: g.type, L: g.L, nums: g.nums?.length ? g.nums : numbersOn(g.seedKey), label: typeOf(g.type).label, shield: typeOf(g.type).shield, pts });
    }
  }
  const roads = net.routes.map((rt) => {
    const a = rt.voidKey, b = destRegion(rt.voidKey, rt.destKey);
    const pts = [];
    for (let s = 0; s <= rt.L; s += 3) { const p = corridorPos(rt, s); pts.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10); }
    const e = corridorPos(rt, rt.L); pts.push(Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10);
    return { num: b ? routeNumber(a, b) : null, a, b, aName: regionName(a), bName: b ? regionName(b) : null,
      miles: Math.round(milesOf(rt.L)), pts };
  });
  // The footpaths void walkers take: the trail runs beside each road (the same trail the walked
  // crossing is laid on), with its camps. Drawn far thinner than any road.
  const trails = [];
  for (const rt of net.routes) {
    const b = destRegion(rt.voidKey, rt.destKey); if (!b) continue;
    const t = trailFor(rt, [rt.voidKey, b].sort().join('|'), week);
    if (!t?.pts?.length) continue;
    const pts = [];
    for (let i = 0; i < t.pts.length; i++) pts.push(Math.round(t.pts[i].x * 10) / 10, Math.round(t.pts[i].y * 10) / 10);
    const camps = t.pts.filter((p) => p.wayside).map((p) => [Math.round(p.x), Math.round(p.y)]);
    trails.push({ pts, camps });
  }
  _cache = { rect: wildlandsRect(), regions: regs, key: KEY, roads, pieces: [...pieces.values()], trails, week };
  _cacheWeek = week; _cacheRegions = regions;
  return _cache;
}

// Where the player is on the world grid: their tile, a building's front door, or a void room.
function youOf(player) {
  const z = getZone(player.current_zone);
  const a = powerAnchorOf(z);
  if (a) return { x: a.x, y: a.y };
  if (z && z.grid_x != null && z.grid_y != null && z.flags?.void_crossing) return { x: z.grid_x, y: z.grid_y };
  return null;
}

function buildScreen(player) {
  return { view: 'worldmap', breadcrumb: [], ...worldPayload(), you: youOf(player) };
}

// ── the text rung ───────────────────────────────────────────────────────────
// A downsampled picture, one character per block of tiles, then the routes as a list. Region
// tiles print as the region's initial, roads as '=', the sea '~', a landform '^', wildlands '.'.
const COLS = 72;
export function textMap(player) {
  const p = worldPayload(), r = p.rect, W = r.x1 - r.x0 + 1, H = r.y1 - r.y0 + 1;
  const step = Math.ceil(W / COLS), rows = Math.ceil(H / (step * 2));   // characters are about twice as tall as wide
  const initial = new Map();
  for (const reg of p.regions) {
    const ch = reg.name.replace(/^The /, '')[0].toUpperCase();
    for (let y = reg.minY; y <= reg.maxY; y++) for (let x = reg.minX; x <= reg.maxX; x++) initial.set(`${x},${y}`, ch);
  }
  const onRoad = new Set();
  for (const rd of p.roads) for (let i = 0; i < rd.pts.length; i += 2) {
    onRoad.add(`${Math.floor((rd.pts[i] - r.x0) / step)},${Math.floor((rd.pts[i + 1] - r.y0) / (step * 2))}`);
  }
  const you = youOf(player);
  const youCell = you ? `${Math.floor((you.x - r.x0) / step)},${Math.floor((you.y - r.y0) / (step * 2))}` : null;
  const out = [];
  for (let j = 0; j < rows; j++) {
    let line = '';
    for (let i = 0; i < Math.ceil(W / step); i++) {
      const x = r.x0 + i * step + (step >> 1), y = r.y0 + j * step * 2 + step, k = `${i},${j}`;
      if (k === youCell) { line += '@'; continue; }
      const reg = initial.get(`${x},${y}`);
      if (reg) { line += reg; continue; }
      if (onRoad.has(k)) { line += '='; continue; }
      const at = wildlandsAt(x, y);
      line += at.sea ? '~' : at.landform ? '^' : '.';
    }
    out.push(line.replace(/\.+$/, ''));
  }
  // Open sea above the coast says nothing after the first couple of rows.
  while (out.length > 2 && /^~*$/.test(out[0]) && /^~*$/.test(out[2])) out.shift();
  const routes = p.roads.filter((rd) => rd.num).sort((a, b) => Number(a.num) - Number(b.num))
    .map((rd) => `  Route ${rd.num.padEnd(2)} ${rd.aName} – ${rd.bName}, ${rd.miles} miles`);
  const lf = landforms().map((l) => `  ^ ${l.name}`);
  return { art: out, routes, landforms: lf };
}

async function cmdWorldmap(args, raw, player) {
  const t = textMap(player);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return {
    type: 'system',
    message: `<span class="system">━━ WORLD MAP ━━</span>\n<pre class="ascii-map">${esc(t.art.join('\n'))}</pre>`
      + `<span class="text-bright">Highways</span>\n${t.routes.join('\n')}\n`
      + (t.landforms.length ? `<span class="text-bright">Landmarks</span>\n${t.landforms.join('\n')}\n` : '')
      + `<span class="hint">@ you  ~ sea  = highway  ^ volcano  letters: regions. Open the World Map app on your tablet for the full picture.</span>`,
  };
}

registerTabletApp({
  id: 'worldmap', name: 'World Map', icon: '◈', category: 'General',
  verbs: ['worldmap'],
  buildScreen,
});

export const commands = { worldmap: cmdWorldmap };
export const _test = { worldPayload, textMap, KEY };
