/**
 * Graffiti — TAG the front of a building.
 *
 * The `graffiti` crime has sat in the registry (server/engine/crimes.js) since the
 * crime system was built, at 0.3 stars, charging nobody: there was no verb. This is
 * the verb.
 *
 * Three rules shape the whole thing, and they're worth stating before the code:
 *
 *  1. YOU SPRAY A BUILDING, NOT A TILE. `tag` will not fire on open ground. It
 *     finds the buildings on the four tiles around you (flags.is_building), any
 *     face of them, and refuses if there isn't one. That's the difference between
 *     graffiti and a text field: it lands on a thing that exists in the world and
 *     it says which thing.
 *  2. ONE PER WALL, AND ANYONE MAY PAINT OVER ANYONE. The cap isn't a limit, it's
 *     the design. The wall is a contested slot, so the interesting question is
 *     never "what shall I write" but "whose tag is up". It's also what makes the
 *     table a PRIMARY KEY instead of a rule somebody enforces: one row per
 *     (street tile, building) pair, which is one row per wall, upserted.
 *  3. IT COMES DOWN ON ITS OWN, EVENTUALLY. A tag ages out after TAG_LIFE_DAYS
 *     game days, derived from the game DATE (zone-filth.js gameDayIndex) rather
 *     than a counter or a tick, so it's stateless — a restart can't repaint the
 *     city, and there's no sweep to schedule.
 *
 * Storage discipline: RAM is authoritative. Every tag in the world is hydrated
 * once on first read and mutated in memory thereafter; this plugin is the only
 * writer of zone_graffiti, which is what makes that cache safe (CLAUDE.md's rule).
 * The DB write happens on the spray/scrub itself — a cold path, once per act —
 * and never on the room-description path, which runs on every single `look`.
 *
 * The text is player-authored and lands in another player's room description,
 * which is rendered as HTML. It is escaped ON THE WAY IN and stored escaped, so
 * there is exactly one place that can get it wrong and no way to double-handle it.
 *
 * PER-LETTER PAINT (`spraycan`) does not weaken any of that, because style is DATA,
 * NEVER MARKUP: the dialog sends colour and weight as a list of runs, validated
 * down to a #rrggbb and four bits in paint.js, and the text still arrives and is
 * stored escaped exactly as it always was. See paint.js for the model. Two verbs
 * for one act is deliberate — `tag` stays the thing you can type in a hurry with
 * one hand, `spraycan` is the can with the caps in the lid. (The verb is `spraycan`
 * and not `spray` because the flight plugin already owns `spray` — the Locust's
 * crop-duster boom. Plugins beat engine builtins but not each other, and the later
 * loader would simply have eaten it.)
 *
 * Removal lives in the cleaning plugin (`clean`), not here — one verb for "make
 * this room right" is better than two. Note the rule that falls out of it: `clean`
 * works bare-handed on floor filth, but paint on brick needs a real tool. You have
 * to own a mop to undo this, which is the teeth.
 */
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { getZone, zoneAtTile } from '../../server/engine/world.js';
import { allExits, exitTargets } from '../../server/engine/exits.js';
import { DIR_OFFSET, OPPOSITE } from '../../server/engine/directions.js';
import { gameDayIndex } from '../../server/engine/zone-filth.js';
import { gameToday } from '../../server/engine/apartments.js';
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import { normalizeRuns, coalesceRuns, renderStyled, decodePayload, safeFace, safeFinish, safeSpot } from './paint.js';
import { escapeHtml as esc } from '../../server/engine/html.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';

// One tag lives three game days. The clock is 1:1 by default (timeScale 1), so
// that's three real days — long enough that a tag is worth putting up, short
// enough that a dead corner of the map isn't carrying somebody's 2026 opinion
// forever. Painting over is the fast path; this is only the backstop.
export const TAG_LIFE_DAYS = 3;

// Long enough for a slogan, short enough that it reads as spray paint and not an
// essay. Deliberately measured BEFORE escaping, so the player counts what they typed.
export const TAG_MAX_LEN = 48;

// Paint is the gate, and the only one — no skill check, no stat. You have a can
// with paint left in it, you spray.
const CAN_TAG = 'spray_paint';

// A can holds this many CHARACTERS of paint, spent letter by letter across as
// many walls as they last for. Two and a half full-length tags, or a dozen short
// ones — which is the point: the can is a budget, so brevity is worth something
// and a mural costs you the rest of the street.
export const CAN_CAPACITY = 120;

// How many designs a player may keep. Small on purpose: a saved spray is a piece
// you're proud of, not a clipboard. The oldest is never auto-dropped — you're told
// the shelf is full and you pick what goes, because the alternative is silently
// eating the one somebody meant to keep.
export const SAVE_CAP = 12;

// --- The RAM authority ------------------------------------------------------

// streetZoneId -> Map<targetZoneId, { text, style, face, authorId, authorHandle, targetZoneId, targetName, dayIndex }>
//
// Two levels because a tag is keyed on the WALL, and a wall is the pair: the tile you stand on and
// the building you paint. An alley has a building on each side and each side carries its own tag.
// The outer key is still the tile you stand on, because that's the room a tag is read from, and
// the room line wants all of that room's walls in one Map lookup.
const tags = new Map();
let hydrated = null;      // the one-time load promise, memoized

// The one place a tag enters the map, so the index beside it can't be skipped. An interior tag's
// wall is the room itself, so a row with no target is keyed on its own tile.
function putTag(zoneId, entry) {
  const target = entry.targetZoneId || zoneId;
  indexTag(zoneId, target);
  let room = tags.get(zoneId);
  if (!room) { room = new Map(); tags.set(zoneId, room); }
  room.set(target, entry);
}

