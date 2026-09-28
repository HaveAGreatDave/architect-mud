// THE BOATYARD — where a hull lives when nobody is driving it.
//
// The piece `index.js` has been holding a seam open for: "the drive verb, the boatyard and the
// panel are the next piece". This is the boatyard half. It owns four verbs and no physics.
//
// ── THE MODEL ────────────────────────────────────────────────────────────────
//
// A boat is a ROW (`boats`), never an inventory item and never a zone. That is the schema's own
// decision and it is the one that makes everything here cheap: `owner_id` is who she belongs to,
// `berth_zone` is where she is, `condition` is the hull, and a restart brings her back tied up
// because the row says where. Nothing about a boat is per-tick, so nothing about a boat is in RAM
// except who is currently sitting in one.
//
// ⚠ WHERE SHE IS, IS A ZONE ID, AND THE THREE KINDS OF PLACE ARE CONTENT. A berth is any zone the
// world says is one, and this file reads flags rather than coordinates:
//
//   `marina_berths: N`   a pontoon. She is afloat, tied alongside, ready to go. N is the capacity.
//   `boat_hardstanding`  an open apron. She is up on a cradle under a cover. Cheap, and outside.
//   `boat_covered`       a shed with a roof and a hoist. Expensive, and the ONLY place a refit is
//                        finished properly, which is the entire reason to pay for it.
//
// A second game built on THOMAS gets all three by painting flags on tiles. Nothing here knows the
// word "Halcyon" and nothing here knows a coordinate.
//
// ⚠ AND THERE IS A FOURTH PLACE NOBODY AUTHORS: open water. `berth_zone` pointing at an ordinary
// swimmable tile is a hull lying out in the Basin where her driver stepped off her, and the schema
// anticipated it from the first line it was written (`berth_zone TEXT — where she is tied up; null
// = out on the water`) against a game in which nothing could put her there. See `isOpenWater`,
// which is deliberately NOT a fourth answer from `berthKind`.
//
// ⚠ AND CAPACITY IS COUNTED AGAINST THE ROWS, NEVER STORED. A berth does not carry an occupancy
// field that a crash could leave wrong — "how many are here" is `SELECT count(*) WHERE berth_zone
// = $1`, which is the only answer that cannot drift from the boats themselves.

import { query } from '../../server/models/db.js';
import { getZone, getZoneNpcs, propsOf, getAllZones } from '../../server/engine/world.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getItem } from '../../server/engine/items-cache.js';
import { TYPES, BOAT_TYPES } from '../../client/game/js/panels/flight-model.js';
import { boatRental, boatRentalExpired, boatRentFee, BOAT_RENT_TERM_MS, BOAT_RENT_REFUSE, BOAT_SERVICE,
  boatServicePrice, stampBoatService, BOAT_SCHEMES, BOAT_DECALS, BOAT_PAINT_PRICE, BOAT_DECAL_PRICE, wetChange } from './service.js';
// ⚠ A CYCLE INSIDE ONE PLUGIN, AND SAFE FOR THE STATED REASON: helm.js imports `aboard` from here,
// and this reads `boatTake` only inside a function body, after both modules have evaluated.
import { boatTake, applyLive } from './helm.js';
import { deskReady, deskRefusal } from './desk.js';

// ── TUNING ───────────────────────────────────────────────────────────────────
//
// The marina is open to anybody and priced steeply, which is the faction statement: the Ascendants
// run it as a business and the gate is your wallet rather than your standing. A player who has just
// bought the cheapest hull in the game has spent 14,500, so a four-figure move-in is a real decision
// and not a toll.
export const MOVE_IN = { berth: 900, covered: 1600, hard: 350 };

// What a refit can put back, and where. The same field-vs-bench split `durability.js` draws for
// gear, and for the same reason: the thing that makes a covered shed worth paying for is that it is
// the only place the job is finished.
export const REFIT_CAP = { patch: 0.55, hard: 0.80, covered: 1.00 };
export const PATCH_GAIN = 0.18;          // what one hull patch puts back, before the cap bites
export const REFIT_RATE = 26;            // credits per point of hull, at a proper shed

// ── WHAT A PLACE IS ──────────────────────────────────────────────────────────

/** The kind of berth this zone is, or null. Content decides; this only reads. */
export function berthKind(zone) {
  if (!zone) return null;
  const f = zone.flags || {};
  if (f.boat_covered) return 'covered';
  if (f.boat_hardstanding) return 'hard';
  if (Number(f.marina_berths) > 0) return 'berth';
  return null;
}

/** How many hulls this zone holds. A cradle yard and a shed carry their own count. */
export function berthCapacity(zone) {
  const f = zone?.flags || {};
  return Number(f.marina_berths) || Number(f.boat_covered) || Number(f.boat_hardstanding) || 0;
}

const KIND_WORD = { berth: 'afloat, alongside', covered: 'under cover', hard: 'on a cradle, outside' };

/**
 * Open water she could be left lying in — the fourth place a hull can be, and the only one no
 * author ever writes down.
 *
 * ⚠ DELIBERATELY NOT A FOURTH ANSWER FROM `berthKind`, WHICH WOULD HAVE BEEN THE SHORT WAY AND IS
 * WRONG. Eight things read that function and most of them mean "is this a place the yard LETS" —
 * `berthsNear` filters on it, the move-in board prints it, `firstFreeBerth` counts against it, and
 * `standingInYard` in shopfront.js opens the marina screen on it. Answering `adrift` from there
 * would put every water tile on the Basin into the yard's own board, offer to move hulls into the
 * middle of the bay for ₵0, and throw the marina HUD up over open water. A boat adrift is not at a
 * berth; she is just somewhere, and only two things need to know it.
 *
 * ⚠ AND IT IS THE RESOLVED PROPERTY, NEVER THE PAINT. `propsOf(id).swimmable` is the capability;
 * `terrain: 'water'` is what the tile is painted, and the two come apart on purpose — a pontoon
 * deck is painted water and is not swimmable, which is exactly the tile a boat must NOT be called
 * adrift at because it is a real berth.
 */
export function isOpenWater(zone) {
  if (!zone || berthKind(zone)) return false;
  const p = propsOf(zone.id) || {};
  return !!p.swimmable && !p.underwater;
}

