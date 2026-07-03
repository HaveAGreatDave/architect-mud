import { query } from '../../models/db.js';
import { getDoorForExit, getDoorById, getZoneDoors, setDoorCache, getZone, world, getApartment, setApartmentCache } from '../world.js';
import { resolveLockAuth, getLockType, getAllLockTypes } from '../locks.js';
import { propagateSound } from '../sounds.js';
import { isOnCooldown, setCooldown, getCooldownRemaining } from '../combat.js';
import { tagValue, tagsOf } from '../tags.js';
import { exitTargets, allExits } from '../exits.js';
import { emit } from '../events.js';
import { effectiveSkill, awardSkillUse } from '../skills.js';
import { getZoneProtection } from '../protection.js';
import { doorGuardsOnlyUnownedApartment } from '../apartments.js';
import { gameMsToReal } from '../gametime.js';

const DIRECTIONS = ['north','south','east','west','up','down','in','out'];
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };
const WINDOW_WORDS = new Set(['window', 'windows', 'curtain', 'curtains']);

function findDoorEitherSide(zoneId, dir) {
  // Door in this zone going that direction (player is on the source side)
  const direct = getDoorForExit(zoneId, dir);
  if (direct) return direct;
  // Door in a target zone going the opposite direction (door is installed on the
  // far side). e.g. apt door goes south to lobby; from lobby going north, find
  // getDoorForExit(apt, 'south'). A direction may hold several exits — check each.
  const zone = getZone(zoneId);
  for (const targetId of exitTargets(zone, dir)) {
    const far = getDoorForExit(targetId, OPPOSITE[dir], zoneId);
    if (far) return far;
  }
  return null;
}

function resolveDoor(args, player) {
  const dir = args.find(a => DIRECTIONS.includes(a));
  if (dir) return findDoorEitherSide(player.current_zone, dir);
  // No direction given — collect all doors touching this zone
  const local = getZoneDoors(player.current_zone);
  const zone = getZone(player.current_zone);
  const farSide = [];
  for (const { dir: exitDir, target: targetId } of allExits(zone)) {
    const d = getDoorForExit(targetId, OPPOSITE[exitDir], zone?.id);
    if (d && !local.find(x => x.id === d.id)) farSide.push(d);
  }
  const all = [...local, ...farSide];
  if (all.length === 1) return all[0];
  if (all.length > 1) return 'ambiguous';
  return null;
}

function getLockTag(door) {
  const tags = tagsOf(door);
  const key = Object.keys(tags).find(k => k.startsWith('lock:'));
  if (!key) return null;
  return { type: key, ...tags[key] };
}
export { getLockTag as getLockTagPublic };

// Returns true if player is authorised to operate this lock.
// Dispatches to the registered handler for lockTag.type (see locks.js).
export async function checkLockAuth(lockTag, door, player) {
  return resolveLockAuth(lockTag, door, player);
}

async function updateDoor(door, changes) {
  Object.assign(door, changes);
  setDoorCache(door.id, door);
  const keys = Object.keys(changes);
  const sets = keys.map((k, i) => `${k}=$${i+1}`).join(',');
  await query(`UPDATE doors SET ${sets} WHERE id=$${keys.length+1}`, [...Object.values(changes), door.id]);
  if (changes.lock_state === 'locked' || changes.lock_state === 'unlocked') await syncApartmentLock(door, changes.lock_state);
}