async function hydrate() {
  if (!hydrated) {
    hydrated = (async () => {
      try {
        const { rows } = await query(
          'SELECT zone_id, target_zone_id, target_name, author_id, author_handle, text, style, face, finish, spot, day_index FROM zone_graffiti'
        );
        for (const r of rows) {
          putTag(r.zone_id, {
            text: r.text, style: Array.isArray(r.style) ? r.style : null, face: safeFace(r.face), finish: safeFinish(r.finish), spot: safeSpot(r.spot),
            authorId: r.author_id, authorHandle: r.author_handle,
            targetZoneId: r.target_zone_id || r.zone_id, targetName: r.target_name, dayIndex: r.day_index,
          });
        }
      } catch { /* table absent in a bare test DB → nothing is tagged, which is fine */ }
    })();
  }
  return hydrated;
}

/**
 * Has this tag outlived TAG_LIFE_DAYS? Lazy expiry: asked on read, never ticked.
 * A tag with no day_index (or an unparseable game date) is treated as current
 * rather than expired — failing toward "it's still there" keeps a clock problem
 * from silently erasing the map.
 */
function expired(entry, today = gameToday()) {
  const now = gameDayIndex(today);
  if (now === null || entry?.dayIndex == null) return false;
  return now - entry.dayIndex >= TAG_LIFE_DAYS;
}

/**
 * The live tag on one wall: the building `targetZoneId` as seen from the tile `zoneId`
 * (for an interior, pass the room as both). Null when there isn't one. Sync and
 * query-free by contract, since the room-description path calls it. Returns null for
 * an expired tag without deleting it; the row is reaped on the next write or scrub,
 * and an orphan row is one row on a tile nobody has visited.
 */
export function tagOn(zoneId, targetZoneId, today = gameToday()) {
  const e = tags.get(zoneId)?.get(targetZoneId);
  if (!e || expired(e, today)) return null;
  return e;
}

/** Every live tag you can read from this tile, one per wall. Sync and query-free, like tagOn. */
export function tagsAt(zoneId, today = gameToday()) {
  const room = tags.get(zoneId);
  if (!room) return [];
  const out = [];
  for (const e of room.values()) if (!expired(e, today)) out.push(e);
  return out;
}

/** Remove the tag on one wall. Returns what was there, or null. */
export async function removeTag(zoneId, targetZoneId) {
  const room = tags.get(zoneId);
  if (!room?.has(targetZoneId)) return null;
  const had = tagOn(zoneId, targetZoneId);
  // ⚠ `byBuilding` IS DELIBERATELY NOT PRUNED HERE. It is a hint whose every entry is checked
  // back through `tagOn` before it is used, so a scrubbed wall drops out of the render on the
  // next snapshot with no second delete path to keep in step with this one.
  room.delete(targetZoneId);
  if (!room.size) tags.delete(zoneId);
  // The row goes even when the tag had already weathered off, which is the reaping tagOn promises.
  await query('DELETE FROM zone_graffiti WHERE zone_id=$1 AND target_zone_id=$2', [zoneId, targetZoneId]).catch(() => {});
  emit('graffiti.removed', { zoneId, targetZoneId });
  return had;
}

/** Remove every tag readable from this tile. Returns the live ones that were there. Used by `clean`. */
export async function removeTagsAt(zoneId) {
  const room = tags.get(zoneId);
  if (!room) return [];
  const had = tagsAt(zoneId);
  tags.delete(zoneId);
  await query('DELETE FROM zone_graffiti WHERE zone_id=$1', [zoneId]).catch(() => {});
  emit('graffiti.removed', { zoneId });
  return had;
}


// --- What the windshield paints ---------------------------------------------
//
// ⚠ A TAG HAS ALWAYS BEEN KEYED ON THE TILE THE PLAYER STOOD ON, AND THE RENDERER NEEDS THE TILE
// THE PAINT IS ON. Those are different zones — `target_zone_id` is the facade, `zone_id` is the
// pavement in front of it — and the flight window derives its cells building by building, so the
// question it asks is "what is on THIS wall", which the `tags` map cannot answer without a scan.
// A scan is out: `deriveSurfaceCell` runs for every cell of a ~73×73 window.
//
// ⚠ THE INDEX IS A HINT AND THE READ RE-VALIDATES, which is what makes it safe to keep a second
// copy of a relationship at all. `tags` has three writers and `_test` hands the map out whole, so
// an index maintained beside it can go stale; every id it yields is therefore checked back through
// `tagOn`, the one function that already owns expiry, and a stale entry drops out rather than
// painting a wall somebody scrubbed. Over-listing is harmless; wrong-listing is impossible.
const byBuilding = new Map();   // buildingZoneId -> Set<streetZoneId>

function indexTag(streetId, targetZoneId) {
  if (!targetZoneId) return;
  let s = byBuilding.get(targetZoneId);
  if (!s) { s = new Set(); byBuilding.set(targetZoneId, s); }
  s.add(streetId);
}

// The inverse of `esc`. The table stores text ESCAPED because it lands in a stranger's room
// description as HTML; a canvas takes the characters the player actually typed.
// ⚠ `&amp;` LAST, or "&amp;lt;" — which is what somebody typing "&lt;" gets stored as — decodes
// into a "<" that was never sprayed.
const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// At most this many tags on one building. A building tile has four walls and each carries one tag,
// so this is already the ceiling. It's here so that a corrupt index can never hand the renderer an
// unbounded list to bake textures from.
const WALL_TAGS_MAX = 4;

/**
 * `wall.tags` — what is sprayed on this building, for the flight window to paint.
 *
 * ⚠ SYNC AND QUERY-FREE BY CONTRACT, the same as `tagOn` and for a harder reason: this is called
 * from `deriveSurfaceCell`, which derives thousands of cells per snapshot. It is gated there on the
 * tile being a building, and it does one Map lookup for the tiles that are.
 *
 * ⚠ AND IT SPEAKS A NORMAL, NOT A COMPASS POINT. The renderer builds the tag's whole local frame by
 * handing `facePt` the wall's outward vector in place of the entrance's, so a direction is the one
 * thing it needs and a name would only have to be turned into one at the far end. It is derived
 * here because here is where both grid positions exist.
 */
