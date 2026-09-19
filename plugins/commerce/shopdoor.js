// ── THE SHOP DOOR ────────────────────────────────────────────────────────────
//
// Shop hours arrived as a MOVE GATE and nothing else: walk at a closed shop and
// the answer was "The door won't give", with nothing behind the sentence. There
// was no door. 49 of the city's 84 scheduled shops had no `doors` row on their
// entrance at all and 32 more had one carrying no lock, which is the same thing
// twice over — `npcAutoLockable` needs a lock tag, so the shopkeeper's own
// lock-up-on-the-way-home step in ai-behaviour.js never fired for any of them
// either. Nothing in the game could be unlocked, hacked or battered; the hours
// were a wall wearing a door's words.
//
// This is the other half. The lock is an ordinary registered lock type, so
// lock/unlock/hack/bash/burglary/knock all reach a shopfront through machinery
// that already exists and none of it is re-implemented here. What this file adds
// is the three things only a shop knows:
//
//   1. WHOSE DOOR IT IS  — the vendors who work behind it, and therefore whether
//                          it should be standing open right now.
//   2. WHAT IT SAYS      — the trading hours, derived from the timetable the
//                          vendor already commutes on. Nothing is authored.
//   3. WHEN IT CHANGES   — closing time locks it, opening time unlocks it, and a
//                          door somebody DEFEATED stays defeated.
//
// ⚠ THE DOOR OUTRANKS THE HOURS. The gate in index.js abstains the moment the
// entrance door is not locked, because a lock a player beat has to buy them
// something. Leave the gate absolute and the hack, the bash and the crowbar are
// all theatre: you get through the door and the room still refuses you.
//
// ⚠ AND NOTHING HERE INVENTS A "FORCED" FLAG. A shop door is locked when the shop
// is shut; if it is unlocked while the shop is shut, somebody opened it. That is
// the whole test, and it is why the sync below acts only on a CHANGE of trading
// state (see syncShopDoors) rather than re-asserting the lock every 30 seconds on
// top of the player who just spent a minigame on it.

import { registerLockType } from '../../server/engine/locks.js';
import { world, getZone, doorOnLink, setDoorCache } from '../../server/engine/world.js';
import { allExits } from '../../server/engine/exits.js';
import { isResidentOf, getBuildingName } from '../../server/engine/apartments.js';
import { isVendorClosed, isVendorAbsent, isVendorOffHours, openInPhrase } from '../../server/engine/ai-behaviour.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getLockTagPublic } from '../../server/engine/commands/doors.js';

// ── WHICH SHOPS, AND WHO KEEPS THEM ──────────────────────────────────────────
// Presence-independent on purpose: a closed vendor has usually gone home, so
// reading live zone occupancy would make a room stop looking like a shop the
// moment it closed. Keyed off work_zone_id (where their shift IS), rebuilt lazily
// on a 60s TTL. NPCs are created and edited rarely and the world Maps are the
// read tier here, never a query.
const SHOP_IDX_TTL = 60_000;
let _shopIdx = null, _shopIdxAt = 0;

function shopIndex() {
  if (!_shopIdx || Date.now() - _shopIdxAt > SHOP_IDX_TTL) {
    _shopIdx = new Map();
    for (const n of world.npcs.values()) {
      if (!n?.work_zone_id || n.flags?.covert) continue;
      if (!n.vendor_inventory?.length) continue;
      if (!n.vendor_schedule || !Object.keys(n.vendor_schedule).length) continue;
      if (!_shopIdx.has(n.work_zone_id)) _shopIdx.set(n.work_zone_id, []);
      _shopIdx.get(n.work_zone_id).push(n);
    }
    _shopIdxAt = Date.now();
  }
  return _shopIdx;
}

export function shopVendorsFor(zoneId) {
  return shopIndex().get(zoneId) || [];
}

// The vendor to quote when this room is shut, or null if it isn't a shop room /
// someone is still trading. Interiors only: a stallholder standing on a street
// tile must never lock the street.
export function shopClosedFor(zone) {
  if (!zone?.flags?.is_interior) return null;
  const vendors = shopVendorsFor(zone.id);
  if (!vendors.length) return null;
  if (vendors.some(n => !isVendorClosed(n))) return null;
  return vendors[0];
}

// ── TWO REASONS A SHOP IS SHUT, AND ONLY ONE OF THEM HAS A TIME ──────────────
// `isVendorClosed` folds together the clock (off the timetable) and presence (on
// the timetable, but not behind the counter yet: walking in, stepped out, late).
// Both shut the door; only the first can be answered with a wait.
export const shutOnPresenceOnly = (npc) => isVendorAbsent(npc) && !isVendorOffHours(npc);

export function reopensPhrase(npc) {
  const when = openInPhrase(npc);
  return when ? `in ${when}` : 'during business hours';
}

