import { query } from '../../models/db.js';
import { textRender } from '../minigame.js';
import { getDoorForExit, doorOnLink, getDoorById, getZoneDoors, setDoorCache, getZone, frontDoorOf, world, getApartment, setApartmentCache } from '../world.js';
import { resolveLockAuth, getLockType, getAllLockTypes } from '../locks.js';
import { propagateSound } from '../sounds.js';
import { isOnCooldown, setCooldown, getCooldownRemaining } from '../combat.js';
import { tagValue, tagsOf } from '../tags.js';
import { exitTargets, allExits } from '../exits.js';
import { emit } from '../events.js';
import { effectiveSkill, awardSkillUse } from '../skills.js';
import { getEquippedWeapon } from '../inventory.js';
import { getZoneProtection } from '../protection.js';
import { doorGuardsOnlyUnownedApartment, playerControlsApt } from '../apartments.js';
import { gameMsToReal } from '../gametime.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage, getSelectionState } from '../sift.js';
import { registerAction } from '../actions.js';
import { hasHackDeck, hackDifficulty, damageHackDeck, breachMargin } from '../hack-gear.js';
import { escAttr } from '../text.js';

const DIRECTIONS = ['north','south','east','west','up','down','in','out'];
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };
const DIR_ABBR = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down' };
const WINDOW_WORDS = new Set(['window', 'windows', 'curtain', 'curtains']);
// Filler words stripped before matching, so "door to west" == "west door" == "door west".
const DOOR_NOISE = new Set(['door', 'doors', 'to', 'the']);

// A direction token in full or abbreviated form (west | w), else undefined.
function dirToken(word) {
  if (DIRECTIONS.includes(word)) return word;
  return DIR_ABBR[word];
}
function isDirToken(word) {
  return dirToken(word) !== undefined;
}

// Normalize the arg words into a direction query: drop filler words and expand
// abbreviations. "door to w" / "w door" / "door west" all collapse to "west".
function doorQuery(args) {
  return args.filter(a => !DOOR_NOISE.has(a)).map(a => dirToken(a) || a).join(' ');
}

// Every door touching the player's zone as a SIFT candidate, each tagged with the
// direction it lies in from the player and a "<dir> door" display name. Local
// doors are anchored on this side; far-side doors are anchored in the neighbour
// and reached by moving `dir`. Local wins on id collision (stable pick order).
//
// The third case is a building's FRONT door. It is not on the link the player is
// about to traverse: a facade is never stood on, so stepping toward it forwards you
// through the facade↔interior seam in one move, and the door lives on that seam — one
// hop further in than the near/far scan reaches. Movement has always looked through
// the facade for it (resolveFacadeTransit); until now these verbs did not, so
// `open door` from the street returned null for every one of the 61 buildings and a
// front door could only be worked from inside. Nobody hit it because all 57 shipped
// facade doors are closed-but-unlocked — the moment a shop locks at night it would
// have been a door you can neither open nor hack from the street.
function doorCandidates(player) {
  const zone = getZone(player.current_zone);
  const cands = getZoneDoors(player.current_zone).map(d => ({ door: d, dir: d.exit_dir }));
  const seen = new Set(cands.map(c => c.door.id));
  for (const { dir: exitDir, target: targetId } of allExits(zone)) {
    const d = doorOnLink(zone?.id, exitDir, targetId);
    if (d && !seen.has(d.id)) { seen.add(d.id); cands.push({ door: d, dir: exitDir }); }
    const front = frontDoorOf(getZone(targetId));
    if (front && !seen.has(front.id)) { seen.add(front.id); cands.push({ door: front, dir: exitDir }); }
  }
  return cands.map(c => ({ ...c, name: `${c.dir} door` }));
}

// SIFT-based door resolution. Returns { type:'match', door }, { type:'ambiguous',
// candidates } (many doors, no direction to pick one), or { type:'none' }.
// `filter` optionally restricts the pool (hack only cares about hackable locks).
function siftDoor(args, player, filter) {
  let cands = doorCandidates(player);
  if (filter) cands = cands.filter(c => filter(c.door));
  if (!cands.length) return { type: 'none' };
  const q = doorQuery(args);
  if (!q) return cands.length === 1 ? { type: 'match', door: cands[0].door } : { type: 'ambiguous', candidates: cands };
  const r = siftResolve(q, cands);
  if (r.type === 'none') return { type: 'none' };
  if (r.type === 'match') return { type: 'match', door: r.candidate.door };
  return { type: 'ambiguous', candidates: r.candidates };
}

