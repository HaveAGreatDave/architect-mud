import { query } from "../../models/db.js";
import {
	getZone,
	getZoneEnemies,
	getZoneNpcs,
	getZoneCorpses,
	getZonePlayers,
	doorOnLink as linkDoor,
	frontDoorOf,
	isEnterableFacade,
	facadeStreetTile,
	getZoneFurniture,
} from "../world.js";
import { OPPOSITE } from "../directions.js";
import {
	getZoneVisibility,
	getWindowsForZone,
	getWeatherDescription,
	shiftVisibility,
} from "../environment.js";
import { acuitySync } from "../senses.js";
import { isHiddenFrom } from "../stealth.js";
import { getCustodianOutcastResponse } from "../mutations.js";
import { allExits } from "../exits.js";
import { districtFor } from "../districts.js";
import {
	describeApartmentStatus,
	describeRentStatus,
	describeDoorForcefield,
} from "../apartments.js";
import { fireHook, gatherHook } from "../plugins.js";
import { isStackable } from "../tags.js";
import { getZoneRadiation, isSanctuary } from "../zone-tags.js";
import { zoneDanger } from "../danger.js";
import { furnitureVerbs } from "../furnitureActions.js";
import { titleCaseName, escAttr } from "../text.js";
import { getLockTagPublic, checkLockAuth } from "./doors.js";
import { getItem } from "../items-cache.js";
import { getPhantomsInZone, applyTransforms, applyNpcTransforms, getRoomTransform, getRoomTransformName, getWeatherWarp } from "../phantoms.js";
import { bodyTell } from "../dreamscape.js";

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

// The door on a link, resolved the way MOVEMENT resolves it — near side, far side, or
// (when the link leads to a building) the front door on the facade↔interior seam one
// hop further in. Room descriptions used to check only the near side, so 58 closed
// doors — 34 of them locked — read as ordinary open exits in `look` and then stopped
// you on the step. A hallway of locked apartment doors described itself as four empty
// doorways. If it blocks the move it belongs in the description.
function doorOnLink(fromId, direction, targetId) {
	// The link itself resolves in world.js (one implementation, §6.3). The extra
	// hop is a DESCRIPTION rule and stays here: a building's front door sits on the
	// facade↔interior seam, one step further in than the link you're looking along,
	// and you can see it from the street.
	return (
		linkDoor(fromId, direction, targetId) ||
		(targetId ? frontDoorOf(getZone(targetId)) : null)
	);
}

