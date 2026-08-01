import { query } from "../models/db.js";
import { getApartment, setApartmentCache, getZone, world, setDoorCache, getPlayerMembership, moveNpcToZone, updateNpc, getConnection } from "./world.js";
import { findPath } from "./pathfinding.js";
import { skillCheck, awardSkillUse } from "./skills.js";
import { adjustCredits } from "./economy.js";
import { setPosture } from "./posture.js";
import { registerProtectionProvider } from "./protection.js";
import { isSanctuary, allowsSleep } from "./zone-tags.js";
import { isWired } from "./drugs.js";
import { hasPerm, PERM } from "./org-perms.js";
import { exitTargets, neighborZoneIds } from "./exits.js";
import { emit } from "./events.js";
import { fireHook } from "./plugins.js";
import { getEnvironmentState } from "./environment.js";
import { fatigueOf, sleepRecoveryPerMinute } from "./condition.js";
import { gameMinutes, minutesUntil, hhmm } from "./clock.js";
import { applyEffect } from "./effects.js";
import { getFlag } from "./flags.js";
import { rollDream } from "./dreams.js";
import { buildDreamscape, wakeFromDream, pushDreamFx } from "./dreamscape.js";
import { addPlayerToZone } from "./world.js";

// ── Rent runs on the GAME calendar ──────────────────────────────────────────
// Rent is billed every RENT_PERIOD_DAYS *game* days, so it scales with the
// game-speed knob (at 3× a "week" of rent is ~2⅓ real days). All the date math
// below works off the game date (state.date) rather than the wall clock.
export const RENT_PERIOD_DAYS = 7;

