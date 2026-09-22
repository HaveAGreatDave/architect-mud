// THE MARINA, AS A SCREEN — the server half.
//
// The `prefersLoggedPanels` side of the boat, and the axis this sits on is the one thing worth
// being exact about. A helm is a surface you ACT through: take it away and you cannot move a boat.
// A yard is a surface you READ — everything on it is `boats`, `boat`, `berth` and `refit`, which
// all work as typed verbs today — so deleting this panel leaves nobody stuck, and that is what puts
// it on `prefersLoggedPanels` rather than beside `texthelm.js`.
//
// ⚠ WHICH MEANS THE PANEL MUST NOT BE THE ONLY WAY TO DO ANYTHING. Every button on the client sends
// a verb string; nothing here decides, prices or validates. If this file ever grows a rule, the log
// rung has quietly lost it.
//
// ── ⚠ IT OPENS ON ARRIVAL AND CLOSES ON LEAVING, FROM ANY TILE OF THE YARD ──
//
// The depot's own hard-won note, which cost a bug: it asked `depotAt(from)`, true only of the bay,
// so walking out from the apron or the lobby left the shop window hanging over the street. A marina
// is worse — Fairweather is five rooms and two pontoons — so both the open and the close go through
// one test and the whole place answers as one.
//
// ⚠ AND THAT TEST IS NOT `berthsNear`, WHICH IS THE BUG THE FIRST CUT SHIPPED. See `standingInYard`:
// the reachability walk says WHICH yard you are near and says nothing about whether you are in it,
// and at five steps it reaches a block of Halcyon Quay — so the screen came up outdoors, over the
// street, before you got to the door.