// ⚠ `bx`/`by` ARE ARGUMENTS BECAUSE THE CALLER S CELL HAS NO GRID ON IT. The flight window looks
// tiles up through a coord index that stores `{ id, name, flags, danger }` and nothing else, so
// `zone.grid_x` is undefined there — and a normal derived from undefined is a wall that quietly
// never gets painted. The caller passes the coordinates it indexed by; the zone s own fields are
// the fallback for a caller holding a real row.
function wallTags(zone, gx, gy) {
  hydrate();
  const ids = zone && byBuilding.get(zone.id);
  if (!ids || !ids.size) return undefined;
  const bx = gx ?? zone.grid_x, by = gy ?? zone.grid_y;
  if (bx == null || by == null) return undefined;
  const out = [];
  for (const streetId of ids) {
    if (out.length >= WALL_TAGS_MAX) break;
    const t = tagOn(streetId, zone.id);
    if (!t) continue;                                   // scrubbed or weathered
    const s = getZone(streetId);
    if (!s || s.grid_x == null || s.grid_y == null) continue;
    const dx = s.grid_x - bx, dy = s.grid_y - by;
    // An interior tag is keyed on the room it is in, so it has no offset and no facade — and a
    // diagonal is not a thing the exit graph can produce. Either way there is no wall to paint.
    if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) continue;
    const len = Math.hypot(dx, dy);
    out.push({
      t: unesc(t.text).slice(0, TAG_MAX_LEN),
      r: Array.isArray(t.style) && t.style.length ? t.style : undefined,
      // The letterform the player picked, if they picked one. Absent, the renderer rolls one.
      f: t.face || undefined,
      x: t.finish || undefined,
      n: [dx / len, dy / len],
      // The variant only has to differ between two tags on one building, so that two walls of the
      // same word do not get the identical wobble. The street tile is already that.
      v: (String(streetId).split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) & 0xffff),
    });
  }
  return out.length ? out : undefined;
}

// --- Finding a wall ---------------------------------------------------------

const COMPASS = ['north', 'east', 'south', 'west'];

// Is this zone a real tile on the world map? Only there does a neighbour on the grid mean a wall
// you can walk up to. Every other map is a local frame (an apartment at (1,0), a flight deck at
// (0,-1)) and interiors sit at 0,0, so a grid test anywhere else would find walls that aren't there.
const onWorldGrid = (z) => z?.map_id === 'map_world' && z.grid_x != null && z.grid_y != null;

const buildingName = (b) => b.flags?.building_name || b.name;

// Which of the building's walls looks at you: 'front', 'side' or 'back'. `dir` is the way you
// face to see it, so the wall is the building's OPPOSITE[dir] side.
//
// The front is the entrance side (flags.entrance). A row without one falls back to the door: the
// wall with an exit through it between the two tiles is the front, and any other is a side,
// because with no entrance recorded there's nothing to say which wall is the back.
function sideOf(zone, bld, dir) {
  const wall = OPPOSITE[dir];
  const ent = bld.flags?.entrance;
  if (COMPASS.includes(ent)) return ent === wall ? 'front' : ent === dir ? 'back' : 'side';
  return exitTargets(bld, wall).includes(zone.id) || exitTargets(zone, dir).includes(bld.id) ? 'front' : 'side';
}

// The same answer for a tag already on a wall, where only the two zone ids are known. A wall
// reached through an exit rather than across the grid (a facade that isn't the tile next door)
// has always been the front, so that's what it stays.
function sideOfIds(zoneId, targetZoneId) {
  const z = getZone(zoneId), b = getZone(targetZoneId);
  if (!onWorldGrid(z) || !onWorldGrid(b)) return 'front';
  const dir = COMPASS.find(d => b.grid_x - z.grid_x === DIR_OFFSET[d][0] && b.grid_y - z.grid_y === DIR_OFFSET[d][1]);
  return dir ? sideOf(z, b, dir) : 'front';
}

// Every building wall you can reach from here, as [{ dir, id, name, side }]. This is the whole
// "you can't tag thin air" rule: no entries, no spraying.
//
// ⚠ THE WALLS ARE FOUND ON THE GRID, NOT THROUGH THE EXITS. A building tile has one exit, on its
// entrance side, so looking only through exits could only ever find a front, and the side of a
// building (a blank wall with nothing on it, which is where graffiti actually goes) was
// unreachable from the street running past it. The exits are still read afterwards so a facade
// that isn't the tile next door stays sprayable, as it always was.
function wallsNear(zone) {
  // Indoors there is no facade to stand in front of, and a back room with no wall
  // to tag was never the rule — it was a side effect of only ever looking OUTWARD.
  // So an interior offers its own wall, and nothing else changes: a tag has always
  // been keyed on the tile you are STANDING on, and the wall only ever named what
  // you put it on. Here those are the same zone, which is exactly what the room
  // line reads to word itself (describeTag).
  if (zone?.flags?.is_interior || zone?.flags?.is_apartment) {
    return [{ dir: 'wall', id: zone.id, name: zone.name || 'the wall', side: null }];
  }
  const out = [];
  const seen = new Set();
  // Standing on a building tile, the building next door shares a wall with this one, and nobody
  // can get a can into the gap between them.
  if (onWorldGrid(zone) && !zone.flags?.is_building) {
    for (const dir of COMPASS) {
      const [dx, dy] = DIR_OFFSET[dir];
      const t = zoneAtTile(zone.map_id, zone.grid_x + dx, zone.grid_y + dy, zone.grid_z ?? 0);
      if (!t?.flags?.is_building || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ dir, id: t.id, name: buildingName(t), side: sideOf(zone, t, dir) });
    }
  }
  for (const { dir, target } of allExits(zone)) {
    if (seen.has(target)) continue;
    const t = getZone(target);
    if (!t?.flags?.is_building) continue;
    seen.add(target);
    out.push({ dir, id: target, name: buildingName(t), side: 'front' });
  }
  return out;
}

