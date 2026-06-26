import { query } from "../models/db.js";
import { getApartment, setApartmentCache, getZone, world, setDoorCache } from "./world.js";
import { skillCheck, awardSkillUse } from "./skills.js";
import { adjustCredits } from "./economy.js";

// Resolve the building name for an apartment zone by following its exits back
// to a lobby (the first exit that points to a non-apartment zone).
function getBuildingName(zone) {
  for (const linkedId of Object.values(zone.exits || {})) {
    const linked = getZone(linkedId);
    if (linked && !linked.flags?.is_apartment) return linked.name;
  }
  return null;
}

// Picking a lock gets harder the more the owner has invested in it.
// Difficulty is a flat number compared against a d10 + rank + stat-bonus roll
// (see skills.js:skillCheck) — same shape as every other check in the game.
const BASE_LOCK_DIFFICULTY = 4;
const MAX_LOCK_DIFFICULTY = 14;
const UPGRADE_COST = 75; // credits per difficulty point, after the first

// How much of the player's *missing* HP/sanity is restored per minute of
// sleep — gradual, not instant. Sleeping in your own locked apartment is
// the fastest, best rest; sleeping anywhere else "safe" is slower and
// shallower; sleeping somewhere dangerous doesn't work at all.
const SLEEP_RESTORE_HOME = { hp: 0.18, sanity: 0.15 };
const SLEEP_RESTORE_SAFE_ZONE = { hp: 0.08, sanity: 0.05 };

// Sleep isn't free — your body still burns through hunger/thirst while
// you're out, just slower than the cost of staying awake and active would
// otherwise imply nothing was happening. Per minute of sleep.
const SLEEP_HUNGER_DRAIN = 1;
const SLEEP_THIRST_DRAIN = 1;
const SLEEP_MAX_MINUTES = 30; // auto-wake safety cap, even if fully rested already

export function isApartmentZone(zone) {
	return !!zone?.flags?.is_apartment;
}

