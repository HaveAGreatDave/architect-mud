# Audit Prompt — Verb ↔ Affordance: Is the Verb Discoverable?

A reusable prompt for finding **object-gated verbs the player has no in-world way to discover**. A command
that requires a specific world object to work (furniture / item / NPC) but never advertises itself on that
object's `examine` is, in a MUD, *invisible content* — fully wired on the backend, unreachable in the fiction.
This class of bug is silent: the command works perfectly when you already know to type it, so tests and
manual play by the author never surface the gap. Only a cold player walking up to the object hits it.

The seed instance: **`scrub`** wipes a wanted star at a `police_terminal` furniture
([plugins/surveillance/index.js](../../plugins/surveillance/index.js) `cmdScrub`), but the terminal's flags
are just `{"police_terminal": true}` and `scrub` is a plain command-map verb — not a tag-gated
`specializedAction` — so examine surfaced **nothing** for the terminal. Same for `bribe` / `submit` on the
police NPC. The verb works; the player can't find it.

**Since fixed for the seed case, and the seam widened:** `availableActions()` now also matches
`requiredFlag`, and `registerSpecializedAction` accepts `handler: null` for a *declaration-only* entry — so
a plain flag-gated command can advertise itself without being ported to the dispatch registry (`scrub` is
wired this way). Examine's furniture block also renders its "Actions:" line from **one** place at the end
rather than per-`object_type` branch, so a branch can no longer silently drop a piece's affordances (the
streetlight and dangling-`camera_id` cases did). The audit below still applies — the remaining
`exposed: false` entries across the plugin manifests are the open worklist.

This is a source-of-truth seam like the others in this suite: "**what a command requires**" (an object with
flag/tag X) and "**what an object advertises**" (its examine affordances) are two systems with nothing forcing
them to agree.

## How to run

Paste the prompt below to an agent (or work the checklist). Scope it to one plugin / subsystem at a time —
the value is in reading each object-gated handler against what its object actually shows on examine.

---

## Prompt

> You are auditing the Architect MUD codebase for **object-gated verbs that are not discoverable in-world**.
> Background to internalize first: read the `examine` affordance path in
> [server/engine/commands/world.js](../../server/engine/commands/world.js) (the furniture branches that emit
> `class="action-link"` "Actions:" hints), [server/engine/specializedActions.js](../../server/engine/specializedActions.js)
> (`availableActions(entity)` — the reverse lookup that turns tag-gated `{verb, requiredTag}` registrations
> into examine hints), and [docs/tags.md](../tags.md) (the Tag→Action registry). Note the two — and only two —
> sources examine draws affordances from: the object's `flags.interactions` array, and `availableActions()`.
>
> Audit scope: **<NAME THE PLUGIN OR SUBSYSTEM, e.g. "surveillance / wanted system">**. Do this:
>
> 1. **Find every object-gated verb in scope.** A verb is *object-gated* when its handler only does something
>    in the presence of a specific world object — it queries a furniture/item/NPC by flag or tag, or errors
>    with "there's no ⟨thing⟩ here" when the object is absent. Grep the plugin's command handlers for
>    furniture/NPC/item lookups (`FROM furniture WHERE … flags`, `jsonb_exists(flags,'…')`, `flags?.…`,
>    `hasTag(…)`, on-scene-NPC checks). List each `verb → the object + flag/tag it requires`.
>
> 2. **For each, ask: can a cold player discover it by examining that object?** Trace what `examine <object>`
>    prints. It's discoverable only if the verb comes from (a) the object's `flags.interactions`, or (b)
>    `availableActions(object)` — i.e. the verb is registered as a `specializedAction` with a `requiredTag`
>    the object carries. If neither, the affordance is **invisible**: report it.
>
> 3. **Verify at runtime, don't theorize.** For each suspected-invisible verb, actually drive `examine` on the
>    object (WS client: `{type:"auth",…}` then `{type:"command",command:"examine <object>"}` — see
>    `server/index.js`) or call the examine handler directly, and show that the "Actions:" line does **not**
>    contain the verb. A claim of "undiscoverable" must be demonstrated from real examine output.
>
> 4. **Report**, per finding: the verb · the object + flag/tag it gates on · what examine currently shows ·
>    the minimal fix. Prefer the tag-gated path: give the object a tag and register
>    `{ verb, requiredTag, handler }` in the plugin's `specializedActions` so `availableActions` surfaces a
>    clickable hint automatically (this also unifies the "command needs object" and "object advertises verb"
>    sources onto one registry). If the verb genuinely can't be a specialized action, at minimum add it to the
>    object's `flags.interactions` or inject a visible hint another way. If a gap is intentionally left open,
>    it must be **logged, not silent** — declare it in the plugin's `objectGatedCommands` manifest field (see
>    the regression check below) so it shows up in the reviewed inventory instead of hiding.
>
> Keep changes surgical (per CLAUDE.md) — wire discoverability, don't redesign the command.

---

## Checklist (quick manual version)

- [ ] Read the `examine` furniture branches in `world.js`, `availableActions()` in `specializedActions.js`, and [tags.md](../tags.md).
- [ ] List every object-gated verb in scope (handler requires furniture/item/NPC by flag or tag).
- [ ] For each, trace `examine <object>` — does its "Actions:" line contain the verb?
- [ ] Verb surfaced via `flags.interactions` **or** a tag-gated `specializedAction`? If neither → invisible content.
- [ ] Prove it from real examine output (WS client or direct handler call) before changing code.
- [ ] Fix by registering a tag-gated `specializedAction` (preferred) or adding to `flags.interactions`.
- [ ] Any intentional gap declared in the plugin's `objectGatedCommands` manifest field, not left silent?
- [ ] `npm run test:regress` green (the object-gated-verb discoverability check enforces the contract).

## The contract this enforces

Every object-gated verb is either **discoverable** (surfaced by examine via a tag-gated `specializedAction`
or `flags.interactions`) or an **explicitly logged gap** (declared in the plugin's `objectGatedCommands`
field, `exposed: false`). The regression harness ([tests/regress.js](../../tests/regress.js), Layer 1b) reads
each plugin's `objectGatedCommands` and fails the build if a verb declared discoverable isn't actually wired
into the specialized-action registry — turning "did you close the discovery loop?" from a judgment call into
a test. New object-gated verbs must add an entry; the [verb-discoverability memory] and this audit are the
front-line reminder to do so.
