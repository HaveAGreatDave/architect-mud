import { query } from "../models/db.js";
import { getApartment, setApartmentCache, getZone, world, setDoorCache, getPlayerMembership } from "./world.js";
import { skillCheck, awardSkillUse } from "./skills.js";
import { adjustCredits } from "./economy.js";
import { setPosture } from "./posture.js";
import { registerProtectionProvider } from "./protection.js";
import { hasPerm, PERM } from "./org-perms.js";

const HOME_TUTORIAL = `<span style="color:var(--accent)">◈ HOLOLOCK BOUND ◈</span>

Your HoloLock is now bound to your biometric signature. Here's what that means:

<span style="color:var(--yellow)">While you are offline or sleeping in this room:</span>
  • A <span style="color:var(--cyan)">quantum forcefield</span> activates around the unit, visible to anyone present.
  • All doors to this room lock automatically and become <span style="color:var(--red)">unhackable</span>.
  • No one can attack or loot you while the field is active.
  • The HoloLock begins to glow — a visible deterrent to anyone who looks at the door.

The forcefield drops the moment you reconnect or wake up.
`;

export async function cmdSetHome(player) {
	const zone = getZone(player.current_zone);
	if (!isApartmentZone(zone))
		return { type: 'error', message: 'You can only set home in an apartment you own.' };

	const apt = getApartment(zone.id);
	if (!apt?.owner_id || apt.owner_id !== player.id)
		return { type: 'error', message: "This isn't your place. You can't bind the HoloLock here." };

	const isFirstTime = !player.home_zone;
	player.home_zone = zone.id;
	await query('UPDATE players SET home_zone=$1 WHERE id=$2', [zone.id, player.id]);

	if (isFirstTime) {
		return {
			type: 'output',
			message: `${HOME_TUTORIAL}\n<span style="color:var(--accent)">Home set: ${zone.name}</span>`,
		};
	}
	return { type: 'output', message: `<span style="color:var(--accent)">Home set: ${zone.name}</span>` };
}

// An active forcefield protects the zone — published through the generic
// protection substrate so the attack/loot/steal/shove laws never know about
// apartments (engine/protection.js).
registerProtectionProvider((zoneId) => {
	const apt = getApartment(zoneId);
	if (apt?.forcefield_active) return { reason: 'forcefield' };
}, 'engine:apartments');

// Activate the forcefield for a player's home zone.
// broadcastFn is the server-level broadcast(zoneId, msg, excludeId) function.
export async function activateForcefield(player, broadcastFn) {
	const zoneId = player.home_zone;
	if (!zoneId || player.current_zone !== zoneId) return;

	const apt = getApartment(zoneId);
	if (!apt?.owner_id || apt.owner_id !== player.id) return;
	if (apt.forcefield_active) return; // already active

	await query('UPDATE apartments SET forcefield_active=1 WHERE zone_id=$1', [zoneId]);
	setApartmentCache(zoneId, { ...apt, forcefield_active: 1 });

	// Lock all doors to/from this zone that have a lock tag and set forcefield_locked.
	for (const door of world.doors.values()) {
		const doorZone = world.zones.get(door.zone_id);
		const targetId = doorZone?.exits?.[door.exit_dir];
		if (door.zone_id !== zoneId && targetId !== zoneId) continue;
		if (!Object.keys(door.tags || {}).some(k => k.startsWith('lock:'))) continue;
		await query("UPDATE doors SET lock_state='locked', forcefield_locked=1 WHERE id=$1", [door.id]);
		door.lock_state = 'locked';
		door.forcefield_locked = 1;
		setDoorCache(door.id, door);
	}

	if (broadcastFn) {
		// Bystanders see it from the outside.
		broadcastFn(zoneId, {
			type: 'zone_event',
			message: `<span style="color:var(--cyan)">A low hum fills the air as ${player.handle}'s HoloLock pulses with blue light. A <strong>quantum forcefield</strong> shimmers into existence around the unit — ${player.handle} is protected.</span>`,
		}, player.id);
		// Owner gets a first-person confirmation.
		const FORCEFIELD_UP_OWNER = [
			`<span style="color:var(--cyan)">◈ HoloLock engaged. A quantum forcefield seals the unit around you. Sleep easy.</span>`,
			`<span style="color:var(--cyan)">◈ Forcefield active. The HoloLock hums softly as the barrier locks into place. You're sealed in.</span>`,
			`<span style="color:var(--cyan)">◈ Quantum barrier established. Your HoloLock pulses once and goes steady. Nobody's getting in.</span>`,
			`<span style="color:var(--cyan)">◈ HoloLock online. The air shimmers as the forcefield closes around you. You are protected.</span>`,
			`<span style="color:var(--cyan)">◈ Barrier up. Your HoloLock seals the unit tight. The world outside can wait.</span>`,
		];
		const ownerMsg = FORCEFIELD_UP_OWNER[Math.floor(Math.random() * FORCEFIELD_UP_OWNER.length)];
		broadcastFn(null, { type: 'output', message: ownerMsg }, null, player.id);
		broadcastFn(zoneId, { type: 'sound', sound: 'hololock_activate' });
	}
}

