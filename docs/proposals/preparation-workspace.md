# Preparation Workspace — a text HUD over the cooking simulation

> **Status: ALL SIX PHASES BUILT.** `plugins/workspace/`, the `kitchen`
> provider in `plugins/cooking/workspace.js` and the client panel ship and are
> regress-gated: the panel renders Storage / Preparation Area / Components / Tools /
> Recipe Assistant / Status, every component carries the **context actions** that apply
> to it (each a literal verb string checked against the live command registries), and the
> Assistant scores **the recipes you know** against what's in the room, and
> `prepare <recipe>` runs a re-validating plan that gathers one. **Phase 5 (player
> recipes) shipped in the cooking plugin** — see its README for improvised dishes,
> `recipe save/rename/write/teach`, and why `masterful` stays out of reach of
> improvisation. **Phase 6** added a second provider, `chembench`, with no change to the
> workspace plugin or its client panel. Where this doc disagrees with
> [plugins/cooking/README.md](../../plugins/cooking/README.md), the README wins — it is
> as-built and this is not.

---

## Why

Cooking is finished and it is deep. `plugins/cooking/` is ~7,400 lines: ingredient
profiles, signature-matched dishes, staging, burner curves, fond, five prep verbs that are
each a trade, quality bands, a cookbook learned by repetition. None of that needs changing.

What it costs is **typing**. A stew is a dozen lines:

```
open cabinet
pull pot
stow rat haunch in pot
stow potato in pot
stow soup base in pot
cook pot
stove low
stir pot
...
plate pot
```