/**
 * Every berth zone in the same marina as `zone` — used to answer "is my boat HERE" generously.
 *
 * ⚠ THE MARINA IS THE WALK, NOT A NAME. A player standing on the outer pontoon and a player in the
 * Conservatory are both "at the marina" and neither zone can say so on its own. Rather than invent
 * a `marina_id` for authors to get wrong, this walks the exits out to `REACH` steps and keeps every
 * berth it can get to on foot — which is the same thing a person means by "here", and it is true
 * for a second game's marina laid out a completely different way.
 */
// ⚠ FIVE, BECAUSE THE MARINA GREW A LOBBY. It was 4, which walked the pontoon, the covered dock,
// the facade, the quay and the cradle yard as one place. Putting a lobby and a restaurant between
// the dock and the front door added a step to every one of those journeys, and at 4 the cradle
// yard fell off the end of it: standing in the shed, `berth` reported the apron fifty metres away
// as 'another yard'. The number is the LENGTH OF THE LONGEST WALK INSIDE ONE MARINA, so it moves
// when somebody puts a room in the middle of one — which is the whole reason it is a reach in
// steps rather than a `marina_id` an author has to keep right.
//
// ⚠ AND SEVEN, BECAUSE THE MARINA GREW A FUEL FLOAT — the same paragraph again, one berth later,
// which is the whole argument for keeping this a reach in steps rather than a `marina_id`. The
// float is a walkway off the north end of the hardstanding, and the hardstanding is already the
// far end of the yard: Dock Hall → lobby → facade → quay → quay → hardstanding → float is six,
// and the Gallery and the Counter are one further out again at seven. At five the yard's only
// pump was 'another yard' from the shed the hulls are kept in, which is the same bug as before
// wearing the same costume. Still the LENGTH OF THE LONGEST WALK INSIDE ONE MARINA.
//
// ⚠ IT IS NOT FREE AND IT IS NOT HOT. `yardHere` memoises per zone id on inputs that are content,
// so the walk happens once per room for the life of the process; the verbs that call it directly
// are typed. Nothing on a per-tick or per-swing path asks.
const REACH = 7;
export function zonesNear(zoneId) {
  const seen = new Set([zoneId]);
  const out = [];
  let edge = [zoneId];
  for (let step = 0; step <= REACH && edge.length; step++) {
    const next = [];
    for (const id of edge) {
      const z = getZone(id);
      if (!z) continue;
      out.push(z);
      for (const t of Object.values(z.exits || {})) {
        for (const tid of (Array.isArray(t) ? t : [t])) {
          if (tid && !seen.has(tid)) { seen.add(tid); next.push(tid); }
        }
      }
    }
    edge = next;
  }
  return out;
}

// ⚠ THE DEALER LOOKUP IS NOT FILTERED THROUGH `berthKind`. An earlier cut searched only berth zones
// for `boat_dealer`, which silently required every dealer to also be a berth — true of the
// Conservatory by luck, and a flag that does nothing on the day somebody puts a broker in an office.
export function berthsNear(zoneId) {
  return zonesNear(zoneId).filter(berthKind);
}

// ── READING A BOAT ───────────────────────────────────────────────────────────

const pct = (v) => Math.max(0, Math.min(100, Math.round((v ?? 0) * 100)));

/** The five hull bands. Named rather than numeric, the same way gear condition reads. */
export function hullBand(c) {
  const v = c ?? 1;
  if (v >= 0.92) return 'sound';
  if (v >= 0.72) return 'marked';
  if (v >= 0.48) return 'worked';
  if (v >= 0.22) return 'tender';
  return 'unsound';
}

export function boatLine(row, { where = true } = {}) {
  const t = TYPES[row.type_id];
  const name = row.name || (t ? t.name : row.type_id);
  const z = row.berth_zone ? getZone(row.berth_zone) : null;
  // ⚠ ADRIFT READS AS A PLACE, NOT AS A FAULT. Before anything could leave a hull on the water
  // the only way to reach the third arm was a berth zone that had been deleted out from under
  // her, so "somewhere the yard has lost track of" was the right sentence; a boat you tied to
  // nothing off Halcyon Quay on purpose is not lost, and telling you it is would send you to the
  // yard to ask about a hull you know perfectly well where you left.
  const place = !row.berth_zone ? 'out on the water'
    : isOpenWater(z) ? `adrift off ${z.name}`
    : z ? `${z.name}, ${KIND_WORD[berthKind(z)] || 'laid up'}` : 'somewhere the yard has lost track of';
  return `<span class="text-cyan">${name}</span>`
    + `<span class="text-dim"> (${t ? t.name : row.type_id})</span>`
    + `: hull <span class="text-${pct(row.condition) < 50 ? 'red' : 'green'}">${pct(row.condition)}%</span> ${hullBand(row.condition)}`
    + `, fuel ${pct(row.fuel)}%`
    + (where ? `\n    <span class="text-dim">${place}</span>` : '');
}

export async function myBoats(playerId) {
  const r = await query('SELECT * FROM boats WHERE owner_id = $1 ORDER BY created_at', [playerId]);
  return r.rows;
}

/**
 * The one boat a command means.
 *
 * ⚠ NOT SIFT. SIFT resolves things in the ROOM — items, NPCs, furniture — and a boat is a database
 * row that may be a mile away in a shed. Handing it to SIFT would mean minting a fake room entity
 * per hull, which is a second representation of a boat and the thing this file most wants to avoid.
 * A fleet is small and its names are the player's own, so a prefix match over their own rows is
 * both sufficient and unambiguous in a way a room search is not.
 */
export function pickBoat(rows, arg) {
  if (!rows.length) return { none: true };
  const q = (arg || '').trim().toLowerCase();
  if (!q) return rows.length === 1 ? { boat: rows[0] } : { ambiguous: rows };
  // THE ID FIRST, AND EXACTLY. Every button on the marina screen names a hull by id, so a click is
  // never a prefix match that two boats called "Rooster" could both answer to.
  const exact = rows.find((b) => b.id.toLowerCase() === q);
  if (exact) return { boat: exact };
  const hit = rows.filter(b => {
    const t = TYPES[b.type_id];
    return (b.name || '').toLowerCase().includes(q)
      || (t && t.name.toLowerCase().includes(q))
      || b.type_id.toLowerCase().startsWith(q);
  });
  if (!hit.length) return { miss: true };
  if (hit.length > 1) return { ambiguous: hit };
  return { boat: hit[0] };
}