// Deactivate the forcefield when the player comes back online or wakes up.
const FORCEFIELD_DOWN_BYSTANDER = [
	(handle) => `<span style="color:var(--cyan)">The field around ${handle}'s unit collapses with a sharp crack. The HoloLock dims to black. The door is just a door again.</span>`,
	(handle) => `<span style="color:var(--cyan)">A low whine drops in pitch and cuts out. The quantum barrier sealing ${handle}'s unit unravels — threads of blue light dissolving into nothing.</span>`,
	(handle) => `<span style="color:var(--cyan)">The shimmer around ${handle}'s door snaps off like a switch being thrown. The HoloLock's pulse slows, steadies, and goes dark.</span>`,
	(handle) => `<span style="color:var(--cyan)">Static crackles across the surface of the field protecting ${handle}'s unit, then — silence. The glow dies. Whatever was in there is awake again.</span>`,
	(handle) => `<span style="color:var(--cyan)">${handle}'s HoloLock shudders once, twice, then goes cold. The forcefield peels back like a heat-haze and is gone.</span>`,
];

const FORCEFIELD_DOWN_OWNER = [
	`<span style="color:var(--cyan)">◈ Your HoloLock disengages. The forcefield drops. You're back in the world.</span>`,
	`<span style="color:var(--cyan)">◈ Biometric resync confirmed. The quantum barrier dissolves. HoloLock standing by.</span>`,
	`<span style="color:var(--cyan)">◈ The field collapses as you surface. HoloLock dark. You're exposed again — stay sharp.</span>`,
	`<span style="color:var(--cyan)">◈ Presence detected. Forcefield terminated. Your HoloLock is back to idle.</span>`,
	`<span style="color:var(--cyan)">◈ Signal restored. The barrier peels back. HoloLock offline — you're on your own now.</span>`,
];

export async function deactivateForcefield(playerId, zoneId, broadcastFn) {
	if (!zoneId) return;
	const apt = getApartment(zoneId);
	if (!apt || !apt.forcefield_active) return;

	// Need the owner's handle for bystander messages.
	const { rows: pRows } = await query('SELECT handle FROM players WHERE id=$1', [playerId]);
	const handle = pRows[0]?.handle ?? 'Someone';

	await query('UPDATE apartments SET forcefield_active=0 WHERE zone_id=$1', [zoneId]);
	setApartmentCache(zoneId, { ...apt, forcefield_active: 0 });

	// Release forcefield-locked doors; respect the apartment's own lock state.
	const wantLocked = apt.is_locked ? 'locked' : 'unlocked';
	for (const door of world.doors.values()) {
		if (!door.forcefield_locked) continue;
		const doorZone = world.zones.get(door.zone_id);
		const targetId = doorZone?.exits?.[door.exit_dir];
		if (door.zone_id !== zoneId && targetId !== zoneId) continue;
		await query('UPDATE doors SET lock_state=$1, forcefield_locked=0 WHERE id=$2', [wantLocked, door.id]);
		door.lock_state = wantLocked;
		door.forcefield_locked = 0;
		setDoorCache(door.id, door);
	}

	if (broadcastFn) {
		const bystanderMsg = FORCEFIELD_DOWN_BYSTANDER[Math.floor(Math.random() * FORCEFIELD_DOWN_BYSTANDER.length)](handle);
		const ownerMsg = FORCEFIELD_DOWN_OWNER[Math.floor(Math.random() * FORCEFIELD_DOWN_OWNER.length)];
		// Bystanders see the field collapse from outside.
		broadcastFn(zoneId, { type: 'zone_event', message: bystanderMsg }, playerId);
		// Owner gets a personal confirmation.
		broadcastFn(null, { type: 'output', message: ownerMsg }, null, playerId);
		broadcastFn(zoneId, { type: 'sound', sound: 'hololock_deactivate' });
	}
}