// The current in-world date ('YYYY-MM-DD'), or null before the environment boots.
export function gameToday() {
  try { return ymd(getEnvironmentState().date); } catch { return null; }
}
// Normalise a DATE column (pg may hand back a Date or a string) → 'YYYY-MM-DD'.
export function ymd(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
// Shift a 'YYYY-MM-DD' game date by n days (UTC, calendar-correct across months/years).
export function addGameDays(ymdStr, n) {
  const dt = new Date(`${ymdStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
// Whole game-days from a→b (b − a); negative if b is before a.
export function gameDaysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
// In-world month names — the calendar's naming rights got sold off. Positionally
// 1:1 with Jan–Dec so any real date maps cleanly; used everywhere a game date is
// shown to a player (rent notices here, the tablet Calendar app).
export const MONTHS = [
  'Janufizz', 'Februtek', 'Marchex', 'Aprilex', 'Maytrix', 'Junet',
  'Julyte', 'Augmentum', 'Septek', 'Octane', 'Novapex', 'Decibel',
];
// Pretty-print a 'YYYY-MM-DD' game date as e.g. "9 Junet 2087".
function formatGameDate(ymdStr) {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// The zone(s) on the far side of a door. Since step 7 a door IS a fixture on a
// connection, so its far side is the connection's other end — one fact, authored,
// and immune to the exits lookup below drifting. The fallbacks stay for the door
// a lint gate hasn't caught yet and for transient zones, which have no rows.
function doorFarIds(door) {
	const conn = door.connection_id ? getConnection(door.connection_id) : null;
	if (conn) return [conn.a === door.zone_id ? conn.b : conn.a];
	if (door.target_zone) return [door.target_zone];
	return exitTargets(world.zones.get(door.zone_id), door.exit_dir);
}

// The zone(s) this door touches other than `fromZoneId` — i.e. the side facing an
// onlooker in the hallway when the field seals the unit. Anchor-agnostic.
function doorOtherSide(door, fromZoneId) {
	return [door.zone_id, ...doorFarIds(door)].filter(z => z && z !== fromZoneId);
}

// Boot-time reconciliation. Door lock state is runtime-only (world.doors resets to
// authored state on load), but apartments.is_locked is durable player housing state.
// Re-apply each locked unit's lock onto its physical door(s) in RAM so a rented,
// locked home stays locked across a restart. Called once from server boot after
// initWorld() — apt.is_locked is the single source of truth for apartment locks.
export function reconcileApartmentDoorLocks() {
	let relocked = 0;
	for (const apt of world.apartments.values()) {
		if (!apt.is_locked) continue;
		for (const door of world.doors.values()) {
			if (door.zone_id !== apt.zone_id && !doorFarIds(door).includes(apt.zone_id)) continue;
			if (!Object.keys(door.tags || {}).some(k => k.startsWith('lock:'))) continue;
			door.lock_state = 'locked';
			setDoorCache(door.id, door);
			relocked++;
		}
	}
	if (relocked) console.log(`✓ Apartment locks reconciled: ${relocked} door(s) relocked`);
}

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

	// A system can veto the safe-sleep forcefield — the burglary plugin denies it
	// while a break-in is actually underway at this unit, so you can't wall
	// yourself off (or disconnect to safety) with an intruder at the door.
	const blockReason = await fireHook('forcefield.gate', { player, zoneId });
	if (blockReason) {
		if (broadcastFn) {
			broadcastFn(zoneId, {
				type: 'zone_event',
				message: `<span style="color:var(--red)">${player.handle}'s HoloLock sputters and dies — the forcefield can't seal with an intruder at the door.</span>`,
			}, player.id);
			broadcastFn(null, {
				type: 'output',
				message: `<span style="color:var(--red)">◈ HoloLock REFUSED — ${typeof blockReason === 'string' ? blockReason : 'a break-in is in progress'}. No safe forcefield while they're breaching your home. You sleep exposed.</span>`,
			}, null, player.id);
		}
		return;
	}

	await query('UPDATE apartments SET forcefield_active=1 WHERE zone_id=$1', [zoneId]);
	setApartmentCache(zoneId, { ...apt, forcefield_active: 1 });

	// Lock all doors to/from this zone that have a lock tag and set forcefield_locked.
	// Track the far side of each so a bystander in the hallway sees the lock light up.
	const farSideZones = new Set();
	for (const door of world.doors.values()) {
		if (door.zone_id !== zoneId && !doorFarIds(door).includes(zoneId)) continue;
		if (!Object.keys(door.tags || {}).some(k => k.startsWith('lock:'))) continue;
		// Door state is runtime-only (world.doors is the live truth); the forcefield
		// only stands while the owner is offline/asleep, so nothing to persist.
		door.lock_state = 'locked';
		door.forcefield_locked = 1;
		setDoorCache(door.id, door);
		for (const z of doorOtherSide(door, zoneId)) farSideZones.add(z);
	}

	if (broadcastFn) {
		// Bystanders see it from the outside.
		broadcastFn(zoneId, {
			type: 'zone_event',
			message: `<span style="color:var(--cyan)">A low hum fills the air as ${player.handle}'s HoloLock pulses with blue light. A <strong>quantum forcefield</strong> shimmers into existence around the unit — ${player.handle} is protected.</span>`,
		}, player.id);
		// Anyone standing at the door from the far side watches the lock come alive.
		for (const z of farSideZones) {
			broadcastFn(z, {
				type: 'zone_event',
				message: `<span style="color:var(--cyan)">The HoloLock on the door flickers, then flares steady blue — the unit beyond has sealed itself for the night.</span>`,
			});
		}
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
	// Track far sides so the hallway sees the lock go dark, mirroring activation.
	const wantLocked = apt.is_locked ? 'locked' : 'unlocked';
	const farSideZones = new Set();
	for (const door of world.doors.values()) {
		if (!door.forcefield_locked) continue;
		if (door.zone_id !== zoneId && !doorFarIds(door).includes(zoneId)) continue;
		// Runtime-only (see activateForcefield): restore the door to the apartment's
		// own lock state in RAM; apt.is_locked is what persists on the apartments table.
		door.lock_state = wantLocked;
		door.forcefield_locked = 0;
		setDoorCache(door.id, door);
		for (const z of doorOtherSide(door, zoneId)) farSideZones.add(z);
	}

	if (broadcastFn) {
		const bystanderMsg = FORCEFIELD_DOWN_BYSTANDER[Math.floor(Math.random() * FORCEFIELD_DOWN_BYSTANDER.length)](handle);
		const ownerMsg = FORCEFIELD_DOWN_OWNER[Math.floor(Math.random() * FORCEFIELD_DOWN_OWNER.length)];
		// Bystanders see the field collapse from outside.
		broadcastFn(zoneId, { type: 'zone_event', message: bystanderMsg }, playerId);
		// The far side watches the HoloLock's glow die back to idle.
		for (const z of farSideZones) {
			broadcastFn(z, {
				type: 'zone_event',
				message: `<span style="color:var(--cyan)">The HoloLock on the door dims from blue to dead black — the unit beyond is no longer sealed.</span>`,
			});
		}
		// Owner gets a personal confirmation.
		broadcastFn(null, { type: 'output', message: ownerMsg }, null, playerId);
		broadcastFn(zoneId, { type: 'sound', sound: 'hololock_deactivate' });
	}
}

// Resolve the building name for an apartment zone by following its exits back
// to a lobby (the first exit that points to a non-apartment zone).
export function getBuildingName(zone) {
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
  for (const linkedId of neighborZoneIds(zone)) {
    const linked = getZone(linkedId);
    if (linked && !linked.flags?.is_apartment) return linked.name;
  }
  return null;
}

