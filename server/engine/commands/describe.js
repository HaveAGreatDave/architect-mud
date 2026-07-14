import { query } from "../../models/db.js";
import {
	getZone,
	getZoneEnemies,
	getZoneNpcs,
	getZoneCorpses,
	getZonePlayers,
	getDoorForExit,
	isEnterableFacade,
	facadeStreetTile,
} from "../world.js";
import {
	getZoneVisibility,
	getWindowsForZone,
	getWeatherDescription,
} from "../environment.js";
import { getCustodianOutcastResponse } from "../mutations.js";
import { allExits } from "../exits.js";
import { districtFor } from "../districts.js";
import {
	describeApartmentStatus,
	describeRentStatus,
	describeDoorForcefield,
} from "../apartments.js";
import { fireHook } from "../plugins.js";
import { isStackable } from "../tags.js";
import { getZoneRadiation, isSanctuary } from "../zone-tags.js";
import { zoneDanger } from "../danger.js";
import { furnitureVerbs } from "../furnitureActions.js";
import { titleCaseName } from "../text.js";
import { getLockTagPublic, checkLockAuth } from "./doors.js";

// Emits a `data-lock` attribute the client dpad reads to colour the direction:
// "owned" (the player controls this lock), "locked" (engaged, not theirs), or
// nothing (no lock / lock disengaged). Priority: owned > locked.
async function doorLockAttr(door, player) {
	const lockTag = getLockTagPublic(door);
	if (!lockTag) return "";
	if (player && (await checkLockAuth(lockTag, door, player))) return ' data-lock="owned"';
	if (door.lock_state === "locked") return ' data-lock="locked"';
	return "";
}

const turretCooldowns = new Map();

const VOID_TELEPORT_MESSAGES = [
	`The floor, the walls, the air itself — all of it just isn't there anymore. You fall through something that isn't falling, for a length of time that isn't time. Then the world reasserts itself around you, all at once.`,
	`Wherever you just were stops existing mid-step. There's a gap — not dark, not light, just absence — and then solid ground again, like it never happened.`,
	`Reality hiccups. For a moment there's nothing under you, nothing around you, nothing anywhere at all. Then you're standing somewhere else, and your legs remember how to hold you up.`,
];
export function describeVoidTeleport() {
	const msg =
		VOID_TELEPORT_MESSAGES[
			Math.floor(Math.random() * VOID_TELEPORT_MESSAGES.length)
		];
	return `\n<span class="zone-name">— VOID —</span>\n${msg}`;
}

export function isInteriorZone(z) {
	return !!(
		z?.flags?.is_interior ||
		z?.flags?.is_apartment ||
		z?.flags?.is_building
	);
}

function getConnectedDestinations(zone) {
	const currentIsInterior = isInteriorZone(zone);
	const buildings = [],
		rooms = [],
		plain = [];
	for (const { dir: direction, target: targetId } of allExits(zone)) {
		const targetZone = getZone(targetId);
		// Leaving a building: an interior exit onto an enterable facade actually
		// spills you straight onto the street behind it in one move (see
		// resolveFacadeTransit). Show it as an exit onto that street — labeled
		// with the street's name — not as the building you're standing in. Keep
		// targetId pointing at the real adjacent facade so `go <street name>`
		// still resolves to a valid move. Falls through if no street resolves.
		if (currentIsInterior && targetZone && isEnterableFacade(targetZone)) {
			const streetId = facadeStreetTile(targetZone);
			const street = streetId ? getZone(streetId) : null;
			if (street) {
				plain.push({ direction, targetId, name: street.name });
				continue;
			}
		}
		if (targetZone?.flags?.is_building) {
			buildings.push({
				direction,
				targetId,
				name: targetZone.flags.building_name || targetZone.name,
				type: targetZone.flags.building_type || null,
			});
		} else if (
			currentIsInterior &&
			targetZone &&
			isInteriorZone(targetZone)
		) {
			rooms.push({ direction, targetId, name: targetZone.name });
		} else {
			plain.push({ direction, targetId, name: targetZone?.name || null });
		}
	}
	return { buildings, rooms, plain };
}

