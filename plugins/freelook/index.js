// plugins/freelook/index.js
//
// FREELOOK — the detached camera, with nothing under it.
//
// GLASS has had a free camera for a while (client/game/js/panels/freecam.js) and it has always
// carried one precondition nobody argued for: you had to be in a SEAT. The camera is described as a
// thing you take off its mount, and there are exactly three mounts — a cab, a cockpit and a
// wheelhouse — so looking at a corner of Coldwater meant buying a truck, driving it there and
// pressing O. For the person the camera was built for, that is the whole job with a vehicle bolted
// to the front of it.
//
// This is the same camera with the vehicle removed. `freelook` hands the client a world window and a
// sky and says "here, at this tile"; the client opens the ordinary windshield with `hideOwnShip`,
// binds the ordinary free camera, and there is no vehicle in the picture because there is none.
//
// ⚠ IT IS A CAMERA AND NOTHING ELSE. Nothing here moves the player and the player's body does not
// move while it is open: `current_zone` is untouched, the room they are standing in is still the
// room they are standing in, and closing hands the pane back with a `look`. Not a teleport, not a
// spectator mode, and it grants no reach — point it at a tile on the far side of the Curtain and
// you are still not there.
//
// ⚠ AND THE LOADED WINDOW IS THE EDGE OF THE WORLD, the same real limit the debug `__freecam`
// carries and for the same reason (it is written out at `FREE` in windshield.js): `map` is ONE
// window the server chose at the moment you asked. Flying past its rim does not crash, it runs out
// of city. Following the camera with a fresh window would mean the client asking the server for
// ground somewhere else mid-flight, which is a much larger job than a camera — so `freelook <x> <y>`
// re-centres it instead, which is the same affordance for a tenth of the machinery.
//
// ⚠ NO TRAFFIC, DELIBERATELY. The helm streams air contacts to its chase view every 2s because it
// is a seat somebody is using. A dev camera cannot justify a 2s push, and at any cadence it CAN
// justify an aeroplane would jump rather than fly — which is worse than an empty sky, because a
// camera you are composing a shot through is exactly where a stuttering object is most obvious. The
// sky itself drifts slowly enough to ride the 15s tick below.
//
// Staff only, for the reason every dev camera is staff only: it is a way to look at ground you have
// not walked to, and in a game where finding a place IS the content, that is a spoiler with a verb
// attached.

import { getZone, getLivePlayer, getZoneFurniture, getAllZones } from '../../server/engine/world.js';
import { sendToPlayer, getBroadcast } from '../../server/engine/messaging.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { zoneAtTile } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { on } from '../../server/engine/events.js';
import { mapWindow, skyState, FLIGHT_RADIUS, skylineNear, nearbyRegions, farRoadsNear, FAR_ROAD_R, worldContactsNear } from '../flight/state.js';
import { streetActors } from '../../server/engine/street-actors.js';
import { streetDoorsNear, buildingRoomsNear } from '../roomstage/index.js';

// The same roster the fireworks command takes, and deliberately not the narrower `role === 'admin'`
// the helm console uses: the helm steers a boat and this looks at a wall, so the people who build
// walls should have it. A builder checking a shopfront they just sited is the likeliest caller.
const ROLES = ['admin', 'dev', 'builder', 'designer'];
const DENIED = { type: 'error', message: "You don't have the clearance for that." };
const USAGE = 'Usage: <b>freelook</b> · <b>freelook &lt;x&gt; &lt;y&gt;</b> · <b>freelook under</b> · <b>freelook close</b>';

// The flight sim's own window radius — 36 tiles, which is ≥ the renderer's VISIBLE_FAR_F, so the
// whole skyline the camera can draw is in the payload from the moment it opens. A smaller window
// would be cheaper and would reveal the city in as you flew, which is the one thing a camera you
// are composing a shot through must not do.
const RADIUS = FLIGHT_RADIUS;

// Everyone with the view open, and the tile their window is centred on. The sky push below is
// idle-gated on this, so with nobody looking the tick is one `Map.size` read.
const viewers = new Map();   // playerId -> { gx, gy }