// Resolve the building name for an apartment zone by following its exits back
// to a lobby (the first exit that points to a non-apartment zone).
function getBuildingName(zone) {
  // Walk the parent_zone chain to the building root and use its name — an
  // apartment reports the building it belongs to (e.g. "The Meridian"), not the
  // adjacent hallway. Guarded against cycles.
  let cur = zone;
  const seen = new Set();
  while (cur?.parent_zone && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = getZone(cur.parent_zone);
    if (!parent) break;
    cur = parent;
  }
  if (cur && cur !== zone) return cur.flags?.building_name || cur.name;
  // No parent chain — fall back to the first adjacent non-apartment room.
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

// Whether the player may act as this unit's owner. A personal unit is controlled
// by its owner; a corp HQ (owner_type='org') is controlled by any corp member
// holding the manage_hq permission. Home-bind, forcefield and best-rest stay
// strictly personal (they still test owner_id === player.id directly).
export function playerControlsApt(player, apt) {
	if (!apt?.owner_id) return false;
	if (apt.owner_type === 'org') {
		const m = getPlayerMembership(player.id);
		return m?.org_id === apt.owner_org_id && hasPerm(player, PERM.MANAGE_HQ);
	}
	return apt.owner_id === player.id;
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
	const nextDueDate = new Date((now + 7 * 86400) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
	return {
		type: "rent",
		message: `Congratulations — you are the proud new owner of <span style="color:var(--accent)">${zone.name}</span>!\n\n<span class="text-dim">Rented:</span> ${rentedDate}\n<span class="text-dim">Weekly rent:</span> <span style="color:var(--yellow)">${cost}c</span>\n<span class="text-dim">First payment due:</span> ${nextDueDate}\n\nType LOCK to secure the door when you leave. Type UNRENT to give the place up.`,
	};
}

export async function cmdUnrent(player) {
	const zone = getZone(player.current_zone);
	if (!isApartmentZone(zone))
		return { type: "error", message: "There is nothing to unrent here." };

	const apt = getApartment(zone.id);
	if (!apt?.owner_id)
		return { type: "error", message: "Nobody owns this unit." };
	if (!playerControlsApt(player, apt))
		return { type: "error", message: "This isn't your place to give up." };

	const cost = apt.rent_cost ?? 100;
	const rentedDate = apt.date_rented
		? new Date(apt.date_rented * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
		: 'unknown';
	await releaseApartment(apt, zone.id);

	return {
		type: "unrent",
		message: `<span style="color:var(--accent)">${zone.name}</span> has been vacated. You've handed back the keys — the unit is no longer yours.\n\n<span class="text-dim">Rented since:</span> ${rentedDate}\n<span class="text-dim">Weekly rent saved:</span> <span style="color:var(--yellow)">${cost}c</span>\n\nNo further payments will be collected.`,
	};
}

// Shared teardown used by both cmdUnrent and the rent-collection tick.
export async function releaseApartment(apt, zoneId) {
	const updated = await query(
		`UPDATE apartments SET owner_id=NULL, owner_handle=NULL, owner_type='player', owner_org_id=NULL, is_locked=0, date_rented=NULL, building_name=NULL WHERE zone_id=$1 RETURNING *`,
		[zoneId],
	);
	setApartmentCache(zoneId, updated.rows[0]);

	// Unlock the physical door so the next tenant can enter.
	for (const door of world.doors.values()) {
		const doorZone = world.zones.get(door.zone_id);
		const targetId = doorZone?.exits?.[door.exit_dir];
		if (door.zone_id === zoneId || targetId === zoneId) {
			if (!Object.keys(door.tags || {}).some(k => k.startsWith('lock:'))) continue;
			await query('UPDATE doors SET lock_state=$1 WHERE id=$2', ['unlocked', door.id]);
			door.lock_state = 'unlocked';
			setDoorCache(door.id, door);
		}
	}
}

// Release a corp HQ back to vacant (clears org ownership + unlocks the door).
// Used on disband and corp-HQ teardown. releaseApartment handles owner_type/
// owner_org_id reset and door unlock, so this is a thin, cache-syncing wrapper.
export async function releaseCorpHq(zoneId) {
	const apt = getApartment(zoneId);
	if (apt) await releaseApartment(apt, zoneId);
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
	if (!playerControlsApt(player, apt))
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
			const hasLockTag = Object.keys(door.tags || {}).some(k => k.startsWith('lock:'));
			if (!hasLockTag) continue;
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
	if (!playerControlsApt(player, apt))
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
	if (playerControlsApt(player, apt))
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
		message: `You work at the lock, but it holds. (skill ${result.effective} vs difficulty ${result.difficulty})`,
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

export async function cmdSleep(player, broadcastFn) {
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

	// Look for somewhere to lie — furniture with a 'lie' interaction, or named like a bed/couch.
	const BED_NAMES = /\b(bed|cot|bunk|mattress|couch|sofa|futon|hammock|cot|pallet|bedroll|sleeping bag|lounger)\b/i;
	const { rows: furnitureRows } = await query(
		`SELECT * FROM furniture WHERE zone_id=$1 LIMIT 20`,
		[player.current_zone],
	);
	const lieSpot = furnitureRows.find(f =>
		f.flags?.interactions?.includes?.('lie') || BED_NAMES.test(f.name)
	);

	player.sleeping = {
		restore: elig.restore,
		reason: elig.reason,
		minutesSlept: 0,
	};
	setPosture(player, 'lying');

	let selfMsg, roomMsg;
	if (lieSpot) {
		const n = lieSpot.name;
		const SELF_BED = [
			`You pull back the covers and collapse onto the ${n}, too tired to care about anything else.`,
			`You drop onto the ${n} with a groan of relief and close your eyes.`,
			`You crawl onto the ${n} and curl up, letting the exhaustion take over.`,
			`You sink into the ${n} and feel the tension leave your body almost immediately.`,
			`You stretch out on the ${n} and stare at the ceiling for about three seconds before passing out.`,
		];
		const ROOM_BED = [
			(h) => `${h} collapses onto the ${n} and goes still.`,
			(h) => `${h} drops onto the ${n} with a grunt and closes their eyes.`,
			(h) => `${h} crawls onto the ${n} and curls up.`,
			(h) => `${h} sinks into the ${n} and is asleep almost immediately.`,
			(h) => `${h} lies down on the ${n} and goes quiet.`,
		];
		const i = Math.floor(Math.random() * SELF_BED.length);
		selfMsg = SELF_BED[i];
		roomMsg = ROOM_BED[i](player.handle);
	} else {
		const SELF_FLOOR = [
			`There's nowhere comfortable to sleep. You clear a patch of floor and lie down anyway.`,
			`No bed. You fold your jacket into a pillow, settle onto the floor, and close your eyes.`,
			`You find the least filthy stretch of floor and lie down. It's exactly as bad as it sounds.`,
			`You curl up on the hard floor, back against the wall, and try to pretend it's fine.`,
			`No furniture, no comfort. You lie down on the floor like an animal and make peace with it.`,
		];
		const ROOM_FLOOR = [
			(h) => `${h} clears a space on the floor and lies down.`,
			(h) => `${h} folds their jacket into a pillow and settles onto the floor.`,
			(h) => `${h} lies down on the floor with a look of grim acceptance.`,
			(h) => `${h} curls up on the floor, back to the wall.`,
			(h) => `${h} drops onto the floor and goes still.`,
		];
		const i = Math.floor(Math.random() * SELF_FLOOR.length);
		selfMsg = SELF_FLOOR[i];
		roomMsg = ROOM_FLOOR[i](player.handle);
	}

	broadcastFn(player.current_zone, { type: 'zone_event', message: roomMsg }, player.id);

	let extra = '';
	if (elig.reason === "home") {
		if (player.home_zone === player.current_zone) {
			await activateForcefield(player, broadcastFn);
		} else {
			extra = '\n<span class="text-dim">◈ HoloLock unbound — type <strong>.home</strong> here to enable the forcefield when you sleep.</span>';
		}
	}

	return {
		type: "sleep",
		message: `${selfMsg}\n\nYou'll rest gradually while you're out — send any command to wake up early.${extra}`,
	};
}

const SLEEP_NOISES = [
	{ self: 'You snore loudly.', room: (h) => `${h} snores loudly.` },
	{ self: 'You let out a long, rattling snore.', room: (h) => `${h} lets out a long, rattling snore.` },
	{ self: 'You mumble something in your sleep.', room: (h) => `${h} mumbles something unintelligible.` },
	{ self: 'You twitch in your sleep.', room: (h) => `${h} twitches in their sleep.` },
	{ self: 'You grind your teeth.', room: (h) => `${h} grinds their teeth loudly.` },
	{ self: 'You drool a little. Peacefully.', room: (h) => `${h} drools in their sleep.` },
	{ self: 'You murmur something about credits.', room: (h) => `${h} murmurs something about credits.` },
	{ self: 'You whimper quietly.', room: (h) => `${h} whimpers quietly in their sleep.` },
	{ self: 'You fart in your sleep. Blissfully unaware.', room: (h) => `${h} farts in their sleep.` },
	{ self: 'You roll over with a grunt.', room: (h) => `${h} rolls over with a grunt.` },
];

// Called once per minute (gameLoop's resourceTick cadence) for every
// currently-sleeping player. Restores a slice of missing HP/sanity, drains
// hunger/thirst at the (slower-than-awake) sleep rate, and auto-wakes the
// player on any of: fully rested, hunger/thirst about to run out, or the
// safety cap on how long a single sleep can run uninterrupted.
export async function tickSleep(player, broadcastFn) {
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

	if (Math.random() < 0.25) {
		const noise = SLEEP_NOISES[Math.floor(Math.random() * SLEEP_NOISES.length)];
		broadcastFn(null, { type: 'output', message: `<em>${noise.self}</em>` }, null, player.id);
		broadcastFn(player.current_zone, { type: 'zone_event', message: `<em>${noise.room(player.handle)}</em>` }, player.id);
	}

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
		setPosture(player, 'standing');
		await deactivateForcefield(player.id, player.home_zone, broadcastFn);
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
	if (apt.owner_type === 'org') {
		return `\n<span class="apartment-label">Corp HQ: ${apt.owner_handle}.</span> The door is ${lockState}.`;
	}
	const rentedDate = apt.date_rented ? new Date(apt.date_rented * 1000).toLocaleDateString() : '?';
	let status = `\n<span class="apartment-label">Owner: ${apt.owner_handle}.</span> The door is ${lockState}. Rented since ${rentedDate}. (UNRENT to vacate)`;
	if (apt.forcefield_active) {
		status += `\n<span style="color:var(--cyan)">◈ A <strong>quantum forcefield</strong> crackles faintly around this unit. The HoloLock pulses with a cold blue glow. Whoever lives here is inside — and unreachable.</span>`;
	}
	return status;
}

export function describeDoorForcefield(door) {
	if (!door?.forcefield_locked) return '';
	return ` <span style="color:var(--cyan)">[The HoloLock is glowing — a quantum forcefield secures this door.]</span>`;
}