import { on } from '../../server/engine/events.js';
import { getZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { prefersLoggedPanelsOrDefault } from '../../server/engine/presentation.js';
import { BOAT_TYPES, TYPES } from '../../client/game/js/panels/flight-model.js';
import { berthKind, berthCapacity, berthsNear, zonesNear, hullBand, REFIT_CAP, aboard } from './yard.js';
// The hour and the weather out the open end of the dock. The same `skyState` the helm's own payload
// asks for, at the BUILDING'S tile rather than the room's — an interior zone sits at grid 0,0 by
// construction, so asking it where it is answers the middle of the map.
import { skyState } from '../flight/state.js';

const pct = (v) => Math.max(0, Math.min(1, Number(v ?? 0)));
const KIND_WORD = { berth: 'afloat, alongside', covered: 'under cover', hard: 'on a cradle, outside' };

// ⚠ MEMOISED, BECAUSE THE CALLER IS `zone.entered` — the trucking depot's own note, and the reason
// it is there. `berthsNear` is a FOUR-STEP FLOOD FILL of the exit graph, and this is asked twice on
// every step every player takes anywhere in the world (once for where they went, once for where
// they came from) to answer a question that is false for almost every room in the game. Walked
// every time it is a real cost on the hottest path there is; walked once per zone it is nothing.
//
// ⚠ THE CACHE IS SAFE BECAUSE ITS INPUTS ARE CONTENT. Exits and the berth flags come out of
// `content/` and are fixed for the life of the process — a boat moving berth changes the ROWS,
// which this does not cache, and nothing here reads occupancy. A world reload is the one thing that
// would invalidate it, and that is a restart.
const YARDS = new Map();

// ⚠ THE WALK SAYS WHICH YARD, IT DOES NOT SAY WHETHER YOU ARE IN ONE — AND THOSE ARE NOT THE SAME
// QUESTION. `berthsNear` is a FIVE-STEP flood fill of the exit graph, which is exactly right for
// `berth`'s "is my boat here" (a marina is five rooms and two pontoons and no zone can name itself)
// and hopelessly wrong as a test for opening a screen: five steps off the Dock Hall reaches the
// facade, Halcyon Quay, the tiles either side of it and most of the way to the hardstanding, so the
// marina HUD came up over the street a block before you got to the door. Reported exactly that way.
//
// Being AT the marina is a much smaller claim and the world already carries it two ways: you are
// standing on a berth, or you are inside the building one of its berths is in. `building_name` is
// the same field `describe.js` uses to say which building a room belongs to, so this needs no new
// flag and a second game's marina gets it by authoring rooms the way every other building here is
// authored. The facade tile carries the name too and is deliberately harmless — a facade is a
// revolving door nobody can stand in.
function standingInYard(here, zones) {
  if (!here) return false;
  if (berthKind(here)) return true;                       // a pontoon, a cradle yard, a covered dock
  const name = here.flags?.building_name;
  if (!name || !here.flags?.is_interior) return false;    // the quay outside is not the marina
  return zones.some((z) => z.flags?.building_name === name);
}

export function yardHere(zoneId) {
  if (!zoneId) return null;
  if (YARDS.has(zoneId)) return YARDS.get(zoneId);
  const zones = berthsNear(zoneId);
  // ⚠ ASKED OF THE WHOLE WALK, NOT OF THE TILE. `boat_dealer` is deliberately independent of the
  // berth flags — a broker in an office needs no berth — so a player standing on the pontoon is at
  // a yard that sells hulls if the shed two rooms away does. `zonesNear` rather than `berthsNear`,
  // because the office the broker sits in is not itself a berth.
  const here = getZone(zoneId);
  const found = zones.length && standingInYard(here, zones)
    ? {
      zones,
      dealer: zonesNear(zoneId).find((z) => z.flags?.boat_dealer) || null,
      // Which ROOM of the yard this is. A berth is where the hulls are kept and where getting into
      // one is a thing you can do, so it is the room that gets the dock screen; everywhere else in
      // the building is the paperwork.
      dock: !!berthKind(here),
    }
    : null;
  YARDS.set(zoneId, found);
  return found;
}

/** Test seam: the cache is keyed on content, so only a world reload can stale it. */
export function _forgetYards() { YARDS.clear(); }

// ── THE PAYLOAD ──────────────────────────────────────────────────────────────
//
// ⚠ EVERY NUMBER HERE IS ONE THE TEXT RUNG PRINTS. `boatLine` is the prose version of the fleet
// card and `hullBand` is the word beside the bar; reading them from the same helpers is what stops
// the screen and the log disagreeing about a hull somebody is deciding whether to sell.
export async function marinaPanel(player, zoneId, tab = 'fleet') {
  const yard = yardHere(zoneId);
  if (!yard) return null;
  const here = getZone(zoneId);

  // ⚠ THE SEAT IS A FACT THE SERVER OWNS AND THE SCREEN WAS GUESSING AT. Board and Take the helm
  // were both unconditional buttons, so the fleet card offered them for a hull three rooms away and
  // for one you were already sitting in — and `embark` refuses away from the berth by design, which
  // is correct and reads as a dead button. Whether you can get in her is `berth_zone === here`,
  // whether you can drive her is `aboard`, and both of those are answers this file already has.
  const seated = aboard.get(player.id) || null;
  const mine = await query('SELECT * FROM boats WHERE owner_id = $1 ORDER BY created_at', [player.id]);
  const fleet = mine.rows.map((b) => {
    const t = TYPES[b.type_id];
    const z = b.berth_zone ? getZone(b.berth_zone) : null;
    return {
      id: b.id,
      typeId: b.type_id,
      name: b.name || (t ? t.name : b.type_id),
      typeName: t ? t.name : b.type_id,
      hull: pct(b.condition), band: hullBand(b.condition), fuel: pct(b.fuel),
      nitro: pct(b.custom_data?.nitro ?? 1),
      livery: b.custom_data?.livery || null,
      // Standing on the deck she is tied to — the one place `embark` will have you.
      hereNow: !!b.berth_zone && b.berth_zone === zoneId,
      aboard: seated === b.id,
      where: !b.berth_zone ? 'out on the water'
        : z ? `${z.name}, ${KIND_WORD[berthKind(z)] || 'laid up'}`
        : 'somewhere the yard has lost track of',
      whereShort: z ? z.name : 'out on the water',
    };
  });

  // ⚠ OCCUPANCY IS COUNTED, NEVER STORED — the yard's own rule, so a crash cannot leave a berth
  // believing it is full. One grouped query rather than one per berth, per the read tiers.
  const ids = yard.zones.map((z) => z.id);
  const taken = new Map();
  if (ids.length) {
    const r = await query('SELECT berth_zone, COUNT(*)::int AS n FROM boats WHERE berth_zone = ANY($1) GROUP BY berth_zone', [ids]);
    for (const row of r.rows) taken.set(row.berth_zone, row.n);
  }
  const berths = yard.zones.map((z) => ({
    name: z.name, kindWord: KIND_WORD[berthKind(z)] || '',
    capacity: berthCapacity(z), taken: taken.get(z.id) || 0,
  }));

  return {
    type: 'marina',
    tab,
    name: here?.flags?.building_name || here?.name || 'The Marina',
    credits: Number(player.credits || 0),
    fleet,
    berths,
    dealer: !!yard.dealer,
    // The room decides the screen: a berth gets the dock, everywhere else in the building gets the
    // paperwork. See `yardHere`.
    dock: !!yard.dock,
    hereName: here?.name || '',
    sky: skyOver(here),
    aboardId: seated,
    stock: yard.dealer ? BOAT_TYPES.map((t) => ({ id: t.id, name: t.name, price: t.price, blurb: t.blurb })) : [],
    // What a refit can reach HERE, which is the entire economic argument for paying for a roof.
    refitCap: capHere(yard.zones),
  };
}

// ⚠ THE PARENT TILE, NEVER THE ROOM'S OWN GRID. `berthGrid` in helm.js makes exactly this move and
// says why: a room inside a building carries no coordinates of its own.
function skyOver(here) {
  if (!here) return null;
  const g = (here.grid_x || here.grid_y) ? here : getZone(here.parent_zone) || here;
  try { return skyState(g.grid_x || 0, g.grid_y || 0) || null; } catch { return null; }
}

function capHere(zones) {
  let best = 0;
  for (const z of zones) {
    const k = berthKind(z);
    const c = k === 'covered' ? REFIT_CAP.covered : k === 'hard' ? REFIT_CAP.hard : REFIT_CAP.patch;
    if (c > best) best = c;
  }
  return best || null;
}

// ── ARRIVING AND LEAVING ─────────────────────────────────────────────────────

/**
 * Push the screen, or say nothing at all on the rungs that do not take one.
 *
 * ⚠ THE SENSE OF THIS TEST IS THE WHOLE FEATURE. `prefersLoggedPanels` is true ONLY on the
 * bottom rung — the one that strips every panel in the game — so it is what a caller uses to
 * decide to print TEXT INSTEAD, and that is what every other caller in the codebase does with it.
 * This file had it the other way round, so the marina screen was sent to the handful of players
 * who had asked for no screens and to nobody else: on `visual`, which is the default and so is
 * everybody, the panel never arrived and the yard had no interface at all. Every verb went on
 * working, which is exactly why it read as a feature nobody built rather than as a bug.
 */
export async function pushMarina(player, zoneId, tab = 'fleet') {
  if (await prefersLoggedPanelsOrDefault(player)) return false;
  const panel = await marinaPanel(player, zoneId, tab);
  if (!panel) return false;
  sendToPlayer(player.id, panel);
  return true;
}

/**
 * Re-push after anything that changed the world.
 *
 * ⚠ THE DEPOT'S OLDEST COMPLAINT, QUOTED. Buying a hull WORKED and looked as though it had not: the
 * server charged you, wrote the row and answered with a line of prose, while the panel over the top
 * still showed the same Buy button, an empty fleet and a stale balance. Nothing that changes the
 * world may end in a bare reply.
 */
export async function repushMarina(player, tab = 'fleet') {
  if (!player?.current_zone) return;
  await pushMarina(player, player.current_zone, tab).catch(() => {});
}

export function installMarinaShopfront() {
  on('zone.entered', async ({ actor, zone, from }) => {
    if (!actor?.id) return;
    try {
      // ⚠ `zone` IS AN ID ON THIS EVENT, not a zone. Both movement paths emit it as `targetId`.
      const to = zone?.id || zone;
      const wasIn = from ? !!yardHere(from) : false;
      const nowIn = !!yardHere(to);
      // ⚠ THE ROOM PICKS THE TAB, and that is the whole of what "walk in and see your boats" means.
      // Landed on `fleet` from every door, the dock was a list of cards about hulls that were
      // twenty feet away and in front of you.
      if (nowIn) { await pushMarina(actor, to, yardHere(to)?.dock ? 'dock' : 'fleet'); return; }
      // ⚠ AND WALKING OUT CLOSES IT, FROM ANY TILE OF THE YARD. See the header: asked of the tile
      // rather than the walk, leaving by the lobby would leave the shop window over the street.
      //
      // ⚠ AND ONLY WHEN THEY WERE ACTUALLY IN ONE. Sent unconditionally this is a packet on every
      // step every player takes anywhere in the world, for ever, to close a panel almost none of
      // them has open — which is the kind of cost that never shows up as a bug, only as a number on
      // the egress report that nobody can account for.
      if (wasIn) sendToPlayer(actor.id, { type: 'marina_close' });
    } catch (e) { console.error('[powerboat] marina shopfront:', e.message); }
  });
}
