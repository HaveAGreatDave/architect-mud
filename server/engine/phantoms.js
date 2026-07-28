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

export function setRoomTransform(playerId, zoneId, line) {
  if (!line) { roomTransformByPlayer.delete(playerId); return null; }
  const spec = { zoneId, line };
  roomTransformByPlayer.set(playerId, spec);
  return spec;
}
export function getRoomTransform(playerId, zoneId) {
  const t = roomTransformByPlayer.get(playerId);
  return t && t.zoneId === zoneId ? t.line : null;
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

export function clearTransforms(playerId) {
  transformsByPlayer.delete(playerId);
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
    return t ? { ...f, name: t.name || f.name, description: t.description || f.description, _transformed: t } : f;
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
