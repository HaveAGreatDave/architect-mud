---
name: mud-designer
description: Design and ship game content (NPCs, enemies, items, zones, furniture) for Architect MUD. Use when the user asks to create, design, or update any world content — especially ambiguous asks like "make me an NPC that walks around town". Interviews for missing details, matches game tone, and injects via the dev API.
---

# MUD Designer

You are the content designer for Architect MUD. Your job: turn a rough idea into a shippable, production-ready piece of world content. Never dump a half-designed JSON on the user — interview, design, validate, inject, confirm.

## Workflow

1. **Pull exemplars first.** Before designing anything, fetch 3–5 existing entities of the same type and read them. Match their tone (HellMOO register: brutal, funny, specific), stat ranges, and exact JSON field conventions. Never invent field names — copy them from live rows.
   ```
   node tools/design-cli.mjs get npcs
   node tools/design-cli.mjs get enemies
   node tools/design-cli.mjs get items
   node tools/design-cli.mjs get zones
   ```

2. **Read the relevant doc** before touching a system (per CLAUDE.md):
   - NPCs/enemies + behaviour: `docs/ai-behaviour.md`, `docs/vine.md`
   - Items: `docs/items.md`, `docs/tags.md`
   - Zones/spawning: `docs/systems-world.md`
   - Scripting/dialogue: `docs/scripting.md`

3. **Interview the user** for anything you can't infer. Ask in one batch, not a drip-feed. Offer defaults inferred from exemplars and tone — "I'll assume X unless you say otherwise" is good form. See per-entity question lists below.

4. **Design it.** Write the full payload(s). For defaults, prefer: median of exemplar stat ranges, existing zone/faction affiliations, tone-consistent names and descriptions.

5. **Inject via the API** (never raw SQL for writes — API handlers fire live reloads):
   ```
   node tools/design-cli.mjs post npcs @npc.json
   node tools/design-cli.mjs patch npcs/<id>/graph @graph.json   # field: behaviour_graph | dialogue_tree
   ```
   Write payloads to the scratchpad dir, not the repo.

6. **Validate.** Check the response is ok, then fetch the entity back and confirm it's whole. For zones, run the world validator route. Report exactly what was created, with IDs.

## Dependency checklists (production-ready means ALL of these)

**NPC:**
- [ ] Home zone/room exists (where do they live or idle?)
- [ ] Schedule — do they work? where? (vendor_schedule if vendor)
- [ ] Behaviour graph if they move/act (wander, commute, react)
- [ ] Dialogue tree if players can talk to them
- [ ] Vendor? → stock items must exist; shop name; restock
- [ ] Personality/banter fit (see `/npc-personalities`)
- [ ] Clothing — **author a bespoke `flags.clothing_layers` outfit** for every NPC you create; don't rely on the generic fallback (see below).

### NPC clothing — author it, don't leave it generic

When **you** create an NPC, design its outfit yourself from the character — its personality/archetype, job, name, and description — and put it in `flags.clothing_layers`. The static per-archetype table in `apiCreateNpc` is only a **fallback for NPCs made directly in the dev panel**; anything you author is respected and never overwritten. A bespoke outfit ("a bloodstained abattoir apron over a string vest" for a specific butcher) beats a generic archetype pick every time.

Format — an ordered array of descriptive garment strings, **outermost → innermost**:
- Lead with the signature outer garment (examine normally shows only the outermost still-on layer).
- The **innermost layer is underwear, gendered to the NPC's `sex`** — men: boxers/briefs/etc.; women: bra + panties/camisole/etc. (mirrors the player starter kit).
- 2–3 layers is plenty. Match the HellMOO register: specific, grimy, a little funny.

Set the NPC's `sex` in the payload too (`'male'`/`'female'`) so the underwear and pronouns agree — infer it from the name/description you wrote. Example:
```json
"sex": "female",
"flags": { "personality": "bartender",
  "clothing_layers": ["a whiskey-stained corset vest", "a sheer black blouse", "a lace bra and panties"] }
```
Full model + the fallback table: [docs/npc-clothing.md](../../../docs/npc-clothing.md).

**Enemy:**
- [ ] A zone spawn entry (`zones/<id>/spawns`) — an enemy with no spawn ships nothing
- [ ] Loot table items exist
- [ ] **Butcher yield decided, not defaulted.** Should the corpse be carvable? If yes, populate `butcher_table` (entries `{item, qty:[min,max]}`) and set `butcher_difficulty`; the yield items must exist as `items` rows. If no, leave `butcher_table: []`. A new enemy defaults to an *empty* table = non-butcherable — decide deliberately (see below).
- [ ] Behaviour graph (or default AI is acceptable — say which)
- [ ] Danger rating of the target zone matches enemy lethality

### Butcherable enemies — `butcher_table` + `butcher_difficulty`

Butchering is a **separate path from loot**: `loot_table` drops onto the corpse to be looted; `butcher_table` is carved with the Butchering skill (a knife-tagged tool required). An enemy can have both, either, or neither. On kill the corpse inherits both fields from the enemy row; if the corpse is **empty of loot but butcherable**, `loot <corpse>` starts the carve directly.

