/**
 * Phantom registry — per-player, per-zone illusory entities.
 *
 * A law, not a system: the engine simply lets a room hold entities that only
 * ONE viewer can see. Nothing here decides WHY a player is seeing phantoms —
 * that's the trip plugin's job (drug-induced deliriant hallucinations). The
 * engine only offers the seam: register a fake person/beast against a player,
 * and it renders in that player's room look (describe.js) and answers to their
 * target resolution (via matchPhantom) — while staying invisible to everyone
 * else and to the world caches.
 *
 * All state is in-memory and non-persisted, exactly like a trip: a phantom that
 * outlives a server restart would be a bug, not a feature.
 *
 * Spec shape (opaque to the engine beyond these fields):
 *   { id, name, kind:'person'|'beast', hp, hp_max, zone, ...author fields }
 * `zone` is refreshed by the owner as the player moves, so the illusion follows
 * them from room to room rather than being stranded where it was conjured.
 */
import { resolve } from './sift.js';
import { getZoneNpcs, getZoneEnemies, getZonePlayers } from './world.js';

// playerId -> Map(phantomId -> spec)
const byPlayer = new Map();

// ── Object transforms: the room you are in, misbehaving ──────────────────────
//
// The other half of the same law. A phantom ADDS something that isn't there; a
// transform makes something that IS there read as something else — your chair
// breathing, the vending machine talking to you — and only for the one player.
//
// This is where a psychedelic belongs, as opposed to a dissociative that removes
// you to a dreamscape: the horror needs a baseline to violate, and your own
// kitchen is a baseline. A dream has already announced that the rules are off,
// so nothing in it can be uncanny.
//
// playerId -> Map(furnitureId -> { name, description, looks[], says[] })
const transformsByPlayer = new Map();

export function addTransform(playerId, furnitureId, spec) {
  if (!transformsByPlayer.has(playerId)) transformsByPlayer.set(playerId, new Map());
  transformsByPlayer.get(playerId).set(furnitureId, spec);
  return spec;
}

// The ROOM ITSELF, re-read for one viewer. Separate from the furniture map
// because it is not keyed on anything — there is one room, and a psychedelic
// always warps it whether or not the place has so much as a chair. This is what
// stops a trip on a bare street corner being no trip at all.
// playerId -> { zoneId, line }
const roomTransformByPlayer = new Map();

export function setRoomTransform(playerId, zoneId, line, name) {
  if (!line && !name) { roomTransformByPlayer.delete(playerId); return null; }
  const spec = { zoneId, line, name: name || null };
  roomTransformByPlayer.set(playerId, spec);
  return spec;
}
export function getRoomTransform(playerId, zoneId) {
  const t = roomTransformByPlayer.get(playerId);
  return t && t.zoneId === zoneId ? t.line : null;
}
/** What the ROOM ITSELF is called for this viewer, or null to use its real name. */
export function getRoomTransformName(playerId, zoneId) {
  const t = roomTransformByPlayer.get(playerId);
  return t && t.zoneId === zoneId ? (t.name || null) : null;
}

// The weather, misbehaving, for one viewer. Kept apart from the room warp
// because it renders in a different slot and only applies outdoors — the real
// conditions still print, with this appended, so a player can still tell it is
// raining while the rain does something it should not.
// playerId -> { zoneId, line }
const weatherWarpByPlayer = new Map();

export function setWeatherWarp(playerId, zoneId, line) {
  if (!line) { weatherWarpByPlayer.delete(playerId); return null; }
  weatherWarpByPlayer.set(playerId, { zoneId, line });
  return line;
}
export function getWeatherWarp(playerId, zoneId) {
  const w = weatherWarpByPlayer.get(playerId);
  return w && w.zoneId === zoneId ? w.line : null;
}

// ── People, misbehaving ──────────────────────────────────────────────────────
//
// The same law again, pointed at the room's living occupants: for ONE viewer,
// the bartender is a heron in an apron. Held apart from the furniture map
// because the resolution rule differs — a person's real name still answers.
// You have known Marla for weeks; typing her name while your eyes are lying to
// you must not fail, and a hallucination that BLOCKED talking to a real person
// would take gameplay away rather than adding weirdness to it.
//
// playerId -> Map(npcId -> { name, description, looks[], says[], emotes[], asks[] })
const npcTransformsByPlayer = new Map();

export function addNpcTransform(playerId, npcId, spec) {
  if (!npcTransformsByPlayer.has(playerId)) npcTransformsByPlayer.set(playerId, new Map());
  npcTransformsByPlayer.get(playerId).set(npcId, spec);
  return spec;
}
export function getNpcTransform(playerId, npcId) {
  return npcTransformsByPlayer.get(playerId)?.get(npcId) ?? null;
}
export function getNpcTransforms(playerId) {
  const m = npcTransformsByPlayer.get(playerId);
  return m ? [...m.entries()].map(([npcId, spec]) => ({ npcId, ...spec })) : [];
}
export function findNpcTransformByName(playerId, target) {
  const t = String(target || '').toLowerCase().trim();
  if (!t) return null;
  return getNpcTransforms(playerId).find(x => {
    const n = String(x.name || '').toLowerCase();
    return n.includes(t) || n.split(/[^a-z0-9]+/).some(w => w && w.startsWith(t));
  }) || null;
}

