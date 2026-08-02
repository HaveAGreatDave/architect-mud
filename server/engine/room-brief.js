// Brief room descriptions for the Display Mode `log` rung.
//
// ── The problem this solves ──────────────────────────────────────────────────
// At the `log` rung the room description is appended to the scrolling log on
// every move (server/index.js stampToLog). That is the ONLY way a screen-reader
// player learns where they are, so it cannot simply be dropped — but the full
// description is a prose paragraph, and a player crossing six rooms gets six
// paragraphs READ ALOUD. Walking down a street becomes a wall of text nobody can
// skim past, and the actual news — a person, an enemy, an exit — is buried in it.
//
// ── The rule ─────────────────────────────────────────────────────────────────
// This is the classic MUD `brief` contract, and its whole safety property is:
//
//   NOTHING IS EVER LOST, ONLY DEFERRED BY ONE KEYSTROKE.
//
//   • An explicit `look` ALWAYS renders in full. Always. Any change here that
//     makes `look` terse breaks the contract, because then the information is
//     genuinely gone rather than one command away.
//   • The FIRST arrival at a room renders in full — you have never read that
//     prose, so abbreviating it would hide content rather than repeat it.
//   • Every arrival after that is brief.
//
// ── What brief keeps ─────────────────────────────────────────────────────────
// The split is not "short bits vs long bits", it is:
//
//   KEEP anything that can be DIFFERENT this time — people, enemies, corpses,
//        items, furniture, exits, and every warning/light line.
//   DROP anything that is a property of the ROOM ITSELF and therefore identical
//        to what you were told last time — the prose paragraph, ambient flavour.
//
// That is why a brief is safe to repeat-suppress: by construction it contains
// everything that could have changed since you were last here. If you add a new
// section to describeZone that is dynamic, add its class to KEEP below, or a
// log-rung player will stop being told about it.
//
// ── Why it parses HTML instead of asking describeZone ────────────────────────
// describeZone has ~20 call sites across the engine and eight plugins, all of
// which build their own `{type:'look'|'move'}` payload. Threading a `brief`
// option through every one of them would be a large change that a new call site
// silently opts out of. Working from the rendered markup instead means EVERY
// call site is covered by construction, including ones added later.
//
// The markup is stable and well-classed (`zone-name`, `exits-row`, `room-desc`,
// …), but this is still a text transform over another module's output: if it
// fails to recognise anything, it MUST return the input unchanged. A brief that
// silently eats the room is far worse than one that never fires.

// Sections that survive a brief. Matched against the class attribute of a
// top-level span/div in the description.
const KEEP = [
	'zone-name',        // where you are — always
	'zone-district',
	'light-level',      // it is dark here / gloom / murk — gates what you can see
	'rad-warning',      // ☢ — lethal, never abbreviate away
	'safe-warning',
	'death-message',
	'players-label', 'players-row',
	'npcs-label', 'npcs-row',
	'enemies-label', 'enemies-row',
	'corpses-label', 'corpses-row',
	'items-label', 'items-row',
	'vendors-label', 'vendors-row',
	'exits-row', 'exits-label',
	'buildings-row', 'buildings-label',
	'rooms-row', 'rooms-label',
	'furniture-label',  // the plain Furniture LIST. Not the woven prose — see DROP.
];

// Sections a brief drops. Listed explicitly rather than inferred as "everything
// not in KEEP", so that an UNRECOGNISED section is kept rather than lost — the
// failure mode of a new section type is a slightly longer brief, never a missing
// one.
// `room-furniture` is the WOVEN PROSE second beat ("a bench sits under the
// window"), not the furniture list — describe.js appends it with no leading
// newline, so it shares a line with room-desc and goes with it either way. That
// is the right answer: it is prose about the room, identical every visit. The
// plain Furniture list (`furniture-label`) is a separate line and survives.
const DROP = ['room-desc', 'room-furniture', 'msg-ambient'];

const classesOf = (line) => {
	const out = [];
	for (const m of line.matchAll(/class="([^"]*)"/g)) out.push(...m[1].split(/\s+/));
	return out;
};