// Match what the player typed against the walls to hand: a direction ("north"), a
// leading letter of one ("n"), any part of the building's name ("bodega"), or which
// wall of it ("side", "back"). Returns { wall } | { ambiguous } | {} so the caller can
// say something useful about each case rather than a flat "no".
function pickWall(walls, wordRaw) {
  const word = (wordRaw || '').toLowerCase();
  if (!word) return walls.length === 1 ? { wall: walls[0] } : {};
  const byDir = walls.filter(w => w.dir === word || w.dir[0] === word);
  if (byDir.length === 1) return { wall: byDir[0] };
  const byName = walls.filter(w => w.name.toLowerCase().includes(word));
  if (byName.length === 1) return { wall: byName[0] };
  const bySide = walls.filter(w => w.side && w.side === word);
  if (bySide.length === 1) return { wall: bySide[0] };
  if (byDir.length > 1 || byName.length > 1 || bySide.length > 1) return { ambiguous: [...new Set([...byDir, ...byName, ...bySide])] };
  return {};
}

// How a wall is named to the player. The front of a building is just the building, as it always
// was; any other wall says which one it is.
const wallLabel = (w) => (w.side === 'side' || w.side === 'back' ? `the ${w.side} of ${w.name}` : w.name);

const wallList = (walls) => walls.map(w => `<b>${esc(w.dir)}</b> (${esc(wallLabel(w))})`).join(', ');

// --- The verb ---------------------------------------------------------------

async function doTag(args, raw, player) {
  await hydrate();
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'output', message: `You're nowhere in particular.` };
  // `tag camera`: paint over a lens rather than a wall. Checked first, because a camera
  // is named by what it is and no wall answers to "camera".
  const camHint = cameraAsked(raw);
  if (camHint) return paintCamera(player, camHint);

  const walls = wallsNear(zone);
  if (!walls.length) {
    return { type: 'output', message: `Nothing round here but open ground. You need a wall.` };
  }

  // `tag` bare, or `tag north` with nothing to write: say what's sprayable and how.
  const words = String(raw || '').trim().split(/\s+/).slice(1);
  const picked = pickWall(walls, words[0]);
  const text = (picked.wall && words[0] ? words.slice(1) : words).join(' ').trim();

  if (picked.ambiguous) {
    return { type: 'output', message: `Which wall? ${wallList(picked.ambiguous)}` };
  }
  if (!picked.wall) {
    return { type: 'output', message: `Spray on what? ${wallList(walls)}\n<span class="text-dim">tag &lt;direction&gt; &lt;what to write&gt;, or <b>spraycan</b> for the colours</span>` };
  }
  // `tag north` with nothing to write, holding a can: that IS the request for the
  // can. Opening the dialog here rather than printing a usage line is the whole
  // discovery path — nobody reads a usage line and then goes looking for a second
  // verb. Without a can it falls through to the words, because the dialog would
  // only be able to tell you the same thing at the end.
  if (!text) {
    if (await carriedCan(player)) return doSpray(args, `spraycan ${picked.wall.dir}`, player);
    return { type: 'output', message: `Spray <i>what</i> on ${esc(wallLabel(picked.wall))}?\n<span class="text-dim">tag ${picked.wall.dir} &lt;what to write&gt;, or <b>spraycan ${picked.wall.dir}</b> for the colours</span>` };
  }
  if (text.length > TAG_MAX_LEN) {
    return { type: 'output', message: `That's a mural, not a tag. ${TAG_MAX_LEN} characters, tops: you're ${text.length - TAG_MAX_LEN} over.` };
  }

  const can = await carriedCan(player);
  if (!can) {
    return { type: 'output', message: `You've got nothing to spray with. Hardware shops sell paint.` };
  }
  if (text.length > can.paint) return { type: 'output', message: thinCan(can, text.length) };

  return withSignature(await applyTag(player, picked.wall, text, [], can));
}

// The tag signature (sfx-catalog.js 'spray-done') rides on the reply, so it sounds only when the
// tag went up: applyTag's success is its one reply with `refresh`. The spray session plays its own
// the moment the piece is finished, and says so with a trailing `q` on `sprayapply`.
const withSignature = (out) => (out?.refresh ? { ...out, cue: 'spray-done' } : out);

// The row write, shared by the player's hand and the world's. Kept in one place
// so the RAM map and the table can never disagree about what is on a wall.
async function persistTag(zoneId, entry) {
  entry.targetZoneId ||= zoneId;       // it's half the key, so it's never null in the table
  putTag(zoneId, entry);
  await query(
    `INSERT INTO zone_graffiti (zone_id, target_zone_id, target_name, author_id, author_handle, text, style, face, spot, day_index, finish)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (zone_id, target_zone_id) DO UPDATE SET
       target_name=EXCLUDED.target_name,
       author_id=EXCLUDED.author_id, author_handle=EXCLUDED.author_handle,
       text=EXCLUDED.text, style=EXCLUDED.style, face=EXCLUDED.face, spot=EXCLUDED.spot, day_index=EXCLUDED.day_index, finish=EXCLUDED.finish,
       created_at=EXTRACT(EPOCH FROM NOW())`,
    [zoneId, entry.targetZoneId, entry.targetName, entry.authorId, entry.authorHandle,
     entry.text, entry.style ? JSON.stringify(entry.style) : null, entry.face || null,
     entry.spot ? JSON.stringify(entry.spot) : null, entry.dayIndex, entry.finish || null]
  ).catch(() => {});
}

