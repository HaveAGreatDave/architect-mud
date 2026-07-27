# The Cold Open & the CODEX (as built)

Two halves of one thing: the thirty seconds of backstory a new player is shown
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
verb `introdone`, which calls `beginArrival(player)` — the tour offer plus the
"I don't know how I got here" beats. A `setTimeout` fallback (62 s, longer than
the ~48 s run) calls the same function if the echo never comes, so a stale client
bundle degrades to the old behaviour instead of stalling the prologue.
`beginArrival` is claimed synchronously via `player._prologueArrivalStarted`, so
the echo and the fallback racing is harmless.

**What.** A black field, a canvas, and one line of serif text at a time. The
canvas runs five phases against **one** node field — `lattice` (drifting, loosely
linked) → `tighten` (the same nodes pulled onto a grid) → `shatter` (flung apart
under torn scanlines) → `void` (nothing, drawn as nothing) → `city` (Coldwater's
skyline, windows lighting in a slow cascade). The nodes are never replaced, only
rearranged, because that is the story the text is telling.

**Audio** is procedural Web Audio built in the module: two detuned saws plus a
sine a fifth up, through a lowpass that opens as the escalation builds, with
three noise hits. It reads `loadSettings()` and does not start at all when audio
or music is off, and it ramps to zero rather than stopping (no click on skip).
The gain is scheduled to **actual silence** across the `Silence.` beat.

**Skip** is loud for six seconds, then recedes to a dim button that stays
clickable forever. `Esc` / `Space` / `Enter` also end it. Clicking the field
does **not** skip — it brings the skip button back to full strength, because a
stray click in the first ten seconds would throw away the whole point.
`prefers-reduced-motion` (and the app's `[data-motion="off"]`) drops the canvas
to static frames and keeps the text.

**Replay** is the `intro` verb, any time, anywhere.

Timing lives in one place: `BEATS` (each `{ t, hold, text }`) and `PHASES`
(`{ from, phase }`), with `RUN_MS` as the total. Editing the script means editing
that array and nothing else.

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