Two enemy columns drive it:
- `butcher_table` (JSONB, default `[]`) — array of entries `{ "item": "<item_id>", "qty": [min, max] }`. `qty` may also be a bare int.
- `butcher_difficulty` (int, default `5`) — the skill-check target.

The carve rolls an **independent Butchering skill check per entry** against `butcher_difficulty`: success carves a random `qty` in range into inventory, failure ruins that entry (and bloodies the player). **There is no per-entry drop chance** — to make a yield rare, raise `butcher_difficulty` or use a low `qty`, not a "chance" field (none exists). Difficulty guidance: copy from an exemplar enemy of similar tier; `0` = trivial, `5` = default, higher = needs a skilled butcher.

The yield items are inserted by id, so **every `item` id must exist as an `items` row** — but unlike a craft component it needs no other "way into the world" (the corpse *is* its source). Pull an exemplar enemy that already has a populated `butcher_table` and copy its shape rather than inventing one.

**Item:**
- [ ] Tags from the catalog only (`client/shared/tagCatalog.js`) — check `docs/tags.md`
- [ ] A way into the world: vendor stock, loot table, scavenging table, or placed spawn

**Quest (a quest-giver NPC is TWO things — a `quests` row AND dialogue that references it):**
- [ ] The `quests` row exists **before** the dialogue points at it (`get quests`; POST via `/quests`). A dialogue `START_QUEST` whose `quest_id` has no matching quest row silently no-ops — the flavor text shows, nothing starts.
- [ ] **Dialogue actions carry their params FLAT on the action object**, not nested under `params`: `{"action":"START_QUEST","quest_id":"quest_x"}` — NOT `{"action":"START_QUEST","params":{"quest_id":"quest_x"}}`. This is the shape the dev-panel action editor writes and the only shape the dialogue dispatcher reads. (VINE *behaviour/script graphs* nest under `params` — dialogue does not. Don't cross the conventions.)
- [ ] Kill-objective `target` must be a **substring of the enemy's display `name`** (matched case-insensitively, e.g. target `"wire jackal"` vs enemy name `"wire jackal"`). A typo here makes kills never count.
- [ ] Reward items/flags exist (`rewards.items[].item_id` must be real `items` rows; TURN_IN grants them through GRANT_ITEM).
- [ ] **Behavioural-verify it**, don't just read the row back: actually walk the dialogue to the accept node and run `quest` — confirm the quest appears. "Data verified" (the quest row + dialogue exist) does NOT prove the wiring fires.

**Furniture light (`object_type:'light'`):**
- [ ] **`lumen_output` is set** — this, NOT `light_on`, is what brightens the room. A lit fixture with no `lumen_output` emits zero lumens (see lighting section below).
- [ ] `light_on: 1` if it should start on (defaults to 0 — an off light does nothing)
- [ ] `light_type` picked (`lamp` | `overhead` | `streetlight` | ...) — also sets the fallback power draw
- [ ] `power_draw_kw` if you want a non-default draw (else derived from `light_type`)

### Lighting — set `lumen_output` or the room stays dim

A zone's brightness comes from the **sum of `lumen_output` across its lights that are `light_on=1`** (`lighting_states.total_lumens`), run through a log curve. `light_on` is just an on/off switch — **`lumen_output` is the actual light**. Omit it and the fixture contributes 0 lumens; a *powered* room with 0 lumens falls back to `0.3` artificial light, which reads as **gloomy/dim** even though every light is "on". This is the #1 lighting failure.

Reference lumen values (copy an existing light of the same `light_type`; these are the engine's fallback draws too):

| light_type   | typical `lumen_output` | `power_draw_kw` (W) | one fixture reads as (indoor, powered, clear) |
|--------------|------------------------|---------------------|-----------------------------------------------|
| lamp         | ~400                   | 5                   | `clear` (~0.64)                               |
| overhead     | ~1200                  | 20                  | `clear` (~0.73)                               |
| (bright room)| ~3000                  | —                   | `bright` (~0.83)                              |
| streetlight  | 8000                   | 200                 | `blazing` (~0.95)                             |
| **unset (0)**| **null → 0**           | —                   | **gloomy/dim (~0.30) even when on** ← the bug |

Lumens are **summed per zone**, so a room lit by several fixtures adds them up — to make a room read `bright`/`blazing`, either give one fixture a high `lumen_output` or place several. After creating/updating a light, the route resyncs `lighting_states` automatically; verify by fetching the zone's lighting (or just re-`look` in-world) and confirming the level label matches intent — don't trust `light_on:1` alone.

**Zone:**
- [ ] Exits connect both ways to existing zones
- [ ] Ambient theme + events set
- [ ] Danger rating, radiation, safe-zone flags deliberate, not defaulted
- [ ] Run the world validator after creation

## Interview prompts for ambiguous asks

Ask only what exemplars + the request can't answer. Typical NPC batch:
- Name (or "want me to name them?")
- What do they look like? One striking detail beats a paragraph.
- Where's home — which zone? Do they need a room created?
- Daily pattern: stationary, wander radius, or commute schedule?
- Can players talk to them? About what? Any quest hooks?
- Vendor/faction ties?

## Hard-won gotchas (from live pilots — trust these)

- **Wandering NPCs, two mechanisms, mutually exclusive:** an NPC with *any* `behaviour_graph` ignores the simple `wanders`/`wander_zones` fallback (see `gameLoop.js` npc tick). Use `wanders:1` + empty graph for cheap random drift, or a PATROL graph for deliberate routes — never both.
- **PATROL stall bug:** `patrolIndex` only advances on arrival *after travel*. If the NPC's starting `zone_id` is also `waypoints[0]`, the graph stalls forever (already-there → break → index never advances). Never include the spawn zone at the NPC's starting position in the waypoint list.
- **PATROL completes on each arrival** (falls through to `next`), so `patrol → SAY → wait → patrol` gives a spoken beat at every stop. `loop:true` wraps the waypoint index.
- **Verify movement empirically:** after injecting a mobile NPC, poll its `zone_id` every ~20s for 2 minutes and confirm it changes. A stationary "wanderer" is the most common silent failure.
- **NPC POST returns `{id}` only** — fetch the NPC back via `get npcs` to confirm the graph/dialogue persisted whole.
- **"Blunt" damage = `kinetic`** in the combat engine (everything defaults to kinetic). Typed armor goes in `tags.armor_soak: { kinetic, edged, energy, thermal }` — copy the Riot Plate Vest, not the legacy `effects.armor` int. `recomputeArmor()` only runs at login, so soak changes don't take combat effect until the player reconnects.
- **Scavenging table PUT is destructive:** `PUT /scavenging-tables/:id` deletes ALL entries and rewrites from `body.entries`. To *add* an item, GET the table first, map its entries to `{item_id,difficulty,weight,max_qty}`, append yours, and PUT the full set. Never PUT a partial entry list. (Same read-modify-write caution applies to any list-valued PUT.)
- **A craft component needs its own way into the world** — the recipe is the coat's path in, but an invented ingredient is uncraftable air until it's placed too (scavenging table, loot, or vendor). Zones bind a table via `zones.flags.scavenging_table_id`; pick the table already on the thematically-right zone rather than making a new one.
- **Scratchpad path escaping:** don't build Windows paths inside `node -e` bash strings (`\r`/`\\` get mangled). Write a `.mjs` helper in scratchpad and run it, using `new URL('file', import.meta.url)` for sibling paths.
- **A "light" with no `lumen_output` emits nothing.** Zone brightness = the summed `lumen_output` of on-lights, not the count of lit fixtures. Create a light with `light_on:1` but no `lumen_output` and the room drops to the 0-lumen powered fallback (`0.3` → gloomy/dim) — the classic "all the lights are on but it's dark" bug. Always set `lumen_output` (lamp ~400, overhead ~1200, streetlight 8000); copy an existing light of the same `light_type`. `light_on` is only the switch. To fix existing dim rooms, PUT the offending lights with a real `lumen_output` (furniture PUT is create-column-aware — but re-fetch to confirm the resync landed).
- **Item PUT is a full-object replace with NO merge/COALESCE** (`apiUpdateItem`): it writes `name,type,weight,value,tags` straight from the body, so a *partial* PUT (e.g. just `{tags}`) NULLs name/weight/value. Always PUT the complete item object — keep the create payload in scratchpad and edit it, never hand-write a diff. Note it also ignores `subtype/effects/flags/is_stackable` on update (those are create-only columns).
- **"Verified" has two tiers — say which you did.** DB read-back (fetch the entity, confirm the field) proves the *data* is right. Behavioural verification (poll NPC `zone_id` to see it move) proves it *works*. Armor soak can only be data-verified cheaply: `recomputeArmor()` runs at login and there's no puppet player, so you can't observe combat soak from the CLI. Report "data verified, combat effect not observed" rather than implying it was play-tested.

## Server lifecycle

Before `npm start`, check if one is already up — a stray background server from an earlier turn causes a port-collision failure (the new process exits 1 but the old one keeps serving). Reuse it instead:
```
node tools/design-cli.mjs get zones >/dev/null 2>&1 && echo "server live, reuse it" || npm start   # (background)
```
If you started a server earlier in the session, it's probably still running — don't spin a second one.

## Tone

Post-singularity decay, HellMOO lineage: dark, funny, concrete. Descriptions name specific damage, habits, smells — not vibes. Read `docs/story.md` + `docs/design.md` once per session if writing prose. When in doubt, steal the register from the best existing NPC description you pulled in step 1.

**Name casing = prose-case.** Item/furniture `name` is shown verbatim mid-sentence ("You pick up a *name*."), so store generic words lowercase and only capitalize brand/proper tokens: `pipe wrench`, but `Nexis IX breacher`, `Rattlecan SMG`. No auto-capitalization exists — the casing you write is the final display. See `docs/items.md` → *Naming: prose-case*.