/**
 * A tag nobody in the game sprayed — the world's own hand. Used by the unrest sim
 * when a cell goes loud enough that somebody has been at the walls.
 *
 * ⚠ Deliberately NOT a route into `applyTag`: there is no player, so there is no
 * can to spend and no crime to charge, and `graffiti.tagged` must not fire — that
 * event is read by surveillance as "a person did this", and a witnessed crime with
 * no suspect is a wanted star nobody can be given.
 *
 * The result is an ordinary tag in every other respect, including the lazy
 * three-game-day expiry, which is why an incident that never gets torn down (a
 * process that died mid-staging) leaves a wall that simply weathers.
 *
 * It takes a bare wall when there is one, so the city's own paint doesn't go over
 * a player's while the wall beside it is empty. The returned entry's targetZoneId
 * says which wall, and is what a teardown hands back to removeTag.
 */
export async function tagFromWorld(zoneId, text, authorHandle = 'someone') {
  const zone = getZone(zoneId);
  if (!zone) return null;
  const walls = wallsNear(zone);
  const wall = walls.find(w => !tagOn(zoneId, w.id)) || walls[0] || { id: zoneId, name: zone.name || 'the wall' };
  const entry = {
    text: esc(String(text).slice(0, TAG_MAX_LEN)),
    style: null,
    face: null,
    spot: null,
    authorId: null,
    authorHandle,
    targetZoneId: wall.id,
    targetName: wall.name,
    dayIndex: gameDayIndex(gameToday()),
  };
  await persistTag(zoneId, entry);
  return entry;
}

/**
 * Put a tag up. The one write path — `tag` (typed) and `sprayapply` (the dialog)
 * both land here, so the crime, the can, the upsert and the "straight over
 * somebody's" line can never drift apart between the two ways in.
 *
 * `runs` is normalized against the length of what was TYPED, before escaping —
 * see paint.js for why that distinction is the whole ballgame. `face` is the
 * letterform picked in the can, or null to let the wall roll one. `spot` is where on a room's own
 * wall ROOM aimed it (paint.js safeSpot), kept only for a room's own wall: where paint goes on a
 * street facade is GLASS's to solve.
 */
async function applyTag(player, wall, text, runs, can, face = null, spot = null, finish = null) {
  const over = tagOn(player.current_zone, wall.id);
  const style = coalesceRuns(normalizeRuns(runs, text.length));
  const entry = {
    text: esc(text),
    style: style.length ? style : null,
    face: safeFace(face),
    finish: safeFinish(finish),
    spot: wall.id === player.current_zone ? safeSpot(spot) : null,
    authorId: player.id,
    authorHandle: player.handle,
    targetZoneId: wall.id,
    targetName: wall.name,
    dayIndex: gameDayIndex(gameToday()),
  };
  await persistTag(player.current_zone, entry);

  const left = await spendCan(can, text.length);
  const unlocked = await countTag(player);

  // The crime. Charged through the ordinary witness gate in surveillance, which
  // means a lens rolls for it and a cop on the corner is a different matter —
  // nothing here decides whether you got away with it.
  emit('graffiti.tagged', { player, zoneId: player.current_zone, targetZoneId: wall.id });

  let msg = `You shake the can and put it up on ${wall.id === player.current_zone ? 'the wall' : esc(wallLabel(wall))}: ${paintedText(entry)}`;
  if (over) {
    msg += over.authorId === player.id
      ? `\n<span class="text-dim">Straight over your own last one. Nobody will ever know.</span>`
      : `\n<span class="text-dim">Straight over ${esc(over.authorHandle || 'somebody')}'s. That's how it works.</span>`;
  }
  msg += left > 0
    ? `\n<span class="text-dim">The can rattles. Paint for about ${left} more characters.</span>`
    : (can.quantity > 1
        ? `\n<span class="text-dim">The can hisses empty on the last letter. You drop it and crack the next one: ${can.quantity - 1} left.</span>`
        : `\n<span class="text-dim">The can hisses empty on the last letter. That was the last of it.</span>`);
  if (unlocked) msg += `\n<span class="msg-system">${esc(FINISH_EARNED_LINE[unlocked])}</span>`;
  return { type: 'output', message: msg, refresh: true };
}

// --- The special finishes ---------------------------------------------------
//
// A finish (TAG_FINISHES: chrome, gold, holo, glow, neon) is laid over a piece's colours by the
// renderer. A player may spray one if they carry a can of it (an item tagged `paint_finish`, which
// is also the can the paint comes out of) or have EARNED it by putting tags up: the count is
// `graffiti_tags` in player_flags, one write per tag on the spray's own cold path, and crossing a
// line in FINISH_EARNED sets `graffiti_finish_<x>`. Gold is earned only: no can of it exists.
const FINISH_EARNED = [[25, 'holo'], [50, 'chrome'], [100, 'gold']];
const FINISH_EARNED_LINE = {
  holo: 'Twenty-five walls. You can mix holo now: the colours slide when somebody walks past.',
  chrome: 'Fifty walls. You know how to lay chrome now, mirror-bright, from any can.',
  gold: 'A hundred walls. Gold leaf from a spraycan. Nobody else round here can do that.',
};
async function countTag(player) {
  const n = (Number(await getFlag('player', 'graffiti_tags', player)) || 0) + 1;
  await setFlag('player', 'graffiti_tags', n, player);
  const hit = FINISH_EARNED.find(([at]) => at === n);
  if (!hit) return null;
  await setFlag('player', `graffiti_finish_${hit[1]}`, 'true', player);
  return hit[1];
}
async function earnedFinishes(player) {
  const out = [];
  for (const [, x] of FINISH_EARNED) if (await getFlag('player', `graffiti_finish_${x}`, player)) out.push(x);
  return out;
}
// Every finish this player can use now: the ones they've earned and the cans they carry.
async function finishesFor(player, cans) {
  const set = new Set(await earnedFinishes(player));
  for (const c of cans) if (c.finish) set.add(c.finish);
  return [...set];
}

