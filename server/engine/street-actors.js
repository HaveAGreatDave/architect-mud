import { world } from './world.js';
import { playerFigure, lookOfPlayer } from '../../client/shared/player-figure.js';

/**
 * STREET ACTORS — who is standing on the open world grid, right now.
 *
 * The windshield renders a real city and, until this file, nothing walking in it. This
 * publishes the population so the flight sim and the truck cab can draw a figure per person
 * on the pavement. The contract is 1:1 and deliberately so: if three NPCs are on that tile,
 * three figures are on that tile, and an empty street is drawn as an empty street. There is
 * no procedural crowd here and there must never be one — a filler figure is a person who
 * cannot be talked to, and the whole value of the layer is that everything you can see is a
 * thing you could walk up to.
 *
 * ── Indoors is ABSENCE, not a flag ────────────────────────────────────────────────────────
 * An interior is its own map (`maps.parent_zone_id` links it to the facade tile) with its own
 * interior-local grid, so an NPC inside a shop simply has no overworld coordinates and falls
 * out of the filter below with nothing written to handle it. That is the same shape the stray
 * cat's den uses, and for the same reason: a `flags.indoors` honoured here would need honouring
 * by the renderer, the window filter and the doorway transition too, and the first reader that
 * forgot it would put a shopkeeper on the pavement while they were serving behind the counter.
 *
 * It also means we never ship a count of who is inside a building — which would be a free
 * occupancy read on any premises in the city, from a truck cab, a street away. That is
 * SPECTER's job (docs/systems-surveillance.md) and it is not given away here. The renderer
 * infers the doorway beat from the vacated tile's facade neighbours instead, which is exact
 * anyway: `isEnterableFacade` auto-forwards a mover into the interior, so an NPC's last
 * standing tile is always the one BESIDE the door rather than the door itself.
 *
 * ── The token is the person's look ────────────────────────────────────────────────────────
 * `t` does two jobs. NPCs move on a 15-second tick, one whole tile per step, so a raw feed
 * teleports; the client interpolates that into a walk, and to do it it has to know the figure
 * at A last push is the figure at B this push. And it dresses them: `t` is the FNV-1a hash of
 * the id in base 36, which is the same hash the Room Stage and the TV seed a person's look
 * from (client gl/room-people.js `rand(id)`), so somebody you saw on the news walks down the
 * street in the same coat, hair and face (docs/proposals/street-people-ladder.md).
 *
 * ⚠ THAT IS A TRACKER, ON PURPOSE. Until 2026-11-12 `t` was salted per boot so a figure could
 * never be followed back to a name: a recognisable figure is a live position for every named
 * NPC, readable from the air with no camera, contact or skill check. David chose recognition
 * over that (2026-11-12). The id itself still never goes on the wire, so a name has to be
 * hashed to be found, but anyone with the content tree can.
 *
 * `s: 1` marks a woman (the close-up figure's head and build roll off it) and `g` is a settled
 * look, an NPC's `flags.figure` or a player's MORPHEX figure (client/shared/player-figure.js),
 * sent only for the few who have one, so the street costs a few bytes a figure more than before.
 */

// FNV-1a over the id, base36: room-people.js rand(id)'s seed. ~250 entities against 2^32: a
// collision is negligible, and its failure is cosmetic (two figures briefly interpolate as one
// and dress alike). Cheap matters more here than perfect: this runs per entity.
export function token(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// The open-air surface grid, matching the flight sim's own coord index (plugins/flight/state.js
// buildCoordIndex): the world map only, and z=0 only. The Under shares the world grid 202 zones
// deep, and a sewer gallery is not somebody standing in the street.
function surfaceTile(zone) {
  if (!zone || zone.map_id !== 'map_world') return null;
  if ((zone.grid_z ?? 0) !== 0) return null;
  if (zone.grid_x == null || zone.grid_y == null) return null;
  return zone;
}

// One tally shared by every viewer in the tick. The list is the same for everybody — only the
// window differs — so building it per viewer would repeat the same 200-odd iterations for each
// pilot in the air. TTL is deliberately under the 1 Hz cab push and well under the 3 s flight
// push, so nobody ever sees a stale frame; it exists to collapse simultaneous viewers, not to
// slow the feed down.
const TALLY_MS = 400;
let _tally = null, _tallyAt = 0;

function tally() {
  const now = Date.now();
  if (_tally && now - _tallyAt < TALLY_MS) return _tally;
  const out = [];
  for (const npc of world.npcs.values()) {
    if (npc._aboard || npc._charterHeld) continue;   // riding something, not walking
    const z = surfaceTile(world.zones.get(npc.zone_id));
    if (!z) continue;
    out.push({ id: npc.id, t: token(npc.id), x: z.grid_x, y: z.grid_y, f: npc.sex === 'female', g: npc.flags?.figure || null });
  }
  for (const [pid, p] of world.players) {
    // Airborne players are drawn as aircraft by the contact pass; they are not pedestrians.
    // (This is the same exemption reconcileZoneMembership makes, for the same reason.)
    if (!p || p.posture === 'flying') continue;
    const z = surfaceTile(world.zones.get(p.current_zone));
    if (!z) continue;
    out.push({ id: pid, t: token(pid), x: z.grid_x, y: z.grid_y, f: p.biological_sex === 'female', g: p.biological_sex ? playerFigure(lookOfPlayer(p)) : null });
  }
  _tally = out; _tallyAt = now;
  return out;
}

/**
 * Everyone standing on the surface grid within `radius` tiles of (cx, cy), as
 * `[{ t, x, y }]` in absolute tile coordinates.
 *
 * Square window to match mapWindow's, so a figure can never be outside the map the client
 * holds. `excludeId` drops the viewer — you are not a pedestrian in your own windscreen.
 *
 * Absolute coords rather than window-relative: the client recentres its map on the server's
 * paired mapX/mapY and would otherwise have to re-base every actor on every push, which is
 * exactly the kind of double bookkeeping that drifts.
 */
export function streetActors(cx, cy, radius, excludeId = null) {
  const out = [];
  for (const a of tally()) {
    if (a.id === excludeId) continue;
    if (Math.abs(a.x - cx) > radius || Math.abs(a.y - cy) > radius) continue;
    out.push(a.f ? (a.g ? { t: a.t, x: a.x, y: a.y, s: 1, g: a.g } : { t: a.t, x: a.x, y: a.y, s: 1 }) : a.g ? { t: a.t, x: a.x, y: a.y, g: a.g } : { t: a.t, x: a.x, y: a.y });
  }
  return out;
}

// Test seam: drop the shared tally so a regress case can move an NPC and read the result back
// without waiting out TALLY_MS. Never called in production.
export function _resetActorTally() { _tally = null; _tallyAt = 0; }
