import {
	getEnvironmentState,
	getZoneVisibility,
} from "../../server/engine/environment.js";
import {
	getZone,
	getZonePlayers,
	getZoneNpcs,
	setLivePlayer,
	getZoneFurniture,
} from "../../server/engine/world.js";

// Furniture reads come from the boot-loaded world.furniture Map (write funnel in
// world.js) — the sit/lie/lean/watch probes cost no round trips.
//
// `viewer` is optional and only ever ADDS a way to hit: a tripping player sees
// the bed as a lion and must be able to lie on the lion, because the bed is not
// a word they can see any more. The row comes back as a COPY carrying `_seenAs`
// — the world Map's rows are shared by everybody in the room and must never be
// written to (see engine/phantoms.js). Use `seenName()` for anything the viewer
// is told and the row's real `name` for anything the ROOM is told; one player's
// hallucination must never reach somebody else's log.
function furnByName(zoneId, name, viewer) {
	const needle = String(name || "").toLowerCase();
	const hit = getZoneFurniture(zoneId).find((f) => (f.name || "").toLowerCase().includes(needle));
	if (hit) return isTransformed(viewer?.id, hit.id) ? null : hit;
	const t = viewer && findTransformByName(viewer.id, name);
	if (!t) return null;
	const real = getZoneFurniture(zoneId).find((f) => f.id === t.furnitureId);
	return real ? { ...real, _seenAs: t.name } : null;
}
const seenName = (f) => f?._seenAs || f?.name;
function furnWithInteraction(zoneId, verb) {
	return getZoneFurniture(zoneId).find((f) => (f.flags?.interactions || []).includes(verb)) || null;
}
import {
	resolve as siftResolve,
	createSelectionState,
	formatSelectionPage,
} from "../../server/engine/sift.js";
import { registerAction, dispatchAction } from "../../server/engine/actions.js";
import { setPosture } from "../../server/engine/posture.js";
import { findTransformByName, isTransformed } from "../../server/engine/phantoms.js";

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function getCtx(player) {
	let env, vis;
	try {
		env = getEnvironmentState();
	} catch {
		env = {};
	}
	try {
		vis = getZoneVisibility(player.current_zone);
	} catch {
		vis = { category: "clear", visibility: 1 };
	}
	const zone = getZone(player.current_zone);
	return { env, vis, zone };
}

function posture(player) {
	return player.posture || "standing";
}

// Indoors = no open sky above. Matches the engine's isInteriorZone (describe.js)
// so weather is suppressed in exactly the same rooms.
function isInterior(zone) {
	return !!(zone?.flags?.is_interior || zone?.flags?.is_apartment || zone?.flags?.is_building);
}

// Returns a short environmental modifier string appended to descriptions. Precip
// and storms are outdoor-only — under a roof you don't sit down "amid crashing
// thunder", so they're gated on the room being exterior (light/darkness is not).
function envMod(env, vis, zone) {
	const parts = [];
	if (vis.category === "pitch_dark") parts.push("in complete darkness");
	else if (vis.category === "dark") parts.push("in the dim light");
	if (!isInterior(zone)) {
		if (env.currentPrecip === "rain") parts.push("as rain falls around you");
		else if (env.currentPrecip === "snow") parts.push("as snow drifts down");
		if (["storm", "thunderstorm"].includes(env.weatherType))
			parts.push("amid crashing thunder");
		else if (env.weatherType === "blizzard")
			parts.push("against the howling blizzard");
	}
	return parts.length ? ` — ${parts.join(", ")}` : "";
}

// Broadcast zone_event and return emote for the player.
function doEmote(selfMsg, zoneMsg, player, broadcast) {
	broadcast(
		player.current_zone,
		{ type: "zone_event", message: zoneMsg },
		player.id,
	);
	return { type: "emote", message: selfMsg };
}

// ---------------------------------------------------------------------------
// Posture commands
// ---------------------------------------------------------------------------

