/**
 * Graffiti — TAG the front of a building.
 *
 * The `graffiti` crime has sat in the registry (server/engine/crimes.js) since the
 * crime system was built, at 0.3 stars, charging nobody: there was no verb. This is
 * the verb.
 *
 * Three rules shape the whole thing, and they're worth stating before the code:
 *
 *  1. YOU SPRAY A BUILDING, NOT A TILE. `tag` will not fire on open ground — it
 *     resolves a facade on an adjacent exit (flags.is_building) and refuses if
 *     there isn't one. That's the difference between graffiti and a text field:
 *     it lands on a thing that exists in the world and it says which thing.
 *  2. ONE PER STREET TILE, AND ANYONE MAY PAINT OVER ANYONE. The cap isn't a
 *     limit, it's the design — the wall is a contested slot, so the interesting
 *     question is never "what shall I write" but "whose tag is up". It's also
 *     what makes the table a PRIMARY KEY instead of a rule somebody enforces:
 *     one row per street tile in the world, forever, upserted.
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
import { getZone } from '../../server/engine/world.js';
import { allExits } from '../../server/engine/exits.js';
import { gameDayIndex } from '../../server/engine/zone-filth.js';
import { gameToday } from '../../server/engine/apartments.js';
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';
import { normalizeRuns, coalesceRuns, renderStyled, decodePayload } from './paint.js';

// One tag lives three game days. The clock is 1:1 by default (timeScale 1), so
// that's three real days — long enough that a tag is worth putting up, short
// enough that a dead corner of the map isn't carrying somebody's 2026 opinion
// forever. Painting over is the fast path; this is only the backstop.
export const TAG_LIFE_DAYS = 3;

// Long enough for a slogan, short enough that it reads as spray paint and not an
// essay. Deliberately measured BEFORE escaping, so the player counts what they typed.
export const TAG_MAX_LEN = 48;

// Paint is the gate, and the only one — no skill check, no stat. You have a can,
// you spray.
const CAN_TAG = 'spray_paint';

// How many designs a player may keep. Small on purpose: a saved spray is a piece
// you're proud of, not a clipboard. The oldest is never auto-dropped — you're told
// the shelf is full and you pick what goes, because the alternative is silently
// eating the one somebody meant to keep.
export const SAVE_CAP = 12;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- The RAM authority ------------------------------------------------------

const tags = new Map();   // streetZoneId -> { text, authorId, authorHandle, targetZoneId, targetName, dayIndex }
let hydrated = null;      // the one-time load promise, memoized

async function hydrate() {
  if (!hydrated) {
    hydrated = (async () => {
      try {
        const { rows } = await query(
          'SELECT zone_id, target_zone_id, target_name, author_id, author_handle, text, style, day_index FROM zone_graffiti'
        );
        for (const r of rows) {
          tags.set(r.zone_id, {
            text: r.text, style: Array.isArray(r.style) ? r.style : null,
            authorId: r.author_id, authorHandle: r.author_handle,
            targetZoneId: r.target_zone_id, targetName: r.target_name, dayIndex: r.day_index,
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
 * The live tag on a street tile, or null. Sync and query-free by contract — it is
 * called from the room-description path. Returns null for an expired tag without
 * deleting it; the row is reaped on the next write or scrub, and an orphan row is
 * one row on a tile nobody has visited.
 */
export function tagAt(zoneId, today = gameToday()) {
  const e = tags.get(zoneId);
  if (!e || expired(e, today)) return null;
  return e;
}

/** Remove the tag on a tile. Returns what was there, or null. Used by `clean`. */
export async function removeTag(zoneId) {
  const had = tagAt(zoneId);
  tags.delete(zoneId);
  if (had) await query('DELETE FROM zone_graffiti WHERE zone_id=$1', [zoneId]).catch(() => {});
  return had;
}

// --- Finding a wall ---------------------------------------------------------

// Every building facade on an adjacent exit, as [{ dir, id, name }]. This is the
// whole "you can't tag thin air" rule: no entries, no spraying.
function wallsNear(zone) {
  const out = [];
  const seen = new Set();
  for (const { dir, target } of allExits(zone)) {
    if (seen.has(target)) continue;
    const t = getZone(target);
    if (!t?.flags?.is_building) continue;
    seen.add(target);
    out.push({ dir, id: target, name: t.flags.building_name || t.name });
  }
  return out;
}