/**
 * Overlay a viewer's people-transforms onto an NPC list.
 *
 * ⚠ COPIES, ALWAYS — same rule as applyTransforms: `getZoneNpcs` hands back the
 * shared world rows. `_realName` rides along so a caller that needs to act on
 * the actual person (dialogue, relations) can still get at them.
 */
export function applyNpcTransforms(playerId, npcs) {
  const m = npcTransformsByPlayer.get(playerId);
  if (!m?.size || !Array.isArray(npcs)) return npcs;
  return npcs.map(n => {
    const t = m.get(n.id);
    return t ? { ...n, name: t.name || n.name, _realName: n.name, _transformed: t } : n;
  });
}

export function clearTransforms(playerId) {
  transformsByPlayer.delete(playerId);
  npcTransformsByPlayer.delete(playerId);
  roomTransformByPlayer.delete(playerId);
  weatherWarpByPlayer.delete(playerId);
}
export function hasTransforms(playerId) { return (transformsByPlayer.get(playerId)?.size ?? 0) > 0; }
export function getTransform(playerId, furnitureId) {
  return transformsByPlayer.get(playerId)?.get(furnitureId) ?? null;
}
export function getTransforms(playerId) {
  const m = transformsByPlayer.get(playerId);
  return m ? [...m.entries()].map(([furnitureId, spec]) => ({ furnitureId, ...spec })) : [];
}

/**
 * Resolve a target string against what the room LOOKS like to this viewer.
 *
 * THE NEW NAME IS THE ONLY NAME. If the bed is a sleeping lion, the player sees
 * "a sleeping lion" in the room and must type `examine lion` — typing `bed`
 * would be typing something they cannot see, and would give the trick away by
 * answering. So callers pair this with `isTransformed` and drop the underlying
 * row from their own name matching: one furniture id, one name, whichever name
 * that viewer is being shown.
 *
 * Matches the way SIFT does at its loosest — case-insensitive substring on the
 * whole name and on any word in it — because "lion" must find "a sleeping lion".
 * Returns { furnitureId, ...spec } or null.
 */
export function findTransformByName(playerId, target) {
  const t = String(target || '').toLowerCase().trim();
  if (!t) return null;
  const all = getTransforms(playerId);
  if (!all.length) return null;
  return all.find(x => {
    const n = String(x.name || '').toLowerCase();
    return n.includes(t) || n.split(/[^a-z0-9]+/).some(w => w && w.startsWith(t));
  }) || null;
}

/** Is this particular piece wearing another shape for this viewer? */
export function isTransformed(playerId, furnitureId) {
  return !!transformsByPlayer.get(playerId)?.has(furnitureId);
}

/**
 * Overlay a viewer's transforms onto a furniture list.
 *
 * ⚠ RETURNS COPIES, ALWAYS. `getZoneFurniture` serves rows straight out of the
 * world cache, and those objects are SHARED BY EVERY PLAYER IN THE ROOM. Mutating
 * one here would show one player's hallucination to everybody and write it into
 * the cache until the next reload. Never mutate; always spread.
 *
 * A no-op (returns the original array) for the overwhelming majority of callers,
 * who aren't tripping — this sits on the per-look/per-move path, so the early-out
 * matters.
 */
export function applyTransforms(playerId, furniture) {
  const m = transformsByPlayer.get(playerId);
  if (!m?.size || !Array.isArray(furniture)) return furniture;
  return furniture.map(f => {
    const t = m.get(f.id);
    // `_realName` rides along for two callers: the room render, which tells the
    // client what this thing WAS so the pane can play the change letter by
    // letter, and anything that has to act on the actual row.
    return t ? { ...f, name: t.name || f.name, description: t.description || f.description, _realName: f.name, _transformed: t } : f;
  });
}

export function addPhantom(playerId, spec) {
  if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Map());
  byPlayer.get(playerId).set(spec.id, spec);
  return spec;
}

export function removePhantom(playerId, id) {
  byPlayer.get(playerId)?.delete(id);
}

export function clearPhantoms(playerId) {
  byPlayer.delete(playerId);
}

export function hasPhantoms(playerId) {
  return (byPlayer.get(playerId)?.size ?? 0) > 0;
}

export function getPhantom(playerId, id) {
  return byPlayer.get(playerId)?.get(id) ?? null;
}

export function getPhantoms(playerId) {
  const m = byPlayer.get(playerId);
  return m ? [...m.values()] : [];
}

export function getPhantomsInZone(playerId, zoneId) {
  return getPhantoms(playerId).filter((p) => p.zone === zoneId);
}

/**
 * Resolve a target string to one of the player's phantoms in their CURRENT
 * zone — but only when no real npc/enemy/player answers to it. Reals always
 * win, so a phantom can never shadow a real interaction: callers try this only
 * after (or in place of) their normal lookup, and a null means "defer to the
 * real engine handler". Returns the phantom spec, or null.
 */
export function matchPhantom(player, target) {
  if (!target || !hasPhantoms(player.id)) return null;
  const here = getPhantomsInZone(player.id, player.current_zone);
  if (!here.length) return null;

  const real = [
    ...getZoneNpcs(player.current_zone),
    ...getZoneEnemies(player.current_zone),
    ...getZonePlayers(player.current_zone)
      .filter((p) => p.id !== player.id)
      .map((p) => ({ name: p.handle })),
  ];
  if (resolve(target, real).type !== 'none') return null;

  const r = resolve(target, here);
  if (r.type === 'match') return r.candidate;
  if (r.type === 'ambiguous') return r.candidates[0];
  return null;
}