// Reverse leg of the apartment↔door lock mirror. The apartment lock command
// (apartments.js cmdLockDoor) treats apt.is_locked as master and mirrors it into
// door.lock_state; this keeps apt.is_locked in step when a door is locked/unlocked
// via the door-lock-tag command instead, so both fields stay consistent whichever
// path was used. A door touches up to two zones (its own and its exit target);
// sync whichever side is an apartment.
async function syncApartmentLock(door, lockState) {
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

  if (isOnCooldown(player.id, 'attack')) {
    const remaining = getCooldownRemaining(player.id, 'attack');
    return { type:'error', message:`Not yet. (${(remaining/1000).toFixed(1)}s)` };
  }
  setCooldown(player.id, 'attack');

  const { rows } = await query(
    `SELECT i.* FROM player_inventory pi JOIN items i ON i.id=pi.item_id WHERE pi.player_id=$1 AND pi.is_equipped=1 AND jsonb_exists(i.tags,'weapon') LIMIT 1`,
    [player.id]
  );
  const equipped = rows[0];
  const dmg = equipped ? tagValue(equipped, 'damage', {}) || {} : {};
  const dmin = dmg.min ?? (equipped ? 3 : 2);
  const dmax = dmg.max ?? (equipped ? 8 : 4);
  const damage = Math.floor(Math.random() * (dmax - dmin + 1)) + dmin;
  const damageType = equipped ? (tagValue(equipped, 'damage_type') || 'kinetic') : 'fists';

  door.hp = Math.max(0, door.hp - damage);
  setDoorCache(door.id, door);
  await query('UPDATE doors SET hp=$1 WHERE id=$2', [door.hp, door.id]);

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
    await query('UPDATE doors SET hp=0,is_open=1,lock_state=NULL WHERE id=$1', [door.id]);
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
const HACK_DEVICE_ITEM_ID = 'item_hack_deck';
const HACK_LOCKOUT_MS = 5 * 60 * 1000;
const HACK_PENDING_TTL_MS = 180 * 1000;
const hackLockout = new Map();  // playerId -> lockout-until ts
const pendingHack = new Map();  // playerId -> { doorId, expires }

async function hasHackDevice(playerId) {
  const { rows } = await query(
    'SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1',
    [playerId, HACK_DEVICE_ITEM_ID]
  );
  return rows.length > 0;
}

// The zone the door protects — whichever side is an apartment. Used for the
// forcefield gate (a sleeping owner's quantum shield makes the lock unhackable).
function doorForcefieldActive(door) {
  for (const zid of [door.zone_id, ...doorFarZoneIds(door)]) {
    if (zid && getZoneProtection(zid)) return true;
  }
  return false;
}

// hack [door] [dir] — arm a hololock breach. Self-gates (returns undefined) so a
// zone-mate handler (e.g. vendor-safe's `hack`) can own the verb when there's no
// hackable door. Returns the minigame launch payload; `hackresolve` reports back.
async function cmdHackLock(args, raw, player, broadcast) {
  const door = resolveDoor(args, player);
  if (!door) return undefined;  // no door — let another `hack` handler try
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. hack door north).' };
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
  return {
    type: 'hololock_game',
    doorId: door.id,
    deviceName: door.name || 'hololock',
    skill: await effectiveSkill(player, 'hacking'),
    difficulty: lockTag.difficulty ?? 5,
    resolveCmd: 'hackresolve',
  };
}

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
    return { type:'error', message:"The hololock's key sequence resets mid-spoof. Your deck is flagged — five-minute lockout." };
  }

  await updateDoor(door, { lock_state: 'unlocked' });
  await awardSkillUse(player.id, 'hacking', 2);
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

// These handlers activate when args starts with "door", a bare direction,
// or no args at all if there is exactly one door in the zone.
// Returning undefined falls through to the next handler (e.g. apartment lock).
function doorPrePass(fn) {
  return (args, raw, player, broadcast) => {
    if (args[0] === 'door') return fn(args.slice(1), raw, player, broadcast);
    if (DIRECTIONS.includes(args[0])) return fn(args, raw, player, broadcast);
    if (WINDOW_WORDS.has(args[0])) return undefined;
    // Bare command — only intercept if there's exactly one door here.
    const door = resolveDoor([], player);
    if (!door || door === 'ambiguous') return undefined;
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
        `<span class="action-link" data-action="install" data-target="${t.name}${dir ? ' ' + dir : ''}">${t.name}</span>`
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

  if (config.tagType === 'lock:keycardlock') {
    const keycardId = `keycard_${door.id}`;
    const { rows: existing } = await query('SELECT id FROM items WHERE id=$1', [keycardId]);
    if (!existing.length) {
      const zone = getZone(door.zone_id);
      const zoneName = zone?.name || door.zone_id;
      await query(
        `INSERT INTO items (id,name,description,type,subtype,weight,value,is_stackable,is_unique,flags)
         VALUES ($1,$2,$3,'key','keycard',0.05,0,0,1,$4)`,
        [keycardId, `Keycard — ${zoneName}`,
         `A slim obsidian card threaded with bioluminescent circuitry. Its access signature is keyed exclusively to the reader on ${zoneName}'s door.`,
         JSON.stringify({ keycard_for_door: door.id, unique: true })]
      );
    }
    lockData.keyItemId = keycardId;
    await query(
      `INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,1)`,
      [`inv_kc_${Date.now()}`, player.id, keycardId]
    );
  }

  // Consume the kit
  if (kit.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [kit.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [kit.id]);

  // Store lock as a tag on the door (object format, keyed by tag type)
  const newTags = { ...(door.tags || {}), [config.tagType]: lockData };
  door.tags = newTags;
  door.lock_state = 'unlocked';
  setDoorCache(door.id, door);
  await query('UPDATE doors SET tags=$1,lock_state=$2 WHERE id=$3', [JSON.stringify(newTags), 'unlocked', door.id]);

  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} installs a lock on the door.` }, player.id);
  const extra = config.tagType === 'lock:keycardlock' ? ' A keycard has been added to your inventory.' : '';
  return { type:'output', message:`You install the ${lockShortName} on the door.${extra}` };
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
  await query('UPDATE doors SET tags=$1,lock_state=NULL WHERE id=$2', [JSON.stringify(newTags), door.id]);

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