// The poker chairs are furniture flagged with game_table_id / seat_idx. Sitting
// on one (or "at the poker table") takes a poker seat instead of a posture.
// Returns a command result, or undefined to fall through to normal posture sit.
async function maybeSitAtPoker(target, player, broadcast) {
	const zoneFurn = getZoneFurniture(player.current_zone);
	if (!zoneFurn.some((f) => f.flags?.game_table_id != null)) return undefined; // no poker table here — ordinary sit

	if (target) {
		const name = target.replace(/^the\s+/i, "").trim().toLowerCase();
		const seat = zoneFurn.find(
			(f) => f.flags?.game_table_id != null && (f.name || "").toLowerCase().includes(name),
		);
		if (!seat) return undefined; // not a poker seat — let posture logic try
		const seatIdx = seat.flags?.seat_idx;
		return dispatchAction({
			type: "gametable.take_seat",
			actor: player,
			params: { seatIdx },
			context: { broadcast },
		});
	}

	// Bare `sit` with a poker table present — ask: floor or the table?
	const candidates = [
		{ name: "the floor", kind: "floor" },
		{ name: "the poker table", kind: "poker" },
	];
	createSelectionState(player.id, candidates, {
		dispatchType: "interactions.sit_choice",
		dispatchParam: "choice",
	});
	return {
		type: "output",
		message: formatSelectionPage({ allCandidates: candidates, visibleIndex: 0, pageSize: 5 }),
	};
}

async function cmdSit(args, raw, player, broadcast) {
	const { env, vis, zone } = getCtx(player);
	const mod = envMod(env, vis, zone);

	const target = stripPrep(args, ["on", "at", "in"]);
	const floorTarget = ["floor", "ground", "down"].includes(
		target?.toLowerCase(),
	);

	// Poker seating takes precedence over posture when a table is in the room.
	if (!floorTarget) {
		const poker = await maybeSitAtPoker(target, player, broadcast);
		if (poker !== undefined) return poker;
	}

	if (target && !floorTarget) {
		const found = furnByName(player.current_zone, target, player);
		const rows = found ? [found] : [];
		if (!rows.length)
			return { type: "emote", message: `There is no ${target} here.` };
		const interactions = rows[0].flags?.interactions || [];
		if (!interactions.includes("sit"))
			return {
				type: "emote",
				message: `You can't sit on the ${seenName(rows[0])}.`,
			};
		if (posture(player) === "sitting")
			return {
				type: "emote",
				message: `You are already sitting on the ${seenName(rows[0])}.`,
			};
		// The POSTURE records the real piece — everyone else's look must read it
		// the way the room actually is, and the illusion ends when the drug does.
		setPosture(player, "sitting", { sittingOn: rows[0].name });
		return doEmote(
			`You settle onto the ${seenName(rows[0])}${mod}.`,
			`${player.handle} settles onto the ${rows[0].name}.`,
			player,
			broadcast,
		);
	}

	if (posture(player) === "sitting")
		return { type: "emote", message: "You are already sitting." };

	// Find any sittable furniture in zone
	const sitOn = furnWithInteraction(player.current_zone, "sit");
	const chairs = sitOn ? [sitOn] : [];
	if (chairs.length) {
		setPosture(player, "sitting", { sittingOn: chairs[0].name });
		return doEmote(
			`You sit down on the ${chairs[0].name}${mod}.`,
			`${player.handle} sits down on the ${chairs[0].name}.`,
			player,
			broadcast,
		);
	}

	// Bare floor sit
	setPosture(player, "sitting");
	return doEmote(
		`You sit down on the ground${mod}.`,
		`${player.handle} sits down.`,
		player,
		broadcast,
	);
}

async function cmdLie(args, raw, player, broadcast) {
	const { env, vis, zone } = getCtx(player);
	const mod = envMod(env, vis, zone);

	const target = stripPrep(args, ["on", "down", "in"]);
	if (target) {
		const found = furnByName(player.current_zone, target, player);
		const rows = found ? [found] : [];
		if (!rows.length)
			return { type: "emote", message: `There is no ${target} here.` };
		const interactions = rows[0].flags?.interactions || [];
		if (!interactions.includes("lie"))
			return {
				type: "emote",
				message: `You can't lie on the ${seenName(rows[0])}.`,
			};
		if (posture(player) === "lying")
			return {
				type: "emote",
				message: `You are already lying on the ${seenName(rows[0])}.`,
			};
		setPosture(player, "lying", { sittingOn: rows[0].name });
		return doEmote(
			`You lie down on the ${seenName(rows[0])}${mod}.`,
			`${player.handle} lies down on the ${rows[0].name}.`,
			player,
			broadcast,
		);
	}

	if (posture(player) === "lying")
		return { type: "emote", message: "You are already lying down." };

	// Find any surface you can lie on
	const lieOn = furnWithInteraction(player.current_zone, "lie");
	const beds = lieOn ? [lieOn] : [];
	if (beds.length) {
		setPosture(player, "lying", { sittingOn: beds[0].name });
		return doEmote(
			`You lie down on the ${beds[0].name}${mod}.`,
			`${player.handle} lies down on the ${beds[0].name}.`,
			player,
			broadcast,
		);
	}

	setPosture(player, "lying");
	return doEmote(
		`You lie down on the ground${mod}.`,
		`${player.handle} lies down.`,
		player,
		broadcast,
	);
}