// ── WHERE THE CAMERA OPENS ───────────────────────────────────────────────────
//
// The tile under the caller. Somebody standing on the surface IS on a map_world tile and answers
// directly; somebody indoors is not, and the honest answer for them is the tile their building
// stands on rather than a refusal — you type this from wherever you happen to be, and "step outside
// first" is a rule with nothing behind it.
//
// ⚠ IT FOLLOWS THE HOP `world_exit_zone` ACTUALLY MAKES. On an interior room that field is the
// FACADE and on the facade it is the STREET — two meanings on one field name, see the ⚠ in
// docs/proposals/coldwater-infill.md — so from inside a shop the first hop lands on the facade,
// which is placed, and it stops there. Nothing walks further than it has to.
//
// ⚠ AND 0,0 IS NOT A TILE. An interior zone carries grid 0,0 to mean "unset", so a placed test that
// only checks `grid_x != null` cheerfully returns the top-left corner of the map and opens the
// camera over empty grass a long way from anything.
export function placedTile(zone) {
  if (!zone || zone.map_id !== 'map_world' || zone.grid_x == null || zone.grid_y == null) return null;
  if (zone.grid_x === 0 && zone.grid_y === 0) return null;
  return { gx: zone.grid_x, gy: zone.grid_y };
}

export function tileUnder(player) {
  let z = getZone(player?.current_zone);
  for (let hop = 0; hop < 3 && z; hop++) {
    const at = placedTile(z);
    if (at) return at;
    const nextId = z.flags?.world_exit_zone || z.parent_zone;
    z = nextId ? getZone(nextId) : null;
  }
  return null;
}

// One assembler, because the open and the re-centre send the identical thing and a second copy is a
// second chance for one of them to forget the sky.
//
// The sky is sampled at the tile BEING LOOKED AT rather than at the caller: a camera pointed across
// the Basin would otherwise show the weather over the room its owner is standing in.
//
// ⚠ AND A VANTAGE CLEARS `self` ON ITS OWN TILE. `mapWindow` stamps the centre cell `self: 1`,
// which is what stops a cab being drawn inside its own building — right for a camera in a vehicle
// and exactly wrong for a camera standing ON something, because the thing under your feet is then
// the one thing in the window that is not drawn. This is `yachtHelmWindow`'s own line, and the
// helm needs it for the same reason: you are looking at the ship you are on.
// the buildings whose rooms each player on foot has been sent, so each goes once (the client keeps them)
const roomsSent = new Map();
const INTERIOR_R = 2;
function viewPayload(gx, gy, stand, pid = null) {
  const map = mapWindow({ grid_x: gx, grid_y: gy }, RADIUS);
  if (stand && map[RADIUS]?.[RADIUS]) map[RADIUS][RADIUS].self = undefined;
  // Everybody standing in that window, so the street under the camera is not empty.
  // ⚠ AND WHAT A COCKPIT IS SENT, SO THE CAMERA SEES WHAT A PILOT DOES: the highway past the window,
  // the region's colour grade, and everything moving (kept current by pushContacts below).
  return { type: 'freelook_open', gx, gy, map, skyline: skylineNear(gx, gy, RADIUS), sky: skyState(gx, gy), actors: streetActors(gx, gy, RADIUS), stand,
    roads: farRoadsNear(gx, gy, FAR_ROAD_R), regions: nearbyRegions(gx, gy), contacts: worldContactsNear(gx, gy, RADIUS),
    // on foot: the street door of each building you can walk into (plugins/roomstage), which the client makes
    // solid everywhere else
    ...(stand?.foot ? { doors: streetDoorsNear(gx, gy, RADIUS), ...interiorsFor(gx, gy, pid) } : {}) };
}
// On foot: the rooms of each building with a Stage within INTERIOR_R tiles, not sent to this player yet, for the client to
// draw inside the city (docs/proposals/one-world-interiors.md). From the roomstage plugin's cache, never a query.
function interiorsFor(gx, gy, pid) {
  if (pid == null) return {};
  const sent = roomsSent.get(pid) || new Set(), fresh = buildingRoomsNear(gx, gy, INTERIOR_R).filter((b) => !sent.has(b.tile.x + ',' + b.tile.y));
  if (!fresh.length) return {};
  for (const b of fresh) sent.add(b.tile.x + ',' + b.tile.y);
  roomsSent.set(pid, sent);
  return { interiors: fresh };
}