// A shut door on a link whose destination is worth naming — a building, or a room in
// the building you're standing in. Unlike the plain-exit case (which replaces the
// destination with the door, because you can't read past a door you haven't opened),
// the name stays: you can see which building it is from the street, you just can't
// walk in. The suffix is the clickable part that opens it.
async function doorSuffix(fromId, direction, targetId, player) {
	const door = doorOnLink(fromId, direction, targetId);
	if (!door || door.is_open || door.hp <= 0) return "";
	const lockAttr = await doorLockAttr(door, player);
	const doorName = door.name || "Door";
	const state = door.lock_state === "locked" ? "locked" : "closed";
	return ` <span class="action-link door-link" data-action="open" data-target="door ${direction}"${lockAttr} title="Open ${doorName}">(${state})</span>${describeDoorForcefield(door)}`;
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
	// A zone can hide its exits from the room description entirely (flags.hide_exits):
	// the graph still connects — movement, NPC pathfinding, and the minimap read the
	// real exits directly — only this player-facing list (and name-based `go <exit>`
	// nav, which reuses it) is suppressed. The elevator car opts in, since its floor
	// panel IS the exit UI.
	if (zone?.flags?.hide_exits) return { buildings, rooms, plain };
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
		// Already inside a structure and stepping to another interior zone of it
		// (e.g. moving between rooms of the Echelon, whose cells are each flagged
		// is_building with the same building_name): show the room's own name, not
		// the shared building name. Must win over the is_building branch below.
		if (currentIsInterior && targetZone && isInteriorZone(targetZone)) {
			rooms.push({ direction, targetId, name: targetZone.name });
		} else if (targetZone?.flags?.is_building) {
			buildings.push({
				direction,
				targetId,
				name: targetZone.flags.building_name || targetZone.name,
				type: targetZone.flags.building_type || null,
			});
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

const COUNT_WORDS = ["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function countWord(n) {
	return COUNT_WORDS[n] || String(n);
}
// First full sentence of a description — the standalone "placement" line woven
// into the room; the rest of the text stays for `examine`. Reuses the sentence
// regex idiom the light-truncation code below uses.
function firstSentence(text) {
	const t = String(text || "").trim();
	return (t.match(/[^.!?]+[.!?]+(\s|$)/)?.[0] || t).trim();
}
function pluralName(name) {
	if (/s$/i.test(name)) return name;
	// "lockbox" -> "lockboxes", not "lockboxs"; "gantry" -> "gantries".
	if (/(x|z|ch|sh)$/i.test(name)) return `${name}es`;
	if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
	return `${name}s`;
}

// Grouping of last resort. Exact-name grouping almost never fires on authored
// content — nobody places four rows called "bar stool", they write Dolan's
// lockbox, Keel's lockbox, Ma Cinder's lockbox — so a room can still print eight
// near-identical nouns. When enough pieces of one object_type share a head noun,
// they collapse to "eight Lockboxes". The floor is deliberately high: three slot
// machines with real names stay listed, because at three you can still read them.
const KIND_GROUP_MIN = 4;
function headNoun(name) {
	const w =
		String(name || "")
			.toLowerCase()
			.replace(/[^a-z0-9\s']/g, " ")
			.trim()
			.split(/\s+/)
			.pop() || "";
	return w.replace(/'s$/, "").replace(/s$/, "");
}
// Second pass over already-name-grouped entries. Order is preserved: a collapsed
// kind takes the slot of its first member, so the object_type clustering the
// caller sorted by still holds.
function collapseByKind(entries) {
	const buckets = new Map();
	const kindOf = (e) => `${e.f.object_type || "furniture"}|${headNoun(e.f.name)}`;
	for (const e of entries) {
		const k = kindOf(e);
		if (!buckets.has(k)) buckets.set(k, []);
		buckets.get(k).push(e);
	}
	const done = new Set();
	const out = [];
	for (const e of entries) {
		const k = kindOf(e);
		const bucket = buckets.get(k);
		const total = bucket.reduce((a, x) => a + x.qty, 0);
		// Needs both several distinct names AND enough total pieces to be worth
		// hiding — a single row that happens to be named plurally is not a crowd.
		if (bucket.length < 2 || total < KIND_GROUP_MIN) {
			out.push(e);
			continue;
		}
		if (done.has(k)) continue;
		done.add(k);
		out.push({ f: bucket[0].f, qty: total, kind: headNoun(bucket[0].f.name) });
	}
	return out;
}

// Cluster order for the plain Furniture list. Things you sit on and things you
// use lead; scenery and lights (which carry their own (on)/(off) tag and so read
// as a group anyway) trail. The type is never shown to the player — this is only
// a sort key, so an unknown object_type falls through to the tail rank.
const FURNITURE_SORT_ORDER = [
	"furniture",
	"container",
	"appliance",
	"terminal",
	"fixture",
	"sink",
	"shower",
	"toilet",
	"decoration",
	"light",
];
function furnitureSortRank(f) {
	const i = FURNITURE_SORT_ORDER.indexOf(f.object_type || "furniture");
	return i === -1 ? FURNITURE_SORT_ORDER.length : i;
}

// PRESENTATION TIERS. A densely furnished room used to print every piece as one
// more comma-separated noun, so a bar with eighteen rows read as an inventory
// manifest rather than a place. Three tiers instead:
//
//   LIVE     — prose sentences in the room body: something is happening here
//              (flags.woven, or a seat with somebody in it)
//   STANDING — the `Furniture:` line, grouped and counted: things you would use
//   SCENERY  — one closing clause on the room paragraph: merely present
//
// The tier is DERIVED, per viewer, from what a piece affords, so it can never
// take an affordance away — demotion is presentation only, and a scenery piece
// is still a full examine/SIFT target with its verbs on the smart bar. Because
// `furnitureVerbs` is viewer-aware (see visibleFor in specializedActions.js), a
// piece can legitimately be STANDING for the room's owner and SCENERY for a
// guest. `flags.notable` / `flags.mundane` are the author overrides for the
// cases the derivation gets wrong; unflagged content needs no authoring pass.

// Types that hold things, and so are never scenery even when they afford no
// verbs: `open`/`close` are STRUCTURAL in furnitureActions.js and never come
// back from `furnitureVerbs`, so without this floor an empty-verbed lootable
// chest would silently demote into the scenery clause and get skimmed past.
const HOLDS_THINGS = new Set([
	"container",
	"terminal",
	"appliance",
	"sink",
	"shower",
	"toilet",
]);

function isSceneryPiece(f, viewer) {
	if (f.flags?.mundane) return true;
	if (f.flags?.notable) return false;
	// Lights ALWAYS go to prose, whether or not they afford a verb — otherwise
	// half the fixtures in the world sit in the list and half in the sentence
	// depending on an invisible switchability detail. They don't lose their
	// state doing it: the scenery renderer gives lights their own clause and
	// says lit/dark in words, which is what the (on)/(off) tag was for. In the
	// DARK the caller suppresses scenery entirely, so lights stay in the list
	// where they're the only thing you can see and the only thing you want.
	if (f.object_type === "light") return true;
	if (furnitureVerbs(f, viewer).length) return false;
	if (f.flags?.container || HOLDS_THINGS.has(f.object_type)) return false;
	// An author who wrote more than one sentence about a thing was making a
	// point about it. Free proxy for flags.notable, which is what lets this ship
	// without anyone flagging a single existing row.
	const d = String(f.description || "").trim();
	return d === firstSentence(d);
}

// Identical pieces collapse into one counted entry. The key carries everything
// a render can SHOW — name, kind, and light state — so a lit lamp never merges
// with an unlit one and the (on)/(off) tag can't lie. Anything in `soloIds`
// refuses to group at all, which is how an occupied seat keeps its own line.
// Map iteration is insertion-ordered, so a pre-sorted input stays sorted.
function groupPieces(pieces, soloIds) {
	const groups = new Map();
	for (const f of pieces) {
		const key = soloIds?.has(f.id)
			? `#${f.id}`
			: `${(f.name || "").toLowerCase()}|${f.object_type || "furniture"}|${f.light_on ? 1 : 0}`;
		const g = groups.get(key);
		if (g) g.qty++;
		else groups.set(key, { f, qty: 1 });
	}
	return [...groups.values()];
}

// Clicking a light FLIPS it instead of examining it. A light is the one piece of
// furniture whose state the room pane already prints — "the ceiling strips are
// dark" — so the click a player is actually reaching for is the switch, and
// examine stays a keystroke or a smart-bar tap away. The direction is baked into
// the target rather than sent as a toggle, so a click can never disagree with the
// state the pane was showing when it was clicked. A streetlight is city-grid
// controlled and refuses the verb (commands/world.js), so it never gets the
// affordance here either — it would be a link that only ever says no.
function lightClick(f, viewer) {
	if (f.object_type !== "light" || f.light_type === "streetlight") return null;
	if (!furnitureVerbs(f, viewer).includes("switch")) return null;
	const dir = f.light_on ? "off" : "on";
	return {
		action: "switch",
		target: `${dir} ${f.name}`,
		title: `Turn ${dir} ${f.name}`,
	};
}

// `data-piece` is the piece's BARE name, emitted whenever the click target isn't
// it (a light's target is "off desk lamp"). The smart bar builds every other verb
// for a piece by pasting it onto data-target, and would otherwise offer you
// `examine off desk lamp`.
function pieceAttr(f, click) {
	return click.action === "examine" ? "" : ` data-piece="${escAttr(f.name)}"`;
}

// The clickable wrapper every tier shares: examine on click (or the switch, for a
// light), the full affordance set in data-actions so the mobile smart bar can
// offer sit/switch/watch.
function furnitureSpan(f, viewer, body, cls) {
	const verbs = furnitureVerbs(f, viewer);
	const actionsAttr = verbs.length ? ` data-actions="${verbs.join(" ")}"` : "";
	const click = lightClick(f, viewer) || {
		action: "examine",
		target: f.name,
		title: `Examine ${f.name}`,
	};
	return `<span class="action-link ${cls}" data-action="${click.action}" data-target="${escAttr(click.target)}"${pieceAttr(f, click)}${actionsAttr} title="${escAttr(click.title)}">${body}</span>`;
}

// The sub-link an attached piece renders as, hanging off its parent's entry. Its
// click is the thing you'd actually want from it — `use` opens a media deck's own
// panel — falling back to examine for a satellite that affords nothing.
function attachedSpan(f, viewer) {
	const verbs = furnitureVerbs(f, viewer);
	const actionsAttr = verbs.length ? ` data-actions="${verbs.join(" ")}"` : "";
	const action = verbs.includes("use") ? "use" : "examine";
	const verb = action === "use" ? "Use" : "Examine";
	const name = String(f.name || "").replace(/^(?:a|an|the)\s+/i, "");
	return ` <span class="furniture-attach">↳</span> <span class="action-link furniture-link furniture-attached" data-ftype="${escAttr(f.object_type || "furniture")}" data-action="${action}" data-target="${escAttr(f.name)}"${actionsAttr} title="${verb} ${escAttr(f.name)}">${titleCaseName(name)}</span>`;
}

// Furniture flagged `flags.woven` is folded into the room prose (the PD-camera
// pattern generalized) instead of the plain Furniture list: its description's
// first sentence, kept clickable so examine/sit/etc. still work and the smart
// bar reads its verbs. Identical pieces collapse into one counted sentence so
// four chairs don't spawn four lines.
function weaveFurniture(pieces, viewer) {
	if (!pieces.length) return "";
	return groupPieces(pieces)
		.map(({ f, qty }) =>
			furnitureSpan(
				f,
				viewer,
				qty === 1
					? firstSentence(f.description)
					: `${countWord(qty)} ${pluralName(f.name)} are here.`,
				"furniture-link furniture-woven",
			),
		)
		.join(" ");
}

// Seats with somebody in them get a sentence rather than a list entry. Who is
// sitting where is the liveliest thing a furnished room can tell you, and it
// reads as noise when it's a parenthetical buried in a comma list of eighteen
// nouns. The free pieces of the same kind still count off in the list, so a bar
// says "The booth is taken (Ryn, Marla)" above "one Booth".
function weaveOccupied(entries, viewer) {
	if (!entries.length) return "";
	return entries
		.map(({ f, occ }) => {
			const raw = (f.name || "").toLowerCase();
			// Names are authored freely: some already carry their article ("the
			// embassy lounge bar"), some are plural ("cracked vinyl stools"). Both
			// have to be handled or you get "The the embassy lounge bar is taken".
			const bare = raw.replace(/^the\s+/, "");
			const subject = furnitureSpan(
				f,
				viewer,
				`The ${bare}`,
				"furniture-link furniture-woven",
			);
			// Sitting on it yourself is worth saying directly — "The stools is taken
			// (you)" is a strange way to tell somebody where they are.
			if (occ.length === 1 && occ[0] === "you")
				return `You're on ${furnitureSpan(f, viewer, `the ${bare}`, "furniture-link furniture-woven")}.`;
			const verb = /s$/i.test(bare) ? "are" : "is";
			return `${subject} ${verb} taken <span class="text-dim">(${occ.join(", ")})</span>.`;
		})
		.join(" ");
}

// Closing clause for the scenery sentence. Picked by zone id, never at random:
// a closer that rerolls on every look makes a room feel unstable, one that
// varies across rooms makes the world feel written.
// [plural, singular] — a one-row scenery list is common ("a recessed ceiling
// wash rounds out the room"), so every closer carries both conjugations rather
// than assuming the list has more than one thing in it.
const SCENERY_CLOSERS = [
	["round out the room", "rounds out the room"],
	["complete the place", "completes the place"],
	["fill out the corners", "fills out the corners"],
	["make up the rest of it", "makes up the rest of it"],
	["finish the room off", "finishes the room off"],
];
function sceneryCloser(zoneId) {
	const s = String(zoneId);
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return SCENERY_CLOSERS[h % SCENERY_CLOSERS.length];
}
function oxfordJoin(parts) {
	if (parts.length <= 1) return parts[0] || "";
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// The SCENERY tier: one sentence, names only, each noun phrase individually
// clickable. Styled `furniture-woven` — body text that reveals a dotted
// underline on hover — so the paragraph reads as prose and the bright orange
// `Furniture:` line keeps its meaning as "things worth your attention".
// Appended to the room paragraph AFTER light truncation by the caller, never
// concatenated onto zone.description beforehand: a dim room slices that string
// by sentence, and the ferns must not survive at the real description's expense.
function sceneryProse(pieces, viewer, zoneId) {
	if (!pieces.length) return "";
	// Lights get their own clause: "(on)"/"(off)" is the one bit of furniture
	// state a room can't afford to drop, so it's said in words instead. Lit and
	// unlit are separated so each clause conjugates cleanly and a dark fixture
	// reads as the job it is.
	const lights = pieces.filter((f) => f.object_type === "light");
	const rest = pieces.filter((f) => f.object_type !== "light");
	const out = [];
	if (rest.length) {
		const parts = phrasesFor(rest, viewer);
		const plural = parts.length > 1 || parts[0].plural;
		out.push(
			`${oxfordJoin(parts.map((p) => p.html))} ${sceneryCloser(zoneId)[plural ? 0 : 1]}.`,
		);
	}
	for (const [lit, verbs] of [
		[true, ["are lit", "is lit"]],
		[false, ["are dark", "is dark"]],
	]) {
		const set = lights.filter((f) => !!f.light_on === lit);
		if (!set.length) continue;
		const parts = phrasesFor(set, viewer);
		const plural = parts.length > 1 || parts[0].plural;
		out.push(
			`${oxfordJoin(parts.map((p) => p.html))} ${verbs[plural ? 0 : 1]}.`,
		);
	}
	// Capitalize each sentence's opening word, which lives INSIDE the first
	// clickable span — so this has to reach past the tag to the first character
	// of body text.
	return out
		.map((s) => s.replace(/>([a-z])/, (_m, c) => `>${c.toUpperCase()}`))
		.join(" ");
}

// Counted, article-correct noun phrases for a set of furniture. A single row can
// still be grammatically plural — plenty of furniture is authored with a plural
// name ("overhead floods", "fluorescent strips") — and such a row takes no
// article and conjugates plural, or you get "An overhead floods complete the
// place." Returns the number alongside so the caller can pick its verb.
function phrasesFor(pieces, viewer) {
	return groupPieces(pieces).map(({ f, qty }) => {
		const n = (f.name || "").toLowerCase();
		const namePlural = /s$/i.test(n);
		const body =
			qty > 1
				? `${countWord(qty).toLowerCase()} ${pluralName(n)}`
				: namePlural
					? n
					: `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}`;
		return {
			html: furnitureSpan(f, viewer, body, "furniture-link furniture-woven"),
			plural: qty > 1 || namePlural,
		};
	});
}

// A fridge and its drop-freezer box are one appliance wearing two furniture rows
// (linked both ways by flags.paired_container). Opening either already opens both
// in the same container panel — see buildContainerView in commands/inventory.js —
// so listing both in the room is redundant clutter. Returns the ids of the
// sub-boxes to hide: the SMALLER `container` capacity of each mutually-paired
// couple, which is always the compartment set into the main body. Requires the
// partner to be present and to point back, so a pair split across rooms, or a
// dangling id, leaves both halves listed rather than silently vanishing one.
function subBoxIds(pieces) {
	const byId = new Map(pieces.map((f) => [f.id, f]));
	const hidden = new Set();
	for (const f of pieces) {
		// A COMPARTMENT is the same idea generalised past two: a shelf inside a
		// cabinet is its own container row, and the room should say "a wall
		// cabinet" once rather than naming every shelf in it. Opening the cabinet
		// reaches all of them (plugins/container draws them as tabs), so the
		// shelves are hidden here whether there are one or nine. Same safety rule
		// as the pair: the parent has to actually be in the room, or a dangling
		// id would vanish a container nobody could then get at.
		if (f.flags?.compartment_of && byId.has(f.flags.compartment_of)) {
			hidden.add(f.id);
			continue;
		}
		const partner = byId.get(f.flags?.paired_container);
		if (!partner || partner.flags?.paired_container !== f.id) continue;
		const mine = Number(f.flags?.container) || 0;
		const theirs = Number(partner.flags?.container) || 0;
		// Tie-break on id so equal-capacity halves still hide exactly one side.
		if (mine < theirs || (mine === theirs && f.id > partner.id)) hidden.add(f.id);
	}
	return hidden;
}

// ATTACHED PIECES. A Betamax deck sitting under a flatscreen is one appliance in
// the room's eye — a satellite of the set, not a second thing to scan past. It
// keeps its own furniture row (its own cassettes, its own panel); the room simply
// prints it hanging off the television it belongs to, and clicking it opens that
// panel directly rather than examining it.
//
// The link is DERIVED where it can't be ambiguous — a media deck in a room with
// exactly one broadcast receiver has only one set it could be under — and can be
// pinned with `flags.attached_to` (the parent's id) for a room with two. Same
// safety rule as the paired fridge: no parent present, or more than one candidate,
// means no attachment, and the deck lists itself as before rather than silently
// vanishing out of a room nobody could then reach it in.
function attachChildren(pieces) {
	const byId = new Map(pieces.map((f) => [f.id, f]));
	const receivers = pieces.filter(
		(f) => f.flags?.tv && f.flags?.broadcast_receiver,
	);
	const map = new Map();
	const claimed = new Set();
	for (const f of pieces) {
		const isDeck = f.object_type === "media_deck" || !!f.flags?.media_deck;
		let parent = f.flags?.attached_to ? byId.get(f.flags.attached_to) : null;
		if (!parent && isDeck && receivers.length === 1) parent = receivers[0];
		if (!parent || parent.id === f.id) continue;
		if (!map.has(parent.id)) map.set(parent.id, []);
		map.get(parent.id).push(f);
		claimed.add(f.id);
	}
	return { map, claimed };
}

// A concealment cabinet standing OPEN has nothing left to show: its face has
// pivoted away and the thing it was hiding is out in the room. Listing both reads
// as two pieces of furniture where the fiction has one, so the revealed piece
// TAKES THE CABINET'S PLACE — including its place in the list, so the room's
// furniture doesn't visibly reshuffle the moment a wall opens. The keypad rides
// along onto the revealed piece (plugins/concealment), which is how it gets shut
// again. A still-concealed piece never reaches here: `flags.concealed` filtered it
// out upstream, so the cabinet is only ever hidden while its secret is standing in
// plain sight.
function standIns(pieces) {
	const byId = new Map(pieces.map((f) => [f.id, f]));
	const hidden = new Set();
	const standsIn = new Map();
	for (const f of pieces) {
		const revealed = f.flags?.conceal_hides
			? byId.get(f.flags.conceal_hides)
			: null;
		if (!revealed || revealed.id === f.id) continue;
		hidden.add(f.id);
		standsIn.set(revealed.id, f);
	}
	return { hidden, standsIn };
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

// dirFilter narrows the candidate set to exits leading a given way — the click
// path passes the direction it drew the link under, so a name shared by several
// exits ("Runway", "Runway", …) still resolves to the one you actually clicked.
export function resolveNamedDestination(zone, typedNameRaw, dirFilter) {
	const typed = (typedNameRaw || "").trim().toLowerCase();
	if (!typed) return { type: "none" };
	// Every named connected destination is resolvable — buildings, interior rooms,
	// and plain exits with a zone name (so clicking "[North] Meridian Ave", or a
	// specific one of several exits sharing a direction, lands there by name).
	const { buildings, rooms, plain } = getConnectedDestinations(zone);
	let candidates = [...buildings, ...rooms, ...plain.filter((p) => p.name)];
	if (dirFilter) {
		const narrowed = candidates.filter((c) => c.direction === dirFilter);
		if (narrowed.length) candidates = narrowed;
	}
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

// `out` is an optional collector for values computed here that a caller would
// otherwise have to recompute: cmdMove ships out.vis in the move payload so the
// client's brightness filter doesn't need its own /environment/visibility fetch.
export async function describeZone(zone, player, out = {}) {
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
	// SIGHT ACUITY, applied after the light-source hook rather than inside it —
	// `fireHook` keeps only the last handler's answer, so a keen-eyed player
	// holding a flashlight would otherwise get one or the other. Applied here it
	// is a relative shift on whatever the light already achieved, so the two
	// compose: the torch raises the room, the eye raises it one further.
	//
	// Read synchronously on purpose. This is the every-move path.
	const sight = acuitySync(player, "sight");
	if (sight) {
		const shifted = shiftVisibility(vis, Math.round(sight));
		vis.category = shifted.category;
		vis.visibility = shifted.visibility;
	}
	out.vis = vis;
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
				const door = doorOnLink(zone.id, p.direction, p.targetId);
				if (door && !door.is_open && door.hp > 0) {
					const dirLabel =
						p.direction.charAt(0).toUpperCase() +
						p.direction.slice(1);
					const doorName = door.name || "Door";
					return `<span class="dir-tag">[${dirLabel}]</span> <span class="action-link door-link" data-action="open" data-target="door ${p.direction}" title="Open ${doorName}">${doorName}</span>`;
				}
				return destLink(p.direction, null, "exit-link");
			});
			darkDesc += `\n\n<span class="exits-row"><span class="exits-label">Exits:</span> ${exitLinks.join(", ")}</span>`;
		}
		if (buildings.length) {
			const links = buildings.map((b) =>
				destLink(b.direction, b.name, "building-link"),
			);
			darkDesc += `\n<span class="buildings-row"><span class="buildings-label">Buildings:</span> ${links.join(", ")}</span>`;
		}
		if (rooms.length) {
			const links = rooms.map((r) =>
				destLink(r.direction, r.name, "room-nav-link"),
			);
			darkDesc += `\n<span class="rooms-row"><span class="rooms-label">Rooms:</span> ${links.join(", ")}</span>`;
		}
		return darkDesc;
	}

	const gate = LIGHT_GATE[vis.category] || {};
	const isDark = !!gate.dark;
	const isDim = !!gate.dim;
	const hideItems = isDark || !!gate.hideItems;

	const { buildings, rooms, plain } = getConnectedDestinations(zone);
	const enemies = isDark ? [] : getZoneEnemies(zone.id);
	// Per-viewer people-transforms ride the same rule as the furniture ones: a
	// no-op for anybody not tripping, and COPIES, never the shared world rows.
	const npcs = gate.hideNpcs ? [] : applyNpcTransforms(player.id, getZoneNpcs(zone.id));
	const corpses = isDark ? [] : getZoneCorpses(zone.id);
	// Per-viewer hallucinated entities (trip plugin). They render into the real
	// NPC/Hostile lines so they're indistinguishable from real presences. Hidden
	// in the dark like everything else; the deliriant fills a lit room, not a
	// blind one. Split by kind: people join "NPCs here:", beasts join "Hostiles:".
	const phantoms = isDark || gate.hideNpcs ? [] : getPhantomsInZone(player.id, zone.id);
	const phantomPeople = phantoms.filter((p) => p.kind === "person");
	// Conjured OBJECTS get their own line rather than joining the hostiles: a
	// psychedelic turns the room strange, it does not populate it with monsters.
	// These exist so a room with nothing to transform still transforms.
	const phantomObjects = phantoms.filter((p) => p.kind === "object");
	const phantomBeasts = phantoms.filter((p) => p.kind !== "person" && p.kind !== "object");
	// Sneakers this viewer has not clocked are simply not in the room as far as
	// they are concerned — per viewer, so the same crouched player can be listed
	// for one person and absent for another. One Set lookup, no query.
	const others = isDark
		? []
		: getZonePlayers(zone.id).filter(
				(p) => p.id !== player.id && !isHiddenFrom(p, player.id),
			);

	// These are mutually independent, so they issue together rather than
	// serially: each query() is its own pool checkout and round trip, and hosted
	// the RTT dominates. zoneGens is consumed ~200 lines down (Installed: list).
	// Furniture comes from the world cache (write-funneled in world.js), so this
	// per-look/per-move hot path costs no furniture round trip.
	// Per-viewer object transforms (a psychedelic making the room misbehave). A
	// no-op for anyone not tripping, and it returns COPIES — the rows out of
	// getZoneFurniture are shared by everyone in the room.
	const furniture = applyTransforms(player.id, getZoneFurniture(zone.id));
	const [
		{ rows: sleepingBodies },
		{ rows: groundItems },
		{ rows: zoneGens },
	] = await Promise.all([
		isDark
			? { rows: [] }
			: query(
					`SELECT handle FROM players WHERE offline_sleeping=TRUE AND current_zone=$1`,
					[zone.id],
				),
		hideItems
			? { rows: [] }
			: query(
					`SELECT * FROM player_inventory
     WHERE player_id = $1 AND container_id IS NULL`,
					[`_ground_${zone.id}`],
				).then((r) => {
					// Item templates decorate from the boot-loaded items cache (was a
					// JOIN). Rows whose template vanished drop, matching the old INNER JOIN.
					const rows = [];
					for (const pi of r.rows) {
						const it = getItem(pi.item_id);
						if (it) rows.push({ ...pi, name: it.name, tags: it.tags });
					}
					return { rows };
				}),
		isDark
			? { rows: [] }
			: query(
					`SELECT name, status FROM generators WHERE zone_id=$1 AND generator_type='junction_box'`,
					[zone.id],
				),
	]);
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

	// Furniture partition — shared by the woven prose aside (below, folded into
	// room-desc) and the plain Furniture list further down. Plugins may claim
	// pieces for their own panel; suppressed ids and concealed pieces drop from
	// both. In the dark only lights survive, so woven (non-light) pieces auto-hide
	// like the cameras. Computed once here so the aside is ready for room-desc.
	const furniturePanel =
		!isDark && furniture.length
			? await fireHook("zone.furniturePanel", zone, furniture, player)
			: null;
	const furnitureSuppress = new Set(furniturePanel?.suppressIds || []);
	const visibleFurniture = (isDark
		? furniture.filter((f) => f.object_type === "light")
		: furniture
	).filter((f) => !furnitureSuppress.has(f.id) && !f.flags?.concealed);
	const pairedSubBoxes = subBoxIds(visibleFurniture);
	const { hidden: openDisguises, standsIn } = standIns(visibleFurniture);
	// Everything eligible for a tier: cameras have their own aside, the smaller
	// half of a mutually-paired appliance (a fridge's freezer box) is redundant
	// with the half that's listed, and an open concealment cabinet has stood aside
	// for the piece it was hiding.
	const tierable = visibleFurniture.filter(
		(f) =>
			f.object_type !== "security_device" &&
			!pairedSubBoxes.has(f.id) &&
			!openDisguises.has(f.id),
	);
	// Occupancy is resolved by NAME (furnitureOccupants matches sittingOn against
	// the name), so with four identical stools and one sitter every row would
	// claim the same occupant. Attribute the occupants to the FIRST row of each
	// name and let the remainder group as free — one taken plus three free still
	// counts to four, and it beats printing the same sitter four times.
	const seatedHere = getZonePlayers(zone.id);
	const occupiedIds = new Set();
	const occupiedEntries = [];
	const occNamed = new Set();
	for (const f of tierable) {
		const key = (f.name || "").toLowerCase();
		if (occNamed.has(key)) continue;
		const occ = furnitureOccupants(f.name, seatedHere, npcs, player);
		if (!occ.length) continue;
		occNamed.add(key);
		occupiedIds.add(f.id);
		occupiedEntries.push({ f, occ });
	}
	const wovenPieces = tierable.filter(
		(f) => f.flags?.woven && !occupiedIds.has(f.id),
	);
	const untiered = tierable.filter(
		(f) => !f.flags?.woven && !occupiedIds.has(f.id),
	);
	// SCENERY. Suppressed in the dark, where visibleFurniture is lights only and
	// a verbless lamp is the one thing you actually need to find.
	const sceneryPieces = isDark
		? []
		: untiered.filter((f) => isSceneryPiece(f, player));
	const sceneryIds = new Set(sceneryPieces.map((f) => f.id));
	// STANDING. Clustered by object_type, then alphabetical inside each cluster.
	// The type itself is never printed — this only stops the line reading as a
	// random jumble (furniture rows come out of the world cache in DB insertion
	// order, which isn't even stable across a content rewrite). Unlisted types
	// sort after the known ones, alphabetically by type, so a new object_type
	// slots in somewhere sane without touching this table.
	// A revealed piece sorts as the cabinet it replaced, so opening a wall swaps
	// one entry for another in place instead of shuffling the whole line.
	const sortAs = (f) => standsIn.get(f.id) || f;
	const plainFurniture = untiered
		.filter((f) => !sceneryIds.has(f.id))
		.sort((a, b) => {
			const sa = sortAs(a);
			const sb = sortAs(b);
			const ra = furnitureSortRank(sa);
			const rb = furnitureSortRank(sb);
			if (ra !== rb) return ra - rb;
			const ta = sa.object_type || "furniture";
			const tb = sb.object_type || "furniture";
			if (ta !== tb) return ta.localeCompare(tb);
			return (sa.name || "").localeCompare(sb.name || "");
		});
	const furnitureAside = [
		weaveFurniture(wovenPieces, player),
		weaveOccupied(occupiedEntries, player),
	]
		.filter(Boolean)
		.join(" ");
	const sceneryLine = sceneryProse(sceneryPieces, player, zone.id);

	// Header line: name and the danger tag sit together so the [SAFE]/[LETHAL]
	// chip reads as a label on the room rather than a separate line.
	const dangerNow = zoneDanger(zone);
	// The room's own name, for a viewer whose room is misbehaving. `data-morph`
	// carries the real one so the pane plays the change rather than printing it.
	const seenRoomName = getRoomTransformName(player.id, zone.id);
	const roomNameSpan = seenRoomName
		? `<span class="zone-name" data-morph="${escAttr(zone.name)}">${seenRoomName.charAt(0).toUpperCase()}${seenRoomName.slice(1)}</span>`
		: `<span class="zone-name">${zone.name}</span>`;
	let desc =
		roomNameSpan +
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
	// (zone, player) — the viewer is passed so a hook can render a per-player
	// panel (the elevator car's floor readout depends on who's riding it).
	//
	// GATHERED, not fired: a room is not a single fact. Six plugins register this
	// hook (aa-sites, elevator, flight, graffiti, storefront, voidwalking, yacht)
	// and they can co-occur — a tagged wall on an airfield tile is both things at
	// once. Under fireHook the last-loaded plugin silently ATE the others' line;
	// every contributor already returns undefined outside its own case, so joining
	// them can't duplicate anything, it can only stop losing text.
	//
	// GATHERED HERE, PRINTED LATER (below the prose). These lines describe THINGS
	// THAT ARE IN THE ROOM — a tag on the shopfront, a shop's shutter, an elevator's
	// floor readout — so they read with the authored prose, not up among the
	// [SAFE]/district/light chips, which are a status header about the tile. The
	// gather stays here because it is the async step; only the placement moved.
	const roomLines = (await gatherHook("zone.describeRoom", zone, player)).filter(Boolean);
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
	// WEATHER IN AN UNREAL PLACE. Two cases the ordinary rule cannot serve:
	//
	//  1. A dream room is flagged interior, so it never got weather at all — and
	//     weather is most of what sells a place as somewhere. A dreamscape's is
	//     authored per template and is deliberately impossible: rain indoors,
	//     light with no source, a sky where there is no sky.
	//  2. Standing outside on a psychedelic, the weather is REAL and doing
	//     something it should not. Warping the line rather than replacing it keeps
	//     the actual conditions legible — you are still in the rain, the rain has
	//     simply stopped behaving.
	//
	// Both are per-viewer, and both are pure description: nothing here touches the
	// weather sim, so gear, temperature and hazard channels are unaffected.
	if (zone.dreamWeather) {
		weatherLine = ` <span class="msg-ambient">${zone.dreamWeather}</span>`;
	} else if (!isInteriorZone(zone) && vis.category !== "pitch_dark") {
		const wd = getWeatherDescription();
		if (wd) {
			const warp = getWeatherWarp(player.id, zone.id);
			weatherLine = warp ? ` ${wd} <span class="msg-ambient">${warp}</span>` : ` ${wd}`;
		}
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
	// A psychedelic re-reads the ROOM ITSELF, for this viewer only. Appended rather
	// than replacing the authored prose: the place is still the place, it is simply
	// also doing something it should not. Applied regardless of what furniture is
	// here, which is what makes a trip on a bare street corner still a trip.
	const roomWarp = getRoomTransform(player.id, zone.id);
	const warpLine = roomWarp ? ` <span class="msg-ambient">${roomWarp}</span>` : "";
	// Prose paragraph wrapped so the client can collapse/expand it independently.
	// The scenery clause closes the authored paragraph rather than trailing the
	// whole block: static furnishings belong with the static description, which
	// leaves the woven paragraph below as a clean "here is what's happening"
	// beat. Appended to the already-truncated zoneDesc, never to zone.description
	// (see sceneryProse). Sits before the weather so the room finishes describing
	// itself before it looks up at the sky.
	const scenerySuffix = sceneryLine ? ` ${sceneryLine}` : "";
	desc += `\n<span class="room-desc">${zoneDesc}${scenerySuffix}${weatherLine}${skylineLine}${warpLine}${describeBuildingDiscovery(buildings)}</span>`;
	// Woven-object prose (furniture + PD cams) lives in its own paragraph after the
	// room description — a natural second beat rather than a tail on the authored
	// prose. Sits outside room-desc so it stays visible when that collapses.
	const wovenProse = `${furnitureAside}${cameraAside}`.trim();
	// No leading "\n": room-furniture is display:block, so it starts its own line;
	// the paragraph gap comes from its margin-top. A literal newline here would
	// render as an extra blank line under pre-wrap and double the gap.
	if (wovenProse) desc += `<span class="room-furniture">${wovenProse}</span>`;
	// The plugin room-lines gathered above, in their own paragraph after the room
	// has finished describing itself. Outside room-desc deliberately: a tag on the
	// wall is still there when you collapse the prose.
	if (roomLines.length) desc += `\n${roomLines.join("\n")}`;
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
			vomit: (n) =>
				n > 1
					? `Somebody has been very sick in here, more than once. The smell gets into your throat.`
					: `There's a splash of sick against the wall and across the floor.`,
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
				return `<span class="action-link room-item" data-action="take" data-target="${escAttr(item.name)}" title="Take ${escAttr(disp)}">${label}</span>`;
			});
			desc += `\n<span class="items-label">Lying here:</span> ${itemMentions.join(", ")}`;
		}
	}

	// Furniture list — cameras and woven pieces already dropped out in the shared
	// partition above (plainFurniture); the panel/suppress were computed there too.
	if (plainFurniture.length) {
		// Grouped: four identical stools are one entry, and light state is in the
		// grouping key so an (on) lamp never merges with an (off) one. Occupancy
		// isn't here any more — an occupied piece was promoted to prose above.
		// Attachment resolves against the GROUPED list, and only between entries
		// that stand alone in it: four identical sets collapse to one label, and
		// there'd be no telling which of them the deck was under. Doing it here
		// rather than upstream keeps the claim and the render on the same list, so
		// a satellite can never be dropped from one without appearing in the other.
		const groups = collapseByKind(groupPieces(plainFurniture));
		const soloIds = new Set(groups.filter((g) => g.qty === 1 && !g.kind).map((g) => g.f.id));
		const { map: attachedMap, claimed: attachedIds } = attachChildren(
			plainFurniture.filter((f) => soloIds.has(f.id)),
		);
		const furnitureLinks = groups.filter((g) => !attachedIds.has(g.f.id)).map(({ f, qty, kind }) => {
			const stateTag =
				f.object_type === "light"
					? ` <span class="light-state ${f.light_on ? "light-on" : "light-off"}">(${f.light_on ? "on" : "off"})</span>`
					: "";
			// Ship each piece's full affordance set so the mobile smart bar can
			// surface exactly the verbs it supports (sit/switch/watch/…).
			const verbs = furnitureVerbs(f, player);
			const actionsAttr = verbs.length ? ` data-actions="${verbs.join(" ")}"` : "";
			// data-target stays the SINGULAR name even on a counted group — the
			// label is a display convenience, the command still targets the piece.
			// A kind-collapsed entry labels by its head noun ("eight Lockboxes")
			// but still targets the first member, so a click examines a real row
			// and SIFT's ambiguity prompt lists the rest by name.
			// A hallucinated piece is named the way a thing in prose is named ("a
			// sleeping lion"), so the list label drops the article rather than
			// printing "A Sleeping Lion". Real furniture never carries one.
			const listName = String(f.name || "").replace(/^(?:a|an|the)\s+/i, "");
			const label = kind
				? `${countWord(qty).toLowerCase()} ${titleCaseName(pluralName(kind))}`
				: qty === 1
					? titleCaseName(listName)
					: `${countWord(qty).toLowerCase()} ${titleCaseName(pluralName(f.name))}`;
			// data-ftype carries the row's object_type through to CSS so each kind of
			// thing gets its own tint (see .furniture-link[data-ftype=…] in styles.css).
			// What it WAS, for the pane's letter-by-letter morph (render.js). Only
			// ever present on a piece a psychedelic is re-reading for this viewer.
			const morphAttr = f._realName
				? ` data-morph="${escAttr(titleCaseName(String(f._realName).replace(/^(?:a|an|the)\s+/i, "")))}"`
				: "";
			// A light clicks through to its own switch rather than to examine — see
			// lightClick. The (on)/(off) tag beside it is what the click acts on.
			const click = lightClick(f, player) || {
				action: "examine",
				target: f.name,
				title: `Examine ${f.name}`,
			};
			// Satellites (a deck under its television) print hanging off this entry,
			// clicking through to their own panel.
			const attached = (attachedMap.get(f.id) || [])
				.map((c) => attachedSpan(c, player))
				.join("");
			return `<span class="action-link furniture-link" data-ftype="${f.object_type || "furniture"}" data-action="${click.action}" data-target="${escAttr(click.target)}"${pieceAttr(f, click)}${actionsAttr}${morphAttr} title="${escAttr(click.title)}">${label}</span>${stateTag}${attached}`;
		});
		desc += `\n<span class="furniture-label">Furniture:</span> ${furnitureLinks.join(", ")}`;
	}
	if (furniturePanel?.html) desc += `\n${furniturePanel.html}`;
	if (!isDark) {
		if (zoneGens.length) {
			const genLinks = zoneGens.map(
				(g) =>
					`<span class="furniture-link" data-ftype="junction_box">${titleCaseName(g.name) || "Junction Box"}</span> <span class="text-dim">(${g.status})</span>`,
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
			return `<span class="action-link furniture-link" data-ftype="window" data-action="look" data-target="through ${escAttr(w.name)}" title="Look through ${escAttr(w.name)}">${titleCaseName(w.name)}</span>${curtainTag}${glassTag}`;
		});
		desc += `\n<span class="furniture-label">Windows:</span> ${windowLinks.join(", ")}`;
	}

	if (others.length) {
		// A sleeper reads as one. `sleepingBodies` below is the OFFLINE list (a DB
		// query on offline_sleeping), so without this an online sleeper — dreaming
		// or not — stood in the room looking wide awake, and nothing in the room
		// description hinted that they were lootable.
		const playerLinks = others.map(
			(p) =>
				`<span class="action-link player-link" data-action="examine" data-target="${escAttr(p.handle)}" title="Look at ${escAttr(p.handle)}">${p.handle}${bodyTell(p, zone.id) ? ` <span class="text-dim">(${bodyTell(p, zone.id)})</span>` : ''}</span>`,
		);
		desc += `\n<span class="players-label">Also here:</span> ${playerLinks.join(", ")}`;
	}
	if (sleepingBodies.length) {
		const bodyLinks = sleepingBodies.map(
			(p) =>
				`<span class="action-link player-link" data-action="examine" data-target="${escAttr(p.handle)}" title="Look at ${escAttr(p.handle)}">${p.handle} <span class="text-dim">(sleeping)</span></span>`,
		);
		desc += `\n<span class="players-label">Sleeping here:</span> ${bodyLinks.join(", ")}`;
	}
	if (npcs.length || phantomPeople.length) {
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
				// The LABEL is what this viewer sees (a psychedelic may have made this
				// person into something else); the target stays the real name, so a
				// click reaches them however your eyes are behaving.
				const morphAttr = n._realName ? ` data-morph="${escAttr(n._realName)}"` : "";
				return `<span class="action-link npc-link" data-action="talk" data-target="${escAttr(n._realName || n.name)}"${morphAttr} title="Talk to ${escAttr(n.name)}">${n.name}</span>${postureTag}`;
			};
			// A phantom person wears the exact same markup as a real NPC — the
			// only "tell" is that talking to it or touching it doesn't behave.
			const phantomLink = (p) =>
				`<span class="action-link npc-link" data-action="talk" data-target="${escAttr(p.name)}" title="Talk to ${escAttr(p.name)}">${p.name}</span>`;
			// Vendors get their own section — but covert/trust-gated dealers stay
			// camouflaged among the regular NPCs so their storefront isn't outed.
			const isVendor = (n) =>
				!n.flags?.trust_flag &&
				((Array.isArray(n.vendor_inventory) && n.vendor_inventory.length > 0) ||
					n.flags?.personality === 'vendor');
			const vendors = npcs.filter(isVendor);
			const regular = npcs.filter((n) => !isVendor(n));
			const regularLinks = [...regular.map(npcLink), ...phantomPeople.map(phantomLink)];
			if (vendors.length) {
				desc += `\n<span class="vendors-label">Vendors here:</span> ${vendors.map(npcLink).join(", ")}`;
			}
			if (regularLinks.length) {
				desc += `\n<span class="npcs-label">NPCs here:</span> ${regularLinks.join(", ")}`;
			}
		}
	}
	if (enemies.length || phantomBeasts.length) {
		const enemyLinks = enemies.map(
			(e) =>
				`<span class="action-link enemy-link" data-action="attack" data-target="${escAttr(e.name)}" data-instance-id="${e.instanceId}" title="Attack ${escAttr(e.name)}">${e.name}</span> (${e.hp}/${e.hp_max}HP)`,
		);
		const phantomBeastLinks = phantomBeasts.map(
			(p) =>
				`<span class="action-link enemy-link" data-action="attack" data-target="${escAttr(p.name)}" title="Attack ${escAttr(p.name)}">${p.name}</span> (${p.hp}/${p.hp_max}HP)`,
		);
		desc += `\n<span class="enemies-label">Hostiles:</span> ${[...enemyLinks, ...phantomBeastLinks].join(", ")}`;
	}
	// Conjured objects sit with the furniture, not the monsters — they read as
	// things that are simply in the room, which is the whole trick.
	if (phantomObjects.length) {
		const objLinks = phantomObjects.map(
			(p) =>
				`<span class="action-link furniture-link" data-action="examine" data-target="${escAttr(p.name)}" title="Examine ${escAttr(p.name)}">${p.name}</span>`,
		);
		desc += `\n<span class="furniture-label">Also here:</span> ${objLinks.join(", ")}`;
	}
	if (corpses.length) {
		const corpseLinks = corpses.map(
			(c) =>
				`<span class="action-link corpse-link" data-action="loot" data-target="${c.id}" data-label="${escAttr(c.name)}" title="Loot ${escAttr(c.name)}">${c.name}</span>`,
		);
		desc += `\n<span class="corpses-label">Corpses:</span> ${corpseLinks.join(", ")}`;
	}
	if (plain.length) {
		const exitLinks = await Promise.all(plain.map(async (p) => {
			const door = doorOnLink(zone.id, p.direction, p.targetId);
			if (door && !door.is_open && door.hp > 0) {
				const dirLabel =
					p.direction.charAt(0).toUpperCase() + p.direction.slice(1);
				const doorName = door.name || "Door";
				const lockAttr = await doorLockAttr(door, player);
				return `<span class="dir-tag">[${dirLabel}]</span> <span class="action-link door-link" data-action="open" data-target="door ${p.direction}"${lockAttr} title="Open ${doorName}">${doorName}</span>${describeDoorForcefield(door)}`;
			}
			return destLink(p.direction, p.name, "exit-link");
		}));
		desc += `\n<span class="exits-row"><span class="exits-label">Exits:</span> ${exitLinks.join(", ")}</span>`;
	}
	if (buildings.length) {
		const links = await Promise.all(buildings.map(async (b) =>
			destLink(b.direction, b.name, "building-link") +
			await doorSuffix(zone.id, b.direction, b.targetId, player),
		));
		desc += `\n<span class="buildings-row"><span class="buildings-label">Buildings:</span> ${links.join(", ")}</span>`;
	}
	if (rooms.length) {
		const links = await Promise.all(rooms.map(async (r) =>
			destLink(r.direction, r.name, "room-nav-link") +
			await doorSuffix(zone.id, r.direction, r.targetId, player),
		));
		desc += `\n<span class="rooms-row"><span class="rooms-label">Rooms:</span> ${links.join(", ")}</span>`;
	}
	return desc;
}

// Exposed for the regression harness: which pieces the room deliberately does
// NOT name, because something else in the room already reaches them.
export const _test = { subBoxIds };
