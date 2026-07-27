# The Cold Open & the CODEX (as built)

Two halves of one thing: the ~75 seconds of backstory a new player is shown
before they can do anything, and the tablet app that holds the rest of it for
whenever they want more.

> Naming: **CODEX (the tablet app)** is unrelated to the **CODEX deploy pipeline**
> ([content-pipeline.md](content-pipeline.md)). The app is in-fiction and
> player-facing; the pipeline is git-as-source-of-truth and never named in game.

---

## 1. The cold open

`client/game/js/panels/intro-cinematic.js` + the `#intro-cinematic` block at the
end of `client/game/styles.css`.

**When.** The prologue's `player.login` handler
(`plugins/prologue/index.js`) fires exactly once, on a first login into
`zone_the_inbetween`, and pushes `{ type: 'intro_cinematic' }`. **It schedules
none of the arrival prose.** The client plays the sequence and echoes the silent
verb `introdone`, which calls `beginArrival(player)`. A `setTimeout` fallback
(`INTRO_FALLBACK_MS`, 110 s) calls the same function if the echo never comes, so
a stale client bundle degrades to the old behaviour instead of stalling the
prologue. `beginArrival` is claimed synchronously via
`player._prologueArrivalStarted`, so the echo and the fallback racing is harmless.

**The start gate — the sequence does not auto-play.** The overlay mounts showing
a single black card with a **Begin** button, and the canvas, the audio context
and every beat timer are held behind it (`runSequence()` inside
`playIntroCinematic`). This is not a courtesy: browsers suspend an `AudioContext`
created without a user gesture, so the auto-starting version came up **silent**
for most first-time players — the one impression there is no second go at. The
click is the gesture, and the context is built on the far side of it. Enter/Space
*begin* while the gate is up and only *skip* once it's running; Escape always
skips; the Skip button sits above the gate (`z-index: 5`) so the whole thing is
escapable from the first frame. The gate **auto-begins after 20 s** so a player
who tabbed away can't be stranded — which is why the server fallback above is
110 s and not 78: it has to clear the wait *plus* the full run, or the arrival
prose lands behind the overlay and scrolls past unread. **Those two numbers move
together.**

**Nothing is said until the interface question is answered.** `beginArrival`
sends `tour_offer` and, if the question hasn't been answered before, **returns** —
the arrival prose lives in `speakArrival()`, which the prologue's `tutorial` verb
calls on `no` (skip the tour) or `done` (walkthrough over, however it ended). The
client dims the entire interface behind the question (`#tour-offer-veil`), so a
first-timer has exactly one lit object and one decision. `tour.js` now signals
`tutorial done` on a **skipped** tour as well as a finished one — that echo is
load-bearing, not bookkeeping, and without it a player who hits Esc on step 2 is
left in a silent room. Two belts on the braces: `speakArrival` claims itself with
`player._prologueArrivalSpoken` and refuses to speak outside The Inbetween (so a
veteran replaying `tutorial` isn't told they don't know how they got here), and a
480 s fallback releases the prose if the question is never answered at all.

**What.** A black field, a canvas, one line of mono text at a time, and a DOM
wordmark at the end. The canvas is **one 3D scene** (a single pinhole `proj()`;
no libraries, no matrices) run through five phases against **one** node field —
`lattice` (a drifting volume, linked by 3D proximity) → `tighten` (the same nodes
pulled onto a regular cubic lattice; the reach shrinks past the cube diagonal so
the cloud becomes wireframe cubes on its own) → `shatter` (blown outward under
torn scanlines) → `void` (nothing, drawn as nothing) → `city`. The nodes are
never replaced, only rearranged, because that is the story the text is telling.
Link brightness pulses on each BEAT's arrival, so the animation runs on the
story's clock rather than its own.