const say = (message) => ({ type: 'output', message });

// ── `boats` — THE FLEET ──────────────────────────────────────────────────────
//
// Works anywhere, like `fleet` does for aircraft. A boat is an asset you own rather than a thing in
// the room, so needing to stand somewhere particular to be told what you own would be a puzzle.

export async function cmdBoats(args, raw, player) {
  const rows = await myBoats(player.id);
  if (!rows.length) {
    return say('<span class="text-dim">You do not own a boat. Yards that sell them are on the water; try the west shore.</span>');
  }
  const lines = rows.map((b, i) => `  <span class="text-dim">${i + 1}.</span> ${boatLine(b)}`);
  return say(`<span class="text-cyan">YOUR BOATS</span>\n${lines.join('\n')}`);
}

// ── `boat` — THE DEALER ──────────────────────────────────────────────────────
//
// `BOAT_TYPES` has carried the comment "the boatyard's stock list" since it was written, derived off
// `water: true` rather than restated, and until now there was no boatyard to be the stock list OF.
//
// ⚠ SINGULAR BUYS, PLURAL OWNS, and both say so in their own output, because `boat` and `boats` one
// letter apart is a real way to mistype your way into the wrong screen.

// ⚠ THE DESK, NOT THE WALK — see desk.js. A dealer found anywhere within reach sold hulls from the
// dock and the pontoons; buying and hiring are the clerk's job now.
function dealerHere(player) {
  return deskReady(player) ? getZone(player.current_zone) : null;
}