// Legacy contract for the non-hack door verbs: door object, null, or 'ambiguous'.
function resolveDoor(args, player) {
  const r = siftDoor(args, player);
  if (r.type === 'match') return r.door;
  if (r.type === 'ambiguous') return 'ambiguous';
  return null;
}

function getLockTag(door) {
  const tags = tagsOf(door);
  const key = Object.keys(tags).find(k => k.startsWith('lock:'));
  if (!key) return null;
  return { type: key, ...tags[key] };
}
export { getLockTag as getLockTagPublic };

// ── A resident is never locked out of their own home ─────────────────────────
// The law: if a door touches a residence this player controls, they are authorised
// on it, whatever kind of lock is hanging there. This sits ABOVE the per-lock-type
// registry on purpose, because the registry is where the ways to be shut out of your
// own flat were hiding — each lock type authored its own auth in isolation and only
// the hololock happened to know what an apartment was:
//
//   • `keycardlock` authorised on INVENTORY alone, so being robbed of (or dropping,
//     or losing to a corpse) `keycard_<doorId>` locked the deed holder out of a unit
//     they own, permanently — cmdInstallLock mints exactly one card.
//   • `privacylock` authorised on "am I standing on the private side", so any
//     visitor could throw the bolt and shut the owner out of their own home from
//     the street. Not hackable either (hackDoor is hololock-only).
//   • An NPC arriving home locks whatever door it just used (ai-behaviour.js), so a
//     roommate NPC in a keycard/privacy unit could bolt a player's own door.
//
// Deliberately NOT in locks.js: that module is a pure registry with no world
// knowledge, and this is a housing rule. checkLockAuth is the single funnel every
// caller already uses (the move gate, open/close/lock/unlock, hackDoor, and the
// describe pane's "owned" marker), so one check here covers all of them — including
// making the door render as yours.
//
// This grants AUTH, not passage: a manual bolt still has to be physically undone
// (lockTypePassesWhileLocked is a separate question, see the engine:door-lock gate),
// which is what keeps a privacy latch meaningful. It means the resident can always
// UNLOCK it — they can never be left with no way in.
function controlsEitherSide(player, door) {
  if (!player || !door) return false;
  const sides = [door.zone_id, door.target_zone, ...exitTargets(door)].filter(Boolean);
  for (const zid of new Set(sides)) {
    const apt = getApartment(zid);
    if (apt && playerControlsApt(player, apt)) return true;
  }
  return false;
}

// Returns true if player is authorised to operate this lock.
// Dispatches to the registered handler for lockTag.type (see locks.js).
export async function checkLockAuth(lockTag, door, player) {
  if (controlsEitherSide(player, door)) return true;
  return resolveLockAuth(lockTag, door, player);
}

async function updateDoor(door, changes) {
  // Door state (is_open/lock_state/hp/tags) is runtime-only, held in world.doors
  // and never persisted — doors reset to their authored state on reboot. The
  // apartment lock, however, is durable housing state and still gets mirrored.
  Object.assign(door, changes);
  // Any deliberate hand on the lock retires the NPC lock-up marker (ai-behaviour.js):
  // once a person has locked this door, it is their lock, and the walk-out-anyway
  // leniency the move gate grants an auto-locked shop no longer applies.
  if (changes.lock_state !== undefined) door._autoLockedInside = null;
  setDoorCache(door.id, door);
  if (changes.lock_state === 'locked' || changes.lock_state === 'unlocked') await syncApartmentLock(door, changes.lock_state);
}

// Reverse leg of the apartment↔door lock mirror. The apartment lock command
// (apartments.js cmdLockDoor) treats apt.is_locked as master and mirrors it into
// door.lock_state; this keeps apt.is_locked in step when a door is locked/unlocked
// via the door-lock-tag command instead, so both fields stay consistent whichever
// path was used. A door touches up to two zones (its own and its exit target);
// sync whichever side is an apartment.
export async function syncApartmentLock(door, lockState) {
  const isLocked = lockState === 'locked' ? 1 : 0;
  const zone = getZone(door.zone_id);
  const farIds = door.target_zone ? [door.target_zone] : exitTargets(zone, door.exit_dir);
  for (const zid of [door.zone_id, ...farIds]) {
    if (!zid) continue;
    const apt = getApartment(zid);
    if (!apt || apt.is_locked === isLocked) continue;
    await query('UPDATE apartments SET is_locked=$1 WHERE zone_id=$2', [isLocked, zid]);
    setApartmentCache(zid, { ...apt, is_locked: isLocked });
  }
}