// Does this player hold a unit in the named building? Reads the in-memory
// apartments cache (world.apartments) and the same getBuildingName() every other
// caller uses, so it's a pure sync query — safe on a move gate or in the flight
// field resolver. Backs `flags.residents_only` (the residency plugin's law) and
// the private-pad gate on a building's own airfield.
export function isResidentOf(player, buildingName) {
	if (!player || !buildingName) return false;
	for (const [zoneId, apt] of world.apartments) {
		if (!playerControlsApt(player, apt)) continue;
		if (getBuildingName(getZone(zoneId)) === buildingName) return true;
	}
	return false;
}

// Picking a lock gets harder the more the owner has invested in it.
// Difficulty is a flat number compared against a d10 + rank + stat-bonus roll
// (see skills.js:skillCheck) — same shape as every other check in the game.
const BASE_LOCK_DIFFICULTY = 4;
const MAX_LOCK_DIFFICULTY = 14;
const UPGRADE_COST = 75; // credits per difficulty point, after the first

// AUTHORED per-unit rent price. This is CONTENT — it lives on the zone (`flags.
// rent_cost`) so it returns identically after any restart/rebuild, NOT in the
// `apartments` table (which is now purely a player-tenancy ledger — owner/lock/dates
// that never round-trip through git). Unpriced units fall back to the 100c default.
// Owned units also cache their rent_cost in their apartments row (set from this at
// rent time), so the recurring rent-charge tick keeps reading it off the tenancy.
export function authoredRentCost(zone) {
	const rc = zone?.flags?.rent_cost;
	return (typeof rc === 'number' && rc >= 0) ? rc : 100;
}

// How much of the player's *missing* HP/sanity/stamina is restored per minute
// of sleep — gradual, not instant. Sleeping in your own locked apartment is
// the fastest, best rest; sleeping anywhere else "safe" is slower and
// shallower; sleeping somewhere dangerous doesn't work at all. Stamina comes
// back fastest of the three — a good sleep leaves you rested well before your
// wounds knit or your head clears.
const SLEEP_RESTORE_HOME = { hp: 0.18, sanity: 0.15, stamina: 0.5 };
const SLEEP_RESTORE_SAFE_ZONE = { hp: 0.08, sanity: 0.05, stamina: 0.35 };

// Sleep isn't free — your body still burns through hunger/thirst while
// you're out, just slower than the cost of staying awake and active would
// otherwise imply nothing was happening. Per minute of sleep.
const SLEEP_HUNGER_DRAIN = 1;
const SLEEP_THIRST_DRAIN = 1;
// Auto-wake BACKSTOP, in game minutes — not the length of a sleep. It used to be
// 30, which was the finish line back when hitting "fully rested" ended the sleep
// anyway; now that being rested is only a notice (see tickSleep), a player bedding
// down to skip a night has to be able to stay in bed. Hunger/thirst are the real
// bound long before this — they drain 1/minute and wake you at 5 — so this only
// catches a sleeper who went to bed stuffed and never came back.
const SLEEP_MAX_MINUTES = 180;
// Well Rested runs on the 1s effects tick, so this is half an hour of play for
// about five minutes in a bed. Deliberately generous: the buff is what makes
// sleeping worth doing, and it should comfortably outlast the errand.
const WELL_RESTED_TICKS = 1800;

export function isApartmentZone(zone) {
	return !!zone?.flags?.is_apartment;
}

// A unit an NPC calls home is occupied and can't be rented. Tracked in the separate
// `npc_residences` registry (NOT the player `apartments` ledger), kept in sync with
// npc.home_zone. Returns { npc_id, npc_name } for the resident, or null.
export async function getNpcResidence(zoneId) {
	if (!zoneId) return null;
	const { rows } = await query(
		`SELECT r.npc_id, n.name AS npc_name FROM npc_residences r
		 LEFT JOIN npcs n ON n.id = r.npc_id WHERE r.zone_id=$1 LIMIT 1`,
		[zoneId],
	);
	return rows[0] || null;
}

// The closest vacant apartment to `fromZoneId`, measured in walking distance (hops
// over the exit graph, so it naturally prefers another unit in the SAME building,
// then the nearest neighbouring building). "Vacant" = an is_apartment zone with no
// player owner and no NPC resident. `exceptZoneId` is force-excluded (the unit an
// NPC is being moved out of). Returns the zone id, or null if the whole map is full.
export async function findNearestVacantApartment(fromZoneId, exceptZoneId) {
	const { rows } = await query('SELECT zone_id FROM npc_residences');
	const occupied = new Set(rows.map(r => r.zone_id));
	let best = null, bestHops = Infinity;
	for (const z of world.zones.values()) {
		if (!isApartmentZone(z) || z.id === exceptZoneId) continue;
		if (occupied.has(z.id) || getApartment(z.id)?.owner_id) continue;
		const path = findPath(fromZoneId, z.id, { maxDistance: 100 });
		if (!path) continue;
		const hops = path.length - 1;
		if (hops < bestHops) { best = z.id; bestHops = hops; }
	}
	return best;
}

