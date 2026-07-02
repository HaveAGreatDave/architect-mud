import { query } from '../../models/db.js';
import { getDoorForExit, getZoneDoors, setDoorCache, getZone, world, getApartment, setApartmentCache } from '../world.js';
import { resolveLockAuth, getLockType, getAllLockTypes } from '../locks.js';
import { propagateSound } from '../sounds.js';
import { isOnCooldown, setCooldown, getCooldownRemaining } from '../combat.js';
import { tagValue, tagsOf } from '../tags.js';

const DIRECTIONS = ['north','south','east','west','up','down','in','out'];
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };
const WINDOW_WORDS = new Set(['window', 'windows', 'curtain', 'curtains']);

function findDoorEitherSide(zoneId, dir) {
  // Door in this zone going that direction (player is on the source side)
  const direct = getDoorForExit(zoneId, dir);
  if (direct) return direct;
  // Door in the target zone going the opposite direction (door is installed on the far side)
  // e.g. apt door goes south to lobby; from lobby going north, find getDoorForExit(apt, 'south')
  const zone = getZone(zoneId);
  const targetId = zone?.exits?.[dir];
  if (!targetId) return null;
  return getDoorForExit(targetId, OPPOSITE[dir]) || null;
}

function resolveDoor(args, player) {
  const dir = args.find(a => DIRECTIONS.includes(a));
  if (dir) return findDoorEitherSide(player.current_zone, dir);
  // No direction given — collect all doors touching this zone
  const local = getZoneDoors(player.current_zone);
  const zone = getZone(player.current_zone);
  const farSide = [];
  for (const [exitDir, targetId] of Object.entries(zone?.exits || {})) {
    const d = getDoorForExit(targetId, OPPOSITE[exitDir]);
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
  const targetId = zone?.exits?.[door.exit_dir];
  for (const zid of [door.zone_id, targetId]) {
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
  if (door.lock_state === 'locked') return { type:'error', message:'The door is locked.' };
  await updateDoor(door, { is_open: 1 });
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

export async function cmdAttackDoor(dirStr, player, broadcast) {
  const args = dirStr ? dirStr.split(/\s+/) : [];
  const door = resolveDoor(args, player);
  if (!door) return { type:'error', message:'No door here to attack.' };
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. attack door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is already destroyed.' };

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

  door.hp = Math.max(0, door.hp - damage);
  setDoorCache(door.id, door);
  await query('UPDATE doors SET hp=$1 WHERE id=$2', [door.hp, door.id]);

  propagateSound(player.current_zone, 'You hear heavy banging against a door nearby.', 2.0, broadcast);
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} attacks the door.` }, player.id);

  if (door.hp <= 0) {
    await query('UPDATE doors SET hp=0,is_open=1,lock_state=NULL WHERE id=$1', [door.id]);
    Object.assign(door, { hp: 0, is_open: 1, lock_state: null });
    setDoorCache(door.id, door);
    broadcast(player.current_zone, { type:'zone_event', message:'The door splinters apart!', refresh: true }, player.id);
    propagateSound(player.current_zone, 'You hear a door being smashed apart nearby.', 2.5, broadcast);
    return { type:'combat', message:`You smash the door! It splinters apart! (${damage} damage)` };
  }

  return { type:'combat', message:`You hit the door for ${damage} damage. (${door.hp}/${door.hp_max} HP remaining)` };
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
        `INSERT INTO items (id,name,description,type,subtype,weight,value,rarity,is_stackable,is_unique,flags)
         VALUES ($1,$2,$3,'key','keycard',0.05,0,'rare',0,1,$4)`,
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
  open:      doorPrePass(cmdOpenDoor),
  close:     doorPrePass(cmdCloseDoor),
  lock:      doorPrePass(cmdLockDoor),
  unlock:    doorPrePass(cmdUnlockDoor),
  install:   cmdInstallLock,
  uninstall: cmdUninstallLock,
};