function cmdStand(args, raw, player, broadcast) {
	if (posture(player) === "standing")
		return { type: "emote", message: "You are already standing." };
	setPosture(player, "standing");
	return doEmote(
		"You stand up.",
		`${player.handle} stands up.`,
		player,
		broadcast,
	);
}

function cmdKneel(args, raw, player, broadcast) {
	const { env, vis, zone } = getCtx(player);
	const mod = envMod(env, vis, zone);
	if (posture(player) === "kneeling")
		return { type: "emote", message: "You are already kneeling." };
	setPosture(player, "kneeling");
	return doEmote(
		`You kneel down${mod}.`,
		`${player.handle} kneels down.`,
		player,
		broadcast,
	);
}

// ---------------------------------------------------------------------------
// Physical actions
// ---------------------------------------------------------------------------

function cmdStretch(args, raw, player, broadcast) {
	const { env, vis, zone } = getCtx(player);
	const mod = envMod(env, vis, zone);
	const postureNote =
		posture(player) !== "standing"
			? ` from your ${posture(player)} position`
			: "";
	return doEmote(
		`You stretch out${postureNote}${mod}.`,
		`${player.handle} stretches.`,
		player,
		broadcast,
	);
}

async function cmdWave(args, raw, player, broadcast) {
	const { vis } = getCtx(player);
	if (vis.category === "pitch_dark")
		return {
			type: "emote",
			message: "You wave, though no one can see it in the dark.",
		};
	const target = stripPrep(args, ["at", "to", "toward"]);
	if (target) {
		const found = await findTargetInZone(target, player);
		if (!found)
			return {
				type: "error",
				message: `You don't see anyone called "${target}" here.`,
			};
		return doEmote(
			`You wave at ${found}.`,
			`${player.handle} waves at ${found}.`,
			player,
			broadcast,
		);
	}
	return doEmote("You wave.", `${player.handle} waves.`, player, broadcast);
}

function cmdShrug(args, raw, player, broadcast) {
	return doEmote("You shrug.", `${player.handle} shrugs.`, player, broadcast);
}

async function cmdPoint(args, raw, player, broadcast) {
	const { vis } = getCtx(player);
	if (vis.category === "pitch_dark")
		return {
			type: "emote",
			message:
				"You point at nothing in particular — it's too dark to see anything.",
		};
	const target = stripPrep(args, ["at", "to", "toward"]);
	if (target) {
		const found = await findTargetInZone(target, player);
		if (found)
			return doEmote(
				`You point at ${found}.`,
				`${player.handle} points at ${found}.`,
				player,
				broadcast,
			);
		return doEmote(
			`You point toward ${target}.`,
			`${player.handle} points toward ${target}.`,
			player,
			broadcast,
		);
	}
	return doEmote("You point.", `${player.handle} points.`, player, broadcast);
}

// ---------------------------------------------------------------------------
// Expressive emotes
// ---------------------------------------------------------------------------

function cmdSmile(args, raw, player, broadcast) {
	return doEmote("You smile.", `${player.handle} smiles.`, player, broadcast);
}

function cmdFrown(args, raw, player, broadcast) {
	return doEmote("You frown.", `${player.handle} frowns.`, player, broadcast);
}

function cmdLaugh(args, raw, player, broadcast) {
	const { env } = getCtx(player);
	const loud = ["storm", "thunderstorm"].includes(env.weatherType)
		? " — barely audible over the weather"
		: "";
	return doEmote(
		`You laugh${loud}.`,
		`${player.handle} laughs.`,
		player,
		broadcast,
	);
}

function cmdCry(args, raw, player, broadcast) {
	return doEmote(
		"You cry.",
		`${player.handle} begins to cry.`,
		player,
		broadcast,
	);
}

function cmdSigh(args, raw, player, broadcast) {
	return doEmote("You sigh.", `${player.handle} sighs.`, player, broadcast);
}

