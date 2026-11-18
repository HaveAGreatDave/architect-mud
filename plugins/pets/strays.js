// STRAYS: street cats with no home, a batch at a time, that a player can take in with `adopt`.
//
// A stray is a row in `stray_cats` and an NPC that lives in RAM only (no npcs row, so a content deploy never sees it).
// Boot builds the NPC from the row. On the street it's an ordinary animal NPC that stays put; `pet` and `look` work on
// it as on any NPC. Adopted, it moves to the adopter's flat, takes that as its home and joins PETS, so from then on
// it's a pet like any other: drawn in ROOM, its day said, greeting at the door.
//
// Where a batch lands: Coldwater's walkable outdoor tiles, weighted to the east, and the slum most of all, where people
// feed them.
//
// THEIR DAY ON THE STREET: every 5 s, for a stray on a tile somebody's on, one line now and then (about every couple of
// minutes per cat, from its id and the clock): lounging, grooming, stalking or catching a bird, drinking from a puddle
// (when it's raining, a fresh one), sleeping in a doorway, and in the slum and the poor quarters, being fed scraps by
// whoever lives there (a named NPC on the tile when there is one).
//
// The dev panel's Strays tab (panel.js) lists every cat and rolls a new batch with POST /strays/generate.
import { query } from '../../server/models/db.js';
import { world, getZoneNpcs, getZonePlayers } from '../../server/engine/world.js';
import { getBirdClock, getWeatherTypeAtGrid } from '../../server/engine/environment.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { BREEDS, PATTERNS, COLOURS } from '../../client/game/js/panels/gl/cat-breeds.js';

export const BATCH = 12;
export const MAX_CATS = 3;            // a player can take in this many strays
const NPC_PREFIX = 'npc_stray_';
const npcIdOf = (id) => NPC_PREFIX + id;

// filled in by index.js so an adopted cat joins the pets
let PETS = null, BY_NPC = null;
export function bindPets(pets, byNpc) { PETS = pets; BY_NPC = byNpc; }

const STRAYS = new Map();             // stray id → row

// ── rolling a cat ─────────────────────────────────────────────────────────────────────────────────
const NAMES = ['Biscuit', 'Smudge', 'Pickle', 'Tinker', 'Mouse', 'Bramble', 'Sprocket', 'Rust', 'Socks', 'Patch', 'Gravy',
  'Mittens', 'Pepper', 'Boots', 'Crumb', 'Toast', 'Nibs', 'Soot', 'Marmalade', 'Wren', 'Tuppence', 'Fudge', 'Bolt',
  'Dusty', 'Muffin', 'Ash', 'Jinx', 'Rivet', 'Noodle', 'Olive', 'Treacle', 'Stumpy', 'Bean', 'Moth', 'Grub', 'Pilot',
  'Clem', 'Hobnob', 'Lump', 'Fig', 'Chip', 'Sardine', 'Pudding', 'Skipper', 'Tatters', 'Dot', 'Ratchet', 'Cinder'];
// plain coats: [coat.base, word]
const SOLIDS = [['#1c1a1f', 'black'], ['#b8692c', 'ginger'], ['#6e7078', 'grey'], ['#e8e2d8', 'white'], ['#5a4030', 'brown'], ['#d9b48a', 'cream']];
const MIXED = { tortie: 'tortoiseshell', blue_cream: 'blue-cream', calico: 'calico', dilute_calico: 'pale calico', seal_point: 'seal-point', blue_point: 'blue-point' };
const PATTERN_WORD = { solid: '', locket: 'with a white spot on the chest', mitted: 'with white paws', tuxedo: 'with a white bib and paws', bicolour: 'and white', harlequin: 'with a few patches on white', van: 'with colour only on the head and tail' };
const BUILD_WORD = ['thin', 'scrawny', 'small', 'rangy', 'big', 'scruffy', 'lean', 'stocky'];
const STATE = ['One ear is torn at the tip.', 'Its coat is matted down one side.', 'It watches you from a safe distance.', 'It has a kink at the end of its tail.',
  'It looks like it has been eating well from somebody\'s bins.', 'There is a healed scratch across its nose.', 'Its whiskers are singed short on one side.', 'It keeps itself very clean for a street cat.'];

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];