// ── Furniture sections are flattened, not dropped ────────────────────────────
// A room with enough furniture sections it into derived facet groups — Seating:,
// Storage:, Tools: (docs/reference/item-facets.md). Those groups are a way of
// making a long list SCANNABLE, which is a property of a pane you look at. In a
// chronological log they are three labels and three line breaks carrying the
// information one comma-separated line already carries, so brief flattens them
// back to a single `Furniture:` row. Every object survives; only the grouping goes.
//
// ⚠ This must be a FLATTEN, never a drop. describe.js emits the sections as a
// `<div>` with NO leading newline, so the div shares a line with whatever came
// before it — dropping that line would take the furniture AND the row above it
// with it. That was a real bug here before this function existed in this shape.
function flattenFurnitureSections(html) {
	return html.replace(/<div class="room-furn-secs">([\s\S]*?)<\/div>/g, (_, inner) => {
		const items = [...inner.matchAll(/<span class="furn-sec-items">([\s\S]*?)<\/span>/g)]
			.map((m) => m[1].trim())
			.filter(Boolean);
		if (!items.length) return '';   // shape not understood — drop the empty wrapper only
		return `\n<span class="furniture-label">Furniture:</span> ${items.join(', ')}`;
	});
}

// The `Installed:` row — utility devices bolted to the room (junction boxes,
// meters). It shares the `furniture-label` CLASS with `Furniture:`, so it can only
// be told apart by its label text. It is a fixture of the room, identical every
// visit, and each entry repeats the room's own name, which makes it the single
// noisiest thing in a logged room. An explicit `look` still shows it in full.
const isInstalledRow = (line) => /<span class="furniture-label">Installed:<\/span>/.test(line);

/**
 * Abbreviate a rendered room description.
 * Returns the input unchanged if it cannot confidently do so.
 */
export function briefRoom(html) {
	if (typeof html !== 'string' || !html) return html;
	// A description with no zone name is not a shape we understand — leave it be.
	if (!html.includes('zone-name')) return html;

	const lines = flattenFurnitureSections(html).split('\n');
	const kept = [];
	for (const line of lines) {
		if (!line.trim()) continue;                 // blank spacers; re-added below
		if (isInstalledRow(line)) continue;
		const cls = classesOf(line);
		// KEEP beats DROP on a mixed line. describe.js appends several sections with
		// no leading newline, so two sections routinely share one line — and when
		// they do, keeping too much is a non-event while dropping too much loses a
		// room's contents. The bias is deliberate and must not be inverted.
		if (cls.some((c) => DROP.includes(c)) && !cls.some((c) => KEEP.includes(c))) continue;
		if (!cls.length) {
			// Unclassed text. This is the prose case when describeZone emits the
			// description bare, so drop it ONLY when we have already kept the zone
			// name — before that, it is a header we do not recognise and keeping it
			// is the safe answer.
			if (kept.length) continue;
		}
		kept.push(line);
	}
	// If abbreviating removed nothing, or removed so much that only the name is
	// left with no exits, the transform did not understand this description.
	// Hand back the original rather than a stub.
	if (kept.length === lines.filter((l) => l.trim()).length) return html;
	if (kept.length < 2) return html;
	return kept.join('\n');
}

/**
 * Should this arrival be rendered in full?
 *
 * True on the player's first arrival at a zone in this session — they have never
 * read the prose, so a brief would be hiding content, not repeating it. Tracked
 * in memory on the live player object: this is per-session by design (coming back
 * after a reconnect and getting the full room again is a feature, not a leak) and
 * so it needs no column, no flag and no query. See the persistence tiers in
 * docs/architecture.md — this is exactly the runtime-derived state that must not
 * become a DB write on the every-move path.
 */
export function markSeenZone(player, zoneId) {
	if (!player || !zoneId) return true;
	if (!player._logSeenZones) player._logSeenZones = new Set();
	if (player._logSeenZones.has(zoneId)) return false;
	player._logSeenZones.add(zoneId);
	return true;
}

export const _test = { briefRoom, KEEP, DROP };