// Match what the player typed against the walls to hand — a direction ("north"),
// a leading letter of one ("n"), or any part of the building's name ("bodega").
// Returns { wall } | { ambiguous } | {} so the caller can say something useful
// about each case rather than a flat "no".
function pickWall(walls, wordRaw) {
  const word = (wordRaw || '').toLowerCase();
  if (!word) return walls.length === 1 ? { wall: walls[0] } : {};
  const byDir = walls.filter(w => w.dir === word || w.dir[0] === word);
  if (byDir.length === 1) return { wall: byDir[0] };
  const byName = walls.filter(w => w.name.toLowerCase().includes(word));
  if (byName.length === 1) return { wall: byName[0] };
  if (byDir.length > 1 || byName.length > 1) return { ambiguous: [...byDir, ...byName] };
  return {};
}

const wallList = (walls) => walls.map(w => `<b>${esc(w.dir)}</b> (${esc(w.name)})`).join(', ');

// --- The verb ---------------------------------------------------------------

async function doTag(args, raw, player) {
  await hydrate();
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'output', message: `You're nowhere in particular.` };

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
    return { type: 'output', message: `Spray on what? ${wallList(walls)}\n<span class="text-dim">tag &lt;direction&gt; &lt;what to write&gt; — or <b>spraycan</b> for the colours</span>` };
  }
  // `tag north` with nothing to write, holding a can: that IS the request for the
  // can. Opening the dialog here rather than printing a usage line is the whole
  // discovery path — nobody reads a usage line and then goes looking for a second
  // verb. Without a can it falls through to the words, because the dialog would
  // only be able to tell you the same thing at the end.
  if (!text) {
    if (await carriedCan(player)) return doSpray(args, `spraycan ${picked.wall.dir}`, player);
    return { type: 'output', message: `Spray <i>what</i> on ${esc(picked.wall.name)}?\n<span class="text-dim">tag ${picked.wall.dir} &lt;what to write&gt; — or <b>spraycan ${picked.wall.dir}</b> for the colours</span>` };
  }
  if (text.length > TAG_MAX_LEN) {
    return { type: 'output', message: `That's a mural, not a tag. ${TAG_MAX_LEN} characters, tops — you're ${text.length - TAG_MAX_LEN} over.` };
  }

  const can = await carriedCan(player);
  if (!can) {
    return { type: 'output', message: `You've got nothing to spray with. Hardware shops sell paint.` };
  }

  return applyTag(player, picked.wall, text, [], can);
}

/**
 * Put a tag up. The one write path — `tag` (typed) and `sprayapply` (the dialog)
 * both land here, so the crime, the can, the upsert and the "straight over
 * somebody's" line can never drift apart between the two ways in.
 *
 * `runs` is normalized against the length of what was TYPED, before escaping —
 * see paint.js for why that distinction is the whole ballgame.
 */
