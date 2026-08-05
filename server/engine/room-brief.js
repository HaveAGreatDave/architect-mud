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

// ── Three tiers, not two ─────────────────────────────────────────────────────
// The first version of this file had one KEEP list holding everything dynamic,
// and a brief still ran to eight or nine lines: people, enemies, corpses, items,
// vendors, furniture, buildings, sub-rooms, exits. Read aloud, walking a street
// was still a wall of speech, and the two lines that actually matter — where you
// are and what can hurt you — were somewhere in the middle of it.
//
// So a brief now has THREE tiers:
//
//   VITAL  → printed. Where you are, what is dangerous, who is here, how to
//            leave. Everything that is either a hazard or a decision.
//   TALLY  → NAMED, not printed. Contents you would act on deliberately rather
//            than react to — items, furniture, vendors, buildings. Collapsed to
//            one closing line, "Also here: items, furniture."
//   DROP   → gone. Prose and flavour, identical every visit.
//
// The safety contract is unchanged and the TALLY tier is what preserves it:
// nothing becomes invisible, because the brief still says the category is there
// and `look` is still always full. One keystroke, as before.

// Tier 1 — always printed.
const VITAL = [
	'zone-name',        // where you are — always
	'light-level',      // it is dark here / gloom / murk — gates what you can see
	'rad-warning',      // ☢ — lethal, never abbreviate away
	'safe-warning',
	'death-message',
	'players-label', 'players-row',
	'npcs-label', 'npcs-row',
	'enemies-label', 'enemies-row',
	'exits-row', 'exits-label',
];

// Tier 2 — collapsed into the closing "Also here:" line. Class prefix → the noun
// it is announced as. These are things you go looking FOR; none of them can hurt
// you between one step and the next, which is the line between this tier and
// VITAL.
const TALLY = {
	items: 'items',
	corpses: 'corpses',
	vendors: 'vendors',
	furniture: 'furniture',
	buildings: 'buildings',
	rooms: 'rooms',
};
const TALLY_CLASSES = new Map();
for (const [prefix, noun] of Object.entries(TALLY)) {
	TALLY_CLASSES.set(`${prefix}-row`, noun);
	TALLY_CLASSES.set(`${prefix}-label`, noun);
}

// Retained so callers/tests that ask "does a brief contain this?" still get a
// true answer: a brief may contain anything in either printed tier.
const KEEP = [...VITAL, ...TALLY_CLASSES.keys(), 'zone-district'];

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
	const alsoHere = [];                            // TALLY nouns, in encounter order
	for (const line of lines) {
		if (!line.trim()) continue;                 // blank spacers; re-added below
		if (isInstalledRow(line)) continue;
		const cls = classesOf(line);
		// VITAL beats TALLY beats DROP on a mixed line. describe.js appends several
		// sections with no leading newline, so two sections routinely share one line
		// — and when they do, keeping too much is a non-event while dropping too
		// much loses a room's contents. The bias is deliberate and must not be
		// inverted: a line carrying an exits row AND an items row prints whole.
		const vital = cls.some((c) => VITAL.includes(c));
		if (!vital) {
			const nouns = cls.map((c) => TALLY_CLASSES.get(c)).filter(Boolean);
			if (nouns.length) {
				for (const n of nouns) if (!alsoHere.includes(n)) alsoHere.push(n);
				continue;
			}
			if (cls.some((c) => DROP.includes(c))) continue;
		}
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
	if (!alsoHere.length && kept.length === lines.filter((l) => l.trim()).length) return html;
	if (kept.length < 2) return html;
	// The TALLY tier's whole justification. Without this line the collapse would
	// be a DROP and the room would silently stop having contents.
	if (alsoHere.length) kept.push(`<span class="brief-more">Also here: ${alsoHere.join(', ')}.</span>`);
	return kept.join('\n');
}

// ── ARRIVAL: less than brief, because walking is not reading ─────────────────
//
// Brief was still a description. Six lines about who is here and where the exits
// are, spoken on every single step, is a lot of speech to sit through when all
// you did was walk north — and the player asking for the bottom rung is asking
// for as little as possible, not for a shorter paragraph.
//
// So MOVING says where you are and what can hurt you, and NOTHING else. The
// contract is unchanged and is what makes this safe: `look` is still always
// full, and it is still one keystroke away. What used to be deferred by one
// keystroke is simply deferred a little more often.
//
// WHAT SURVIVES A MOVE, and why it is exactly this:
//   · the zone name — otherwise you cannot tell that you moved
//   · the light level — it gates what looking would even show you
//   · ☢ / safe / death warnings — lethal, and never abbreviated anywhere
//   · enemies — the one thing in a room that acts on you before you can look
//
// Everything else — people, exits, items, furniture, the `Also here:` tally —
// waits for `look`. Exits are the borderline case and they go: a room you have
// walked into has an exit you walked in through, and asking is one word.
const ARRIVAL = [
	'zone-name',
	'light-level',
	'rad-warning',
	'safe-warning',
	'death-message',
	'enemies-label', 'enemies-row',
];

/**
 * The one-line version of a room, for a move at the `log` rung.
 * Falls back to `briefRoom` — never to nothing — if the shape isn't understood.
 */
export function arrivalRoom(html) {
	if (typeof html !== 'string' || !html) return html;
	if (!html.includes('zone-name')) return html;
	const lines = flattenFurnitureSections(html).split('\n');
	const kept = [];
	for (const line of lines) {
		if (!line.trim()) continue;
		const cls = classesOf(line);
		// Unclassed text after the name is the bare-prose case — the thing this is
		// here to drop. Before the name it is a header we do not recognise, and
		// dropping an unknown header is how a room goes missing.
		if (!cls.length) { if (!kept.length) kept.push(line); continue; }
		if (cls.some((c) => ARRIVAL.includes(c))) kept.push(line);
	}
	// Nothing recognised, or nothing left: hand back the brief rather than a stub.
	// Falling back UP a level (arrival → brief → full) is the same rule the rungs
	// themselves follow, and it means a describeZone change can make this too
	// talkative but never silent.
	if (!kept.length) return briefRoom(html);
	return kept.join('\n');
}

// THE FIRST-ARRIVAL EXCEPTION IS GONE, and so is the Set that tracked it.
//
// It said: your first arrival at a room is full, because you have never read
// that prose and abbreviating it would hide content rather than repeat it. That
// was the right rule while a move was still a description. Now a move is a line
// and a description is something you ASK for — and the room you have never seen
// is precisely the room you would type `look` in, so the exception was spending
// a whole paragraph to pre-empt a command the player was about to type anyway.
//
// Deleted rather than left unread: it was a per-session Set on the live player
// object, written on the every-move path, and state nothing consults is exactly
// the kind of thing that gets re-consulted later by mistake.

export const _test = { briefRoom, arrivalRoom, KEEP, DROP, VITAL, TALLY, ARRIVAL };