// Inline "[Direction] Name" link — Name is the clickable piece, click goes that way.
// `data-target` stays the raw direction (the client dpad highlight reads it); when
// the destination has a name we also emit `data-dest`, and the client clicks with
// `go <name>` so SIFT lands on that specific exit even when several share a
// direction. Unnamed exits fall back to `go <direction>`.
function destLink(direction, name, cls) {
	const dirLabel = direction.charAt(0).toUpperCase() + direction.slice(1);
	const label = name || dirLabel;
	const destAttr = name ? ` data-dest="${String(name).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : '';
	const title = name ? `Go to ${name}` : `Go ${direction}`;
	return `<span class="dir-tag">[${dirLabel}]</span> <span class="action-link ${cls}" data-action="go" data-target="${direction}"${destAttr} title="${title.replace(/"/g, '&quot;')}">${label}</span>`;
}

const DIRECTION_PHRASE = {
	north: "to the north",
	south: "to the south",
	east: "to the east",
	west: "to the west",
	up: "above",
	down: "below",
	in: "nearby",
};

const BUILDING_FLAVOR_TEMPLATES = [
	(name, dirPhrase) => `The entrance to ${name} is ${dirPhrase}.`,
	(name, dirPhrase) => `${name} stands ${dirPhrase}.`,
	(name, dirPhrase) => `You can see ${name} ${dirPhrase}.`,
	(name, dirPhrase) => `${name} is ${dirPhrase}.`,
];

const BUILDING_TYPE_FLAVOR = {
	hotel: [
		(name, dirPhrase) =>
			`A faded hotel sign marks the entrance to ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name}'s revolving door, somehow still turning, sits ${dirPhrase}.`,
		(name, dirPhrase) =>
			`You can hear faint bar chatter drifting from ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name} stands ${dirPhrase}, lobby lights flickering but on.`,
	],
	apartment: [
		(name, dirPhrase) =>
			`A weathered apartment building, ${name}, stands ${dirPhrase}.`,
		(name, dirPhrase) =>
			`Laundry lines crisscross the windows of ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name}'s entrance, propped permanently ajar, is ${dirPhrase}.`,
		(name, dirPhrase) =>
			`You spot mailboxes — most broken into — outside ${name}, ${dirPhrase}.`,
	],
	clinic: [
		(name, dirPhrase) =>
			`A faded red cross marks the entrance to ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name} is ${dirPhrase}, a line already forming outside.`,
		(name, dirPhrase) =>
			`The smell of antiseptic reaches you from ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name}'s windows are dark except for one lit room, ${dirPhrase}.`,
	],
	store: [
		(name, dirPhrase) =>
			`${name} occupies the corner ${dirPhrase}, hand-painted prices in the window.`,
		(name, dirPhrase) =>
			`A flickering OPEN sign hangs in the window of ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name} is ${dirPhrase}, shelves visible through a cracked storefront.`,
		(name, dirPhrase) =>
			`You catch the smell of something fried from ${name}, ${dirPhrase}.`,
	],
	warehouse: [
		(name, dirPhrase) => `An old warehouse, ${name}, looms ${dirPhrase}.`,
		(name, dirPhrase) => `Corrugated walls mark ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name}'s loading bay door is ${dirPhrase}, half-open.`,
		(name, dirPhrase) =>
			`${name} sits ${dirPhrase}, a rusted forklift abandoned out front.`,
	],
	powerplant: [
		(name, dirPhrase) =>
			`A low mechanical hum carries from ${name}, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`${name}'s warning placards are visible even from here, ${dirPhrase}.`,
		(name, dirPhrase) =>
			`Heat shimmer rises off ${name}, ${dirPhrase}, despite the cold.`,
		(name, dirPhrase) =>
			`${name} squats ${dirPhrase}, still running, still humming, still here.`,
	],
};

function describeBuildingDiscovery(buildings) {
	if (!buildings.length) return "";
	const sentences = buildings.map((b) => {
		const dirPhrase =
			DIRECTION_PHRASE[b.direction] || `nearby to the ${b.direction}`;
		const bank =
			(b.type && BUILDING_TYPE_FLAVOR[b.type]) ||
			BUILDING_FLAVOR_TEMPLATES;
		const template = bank[Math.floor(Math.random() * bank.length)];
		return template(b.name, dirPhrase);
	});
	return " " + sentences.join(" ");
}