export async function cmdRent(player) {
	const zone = getZone(player.current_zone);
	if (!isApartmentZone(zone))
		return { type: "error", message: "There is nothing to rent here." };

	const apt = getApartment(zone.id);
	if (apt?.owner_id) {
		if (apt.owner_id === player.id)
			return { type: "error", message: "You already own this place." };
		return {
			type: "error",
			message: `This unit is already owned by ${apt.owner_handle}.`,
		};
	}

	const cost = apt?.rent_cost ?? 100;
	if (!(await adjustCredits(player, -cost)))
		return {
			type: "error",
			message: `You need ${cost}c to claim this unit. You have ${player.credits}c.`,
		};

	const buildingName = getBuildingName(zone) ?? 'the building';
	const now = Math.floor(Date.now() / 1000);

	const updated = await query(
		`INSERT INTO apartments (zone_id, owner_id, owner_handle, is_locked, lock_difficulty, rent_cost, purchased_at, date_rented, building_name)
     VALUES ($1,$2,$3,0,$4,$5,$6,$6,$7)
     ON CONFLICT (zone_id) DO UPDATE SET owner_id=$2, owner_handle=$3, is_locked=0, lock_difficulty=$4, purchased_at=$6, date_rented=$6, building_name=$7
     RETURNING *`,
		[zone.id, player.id, player.handle, BASE_LOCK_DIFFICULTY, cost, now, buildingName],
	);
	setApartmentCache(zone.id, updated.rows[0]);

	const rentedDate = new Date(now * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	return {
		type: "rent",
		message: `Congratulations — you are the proud new owner of <span style="color:var(--accent)">${zone.name}</span>!\n\nWeekly rent of <span style="color:var(--yellow)">${cost}c</span> will be collected every 7 days from ${rentedDate}. Type LOCK to secure the door when you leave. Type UNRENT to give the place up.`,
	};
}

export async function cmdUnrent(player) {
	const zone = getZone(player.current_zone);
	if (!isApartmentZone(zone))
		return { type: "error", message: "There is nothing to unrent here." };

	const apt = getApartment(zone.id);
	if (!apt?.owner_id)
		return { type: "error", message: "Nobody owns this unit." };
	if (apt.owner_id !== player.id)
		return { type: "error", message: "This isn't your place to give up." };

	const cost = apt.rent_cost ?? 100;
	await releaseApartment(apt, zone.id);

	return {
		type: "unrent",
		message: `<span style="color:var(--accent)">${zone.name}</span> has been vacated. You've handed back the keys — the unit is no longer yours. Your weekly bills have been reduced by <span style="color:var(--yellow)">${cost}c</span>.`,
	};
}

// Shared teardown used by both cmdUnrent and the rent-collection tick.
export async function releaseApartment(apt, zoneId) {
	const updated = await query(
		`UPDATE apartments SET owner_id=NULL, owner_handle=NULL, is_locked=0, date_rented=NULL, building_name=NULL WHERE zone_id=$1 RETURNING *`,
		[zoneId],
	);
	setApartmentCache(zoneId, updated.rows[0]);
}

export async function cmdLockDoor(player, wantLocked) {
	const zone = getZone(player.current_zone);
	if (!isApartmentZone(zone))
		return { type: "error", message: "There is no door to lock here." };

	const apt = getApartment(zone.id);
	if (!apt?.owner_id)
		return {
			type: "error",
			message: "Nobody owns this unit yet — nothing to lock. Try RENT.",
		};
	if (apt.owner_id !== player.id)
		return {
			type: "error",
			message: "This isn't your place. You can't work the lock.",
		};

	const newState = wantLocked ? 1 : 0;
	if (apt.is_locked === newState) {
		return {
			type: "error",
			message: wantLocked ? "Already locked." : "Already unlocked.",
		};
	}

	await query("UPDATE apartments SET is_locked=$1 WHERE zone_id=$2", [
		newState,
		zone.id,
	]);
	setApartmentCache(zone.id, { ...apt, is_locked: newState });

	// Sync the physical door's lock_state
	const newLockState = wantLocked ? 'locked' : 'unlocked';
	for (const door of world.doors.values()) {
		const doorZone = world.zones.get(door.zone_id);
		const targetId = doorZone?.exits?.[door.exit_dir];
		if (door.zone_id === zone.id || targetId === zone.id) {
			const hasMissingLockTag = (door.tags ?? []).some(t => t.type?.startsWith('lock:'));
			if (!hasMissingLockTag) continue;
			await query('UPDATE doors SET lock_state=$1 WHERE id=$2', [newLockState, door.id]);
			door.lock_state = newLockState;
			setDoorCache(door.id, door);
		}
	}

	return {
		type: "lock",
		message: wantLocked
			? "You lock the door behind you. Solid. For now."
			: "You unlock the door.",
	};
}

export async function cmdUpgradeLock(player) {
	const zone = getZone(player.current_zone);
	if (!isApartmentZone(zone))
		return { type: "error", message: "There is no lock to upgrade here." };

	const apt = getApartment(zone.id);
	if (!apt?.owner_id)
		return { type: "error", message: "You don't own a unit here." };
	if (apt.owner_id !== player.id)
		return { type: "error", message: "Not your place, not your lock." };
	if (apt.lock_difficulty >= MAX_LOCK_DIFFICULTY)
		return {
			type: "error",
			message:
				"The lock is already as good as anyone around here can build.",
		};

	if (!(await adjustCredits(player, -UPGRADE_COST)))
		return {
			type: "error",
			message: `Upgrading the lock costs ${UPGRADE_COST}c. You have ${player.credits}c.`,
		};

	const newDifficulty = apt.lock_difficulty + 1;
	await query("UPDATE apartments SET lock_difficulty=$1 WHERE zone_id=$2", [
		newDifficulty,
		zone.id,
	]);
	setApartmentCache(zone.id, { ...apt, lock_difficulty: newDifficulty });

	return {
		type: "upgrade",
		message: `You reinforce the lock. (Difficulty ${apt.lock_difficulty} → ${newDifficulty}, ${UPGRADE_COST}c spent)`,
	};
}

export async function cmdPickLock(player) {
	const zone = getZone(player.current_zone);
	if (!isApartmentZone(zone))
		return { type: "error", message: "There is no lock here to pick." };

	const apt = getApartment(zone.id);
	if (!apt?.owner_id)
		return {
			type: "error",
			message: "This place is unowned — the door is already open.",
		};
	if (apt.owner_id === player.id)
		return { type: "error", message: "It's your own door. Just open it." };
	if (!apt.is_locked)
		return { type: "error", message: "It's already unlocked." };

	const result = await skillCheck(player, "security", apt.lock_difficulty);

	if (result.success) {
		await awardSkillUse(player.id, "security", result.margin);
		return {
			type: "pick_success",
			message: `You work the lock — click. It gives.`,
			bypassed_zone: zone.id,
		};
	}
	return {
		type: "pick_fail",
		message: `You work at the lock, but it holds. (rolled ${result.total} vs difficulty ${result.difficulty})`,
	};
}

// Determine whether the player can sleep here right now, and how well.
export function getSleepEligibility(player, zone) {
	if (isApartmentZone(zone)) {
		const apt = getApartment(zone.id);
		if (apt?.owner_id === player.id) {
			return {
				canSleep: true,
				restore: SLEEP_RESTORE_HOME,
				reason: "home",
			};
		}
		// Someone else's apartment — only sleepable if unlocked (you broke in or owner left it open)
		if (apt?.is_locked) {
			return { canSleep: false, reason: "locked" };
		}
		return {
			canSleep: true,
			restore: SLEEP_RESTORE_SAFE_ZONE,
			reason: "unlocked_other",
		};
	}
	if (zone.is_safe_zone) {
		return {
			canSleep: true,
			restore: SLEEP_RESTORE_SAFE_ZONE,
			reason: "safe_zone",
		};
	}
	return { canSleep: false, reason: "unsafe" };
}

export async function cmdSleep(player) {
	if (player.sleeping)
		return {
			type: "error",
			message:
				"You are already asleep. (Send any other command to wake up.)",
		};

	const zone = getZone(player.current_zone);
	if (!zone)
		return { type: "error", message: "You are nowhere. This is a bug." };

	const elig = getSleepEligibility(player, zone);
	if (!elig.canSleep) {
		if (elig.reason === "locked")
			return {
				type: "error",
				message:
					"The door is locked. You can't sleep here unless it's yours or you pick the lock.",
			};
		return {
			type: "error",
			message:
				"It's not safe enough to sleep here. Find a secured apartment or a safe zone.",
		};
	}

	player.sleeping = {
		restore: elig.restore,
		reason: elig.reason,
		minutesSlept: 0,
	};

	const flavor =
		elig.reason === "home"
			? "You lie down behind your own locked door and let your guard down, finally."
			: "You catch a rough, watchful sleep. Better than nothing.";

	return {
		type: "sleep",
		message: `${flavor} You'll rest gradually while you're out — send any command to wake up early.`,
	};
}

// Called once per minute (gameLoop's resourceTick cadence) for every
// currently-sleeping player. Restores a slice of missing HP/sanity, drains
// hunger/thirst at the (slower-than-awake) sleep rate, and auto-wakes the
// player on any of: fully rested, hunger/thirst about to run out, or the
// safety cap on how long a single sleep can run uninterrupted.
export async function tickSleep(player) {
	if (!player.sleeping) return null;
	const { restore } = player.sleeping;

	const hpGain = Math.ceil((player.hp_max - player.hp) * restore.hp);
	const sanGain = Math.ceil(
		(player.sanity_max - player.sanity) * restore.sanity,
	);
	player.hp = Math.min(player.hp_max, player.hp + hpGain);
	player.sanity = Math.min(player.sanity_max, player.sanity + sanGain);
	player.hunger = Math.max(0, player.hunger - SLEEP_HUNGER_DRAIN);
	player.thirst = Math.max(0, player.thirst - SLEEP_THIRST_DRAIN);
	player.sleeping.minutesSlept++;

	await query(
		"UPDATE players SET hp=$1, sanity=$2, hunger=$3, thirst=$4 WHERE id=$5",
		[player.hp, player.sanity, player.hunger, player.thirst, player.id],
	);

	const fullyRested =
		player.hp >= player.hp_max && player.sanity >= player.sanity_max;
	const runningOnEmpty = player.hunger <= 5 || player.thirst <= 5;
	const tooLong = player.sleeping.minutesSlept >= SLEEP_MAX_MINUTES;

	if (fullyRested || runningOnEmpty || tooLong) {
		const reason = fullyRested
			? "You wake up fully rested."
			: runningOnEmpty
				? "Your stomach and throat wake you up before you starve in your sleep."
				: "You wake up, having slept as long as your body will allow in one go.";
		player.sleeping = null;
		return {
			type: "sleep_end",
			message: reason,
			player_update: {
				hp: player.hp,
				sanity: player.sanity,
				hunger: player.hunger,
				thirst: player.thirst,
			},
		};
	}

	return {
		type: "sleep_tick",
		message: `Still asleep. (+${hpGain} HP, +${sanGain} Sanity)`,
		player_update: {
			hp: player.hp,
			sanity: player.sanity,
			hunger: player.hunger,
			thirst: player.thirst,
		},
	};
}

export function describeRentStatus(zone, player) {
	if (!isApartmentZone(zone)) return '';
	const apt = getApartment(zone.id);
	if (!apt?.owner_id || apt.owner_id !== player.id) return '';
	const cost = apt.rent_cost ?? 100;
	const now = Date.now();
	const rentedAt = apt.date_rented * 1000;
	const daysSince = Math.floor((now - rentedAt) / 86400000);
	const daysUntilNext = 7 - (daysSince % 7);
	const nextDue = new Date(rentedAt + (Math.floor(daysSince / 7) + 1) * 7 * 86400000);
	const nextDueStr = nextDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	const urgency = daysUntilNext <= 1
		? `<span style="color:var(--red)">due tomorrow</span>`
		: daysUntilNext <= 3
			? `<span style="color:var(--yellow)">${daysUntilNext} days</span>`
			: `${daysUntilNext} days`;
	return `\n<span class="text-dim">Rent: <span style="color:var(--yellow)">${cost}c</span> due ${nextDueStr} (${urgency}).</span>`;
}

export async function describeApartmentStatus(zone) {
	if (!isApartmentZone(zone)) return "";
	const apt = getApartment(zone.id);
	if (!apt?.owner_id) {
		return `\n<span class="apartment-label">This unit is unowned.</span> (RENT to claim it for ${apt?.rent_cost ?? 100}c/week)`;
	}
	const lockState = apt.is_locked ? "locked" : "unlocked";
	const rentedDate = apt.date_rented ? new Date(apt.date_rented * 1000).toLocaleDateString() : '?';
	return `\n<span class="apartment-label">Owner: ${apt.owner_handle}.</span> The door is ${lockState}. Rented since ${rentedDate}. (UNRENT to vacate)`;
}