async function applyTag(player, wall, text, runs, can) {
  const over = tagAt(player.current_zone);
  const style = coalesceRuns(normalizeRuns(runs, text.length));
  const entry = {
    text: esc(text),
    style: style.length ? style : null,
    authorId: player.id,
    authorHandle: player.handle,
    targetZoneId: wall.id,
    targetName: wall.name,
    dayIndex: gameDayIndex(gameToday()),
  };
  tags.set(player.current_zone, entry);
  await query(
    `INSERT INTO zone_graffiti (zone_id, target_zone_id, target_name, author_id, author_handle, text, style, day_index)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (zone_id) DO UPDATE SET
       target_zone_id=EXCLUDED.target_zone_id, target_name=EXCLUDED.target_name,
       author_id=EXCLUDED.author_id, author_handle=EXCLUDED.author_handle,
       text=EXCLUDED.text, style=EXCLUDED.style, day_index=EXCLUDED.day_index,
       created_at=EXTRACT(EPOCH FROM NOW())`,
    [player.current_zone, entry.targetZoneId, entry.targetName, entry.authorId, entry.authorHandle,
     entry.text, entry.style ? JSON.stringify(entry.style) : null, entry.dayIndex]
  ).catch(() => {});

  await spendCan(can);

  // The crime. Charged through the ordinary witness gate in surveillance, which
  // means a lens rolls for it and a cop on the corner is a different matter —
  // nothing here decides whether you got away with it.
  emit('graffiti.tagged', { player, zoneId: player.current_zone, targetZoneId: wall.id });

  let msg = `You shake the can and put it up on ${esc(wall.name)}: ${paintedText(entry)}`;
  if (over) {
    msg += over.authorId === player.id
      ? `\n<span class="text-dim">Straight over your own last one. Nobody will ever know.</span>`
      : `\n<span class="text-dim">Straight over ${esc(over.authorHandle || 'somebody')}'s. That's how it works.</span>`;
  }
  msg += `\n<span class="text-dim">The can rattles. ${can.quantity > 1 ? `${can.quantity - 1} left.` : `That was the last of it.`}</span>`;
  return { type: 'output', message: msg, refresh: true };
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

  const walls = wallsNear(zone);
  if (!walls.length) return { type: 'output', message: `Nothing round here but open ground. You need a wall.` };

  const can = await carriedCan(player);
  if (!can) return { type: 'output', message: `You've got nothing to spray with. Hardware shops sell paint.` };

  const words = String(raw || '').trim().split(/\s+/).slice(1);
  const picked = pickWall(walls, words[0]);

  return {
    type: 'spray_editor',
    walls: walls.map(w => ({ dir: w.dir, name: w.name })),
    wall: picked.wall ? picked.wall.dir : (walls.length === 1 ? walls[0].dir : null),
    saved: await savedSprays(player.id),
    maxLen: TAG_MAX_LEN,
    saveCap: SAVE_CAP,
    can: { name: can.name, quantity: can.quantity ?? 1 },
    over: tagAt(player.current_zone) ? { handle: tagAt(player.current_zone).authorHandle || 'somebody' } : null,
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

  const can = await carriedCan(player);
  if (!can) return { type: 'output', message: `You've got nothing to spray with. Hardware shops sell paint.` };

  return applyTag(player, wall, payload.text, payload.runs, can);
}

// --- The shelf of saved designs ---------------------------------------------

async function savedSprays(playerId) {
  const { rows } = await query(
    'SELECT id, name, text, style FROM player_sprays WHERE player_id=$1 ORDER BY id',
    [playerId]
  ).catch(() => ({ rows: [] }));
  // Sent back to the dialog, which is the thing that ESCAPES it for display. The
  // wall stores escaped text; the shelf stores what you typed, because it goes
  // back into a text field. Nothing here is ever inserted into a room description
  // without going through applyTag's esc first.
  return rows.map(r => ({ id: r.id, name: r.name, text: r.text, style: Array.isArray(r.style) ? r.style : [] }));
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
    'INSERT INTO player_sprays (player_id, name, text, style) VALUES ($1,$2,$3,$4)',
    [player.id, payload.name || text.slice(0, 24), text, style.length ? JSON.stringify(style) : null]
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

async function carriedCan(player) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity, i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags, $2) LIMIT 1`,
    [player.id, CAN_TAG]
  );
  return rows[0] || null;
}

// One tag empties one can. Spending the last of a stack drops the row, same shape
// as the cleaning plugin's consumable.
async function spendCan(can) {
  if ((can.quantity ?? 1) > 1) {
    await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [can.id]);
  } else {
    await query('DELETE FROM player_inventory WHERE id=$1', [can.id]);
  }
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
  return t?.style?.length ? renderStyled(t.text, t.style) : `<b>${t.text}</b>`;
}

function describeTag(zone) {
  hydrate();
  const t = tagAt(zone?.id);
  if (!t) return undefined;
  // A paragraph of its own beneath the room prose (describe.js prints the gathered
  // room-lines there), dim and italic like the rest of the ambient beat — with the
  // paint itself in `graffiti-ink`, which sets its own weight and colour back so a
  // red tag is red and a bold one is bold.
  return `<span class="room-graffiti">Somebody's tagged the front of ${esc(t.targetName || 'the building')}: <span class="graffiti-ink">${paintedText(t)}</span></span>`;
}

export const hooks = {
  'zone.describeRoom': describeTag,
};

export const commands = {
  tag: doTag,
  spraycan: doSpray,
  sprayapply: doSprayApply,
  spraysave: doSpraySave,
  spraydel: doSprayDelete,
};

export const _test = { wallsNear, pickWall, expired, tags, hydrate, esc, applyTag, paintedText };

console.log('[graffiti] Plugin loaded.');
