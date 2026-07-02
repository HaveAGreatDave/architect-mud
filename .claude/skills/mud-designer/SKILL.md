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

**Enemy:**
- [ ] A zone spawn entry (`zones/<id>/spawns`) — an enemy with no spawn ships nothing
- [ ] Loot table items exist
- [ ] Behaviour graph (or default AI is acceptable — say which)
- [ ] Danger rating of the target zone matches enemy lethality

**Item:**
- [ ] Tags from the catalog only (`client/shared/tagCatalog.js`) — check `docs/tags.md`
- [ ] A way into the world: vendor stock, loot table, scavenging table, or placed spawn

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