// ── A VANTAGE: THE SAME CAMERA, BOLTED DOWN ──────────────────────────────────
//
// Furniture carrying `flags.telescope` is a place you can stand and look from. It is the free
// camera with three constraints — feet on something, an eye height that is not yours to set, and a
// leash — and the reason it lives in THIS plugin rather than a new one is that there is exactly one
// camera-over-a-tile on the wire: one viewer set, one sky push, one close. A second plugin sending
// `freelook_open` would be a second owner of a pane whose `freelook close` reached only one of them.
//
// ⚠ AND IT IS DELIBERATELY NOT BEHIND THE STAFF GATE. `freelook` is staff-only because it is a way
// to look at ground you have not walked to; a telescope is a thing in a room you already got into,
// pointed at ground you can already see from it. The gate on a vantage is the door you came
// through.
//
// The flag is an object, so the furniture says what KIND of vantage it is:
//   { mount: 'yacht_scope', leash: 0.09, yaw: 200, label: 'TELESCOPE' }
// `mount` names a fixture the RENDERER knows how to find — a deck whose height is a property of a
// model and whose position is a function of the swell, neither of which this process knows or
// should. Anything standing on ground that does not move authors a plain `eye` instead.
const VANTAGE_DEFAULTS = { leash: 0.09, yaw: 0, label: 'VANTAGE' };

function vantageIn(zoneId) {
  return getZoneFurniture(zoneId).find((f) => f.flags?.telescope);
}

// What goes on the wire, normalised here rather than trusted off a content row: a leash is a
// distance and a yaw is a bearing, and a string in either would reach the camera as NaN, which
// draws nothing and says nothing.
function standBlock(furn) {
  const f = furn.flags.telescope;
  const raw = (f && typeof f === 'object') ? f : {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    mount: raw.mount ? String(raw.mount) : null,
    eye: raw.eye != null ? num(raw.eye, null) : null,
    x: num(raw.x, 0), y: num(raw.y, 0),
    leash: Math.max(0.02, Math.min(4, num(raw.leash, VANTAGE_DEFAULTS.leash))),
    yaw: num(raw.yaw, VANTAGE_DEFAULTS.yaw),
    label: String(raw.label || furn.name || VANTAGE_DEFAULTS.label),
  };
}

function cmdTelescope(args, raw, player) {
  const a0 = String(args[0] || '').toLowerCase();
  // Closing FIRST, and ahead of everything — the same rule `freelook close` is written on. The
  // client's ✕ fires this, and a view you cannot shut because you have since walked out of the room
  // is a pane nobody can get out of.
  if (a0 === 'close' || a0 === 'off' || a0 === 'stop') {
    viewers.delete(player.id); roomsSent.delete(player.id);
    sendToPlayer(player.id, { type: 'freelook_close' });
    return { type: 'noop' };
  }
  const furn = vantageIn(player.current_zone);
  // ⚠ NO HINT AS TO WHAT WOULD HAVE WORKED. A refusal that named the flag, the room or the fitting
  // would turn a verb anybody can type into a detector for vantages they have not found.
  if (!furn) return { type: 'error', message: "There's nothing here to look through." };
  const at = tileUnder(player);
  if (!at) return { type: 'error', message: `${furn.name} looks out on nothing: this room isn't placed on the map.` };
  const stand = standBlock(furn);
  sendToPlayer(player.id, viewPayload(at.gx, at.gy, stand, player.id));
  viewers.set(player.id, at);
  return { type: 'system', message: `You put your eye to ${furn.name.toLowerCase()}. <b>O</b> or <b>✕</b> steps back.` };
}

