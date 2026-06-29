import { query } from "../../models/db.js";
import {
	getZone,
	getZoneEnemies,
	getZoneNpcs,
	getZoneCorpses,
	getZonePlayers,
	getDoorForExit,
} from "../world.js";
import {
	getZoneVisibility,
	getWindowsForZone,
	getWeatherDescription,
} from "../environment.js";
import { getCustodianOutcastResponse } from "../mutations.js";
import {
	describeApartmentStatus,
	describeRentStatus,
	describeDoorForcefield,
} from "../apartments.js";
import { fireHook } from "../plugins.js";
import { isStackable } from "../tags.js";

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

function isInteriorZone(z) {
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
	for (const [direction, targetId] of Object.entries(zone.exits || {})) {
		const targetZone = getZone(targetId);
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
function destLink(direction, name, cls) {
	const dirLabel = direction.charAt(0).toUpperCase() + direction.slice(1);
	const label = name || dirLabel;
	return `<span class="dir-tag">[${dirLabel}]</span> <span class="action-link ${cls}" data-action="go" data-target="${direction}" title="Go ${direction}">${label}</span>`;
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
	const { buildings, rooms } = getConnectedDestinations(zone);
	const candidates = [...buildings, ...rooms];
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

export async function describeZone(zone, player) {
	const vis = getZoneVisibility(zone.id);
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

	const isDark = vis.category === "dark";
	const isDim = vis.category === "dim";

	const { buildings, rooms, plain } = getConnectedDestinations(zone);
	const enemies = isDark ? [] : getZoneEnemies(zone.id);
	const npcs = getZoneNpcs(zone.id);
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

	const { rows: groundItems } = isDark
		? { rows: [] }
		: await query(
				`SELECT pi.*, i.name, i.rarity, i.tags FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND pi.container_id IS NULL`,
				[`_ground_${zone.id}`],
			);

	const { rows: furniture } = await query(
		"SELECT * FROM furniture WHERE zone_id = $1",
		[zone.id],
	);
	const windows = getWindowsForZone(zone.id);

	// Header line: name and the danger tag sit together so the [SAFE]/[LETHAL]
	// chip reads as a label on the room rather than a separate line.
	let desc =
		`<span class="zone-name">${zone.name}</span>` +
		` <span class="zone-danger zone-danger-${zone.danger_rating}">[${zone.danger_rating.toUpperCase()}]</span>`;
	if (zone.radiation_level > 0)
		desc += ` <span class="rad-warning">☢ RAD:${zone.radiation_level}</span>`;
	if (zone.pvp_enabled) desc += ` <span class="pvp-warning">⚔ PVP</span>`;
	if (vis.category === "dark") {
		desc += `\n<span class="light-level light-dark">It's very dark. You can barely make out your surroundings.</span>`;
	} else if (vis.category === "dim") {
		desc += `\n<span class="light-level light-dim">The light is poor here. Details are hard to make out.</span>`;
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
	// Prose paragraph wrapped so the client can collapse/expand it independently.
	desc += `\n<span class="room-desc">${zoneDesc}${weatherLine}${describeBuildingDiscovery(buildings)}</span>`;
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
				const rarityClass = `item-rarity-${item.rarity}`;
				const label = qty > 1 ? `${qty}x ${item.name}` : item.name;
				return `<span class="action-link room-item ${rarityClass}" data-action="take" data-target="${item.name}" title="Take ${item.name}">${label}</span>`;
			});
			desc += `\n<span class="items-label">Lying here:</span> ${itemMentions.join(", ")}`;
		}
	}

	if (furniture.length) {
		const visibleFurniture = isDark
			? furniture.filter((f) => f.object_type === "light")
			: furniture;
		if (visibleFurniture.length) {
			const furnitureLinks = visibleFurniture.map((f) => {
				const stateTag =
					f.object_type === "light"
						? ` <span class="light-state ${f.light_on ? "light-on" : "light-off"}">(${f.light_on ? "on" : "off"})</span>`
						: "";
				let extra = "";
				if (f.object_type === "toilet") {
					extra = ` <span class="action-link" data-action="poop" data-target="${f.name}" title="Poop in ${f.name}">[poop]</span>`
						+ ` <span class="action-link" data-action="pee" data-target="${f.name}" title="Pee in ${f.name}">[pee]</span>`;
				}
				return `<span class="action-link furniture-link" data-action="examine" data-target="${f.name}" title="Examine ${f.name}">${f.name}</span>${stateTag}${extra}`;
			});
			desc += `\n<span class="furniture-label">Furniture:</span> ${furnitureLinks.join(", ")}`;
		}
	}
	if (!isDark) {
		const { rows: zoneGens } = await query(
			`SELECT name, status FROM generators WHERE zone_id=$1 AND generator_type='junction_box'`,
			[zone.id],
		);
		if (zoneGens.length) {
			const genLinks = zoneGens.map(
				(g) =>
					`<span class="furniture-link">${g.name || "Junction Box"}</span> <span class="text-dim">(${g.status})</span>`,
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
			return `<span class="action-link furniture-link" data-action="look" data-target="through ${w.name}" title="Look through ${w.name}">${w.name}</span>${curtainTag}${glassTag}`;
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
			const npcLinks = npcs.map(
				(n) =>
					`<span class="action-link npc-link" data-action="talk" data-target="${n.name}" title="Talk to ${n.name}">${n.name}</span>`,
			);
			desc += `\n<span class="npcs-label">NPCs here:</span> ${npcLinks.join(", ")}`;
		}
	}
	if (enemies.length) {
		const enemyLinks = enemies.map(
			(e) =>
				`<span class="action-link enemy-link" data-action="attack" data-target="${e.name}" title="Attack ${e.name}">${e.name}</span> (${e.hp}/${e.hp_max}HP)`,
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
		const exitLinks = plain.map((p) => {
			const door = getDoorForExit(zone.id, p.direction);
			if (door && !door.is_open && door.hp > 0) {
				const dirLabel =
					p.direction.charAt(0).toUpperCase() + p.direction.slice(1);
				const doorName = door.name || "Door";
				return `<span class="dir-tag">[${dirLabel}]</span> <span class="action-link door-link" data-action="open" data-target="door ${p.direction}" title="Open ${doorName}">${doorName}</span>${describeDoorForcefield(door)}`;
			}
			return destLink(p.direction, p.name, "exit-link");
		});
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