// --- Painting over a camera -------------------------------------------------
//
// `tag camera` (or `tag <camera name>`, or `spraycan camera`) puts a blast of paint
// over a security camera's lens, and the camera stops seeing: it can't witness a
// crime, its feed shows paint, and it records nothing. The camera rows belong to the
// surveillance plugin, which is the only writer of security_devices, so the paint
// itself goes on through its `paintLens` and comes off through its `cleanLens` (the
// cleaning plugin's `clean`). This half is the verb and the can.
//
// It's quick, not free. The crime is vandalism, charged before the paint lands, and
// the lens you're painting gets its own good look at you raising the can.

// Any of these words in the command means a camera, not a wall.
const CAM_WORDS = new Set(['camera', 'cameras', 'cam', 'cams', 'cctv', 'lens']);

// A lens takes this many characters' worth of paint off the can.
export const LENS_PAINT = 6;

// The words after the verb when they ask for a camera, else null.
function cameraAsked(raw) {
  const words = String(raw || '').trim().split(/\s+/).slice(1).filter(Boolean);
  return words.some(w => CAM_WORDS.has(w.toLowerCase())) ? words.join(' ') : null;
}

// Imported when asked for, not at load: surveillance is a large plugin with its own
// imports, and graffiti is imported by the cleaning and unrest plugins.
const surveillance = () => import('../surveillance/index.js').catch(() => null);

// Which camera the player means. A bare "camera" picks among the ones in plain
// sight. A name is matched by SIFT over those first, and only then over cameras
// somebody has hidden, so the answer never lists a hidden one you didn't name.
function pickCamera(hint, cams) {
  const generic = hint.toLowerCase().split(/\s+/).every(w => CAM_WORDS.has(w));
  const seen = cams.filter(c => !c.concealed);
  if (generic) {
    const clean = seen.filter(c => !c.painted);
    if (clean.length === 1 || (!clean.length && seen.length === 1)) return { cam: clean[0] || seen[0] };
    if (clean.length > 1) return { ambiguous: clean };
    return seen.length ? { cam: seen[0] } : {};
  }
  for (const pool of [seen, cams.filter(c => c.concealed)]) {
    const r = siftResolve(hint, pool);
    if (r.type === 'match') return { cam: r.candidate };
    if (r.type === 'ambiguous') return { ambiguous: r.candidates };
  }
  return {};
}

async function paintCamera(player, hint) {
  const surv = await surveillance();
  const cams = surv?.camerasHere ? (await surv.camerasHere(player.current_zone)).filter(c => !c.damaged) : [];
  const picked = pickCamera(hint, cams);
  if (picked.ambiguous) {
    return { type: 'output', message: `Which camera? ${picked.ambiguous.map(c => `<b>${esc(c.name)}</b>`).join(', ')}` };
  }
  const cam = picked.cam;
  if (!cam) return { type: 'output', message: `You can't see a camera here to paint.` };
  if (cam.painted) {
    return { type: 'output', message: `The ${esc(cam.name)} already has paint on its lens.${cam.paintedBy ? ` <span class="text-dim">${esc(cam.paintedBy)} got there first.</span>` : ''}` };
  }

  const can = await carriedCan(player);
  if (!can) return { type: 'output', message: `You've got nothing to spray with. Hardware shops sell paint.` };
  if (can.paint < LENS_PAINT) return { type: 'output', message: thinCan(can, LENS_PAINT) };

  const res = await surv.paintLens(player, cam.id);
  if (res?.already) return { type: 'output', message: `The ${esc(cam.name)} already has paint on its lens.` };
  if (!res?.ok) return { type: 'output', message: `You can't see a camera here to paint.` };
  const left = await spendCan(can, LENS_PAINT);

  let msg = `You reach up and give the ${esc(res.name)} a long blast over the lens. All it can see now is paint.`;
  if (res.caught) msg += `\n<span class="text-dim">It got a good look at you on the way up.</span>`;
  msg += left > 0
    ? `\n<span class="text-dim">The can rattles. Paint for about ${left} more characters.</span>`
    : (can.quantity > 1
        ? `\n<span class="text-dim">The can hisses empty on the lens. You crack the next one: ${can.quantity - 1} left.</span>`
        : `\n<span class="text-dim">The can hisses empty on the lens. That was the last of it.</span>`);
  return { type: 'output', message: msg, refresh: true, cue: 'spray-fill' };
}

// --- The can with the caps in the lid ---------------------------------------

/**
 * `spraycan [wall]` — the same act as `tag`, done properly. Hands the client a
 * dialog: the text, a colour wheel per letter, bold/italic/underline/strike, and
 * the player's own shelf of saved designs.
 *
 * Everything the dialog can do is checked again on the way back in (`sprayapply`),
 * because the client decides nothing: it picks the wall, the words and the paint,
 * and the server still asks whether there's a wall there and a can in your hand.
 */