function cmdFreelook(args, raw, player) {
  // Closing is handled FIRST, ahead of the clearance gate, for the reason the helm's own close is:
  // the client's ✕ fires this, and a view you can open and then cannot close because your role
  // changed underneath you is a pane nobody can get out of.
  const a0 = String(args[0] || '').toLowerCase();
  if (a0 === 'close' || a0 === 'off' || a0 === 'stop') {
    viewers.delete(player.id); roomsSent.delete(player.id);
    player._onFoot = false;
    sendToPlayer(player.id, { type: 'freelook_close' });
    return { type: 'noop' };
  }
  if (!ROLES.includes(player.role)) return DENIED;

  // The Under has no GLASS: `freelook under` (or a bare `freelook` from down there) sends the
  // tile graph instead, and client/game/js/panels/under-view.js builds the tunnels from it.
  const here = getZone(player.current_zone);
  if (a0 === 'under' || (args.length === 0 && here?.map_id === 'map_world' && here.grid_z < 0)) return openUnder(player, here);

  let at, follow = false;
  if (args.length >= 2) {
    const gx = Number(args[0]), gy = Number(args[1]);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return { type: 'error', message: USAGE };
    at = { gx: Math.round(gx), gy: Math.round(gy) };
    follow = String(args[2] || '').toLowerCase() === 'follow';
  } else if (args.length === 1) {
    return { type: 'error', message: USAGE };
  } else {
    at = tileUnder(player);
    if (!at) return { type: 'error', message: "There's no world tile under you: this room isn't placed on the map. Name one: <b>freelook &lt;x&gt; &lt;y&gt;</b>." };
  }

  const moving = viewers.has(player.id);
  sendToPlayer(player.id, viewPayload(at.gx, at.gy));
  viewers.set(player.id, at);
  // ⚠ THE CAMERA ASKS FOR THIS TOO, AND IT MUST NOT NARRATE. The view re-centres its own window as
  // the camera flies out of it (see RECENTER_R in freelook-view.js) — every 18 tiles, which at the
  // fast ladder is a couple of seconds — so the ordinary confirmation would be a line in the log
  // for something nobody did. `follow` is the camera saying the move is its own; a person typing a
  // tile still gets told the window moved.
  if (follow) return { type: 'noop' };
  return { type: 'system', message: moving
    ? `Window re-centred on ${at.gx},${at.gy}.`
    : `Camera up over ${at.gx},${at.gy}. <b>O</b> or <b>✕</b> puts it away; <b>freelook &lt;x&gt; &lt;y&gt;</b> moves the window.` };
}

// ── KEEPING THE SKY CURRENT ──────────────────────────────────────────────────
// The weather field drifts and the clock runs, so a camera left open for ten minutes would be
// showing the sky it opened under. Same 15s cadence the helm console uses, idle-gated the same way.
//
// ⚠ THE WINDOW IS NOT RE-SENT. The map is a 73×73 grid of derived cells and the ground does not
// change while you look at it; re-sending it every fifteen seconds would be the largest recurring
// payload in the game for no observable difference. Moving the window is `freelook x y`.
// ── THE UNDER ────────────────────────────────────────────────────────────────
// Every sewer tile on map_world's z -1 layer, with its name and the directions it has exits in
// ('NSEW', plus 'U' for a way up). The Basin floor shares the layer and is the submersible's
// (GLASS draws it), so it is left out. A staff verb, run rarely, so one scan of the zone map.
const DIR_LETTER = { north: 'N', south: 'S', east: 'E', west: 'W', up: 'U' };
// ⚠ A DIRECTION COUNTS ONLY WHERE IT LEADS. The Watch Threshold's east exit goes into the Long
// Watch's base, and the tile east of it on the grid is a Drain Sump it doesn't connect to; read
// as a bare letter, that drew a sewer tunnel between the two that isn't there.
export function underTiles(all = getAllZones()) {
  const out = [];
  const byId = new Map(all.map((z) => [z.id, z]));
  const OFF = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  for (const z of all) {
    if (z.map_id !== 'map_world' || !(z.grid_z < 0) || z.flags?.terrain !== 'sewer') continue;
    let e = '';
    for (const [k, to] of Object.entries(z.exits || {})) {
      if (k === 'up') { e += 'U'; continue; }
      const o = OFF[k], t = byId.get(to);
      if (o && t && t.map_id === 'map_world' && t.grid_z === z.grid_z && t.grid_x === z.grid_x + o[0] && t.grid_y === z.grid_y + o[1]) e += DIR_LETTER[k];
    }
    out.push({ x: z.grid_x, y: z.grid_y, n: z.name, e, id: z.id });
  }
  return out;
}