export function rollCat(r, taken = new Set()) {
  const breeds = Object.keys(BREEDS);
  // mostly moggies
  const breed = r() < 0.65 ? 'domestic' : pick(r, breeds);
  let sex = r() < 0.5 ? 'male' : 'female', coat, colourWord;
  if (r() < 0.25) {
    const c = pick(r, Object.keys(MIXED));
    if (c.includes('tortie') || c.includes('calico') || c === 'blue_cream') sex = 'female';
    coat = { colour: c }; colourWord = MIXED[c];
  } else {
    const [base, word] = pick(r, SOLIDS);
    const pattern = pick(r, Object.keys(PATTERNS));
    coat = { base, pattern }; colourWord = [word, PATTERN_WORD[pattern] || ''].filter(Boolean).join(' ');
  }
  const free = NAMES.filter((n) => !taken.has(n));
  const name = pick(r, free.length ? free : NAMES);
  const personality = { outgoing: +r().toFixed(2), friendly: +r().toFixed(2), skittish: +r().toFixed(2), dominant: +r().toFixed(2), impulsive: +r().toFixed(2) };
  const build = { length: +(0.9 + r() * 0.15).toFixed(2), belly: +(0.8 + r() * 0.5).toFixed(2), head: +(0.95 + r() * 0.12).toFixed(2) };
  const he = sex === 'female' ? 'She' : 'He';
  const breedWord = breed === 'domestic' ? 'street cat' : `${BREEDS[breed].name} gone feral`;
  const description = `A ${pick(r, BUILD_WORD)} ${colourWord} ${breedWord}. ${pick(r, STATE).replace(/^It /, `${he} `).replace(/^Its /, sex === 'female' ? 'Her ' : 'His ')} No collar. Somebody could take ${sex === 'female' ? 'her' : 'him'} home.`;
  return { name, sex, description, look: { breed, coat, build }, personality };
}

// ── where they go ─────────────────────────────────────────────────────────────────────────────────
const STREET = new Set(['road', 'park', 'concrete', 'asphalt', 'dirt', 'grass', 'dirt_road', 'gravel', undefined, '']);
const NOT_CITY = new Set(['wasteland', 'wilds', 'water']);
// where people put food out: the slum most, then the other poor quarters
const FED_BY = { slum: 6, yards: 2, docks: 1.5, residential: 1.5, industrial: 1.3 };
/** Coldwater's outdoor street tiles, each with its weight (more to the east). */
export function streetTiles() {
  const out = [];
  for (const z of world.zones.values()) {
    const f = z.flags || {};
    if (f.region_id !== 'region_coldwater' || f.is_building || z.parent_zone || (z.grid_z ?? 0) !== 0) continue;
    if (z.grid_x == null || z.grid_x < 880 || !f.district || NOT_CITY.has(f.district) || !STREET.has(f.terrain)) continue;
    out.push(z);
  }
  if (!out.length) return out;
  let lo = Infinity, hi = -Infinity;
  for (const z of out) { lo = Math.min(lo, z.grid_x); hi = Math.max(hi, z.grid_x); }
  for (const z of out) { const t = (z.grid_x - lo) / Math.max(1, hi - lo); z._strayW = (0.08 + t * t * 2) * (FED_BY[z.flags.district] || 1); }
  return out;
}
function pickTile(r, tiles, used) {
  const pool = tiles.filter((z) => !used.has(z.id));
  const total = pool.reduce((a, z) => a + z._strayW, 0);
  let x = r() * total;
  for (const z of pool) { x -= z._strayW; if (x <= 0) return z; }
  return pool[pool.length - 1];
}