async function doSpray(args, raw, player) {
  await hydrate();
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'output', message: `You're nowhere in particular.` };
  // A lens takes no lettering, so `spraycan camera` skips the dialog and paints it.
  const camHint = cameraAsked(raw);
  if (camHint) return paintCamera(player, camHint);

  const walls = wallsNear(zone);
  if (!walls.length) return { type: 'output', message: `Nothing round here but open ground. You need a wall.` };

  const cans = await carriedCans(player);
  const can = plainCan(cans);
  if (!can) return { type: 'output', message: `You've got nothing to spray with. Hardware shops sell paint.` };
  const finishes = await finishesFor(player, cans);

  const words = String(raw || '').trim().split(/\s+/).slice(1);
  const picked = pickWall(walls, words[0]);

  return {
    type: 'spray_editor',
    // `over` is per wall because the tag is: the dialog says whose paint is under the wall
    // you've picked, and changes its mind when you pick another.
    walls: walls.map((w) => {
      const up = tagOn(zone.id, w.id);
      return { dir: w.dir, name: w.name, side: w.side, over: up ? (up.authorHandle || 'somebody') : null };
    }),
    wall: picked.wall ? picked.wall.dir : (walls.length === 1 ? walls[0].dir : null),
    saved: await savedSprays(player.id),
    // What the can can actually do, which is the tag limit until the paint runs
    // lower than it. The client only draws the counter — doSprayApply checks both
    // again on the way back in.
    maxLen: Math.min(TAG_MAX_LEN, can.paint),
    saveCap: SAVE_CAP,
    // `label` is the can item's `can_label` tag: what's printed on the 3-D can (spray-can-3d.js)
    can: { name: can.name, quantity: can.quantity ?? 1, paint: can.paint, label: can.label || null },
    // The special finishes on offer (TAG_FINISHES), and the cans that carry them, so the dialog can
    // show which can each comes out of. Checked again on sprayapply.
    finishes,
    finishCans: cans.filter((c) => c.finish).map((c) => ({ finish: c.finish, name: c.name, paint: c.paint, label: c.label || null })),
    message: `<span class="msg-system">You pop the lid. Caps rattle around inside it.</span>`,
  };
}

/**
 * `sprayapply <wall> <base64 payload>` — the dialog's SPRAY IT. Client transport
 * only; nobody types this. Silent, so a base64 blob never lands in the log.
 */
async function doSprayApply(args, raw, player) {
  await hydrate();
  const zone = getZone(player.current_zone);
  const walls = zone ? wallsNear(zone) : [];
  if (!walls.length) return { type: 'output', message: `Nothing round here but open ground. You need a wall.` };

  const parts = String(raw || '').trim().split(/\s+/);
  const picked = pickWall(walls, parts[1]);
  const wall = picked.wall || (walls.length === 1 ? walls[0] : null);
  if (!wall) return { type: 'output', message: `Which wall? ${wallList(walls)}` };

  const payload = decodePayload(parts[2]);
  if (!payload) return { type: 'output', message: `The can spits and nothing comes out. Try that again.` };
  if (payload.text.length > TAG_MAX_LEN) {
    return { type: 'output', message: `That's a mural, not a tag. ${TAG_MAX_LEN} characters, tops.` };
  }

  const cans = await carriedCans(player);
  if (!cans.length) return { type: 'output', message: `You've got nothing to spray with. Hardware shops sell paint.` };
  // A finish comes out of its own can unless the player has earned it, when any can will do.
  let can = plainCan(cans);
  if (payload.finish) {
    const own = cans.find((c) => c.finish === payload.finish);
    const earned = (await earnedFinishes(player)).includes(payload.finish);
    if (!own && !earned) return { type: 'output', message: `You haven't got anything that sprays ${payload.finish}.` };
    if (own && !earned) can = own;
  }
  if (payload.text.length > can.paint) return { type: 'output', message: thinCan(can, payload.text.length) };

  const out = await applyTag(player, wall, payload.text, payload.runs, can, payload.face, payload.spot, payload.finish);
  return parts[3] === 'q' ? out : withSignature(out);
}

// --- The shelf of saved designs ---------------------------------------------

async function savedSprays(playerId) {
  const { rows } = await query(
    'SELECT id, name, text, style, face, finish FROM player_sprays WHERE player_id=$1 ORDER BY id',
    [playerId]
  ).catch(() => ({ rows: [] }));
  // Sent back to the dialog, which is the thing that ESCAPES it for display. The
  // wall stores escaped text; the shelf stores what you typed, because it goes
  // back into a text field. Nothing here is ever inserted into a room description
  // without going through applyTag's esc first.
  return rows.map(r => ({ id: r.id, name: r.name, text: r.text, style: Array.isArray(r.style) ? r.style : [], face: safeFace(r.face), finish: safeFinish(r.finish) }));
}

/** The dialog's SAVE. Client transport only. Answers with the whole fresh shelf. */
async function doSpraySave(args, raw, player) {
  const payload = decodePayload(String(raw || '').trim().split(/\s+/)[1]);
  if (!payload) return { type: 'output', message: `Nothing to save.` };

  const { rows } = await query('SELECT COUNT(*)::int AS n FROM player_sprays WHERE player_id=$1', [player.id])
    .catch(() => ({ rows: [{ n: 0 }] }));
  if ((rows[0]?.n ?? 0) >= SAVE_CAP) {
    return { type: 'spray_shelf', saved: await savedSprays(player.id), error: `The shelf holds ${SAVE_CAP}. Bin one first.` };
  }

  const text = payload.text.slice(0, TAG_MAX_LEN);
  const style = coalesceRuns(normalizeRuns(payload.runs, text.length));
  await query(
    'INSERT INTO player_sprays (player_id, name, text, style, face, finish) VALUES ($1,$2,$3,$4,$5,$6)',
    [player.id, payload.name || text.slice(0, 24), text, style.length ? JSON.stringify(style) : null, payload.face, payload.finish]
  ).catch(() => {});
  return { type: 'spray_shelf', saved: await savedSprays(player.id), note: 'Saved.' };
}

/** The dialog's bin. Client transport only. Scoped by player_id — you can only bin your own. */
async function doSprayDelete(args, raw, player) {
  const id = parseInt(String(raw || '').trim().split(/\s+/)[1], 10);
  if (Number.isFinite(id)) {
    await query('DELETE FROM player_sprays WHERE id=$1 AND player_id=$2', [id, player.id]).catch(() => {});
  }
  return { type: 'spray_shelf', saved: await savedSprays(player.id) };
}