// ── WHAT HANGS OFF THE UNDER ─────────────────────────────────────────────────
// An interior map entered sideways from a sewer tile (the Long Watch's base off the Watch
// Threshold is the one there is) is placed on the Under's grid so the room the exit leads to sits
// on the far side of that exit, and the rest of the map follows by its own grid. Nothing names the
// base: any interior map joined to the sewer this way comes along.
// Room exits: 'NSEW' to a room of the same map one step away on its grid, 'D'/'U' for a way down
// or up out of it (a hatch).
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
export function underAnnexes(all = getAllZones(), tiles = underTiles(all)) {
  const byId = new Map(all.map((z) => [z.id, z]));
  const annexes = [], seen = new Set();
  for (const t of tiles) {
    const z = byId.get(t.id);
    for (const [dir, to] of Object.entries(z?.exits || {})) {
      const r = byId.get(to), st = STEP[dir];
      if (!st || !r || r.map_id === 'map_world' || seen.has(r.map_id)) continue;
      const rooms = all.filter((q) => q.map_id === r.map_id && Number.isFinite(q.grid_x) && Number.isFinite(q.grid_y));
      if (rooms.length < 2) continue;
      seen.add(r.map_id);
      const ox = t.x + st[0] - r.grid_x, oy = t.y + st[1] - r.grid_y;
      const at = new Map(rooms.map((q) => [q.id, q]));
      annexes.push({
        map: r.map_id,
        link: { x: t.x, y: t.y, d: DIR_LETTER[dir] },
        rooms: rooms.map((q) => {
          let e = '';
          for (const [d2, to2] of Object.entries(q.exits || {})) {
            const o = at.get(to2), s2 = STEP[d2];
            if (o && s2 && o.grid_x - q.grid_x === s2[0] && o.grid_y - q.grid_y === s2[1]) e += DIR_LETTER[d2];
            else if ((d2 === 'down' || d2 === 'up') && !o) e += d2 === 'down' ? 'D' : 'U';
          }
          return { x: q.grid_x + ox, y: q.grid_y + oy, n: q.name, e, f: q.flags?.floor || null, id: q.id };
        }),
      });
    }
  }
  return annexes;
}

function openUnder(player, here) {
  const all = getAllZones();
  const tiles = underTiles(all);
  if (!tiles.length) return { type: 'error', message: 'There is no Under on this map.' };
  const annexes = underAnnexes(all, tiles);
  // Start where the player is, if they're down there (or in a room hanging off it); else at a way
  // down, else the first tile.
  const inside = here && here.grid_z < 0 && tiles.find((t) => t.x === here.grid_x && t.y === here.grid_y);
  const inRoom = here && annexes.flatMap((a) => a.rooms).find((q) => q.id === here.id);
  const s = inside || inRoom || tiles.find((t) => t.e.includes('U')) || tiles[0];
  viewers.delete(player.id); roomsSent.delete(player.id);   // no sky to push down there
  sendToPlayer(player.id, { type: 'freelook_under', gx: s.x, gy: s.y, start: { x: s.x, y: s.y, annex: !!inRoom }, tiles, annexes });
  return { type: 'system', message: `Camera down in the Under at ${s.x},${s.y} (${tiles.length} tiles). <b>L</b> lamp, <b>G</b> ghost through the walls, <b>O</b> or <b>✕</b> puts it away.` };
}

function pushLive() {
  if (!viewers.size) return;
  for (const [pid, at] of [...viewers]) {
    if (!getLivePlayer(pid)) { viewers.delete(pid); continue; }
    // The people ride the sky's clock: an NPC steps a tile every 15 s, and the client walks them between.
    sendToPlayer(pid, { type: 'freelook_sky', sky: skyState(at.gx, at.gy), actors: streetActors(at.gx, at.gy, RADIUS) });
  }
}
schedule('15s', pushLive);

// ── WHAT IS MOVING IN FRONT OF IT ────────────────────────────────────────────
// Aircraft, boats and trucks in the window, once a second, which is the cadence the cab and the
// boat get theirs at; the client dead-reckons between pushes. RAM only (worldContactsNear), and
// idle-gated on the viewer set like the sky. ⚠ AN EMPTY LIST IS SENT, NOT SKIPPED: it is how the
// client learns the sky has cleared, the helm's rule.
function pushContacts() {
  if (!viewers.size) return;
  for (const [pid, at] of viewers) {
    const contacts = worldContactsNear(at.gx, at.gy, RADIUS);
    // One empty list clears the picture; a second one says nothing new, so an empty sky costs nothing.
    if (!contacts.length && at.quiet) continue;
    at.quiet = !contacts.length;
    sendToPlayer(pid, { type: 'freelook_contacts', contacts });
  }
}
schedule('1s', pushContacts);

// A pane cannot survive its owner leaving. The client's own teardown covers a reload; a disconnect
// that never reaches it would leave a row in here being pushed sky at nobody until the next prune.
on('player.logout', ({ id }) => { if (id) viewers.delete(id); });

