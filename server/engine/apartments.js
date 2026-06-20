import { query } from '../models/db.js';
import { getApartment, setApartmentCache, getZone } from './world.js';
import { skillCheck, awardSkillXp } from './skills.js';

// Picking a lock gets harder the more the owner has invested in it.
// Difficulty is a flat number compared against a d10 + rank + stat-bonus roll
// (see skills.js:skillCheck) — same shape as every other check in the game.
const BASE_LOCK_DIFFICULTY = 4;
const MAX_LOCK_DIFFICULTY = 14;
const UPGRADE_COST = 75; // credits per difficulty point, after the first

// How much HP/sanity a full sleep restores. Sleeping in your own locked
// apartment is full rest; sleeping anywhere else "safe" is a lesser rest;
// sleeping somewhere dangerous doesn't work at all.
const SLEEP_RESTORE_HOME = { hp: 1.0, sanity: 1.0 };
const SLEEP_RESTORE_SAFE_ZONE = { hp: 0.4, sanity: 0.2 };

export function isApartmentZone(zone) {
  return !!(zone?.flags?.is_apartment);
}

export async function cmdRent(player) {
  const zone = getZone(player.current_zone);
  if (!isApartmentZone(zone)) return { type:'error', message:'There is nothing to rent here.' };

  const apt = getApartment(zone.id);
  if (apt?.owner_id) {
    if (apt.owner_id === player.id) return { type:'error', message:'You already own this place.' };
    return { type:'error', message:`This unit is already owned by ${apt.owner_handle}.` };
  }

  const cost = apt?.rent_cost ?? 100;
  if (player.credits < cost) return { type:'error', message:`You need ${cost}c to claim this unit. You have ${player.credits}c.` };

  await query('UPDATE players SET credits = credits - $1 WHERE id = $2', [cost, player.id]);
  const updated = await query(
    `INSERT INTO apartments (zone_id, owner_id, owner_handle, is_locked, lock_difficulty, rent_cost, purchased_at)
     VALUES ($1,$2,$3,0,$4,$5,EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (zone_id) DO UPDATE SET owner_id=$2, owner_handle=$3, is_locked=0, lock_difficulty=$4, purchased_at=EXTRACT(EPOCH FROM NOW())
     RETURNING *`,
    [zone.id, player.id, player.handle, BASE_LOCK_DIFFICULTY, cost]
  );
  setApartmentCache(zone.id, updated.rows[0]);
  player.credits -= cost;

  return { type:'rent', message:`You claim ${zone.name} for ${cost}c. It's yours now. Type LOCK to secure the door when you leave.` };
}

export async function cmdLockDoor(player, wantLocked) {
  const zone = getZone(player.current_zone);
  if (!isApartmentZone(zone)) return { type:'error', message:'There is no door to lock here.' };

  const apt = getApartment(zone.id);
  if (!apt?.owner_id) return { type:'error', message:'Nobody owns this unit yet — nothing to lock. Try RENT.' };
  if (apt.owner_id !== player.id) return { type:'error', message:'This isn\'t your place. You can\'t work the lock.' };

  const newState = wantLocked ? 1 : 0;
  if (apt.is_locked === newState) {
    return { type:'error', message: wantLocked ? 'Already locked.' : 'Already unlocked.' };
  }

  await query('UPDATE apartments SET is_locked=$1 WHERE zone_id=$2', [newState, zone.id]);
  setApartmentCache(zone.id, { ...apt, is_locked: newState });

  return { type:'lock', message: wantLocked
    ? 'You lock the door behind you. Solid. For now.'
    : 'You unlock the door.' };
}

export async function cmdUpgradeLock(player) {
  const zone = getZone(player.current_zone);
  if (!isApartmentZone(zone)) return { type:'error', message:'There is no lock to upgrade here.' };

  const apt = getApartment(zone.id);
  if (!apt?.owner_id) return { type:'error', message:'You don\'t own a unit here.' };
  if (apt.owner_id !== player.id) return { type:'error', message:'Not your place, not your lock.' };
  if (apt.lock_difficulty >= MAX_LOCK_DIFFICULTY) return { type:'error', message:'The lock is already as good as anyone around here can build.' };

  if (player.credits < UPGRADE_COST) return { type:'error', message:`Upgrading the lock costs ${UPGRADE_COST}c. You have ${player.credits}c.` };

  await query('UPDATE players SET credits = credits - $1 WHERE id = $2', [UPGRADE_COST, player.id]);
  const newDifficulty = apt.lock_difficulty + 1;
  await query('UPDATE apartments SET lock_difficulty=$1 WHERE zone_id=$2', [newDifficulty, zone.id]);
  setApartmentCache(zone.id, { ...apt, lock_difficulty: newDifficulty });
  player.credits -= UPGRADE_COST;

  return { type:'upgrade', message:`You reinforce the lock. (Difficulty ${apt.lock_difficulty} → ${newDifficulty}, ${UPGRADE_COST}c spent)` };
}