async function cmdOpenDoor(args, raw, player, broadcast) {
  const door = resolveDoor(args, player);
  if (!door) return null;
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. open door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  if (door.is_open) return { type:'error', message:'The door is already open.' };
  if (door.lock_state === 'locked' && !doorGuardsOnlyUnownedApartment(door)) return { type:'error', message:'The door is locked.' };
  await updateDoor(door, { is_open: 1 });
  emit('door.toggled', { zoneId: door.zone_id, targetZoneId: door.target_zone });
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} opens the door.`, refresh: true }, player.id);
  return { type:'output', message:'You open the door.' };
}

async function cmdCloseDoor(args, raw, player, broadcast) {
  const door = resolveDoor(args, player);
  if (!door) return null;
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. close door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  if (!door.is_open) return { type:'error', message:'The door is already closed.' };
  await updateDoor(door, { is_open: 0 });
  emit('door.toggled', { zoneId: door.zone_id, targetZoneId: door.target_zone });
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} closes the door.`, refresh: true }, player.id);
  return { type:'output', message:'You close the door.' };
}

async function cmdLockDoor(args, raw, player, broadcast) {
  const door = resolveDoor(args, player);
  if (!door) return null;
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. lock door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  const lockTag = getLockTag(door);
  if (!lockTag) return { type:'error', message:"This door has no lock." };
  if (door.lock_state === 'locked') return { type:'error', message:'The lock is already engaged.' };

  if (!['admin', 'dev'].includes(player.role) && !await checkLockAuth(lockTag, door, player))
    return { type:'error', message: lockTag.messages?.denied ?? 'The lock does not recognize your credentials.' };

  // Auto-close the door before locking if it's open
  if (door.is_open) {
    await updateDoor(door, { is_open: 0 });
    emit('door.toggled', { zoneId: door.zone_id, targetZoneId: door.target_zone });
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} closes and locks the door.`, refresh: true }, player.id);
  } else {
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} locks the door.` }, player.id);
  }

  await updateDoor(door, { lock_state: 'locked' });
  return { type:'output', message: lockTag.messages?.lock ?? 'You lock the door.' };
}

async function cmdUnlockDoor(args, raw, player, broadcast) {
  const door = resolveDoor(args, player);
  if (!door) return null;
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. unlock door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  const lockTag = getLockTag(door);
  if (!lockTag) return { type:'error', message:"This door has no lock." };
  if (door.lock_state !== 'locked') return { type:'error', message:'The door is not locked.' };

  if (!['admin', 'dev'].includes(player.role) && !await checkLockAuth(lockTag, door, player))
    return { type:'error', message: lockTag.messages?.denied ?? 'The lock does not recognize your credentials.' };

  await updateDoor(door, { lock_state: 'unlocked' });
  broadcast(player.current_zone, { type:'zone_event', message:'The lock disengages.' }, player.id);
  return { type:'output', message: lockTag.messages?.unlock ?? 'The lock disengages.' };
}

// The zone(s) on the other side of a door from wherever it's anchored.
function doorFarZoneIds(door) {
  return door.target_zone ? [door.target_zone] : exitTargets(getZone(door.zone_id), door.exit_dir);
}

// The zone(s) on the far side of a door *relative to where the actor stands* —
// which side the door is anchored to doesn't matter. Used to reach the person on
// the other side: the resident hears the break-in; the hacker never hears their
// own lock-whine echoed back at them.
function doorOppositeZoneIds(door, fromZoneId) {
  return [door.zone_id, ...doorFarZoneIds(door)].filter(z => z && z !== fromZoneId);
}

// Clear, un-muffled alert heard on the far side of a door under attack — tuned to
// what's being swung, and always reading as "someone is trying to break in" (the
// resident hears the specific threat, not propagateSound's clipped banging).
const DOOR_ATTACK_ALERT = {
  fists:     `Fists HAMMER against the door — someone's trying to break in!`,
  kinetic:   `Something heavy SLAMS against the door — someone's trying to force their way in!`,
  edged:     `A blade bites into the door with a splintering CRACK — someone's trying to cut their way in!`,
  energy:    `The door shudders under a searing crackle of energy — someone's trying to blast their way in!`,
  fire:      `Heat blooms against the door, the surface hissing and blistering — someone's trying to burn their way in!`,
  radiation: `The door rattles under a strange, humming assault — someone's trying to force their way in!`,
};