// ── the NPC ───────────────────────────────────────────────────────────────────────────────────────
function npcOf(row) {
  const adopted = !!row.adopted_by;
  const zone = adopted ? row.home_zone : row.zone_id;
  return {
    id: npcIdOf(row.id), name: row.name, description: row.description, sex: row.sex, zone_id: null, home_zone: zone,
    faction: null, dialogue_tree: {}, vendor_inventory: [], wanders: 0, wander_zones: [], behaviour_graph: {}, banter: [],
    chitchat: adopted ? ['blinks at you, slowly.', 'rubs against your leg and walks off.'] : ['watches you from under a parked car.', 'sniffs at your boots.', 'flattens its ears at a noise down the street.'],
    flags: { animal: true, no_banter: true, no_attack: true, pet: row.id, stray: !adopted, ...(adopted ? { owner: row.adopted_by } : {}) },
    hp: 10, hp_max: 10, npc_type: 'npc', home_activities: [],
    _ai: { currentNode: null, waitUntil: null, patrolPath: [], patrolTarget: null, patrolMode: 'walk', patrolIndex: 0, alertCooldown: 0, lastSay: 0, flags: {} },
  };
}
function place(row) {
  const npc = npcOf(row), zoneId = npc.home_zone;
  const old = world.npcs.get(npc.id);
  if (old?.zone_id) world.zones.get(old.zone_id)?.npcs.delete(npc.id);
  world.npcs.set(npc.id, npc);
  if (zoneId && world.zones.has(zoneId)) { npc.zone_id = zoneId; world.zones.get(zoneId).npcs.add(npc.id); }
  if (row.adopted_by && PETS) {
    const p = { id: row.id, npcId: npc.id, species: 'cat', look: row.look || {}, personality: row.personality || {} };
    PETS.set(p.id, p); BY_NPC.set(p.npcId, p);
  }
  return npc;
}
function unplace(id) {
  const nid = npcIdOf(id), npc = world.npcs.get(nid);
  if (npc?.zone_id) world.zones.get(npc.zone_id)?.npcs.delete(nid);
  world.npcs.delete(nid);
  if (PETS) { PETS.delete(id); BY_NPC?.delete(nid); }
}

// ── their day on the street ────────────────────────────────────────────────────────────────────────
const LINES = {
  lounge: ['$name is stretched out on a warm bit of pavement, belly to the sky.', '$name is loafed on top of a bin, paws tucked under, eyes half shut.',
    '$name lies in a patch of sun by the wall and does not move for anything.', '$name is curled up asleep in a doorway.', '$name rolls in the dust, gets up and walks off like nothing happened.'],
  groom: ['$name sits on a step and washes $his face with one paw.', '$name stops in the middle of the street to lick $his back leg.', '$name scratches behind one ear with a hind foot, eyes shut.'],
  hunt: ['$name goes flat behind a crate, tail twitching, watching a pigeon.', '$name creeps along the gutter toward a sparrow, one paw at a time.',
    '$name chatters at a bird on the wire above, jaw going.', '$name makes a run at a pigeon and misses. $He sits down and washes, like $he meant to.'],
  catch: ['$name pounces and comes up with a sparrow in $his mouth. $He trots off with it somewhere private.', '$name gets a pigeon by the wing. There are a lot of feathers, and then a lot of eating.'],
  drink: ['$name crouches at a puddle and laps at it.', '$name drinks out of a dip in the road where the rain collected.', '$name drinks from a leak under a drainpipe.'],
  rain: ['$name drinks from a fresh puddle, ears back against the rain.', '$name sits under a parked car, dry, watching the rain.'],
  night: ['The eyes of $name catch the light from under a car.', '$name trots down the middle of the empty street, tail up.'],
  fed: ['$who comes out with a saucer of something and puts it down. $name is there before it touches the ground.', '$who tears off a bit of $their dinner and drops it for $name.',
    '$who crouches and tips a tin of fish onto the pavement. $name eats it, growling quietly the whole time.', '$who calls out "$name! Here, $name!" and $name trots over for scraps.'],
  fedAnon: ['Somebody has left a dish of scraps out by a door. $name works through it.', 'A window opens and a bit of fish lands on the pavement. $name gets it.',
    'Someone has put down a bowl of water and some rice. $name has the lot.'],
};
const FEEDS = new Set(['slum', 'yards', 'docks', 'residential', 'industrial']);
const hashStr = (str) => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return h >>> 0; };
const SLOT_MS = 5000, EVERY = 24;    // a line about every two minutes per cat
const pronouns = (n) => n.sex === 'female' ? { he: 'she', He: 'She', his: 'her' } : { he: 'he', He: 'He', his: 'his' };