// Move an NPC's registered home to `newZoneId`: repoint home_zone, rewrite the
// npc_residences tracker (one row per NPC — the old row, and thus the old unit's
// occupancy, is dropped), and relocate the live NPC there now so they're standing in
// their new place; the AT_HOME_LIFE behaviour keeps them there. zone_id is persisted
// because an eviction is a deliberate placement, not autonomous drift the loader skips.
export async function rehomeNpc(npc, newZoneId) {
	await updateNpc(npc.id, { home_zone: newZoneId, zone_id: newZoneId });
	await query('DELETE FROM npc_residences WHERE npc_id=$1', [npc.id]);
	await query(
		`INSERT INTO npc_residences (zone_id, npc_id) VALUES ($1,$2)
		 ON CONFLICT (zone_id) DO UPDATE SET npc_id=$2`,
		[newZoneId, npc.id],
	);
	npc.home_zone = newZoneId;
	moveNpcToZone(npc.id, newZoneId);
}

// Evict an NPC from their unit with nowhere to rehome them: drop the residence row
// (freeing the old unit) and turn them out to the generic residential lobby so they
// aren't left registered anywhere. Used only when the map has no vacancy.
export async function clearNpcResidence(npc) {
	const fallback = world.zones.has('zone_residential_lobby') ? 'zone_residential_lobby' : npc.home_zone;
	await query('DELETE FROM npc_residences WHERE npc_id=$1', [npc.id]);
	await updateNpc(npc.id, { home_zone: fallback, zone_id: fallback });
	npc.home_zone = fallback;
	if (world.zones.has(fallback)) moveNpcToZone(npc.id, fallback);
}

// LAW: an NPC may never be homed in an apartment a PLAYER owns. NPCs sharing the
// general rentable pool is intended design (one housing pool; an NPC home in a
// rentable unit is fine) — but once a player holds the deed (apartments.owner_id
// set, i.e. the "flag on take"), that unit is theirs and no NPC may squat it.
// The auto-home finder (findNearestVacantApartment) already skips owned units, so
// the only way an NPC ends up in one is a hardcoded content home_zone authored into
// an owned unit — the recurring "someone's in Akerson's 2A" bug that used to need a
// bespoke plugin per case. This runs once at boot (after loadNpcs + loadApartments)
// and rehomes any such squatter to the nearest vacancy, making ownership authoritative
// over homing everywhere, not one apartment at a time. Idempotent/converging: after the
// move the NPC's home is an unowned unit, so the next boot re-checks it and does nothing.
// True when this NPC is homed in an apartment a player OWNS — the invariant the
// boot reconcile corrects. Pure/read-only: the testable core of the law, split out
// so a test can assert the predicate without the DB-writing rehome path.
export function npcHomedInOwnedUnit(npc) {
	const home = npc?.home_zone;
	return !!home && isApartmentZone(getZone(home)) && !!getApartment(home)?.owner_id;
}

export async function reconcileNpcHomesVsOwnership() {
	let moved = 0;
	for (const npc of world.npcs.values()) {
		if (!npcHomedInOwnedUnit(npc)) continue;   // only PLAYER-owned units
		const home = npc.home_zone;
		const dest = await findNearestVacantApartment(home, home);
		if (dest) {
			await rehomeNpc(npc, dest);
			console.log(`[apartments] rehomed ${npc.name} out of player-owned ${home} → ${dest}`);
		} else {
			await clearNpcResidence(npc);
			console.log(`[apartments] turned ${npc.name} out of player-owned ${home} → residential lobby (no vacancy)`);
		}
		moved++;
	}
	if (moved) console.log(`[apartments] reconciled ${moved} NPC home(s) out of player-owned units`);
}