// ── WHOSE DOOR IS THIS? ──────────────────────────────────────────────────────
// The building's own name, not the shopkeeper's: it is on the sign the player is
// looking at and it is what they will call the place. Nothing is authored for it,
// because getBuildingName already walks the parent chain to the building root.
export const shopPlaceName = (zone) => {
  const name = getBuildingName(zone);
  return name && name !== zone?.name ? name : null;
};

// ── Does this player LIVE here? ──────────────────────────────────────────────
// Coldwater is mixed-use: shops sit on the ground floor of buildings people live
// in, and closing time must never trump the housing law. Building-level, not
// unit-level: your own front door isn't the only room you're entitled to be in at
// night, and the stairwell and the lobby are the way home.
export const livesHere = (player, zone) => isResidentOf(player, getBuildingName(zone));

// ── THE DOOR ITSELF ──────────────────────────────────────────────────────────
// The step between a shop floor and the street it opens onto. `world_exit_zone`
// is the authored statement of which way that is, and doorOnLink resolves the
// door from either side, so it does not matter which end of the seam the row is
// anchored on.
export function shopEntranceDoor(zone) {
  const street = zone?.flags?.world_exit_zone;
  if (!street) return null;
  for (const { dir, target } of allExits(zone)) {
    if (target !== street) continue;
    const door = doorOnLink(zone.id, dir, target);
    if (door) return door;
  }
  return null;
}

// The same door, but only when a LOCK is actually hanging on it.
//
// ⚠ THE DISTINCTION IS LOAD-BEARING. 32 shops have an entrance door carrying no
// lock at all, and on those `lock_state` means nothing: treat one as the shop's
// lock and it reads as permanently beaten, which would hand every one of them a
// front door that stands open all night. A door with no lock is not a door this
// system has an opinion about.
export function shopEntranceLock(zone) {
  const door = shopEntranceDoor(zone);
  return door && getLockTagPublic(door) ? door : null;
}

// Has somebody got through it? A shop door is locked while the shop is shut, so
// an entrance standing unlocked (or off its hinges) during closed hours is one
// that was beaten. No new state: the door IS the record.
export function shopDoorDefeated(zone) {
  const door = shopEntranceLock(zone);
  if (!door) return false;                    // no lock fitted, so nothing to beat
  return door.hp <= 0 || door.lock_state !== 'locked';
}

// ── THE LOCK ─────────────────────────────────────────────────────────────────
// Hackable by declaration, which is now something the hack path actually reads
// (see lockCanHack in server/engine/commands/doors.js). Bashable through the
// ordinary door HP pool. Not pickable, because this game has no lockpicking: the
// two ways in are a deck and a heavy object, and the way in for somebody entitled
// to be there is that the door simply opens.
//
// AUTH IS THE BUILDING, NOT THE SHOP. A customer never holds a shop key, so
// authFn answers for exactly one person: someone who lives in the building the
// shop sits in. That is the same exemption the hours gate has always carried,
// moved onto the lock so the door and the gate cannot disagree about it.
registerLockType('shoplock', {
  tagType: 'lock:shoplock',
  kitTag: 'lockkit:shoplock',
  defaults: {
    difficulty: 4, canHack: true, noun: 'shop lock',
    messages: {
      lock:   'The bolt drops and the shopfront goes quiet.',
      unlock: 'The bolt lifts. The shop door swings in.',
      denied: 'The shop lock reads your hand and declines to recognise it.',
    },
  },
  authFn: async (lockTag, door, player) => {
    for (const zid of [door.zone_id, door.target_zone].filter(Boolean)) {
      if (livesHere(player, getZone(zid))) return true;
    }
    return false;
  },
});

// ── WHAT THE CARD IN THE DOOR SAYS ───────────────────────────────────────────
// Derived from `vendor_schedule`, the timetable the vendor already commutes on,
// so a shop's posted hours cannot drift from the hours it keeps. Nothing is
// authored, and retiming a shopkeeper's shift retimes their sign.
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT', sun: 'SUN' };
const hhmm = (h) => `${String(Math.max(0, Math.min(24, Math.round(h)))).padStart(2, '0')}:00`;

// One day's blocks as a single comparable string, so consecutive days keeping the
// same hours collapse into a range instead of being listed seven times.
function daySignature(blocks) {
  if (!blocks?.length) return 'CLOSED';
  return blocks.map(b => `${hhmm(b.from ?? 0)} to ${hhmm(b.to ?? 24)}`).join(', ');
}