/** What a stray says now, or null. Pure from the cat, the tile, the clock and the people there. */
export function streetLine(npc, zone, now, hour, raining, locals = []) {
  const slot = Math.floor(now / SLOT_MS), h = hashStr(npc.id + ':' + slot);
  if (h % EVERY) return null;
  const r = (h >>> 8) % 1000 / 1000, dark = hour < 6 || hour >= 21, fedHere = FEEDS.has(zone?.flags?.district);
  let kind;
  if (fedHere && r < (zone.flags.district === 'slum' ? 0.35 : 0.18) && !(dark && hour < 5)) kind = 'fed';
  else if (raining && r < 0.55) kind = 'rain';
  else if (dark && r < 0.6) kind = 'night';
  else kind = ['lounge', 'lounge', 'groom', 'hunt', 'hunt', 'drink', 'catch'][(h >>> 18) % 7];
  if (kind === 'catch' && (h >>> 22) % 3) kind = 'hunt';
  const P = pronouns(npc);
  let who = null;
  if (kind === 'fed') { who = locals.length ? locals[(h >>> 12) % locals.length] : null; if (!who) kind = 'fedAnon'; }
  const pool = LINES[kind], line = pool[(h >>> 4) % pool.length];
  const their = who ? (who.sex === 'female' ? 'her' : who.sex === 'male' ? 'his' : 'their') : '';
  return line.replace(/\$(\w+)/g, (_, k) => k === 'name' ? npc.name : k === 'who' ? who.name : k === 'their' ? their : P[k] ?? '');
}

function streetLife() {
  const now = Date.now(), hour = getBirdClock().hour % 24;
  for (const row of STRAYS.values()) {
    if (row.adopted_by) continue;
    const npc = world.npcs.get(npcIdOf(row.id)), zone = npc && world.zones.get(npc.zone_id);
    if (!zone || !getZonePlayers(zone.id).length) continue;
    let raining = false;
    try { raining = /rain|storm|drizzle|shower/i.test(String(getWeatherTypeAtGrid(zone.grid_x, zone.grid_y) || '')); } catch {}
    const locals = getZoneNpcs(zone.id).filter((n) => !n.flags?.animal && !n._dead && n.npc_type !== 'enemy');
    const line = streetLine(npc, zone, now, hour, raining, locals);
    if (line) sendToZone(zone.id, { type: 'zone_event', message: line });
  }
}
schedule('5s', streetLife);

// ── load, generate ────────────────────────────────────────────────────────────────────────────────
export async function loadStrays({ seedIfEmpty = true } = {}) {
  const { rows } = await query('SELECT * FROM stray_cats');
  for (const r of rows) { STRAYS.set(r.id, r); place(r); }
  if (!rows.length && seedIfEmpty) await generateStrays(BATCH);
  return STRAYS.size;
}

/** Roll `count` new strays onto the streets. One INSERT. */
export async function generateStrays(count = BATCH, seed = Date.now()) {
  const tiles = streetTiles();
  if (!tiles.length) return [];
  const r = rng(seed), used = new Set(), taken = new Set([...STRAYS.values()].filter((s) => !s.adopted_by).map((s) => s.name));
  const batch = 1 + Math.max(0, ...[...STRAYS.values()].map((s) => s.batch || 0));
  const made = [];
  for (let i = 0; i < Math.min(count, 50); i++) {
    const cat = rollCat(r, taken), z = pickTile(r, tiles, used);
    if (!z) break;
    taken.add(cat.name); used.add(z.id);
    made.push({ id: `stray_${seed.toString(36)}_${i}`, ...cat, zone_id: z.id, batch, spawned_at: Math.floor(Date.now() / 1000), adopted_by: null, adopted_at: null, home_zone: null });
  }
  if (!made.length) return made;
  await query(`INSERT INTO stray_cats (id, name, sex, description, look, personality, zone_id, batch, spawned_at)
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS t(id text, name text, sex text, description text, look jsonb, personality jsonb, zone_id text, batch int, spawned_at bigint)`, [JSON.stringify(made)]);
  for (const m of made) { STRAYS.set(m.id, m); place(m); }
  return made;
}

export async function removeStray(id) {
  if (!STRAYS.has(id)) return false;
  await query('DELETE FROM stray_cats WHERE id = $1', [id]);
  STRAYS.delete(id); unplace(id);
  return true;
}

// ── adopt ─────────────────────────────────────────────────────────────────────────────────────────
const strayHere = (zoneId, word) => {
  const cats = getZoneNpcs(zoneId).filter((n) => n.flags?.stray && STRAYS.has(n.flags.pet));
  if (!word) return cats.length === 1 ? cats[0] : cats.length ? 'many' : null;
  const w = word.toLowerCase().replace(/^the\s+/, '');
  return cats.find((n) => n.name.toLowerCase() === w) || cats.find((n) => n.name.toLowerCase().startsWith(w)) || (/^(cat|stray|kitten)$/.test(w) && cats.length === 1 ? cats[0] : null);
};