async function cmdNod(args, raw, player, broadcast) {
	const target = stripPrep(args, ["at", "to"]);
	if (target) {
		const found = await findTargetInZone(target, player);
		if (found)
			return doEmote(
				`You nod at ${found}.`,
				`${player.handle} nods at ${found}.`,
				player,
				broadcast,
			);
	}
	return doEmote("You nod.", `${player.handle} nods.`, player, broadcast);
}

function cmdShake(args, raw, player, broadcast) {
	return doEmote(
		"You shake your head.",
		`${player.handle} shakes their head.`,
		player,
		broadcast,
	);
}

const DANCE_VARIANTS = [
	[
		"break into an awkward shuffling dance.",
		"breaks into an awkward shuffling dance.",
	],
	[
		"sway side to side in a slow, rhythmic motion.",
		"sways side to side in a slow, rhythmic motion.",
	],
	["spin in a half-hearted circle.", "spins in a half-hearted circle."],
];

function cmdDance(args, raw, player, broadcast) {
	const { env, vis, zone: room } = getCtx(player);
	const [self, zone] =
		DANCE_VARIANTS[Math.floor(Math.random() * DANCE_VARIANTS.length)];
	const precipNote = isInterior(room)
		? ""
		: env.currentPrecip === "rain"
			? " in the rain"
			: env.currentPrecip === "snow"
				? " in the falling snow"
				: "";
	const darkNote = vis.category === "pitch_dark" ? " in the dark" : "";
	return doEmote(
		`You ${self}${precipNote}${darkNote}`,
		`${player.handle} ${zone}${precipNote}`,
		player,
		broadcast,
	);
}

const PACE_VARIANTS = [
	["pace back and forth.", "paces back and forth."],
	["walk a slow, restless circle.", "walks a slow, restless circle."],
	["move in a tight, agitated loop.", "moves in a tight, agitated loop."],
];

function cmdPace(args, raw, player, broadcast) {
	const [self, zone] =
		PACE_VARIANTS[Math.floor(Math.random() * PACE_VARIANTS.length)];
	if (posture(player) !== "standing")
		setPosture(player, "standing");
	return doEmote(
		`You ${self}`,
		`${player.handle} ${zone}`,
		player,
		broadcast,
	);
}

// ---------------------------------------------------------------------------
// Lean
// ---------------------------------------------------------------------------

async function cmdLean(args, raw, player, broadcast) {
	const { env, vis, zone } = getCtx(player);
	const mod = envMod(env, vis, zone);
	const target = stripPrep(args, ["on", "against", "at"]);
	if (target) {
		const found = furnByName(player.current_zone, target);
		const rows = found ? [found] : [];
		if (!rows.length)
			return { type: "emote", message: `There is no ${target} here.` };
		const interactions = rows[0].flags?.interactions || [];
		if (!interactions.includes("lean"))
			return {
				type: "emote",
				message: `You can't lean on the ${rows[0].name}.`,
			};
		return doEmote(
			`You lean against the ${rows[0].name}${mod}.`,
			`${player.handle} leans against the ${rows[0].name}.`,
			player,
			broadcast,
		);
	}
	// Find any leanable surface
	const leanOn = furnWithInteraction(player.current_zone, "lean");
	const rows = leanOn ? [leanOn] : [];
	if (rows.length) {
		return doEmote(
			`You lean against the ${rows[0].name}${mod}.`,
			`${player.handle} leans against the ${rows[0].name}.`,
			player,
			broadcast,
		);
	}
	return doEmote(
		`You lean against the wall${mod}.`,
		`${player.handle} leans against the wall.`,
		player,
		broadcast,
	);
}

// ---------------------------------------------------------------------------
// Watch — passive observation of a screen/media piece (furniture flagged "watch")
// ---------------------------------------------------------------------------

async function cmdWatch(args, raw, player, broadcast) {
	const { env, vis, zone } = getCtx(player);
	const mod = envMod(env, vis, zone);
	const target = stripPrep(args, ["on", "at"]);
	if (target) {
		const found = furnByName(player.current_zone, target);
		const rows = found ? [found] : [];
		if (!rows.length)
			return { type: "emote", message: `There is no ${target} here.` };
		const interactions = rows[0].flags?.interactions || [];
		if (!interactions.includes("watch"))
			return {
				type: "emote",
				message: `You can't watch the ${rows[0].name}.`,
			};
		return doEmote(
			`You settle in and watch the ${rows[0].name}${mod}.`,
			`${player.handle} settles in to watch the ${rows[0].name}.`,
			player,
			broadcast,
		);
	}
	// Find any watchable surface in the room
	const watchable = furnWithInteraction(player.current_zone, "watch");
	const rows = watchable ? [watchable] : [];
	if (rows.length)
		return doEmote(
			`You settle in and watch the ${rows[0].name}${mod}.`,
			`${player.handle} settles in to watch the ${rows[0].name}.`,
			player,
			broadcast,
		);
	return { type: "emote", message: "There's nothing here to watch." };
}

