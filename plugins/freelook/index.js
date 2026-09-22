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

import { getZone, getLivePlayer, getZoneFurniture } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { schedule } from '../../server/engine/scheduler.js';
import { on } from '../../server/engine/events.js';
import { mapWindow, skyState, FLIGHT_RADIUS } from '../flight/state.js';

// The same roster the fireworks command takes, and deliberately not the narrower `role === 'admin'`
// the helm console uses: the helm steers a boat and this looks at a wall, so the people who build
// walls should have it. A builder checking a shopfront they just sited is the likeliest caller.
const ROLES = ['admin', 'dev', 'builder', 'designer'];
const DENIED = { type: 'error', message: "You don't have the clearance for that." };
const USAGE = 'Usage: <b>freelook</b> · <b>freelook &lt;x&gt; &lt;y&gt;</b> · <b>freelook close</b>';

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
function viewPayload(gx, gy, stand) {
  const map = mapWindow({ grid_x: gx, grid_y: gy }, RADIUS);
  if (stand && map[RADIUS]?.[RADIUS]) map[RADIUS][RADIUS].self = undefined;
  return { type: 'freelook_open', gx, gy, map, sky: skyState(gx, gy), stand };
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
    viewers.delete(player.id);
    sendToPlayer(player.id, { type: 'freelook_close' });
    return { type: 'noop' };
  }
  const furn = vantageIn(player.current_zone);
  // ⚠ NO HINT AS TO WHAT WOULD HAVE WORKED. A refusal that named the flag, the room or the fitting
  // would turn a verb anybody can type into a detector for vantages they have not found.
  if (!furn) return { type: 'error', message: "There's nothing here to look through." };
  const at = tileUnder(player);
  if (!at) return { type: 'error', message: `${furn.name} looks out on nothing — this room isn't placed on the map.` };
  const stand = standBlock(furn);
  sendToPlayer(player.id, viewPayload(at.gx, at.gy, stand));
  viewers.set(player.id, at);
  return { type: 'system', message: `You put your eye to ${furn.name.toLowerCase()}. <b>O</b> or <b>✕</b> steps back.` };
}

function cmdFreelook(args, raw, player) {
  // Closing is handled FIRST, ahead of the clearance gate, for the reason the helm's own close is:
  // the client's ✕ fires this, and a view you can open and then cannot close because your role
  // changed underneath you is a pane nobody can get out of.
  const a0 = String(args[0] || '').toLowerCase();
  if (a0 === 'close' || a0 === 'off' || a0 === 'stop') {
    viewers.delete(player.id);
    sendToPlayer(player.id, { type: 'freelook_close' });
    return { type: 'noop' };
  }
  if (!ROLES.includes(player.role)) return DENIED;

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
    if (!at) return { type: 'error', message: "There's no world tile under you — this room isn't placed on the map. Name one: <b>freelook &lt;x&gt; &lt;y&gt;</b>." };
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
function pushLive() {
  if (!viewers.size) return;
  for (const [pid, at] of [...viewers]) {
    if (!getLivePlayer(pid)) { viewers.delete(pid); continue; }
    sendToPlayer(pid, { type: 'freelook_sky', sky: skyState(at.gx, at.gy) });
  }
}
schedule('15s', pushLive);

// A pane cannot survive its owner leaving. The client's own teardown covers a reload; a disconnect
// that never reaches it would leave a row in here being pushed sky at nobody until the next prune.
on('player.logout', ({ id }) => { if (id) viewers.delete(id); });

export const commands = {
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
export const _test = { viewers, RADIUS, ROLES, standBlock, vantageIn, VANTAGE_DEFAULTS };