export async function cmdAdopt(args, raw, player) {
  const word = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();
  const npc = strayHere(player.current_zone, word);
  if (npc === 'many') return { type: 'error', message: 'Which one? Say its name.' };
  if (!npc) return { type: 'error', message: word ? `There's no stray called ${word} here.` : "There's no stray cat here to take in." };
  const row = STRAYS.get(npc.flags.pet);
  const mine = [...STRAYS.values()].filter((s) => s.adopted_by === player.id).length;
  if (mine >= MAX_CATS) return { type: 'error', message: `You've taken in ${MAX_CATS} already. That's enough cats.` };
  const { rows } = await query(`SELECT zone_id FROM apartments WHERE owner_id = $1 AND COALESCE(owner_type, 'player') = 'player' ORDER BY zone_id LIMIT 1`, [player.id]);
  const home = rows[0]?.zone_id;
  if (!home || !world.zones.has(home)) return { type: 'error', message: `You've got nowhere to keep ${npc.name}. Rent a flat first.` };
  const now = Math.floor(Date.now() / 1000);
  // claim it in one statement, so two people can't both take the same cat
  const { rows: got } = await query('UPDATE stray_cats SET adopted_by = $1, adopted_at = $2, home_zone = $3 WHERE id = $4 AND adopted_by IS NULL RETURNING id', [player.id, now, home, row.id]);
  if (!got.length) return { type: 'error', message: `Somebody's already taken ${npc.name}.` };
  Object.assign(row, { adopted_by: player.id, adopted_at: now, home_zone: home });
  const from = npc.zone_id;
  const he = npc.sex === 'female' ? 'she' : 'he', him = npc.sex === 'female' ? 'her' : 'him';
  place(row);
  if (from) sendToZone(from, { type: 'zone_event', message: `${player.handle} scoops up ${npc.name} and tucks ${him} under one arm.` }, player.id);
  const homeName = world.zones.get(home)?.name || 'your flat';
  return { type: 'output', message: `You crouch and hold out a hand. ${npc.name} thinks about it, then lets you pick ${him} up. You take ${him} back to ${homeName}, and ${he} goes straight under the furniture. Get ${him} a bowl and a tray.` };
}

// ── the dev panel ─────────────────────────────────────────────────────────────────────────────────
export async function census() {
  const ids = [...new Set([...STRAYS.values()].map((s) => s.adopted_by).filter(Boolean))];
  const owners = new Map();
  if (ids.length) { const { rows } = await query('SELECT id, handle FROM players WHERE id = ANY($1)', [ids]); for (const r of rows) owners.set(r.id, r.handle); }
  const cats = [...STRAYS.values()].map((s) => {
    const npc = world.npcs.get(npcIdOf(s.id)), z = world.zones.get(npc?.zone_id);
    return { id: s.id, name: s.name, sex: s.sex, breed: s.look?.breed, coat: s.look?.coat, batch: s.batch, spawned_at: s.spawned_at,
      adopted: !!s.adopted_by, owner: s.adopted_by ? owners.get(s.adopted_by) || s.adopted_by : null, adopted_at: s.adopted_at,
      zone_id: npc?.zone_id || null, zone: z?.name || null, x: z?.grid_x ?? null, y: z?.grid_y ?? null, district: z?.flags?.district || null, description: s.description };
  }).sort((a, b) => (a.adopted - b.adopted) || (b.batch - a.batch) || (b.x ?? 0) - (a.x ?? 0));
  const onStreet = cats.filter((c) => !c.adopted).length;
  return { cats, onStreet, adopted: cats.length - onStreet, batchSize: BATCH, tiles: streetTiles().length };
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/strays')) return null;
  if (!auth || !['dev', 'admin', 'builder', 'designer'].includes(auth.role)) return { status: 403, body: { error: 'Dev access required' } };
  try {
    if (path === '/strays' && method === 'GET') return { status: 200, body: await census() };
    if (path === '/strays/generate' && method === 'POST') {
      const n = Math.max(1, Math.min(50, Number(body?.count) || BATCH));
      const made = await generateStrays(n);
      return { status: 200, body: { made: made.length } };
    }
    const m = path.match(/^\/strays\/([\w-]+)$/);
    if (m && method === 'DELETE') return (await removeStray(m[1])) ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'No such stray' } };
  } catch (e) { return { status: 400, body: { error: e.message } }; }
  return null;
};

export const _strays = { streetLine, LINES, STRAYS, rollCat, streetTiles, generateStrays, removeStray, cmdAdopt, census, npcIdOf, place };