// Defensive invariant: an apartment's lock is meaningful only while the unit is
// owned. Without an owner nobody holds lock auth, so a door left locked on an
// unrented apartment (authored content, a stale admin lock, an eviction that
// skipped cleanup) would seal it shut forever. This reports such a door as
// effectively unlocked so every gate/read treats unrented units as open.
// Returns true only when the door touches an apartment AND no apartment side of
// it is owned — a door with any owned apartment side keeps its real lock.
export function doorGuardsOnlyUnownedApartment(door) {
	if (!door || door.lock_state !== 'locked') return false;
	let touchesApartment = false;
	for (const zid of [door.zone_id, ...doorFarIds(door)]) {
		if (!isApartmentZone(getZone(zid))) continue;
		touchesApartment = true;
		if (getApartment(zid)?.owner_id) return false;
	}
	return touchesApartment;
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

	const resident = await getNpcResidence(zone.id);
	if (resident)
		return {
			type: "error",
			message: `${resident.npc_name || "Someone"} already lives here — this unit isn't for rent.`,
		};

	const apt = getApartment(zone.id);
	if (apt?.owner_id) {
		if (apt.owner_id === player.id)
			return { type: "error", message: "You already own this place." };
		return {
			type: "error",
			message: `This unit is already owned by ${apt.owner_handle}.`,
		};
	}

	const cost = authoredRentCost(zone);
	if (!(await adjustCredits(player, -cost, undefined, 'apartment:rent-claim')))
		return {
			type: "error",
			message: `You need ${cost}c to claim this unit. You have ${player.credits}c.`,
		};

	const buildingName = getBuildingName(zone) ?? 'the building';
	const now = Math.floor(Date.now() / 1000);
	// Anchor the rent cycle to the GAME calendar: first payment is due
	// RENT_PERIOD_DAYS game-days from today. Falls back to null if the environment
	// isn't ready (the rollover tick will lazily initialise it).
	const gToday = gameToday();
	const rentDue = gToday ? addGameDays(gToday, RENT_PERIOD_DAYS) : null;

	const updated = await query(
		`INSERT INTO apartments (zone_id, owner_id, owner_handle, is_locked, lock_difficulty, rent_cost, purchased_at, date_rented, building_name, rent_due_date)
     VALUES ($1,$2,$3,0,$4,$5,$6,$6,$7,$8)
     ON CONFLICT (zone_id) DO UPDATE SET owner_id=$2, owner_handle=$3, is_locked=0, lock_difficulty=$4, purchased_at=$6, date_rented=$6, building_name=$7, rent_due_date=$8
     RETURNING *`,
		[zone.id, player.id, player.handle, BASE_LOCK_DIFFICULTY, cost, now, buildingName, rentDue],
	);
	setApartmentCache(zone.id, updated.rows[0]);
	emit('gossip.housing', { player: { id: player.id, handle: player.handle }, zoneId: zone.id });

	const nextDueStr = rentDue ? formatGameDate(rentDue) : 'next rent cycle';
	return {
		type: "rent",
		message: `Congratulations — you are the proud new owner of <span style="color:var(--accent)">${zone.name}</span>!\n\n<span class="text-dim">Rented:</span> ${gToday ? formatGameDate(gToday) : '—'}\n<span class="text-dim">Rent (per ${RENT_PERIOD_DAYS}-day cycle):</span> <span style="color:var(--yellow)">${cost}c</span>\n<span class="text-dim">First payment due:</span> ${nextDueStr}\n\nType LOCK to secure the door when you leave. Type UNRENT to give the place up.`,
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
		`UPDATE apartments SET owner_id=NULL, owner_handle=NULL, owner_type='player', owner_org_id=NULL, is_locked=0, date_rented=NULL, rent_due_date=NULL, building_name=NULL WHERE zone_id=$1 RETURNING *`,
		[zoneId],
	);
	setApartmentCache(zoneId, updated.rows[0]);

	// Unlock the physical door so the next tenant can enter.
	for (const door of world.doors.values()) {
		if (door.zone_id === zoneId || doorFarIds(door).includes(zoneId)) {
			if (!Object.keys(door.tags || {}).some(k => k.startsWith('lock:'))) continue;
			// Door lock state is runtime-only; apt already persisted unlocked above.
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
		if (door.zone_id === zone.id || doorFarIds(door).includes(zone.id)) {
			const hasLockTag = Object.keys(door.tags || {}).some(k => k.startsWith('lock:'));
			if (!hasLockTag) continue;
			// Door lock state is runtime-only (world.doors); apt.is_locked persisted above
			// is the durable source of truth, reapplied to the door at boot.
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

	if (!(await adjustCredits(player, -UPGRADE_COST, undefined, 'apartment:lock')))
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

	// Every pick attempt trains Security — a near-miss teaches as much as a clean
	// bypass (abs margin, see awardIp).
	await awardSkillUse(player.id, "security", result.margin);

	if (result.success) {
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
		// Someone else's apartment — only sleepable if unlocked (you broke in or owner left it open).
		// An unowned unit is always unlocked, so its lock never bars sleep.
		if (apt?.owner_id && apt.is_locked) {
			return { canSleep: false, reason: "locked" };
		}
		return {
			canSleep: true,
			restore: SLEEP_RESTORE_SAFE_ZONE,
			reason: "unlocked_other",
		};
	}
	if (isSanctuary(zone)) {
		return {
			canSleep: true,
			restore: SLEEP_RESTORE_SAFE_ZONE,
			reason: "safe_zone",
		};
	}
	// Sleep explicitly permitted here (e.g. a holding cell) — rest is allowed,
	// but no forcefield/protection comes with it (that's the sanctuary path).
	if (allowsSleep(zone)) {
		return {
			canSleep: true,
			restore: SLEEP_RESTORE_SAFE_ZONE,
			reason: "allowed",
		};
	}
	return { canSleep: false, reason: "unsafe" };
}

// DOZE — the light-sleep option, and the one that makes resting a decision.
//
// Proper sleep is unconditionally safe at home and unconditionally stupid
// anywhere else: you are helpless, and you perceive nothing. Dozing recovers at
// half the rate but leaves your senses running — you still hear the room, still
// smell what comes in, and anything that would have crept up on you doesn't.
//
// So the choice is real: commit and recover fast where it's safe, or doze
// slowly with one eye open where it isn't. It reuses the whole sleep path;
// `light` is the only difference, and it's read wherever recovery is applied.
export async function cmdDoze(player, broadcastFn) {
	if (player.sleeping) {
		return { type: 'error', message: 'You are already down. (Send any other command to get up.)' };
	}
	const res = await cmdSleep(player, broadcastFn, { light: true });
	if (player.sleeping) {
		player.sleeping.light = true;
		// A dozer is NOT a sleeper for the purposes of perceiving the room. This
		// is the whole point of the verb.
		player.sleeping.perceives = true;
	}
	return res;
}

export async function cmdSleep(player, broadcastFn, opts = {}) {
	// The alarm the tablet set, if any. Loaded here so every entry point into
	// sleep honours it without having to know it exists.
	const alarmRaw = await getFlag('player', 'alarm_at', player).catch(() => null);
	const alarmAt = Number.isFinite(Number(alarmRaw)) && String(alarmRaw).trim() !== ''
		? Number(alarmRaw) % 1440 : null;
	if (player.sleeping)
		return {
			type: "error",
			message:
				"You are already asleep. (Send any other command to wake up.)",
		};

	// You cannot lie down on a live stimulant. Asked of the drug system rather
	// than decided here, so this command never grows its own pharmacology.
	if (isWired(player))
		return {
			type: "error",
			message:
				"You lie down, and your heart makes it clear that is not happening. Whatever you took is still driving.",
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
		// Where the body actually is. A dreamscape moves the player's zone, so
		// waking has to know where to put them back — and anything looking for
		// their sleeping body (a burglar, a killer) uses this, not current_zone.
		bodyZone: player.current_zone,
		// Snapped at lie-down. An alarm you set after closing your eyes isn't one.
		// Read straight from the flag the tablet writes — the engine owns the
		// clock, and reading a player flag is not a plugin dependency.
		alarmAt: opts.alarmAt ?? alarmAt,
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
		message: `${selfMsg}\n\nYou'll rest gradually while you're out — hit <strong>wake up</strong> when you've had enough.${extra}`,
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

	const staminaMax = player.stamina_max ?? 100;
	player.stamina = player.stamina ?? staminaMax;

	// A doze recovers at half rate — the price of keeping your ears open.
	const rate = player.sleeping.light ? 0.5 : 1;
	const hpGain = Math.ceil((player.hp_max - player.hp) * restore.hp * rate);
	const sanGain = Math.ceil((player.sanity_max - player.sanity) * restore.sanity * rate);
	const stamGain = Math.ceil((staminaMax - player.stamina) * (restore.stamina ?? 0) * rate);
	player.hp = Math.min(player.hp_max, player.hp + hpGain);
	player.sanity = Math.min(player.sanity_max, player.sanity + sanGain);
	player.stamina = Math.min(staminaMax, player.stamina + stamGain);
	player.hunger = Math.max(0, player.hunger - SLEEP_HUNGER_DRAIN);
	player.thirst = Math.max(0, player.thirst - SLEEP_THIRST_DRAIN);
	player.sleeping.minutesSlept++;

	// FATIGUE. Sleep is the only thing that undoes it, and it undoes it in real
	// time: last_slept_at walks forward, so clearing a heavy fatigue is a genuine
	// few minutes in a bed rather than a button. Capped at now — you cannot bank
	// sleep for later. Sleeping it off also clears any stimulant debt, which is
	// the one honest way out of a bender: you paid for the bed instead.
	const recovered = sleepRecoveryPerMinute() * (player.sleeping.light ? 0.5 : 1);
	player.last_slept_at = Math.min(Date.now(), (Number(player.last_slept_at) || Date.now()) + recovered);
	player._fatigueDebtMs = 0;

	await query(
		"UPDATE players SET hp=$1, sanity=$2, stamina=$3, hunger=$4, thirst=$5, last_slept_at=$6 WHERE id=$7",
		[player.hp, player.sanity, player.stamina, player.hunger, player.thirst, player.last_slept_at, player.id],
	);

	if (Math.random() < 0.25) {
		const noise = SLEEP_NOISES[Math.floor(Math.random() * SLEEP_NOISES.length)];
		broadcastFn(null, { type: 'output', message: `<em>${noise.self}</em>` }, null, player.id);
		broadcastFn(player.current_zone, { type: 'zone_event', message: `<em>${noise.room(player.handle)}</em>` }, player.id);
	}

	// DREAMS. Sleep is no longer optional, so it had better not be dead time.
	// Private to the sleeper — the room hears snoring, you get the dream — and
	// the content is driven by sanity and by what your body went to bed needing,
	// which makes it a second, stranger readout of your own condition.
	const dream = await rollDream(player);
	if (dream) {
		broadcastFn(null, { type: 'output', message: `<span class="text-dim"><em>${dream}</em></span>` }, null, player.id);
	}

	// THE DEEP END. Occasionally you don't dream ABOUT somewhere, you go there.
	// Rare on purpose — being pulled somewhere is a strong beat and stops being
	// one if it's nightly — and likelier the more frayed the mind, which makes
	// low sanity qualitatively different rather than merely worse.
	if (!player.sleeping.light && !player.sleeping.inDream && player.sleeping.minutesSlept >= 2) {
		const sanityPct = player.sanity_max ? (player.sanity / player.sanity_max) * 100 : 100;
		const odds = sanityPct <= 25 ? 0.22 : sanityPct <= 55 ? 0.12 : 0.06;
		if (Math.random() < odds) {
			// Null when nobody has authored any 'dream' templates — no dreamscape
			// tonight, and the ordinary sleep carries on untouched.
			const entry = await buildDreamscape(player.id, {
				size: 3 + Math.floor(Math.random() * 2),
				tether: { zone: getZone(player.sleeping.bodyZone)?.name },
				cause: 'dream',
				broadcast: broadcastFn,
				player,   // lets the rooms borrow from this sleeper's actual life
			});
			if (entry) {
			player.sleeping.inDream = true;
			// THE BODY STAYS PUT. The mind's zone moves; the sleeper does NOT leave
			// the room's occupant set, so `look` still shows them lying there and a
			// burglar or a killer can still find them in their bed — which is what
			// `bodyZone` always promised and what removing them from the set quietly
			// broke. Nothing leaks the other way: `receivesZoneMessage` rejects them
			// on BOTH counts (current_zone is the dream, and they're asleep), so the
			// dreamer hears none of the room they're lying in.
			player.current_zone = entry;
			addPlayerToZone(player.id, entry);
			broadcastFn(null, {
				type: 'output',
				message: `<span style="color:var(--cyan)">The room you were in stops being the room you are in.</span>\n<span class="text-dim">You can move. You are fairly sure you are asleep. (Look around. You will wake when you wake.)</span>`,
			}, null, player.id);
			broadcastFn(null, { type: 'sleep_state', sleeping: true, dreaming: true }, null, player.id);
			pushDreamFx(player, broadcastFn);
			broadcastFn(null, { type: 'force_look' }, null, player.id);
			}
		}
	}

	// "Rested" now means RESTED, not merely healed — otherwise a player at full
	// HP could never sleep off having been awake for nine hours.
	const fullyRested =
		player.hp >= player.hp_max &&
		player.sanity >= player.sanity_max &&
		player.stamina >= staminaMax &&
		fatigueOf(player) <= 0;
	const runningOnEmpty = player.hunger <= 5 || player.thirst <= 5;
	const tooLong = player.sleeping.minutesSlept >= SLEEP_MAX_MINUTES;

	// EXPOSURE. The body drifts toward the room's temperature while you sleep (gameLoop's
	// driftBodyTemperature runs for sleepers too), so lying down in a blizzard is no longer a
	// way to opt out of one. It shouldn't be a silent death either: cold wakes a real body long
	// before it kills it, so this fires at the top of the "cold" band (34°C) — a full four
	// degrees clear of the <30°C lethal threshold, leaving plenty of room to do something about
	// it. Same courtesy hunger and thirst already extend. Heat gets the mirror at 40°C.
	// Deliberately NOT a one-way trip: sleep again in the same spot and it will wake you again.
	const tempC = player.body_temp_c ?? 37.0;
	const frozeOut = tempC <= 34;
	const bakedOut = tempC >= 40;

	// THE ALARM. Set on the tablet before lying down; wakes you at that time
	// whether or not your body is finished, which is the entire point — it turns
	// sleep from an open-ended commitment into a nap you planned.
	//
	// It fires within a minute of the target because this tick IS once a game
	// minute; storing the target rather than a countdown means it survives a
	// restart and a relog for free.
	let alarmRang = false;
	if (player.sleeping.alarmAt != null) {
		const nowMins = gameMinutes();
		// Within the minute, allowing for the tick landing slightly past it.
		if (minutesUntil(nowMins, player.sleeping.alarmAt) >= 1439) alarmRang = true;
	}

	// BEING FINISHED IS A NOTICE, NOT AN EJECTION. Hitting full HP/sanity/stamina
	// with no fatigue left used to end the sleep on the spot, which meant the game
	// decided for you: a player bedding down to skip a night, wait out a storm, or
	// let an alarm carry them to morning got thrown out of bed the moment their
	// body topped up. So the milestone announces itself — once per sleep — and the
	// sleep continues until something that genuinely should end it does (wake up,
	// the alarm, hunger, the cap, the cold). The reward for going all the way is
	// granted HERE, the moment it's earned, rather than on the way out the door.
	if (fullyRested && !player.sleeping.restedNotified) {
		player.sleeping.restedNotified = true;
		applyEffect(player, 'rested', WELL_RESTED_TICKS);
		broadcastFn(null, {
			type: 'output',
			message: '<span style="color:var(--green)">◈ You are fully rested — healed, clear-headed, and out of fatigue.</span>\n'
				+ '<span class="text-dim">You are still asleep. <strong>wake up</strong> whenever you like.</span>',
		}, null, player.id);
	}

	if (runningOnEmpty || tooLong || alarmRang || frozeOut || bakedOut) {
		// Out of the dream and back into your own body. Shared helper because
		// there are five ways for sleep to end and every one has to do this.
		wakeFromDream(player);
		const reason = frozeOut
			? `<span style="color:var(--cyan)">You wake up shivering hard enough to hurt. You cannot feel your hands. Whatever you were sleeping in, it is not enough.</span>`
			: bakedOut
			? `<span style="color:var(--orange)">You wake up soaked in sweat, heart going like a hammer. It is far too hot to be lying here.</span>`
			: alarmRang
			? `<span style="color:var(--yellow)">⏰ Your tablet chimes. ${hhmm(player.sleeping.alarmAt)}. You get up.</span>`
			: runningOnEmpty
				? "Your stomach and throat wake you up before you starve in your sleep."
				: "You wake up, having slept as long as your body will allow in one go.";
		player.sleeping = null;
		setPosture(player, 'standing');
		await deactivateForcefield(player.id, player.home_zone, broadcastFn);
		const ROOM_WAKE = [
			(h) => `${h} stirs and sits up.`,
			(h) => `${h} blinks awake.`,
			(h) => `${h} wakes and stretches.`,
			(h) => `${h} opens their eyes and sits up slowly.`,
			(h) => `${h} comes to, rubbing their eyes.`,
		];
		const roomMsg = ROOM_WAKE[Math.floor(Math.random() * ROOM_WAKE.length)](player.handle);
		broadcastFn(player.current_zone, { type: 'zone_event', message: roomMsg }, player.id);
		return {
			type: "sleep_end",
			message: reason,
			player_update: {
				hp: player.hp,
				sanity: player.sanity,
				stamina: player.stamina,
				hunger: player.hunger,
				thirst: player.thirst,
			},
		};
	}

	const gains = [
		hpGain > 0 ? `+${hpGain} HP` : null,
		stamGain > 0 ? `+${stamGain} Stamina` : null,
		sanGain > 0 ? `+${sanGain} Sanity` : null,
	].filter(Boolean);
	return {
		type: "sleep_tick",
		message: `Still asleep.${gains.length ? ` (${gains.join(', ')})` : ''}`,
		player_update: {
			hp: player.hp,
			sanity: player.sanity,
			stamina: player.stamina,
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
	// Days-until is measured on the GAME calendar so it counts down at game speed.
	const today = gameToday();
	const due = ymd(apt.rent_due_date);
	if (!today || !due) return `\n<span class="text-dim">Rent: <span style="color:var(--yellow)">${cost}c</span> per ${RENT_PERIOD_DAYS}-day cycle.</span>`;
	const daysUntilNext = Math.max(0, gameDaysBetween(today, due));
	const urgency = daysUntilNext <= 1
		? `<span style="color:var(--red)">due tomorrow</span>`
		: daysUntilNext <= 3
			? `<span style="color:var(--yellow)">${daysUntilNext} days</span>`
			: `${daysUntilNext} days`;
	return `\n<span class="text-dim">Rent: <span style="color:var(--yellow)">${cost}c</span> due ${formatGameDate(due)} (${urgency}).</span>`;
}

export async function describeApartmentStatus(zone) {
	if (!isApartmentZone(zone)) return "";
	const resident = await getNpcResidence(zone.id);
	if (resident) {
		return `\n<span class="apartment-label">This unit is a private residence${resident.npc_name ? ` — ${resident.npc_name} lives here` : ""}.</span> Not for rent.`;
	}
	const apt = getApartment(zone.id);
	if (!apt?.owner_id) {
		return `\n<span class="apartment-label">This unit is unowned.</span> (<span class="action-link" data-raw-cmd="rent" title="Rent this unit">RENT</span> to claim it for ${authoredRentCost(zone)}c/week)`;
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