// ---------------------------------------------------------------------------
// Social actions
// ---------------------------------------------------------------------------

async function cmdGreet(args, raw, player, broadcast) {
	const { vis } = getCtx(player);
	if (vis.category === "pitch_dark")
		return {
			type: "emote",
			message: "You call out a greeting into the darkness.",
		};
	const target = args.join(" ").trim();
	if (target) {
		const found = await findTargetInZone(target, player);
		if (!found)
			return {
				type: "error",
				message: `You don't see anyone called "${target}" here.`,
			};
		return doEmote(
			`You greet ${found} with a nod.`,
			`${player.handle} greets ${found}.`,
			player,
			broadcast,
		);
	}
	return doEmote(
		"You look around and offer a general greeting.",
		`${player.handle} offers a general greeting.`,
		player,
		broadcast,
	);
}

async function cmdFollow(args, raw, player, broadcast) {
	const target = args.join(" ").trim();
	if (!target) {
		if (!player.following)
			return { type: "output", message: "You are not following anyone." };
		setLivePlayer(player.id, { ...player, following: null });
		return { type: "output", message: "You stop following." };
	}
	const lower = target.toLowerCase();
	const foundPlayer = getZonePlayers(player.current_zone)
		.filter((p) => p.id !== player.id)
		.find((p) => p.handle.toLowerCase().includes(lower));
	const found =
		foundPlayer ||
		getZoneNpcs(player.current_zone).find((n) =>
			n.name.toLowerCase().includes(lower),
		);

	if (!found) {
		// No live entity matched — check for an offline body sleeping in bed here.
		const { rows: sleepers } = await query(
			`SELECT id, handle FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
			[`%${lower}%`, player.current_zone],
		);
		if (!sleepers.length)
			return {
				type: "error",
				message: `You don't see anyone called "${target}" here.`,
			};
		const sleeper = sleepers[0];
		setLivePlayer(player.id, { ...player, following: sleeper.id });
		return doEmote(
			`You crouch beside ${sleeper.handle}'s sleeping body, ready to tail their every move the instant they wake up. This could be a while.`,
			`${player.handle} crouches beside ${sleeper.handle}, apparently intent on following them the moment they stir.`,
			player,
			broadcast,
		);
	}

	// A live player can also be asleep in bed — still followable, same gag.
	if (foundPlayer && foundPlayer.sleeping) {
		setLivePlayer(player.id, { ...player, following: found.id });
		return doEmote(
			`You fall into step behind ${found.handle}, who is fast asleep and going nowhere. You'll be right here when they wake up.`,
			`${player.handle} takes up position behind the sleeping ${found.handle}, poised to follow.`,
			player,
			broadcast,
		);
	}

	const name = foundPlayer ? found.handle : found.name;
	setLivePlayer(player.id, { ...player, following: found.id });
	return doEmote(
		`You fall into step behind ${name}.`,
		`${player.handle} falls into step behind ${name}.`,
		player,
		broadcast,
	);
}

// ---------------------------------------------------------------------------
// Self-reflection
// ---------------------------------------------------------------------------

function cmdReflect(args, raw, player, broadcast) {
	const { env, vis, zone } = getCtx(player);
	const lines = [
		`You pause and take stock of yourself. You are ${posture(player)}.`,
	];
	if ((player.wetness || 0) > 50) lines.push("You are soaking wet.");
	else if ((player.wetness || 0) > 20) lines.push("Your clothes are damp.");
	if ((player.radiation || 0) > 70)
		lines.push("A faint sickly glow emanates from your skin.");
	else if ((player.radiation || 0) > 40)
		lines.push("You feel an uncomfortable warmth beneath your skin.");
	if ((player.hunger || 100) < 25)
		lines.push("Your stomach is growling painfully.");
	if ((player.thirst || 100) < 25) lines.push("Your mouth is parched.");
	if (vis.category === "pitch_dark")
		lines.push("You can barely see your own hands in front of your face.");
	if (env.currentPrecip === "rain")
		lines.push("Rain runs down your face and drips from your chin.");
	return { type: "emote", message: lines.join(" ") };
}