Nine of those twelve are inventory logistics. The three that are actually *cooking* —
choosing the burner, choosing the moment to stir, choosing when to plate — are buried in
them. `mise` ([plugins/cooking/index.js:1169](../../plugins/cooking/index.js#L1169)) is the
one place today where the whole preparation area is legible at once, and it is flat text
with no way to act on it.

The Preparation Workspace is a **floating text HUD that makes the preparation area
manipulable**. It is not a crafting menu, not a graphical inventory, not a recipe wizard,
and not a fake operating system.

## The rule that shapes everything below

> **The HUD contains no gameplay logic. Every action it offers resolves to a verb string
> that a player could have typed, dispatched through `handleCommand`.**

If a thing cannot be done by typing, the HUD cannot do it either. If a thing can be done by
typing, the HUD does it *by typing it*. There is no second code path for the same mechanic
and there is no mechanic that exists only inside the interface.

That rule is what makes this a plugin rather than engine code, by the litmus tests in
[engine-plugin-boundary.md](engine-plugin-boundary.md): it is a *system* built on
substrates, it registers no law, and unloading it removes a convenience and nothing else.
It is also what keeps the panel honest — a player who never opens it plays the same game.

---

## Architecture

Two plugins and one client panel.

### `plugins/workspace/` — domain-agnostic

Owns the `workspace` verb (alias `bench`), the provider gather, payload assembly, and —
from phase 2 — action dispatch. Knows nothing about food, heat, or vessels.

A domain verb may also BE the way in: a bare **`cook`** in a room with a stove (and no
chem lab) opens the kitchen HUD instead of answering "Cook what?", by calling the exported
`cmdWorkspace` with the `kitchen` provider. Naming a food station — `cook stove` — does the
same. `cook <thing>` is untouched, and a bare `cook` at a lab still routes to synthesis.

**As built**, a provider is contributed through the `workspace.provider` gather-hook
rather than an imported registry function, so neither plugin depends on the other loading:

```js
// plugins/cooking/index.js  hooks
'workspace.provider': (player) => workspaceProvider(player),
// → { key: 'kitchen', label, priority, build(player) }  |  undefined
```

Detection happens inside the hook and must be **in-memory and free** — `workspace` is a
verb somebody will type in the street, and finding out the answer is "no" must not cost a
round trip. `priority` settles a room that is two workspaces at once (ties break on `key`),
the same ambiguity `cook` already has to settle in a room holding a stove and a chem lab
([plugins/cooking/README.md](../../plugins/cooking/README.md), "The shared `cook` verb").

### `plugins/cooking/workspace.js` — the `kitchen` provider

Where all food knowledge lives. Imports from its own plugin's existing pure modules and
adds no simulation of its own.

**How a player finds the HUD at all (as built).** The verb worked from day one and was
completely unfindable — you had to already know it existed, which is the invisible-content
case the regress's layer 1b was written for. A range, a microwave or a dish cabinet now
**advertises `workspace` on its own examine**, via declaration-only specialized actions
(`handler: null`) gated on `stove_tier` / `microwave` / `dish_cabinet`.

**Cooking declares them, not the workspace plugin** — and that placement *is* the seam rather
than an accident. Those three flags are cooking's vocabulary; the workspace plugin knowing
them would undo the whole point of joining the two through a gather-hook. They are also
exactly the flags `workspaceProvider` gates on, so the advertisement can never offer a
workspace the provider would then refuse.

The chem bench does the same thing by a different route: `plugins/synthesis` already has a
`furniture.describe` **hub** — one place that says what the bench is for — so the link joins
that list instead of registering a second one beside it. Two answers to one question is worse
than either answer.

### The client

- `client/game/js/panels/workspace.js`
- markup in `client/game/index.html` (`#workspace-panel`)
- a `wsp-` block in `client/game/styles.css`

Monospace, box rules, tables, bars, colour-coded text. No icons, no drag-and-drop, no
rounded cards. The container panel's split of **id-based structure + a short class prefix**
(`#container-*` / `.ctr-*`, [styles.css:3749](../../client/game/styles.css#L3749)) is the
convention to copy.

**There is no `textgames` variant, and there must not be.** The HUD is a *panel* by the
Display Mode test — delete it and you are not stuck, every action on it is a verb you could
type — so only the `log` rung changes it, where it re-renders rather than suppresses
([systems-display-mode.md](../systems-display-mode.md)). The second reason is specific to
this surface: **the visual form already IS the text form.** A middle-rung variant would be a
monospace re-implementation of a monospace panel, which is the duplicate implementation this
whole layer exists to avoid.

Four presentation rules the built panel settled on, each of which had a wrong answer first:

- **Status lives in the header, not the foot.** It is the shortest block and the one most
  likely to decide whether you can start at all; a cut supply belongs where you look first,
  not below a screenful of recipes. It does not scroll — the body does.
- **The first action on a row stays legible at rest**, the rest surface on hover. The strip
  exists to TEACH the verb, and one that is invisible until hovered teaches nothing to
  somebody reading down the page, or to anybody on a touchscreen.
- **The marker is the whole signal.** A row a recipe would use is marked in the gutter and
  is *not* recoloured as well — that second colour is exactly the "twenty things of subtly
  different shades" the gutter was introduced to avoid.
- **With several recipes open the markers carry ordinals** (`▸1`, `▸12`). The highlight is a
  union computed per recipe, so it always slightly overstates; numbering it says *which*
  recipe wants the onion rather than leaving an honest-but-mute union to be guessed at.
  Ordinals follow the order you opened them in, so opening a third cannot renumber the two
  you are reading.

---

## The wire contract

Copy the container panel exactly. It is the proven seam.

| Step | Container panel (as built) | Workspace |
|---|---|---|
| Build | `buildContainerView()` [inventory.js:1188](../../server/engine/commands/inventory.js#L1188) | `buildWorkspaceView()` |
| Message | `{ type: 'container_view', … }` | `{ type: 'workspace_view', … }` |
| Error | `container_error` | `workspace_error` |
| Route | [dispatch.js:495](../../client/game/js/dispatch.js#L495) → `openContainerPanel` | → `openWorkspacePanel`, refresh-if-open per the `wardrobe_view` shape at dispatch.js:503 |
| Panel → server | `sendCmdSilent` [net.js:112](../../client/game/js/net.js#L112) | same |
| Refresh | client re-issues `opencontainer <id>` after `stow`/`pull` (dispatch.js:523/531) | client re-issues `workspace` after any action |
| Decorate | `fireHook('container.view', …)` inventory.js:1218 — how `plugins/wardrobe` retypes the view | `fireHook('workspace.view', …)` |

**No new push channel in v1.** The client re-asks; the server never volunteers. If live
burner readouts or a ticking cook timer later justify unsolicited refreshes,
`sendToPlayer` ([messaging.js:22](../../server/engine/messaging.js#L22)) is the upgrade
path, and `plugins/gametable/game-table.js:678` is the working precedent for pushing a
whole rendered pane. Adding it is a decision to take deliberately, not a default — an
unsolicited refresh per second per cooking player is a real cost.

### Payload

```js
{
  type: 'workspace_view',
  provider: 'kitchen',
  title: 'PREPARATION WORKSPACE',
  providers:  [ { key, label } ],                                     // what else this room is
  storage:    [ { id, name, preserves, items: [Component], other } ], // `other` is a COUNT
  area:       [ { id, name, place, heat, hot, idle, contents: [Component] } ],  // vessels + free burners
  components: [ Component ],                                          // loose, on you
  tools:      [ Component ],
  status:     [ { label, value, state: 'ok'|'warn'|'off' } ],
  assistant:  { groups: [ { label, recipes: [Recipe] } ] } | null,    // phase 3
  empty:      Boolean,
}
```

```js
Component = { id, name, qty, kind, state, notes: [String], live, cook, actions: [Action] }
cook      = { phase: 'thaw'|'cook'|'window'|'over'|'burnt', stage, stages } | null
Action    = { label, command, hint }     // command is the literal verb string
Recipe    = { key, name, known, pct, missing: [String], suggestion, command }
```

**`cook` is a BEAT, never a clock.** It is which stage of the prose beside it the food
has reached — the same index `checkCooking` picks the words from, so the pips and the
sentence can never disagree — and past the finish it stops counting and reports a
state (`window`/`over`/`burnt`) instead. There is deliberately no percentage and no time
remaining: **deciding when to plate is the single largest quality lever in the kitchen**,
and a countdown would play that half of the game for the player. The panel is allowed to
say how far along; it is not allowed to say how long.

**`idle` marks a piece of the working area standing empty** — a burner with nothing on
it. *"Is there a ring free"* is one of the questions the HUD exists to answer at a glance,
and the only answer used to be an aggregate `1/2 in use` at the foot of Status, which says
a burner is free and not **which** in a kitchen whose rings cook at different tiers. An
idle row carries no actions, because every verb that uses a burner names the FOOD
(`cook steak`) and never the stove. ⚠ **It must not count towards `empty`** — otherwise a
kitchen holding nothing but a cold stove stops reading as bare.

**Every actionable entry carries the command string, not an opaque id.** That is not a
stylistic choice — it is the enforcement mechanism for the rule above. A reviewer can read
the payload and see that the HUD can only ever do what a player could type. It also means
the panel needs no verb knowledge at all.

---

## Panels, and what each is built from

Nothing below is new simulation. The right-hand column is the existing code.

| Panel | Source |
|---|---|
| **Storage** | **The one new read** (as built, `plugins/cooking/workspace.js`). A **cold** box lists only `perishable` items — a fridge is not a cupboard, and the reason to open one is the food that would otherwise spoil. The same filter applies to the container panel's stow column (`invNote` says how many were hidden); it is a FILTER, never a law — `stow` itself is untouched, so a pistol can still go in the freezer if you type it. The room's boxes come from in-memory `getZoneFurniture` filtered on `object_type === 'container'` — zero queries. Their contents are one `UNION ALL`: rows parented to a box, **plus rows parented to those rows**, because a pot left in a cabinet holds its contents on itself and a plain join stops at the pot. Only kitchen-relevant items are listed; the rest is a bare count (`other`), so a fridge of beer doesn't turn the HUD into an inventory screen. The cold tier is `furniture.flags.preserves` (a furniture container carries its tags on `flags` — that's what `loadContainerById` hands back as `tags`) |
| **Preparation Area** | `cmdMise`'s vessel set + `placeOf` + the live burner tier from `cooksOnAppliances` ([cook.js:78](../../plugins/cooking/cook.js#L78)) — an in-memory Map read, no DB, no await |
| **Components** | `describeVessel` (cooking/index.js:1672) for what's in each pan; the loose-ingredient block for what isn't; `checkCooking`, `prepText`, `portionName` for state |
| **Actions** | `availableActions(entity, viewer)` ([specializedActions.js:56](../../server/engine/specializedActions.js#L56)) for tag-gated verbs, **plus** a provider profile→verb map for the ordinary commands the registry does not cover (`chop`, `mince`, `score`, `tenderise`, `marinate`, `butter`, `stir`, `flip`, `taste`, `plate`, `deglaze`, `scour`, `stove low|mid|high`) |
| **Recipe Assistant** | `DISHES`, `signature()`, `matchScore()` ([dishes.js:756/812](../../plugins/cooking/dishes.js#L756)) run against storage ∪ area; `cookbookState()` ([knowledge.js:36](../../plugins/cooking/knowledge.js#L36)) for known vs not; `ingredientLine` / `methodLines` / `describeDish` for the prose |
| **Status** | `getZoneFurniture` + `flags.stove_tier` (in-memory), grid power read the way `plugins/preservation/decay.js:31` reads it, ambient temperature from weather |

### Context actions are server-authored, and that is the point

The container panel today hardcodes a client-side tag→verb table (`ITEM_ACTIONS`,
[container.js:220](../../client/game/js/panels/container.js#L220)). That works for seven
generic verbs and would be unmaintainable for cooking, where what you can do to an onion
depends on its profile, its prep flags, whether it's in a pan, and whether the pan is on
heat. The workspace ships the action list **in the payload**, computed server-side, so the
client holds no verb knowledge and a new prep verb appears in the HUD the day it is
registered.

**Gates are coarse, and must stay coarse** (as built). A provider decides what to *offer*
from cheap structural facts — profile family, raw/cooking/cooked, whether the tool is in
reach. Those are not the verb's real preconditions: `score` alone checks scored, minced,
on-the-heat and already-cooked. Re-deriving that in the provider would be a second
implementation of the exact thing this layer exists not to duplicate, and it would drift
the first time somebody tuned the verb. The HUD proposes; the verb decides. The worst case
is an offered action that answers *"it's already scored"* — a true sentence, and a better
teacher than a button that quietly wasn't there.

Two conventions fall out of it: a `command` ending in a space is a **prefix** for a verb
that wants a second object the HUD can't choose (`marinate steak in …`), and the client
fills the input line rather than firing it; and clicking an action uses `sendCmd`, not
`sendCmdSilent`, so the command **echoes into the log as though it were typed**. That is
the teaching mechanism, and the reason the panel doesn't make the verbs redundant.

### Cost budget

Per the [read tiers](../architecture.md#read-tiers-where-data-lives-at-runtime):

- **One workspace build = two queries.** Player inventory (the `cmdMise` query, one round
  trip for everything the player carries) and the zone-storage scan. Both are `id = ANY`
  /`JOIN` shaped — never a query in a loop.
- **Zero** for appliances, burner state, power and stove tiers — all in-memory world state.
- **Zero** for the cookbook when flags are hydrated ([flags.js](../../server/engine/flags.js)).
- **Zero writes.** The build is derived, exactly as `examine` on a cooking steak is derived
  (plugins/cooking/README.md, "No tick, no polling"). Twenty builds cost what twenty
  examines cost.
- **No tick.** The HUD schedules nothing.
- Every action is one existing command, with whatever writes that command already made.

The panel is not a hot path — it opens when a player asks and refreshes when they act —
but two round trips per refresh is the ceiling, and a refresh-per-action loop is the reason
that ceiling matters.

---

## Reservation: the recommendation is *don't*

The brief asks for objects to be "reserved rather than physically moved" for multiplayer
safety. Before designing that, here is what the codebase actually does today:

| System | What it does instead of locking |
|---|---|
| `plugins/trade` | **Explicitly refuses escrow.** "Nothing is escrowed — staged goods stay in your inventory until the swap, and the transaction re-validates ownership at execute" ([trade/index.js:10](../../plugins/trade/index.js#L10)) |
| `plugins/crafting` | Consumes at commit. "Nothing has been consumed at this point — the craft simply never happened" (crafting/index.js:144) |
| `plugins/storefront` | Transfers ownership to a synthetic holder `_shopstock_<zoneId>`. The *move* is the lock |
| `plugins/gametable` | Seats in memory; chips are moved |

**There is no soft-lock on a `player_inventory` row anywhere in the game.** The only
occupancy state that exists is furniture-level: cooking's `furniture.flags.busy_until` +
`flags.vessel_id`, written together at [cook.js:233](../../plugins/cooking/cook.js#L233)
and cleared in `freeAppliance`.

### So: "Prepare Recipe" is a plan, not a claim

Selecting a recipe and hitting *Prepare* should **compute an ordered command list and run
it, re-validating at each step** — precisely how trade re-validates at execute:

```
Preparing Workspace...

  pull pot from cabinet          ✓
  stow rat haunch in pot         ✓
  stow potato in pot             ✓
  stow soup base in pot          ✗  soup base — not there any more

Prepared 3 of 4. Stopped.
```

If a housemate took the soup base between the scan and the run, step 4 fails with the
ordinary error the verb already produces, the HUD reports it, and the player deals with it.
That is the correct multiplayer behaviour and it costs **zero new state**.

**As built**, two rules in the runner and one in the planner:

- **Stop on the first failure.** Ploughing on leaves half a recipe in a pan and a player
  who has to work out which half.
- **Never answer a prompt.** A step that raises a SIFT disambiguation hands it back and
  stops the run — a runner that picked for you would be making the choices the game
  deliberately asks a human to make.
- **The plan stops at a loaded vessel and does not cook.** Heat is where the skill is —
  which burner, when to turn it, when to plate — and a HUD that pressed those buttons
  would be playing the interesting half of the game for you.

The alternative — `custom_data.reserved_by` plus an expiry — is rejected for v1 because
every path that moves an item would have to honour it, which is the same
"grep every writer before you trust it" trap that keeps `furniture` and `npcs` uncached
([architecture.md](../architecture.md)). A reservation nobody checks is worse than none;
a reservation everybody checks is a change to every inventory verb in the game. If a real
need for it appears later, it belongs in the engine as a substrate with one write funnel,
not bolted to a HUD.

---

## Recipes assist; they never drive

The cookbook rule already in force — **knowing a recipe never gates cooking it**
(plugins/cooking/README.md, "The cookbook") — extends unchanged. The Assistant:

- scores every dish template against what is in the room,
- sorts into **Available Now / Nearly Available / Missing Ingredients / Missing Equipment /
  Not Known**,
- shows a completion percentage and the specific shortfall,
- offers a *suggested next step*, which the player is free to ignore, invert, or replace.

```
Chili                  96%   need   one aromatic
Lasagna                74%   need   ricotta, lasagna sheets
Meat and potato stew  READY  11/11
```

Suggesting `dice onion` must never prevent `mince onion` — and in this system that
substitution genuinely matters, because mincing costs two rungs off the ceiling forever
(plugins/cooking/README.md, "Prep"). The Assistant surfaces the trade; it does not make it.

### It shows only the recipes you know — and that is load-bearing (as built)

The original brief sorted *every* recipe into Available Now / Nearly Available / Missing.
Building it surfaced a direct collision with a decision the cooking system already made:
the Cookbook app is **deliberately blank** about the half of the catalog you haven't
discovered, *"because a checklist of exact ingredient counts would turn discovery into
data entry."* An Assistant listing all 47 templates with their exact shortfalls is that
checklist, delivered faster — it would quietly kill discovery, which is the mechanic the
whole dish system is built to reward.

So the Assistant scores **known** recipes against what's in the room and reports the rest
as a bare count, ending on the same sentence the Cookbook app does. A regress case asserts
an undiscovered dish is never named in the payload. Nothing else about the brief changes:
a player can still cook anything, and still discovers new dishes by making them.

Two consequences worth stating:

- **It plans; it does not execute.** A pot in the cabinet counts toward equipment even
  though `stow x in y` can't reach into a cabinet — "you own a pot, it's in the cupboard"
  is the answer somebody wants at this stage.
- **A finished dish is never an ingredient**, nor is anything already on the heat.
  Counting either would promise a stew you'd have to dismantle dinner to make.

Completion is scored against **the matcher's own tolerance-adjusted lower bound**
(`UNIT_TOLERANCE_LOW`), so the Assistant can never say *ready* about a pan `matchScore`
would reject, or the reverse.

Freeform stays first-class. *New Preparation* opens an empty area and the player fills it
with anything — including motor oil and mutagen. Unmatched combinations still resolve
through `UNKNOWN_DISH` to slop capped at `acceptable`, which is the existing teaching
mechanism and remains reachable from the HUD, because the HUD only ever types `plate pot`.

### Player-saved recipes

A saved recipe is **a replayable command list**, which is exactly why it can never become
a crafting formula.

Storage extends the cookbook rather than adding a table: a `recipe:<slug>` `player_flags`
row holding `{ name, vessel, steps: [String], notes }`, sitting beside the existing
`cookbook:<key>` and `cookprog:<key>` keys
([knowledge.js:22](../../plugins/cooking/knowledge.js#L22)) and written through
`setFlagById` ([flags.js:142](../../server/engine/flags.js#L142)). **No new `players`
column**, per the core rule in [CLAUDE.md](../../CLAUDE.md).

---

## Future reuse

The provider seam is the reason this is worth building as two plugins instead of one. A
chemistry bench, a gunsmith bench, a tailoring station or a repair bay registers a provider
and gets the same HUD: the same panels, the same payload, the same client, the same rule
that every action is a verb the player could type. What differs is the components, the
tools and the action map.

**As built**, that second provider is `chembench`
([plugins/synthesis/workspace.js](../../plugins/synthesis/workspace.js)), and the claim
held: **not a line changed in `plugins/workspace/` or `client/game/js/panels/workspace.js`
to add it.** Reagents, tiers, a station-quality bonus, a shared vault instead of a pan and
a rank gate instead of a discovery gate — none of that leaked upward. What the two
providers share is the shape.

The interesting divergence is the Assistant, and it's the argument for putting domain
knowledge in the provider rather than the panel: the kitchen's **hides** what you haven't
discovered, because discovery-by-experiment is its whole mechanic; the bench's **lists
everything**, because chemistry recipes are gated on rank, so there is nothing to spoil
and a chemist who can't see what the bench does can't plan a buy. Same panel, opposite
call.

Priority settles a room that is both: a stove is 20, a chem lab 15, a kitchen with only a
dish cabinet 10. The header shows a chip for whichever provider didn't win, and clicking
it sends an ordinary `workspace <key>`.

---

## Build order

Each phase ships and is usable alone.

| # | Phase | Adds |
|---|---|---|
| 1 | Read-only HUD — **built** | `plugins/workspace/` + the kitchen provider + the panel. Storage, Area, Components, Tools, Status. No actions. Proves the payload and the seam |
| 2 | Context actions — **built** | Server-authored action lists, dispatched as commands. This is where the typing actually goes away. Gates are coarse by design (see below); a two-object verb ships as a labelled **prefix** that fills the input line rather than a guess |
| 3 | Recipe Assistant — **built** | Completion %, missing lists, sorting, suggested next step. Read-only. Known recipes only — see below |
| 4 | Prepare Recipe — **built** | The re-validating plan runner above. `prepare <recipe>` in `plugins/workspace/`, `planKitchen` in the provider. Stops at a loaded vessel; never cooks |
| 5 | Player recipes — **built** | `recipe:<slug>` flags. Shipped as part of the improvised-dish work in `plugins/cooking/` (`improvised.js`, `recipes.js`) rather than in the HUD — a recipe you invented is a cooking fact, not a panel feature. The Assistant scores them alongside the catalog's and `prepare` resolves them by the name you gave them |
| 6 | Second provider — **built** | `chembench` in [plugins/synthesis/workspace.js](../../plugins/synthesis/workspace.js). **Nothing in `plugins/workspace` or the client panel changed to add it** — which is the whole claim, now tested rather than asserted |
| 7 | The shortfall as a list — **built** | Missing ingredients travel as ROWS (`shortfall`) beside the prose `missing`, and each carries where to buy it. See below |

### The shortfall is a list, not a sentence

`missing` was a bag of English lines joined with semicolons, so a recipe two
ingredients short printed a paragraph — "60g–180g of tomato, cut down — cooked
down hard, before anything else goes in; 90g of cream — in last, off the heat" —
directly under a Components list that reads as a column. Same information, wrong
shape: the question at that moment is *what haven't I got*, and the answer was
buried in the middle of two clauses of cooking advice.

So each shortfall also travels as a row — `{ noun, amount, prep, note, ex, shops,
sold }` — built from **`ingredientParts`**, which `ingredientLine` now composes
its sentence from as well. One derivation, two presentations; the regress suite
sweeps the whole catalog asserting the card's sentence contains the column's
noun and weight, so the two cannot drift. The closed recipe row says only the
nouns ("need tomato, cream"); opening it shows the rows.

**Where to buy it** ([stockists.js](../../plugins/cooking/stockists.js)) is
gated on **`player_npc_relations`, not on a visited-zone record** — there is no
such record, and inventing a per-player table for a HUD hint would be a table
earning its keep once. What exists already answers the better question: a shop is
named at relation tier `known` or above, i.e. one whose keeper you have actually
met. A grocer you've never met reads "a shop you've not met" — true, useful, and
not a map to a district you haven't walked. `getRelation` is sync and hydrated at
login, so the gate costs the panel nothing. The lookup itself is **one cached
query** over `vendor_inventory` (the catalogue, never the rotating
`vendor_stock` shelf, which would claim a grocer doesn't sell tomatoes on a
Tuesday), resolved for the whole panel in a single pass. `sold: false` — nobody
in town stocks it — is the most actionable line on the row, and a failed lookup
answers `null` rather than borrowing it.

## Testing

Per [plugin-standard.md](../plugin-standard.md), each phase adds cases to a new
`plugins/workspace/regress.js` (`export default async ({ run, check, getPlayer }) => {}`)
and to `plugins/cooking/regress.js` for the provider. The load-bearing assertions:

- **A build is derived.** Twenty `workspace` builds and one build return the same payload
  and write nothing — the same invariant the cooking suite already asserts for examine.
- **Every `command` in a payload dispatches** (built). The suite flattens every action in
  a payload and checks its verb against the live registries — `builtinCommandNames()`,
  `getRegisteredCommands()` and `getRegisteredSpecializedActions()`. A HUD that grew a
  private code path fails, and so does one offering a verb that has since been renamed.
- **A plan runner stops on a failed step** and reports how far it got.
- **No provider, no panel.** `workspace` in a room with no registered provider is a plain
  refusal, not an empty HUD.