// The bathroom side of a door: the single zone touching it that holds a toilet.
// A privacy lock is unlockable from that side ("connects to a bathroom" = the
// far side is the bathroom). Returns null when NEITHER side has a toilet, or
// BOTH do — the caller then makes the builder pick a side explicitly.
export async function detectBathroomSide(door) {
  const zids = [door.zone_id, ...doorFarZoneIds(door)].filter(Boolean);
  if (!zids.length) return null;
  const { rows } = await query(
    `SELECT DISTINCT zone_id FROM furniture
      WHERE zone_id = ANY($1) AND (object_type='toilet' OR jsonb_exists(flags,'toilet'))`,
    [zids]
  );
  return rows.length === 1 ? rows[0].zone_id : null;
}

// Who owns the residence this door guards — whichever side is a claimed
// apartment. Read straight from the table (authoritative on owner_type: an
// apartment can be owned by a player, an NPC, or an org). Lets listeners on
// `hololock.breached` react to *whose* place was broken into (e.g. an NPC
// vendor holding a grudge), not just where the breach was witnessed.
async function burgledApartmentOwner(door) {
  for (const zid of [door.zone_id, ...doorFarZoneIds(door)]) {
    if (!zid) continue;
    const { rows } = await query(
      'SELECT owner_id, owner_type FROM apartments WHERE zone_id=$1 AND owner_id IS NOT NULL',
      [zid]
    );
    if (rows.length) return { ownerId: rows[0].owner_id, ownerType: rows[0].owner_type || 'player', apartmentZone: zid };
  }
  return {};
}