// ---------------------------------------------------------------------------
// Examine override — intercept 'surroundings', fall through for everything else
// ---------------------------------------------------------------------------

async function cmdExamine(args, raw, player, broadcast) {
	const target = args.join(" ").toLowerCase().trim();
	if (target === "surroundings" || target === "around" || target === "area") {
		return cmdExamineSurroundings(player);
	}
	return undefined; // fall through to world.js examine
}

async function cmdExamineSurroundings(player) {
	const { env, vis, zone } = getCtx(player);
	if (!zone) return { type: "emote", message: "You are nowhere." };

	const parts = [];
	if (vis.category === "pitch_dark")
		parts.push(
			"It is pitch black. You can barely make out your surroundings.",
		);
	else if (vis.category === "dark")
		parts.push("The area is poorly lit, shapes barely visible.");
	else if (vis.category === "dim")
		parts.push("The light is dim but you can make out your surroundings.");
	else parts.push("You take in the area around you.");

	// Weather is outdoor-only — under a roof you don't see rain, thunder or fog.
	if (!isInterior(zone)) {
		if (env.currentPrecip === "rain") {
			const intensity =
				env.precipRate > 0.6
					? "heavily"
					: env.precipRate > 0.3
						? "steadily"
						: "lightly";
			parts.push(`Rain falls ${intensity}.`);
		} else if (env.currentPrecip === "snow") {
			parts.push("Snow drifts down quietly.");
		}
		if (["storm", "thunderstorm"].includes(env.weatherType))
			parts.push("Thunder rumbles in the distance.");
		if (env.weatherType === "fog") parts.push("Thick fog limits visibility.");
	}

	if (env.tempC !== undefined) {
		const t = env.tempC;
		if (t < 0) parts.push("It is freezing cold.");
		else if (t < 10) parts.push("There is a biting chill in the air.");
		else if (t > 35) parts.push("The heat is oppressive.");
		else if (t > 28) parts.push("It is uncomfortably warm.");
	}

	const exits = Object.keys(zone.exits || {});
	if (exits.length) parts.push(`Exits lead: ${exits.join(", ")}.`);

	return { type: "examine", message: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function stripPrep(args, preps) {
	if (!args.length) return "";
	if (preps.includes(args[0].toLowerCase()))
		return args.slice(1).join(" ").trim();
	return args.join(" ").trim();
}

async function findTargetInZone(target, player) {
	const lower = target.toLowerCase();
	const p = getZonePlayers(player.current_zone)
		.filter((p) => p.id !== player.id)
		.find((p) => p.handle.toLowerCase().includes(lower));
	if (p) return p.handle;
	const n = getZoneNpcs(player.current_zone).find((n) =>
		n.name.toLowerCase().includes(lower),
	);
	if (n) return n.name;
	const { rows } = await query(
		`SELECT handle FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
		[`%${lower}%`, player.current_zone],
	);
	if (rows.length) return rows[0].handle;
	return null;
}

// Resolves the bare-`sit` SIFT choice: floor (posture) or the poker table.
// Plugin verbs can't use SIFT's builtin replay, so this rides the action path.
registerAction({
	type: "interactions.sit_choice",
	handler: async ({ actor, params, context }) => {
		if (params.choice?.kind === "poker") {
			return dispatchAction({ type: "gametable.take_seat", actor, params: {}, context });
		}
		const { env, vis, zone } = getCtx(actor);
		const mod = envMod(env, vis, zone);
		setPosture(actor, "sitting");
		return doEmote(
			`You lower yourself and sit on the floor${mod}.`,
			`${actor.handle} sits down on the floor.`,
			actor,
			context?.broadcast,
		);
	},
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const commands = {
	sit: cmdSit,
	stand: cmdStand,
	lie: cmdLie,
	kneel: cmdKneel,
	stretch: cmdStretch,
	wave: cmdWave,
	shrug: cmdShrug,
	point: cmdPoint,
	smile: cmdSmile,
	frown: cmdFrown,
	laugh: cmdLaugh,
	cry: cmdCry,
	sigh: cmdSigh,
	nod: cmdNod,
	shake: cmdShake,
	dance: cmdDance,
	pace: cmdPace,
	greet: cmdGreet,
	follow: cmdFollow,
	reflect: cmdReflect,
	examine: cmdExamine,
	lean: cmdLean,
	watch: cmdWatch,
};