// --- Paint ------------------------------------------------------------------

// Every can on the player, one row each, with its special finish if it has one (`paint_finish`).
async function carriedCans(player) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity, pi.custom_data, i.name, i.tags->'can_label' AS label, i.tags->>'paint_finish' AS finish
       FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags, $2)`,
    [player.id, CAN_TAG]
  );
  return rows.map((row) => {
    const paint = Number(row.custom_data?.paint);
    return { ...row, finish: safeFinish(row.finish), paint: Number.isFinite(paint) ? Math.max(0, paint) : CAN_CAPACITY };
  });
}
// The can ordinary paint comes out of: a plain one if there is one, so a finish can isn't spent
// on a tag that didn't ask for its finish.
const plainCan = (cans) => cans.find((c) => !c.finish) || cans[0] || null;
async function carriedCan(player) { return plainCan(await carriedCans(player)); }

// Paint is spent by the LETTER, not by the tag — a can holds CAN_CAPACITY
// characters and a three-word throw-up costs what it costs. The remainder lives
// on the inventory row's custom_data, which is what makes a half-used can a real
// object: it can be dropped, traded and picked up again still half empty.
//
// A stack shares one row, so the remainder always describes the can currently in
// hand: when it runs dry the row loses a unit and the NEXT can starts full.
// Refused before anything is written, so a tag never goes up half-painted.
function thinCan(can, cost) {
  return can.paint <= 0
    ? `You shake the can and get nothing but the ball bearing. It's dead.`
    : `Not enough left in it. Paint for ${can.paint} character${can.paint === 1 ? '' : 's'}, and you're asking for ${cost}.`;
}

async function spendCan(can, cost) {
  const left = can.paint - cost;
  if (left > 0) {
    await query(
      `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('paint', $2::int) WHERE id=$1`,
      [can.id, left]
    );
    return left;
  }
  if ((can.quantity ?? 1) > 1) {
    await query(
      `UPDATE player_inventory SET quantity = quantity - 1,
         custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('paint', $2::int) WHERE id=$1`,
      [can.id, CAN_CAPACITY]
    );
  } else {
    await query('DELETE FROM player_inventory WHERE id=$1', [can.id]);
  }
  return 0;
}

// --- Rendering --------------------------------------------------------------

// zone.describeRoom is GATHERED, not fired (describe.js), so this line sits
// alongside whatever else the room has to say instead of eating it.
//
// Sync-safe: hydration is kicked off but never awaited here. A first `look` in
// the seconds before the table lands simply shows no tag — the alternative is an
// awaited query on the hottest path in the game, which the read tiers forbid.
/**
 * A tag as HTML. Unstyled it is the plain bold it has always been — which is why
 * a tag sprayed before any of this existed reads exactly as it did. Styled, the
 * bold comes off (the paint decides the weight now) and the runs are rendered.
 */
function paintedText(t) {
  const inner = t?.style?.length ? renderStyled(t.text, t.style) : `<b>${t.text}</b>`;
  // safeFinish has already kept this to a name off TAG_FINISHES, so it's safe as a class
  return t?.finish ? `<span class="graffiti-finish graffiti-${t.finish}">${inner}</span>` : inner;
}

function describeTag(zone) {
  hydrate();
  const all = tagsAt(zone?.id);
  if (!all.length) return undefined;
  // A paragraph of its own beneath the room prose (describe.js prints the gathered
  // room-lines there), dim and italic like the rest of the ambient beat — with the
  // paint itself in `graffiti-ink`, which sets its own weight and colour back so a
  // red tag is red and a bold one is bold. One line per wall.
  // Inside vs. outside is DERIVED, never stored: a tag whose wall is the tile it is
  // keyed on was sprayed on the room's own wall, which only ever happens indoors.
  // Which wall of a building it is gets derived the same way, off the two grid positions.
  return all.map((t) => {
    const inside = t.targetZoneId === zone.id;
    const where = inside ? 'the wall in here' : `the ${sideOfIds(zone.id, t.targetZoneId)} of ${esc(t.targetName || 'the building')}`;
    return `<span class="room-graffiti">Somebody's tagged ${where}: <span class="graffiti-ink">${paintedText(t)}</span></span>`;
  }).join('\n');
}

/**
 * `room.tags` — what is sprayed on a room's own wall, for ROOM to paint (plugins/roomstage).
 *
 * An indoor tag is keyed on the room as both halves of its wall, so this is one Map lookup. Sync and
 * query-free, like `wall.tags`, because `room_view` gathers it. The text goes out unescaped, as the
 * flight window's does: it's baked onto a canvas, never put into HTML. `spot` is where ROOM aimed it;
 * a tag sprayed from the log has none, and the Stage places it itself.
 */
function roomTags(zoneId) {
  hydrate();
  const t = zoneId ? tagOn(zoneId, zoneId) : null;
  if (!t) return undefined;
  return [{
    zone: zoneId,
    t: unesc(t.text).slice(0, TAG_MAX_LEN),
    r: Array.isArray(t.style) && t.style.length ? t.style : undefined,
    f: t.face || undefined,
    x: t.finish || undefined,
    spot: t.spot || undefined,
    v: (String(zoneId).split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) & 0xffff),
  }];
}

export const hooks = {
  'zone.describeRoom': describeTag,
  'wall.tags': wallTags,
  'room.tags': roomTags,
};

export const commands = {
  tag: doTag,
  spraycan: doSpray,
  sprayapply: doSprayApply,
  spraysave: doSpraySave,
  spraydel: doSprayDelete,
};

export const _test = { cameraAsked, pickCamera, paintCamera, wallsNear, pickWall, expired, tags, putTag, hydrate, esc, applyTag, paintedText, wallTags, roomTags, byBuilding, unesc, wallLabel, withSignature };

console.log('[graffiti] Plugin loaded.');
