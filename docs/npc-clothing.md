# NPC Clothing (personality-based, auto-assigned)

Every NPC with a **personality archetype** gets a personality-appropriate outfit,
assigned automatically at creation and rendered on examine. This is descriptive
text only — NPCs have no real inventory/equip system.

## How it's stored & shown

- Clothing lives in `npcs.flags.clothing_layers`: an **ordered array of
  descriptive strings, outermost → innermost** (e.g.
  `["a grease-stained merchant's apron", "a padded vest", "a threadbare undershirt"]`).
- `server/engine/commands/world.js` → `npcClothingLine()` renders it on examine.
  Normally a player sees only the **outermost still-on garment**
  (`"<name> is wearing a grease-stained merchant's apron."`), so each outfit
  leads with its signature piece. The strippers plugin peels layers as tips
  escalate (runtime `_clothingPeeled`); once every layer is off, the NPC reads as
  naked.
- NPCs **without** `clothing_layers` get no clothing line — their static
  `description` is assumed to cover their appearance.

## Re-dressing (any undressed NPC covers back up)

`_clothingPeeled > 0` means an NPC is showing skin. The strippers plugin's 15s
tick (`plugins/strippers/index.js`) runs a shared **cover-back-up procedure** for
**every** NPC found undressed in an occupied zone, not just dancers:

- After `REDRESS_GRACE` idle ticks (~30s) with no reason to stay undressed, the
  NPC puts one layer back on per tick (innermost-off first), each layer narrated,
  until `_clothingPeeled` is back to 0.
- **Dancers** hold their exposure while tips keep flowing (a tip resets the idle
  timer) and get show-flavoured, MIS-gated lines. **Any other** NPC re-dresses
  promptly with neutral lines. Nothing peels a plain NPC today, so the generic
  path is a safety net for future mechanics (MIS, strip-search, pranks) that
  leave an NPC undressed.
- NPCs in combat / lying / asleep don't re-dress until they're back up.

## The data table (single source of truth)

Outfits come from the `CLOTHING` map in
[`server/engine/npc-personality.js`](../server/engine/npc-personality.js), keyed
by personality slug and then by **sex** (`{ male, female }`). Each sex has
**several variants** for variety across a population; a variant is one
`clothing_layers` array whose **innermost layer is gendered underwear** (mirrors
the player starter kit — boxers/briefs vs bra + panties).
`pickClothingForPersonality(slug, sex)` returns a random variant from the
sex-appropriate set (`sex === 'female'` → female wardrobe; male / other / unset →
male), or `null` for an unknown archetype.

NPC sex is the `npcs.sex` column — always **`'male'` or `'female'`** (the clothing
and naked-look systems only model the two; no NPC is left `'other'`). It's
**decided and persisted at creation** — `apiCreateNpc` calls `decideSex()`
(`server/engine/npc-sex.js`): caller `'male'`/`'female'` → inferred from the
name/description's gendered language → a **stable per-id fallback** for genuinely
neutral NPCs (deterministic, not random). Existing NPCs were backfilled the same
way (see below). The clothing picker and naked-look lines read this column.

## Naked-look descriptions

When every layer is peeled, examine shows a **sex-specific naked description**
(`nakedDescLine()` in `server/engine/commands/world.js`), gated by the viewer's
MIS opt-in: MIS-off gets a plain "they're naked" line, MIS-on gets an explicit
one. `tame[i]` and `graphic[i]` describe the same body, and the variant is chosen
by a **stable hash of the NPC id** — so the same NPC always reads the same way on
every look, only differing by the viewer's MIS setting.

Keep this doc and that table conceptually in sync. To change or add outfits, edit
the `CLOTHING` map — that's the one place they live (same pattern as the
`chitchat` / `combat_lines` archetype content in the same file).

## Who authors the outfit — two tiers

**When Claude (the mud-designer skill) creates an NPC**, it authors a **bespoke**
`flags.clothing_layers` set from the character — personality, job, name,
description — and passes it in. A hand-authored outfit beats a generic archetype
pick, so this is the intended path for anything Claude makes. See the *NPC
clothing* section of `.claude/skills/mud-designer/SKILL.md`.

**When an NPC is created directly in the dev panel / via the API** (no Claude in
the loop), `apiCreateNpc` (`server/api/routes.js`) falls back to injecting a
random sex-appropriate variant from the `CLOTHING` table **when a personality is
set and no layers were authored**. Authored layers (Claude-written, or a
stripper's) are never overwritten.

So: **however an NPC with a personality is created, it ends up clothed** — richly
if Claude built it, generically if the panel did. NPCs created with no
personality and no authored layers are left bare (their description covers them).

## Backfilling existing NPCs

[`server/models/temp/backfill-npc-clothing.js`](../server/models/temp/backfill-npc-clothing.js)
clothes every existing NPC that has a personality but no authored layers. Dry-run
by default; `--apply` to write. Skips strippers (authored layers) and
personality-less NPCs. Run once, then reload the world / restart.

```
node server/models/temp/backfill-npc-clothing.js                     # preview new
node server/models/temp/backfill-npc-clothing.js --apply             # write new
node server/models/temp/backfill-npc-clothing.js --reclothe --apply  # re-pick already-clothed
```

`--reclothe` re-picks for NPCs that already have `clothing_layers` (strippers
still skipped) — used to roll the sex-aware wardrobe out over an earlier pass.

(Applied 2026-07-03: 13 NPCs clothed, sex-aware — women in bra/panties, men in
boxers/briefs; 3 strippers + 12 archetype-less NPCs skipped.)

**Sex backfill:**
[`server/models/temp/backfill-npc-sex.js`](../server/models/temp/backfill-npc-sex.js)
infers each existing NPC's sex from its name/description and corrects the `sex`
column where they disagree (no-signal NPCs are left as-is). Dry-run default;
`--apply` to write. Applied 2026-07-03: corrected 3 dancers written female but
stored male. Re-run the clothing pass afterward if any non-stripper's sex changed.

## Notes / possible follow-ups

- NPCs with **no personality archetype** get nothing. If you want full coverage,
  either set a personality on them in the dev panel, or extend the backfill with
  name/description keyword inference (as `backfill-npc-schedules.js` does).
- There's no dev-panel editor field for `clothing_layers` yet; edit via the flags
  JSON or a one-shot script. Adding an editor row is a clean future enhancement.