export async function cmdAttackDoor(dirStr, player, broadcast) {
  const args = dirStr ? dirStr.split(/\s+/) : [];
  const door = resolveDoor(args, player);
  if (!door) return { type:'error', message:'No door here to attack.' };
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. attack door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is already destroyed.' };

  // A quantum forcefield seals the whole unit — you can't hack it and you can't
  // batter through it either. Reject the swing (before the cooldown) so a
  // sleeping owner's shield is proof against brute force as well as the deck.
  if (doorForcefieldActive(door))
    return { type:'error', message:'A quantum forcefield sheathes the door — your blows just wash off it in blue ripples.' };

  // A door tagged unbreakable (e.g. the jail cell) can't be bashed down at all —
  // there is no player bypass, by design. Without this, enough hits eventually
  // zero its HP and leave lock_state permanently NULL with no repair path.
  if (tagValue(door, 'unbreakable'))
    return { type:'error', message:'The door barely rattles under the blow — this one isn\'t coming down.' };

  if (isOnCooldown(player.id, 'attack')) {
    const remaining = getCooldownRemaining(player.id, 'attack');
    return { type:'error', message:`Not yet. (${(remaining/1000).toFixed(1)}s)` };
  }
  setCooldown(player.id, 'attack');

  const equipped = await getEquippedWeapon(player);
  const dmg = equipped ? tagValue(equipped, 'damage', {}) || {} : {};
  const dmin = dmg.min ?? (equipped ? 3 : 2);
  const dmax = dmg.max ?? (equipped ? 8 : 4);
  const damage = Math.floor(Math.random() * (dmax - dmin + 1)) + dmin;
  const damageType = equipped ? (tagValue(equipped, 'damage_type') || 'kinetic') : 'fists';

  door.hp = Math.max(0, door.hp - damage);
  setDoorCache(door.id, door);

  // The person on the far side hears exactly what's being used on their door, in
  // the clear (bypassing propagateSound's muffling — it's their own door being
  // battered, not a distant noise). propagateSound still carries a clipped bang
  // to the wider neighbourhood.
  const alert = DOOR_ATTACK_ALERT[damageType] || DOOR_ATTACK_ALERT.kinetic;
  for (const zid of doorOppositeZoneIds(door, player.current_zone)) {
    broadcast(zid, { type:'zone_event', message: alert });
  }
  propagateSound(player.current_zone, 'You hear heavy banging against a door nearby.', 2.0, broadcast);
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} attacks the door.` }, player.id);

  // Bashing a door is a loud break-in — the burglary alarm treats it as noise
  // (an asleep resident on the far side wakes on the spot).
  emit('breakin.attempt', {
    intruderId: player.id,
    entranceZoneId: player.current_zone,
    unitZoneIds: [door.zone_id, ...doorFarZoneIds(door)].filter(z => z && z !== player.current_zone),
    method: 'bash',
  });

  if (door.hp <= 0) {
    Object.assign(door, { hp: 0, is_open: 1, lock_state: null });
    setDoorCache(door.id, door);
    emit('door.toggled', { zoneId: door.zone_id, targetZoneId: door.target_zone });
    broadcast(player.current_zone, { type:'zone_event', message:'The door splinters apart!', refresh: true }, player.id);
    for (const zid of doorOppositeZoneIds(door, player.current_zone)) {
      broadcast(zid, { type:'zone_event', message:'The door BURSTS off its frame — someone has broken in!', refresh: true });
    }
    propagateSound(player.current_zone, 'You hear a door being smashed apart nearby.', 2.5, broadcast);
    return { type:'combat', message:`You smash the door! It splinters apart! (${damage} damage)` };
  }

  return { type:'combat', message:`You hit the door for ${damage} damage. (${door.hp}/${door.hp_max} HP remaining)` };
}

// ── Hololock hacking ────────────────────────────────────────────────────────
// Breaking into a residence by defeating its hololock. The client-side
// "hololock bypass" minigame (electronic lockpick) is authoritative — winning
// it is the only gate beyond carrying a hacking device, mirroring the ATM jack.
// A successful breach unlocks the door persistently and reports `burglary`
// (via the surveillance listener on `hololock.breached`).
const HACK_LOCKOUT_MS = 5 * 60 * 1000;
const HACK_PENDING_TTL_MS = 180 * 1000;
const hackLockout = new Map();  // playerId -> lockout-until ts
const pendingHack = new Map();  // playerId -> { doorId, expires }

// The gate is the capability tag (`hack_device`), not a specific item id, and
// WHICH deck answers decides how hard the lock reads and what a failure costs —
// see server/engine/hack-gear.js.
const hasHackDevice = hasHackDeck;

// The zone the door protects — whichever side is an apartment. Used for the
// forcefield gate (a sleeping owner's quantum shield makes the lock unhackable).
function doorForcefieldActive(door) {
  for (const zid of [door.zone_id, ...doorFarZoneIds(door)]) {
    // Only the forcefield fiction makes a lock unhackable. Zone-level
    // sanctuary protection gates hostile PLAYER interactions, not lockpicking —
    // without this reason check, every unit door bordering a sanctuary zone
    // would be unhackable and burglary dies there.
    if (zid && getZoneProtection(zid)?.reason === 'forcefield') return true;
  }
  return false;
}

// A door a hack could plausibly target: an intact, locked, still-hackable
// hololock. The picker pool is built from these; the per-door gates below give
// the final verdict (auth/forcefield/device).
function isHackableHololock(door) {
  if (!door || door.hp <= 0) return false;
  const lockTag = getLockTag(door);
  return !!lockTag && lockTag.type === 'lock:hololock' && !!lockTag.canHack
    && door.lock_state === 'locked' && !doorGuardsOnlyUnownedApartment(door);
}

// hack [door] [dir] — arm a hololock breach. Resolution runs through SIFT, so
// "hack door to w", "hack west door", "hack door west", "hack w door" and
// "hack door w" all pick the same door. With several hackable doors and no
// direction given ("hack door"), SIFT opens a numbered picker. Self-gates
// (returns undefined) so a zone-mate handler (e.g. vendor-safe's `hack`) can own
// the verb when there's no hackable door here.
async function cmdHackLock(args, raw, player, broadcast) {
  if (doorQuery(args)) {
    // A direction/name was typed — resolve against ALL doors so a plain or
    // already-open door still gets its specific message, then gate in hackDoor.
    const r = siftDoor(args, player);
    if (r.type === 'none') return undefined;  // no such door — let another `hack` handler try
    if (r.type === 'ambiguous') return hackPicker(r.candidates, player);
    return hackDoor(r.door, player, broadcast);
  }
  // No direction — offer only the doors actually worth hacking here.
  const hackable = doorCandidates(player).filter(c => isHackableHololock(c.door));
  if (hackable.length === 0) return undefined;  // nothing to hack — fall through
  if (hackable.length === 1) return hackDoor(hackable[0].door, player, broadcast);
  return hackPicker(hackable, player);
}

// Open a numbered SIFT picker over door candidates; the pick replays through the
// `doors.hack` action (see index.js selection-state dispatch).
function hackPicker(candidates, player) {
  createSelectionState(player.id, candidates, { dispatchType: 'doors.hack', dispatchParam: 'sel' });
  return { type: 'output', message: `Which door do you want to hack?\n${formatSelectionPage(getSelectionState(player.id))}` };
}

// Arm the breach on an already-resolved door. All the hack gates live here so
// both the direct path and the picker replay share one verdict.
async function hackDoor(door, player, broadcast) {
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };

  const lockTag = getLockTag(door);
  if (!lockTag || lockTag.type !== 'lock:hololock' || !lockTag.canHack) return undefined;
  if (door.lock_state !== 'locked' || doorGuardsOnlyUnownedApartment(door)) return { type:'error', message:'The hololock is already disengaged.' };

  // You control this apartment — no need to break into your own place.
  if (await checkLockAuth(lockTag, door, player))
    return { type:'error', message:'Your credentials open this lock — just UNLOCK it.' };

  if (doorForcefieldActive(door))
    return { type:'error', message:'A quantum forcefield sheathes the lock — you cannot get a signal in.' };

  if (!(await hasHackDevice(player.id)))
    return { type:'error', message:'You need a hacking device to breach a hololock.' };

  const lockedUntil = hackLockout.get(player.id) || 0;
  if (Date.now() < lockedUntil) {
    const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
    return { type:'error', message:`Your deck is still flagged from the last attempt. Lockout expires in ${secs}s.` };
  }

  // Working the panel whines audibly — the far side hears it even through a
  // closed door (it's the lock itself buzzing, not sound crossing the gap). The
  // far side is relative to the *hacker*, not the door's anchor, so the resident
  // hears it and the hacker never gets their own whine echoed back.
  for (const zid of doorOppositeZoneIds(door, player.current_zone)) {
    broadcast(zid, { type:'zone_event', message:'A faint electronic whine buzzes from the door — someone is working the lock.' });
  }
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} jacks a deck into the door's hololock.` }, player.id);

  // Signal the break-in to the burglary alarm system (picking phase begins now):
  // residents on the far side may hear the lock being worked.
  emit('breakin.attempt', {
    intruderId: player.id,
    entranceZoneId: player.current_zone,
    unitZoneIds: [door.zone_id, ...doorFarZoneIds(door)].filter(z => z && z !== player.current_zone),
    method: 'hack',
  });

  pendingHack.set(player.id, { doorId: door.id, expires: Date.now() + HACK_PENDING_TTL_MS });
  return textRender(player, {
    type: 'hololock_game',
    doorId: door.id,
    deviceName: door.name || 'hololock',
    skill: await effectiveSkill(player, 'hacking'),
    difficulty: await hackDifficulty(player.id, lockTag.difficulty),
    resolveCmd: 'hackresolve',
  });
}