// [{ label: 'MON to FRI', hours: '07:00 to 23:00' }, …]
export function tradingHours(schedule) {
  if (!schedule || !Object.keys(schedule).length) return [];
  const rows = [];
  for (const day of DAY_ORDER) {
    const sig = daySignature(schedule[day]);
    const last = rows[rows.length - 1];
    if (last && last.hours === sig) last.days.push(day);
    else rows.push({ days: [day], hours: sig });
  }
  return rows.map(r => ({
    label: r.days.length === 1
      ? DAY_LABEL[r.days[0]]
      : `${DAY_LABEL[r.days[0]]} to ${DAY_LABEL[r.days[r.days.length - 1]]}`,
    hours: r.hours,
  }));
}

// The one-line version, for a refusal that has to stay a sentence.
export function tradingHoursLine(npc) {
  const rows = tradingHours(npc?.vendor_schedule);
  if (!rows.length) return null;
  if (rows.length === 1 && rows[0].hours === '00:00 to 24:00') return 'open all hours';
  return rows.map(r => `${r.label} ${r.hours.toLowerCase()}`).join(', ');
}

// The card itself, as it reads on the door.
export function hoursNotice(npc) {
  const rows = tradingHours(npc?.vendor_schedule);
  if (!rows.length) return null;
  const width = Math.max(...rows.map(r => r.label.length));
  const lines = rows.map(r => `  ${r.label.padEnd(width)}   ${r.hours}`);
  return ['A card behind the glass gives the trading hours:', ...lines].join('\n');
}

// ── THE door.describe HOOK ───────────────────────────────────────────────────
// `examine door north` at a shopfront. The engine keeps the door and its lock;
// what a shop says about its hours is knowledge only this plugin has, so it is
// contributed rather than reached for from inside describeDoor.
//
// Both sides answer: the card is in the glass, and it reads the same whether you
// are standing on the pavement or shut in after closing.
export function describeDoorHook(door) {
  for (const zid of [door?.zone_id, door?.target_zone].filter(Boolean)) {
    const vendors = shopVendorsFor(zid);
    if (!vendors.length) continue;
    const notice = hoursNotice(vendors[0]);
    if (notice) return `<span class="text-dim">${notice}</span>`;
  }
  return null;
}

// ── KEEPING THE DOOR HONEST ──────────────────────────────────────────────────
// The shopkeeper's commute already works the lock (ai-behaviour.js: they unlock
// on arrival and pull it shut on the way out), and now that these doors carry a
// lock tag that step finally fires for them. This is the belt to that braces: a
// shop whose keeper never commutes, a clock jumped by hand, a boot at three in
// the morning.
//
// ⚠ IT ACTS ON TRANSITIONS, NEVER ON STATE. Re-asserting "closed means locked"
// every 30 seconds would re-lock the door a player hacked half a minute after
// they beat it, which is the feature deleting itself. So the last trading state
// is remembered per shop and the lock is only ever worked when that CHANGES. A
// forced door therefore stays forced until the shop next opens and closes again,
// which is exactly the truth of it: nobody has been back to secure it.
const lastShut = new Map();   // shopZoneId -> boolean. RAM only, like every door field.

function workDoor(zone, shut) {
  const door = shopEntranceLock(zone);
  if (!door || door.hp <= 0) return false;    // a door off its hinges cannot be locked
  if (shut) {
    door.is_open = 0;
    door.lock_state = 'locked';
    // The shop floor is the inside. Somebody caught in it at closing can still
    // walk out, and a resident of the building can still walk in: the engine's
    // move gate reads this field and nothing else grants that. Without it,
    // closing time seals a customer in a dark shop with no verb that helps.
    door._autoLockedInside = zone.id;
  } else {
    door.lock_state = 'unlocked';
    // ...and standing open, which is what a shop that is trading looks like. The
    // commute path already says so in words ("unlocks the shop and opens up for
    // business") and leaves the door open behind the vendor; without this the
    // boot reconcile would open a shop whose door still reads `closed` on examine.
    door.is_open = 1;
    door._autoLockedInside = null;
  }
  setDoorCache(door.id, door);
  return true;
}

function syncShopDoors({ force = false } = {}) {
  for (const [zoneId, vendors] of shopIndex()) {
    const zone = getZone(zoneId);
    if (!zone) continue;
    const shut = vendors.every(n => isVendorClosed(n));
    if (!force && lastShut.get(zoneId) === shut) continue;
    lastShut.set(zoneId, shut);
    workDoor(zone, shut);
  }
}

// Boot: the world has just been rebuilt from authored state, so there is nothing
// to preserve and every shop door is set to whatever the clock says it should be.
// Called once at plugin load, after initWorld has populated world.doors.
export function reconcileShopDoors() {
  syncShopDoors({ force: true });
}

schedule('30s', () => syncShopDoors());

// Exposed for the regress suite, which drives the transitions directly rather
// than waiting thirty seconds and moving the game clock.
export const _test = { syncShopDoors, workDoor, lastShut };