**The flythrough is the real Coldwater.** The `city` phase is not a procedural
skyline — it is the actual building tiles off `map_world`, with the same
footprints and floor counts the flight sim extrudes out of a cockpit windshield
(both read `client/shared/skyline-scale.js`; see § "Where the skyline comes
from" below). Three overlapping movements: every building gets **one node**,
which flies in from high and far and lands on that building's **rooftop** — the
lattice becoming the city, one point at a time, each point now with an address;
where a node lands a **wireframe box grows downward** from it to the ground (the
building hangs off the node rather than rising to meet it, because the node is
what decided it should exist); then the **lights come on** inside, floor by floor
(one light in thirteen burns the lattice's own colour). It stays a wireframe the
whole way — no filled walls — so you see the far side of every tower and every
light through every other light. A solid city is a place; a wireframe city is a
*model* of a place, held by something still deciding.

Then the camera **flies through it**: down out of the sky, levelling to rooftop
height and running the length of the city and out the far side, weaving and
banking a couple of degrees. It never stops, which is what lets the wordmark land
over it without anything having to finish. `proj` clamps `rz` so it can't divide
by zero, which means geometry *behind* the lens comes back mirrored and smeared
rather than absent — so `behind()` culls per building, per edge and per light.
That guard is invisible until the camera moves and mandatory afterwards.

**The wordmark** (`LOGO_HTML` + the `.intro-cine-logo` CSS block) is the last
beat: the A-mark draws itself on stroke by stroke — two legs, a crossbar, a
spine, a node at every vertex, the same vocabulary the canvas has been speaking —
then ARCHITECT's tracking closes from wide to set, a rule wipes out, and a
welcome plus a line of small print arrive. DOM rather than canvas so the type
stays crisp at any DPI. It is still on screen through the closing dissolve, so
the logo melts into the game instead of being cut away (`.closing` is 1500 ms;
`.closing.fast`, used only on a skip, is 380 ms).

**Audio** is procedural Web Audio built in the module and deliberately simple —
sustained pads over a sub drone, a bed of looped filtered noise as room tone, six
bell tones in seventy seconds, three noise hits on the cuts. The chord
accumulates in A minor and **resolves to A major under the wordmark** (a picardy
third: forty seconds of dread, resolved on cue, because the brand is arriving).
It reads `loadSettings()` and does not start at all when audio or music is off,
and it ramps to zero rather than stopping (no click on skip). The gain is
scheduled to **actual silence** across the `Silence.` beat.

**Skip** is loud for six seconds, then recedes to a dim button that stays
clickable forever. `Esc` / `Space` / `Enter` also end it. Clicking the field
does **not** skip — it brings the skip button back to full strength, because a
stray click in the first ten seconds would throw away the whole point.
`prefers-reduced-motion` (and the app's `[data-motion="off"]`) drops the canvas
to static frames and keeps the text.

**Where the skyline comes from.** `coldwaterSkyline()` in
`plugins/prologue/index.js` builds a manifest of `{ x, y, t, f }` — tile coords,
`flags.building_type`, `flags.floors` — from the **already-in-memory** zone Maps
(`getAllZones()`), filtered to `map_id === 'map_world'`, `flags.building_type`
set, and `flags.region_id === 'region_coldwater'` (with a `grid_y > 960` belt for
tiles authored before regions). **69 buildings, ~2.7 KB**, built once and cached
forever, because world geometry doesn't move. It rides along on the
`intro_cinematic` push, because the flight sim's `mapWindow` only ships to
someone already in a seat and this is a player's *first login* — they haven't got
a body yet. No query, no tick, no DB read on the login path.

The client falls back to a procedural block grid **in the same shape** when the
manifest is absent (an old server), so there is exactly one renderer. That
fallback is also why `plugins/prologue/regress.js` asserts the manifest is
non-empty and actually Coldwater: a content edit that emptied it would silently
degrade to the stand-in and nobody would ever notice.

Heights and footprints come from `client/shared/skyline-scale.js` —
`TYPE_FLOORS`, `FLOOR_Z`, `BUILDING_FOOT`, `floorsFor()`. These **used to live
inside windshield.js**; they moved because a first-login path must not import the
~8000-line flight renderer to find out how many storeys a hotel has, and because
the two views of the same city must not drift. windshield.js imports them and
re-exports `BUILDING_FOOT` (cockpit.js's collision sweep imports it from there).
The cold open applies exactly two art liberties on top, both local to
intro-cinematic.js: a `STRETCH` on storey height (the flight sim's storeys are
short because its camera is a thousand feet up; at street level they need to be
tall) and a 90° rotation of the city into the scene, because Coldwater is a wide
shallow band (35 tiles × 13) and the long axis is the only one you can fly down.

**Replay** is the `intro` verb, any time, anywhere — it re-sends the manifest too.

Timing lives in one place: `BEATS` (each `{ t, hold, text }`), the `P_*`
constants that `PHASES` is built from, `LOGO_AT`, and `RUN_MS` as the total. Each
phase measures its own progress from its `P_*` constant — an earlier version
measured from hardcoded offsets that had drifted out of sync with `PHASES`, which
is why the tighten never completed. Editing the script means editing those and
nothing else.

---

## 2. The CODEX app

`plugins/tablet/codex-app.js` + `plugins/tablet/codex/*`, rendered natively by
`client/game/js/panels/tablet-os.js` (view `codex`).

**This app replaced the standalone Ideology app.** `plugins/tablet/ideology-app.js`
is gone; its `buildScreen` moved verbatim to `codex/section-orders.js` and its
payload shape is unchanged, so the alignment charts, rep ladders and swipe paging
in the client are the same instrument reached through a different door.

### Sections

The app is a **shelf**, and each section is a volume on it
(`codex/sections.js`, `registerCodexSection`). Sections are **typed** rather than
uniform, because they don't render alike:

| id | kind | what it is |
|---|---|---|
| `quiet` | `chapters` | **Before the Quiet** — how the old world ended (Volume I) |
| `basin` | `chapters` | **The Basin After** — corps, the orders, chrome, flesh, mind, the Architect (Volume II) |
| `orders` | `orders` | the former Ideology reader: compass, standing, per-order pages |

Adding a volume that reuses an existing kind is one `registerCodexSection` call
and **no client change**. A genuinely new kind needs a renderer in `tablet-os.js`
(`renderCodexVolume` / `renderIdeology` are the two that exist).

Nav is ordinary tablet nav: `tabletnav codex <sectionId>`. The verb **`codex`**
opens the shelf directly (`codex orders` jumps straight to a section).

### Chapters

`codex/chapters.js` — authored prose, deliberately **not** content-pipeline data:
one fixed text every player reads, with nothing for a builder to edit, same
rationale as the prologue's welcome broadcast living in its plugin. A chapter's
`body` is an array where a string is a paragraph, `{ pull }` a pull quote, and
`{ break: true }` a rule.

Volume I is played straight — it's the one place in the game where nobody winks
([story.md](story.md)). The joke resumes the moment the player is holding a bat.

### Unlocking

One player flag per chapter, `codex_ch_<id>` (`codex/unlocks.js`). No table, no
`players` column. Three ways a chapter opens:

1. **`grantVolume(player, 'quiet')`** — the prologue hands Volume I over whole
   when the welcome broadcast ends, because the cold open *is* that volume.
2. **World events** — `vendor.purchase` opens *The Inheritance*; entering
   `zone_under_conduitvlt` / `zone_under_machsump` opens *What It Wants*.
   **Derived** unlocks are evaluated when the app is opened (a cold path, no
   tick): stance or any path ≥ 20 opens *The Four Answers*, and
   `path_machine`/`path_flesh`/`path_mind` ≥ 30 open *The Chrome Question* /
   *The Mutant Question* / *The Quiet Frequency* respectively.
3. **`CODEX_UNLOCK` `{chapter, quiet?}`** — a registered action, so any VINE
   dialogue option or script node can hand a chapter over when an NPC explains
   the thing it's about. **This is the primary route** and the reason the other
   two are kept deliberately thin.

### Who explains what (authored)

Every Volume II chapter has a mouth. Authored onto `npcs.dialogue_tree` — flat
action params (`{"action":"CODEX_UNLOCK","chapter":"…"}`), per the VINE dialogue
convention that `server/engine/dialogue.js` reads with `a.params || a`; a nested
`params` object would silently do nothing.

| Chapter | NPC | The beat |
|---|---|---|
| The Inheritance | **Custodian-Adjunct Wren** | asked who she works for — she names a company she has never found, and is comforted that someone up there still rejects her requisitions |
| The Four Answers | **Maresh, Ascendant Recruiter** | asked to describe his rivals, which he enjoys; drops the salesman exactly once, on certainty |
| The Chrome Question | **Dr Sable Kesh** | asked where the designs come from — she doesn't know, has decided that's enough *on purpose*, and only then mentions the drift |
| The Mutant Question | **Grease** | asked what happened to his arm; fallout kills, it doesn't do *this* |
| The Quiet Frequency | **Oracle-9** | refuses the claim ("I don't do anything. I notice."), which is what makes her the one worth listening to |
| What It Wants | **Claude Merrin** | a records man on the one decision with no record behind it: it kept a city, not a vault |

The pass that wrote them is `scripts/content/author-codex-dialogue.mjs` —
idempotent and re-runnable, kept as the record of the edit. The NPC JSON under
`content/npcs/` is the source of truth now; edit there (or in VINE), not in the
script.

**Guarded by regress**: `plugins/tablet/regress.js` scans the *live* NPC trees
and fails if a sealed chapter has no way in, if any sealed chapter has no NPC who
explains it, or if a dialogue tree unlocks a chapter id that doesn't exist (a typo
would otherwise be a silently dead conversation branch).

A locked chapter ships its **hint and nothing of its body** — the prose never
reaches a client that hasn't earned it, so the payload isn't a walkthrough. The
client draws it as redaction bars plus the hint.

`unlockChapter` is idempotent and prints its discovery line only on the
transition, so an NPC who explains the same thing twice says it once.

### Still open

- No admin verb for granting/revoking a chapter; use the action or the flag.
- The six authored conversations are each a single branch off the NPC's root.
  None of them are gated on relationship tier or standing, though several would
  land harder if they were (Kesh's drift admission and Grease's arm both read as
  things you'd earn) — `{ "relation": "known" }` on the option is the seam, see
  [systems-relationships.md](systems-relationships.md).