export function resolveNamedDestination(zone, typedNameRaw) {
	const typed = (typedNameRaw || "").trim().toLowerCase();
	if (!typed) return { type: "none" };
	// Every named connected destination is resolvable — buildings, interior rooms,
	// and plain exits with a zone name (so clicking "[North] Meridian Ave", or a
	// specific one of several exits sharing a direction, lands there by name).
	const { buildings, rooms, plain } = getConnectedDestinations(zone);
	const candidates = [...buildings, ...rooms, ...plain.filter((p) => p.name)];
	if (!candidates.length) return { type: "none" };

	const exact = candidates.filter((c) => c.name.toLowerCase() === typed);
	if (exact.length === 1) return { type: "unique", match: exact[0] };

	const partial = candidates.filter((c) =>
		c.name
			.toLowerCase()
			.split(/\s+/)
			.some((word) => word.startsWith(typed)),
	);
	if (partial.length === 1) return { type: "unique", match: partial[0] };
	if (partial.length > 1) return { type: "ambiguous", candidates: partial };
	return { type: "none" };
}

// Who is currently occupying a named piece of furniture — seated/lying players
// (posture + sittingOn) and NPCs a plugin has parked on it (runtime onFurniture,
// e.g. a consort soaking in the jacuzzi). Rendered as a dim aside on the furniture
// line so a glance shows the jacuzzi/loungers are taken.
function furnitureOccupants(fname, zonePlayers, npcs, viewer) {
	const names = [];
	for (const p of zonePlayers) {
		if ((p.posture === "sitting" || p.posture === "lying") && p.sittingOn === fname)
			names.push(viewer && p.id === viewer.id ? "you" : p.handle);
	}
	for (const n of npcs) {
		if (n.onFurniture === fname) names.push(n.name);
	}
	return names;
}

function _vaguePresence(npc) {
	const g = npc.flags?.gender;
	const GENERIC = [
		"a figure",
		"someone",
		"a shadowy presence",
		"a shape in the darkness",
	];
	const MALE = ["a man", "a figure", "someone"];
	const FEMALE = ["a woman", "a figure", "someone"];
	const pool = g === "male" ? MALE : g === "female" ? FEMALE : GENERIC;
	return pool[Math.floor(Math.random() * pool.length)];
}

// Per-light-level render gating for describeZone (pitch_dark has its own
// feel-your-way branch below and isn't in this table; clear is the neutral
// baseline with no entry). `dim`/`dark` reuse the original two-tier semantics;
// the new levels layer extra suppression on top:
//   gloomy — poor light like dim, but ground items drop out entirely.
//   murk   — near-black like dark, and even NPCs fade from view.
// `line` is [cssClass, text] for the italic light-level feedback line.
const LIGHT_GATE = {
	blazing: { line: ["light-blazing", "Harsh light blazes over everything, sharp and unforgiving."] },
	bright:  { line: ["light-bright", "The area is brightly lit — every detail stands out."] },
	dim:     { dim: true, line: ["light-dim", "The light is poor here. Details are hard to make out."] },
	gloomy:  { dim: true, hideItems: true, line: ["light-gloomy", "Gloom hangs thick — you catch shapes and movement, but little detail."] },
	dark:    { dark: true, line: ["light-dark", "It's very dark. You can barely make out your surroundings."] },
	murk:    { dark: true, hideNpcs: true, line: ["light-murk", "It is nearly black — only the vaguest shapes register."] },
};

// Compass bearing from a zone to its district landmark, off grid deltas. grid_y
// increases southward, so north is −dy. The minor axis is dropped when it's much
// smaller than the major, so a landmark nearly due north reads "north" not
// "northeast". Returns null when the two share a cell.
function skylineBearing(dx, dy) {
	const ns = dy < 0 ? "north" : dy > 0 ? "south" : "";
	const ew = dx > 0 ? "east" : dx < 0 ? "west" : "";
	if (!ns && !ew) return null;
	if (ns && ew) {
		const ax = Math.abs(dx), ay = Math.abs(dy);
		if (ax > ay * 2) return ew;
		if (ay > ax * 2) return ns;
		return ns + ew; // northeast / southwest / …
	}
	return ns || ew;
}