export async function cmdBoat(args, raw, player) {
  // ── THE COUNTER'S OTHER THREE JOBS ─────────────────────────────────────────
  // `take` is the card on the marina's first screen: it seats you in a hull where she lies, in the
  // real water, and hands you the helm. `rent` and `return` are the hire desk (service.js). All
  // three are words no hull on the line is called, so they sit ahead of the dealer's name match.
  const sub = String(args[0] || '').toLowerCase();
  if (sub === 'take' || sub === 'launch' || sub === 'out') return await boatTake(player, args.slice(1).join(' '));
  if (sub === 'rent' || sub === 'hire') return await boatRent(player, args.slice(1).join(' '));
  if (sub === 'return' || sub === 'handback') return await boatReturn(player, args.slice(1).join(' '));
  const shed = dealerHere(player);
  if (!shed) {
    return say(`<span class="text-dim">${deskRefusal(player)}</span>`);
  }
  const arg = args.join(' ').trim().toLowerCase();
  if (!arg) {
    const lines = BOAT_TYPES.map(t =>
      `  <span class="text-cyan">${t.name}</span> <span class="text-dim">(${t.id})</span>: <span class="text-green">₵${t.price.toLocaleString()}</span>`
      + `\n    <span class="text-dim">${t.blurb}</span>`);
    return say(`<span class="text-cyan">HULLS, BY ARRANGEMENT</span>\n${lines.join('\n')}`
      + `\n\n<span class="text-dim">buy one with <span class="text-white">boat &lt;name&gt;</span>. What you already own is <span class="text-white">boats</span>.</span>`);
  }
  const type = BOAT_TYPES.find(t => t.id === arg || t.name.toLowerCase().includes(arg));
  if (!type) return say(`<span class="text-dim">Nothing here called "${arg}".</span>`);

  // Somewhere to put her, before any money moves. A yard that sells you a boat it has nowhere to
  // keep is a yard that has taken 14,500 credits off you for a row nothing can reach.
  const home = await firstFreeBerth(berthsNear(player.current_zone));
  if (!home) return say('<span class="text-dim">Every berth, cradle and bay here is full. There is nowhere to put her, and they will not sell you one they cannot keep.</span>');

  if ((player.credits ?? 0) < type.price) {
    return say(`<span class="text-red">₵${type.price.toLocaleString()}.</span> <span class="text-dim">You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
  }
  await adjustCredits(player, -type.price, query, 'boat purchase');
  const id = `boat_${player.id}_${Date.now().toString(36)}`;
  // ⚠ THE BERTH IS WRITTEN TWICE AND THE TWO MEAN DIFFERENT THINGS. `berth_zone` is where she is
  // RIGHT NOW, and it moves every time anybody touches her — including onto a piece of open water
  // the moment somebody steps off her out in the Basin. `home_berth` is where she BELONGS, which
  // is the address a recovery driver is given, and it changes only when you deliberately move her
  // in somewhere. Without the second one a tow has nowhere to take a hull except the water she is
  // already lying in, and "recovered" would mean nothing at all.
  await query(
    `INSERT INTO boats (id, type_id, name, owner_id, berth_zone, fuel, condition, custom_data)
     VALUES ($1, $2, $3, $4, $5, 1, 1, jsonb_build_object('home_berth', $5::text))`,
    [id, type.id, type.name, player.id, home.zone.id],
  );
  return say(`<span class="text-green">Bought.</span> A ${type.name}, hull sound, tank full.`
    + `\n<span class="text-dim">She is at ${home.zone.name}, ${KIND_WORD[berthKind(home.zone)]}. ₵${type.price.toLocaleString()} gone.</span>`);
}

// ── THE HIRE DESK ────────────────────────────────────────────────────────────
// See service.js for the model. One hire at a time, at a yard that sells hulls, into the first free
// berth — which from the Dock Hall is the covered dock, so a hire comes out of the same slot a
// bought boat does.

/** Every hire of this player's that has run out and is not being sailed goes back. */
export async function sweepBoatRentals(playerId) {
  const rows = await myBoats(playerId);
  const seated = aboard.get(playerId);
  const gone = [];
  for (const b of rows) {
    if (!boatRentalExpired(b) || b.id === seated) continue;
    const r = await query("DELETE FROM boats WHERE id = $1 AND owner_id = $2 AND custom_data->'rental' IS NOT NULL", [b.id, playerId]).catch(() => ({ rowCount: 0 }));
    if (r.rowCount) gone.push(b.name || TYPES[b.type_id]?.name || 'the hire');
  }
  return gone;
}

async function boatRent(player, arg) {
  if (!dealerHere(player)) return say(`<span class="text-dim">${deskRefusal(player)}</span>`);
  const q = String(arg || '').trim().toLowerCase();
  if (!q) {
    const lines = BOAT_TYPES.map((t) => `  <span class="text-cyan">${t.name}</span> <span class="text-dim">(${t.id})</span>: <span class="text-green">₵${boatRentFee(t).toLocaleString()}</span> for ${BOAT_RENT_TERM_MS / 3600000} hours`);
    return say(`<span class="text-cyan">FOR HIRE</span>\n${lines.join('\n')}\n<span class="text-dim">boat rent &lt;name&gt;. One at a time; she goes back on her own when the time is up and she is tied up.</span>`);
  }
  const type = BOAT_TYPES.find((t) => t.id === q || t.name.toLowerCase().includes(q));
  if (!type) return say(`<span class="text-dim">Nothing on the hire line called "${q}".</span>`);
  await sweepBoatRentals(player.id);
  const have = (await myBoats(player.id)).find((b) => boatRental(b));
  if (have) return say(`<span class="text-dim">You already have ${have.name || 'a hull'} out on hire. Bring her back first: <span class="text-white">boat return</span>.</span>`);
  const fee = boatRentFee(type);
  if ((player.credits ?? 0) < fee) return say(`<span class="text-red">₵${fee.toLocaleString()} for the hire.</span> <span class="text-dim">You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
  const home = await firstFreeBerth(berthsNear(player.current_zone));
  if (!home) return say('<span class="text-dim">Every berth here is full. There is nowhere to bring a hire round to.</span>');
  await adjustCredits(player, -fee, query, 'boat hire');
  const id = `boat_${player.id}_${Date.now().toString(36)}`;
  const cd = { home_berth: home.zone.id, rental: { until: Date.now() + BOAT_RENT_TERM_MS, fee, from: home.zone.id } };
  await query(
    `INSERT INTO boats (id, type_id, name, owner_id, berth_zone, fuel, condition, custom_data)
     VALUES ($1, $2, $3, $4, $5, 1, 1, $6::jsonb)`,
    [id, type.id, `Hire ${type.name.split(' ').pop()}`, player.id, home.zone.id, JSON.stringify(cd)],
  );
  return say(`<span class="text-green">Hired.</span> A ${type.name} for ${BOAT_RENT_TERM_MS / 3600000} hours, tank full.`
    + `\n<span class="text-dim">She is at ${home.zone.name}, ${KIND_WORD[berthKind(home.zone)]}. ₵${fee.toLocaleString()}.</span>`);
}

async function boatReturn(player, arg) {
  const reach = berthsNear(player.current_zone).map((z) => z.id);
  if (!reach.length) return say('<span class="text-dim">Hand a hire back at a marina.</span>');
  const hires = (await myBoats(player.id)).filter((b) => boatRental(b));
  const q = String(arg || '').trim().toLowerCase();
  const boat = q ? hires.find((b) => b.id.toLowerCase() === q || (b.name || '').toLowerCase().includes(q)) : hires[0];
  if (!boat) return say('<span class="text-dim">You have no hire boat to hand back.</span>');
  if (aboard.get(player.id) === boat.id) return say('<span class="text-dim">Step off her first.</span>');
  if (!reach.includes(boat.berth_zone)) return say('<span class="text-dim">She is not lying at this marina. Bring her in first.</span>');
  await query("DELETE FROM boats WHERE id = $1 AND owner_id = $2 AND custom_data->'rental' IS NOT NULL", [boat.id, player.id]);
  return say('<span class="text-green">The desk takes the key and a clipboard, walks down to look at her, and comes back without saying anything.</span>');
}

// ── THE COVERED SLOT ─────────────────────────────────────────────────────────
// A covered dock is a ROOM (it has no grid position) over a slot of real water, and the water is
// what the helm has to put a hull on — the room's own tile is the building, and a boat started on it
// is a boat started aground. The slot is the room's exit onto open water, and the way she lies in it
// is the way that exit points: bow out, under the roof, towards the Basin. Derived from the exits the
// room already has, so a second covered dock anywhere gets its slot without anybody authoring one.
const DIR_HEADING = { north: 0, east: 90, south: 180, west: 270 };
export function coveredSlot(zone) {
  if (!zone?.flags?.boat_covered) return null;
  for (const [dir, t] of Object.entries(zone.exits || {})) {
    for (const tid of (Array.isArray(t) ? t : [t])) {
      const w = tid && getZone(tid);
      if (!w || !(w.grid_x || w.grid_y) || !isOpenWater(w)) continue;
      return { zone: w, x: w.grid_x, y: w.grid_y, heading: DIR_HEADING[dir] ?? 0, room: zone };
    }
  }
  return null;
}
// The reverse: the covered room whose slot is this water tile. Content-keyed and built once, the
// `yardIndex` idiom, because it is asked from the telemetry tick.
let _slotIndex = null;
export function coveredRoomAtTile(zoneId) {
  if (!_slotIndex) {
    _slotIndex = new Map();
    for (const z of getAllZones()) {
      const s = coveredSlot(z);
      if (s) _slotIndex.set(s.zone.id, z);
    }
  }
  return _slotIndex.get(zoneId) || null;
}
export const _forgetSlots = () => { _slotIndex = null; };

async function firstFreeBerth(zones) {
  for (const zone of zones) {
    const cap = berthCapacity(zone);
    if (!cap) continue;
    const r = await query('SELECT count(*)::int AS n FROM boats WHERE berth_zone = $1', [zone.id]);
    if ((r.rows[0]?.n ?? 0) < cap) return { zone, free: cap - r.rows[0].n };
  }
  return null;
}

// ── `berth` — THE BOARD, AND MOVING A HULL ───────────────────────────────────

export async function cmdBerth(args, raw, player) {
  const here = getZone(player.current_zone);
  const kind = berthKind(here);
  const arg = args.join(' ').trim();

  if (!arg) {
    // The board. What this place is, what is in it, and what it costs.
    if (!kind) {
      const near = berthsNear(player.current_zone);
      if (!near.length) return say('<span class="text-dim">There is nowhere to keep a boat here.</span>');
      const lines = [];
      for (const z of near) lines.push(await berthStatusLine(z, player));
      return say(`<span class="text-cyan">MOORINGS WITHIN REACH</span>\n${lines.join('\n')}`);
    }
    const line = await berthStatusLine(here, player);
    const mine = (await myBoats(player.id)).filter(b => b.berth_zone === here.id);
    const yours = mine.length
      ? `\n\n<span class="text-cyan">YOURS HERE</span>\n${mine.map(b => '  ' + boatLine(b, { where: false })).join('\n')}`
      : '';
    return say(`<span class="text-cyan">${here.name.toUpperCase()}</span>\n${line}${yours}`
      + `\n\n<span class="text-dim">move a hull in with <span class="text-white">berth &lt;boat&gt;</span>.</span>`);
  }

  // Moving one in.
  if (!kind) return say('<span class="text-dim">You are not standing anywhere a boat can be kept.</span>');
  const rows = await myBoats(player.id);
  const pick = pickBoat(rows, arg);
  if (pick.none) return say('<span class="text-dim">You do not own a boat.</span>');
  if (pick.miss) return say(`<span class="text-dim">You do not own anything called "${arg}".</span>`);
  if (pick.ambiguous) return say(`<span class="text-dim">Which one? ${pick.ambiguous.map(b => b.name || TYPES[b.type_id]?.name).join(', ')}.</span>`);
  const boat = pick.boat;
  if (boat.berth_zone === here.id) return say(`<span class="text-dim">She is already here.</span>`);

  // ⚠ REACHABLE ON FOOT, OR SHE STAYS WHERE SHE IS. A hoist lifts a hull across a yard; it does not
  // lift one across the Basin. Without this, `berth` is a teleport that moves an asset from one side
  // of the map to the other for a flat fee, which is a worse travel system than the game already has.
  const reach = berthsNear(player.current_zone).map(z => z.id);
  if (boat.berth_zone && !reach.includes(boat.berth_zone)) {
    const z = getZone(boat.berth_zone);
    return say(`<span class="text-dim">She is at ${z ? z.name : 'another yard'}, which is not this yard. A hoist moves a hull across a shed, not across the Basin.</span>`);
  }

  const cap = berthCapacity(here);
  const r = await query('SELECT count(*)::int AS n FROM boats WHERE berth_zone = $1', [here.id]);
  if ((r.rows[0]?.n ?? 0) >= cap) return say('<span class="text-dim">Full. Nothing free here.</span>');

  const fee = MOVE_IN[kind] ?? 0;
  if ((player.credits ?? 0) < fee) {
    return say(`<span class="text-red">₵${fee.toLocaleString()} to move her in.</span> <span class="text-dim">You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
  }
  if (fee) await adjustCredits(player, -fee, query, 'berth fee');
  // Moving her in is the one act that says where she belongs — see the note at the purchase. Both
  // in one statement so a hull can never end up living at a berth she is not standing in.
  await query(
    `UPDATE boats SET berth_zone = $1,
       custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{home_berth}', to_jsonb($1::text), true)
     WHERE id = $2`, [here.id, boat.id]);
  // FOULING'S CLOCK (service.js): lifted into a shed or onto a cradle it stops, afloat at a pontoon
  // it runs. Banked on the move, the only moment the state changes.
  const wet = wetChange(boat.custom_data || {}, kind === 'berth');
  if (wet) await query('UPDATE boats SET custom_data = $2::jsonb WHERE id = $1', [boat.id, JSON.stringify(wet)]);
  const name = boat.name || TYPES[boat.type_id]?.name || 'she';
  const how = kind === 'covered'
    ? 'The slings take her, she comes up dripping, and the hall closes over her.'
    : kind === 'hard'
      ? 'Up out of the water, onto a cradle, chocked and strapped.'
      : 'Alongside, two lines on, fenders down.';
  return say(`<span class="text-green">${how}</span>\n<span class="text-dim">${name} is at ${here.name}${fee ? `. ₵${fee.toLocaleString()}` : ''}.</span>`);
}

async function berthStatusLine(zone, player) {
  const kind = berthKind(zone);
  const cap = berthCapacity(zone);
  const r = await query('SELECT count(*)::int AS n FROM boats WHERE berth_zone = $1', [zone.id]);
  const used = r.rows[0]?.n ?? 0;
  const fee = MOVE_IN[kind] ?? 0;
  return `  <span class="text-cyan">${zone.name}</span> <span class="text-dim">· ${KIND_WORD[kind]}</span>`
    + `\n    ${used} of ${cap} taken · <span class="text-green">₵${fee.toLocaleString()}</span> to move in`;
}

// ── `refit` — THE HULL ───────────────────────────────────────────────────────
//
// ⚠ THE VERB IS `refit` BECAUSE `fix` AND `repair` ARE BOTH TAKEN — `fix` by trucking and `repair`
// by flight and wear. A plugin command silently beats an engine builtin and the other way round is
// not true, so a collision here is not an error at load, it is one of two systems quietly stopping
// working. Checked against every `plugin.json` command array before it was written, which is the
// check psionics' own doc says is necessary and NOT sufficient.

export async function cmdRefit(args, raw, player) {
  // The shipwright's other four jobs, ahead of the hull. None of them is a word a boat is called.
  const sub = String(args[0] || '').toLowerCase();
  if (REFIT_JOBS.has(sub)) return await refitJob(player, sub, args.slice(1));
  const here = getZone(player.current_zone);
  const rows = await myBoats(player.id);
  const pick = pickBoat(rows, args.join(' ').trim());
  if (pick.none) return say('<span class="text-dim">You do not own a boat.</span>');
  if (pick.miss) return say('<span class="text-dim">You do not own anything by that name.</span>');
  if (pick.ambiguous) return say(`<span class="text-dim">Which one? ${pick.ambiguous.map(b => b.name || TYPES[b.type_id]?.name).join(', ')}.</span>`);
  const boat = pick.boat;
  const name = boat.name || TYPES[boat.type_id]?.name || 'she';

  if ((boat.condition ?? 1) >= 0.999) return say(`<span class="text-dim">${name} is sound. There is nothing to do to her.</span>`);

  // WHERE the work happens decides how far it goes. A shed with a hoist and a shipwright in it is
  // the only place a hull comes back to sound; everything else is holding it together.
  const atBoat = boat.berth_zone && berthsNear(player.current_zone).some(z => z.id === boat.berth_zone);
  const kind = berthKind(here);
  const wright = getZoneNpcs(player.current_zone).find(n => n?.flags?.repairman);

  // Seated in her in the covered slot counts as being at her in the shed.
  const seated = aboard.get(player.id) === boat.id ? await benchFor(player, boat) : null;
  const wrightName = seated?.ok ? seated.wright : wright?.name;
  if ((atBoat && kind === 'covered' && wright) || seated?.ok) {
    const cap = REFIT_CAP.covered;
    const gain = cap - (boat.condition ?? 1);
    const cost = Math.max(1, Math.round(gain * 100 * REFIT_RATE));
    if ((player.credits ?? 0) < cost) {
      return say(`<span class="text-dim">${wrightName} looks the hull over and writes a figure on a docket.</span>`
        + `\n<span class="text-red">₵${cost.toLocaleString()}.</span> <span class="text-dim">You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
    }
    await adjustCredits(player, -cost, query, 'boat refit');
    await query('UPDATE boats SET condition = $1 WHERE id = $2', [cap, boat.id]);
    // ⚠ AND THE HULL SHE IS SITTING IN, if you are sitting in her — the telemetry's one-way clamp
    // would otherwise write the old number straight back over the repair ten seconds later.
    await applyLive(player, boat.id, { hull: cap });
    return say(`<span class="text-green">${wrightName} takes the job.</span> It is not quick and you do not watch all of it.`
      + `\n<span class="text-dim">${name} comes back sound. ₵${cost.toLocaleString()}.</span>`);
  }

  // Away from a shed: a patch out of your own pocket, and it is capped well short of sound.
  const patch = await findPatch(player);
  if (!patch) {
    const why = !atBoat ? `${name} is not here.`
      : kind === 'covered' ? 'There is nobody here to do the work.'
        : 'This is not a shed, and you have nothing to patch her with.';
    return say(`<span class="text-dim">${why}</span>`);
  }
  const cap = kind === 'hard' ? REFIT_CAP.hard : REFIT_CAP.patch;
  if ((boat.condition ?? 1) >= cap) {
    return say(`<span class="text-dim">A patch will not take her past ${Math.round(cap * 100)}%, and she is already there. That is shed work.</span>`);
  }
  const next = Math.min(cap, (boat.condition ?? 1) + PATCH_GAIN);
  await query('UPDATE boats SET condition = $1 WHERE id = $2', [next, boat.id]);
  await applyLive(player, boat.id, { hull: next });
  // ⚠ DECREMENT A STACK, DELETE A SINGLE. A flat DELETE here destroys the other four patches in the
  // tin along with the one you used, which is silent, expensive and only noticed much later.
  if ((patch.quantity ?? 1) > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = $1', [patch.id]);
  else await query('DELETE FROM player_inventory WHERE id = $1', [patch.id]);
  return say(`<span class="text-green">You get a patch over it.</span> Cloth, accelerator, and about nine minutes with a scraper.`
    + `\n<span class="text-dim">${name} is ${hullBand(next)} at ${pct(next)}%. It will hold. It is not a repair.</span>`);
}

// ── THE SHIPWRIGHT'S BENCH, BEYOND THE HULL ──────────────────────────────────
// Servicing (oil, prop, the bottom), paint, a decal and a name. All four are shed work: the hull has
// to be lying at a covered berth in this yard with a shipwright in the room, or you have to be
// sitting in her, stopped, in that berth's slot — which is the same place, seen from the water.
const REFIT_JOBS = new Set(['service', 'paint', 'decal', 'name']);
const HIRE_BARRED = new Set(['paint', 'decal', 'name']);

async function refitJob(player, job, rest) {
  const rows = await myBoats(player.id);
  // An id first (the panel always sends one), then the ordinary pick for somebody typing.
  const first = String(rest[0] || '');
  let pick = first ? pickBoat(rows, first) : pickBoat(rows, '');
  let args = first && pick.boat ? rest.slice(1) : rest;
  if (!pick.boat && rows.length === 1) { pick = { boat: rows[0] }; args = rest; }
  if (pick.none) return say('<span class="text-dim">You do not own a boat.</span>');
  if (!pick.boat) return say(`<span class="text-dim">Which one? ${rows.map((b) => b.name || TYPES[b.type_id]?.name).join(', ')}.</span>`);
  const boat = pick.boat;
  const name = boat.name || TYPES[boat.type_id]?.name || 'she';
  if (boatRental(boat) && HIRE_BARRED.has(job)) return say(`<span class="text-dim">${BOAT_RENT_REFUSE}</span>`);

  const bench = await benchFor(player, boat);
  if (!bench.ok) return say(`<span class="text-dim">${bench.why}</span>`);
  const cd = boat.custom_data || {};
  const type = TYPES[boat.type_id] || TYPES.hydro;
  const charge = async (cost, what) => {
    if ((player.credits ?? 0) < cost) return false;
    if (cost) await adjustCredits(player, -cost, query, what);
    return true;
  };
  const save = (next) => query('UPDATE boats SET custom_data = $2::jsonb WHERE id = $1', [boat.id, JSON.stringify(next)]);

  if (job === 'service') {
    const which = String(args[0] || 'all').toLowerCase();
    if (which !== 'all' && !BOAT_SERVICE[which]) return say(`<span class="text-dim">refit service ${boat.id} oil|prop|scrub|all</span>`);
    const cost = boatServicePrice(type, which);
    if (!await charge(cost, 'boat service')) return say(`<span class="text-red">₵${cost.toLocaleString()}.</span> <span class="text-dim">You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
    const next = stampBoatService(cd, which, { afloat: bench.live });
    await save(next);
    await applyLive(player, boat.id, { cd: next });
    const line = which === 'all' ? `${bench.wright} goes over her end to end: oil, a new prop, and the bottom scraped back to gelcoat.`
      : which === 'oil' ? 'The old oil comes out like tar. The new goes in gold.'
      : which === 'prop' ? 'The chewed prop comes off with a puller and a swear word, and a new one goes on.'
      : 'The slings take her and the weed comes off in sheets.';
    return say(`<span class="text-green">${line}</span> <span class="text-dim">₵${cost.toLocaleString()}.</span>`);
  }
  if (job === 'paint') {
    const id = String(args[0] || '').toLowerCase();
    const scheme = BOAT_SCHEMES.find((s) => s.id === id);
    if (!scheme) return say(`<span class="text-dim">refit paint ${boat.id} ${BOAT_SCHEMES.map((s) => s.id).join('|')}</span>`);
    const decal = cd.livery?.decal;
    const next = { ...cd };
    if (scheme.livery) next.livery = { ...scheme.livery, ...(decal ? { decal } : {}) };
    else if (decal) next.livery = { decal };
    else delete next.livery;
    if (JSON.stringify(next.livery || null) === JSON.stringify(cd.livery || null)) return say('<span class="text-dim">She is already in those colours.</span>');
    const cost = scheme.livery ? BOAT_PAINT_PRICE : Math.round(BOAT_PAINT_PRICE / 2);
    if (!await charge(cost, 'boat paint')) return say(`<span class="text-red">₵${cost.toLocaleString()}.</span> <span class="text-dim">You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
    await save(next);
    await applyLive(player, boat.id, { cd: next });
    return say(`<span class="text-green">${scheme.livery ? `Masked, sprayed and flatted back: ${scheme.label.toLowerCase()}.` : 'Stripped back to the colours she left the builder in.'}</span> <span class="text-dim">₵${cost.toLocaleString()}.</span>`);
  }
  if (job === 'decal') {
    const id = String(args[0] || '').toLowerCase();
    const art = BOAT_DECALS.find((a) => a.id === id);
    if (!art) return say(`<span class="text-dim">refit decal ${boat.id} ${BOAT_DECALS.map((a) => a.id).join('|')}</span>`);
    if ((cd.livery?.decal || 'none') === id) return say('<span class="text-dim">That is what is on her now.</span>');
    const next = { ...cd, livery: { ...(cd.livery || {}), decal: id } };
    if (id === 'none') { delete next.livery.decal; if (!Object.keys(next.livery).length) delete next.livery; }
    const cost = id === 'none' ? 0 : BOAT_DECAL_PRICE;
    if (!await charge(cost, 'boat decal')) return say(`<span class="text-red">₵${cost.toLocaleString()}.</span> <span class="text-dim">You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
    await save(next);
    await applyLive(player, boat.id, { cd: next });
    return say(`<span class="text-green">${id === 'none' ? 'The topsides are cut back clean.' : `${art.label}, signwritten down both sides.`}</span>${cost ? ` <span class="text-dim">₵${cost.toLocaleString()}.</span>` : ''}`);
  }
  // job === 'name'
  const clean = args.join(' ').replace(/[<>]/g, '').trim().slice(0, 24);
  if (!clean) return say('<span class="text-dim">Call her what?</span>');
  await query('UPDATE boats SET name = $2 WHERE id = $1', [boat.id, clean]);
  await applyLive(player, boat.id, { name: clean });
  return say(`<span class="text-green">${bench.wright} paints <b>${clean}</b> across her transom in a hand that has done it before.</span> <span class="text-dim">(${name} no longer.)</span>`);
}

/**
 * Is this hull at a shipwright's bench? Lying at a covered berth in reach with one in the room, or
 * sat in, stopped, in that berth's slot. `live` says she is in the water (the second case).
 */
async function benchFor(player, boat) {
  const { livePosition, zoneUnder } = await import('./adrift.js');
  const at = aboard.get(player.id) === boat.id ? livePosition(player.id) : null;
  const wright = getZoneNpcs(player.current_zone).find((n) => n?.flags?.repairman);
  const berth = boat.berth_zone ? getZone(boat.berth_zone) : null;
  // ⚠ SEATED IN THE SLOT WITH THE OVERLAY UP IS THE BENCH, whether or not telemetry has landed yet.
  // `livePosition` is null until the first boatsync, and a hull lifted into the water has no berth
  // row to fall back on, so every overlay button used to answer "that is shed work" from the shed.
  if (aboard.get(player.id) === boat.id) {
    const { svcState } = await import('./helm.js');
    if (svcState.get(player.id)?.mode === 'dock') {
      let w = wright;
      if (!w && at) { const t = zoneUnder(at.x, at.y); const room = t ? coveredRoomAtTile(t.id) : null; w = room ? getZoneNpcs(room.id).find((n) => n?.flags?.repairman) : null; }
      if (!w && berth) w = getZoneNpcs(berth.id).find((n) => n?.flags?.repairman);
      if (w) return { ok: true, live: true, wright: w.name };
    }
  }
  if (at) {
    const tile = zoneUnder(at.x, at.y);
    const room = tile ? coveredRoomAtTile(tile.id) : null;
    if (!room || at.speed > 2) return { ok: false, why: 'Bring her into the covered slot and stop. The shipwright does not work on a moving boat.' };
    const w = wright || getZoneNpcs(room.id).find((n) => n?.flags?.repairman);
    if (!w) return { ok: false, why: 'There is nobody in the shed to do the work.' };
    return { ok: true, live: true, wright: w.name };
  }
  const reach = berthsNear(player.current_zone).some((z) => z.id === boat.berth_zone);
  if (!reach || berthKind(berth) !== 'covered') return { ok: false, why: 'That is shed work. She has to be in the covered dock.' };
  if (!wright) return { ok: false, why: 'There is nobody here to do the work.' };
  return { ok: true, live: false, wright: wright.name };
}

async function findPatch(player) {
  // ⚠ `is_equipped` IS AN INTEGER, not a boolean, and the column is not called `equipped`. An
  // `equipped IS NOT TRUE` here throws at the database rather than at load, so it would have looked
  // like a working feature until somebody actually carried a patch to a boat.
  const r = await query(
    `SELECT id, item_id, quantity FROM player_inventory
      WHERE player_id = $1 AND COALESCE(is_equipped, 0) = 0 AND container_id IS NULL`,
    [player.id],
  );
  for (const row of r.rows) {
    const it = getItem(row.item_id);
    if (it?.tags?.hull_patch) return row;
  }
  return null;
}

// ── GETTING IN AND OUT ───────────────────────────────────────────────────────
//
// Registered as ACTIONS rather than as verbs, because `board`, `embark` and `disembark` are the
// FLIGHT plugin's and have been since before there was a boat in the game. Flight already hands that
// verb down when there is no aircraft in play — `tryVesselAction` offers it to swimming's
// `VESSEL_EMBARK` first — and this is a third rung on the same ladder, added the same way: an action
// registered by name here, dispatched by name there, with neither plugin importing the other.
//
// ⚠ ORDER MATTERS AND BOATS GO LAST. Swimming's vessel is a ZONE you are treading water beside; this
// is a ROW tied to the deck you are standing on. A player alongside the Echelon in the water should
// still get the Echelon, so the boat rung only ever answers where the vessel rung did not.
//
// ⚠ AND `null` MEANS "not applicable", NOT "no". Flight reads a null as permission to carry on to
// its own aircraft answer, so every refusal that is genuinely about a boat has to be a real reply —
// return null only when there is no boat in the question at all.

/** Who is sitting in what. RAM only: where a body is, is per-tick state and does not go to the DB. */
//
// ⚠ MIRRORED TO ONE PLAYER FLAG, BECAUSE THE PANE OUTLIVES THE PROCESS. A server restart (a deploy,
// or the dev watcher reloading on a save) emptied this map while the helm was still open on the
// screen, so every sync was silently dropped and stepping off answered "you are not aboard
// anything" to somebody sitting in their boat. The map is still the hot-path truth; the flag is
// written only on boarding and leaving, and read only by `recoverAboard` when the map has no entry.
const ABOARD_FLAG = 'boat_aboard';
class SeatMap extends Map {
  set(pid, boatId) {
    super.set(pid, boatId);
    query('INSERT INTO player_flags (player_id, flag_key, flag_value) VALUES ($1, $2, $3) ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value = $3', [pid, ABOARD_FLAG, String(boatId)]).catch(() => {});
    return this;
  }
  delete(pid) {
    query('DELETE FROM player_flags WHERE player_id = $1 AND flag_key = $2', [pid, ABOARD_FLAG]).catch(() => {});
    return super.delete(pid);
  }
}
export const aboard = new SeatMap();      // playerId -> boat id

/** Put back a seat a restart forgot. Straight to the table rather than the flag cache, which a
 *  delete in this same session does not reach. Returns the boat id or null. */
export async function recoverAboard(player) {
  if (!player?.id) return null;
  const have = aboard.get(player.id);
  if (have) return have;
  const r = await query('SELECT f.flag_value AS id FROM player_flags f JOIN boats b ON b.id::text = f.flag_value WHERE f.player_id = $1 AND f.flag_key = $2 AND b.owner_id = $1', [player.id, ABOARD_FLAG]).catch(() => ({ rows: [] }));
  const id = r.rows[0]?.id;
  if (!id) return null;
  Map.prototype.set.call(aboard, player.id, id);
  return id;
}

export async function boatEmbark(player) {
  const here = getZone(player.current_zone);
  // A berth, or the piece of water somebody left her lying in. ⚠ THE SECOND ARM IS WHAT MAKES
  // GOING OVER THE SIDE SURVIVABLE: `adrift.js` puts you in the water on her own tile, and
  // without this the hull you are treading water beside is one you can look at and not get into.
  if (!berthKind(here) && !isOpenWater(here)) return null; // nothing of ours could be here
  if (aboard.has(player.id)) {
    const cur = aboard.get(player.id);
    const r = await query('SELECT * FROM boats WHERE id = $1', [cur]);
    const n = r.rows[0]?.name || 'her';
    return { type: 'emote', message: `You are already aboard ${n}.` };
  }
  const r = await query('SELECT * FROM boats WHERE owner_id = $1 AND berth_zone = $2', [player.id, here.id]);
  if (!r.rows.length) return null;                         // none of yours here — let flight answer
  const boat = r.rows[0];
  aboard.set(player.id, boat.id);
  const name = boat.name || TYPES[boat.type_id]?.name || 'her';
  const kind = berthKind(here);
  // ⚠ CLIMBING BACK INTO YOUR OWN BOAT COSTS NOTHING AND IS NEVER ROLLED, which is a departure
  // from swimming's VESSEL_EMBARK and is deliberate. That one is a stranger's hull with freeboard
  // and no ladder, so a Swimming check that can fail is jeopardy. This is the boat you stepped off
  // thirty seconds ago, over a transom eighteen inches above the water, and a failed roll here
  // does not read as difficulty — it reads as the game refusing to let you back into the thing
  // that is the only way home, in water that is already draining your stamina.
  const how = kind === 'berth'
    ? 'You step down off the pontoon and into her. She takes your weight and gives it back.'
    : kind ? 'You climb the cradle and drop into the cockpit. She does not move at all, which is the strange part.'
    : 'You get a forearm over the transom, kick once and come aboard on your front, wearing most of the Basin.';
  return { type: 'emote', message: `${how}\nAboard ${name}. Hull ${pct(boat.condition)}%, fuel ${pct(boat.fuel)}%.` };
}

export async function boatDisembark(player) {
  const id = aboard.get(player.id);
  if (!id) return null;
  aboard.delete(player.id);
  const r = await query('SELECT * FROM boats WHERE id = $1', [id]);
  const name = r.rows[0]?.name || 'her';
  return { type: 'emote', message: `You climb out of ${name} and back onto the deck.` };
}

export const _test = { berthKind, berthCapacity, berthsNear, zonesNear, hullBand, pickBoat, aboard, isOpenWater, MOVE_IN, REFIT_CAP, PATCH_GAIN };