export async function cmdPickLock(player) {
  const zone = getZone(player.current_zone);
  if (!isApartmentZone(zone)) return { type:'error', message:'There is no lock here to pick.' };

  const apt = getApartment(zone.id);
  if (!apt?.owner_id) return { type:'error', message:'This place is unowned — the door is already open.' };
  if (apt.owner_id === player.id) return { type:'error', message:'It\'s your own door. Just open it.' };
  if (!apt.is_locked) return { type:'error', message:'It\'s already unlocked.' };

  const result = await skillCheck(player, 'security', apt.lock_difficulty);
  const xpGain = result.success ? 15 : 4;
  const rankUp = await awardSkillXp(player.id, 'security', xpGain);

  if (result.success) {
    return {
      type: 'pick_success',
      message: `You work the lock — click. It gives.${rankUp.ranked_up ? ` (Security skill up: rank ${rankUp.new_rank})` : ''}`,
      bypassed_zone: zone.id, // caller can choose to treat the zone as unlocked for this session
    };
  }
  return {
    type: 'pick_fail',
    message: `You work at the lock, but it holds. (rolled ${result.total} vs difficulty ${result.difficulty})${rankUp.ranked_up ? ` (Security skill up: rank ${rankUp.new_rank})` : ''}`,
  };
}

// Determine whether the player can sleep here right now, and how well.
export function getSleepEligibility(player, zone) {
  if (isApartmentZone(zone)) {
    const apt = getApartment(zone.id);
    if (apt?.owner_id === player.id) {
      return { canSleep: true, restore: SLEEP_RESTORE_HOME, reason: 'home' };
    }
    // Someone else's apartment — only sleepable if unlocked (you broke in or owner left it open)
    if (apt?.is_locked) {
      return { canSleep: false, reason: 'locked' };
    }
    return { canSleep: true, restore: SLEEP_RESTORE_SAFE_ZONE, reason: 'unlocked_other' };
  }
  if (zone.is_safe_zone) {
    return { canSleep: true, restore: SLEEP_RESTORE_SAFE_ZONE, reason: 'safe_zone' };
  }
  return { canSleep: false, reason: 'unsafe' };
}

export async function cmdSleep(player) {
  const zone = getZone(player.current_zone);
  if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };

  const elig = getSleepEligibility(player, zone);
  if (!elig.canSleep) {
    if (elig.reason === 'locked') return { type:'error', message:'The door is locked. You can\'t sleep here unless it\'s yours or you pick the lock.' };
    return { type:'error', message:'It\'s not safe enough to sleep here. Find a secured apartment or a safe zone.' };
  }

  const hpGain = Math.ceil((player.hp_max - player.hp) * elig.restore.hp);
  const sanGain = Math.ceil((player.sanity_max - player.sanity) * elig.restore.sanity);
  const newHp = Math.min(player.hp_max, player.hp + hpGain);
  const newSanity = Math.min(player.sanity_max, player.sanity + sanGain);

  await query('UPDATE players SET hp=$1, sanity=$2 WHERE id=$3', [newHp, newSanity, player.id]);
  player.hp = newHp;
  player.sanity = newSanity;

  const flavor = elig.reason === 'home'
    ? 'You sleep behind your own locked door. Properly rested, for once.'
    : 'You catch a rough, watchful sleep. Better than nothing.';

  return { type:'sleep', message: `${flavor} (+${hpGain} HP, +${sanGain} Sanity)`, player_update: { hp:newHp, sanity:newSanity } };
}

export async function describeApartmentStatus(zone) {
  if (!isApartmentZone(zone)) return '';
  const apt = getApartment(zone.id);
  if (!apt?.owner_id) {
    return `\n<span class="apartment-label">This unit is unowned.</span> (RENT to claim it for ${apt?.rent_cost ?? 100}c)`;
  }
  const lockState = apt.is_locked ? 'locked' : 'unlocked';
  return `\n<span class="apartment-label">Owned by ${apt.owner_handle}.</span> The door is ${lockState}. (Lock difficulty: ${apt.lock_difficulty})`;
}