// SIFT picker replay for `hack` — the chosen candidate carries the resolved door.
registerAction({
  type: 'doors.hack',
  handler: ({ actor, params, context }) => hackDoor(params.sel.door, actor, context.broadcast),
});

// hackresolve <doorId> <1|0> — silent; the hololock overlay fires its own
// outcome. That outcome is authoritative (winning the minigame is the gate).
async function cmdHackResolve(args, raw, player, broadcast) {
  const doorId = args[0];
  const win = args[1] === '1';
  if (!doorId) return { type:'noop' };

  // Must match a breach this player actually armed (anti-spoof), still fresh.
  const pending = pendingHack.get(player.id);
  pendingHack.delete(player.id);
  if (!pending || pending.doorId !== doorId || Date.now() > pending.expires) return { type:'noop' };

  const door = getDoorById(doorId);
  if (!door) return { type:'noop' };
  // The door must still touch this zone and still be a locked hololock.
  if (door.zone_id !== player.current_zone && !doorFarZoneIds(door).includes(player.current_zone))
    return { type:'noop' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  const lockTag = getLockTag(door);
  if (!lockTag || lockTag.type !== 'lock:hololock') return { type:'noop' };
  if (door.lock_state !== 'locked' || doorGuardsOnlyUnownedApartment(door)) return { type:'error', message:'The hololock is already disengaged.' };
  if (doorForcefieldActive(door)) return { type:'error', message:'A quantum forcefield sheathes the lock — you cannot get a signal in.' };
  if (!(await hasHackDevice(player.id))) return { type:'error', message:'You need a hacking device to breach a hololock.' };

  if (!win) {
    // In-world lockout (the deck stays flagged) — scale the 5 game-minute cooldown
    // to real ms via the game-speed knob. (The pending-hack TTL above stays real:
    // it's the player's live minigame-completion window, not a world duration.)
    hackLockout.set(player.id, Date.now() + gameMsToReal(HACK_LOCKOUT_MS));
    const deckMsg = await damageHackDeck(player.id);
    return { type:'error', message:`The hololock's key sequence resets mid-spoof. Your deck is flagged — five-minute lockout.${deckMsg}` };
  }

  await updateDoor(door, { lock_state: 'unlocked' });
  await awardSkillUse(player.id, 'hacking', await breachMargin(player, lockTag.difficulty));
  broadcast(player.current_zone, { type:'zone_event', message:'The hololock chirps and disengages.', refresh: true }, player.id);

  // Attribute the break-in to whoever actually owns the place (from the table,
  // not just who's home) so an NPC-vendor owner holds a grudge whether or not
  // they witnessed it — they'll come back to a jimmied door and know.
  const owner = await burgledApartmentOwner(door);
  emit('hololock.breached', { player, zoneId: player.current_zone, ...owner });

  // Burglary is no longer charged on breach. A resident NPC who hears the
  // intrusion (burglary plugin) must survive their panic cop-call — or flee the
  // unit — for the stars to land; silence them first and you walk clean. With
  // nobody home, breaching only charges if a camera/cop/bystander witnesses it
  // (the generic witness gate on the hololock.breached listener).
  return {
    type: 'output',
    message: `You spoof the hololock's handshake. It chirps green and the bolt slides back.\n<span class="ip-gain">Hacking improved.</span>`,
  };
}

// These handlers activate when the phrase names a door ("door …", or any
// direction token in full or abbreviated form, in any position), or with no args
// at all if there is exactly one door in the zone.
// Returning undefined falls through to the next handler (e.g. apartment lock).
function doorPrePass(fn) {
  return (args, raw, player, broadcast) => {
    if (WINDOW_WORDS.has(args[0])) return undefined;
    // Explicitly a door: leading "door", or a direction mentioned anywhere.
    if (args[0] === 'door' || args.some(isDirToken)) {
      const rest = args[0] === 'door' ? args.slice(1) : args;
      return fn(rest, raw, player, broadcast);
    }
    // Bare command. With no door here, fall through (window/container/apartment).
    // With one OR several doors, hand to the door handler: it re-resolves against
    // the real args, so a bare verb on several doors gets the "specify a direction"
    // prompt (instead of silently falling through to an unrelated handler that
    // answers "no windows/no door here"), while `open box`-style args still
    // resolve to no door and fall through cleanly.
    const door = resolveDoor([], player);
    if (!door) return undefined;
    return fn(args, raw, player, broadcast);
  };
}

// install hololock [dir] | install keycardlock [dir]
// Also handles bare "install door [dir]" or "install [dir]" by auto-detecting
// the lock type from whatever kit the player is carrying.
async function cmdInstallLock(args, raw, player, broadcast) {
  let lockShortName = args[0];
  let config = getLockType(lockShortName);
  let dirArgs = args.slice(1); // args after the lock type

  // No recognised lock type — strip noise words and auto-detect from inventory.
  if (!config) {
    const allTypes = getAllLockTypes();
    const { rows: kitRows } = await query(
      `SELECT i.tags FROM player_inventory pi JOIN items i ON i.id = pi.item_id WHERE pi.player_id=$1`,
      [player.id]
    );
    const carrying = allTypes.filter(t => kitRows.some(r => r.tags && r.tags[t.kitTag] !== undefined));
    if (carrying.length === 0) return undefined; // no kits at all — not our verb
    if (carrying.length > 1) {
      // Resolve the door first so we know the direction for the choice links.
      const choiceDoor = resolveDoor(args, player);
      const dir = choiceDoor && choiceDoor !== 'ambiguous' ? choiceDoor.exit_dir : '';
      const links = carrying.map(t =>
        `<span class="action-link" data-action="install" data-target="${escAttr(t.name)}${dir ? ' ' + dir : ''}">${t.name}</span>`
      ).join('  ');
      return { type: 'output', message: `What do you want to install?\n${links}` };
    }
    lockShortName = carrying[0].name;
    config = carrying[0];
    // The unrecognised first arg ('door', 'lock', a direction, etc.) may still
    // contain the direction — keep everything as potential dir args.
    dirArgs = args;
  }

  const door = resolveDoor(dirArgs, player);
  if (!door) return { type:'error', message:'No door here to install a lock on.' };
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction.' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  if (getLockTag(door)) return { type:'error', message:'This door already has a lock. Uninstall it first.' };

  const isAdmin = ['admin', 'dev'].includes(player.role);
  if (!isAdmin) {
    const { rows: aptRows } = await query(
      'SELECT 1 FROM apartments WHERE zone_id=$1 AND owner_id=$2',
      [door.zone_id, player.id]
    );
    if (!aptRows.length) return { type:'error', message:"You don't own this room." };
  }

  // Find the kit by its lockkit tag instead of hardcoded item ID
  const { rows: kitRows } = await query(
    `SELECT pi.*, i.id AS item_id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND (i.tags ? $2) LIMIT 1`,
    [player.id, config.kitTag]
  );
  if (!kitRows.length) return { type:'error', message:`You don't have a ${lockShortName} installation kit.` };
  const kit = kitRows[0];

  // Lock data stored as a tag value; record kit item so uninstall can return it
  const lockData = { kitItemId: kit.item_id, ...config.defaults };

  // Consume the kit
  if (kit.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [kit.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [kit.id]);

  // Store lock as a tag on the door (object format, keyed by tag type)
  const newTags = { ...(door.tags || {}), [config.tagType]: lockData };
  door.tags = newTags;
  door.lock_state = 'unlocked';
  setDoorCache(door.id, door);

  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} installs a lock on the door.` }, player.id);
  // No keycard is minted here any more (spec §6). A keycardlock reads whatever
  // AUTHORED item its keyItemId names — the bearer-key pattern survives; what is
  // gone is the mechanism that manufactured a fresh item into a pocket and
  // anchored a door id inside it, which is the P1 failure in miniature.
  return { type:'output', message:`You install the ${lockShortName} on the door.` };
}

// uninstall lock [dir] | uninstall door [dir] | uninstall [dir]
async function cmdUninstallLock(args, raw, player, broadcast) {
  let dirArgs = args;
  if (args[0] === 'lock' || args[0] === 'door') {
    dirArgs = args.slice(1);
  } else if (args[0] && !DIRECTIONS.includes(args[0])) {
    return undefined; // not our verb
  }

  const door = resolveDoor(dirArgs, player);
  if (!door) return { type:'error', message:'No door here.' };
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction.' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };

  const lockTag = getLockTag(door);
  if (!lockTag) return { type:'error', message:'This door has no lock to remove.' };
  if (door.lock_state === 'locked') return { type:'error', message:'Unlock the door before removing the lock.' };

  if (!['admin', 'dev'].includes(player.role)) {
    const { rows: aptRows } = await query(
      'SELECT 1 FROM apartments WHERE zone_id=$1 AND owner_id=$2',
      [door.zone_id, player.id]
    );
    if (!aptRows.length) return { type:'error', message:"You don't own this room." };
  }

  // Remove the lock tag key from the door's tags object
  const { [lockTag.type]: _, ...newTags } = (door.tags || {});
  door.tags = newTags;
  door.lock_state = null;
  setDoorCache(door.id, door);

  // Return the exact kit item that was consumed at install time
  await query(
    `INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,1)`,
    [`inv_kit_${Date.now()}`, player.id, lockTag.kitItemId]
  );

  const shortName = lockTag.type.replace('lock:', '');
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} removes the lock from the door.` }, player.id);
  return { type:'output', message:`You remove the ${shortName} and return the kit to your inventory.` };
}

export const handlers = {
  open:        doorPrePass(cmdOpenDoor),
  close:       doorPrePass(cmdCloseDoor),
  lock:        doorPrePass(cmdLockDoor),
  unlock:      doorPrePass(cmdUnlockDoor),
  hack:        doorPrePass(cmdHackLock),
  hackresolve: cmdHackResolve,
  install:     cmdInstallLock,
  uninstall:   cmdUninstallLock,
};
