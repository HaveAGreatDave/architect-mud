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