export async function describeZone(zone, player) {
	const vis = getZoneVisibility(zone.id);
	// Per-player perception seam: a carried light source (e.g. a lit flashlight)
	// can raise how bright THIS player sees the room, applied before any darkness
	// gating below. A plugin returns an adjusted visibility object, or undefined
	// to leave the zone visibility as-is.
	const perceived = await fireHook("visibility.perceive", player, vis, zone);
	if (perceived) {
		vis.category = perceived.category;
		vis.visibility = perceived.visibility;
	}
	if (vis.category === "pitch_dark") {
		const windows = getWindowsForZone(zone.id);
		const windowHint = windows.length
			? ` You can barely make out the outline of ${windows.length === 1 ? "a window" : "some windows"} — ${windows.some((w) => w.curtain_open) ? "no light comes through" : "the curtains are drawn"}.`
			: "";
		const { buildings, rooms, plain } = getConnectedDestinations(zone);
		let darkDesc =
			`<span class="zone-name">${zone.name}</span>\n` +
			`<span class="light-level light-dark">It is completely dark here. You can't make out your surroundings.${windowHint}</span>`;
		if (plain.length) {
			// In pitch dark you can feel for openings but can't read where they lead.
			const exitLinks = plain.map((p) => {
				const door = getDoorForExit(zone.id, p.direction);
				if (door && !door.is_open && door.hp > 0) {
					const dirLabel =
						p.direction.charAt(0).toUpperCase() +
						p.direction.slice(1);
					const doorName = door.name || "Door";
					return `<span class="dir-tag">[${dirLabel}]</span> <span class="action-link door-link" data-action="open" data-target="door ${p.direction}" title="Open ${doorName}">${doorName}</span>`;
				}
				return destLink(p.direction, null, "exit-link");
			});
			darkDesc += `\n\n<span class="exits-label">Exits:</span> ${exitLinks.join(", ")}`;
		}
		if (buildings.length) {
			const links = buildings.map((b) =>
				destLink(b.direction, b.name, "building-link"),
			);
			darkDesc += `\n<span class="buildings-label">Buildings:</span> ${links.join(", ")}`;
		}
		if (rooms.length) {
			const links = rooms.map((r) =>
				destLink(r.direction, r.name, "room-nav-link"),
			);
			darkDesc += `\n<span class="rooms-label">Rooms:</span> ${links.join(", ")}`;
		}
		return darkDesc;
	}

	const gate = LIGHT_GATE[vis.category] || {};
	const isDark = !!gate.dark;
	const isDim = !!gate.dim;
	const hideItems = isDark || !!gate.hideItems;

	const { buildings, rooms, plain } = getConnectedDestinations(zone);
	const enemies = isDark ? [] : getZoneEnemies(zone.id);
	const npcs = gate.hideNpcs ? [] : getZoneNpcs(zone.id);
	const corpses = isDark ? [] : getZoneCorpses(zone.id);
	const others = isDark
		? []
		: getZonePlayers(zone.id).filter((p) => p.id !== player.id);

	const { rows: sleepingBodies } = isDark
		? { rows: [] }
		: await query(
				`SELECT handle FROM players WHERE offline_sleeping=TRUE AND current_zone=$1`,
				[zone.id],
			);

	const { rows: groundItems } = hideItems
		? { rows: [] }
		: await query(
				`SELECT pi.*, i.name, i.tags FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND pi.container_id IS NULL`,
				[`_ground_${zone.id}`],
			);

	const { rows: furniture } = await query(
		"SELECT * FROM furniture WHERE zone_id = $1",
		[zone.id],
	);
	const windows = getWindowsForZone(zone.id);
	// PD street cams: woven into the room prose as a dim aside rather than listed
	// as objects. Dark hides them (not a light source); concealed ones stay hidden.
	const cameras = isDark
		? []
		: furniture.filter(
				(f) => f.object_type === "security_device" && !f.flags?.concealed,
			);
	const cameraAside = !cameras.length
		? ""
		: ` <span class="text-dim">${cameras.length === 1 ? "A " : ""}<span class="action-link furniture-link" data-action="examine" data-target="cam" title="Examine camera">${cameras.length === 1 ? "camera" : "Cameras"}</span> ${cameras.length === 1 ? "watches" : "watch"}, unblinking.</span>`;

	// Header line: name and the danger tag sit together so the [SAFE]/[LETHAL]
	// chip reads as a label on the room rather than a separate line.
	const dangerNow = zoneDanger(zone);
	let desc =
		`<span class="zone-name">${zone.name}</span>` +
		` <span class="zone-danger zone-danger-${dangerNow}">[${dangerNow.toUpperCase()}]</span>`;
	const zoneRad = getZoneRadiation(zone);
	if (zoneRad > 0)
		desc += ` <span class="rad-warning">☢ RAD:${zoneRad}</span>`;
	// PvP is the default law everywhere — sanctuary is the exception worth a chip.
	// (The old ⚔ PVP chip read a display-only column no law ever enforced.)
	if (isSanctuary(zone)) desc += ` <span class="safe-warning">⛨ SANCTUARY</span>`;
	// District tag: roots which neighborhood this room belongs to, coloured to
	// match the map's land-use key. Cheap, constant, always shown.
	const district = districtFor(zone);
	desc += `\n<span class="zone-district" style="color:${district.color}">· ${district.name} ·</span>`;
	if (gate.line) {
		desc += `\n<span class="light-level ${gate.line[0]}">${gate.line[1]}</span>`;
	}
	const roomDesc = await fireHook("zone.describeRoom", zone);
	if (roomDesc) desc += `\n${roomDesc}`;
	// Truncate description based on light level — less light, fewer details.
	const sentences = zone.description.match(/[^.!?]+[.!?]+(\s|$)/g) || [
		zone.description,
	];
	const zoneDesc = isDark
		? sentences[0].trim()
		: isDim
			? sentences.slice(0, 2).join(" ").trim()
			: zone.description;
	let weatherLine = "";
	if (!isInteriorZone(zone) && vis.category !== "pitch_dark") {
		const wd = getWeatherDescription();
		if (wd) weatherLine = ` ${wd}`;
	}
	// Skyline landmark: a fixed compass for the district. Outdoor + lit only (you
	// can't sight a landmark indoors or in the dark), and not when you're standing
	// in the landmark zone itself. Bearing is read off the grid coords.
	let skylineLine = "";
	if (!isInteriorZone(zone) && !isDark && district.landmark && district.skyline && zone.id !== district.landmark) {
		const lm = getZone(district.landmark);
		if (
			lm && lm.map_id === zone.map_id &&
			lm.grid_x != null && zone.grid_x != null &&
			(lm.grid_z ?? 0) === (zone.grid_z ?? 0)
		) {
			const dir = skylineBearing(lm.grid_x - zone.grid_x, lm.grid_y - zone.grid_y);
			if (dir) skylineLine = ` <span class="text-dim">To the ${dir}, ${district.skyline}.</span>`;
		}
	}
	// Prose paragraph wrapped so the client can collapse/expand it independently.
	desc += `\n<span class="room-desc">${zoneDesc}${weatherLine}${skylineLine}${describeBuildingDiscovery(buildings)}${cameraAside}</span>`;
	// First-visit tone-setting lore (per-player, new-account-only) — a plugin
	// decides whether this player has earned an introduction to this zone and
	// returns the shimmering block, or nothing. Player is passed so eligibility
	// and "already seen" can be resolved per account.
	if (!isDark) {
		const introLore = await fireHook("zone.introLore", zone, player);
		if (introLore) desc += `\n${introLore}`;
	}
	desc += await describeApartmentStatus(zone);
	desc += describeRentStatus(zone, player);

	const outcastResponse = getCustodianOutcastResponse(zone, player);
	if (outcastResponse) {
		desc += outcastResponse.message;
		if (outcastResponse.hostile) {
			const lastHit = turretCooldowns.get(player.id) || 0;
			if (Date.now() - lastHit > 8000) {
				turretCooldowns.set(player.id, Date.now());
				const dmg = Math.floor(Math.random() * 8) + 6;
				player.hp = Math.max(1, player.hp - dmg);
				await query("UPDATE players SET hp=$1 WHERE id=$2", [
					player.hp,
					player.id,
				]);
				desc += `\n<span class="death-message">The turret fires. -${dmg} HP. (${player.hp}/${player.hp_max})</span>`;
			}
		}
	}

	const zoneStains = zone.stains || {};
	const stainEntries = Object.entries(zoneStains).filter(
		([, count]) => count > 0,
	);
	if (stainEntries.length && !isDark) {
		const ZONE_STAIN_DESCS = {
			urine: (n) =>
				n > 1
					? `The floor is wet in several places. The smell confirms it.`
					: `There's a wet patch on the floor. The smell tells the story.`,
			feces: (n) =>
				n > 1
					? `The floor is fouled in multiple spots. The smell is significant.`
					: `Something has been deposited on the floor here. The smell is notable.`,
			blood: (n) =>
				n > 1
					? `Dark stains are smeared across the floor in several places.`
					: `There's a dark stain on the floor.`,
			ejaculate: (n) =>
				n > 1
					? `There are dried white stains on the floor. Several of them.`
					: `There's a dried white stain on the floor.`,
		};
		for (const [type, count] of stainEntries) {
			const fn = ZONE_STAIN_DESCS[type];
			if (fn)
				desc += `\n<span style="color:var(--yellow)">${fn(count)}</span>`;
		}
	}

	if (groundItems.length) {
		if (isDim) {
			desc += `<br>Something is lying on the ground nearby.</br>`;
		} else {
			// Group stackable items of the same type into a single "Nx name" mention;
			// non-stackable items are listed individually.
			const stacks = new Map();
			const mentions = [];
			for (const item of groundItems) {
				if (isStackable(item)) {
					const existing = stacks.get(item.item_id);
					if (existing) {
						existing.qty += item.quantity;
						continue;
					}
					const entry = { item, qty: item.quantity };
					stacks.set(item.item_id, entry);
					mentions.push(entry);
				} else {
					mentions.push({ item, qty: 1 });
				}
			}
			const itemMentions = mentions.map(({ item, qty }) => {
				const disp = titleCaseName(item.name);
				const label = qty > 1 ? `${qty}x ${disp}` : disp;
				return `<span class="action-link room-item" data-action="take" data-target="${item.name}" title="Take ${disp}">${label}</span>`;
			});
			desc += `\n<span class="items-label">Lying here:</span> ${itemMentions.join(", ")}`;
		}
	}

	if (furniture.length) {
		// Plugins may claim some furniture (e.g. the poker table's chairs) and
		// render their own panel for it. Suppressed ids drop out of the plain list.
		const panel = isDark
			? null
			: await fireHook("zone.furniturePanel", zone, furniture, player);
		const suppress = new Set(panel?.suppressIds || []);
		const visibleFurniture = (isDark
			? furniture.filter((f) => f.object_type === "light")
			: furniture
		).filter((f) => !suppress.has(f.id) && !f.flags?.concealed);
		// Surveillance devices (PD street cams) are excluded from the plain Furniture
		// list — they're woven into the room description as a dim aside instead.
		const plainFurniture = visibleFurniture.filter((f) => f.object_type !== "security_device");
		if (plainFurniture.length) {
			const seatedHere = getZonePlayers(zone.id);
			const furnitureLinks = plainFurniture.map((f) => {
				const stateTag =
					f.object_type === "light"
						? ` <span class="light-state ${f.light_on ? "light-on" : "light-off"}">(${f.light_on ? "on" : "off"})</span>`
						: "";
				const occ = furnitureOccupants(f.name, seatedHere, npcs, player);
				const occTag = occ.length
					? ` <span class="text-dim">(${occ.join(", ")})</span>`
					: "";
				// Ship each piece's full affordance set so the mobile smart bar can
				// surface exactly the verbs it supports (sit/switch/watch/…).
				const verbs = furnitureVerbs(f);
				const actionsAttr = verbs.length ? ` data-actions="${verbs.join(" ")}"` : "";
				return `<span class="action-link furniture-link" data-action="examine" data-target="${f.name}"${actionsAttr} title="Examine ${f.name}">${titleCaseName(f.name)}</span>${stateTag}${occTag}`;
			});
			desc += `\n<span class="furniture-label">Furniture:</span> ${furnitureLinks.join(", ")}`;
		}
		if (panel?.html) desc += `\n${panel.html}`;
	}
	if (!isDark) {
		const { rows: zoneGens } = await query(
			`SELECT name, status FROM generators WHERE zone_id=$1 AND generator_type='junction_box'`,
			[zone.id],
		);
		if (zoneGens.length) {
			const genLinks = zoneGens.map(
				(g) =>
					`<span class="furniture-link">${titleCaseName(g.name) || "Junction Box"}</span> <span class="text-dim">(${g.status})</span>`,
			);
			desc += `\n<span class="furniture-label">Installed:</span> ${genLinks.join(", ")}`;
		}
	}
	if (windows.length) {
		const windowLinks = windows.map((w) => {
			const curtainTag = w.curtain_open
				? ""
				: ' <span style="color:var(--text-dim)">(curtained)</span>';
			const glassTag =
				w.glass_state === "broken"
					? ' <span style="color:var(--red)">(broken)</span>'
					: "";
			return `<span class="action-link furniture-link" data-action="look" data-target="through ${w.name}" title="Look through ${w.name}">${titleCaseName(w.name)}</span>${curtainTag}${glassTag}`;
		});
		desc += `\n<span class="furniture-label">Windows:</span> ${windowLinks.join(", ")}`;
	}

	if (others.length) {
		const playerLinks = others.map(
			(p) =>
				`<span class="action-link player-link" data-action="examine" data-target="${p.handle}" title="Look at ${p.handle}">${p.handle}</span>`,
		);
		desc += `\n<span class="players-label">Also here:</span> ${playerLinks.join(", ")}`;
	}
	if (sleepingBodies.length) {
		const bodyLinks = sleepingBodies.map(
			(p) =>
				`<span class="action-link player-link" data-action="examine" data-target="${p.handle}" title="Look at ${p.handle}">${p.handle} <span class="text-dim">(sleeping)</span></span>`,
		);
		desc += `\n<span class="players-label">Sleeping here:</span> ${bodyLinks.join(", ")}`;
	}
	if (npcs.length) {
		if (isDark) {
			const figures = npcs.map((n) => _vaguePresence(n));
			desc += `\n<span class="npcs-label">Nearby:</span> <span style="color:var(--text-dim);font-style:italic">${figures.join(", ")}</span>`;
		} else {
			const npcLink = (n) => {
				const postureTag = n._ai?.homeSleeping
					? ` <span class="text-dim">(sleeping)</span>`
					: n.posture === 'lying'
						? ` <span class="text-dim">(lying down)</span>`
						: '';
				return `<span class="action-link npc-link" data-action="talk" data-target="${n.name}" title="Talk to ${n.name}">${n.name}</span>${postureTag}`;
			};
			// Vendors get their own section — but covert/trust-gated dealers stay
			// camouflaged among the regular NPCs so their storefront isn't outed.
			const isVendor = (n) =>
				!n.flags?.trust_flag &&
				((Array.isArray(n.vendor_inventory) && n.vendor_inventory.length > 0) ||
					n.flags?.personality === 'vendor');
			const vendors = npcs.filter(isVendor);
			const regular = npcs.filter((n) => !isVendor(n));
			if (vendors.length) {
				desc += `\n<span class="vendors-label">Vendors here:</span> ${vendors.map(npcLink).join(", ")}`;
			}
			if (regular.length) {
				desc += `\n<span class="npcs-label">NPCs here:</span> ${regular.map(npcLink).join(", ")}`;
			}
		}
	}
	if (enemies.length) {
		const enemyLinks = enemies.map(
			(e) =>
				`<span class="action-link enemy-link" data-action="attack" data-target="${e.name}" data-instance-id="${e.instanceId}" title="Attack ${e.name}">${e.name}</span> (${e.hp}/${e.hp_max}HP)`,
		);
		desc += `\n<span class="enemies-label">Hostiles:</span> ${enemyLinks.join(", ")}`;
	}
	if (corpses.length) {
		const corpseLinks = corpses.map(
			(c) =>
				`<span class="action-link corpse-link" data-action="loot" data-target="${c.id}" data-label="${c.name}" title="Loot ${c.name}">${c.name}</span>`,
		);
		desc += `\n<span class="corpses-label">Corpses:</span> ${corpseLinks.join(", ")}`;
	}
	if (plain.length) {
		const exitLinks = await Promise.all(plain.map(async (p) => {
			const door = getDoorForExit(zone.id, p.direction);
			if (door && !door.is_open && door.hp > 0) {
				const dirLabel =
					p.direction.charAt(0).toUpperCase() + p.direction.slice(1);
				const doorName = door.name || "Door";
				const lockAttr = await doorLockAttr(door, player);
				return `<span class="dir-tag">[${dirLabel}]</span> <span class="action-link door-link" data-action="open" data-target="door ${p.direction}"${lockAttr} title="Open ${doorName}">${doorName}</span>${describeDoorForcefield(door)}`;
			}
			return destLink(p.direction, p.name, "exit-link");
		}));
		desc += `\n<span class="exits-label">Exits:</span> ${exitLinks.join(", ")}`;
	}
	if (buildings.length) {
		const links = buildings.map((b) =>
			destLink(b.direction, b.name, "building-link"),
		);
		desc += `\n<span class="buildings-label">Buildings:</span> ${links.join(", ")}`;
	}
	if (rooms.length) {
		const links = rooms.map((r) =>
			destLink(r.direction, r.name, "room-nav-link"),
		);
		desc += `\n<span class="rooms-label">Rooms:</span> ${links.join(", ")}`;
	}
	return desc;
}