// ── ON FOOT: OUT OF A BUILDING'S STREET DOOR ─────────────────────────────────
//
// docs/proposals/building-stage.md step 5. Walking through the street door of a building drawn as a
// Room Stage (plugins/roomstage emits `roomstage.street`) puts you on the pavement in GLASS: this
// camera, standing, unleashed, at eye height, by the door with your back to it. Not for staff only:
// it's the tile you're on, and the camera goes where you walk and nowhere else.
//
// ⚠ EVERY STEP IS STILL A MOVE. The client sends the ordinary `move <dir>` when you cross a tile's
// edge, and this answers `freelook_step` with where the server put you. Nothing here moves anybody.
// Nobody stands on a facade (the engine passes you through it), so walking into a building's tile is
// walking in, and walking out lands on the street tile in front of it.
const STEP_OF = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const YAW_OF = { north: 0, east: 90, south: 180, west: 270 };
function footStep(z) {
  const t = placedTile(z);
  return t ? { gx: t.gx, gy: t.gy, zone: z.id } : null;
}
function openOnFoot(player, zoneId, facadeId = null) {
  const z = getZone(zoneId), step = footStep(z), out = getZone(facadeId)?.flags?.entrance;
  if (!player?.id || !step) return false;
  // a step out from the door: the building's side of the tile, facing away from it
  const [ox, oy] = STEP_OF[out] || [0, 0];
  const stand = { foot: true, x: -ox * 0.36, y: -oy * 0.36, yaw: YAW_OF[out] ?? 0, leash: 0, label: z.name || 'STREET', step };
  player._onFoot = true;
  sendToPlayer(player.id, viewPayload(step.gx, step.gy, stand, player.id));
  viewers.set(player.id, { gx: step.gx, gy: step.gy, foot: true });
  return true;
}
// The street outside a building's door, sent ahead while somebody's in its entry room, for the client to build the
// view hidden (`prewarm`): a GLASS view's first paints compile its shaders and build its city, which is the
// loading screen. Walking out then shows it at once. It registers no viewer and puts nobody on foot.
on('roomstage.streetwarm', ({ player, zone, facade }) => {
  const z = getZone(zone), step = footStep(z), out = getZone(facade)?.flags?.entrance;
  if (!player?.id || !step) return;
  const [ox, oy] = STEP_OF[out] || [0, 0];
  sendToPlayer(player.id, { ...viewPayload(step.gx, step.gy, { foot: true, x: -ox * 0.36, y: -oy * 0.36, yaw: YAW_OF[out] ?? 0, leash: 0, label: z.name || 'STREET', step }, player.id), prewarm: true });
});
// The room button on a street tile (plugins/roomstage): a toggle, the street on foot where you stand.
on('roomstage.onfoot', ({ player, zone, close }) => {
  const p = player?.id ? getLivePlayer(player.id) : null;
  if (!p) return;
  if (viewers.get(p.id)?.foot) { viewers.delete(p.id); roomsSent.delete(p.id); p._onFoot = false; sendToPlayer(p.id, { type: 'freelook_close' }); return; }
  if (close) return;
  if (!openOnFoot(p, zone)) sendToPlayer(p.id, { type: 'error', message: "There's no 3-D view of this spot." });
});
on('roomstage.street', ({ player, zone, facade }) => {
  const p = player?.id ? getLivePlayer(player.id) : null;
  if (!p || !openOnFoot(p, zone, facade)) sendToPlayer(player?.id, { type: 'room_close' });
});
// The Stage opened on the building you walked into: the street view goes, and the Stage takes the pane.
on('roomstage.indoors', ({ player }) => {
  if (!player?.id || !viewers.get(player.id)?.foot) return;
  viewers.delete(player.id); roomsSent.delete(player.id);
  // `indoors`: a Stage is taking the pane, so the client keeps the street view asleep for the walk back out
  sendToPlayer(player.id, { type: 'freelook_close', indoors: true });
});
// Each step on foot: where you are now. Into a room that has no Stage, the view goes and the room
// text comes back; roomstage takes the ones that do (above), and runs in the same tick, so this
// waits a turn to see whether it did.
on('zone.entered', ({ actor, zone }) => {
  const v = actor?.id ? viewers.get(actor.id) : null;
  if (!v?.foot) return;
  const p = getLivePlayer(actor.id), z = getZone(zone);
  if (!p) return;
  const step = z?.map_id === 'map_world' ? footStep(z) : null;
  if (step) {
    // far from the window's middle: a new window round you, as a re-centre
    if (Math.max(Math.abs(step.gx - v.gx), Math.abs(step.gy - v.gy)) > RADIUS / 2) {
      sendToPlayer(p.id, { ...viewPayload(step.gx, step.gy, { foot: true }, p.id), recentre: true });
      v.gx = step.gx; v.gy = step.gy;
    }
    sendToPlayer(p.id, { type: 'freelook_step', ...step });
    return;
  }
  setImmediate(() => {
    if (!viewers.get(actor.id)?.foot) return;
    viewers.delete(actor.id);
    p._onFoot = false;
    sendToPlayer(p.id, { type: 'freelook_close' });
  });
});

