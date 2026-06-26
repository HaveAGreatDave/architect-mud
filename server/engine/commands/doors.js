import { query } from '../../models/db.js';
import { getDoorForExit, getZoneDoors, setDoorCache, getZone, world } from '../world.js';
import { propagateSound } from '../sounds.js';
import { isOnCooldown, setCooldown, getCooldownRemaining } from '../combat.js';
import { tagValue } from '../tags.js';

const DIRECTIONS = ['north','south','east','west','up','down','in','out'];
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };

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
  return (door.tags ?? []).find(t => t.type?.startsWith('lock:')) ?? null;
}

async function updateDoor(door, changes) {
  Object.assign(door, changes);
  setDoorCache(door.id, door);
  const keys = Object.keys(changes);
  const sets = keys.map((k, i) => `${k}=$${i+1}`).join(',');
  await query(`UPDATE doors SET ${sets} WHERE id=$${keys.length+1}`, [...Object.values(changes), door.id]);
}

async function cmdOpenDoor(args, raw, player, broadcast) {
  const door = resolveDoor(args, player);
  if (!door) return null;
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. open door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  if (door.is_open) return { type:'error', message:'The door is already open.' };
  if (door.lock_state === 'locked') return { type:'error', message:'The door is locked.' };
  await updateDoor(door, { is_open: 1 });
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} opens the door.` }, player.id);
  return { type:'output', message:'You open the door.' };
}

async function cmdCloseDoor(args, raw, player, broadcast) {
  const door = resolveDoor(args, player);
  if (!door) return null;
  if (door === 'ambiguous') return { type:'error', message:'Multiple doors here — specify a direction (e.g. close door north).' };
  if (door.hp <= 0) return { type:'error', message:'That door is destroyed.' };
  if (!door.is_open) return { type:'error', message:'The door is already closed.' };
  await updateDoor(door, { is_open: 0 });
  broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} closes the door.` }, player.id);
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

  {
    const { rows } = await query(
      'SELECT 1 FROM apartments WHERE zone_id=$1 AND owner_id=$2',
      [door.zone_id, player.id]
    );
    if (!rows.length) return { type:'error', message:'The lock does not recognize your credentials.' };
  }

  // Auto-close the door before locking if it's open
  if (door.is_open) {
    await updateDoor(door, { is_open: 0 });
    broadcast(player.current_zone, { type:'zone_event', message:`${player.handle} closes and locks the door.` }, player.id);
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

  {
    const { rows } = await query(
      'SELECT 1 FROM apartments WHERE zone_id=$1 AND owner_id=$2',
      [door.zone_id, player.id]
    );
    if (!rows.length) return { type:'error', message:'The lock does not recognize your credentials.' };
  }

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
    await query('UPDATE doors SET hp=0,is_open=1,is_locked=0,lock_state=NULL WHERE id=$1', [door.id]);
    Object.assign(door, { hp: 0, is_open: 1, is_locked: 0, lock_state: null });
    setDoorCache(door.id, door);
    broadcast(player.current_zone, { type:'zone_event', message:'The door splinters apart!' }, player.id);
    propagateSound(player.current_zone, 'You hear a door being smashed apart nearby.', 2.5, broadcast);
    return { type:'combat', message:`You smash the door! It splinters apart! (${damage} damage)` };
  }

  return { type:'combat', message:`You hit the door for ${damage} damage. (${door.hp}/${door.hp_max} HP remaining)` };
}

// These handlers return null when "door" isn't the target so the dispatcher
// can fall through to the next registered handler (housing, apartments, etc.).
function doorPrePass(fn) {
  return (args, raw, player, broadcast) => {
    if (args[0] !== 'door') return undefined;
    return fn(args.slice(1), raw, player, broadcast);
  };
}

export const handlers = {
  open:   doorPrePass(cmdOpenDoor),
  close:  doorPrePass(cmdCloseDoor),
  lock:   doorPrePass(cmdLockDoor),
  unlock: doorPrePass(cmdUnlockDoor),
};