// PAINT ON A WALL YOU CAN SEE. A tag going up on a building or being scrubbed off it (plugins/graffiti) is drawn
// from the window's cells (`gft`, deriveSurfaceCell), so whoever's on foot within reach of that building is sent
// the window again, as a re-centre on the middle it already has: the cells nothing changed in are interned and kept
// (map-intern.js), and the one wall repaints. Once per act of spraying or cleaning, never on a tick.
function paintChanged({ zoneId, targetZoneId }) {
  const b = getZone(targetZoneId || zoneId);
  if (b?.map_id !== 'map_world' || b.grid_x == null || b.grid_y == null) return;
  for (const [pid, v] of viewers) {
    if (!v?.foot || Math.max(Math.abs(b.grid_x - v.gx), Math.abs(b.grid_y - v.gy)) > RADIUS) continue;
    sendToPlayer(pid, { ...viewPayload(v.gx, v.gy, { foot: true }, pid), recentre: true });
  }
}
on('graffiti.tagged', paintChanged);
on('graffiti.removed', paintChanged);

// THE 3-D VIEW IS THE AUTHORITY ON FOOT. `footstep <gx> <gy>`, sent silently by the street view when the eye crosses
// into a neighbouring tile: the server follows it there. The view's own collision (the buildings' walls, the doors) is
// what says where you can walk, so the grid's exits don't, and the pace is the camera's, so pacing doesn't queue it
// (cmdMove `footTo`). The gates still run: a locked door, a checkpoint or too much to carry still stops you, and then
// the view is told where you really are (`freelook_step` with `refused`) and puts you back.
async function cmdFootstep(args, raw, player) {
  const v = player?.id ? viewers.get(player.id) : null;
  if (!v?.foot) return null;
  const gx = Number(args[0]), gy = Number(args[1]);
  const here = getZone(player.current_zone), at = placedTile(here);
  if (!Number.isInteger(gx) || !Number.isInteger(gy) || !at) return null;
  const dx = gx - at.gx, dy = gy - at.gy;
  if (!dx && !dy) return null;
  // the gate's own words go with the refusal, so the view can say why rather than just putting you back
  const back = (message) => sendToPlayer(player.id, { type: 'freelook_step', gx: at.gx, gy: at.gy, zone: here.id, refused: true, ...(message ? { message } : {}) });
  const to = Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? zoneAtTile('map_world', gx, gy) : null;
  if (!to) { back(); return null; }
  const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
  const r = await cmdMove(dir, player, getBroadcast(), { footTo: to.id, targetZoneId: to.id });
  if (!r || r.type === 'error' || player.current_zone === here.id) back(r?.type === 'error' ? r.message : null);
  return r;
}

export const commands = {
  footstep: cmdFootstep,
  freelook: cmdFreelook,
  telescope: cmdTelescope,
};

// Declaration-only (handler: null) — `telescope` is an ordinary command-map verb that self-resolves
// the vantage in the room. This row exists purely so `availableActions()` advertises TELESCOPE when
// you examine the instrument; see plugins/instrument for the same arrangement and the same reason.
export const specializedActions = [
  { verb: 'telescope', requiredFlag: 'telescope', handler: null },
];

// The viewer set is the only state this plugin owns — handed to the regress suite so it can assert
// that opening registers and closing does not leave a row behind.
export const _test = { viewers, RADIUS, ROLES, openOnFoot, footStep, standBlock, vantageIn, VANTAGE_DEFAULTS, viewPayload, underTiles, underAnnexes };
