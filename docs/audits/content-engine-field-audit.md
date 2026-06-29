# Audit Prompt — Content Fields ↔ Engine Reads

A reusable prompt for finding **drift between authored content and the engine that consumes it**. World
content (items, enemies, NPCs, zones, furniture, sounds, scripts) lives in Postgres and is authored
through the dev panel. The engine reads specific fields/JSON keys out of that content at runtime. Nothing
guarantees the *authored* surface and the *read* surface line up. Three failure modes, all silent:

- **Dead authored field** — the dev panel lets a designer set a property the engine never reads. The
  designer thinks they changed the game; nothing happens. (This is the worry [items.md](../items.md)
  calls out: "so nothing gets silently forgotten as the list grows.")
- **Ghost read** — the engine reads a key no editor ever writes (and no catalog documents), so it's
  permanently `undefined`/default. Often a half-finished feature or a renamed field.
- **Catalog drift** — for tags specifically, `client/shared/tagCatalog.js` is declared the single source
  of truth, but a tag the engine reads might be missing from the catalog (invisible to the editor), or a
  catalog tag might have no engine reader (decorative, or dead).

This is the engine/plugin source-of-truth bug ([source-of-truth-audit.md](source-of-truth-audit.md))
projected onto the **code ↔ database** seam instead of the engine ↔ plugin seam.

## How to run

Scope to **one content type at a time** (items, OR enemies, OR npcs, OR zones, OR furniture). Each has
its own dev-panel editor (`client/devpanel/js/panels/<type>.js`) defining what gets authored, and its own
engine readers. Auditing one type end-to-end is reliable; auditing "all content" at once is not.

For **items specifically**, the tag system gives you a machine-readable spine: `tagCatalog.js` is the
declared source of truth, so the audit becomes a three-way diff (catalog ↔ editor ↔ engine) rather than
a two-way one. Start there if unsure — it's the cleanest case and sets the pattern.

---

## Prompt

> You are auditing the Architect MUD codebase for **drift between authored content and engine reads** for
> one content type. Background to internalize first: content is data in Postgres, not code (CLAUDE.md
> "Engine vs. content are separate"); it's authored via the dev-panel editor in
> `client/devpanel/js/panels/<type>.js` and consumed by the engine in `server/engine/`. For items, the
> tag model is documented in [items.md](../items.md) and [tags.md](../tags.md), and
> `client/shared/tagCatalog.js` (`TAG_CATALOG`) is the **declared single source of truth**, read by the
> engine through `server/engine/tags.js` (`hasTag`, `tagValue`, `hasFlag`).
>
> Audit scope: **<NAME THE CONTENT TYPE, e.g. "enemies">**. Do this:
>
> 1. **Enumerate the authored surface.** From the dev-panel editor for this type
>    (`client/devpanel/js/panels/<type>.js`) and the DB column/JSON shape, list every field/property a
>    designer can set — including each key inside JSONB blobs (`tags`, stat maps, drop tables, AI config,
>    etc.). This is "what content can say."
>
> 2. **Enumerate the engine reads.** Grep `server/engine/` (and any plugin that consumes this type) for
>    every access to those fields — `row.<col>`, `tagValue(item, '<tag>')`, `hasTag(...)`,
>    `entity.<json>?.<key>`, destructuring, etc. This is "what the engine actually looks at."
>
> 3. **Diff authored vs read.**
>    - Authored but **never read** → dead content field. The editor is lying to the designer. Report it;
>      decide whether the engine should grow the reader or the editor should drop the field.
>    - Read but **never authorable** (no editor widget, not in the catalog) → ghost read. Report it;
>      decide whether it's a missing editor surface or a dead/renamed engine read.
>
> 4. **For items, add the catalog as a third leg.** Diff `TAG_CATALOG` keys against (a) tags the engine
>    reads via `tags.js` helpers, and (b) tags the editor exposes. Flag: catalog tag with no engine
>    reader (decorative or dead), engine reads a tag absent from the catalog (invisible to the editor and
>    undocumented), editor exposes a tag the catalog doesn't define.
>
> 5. **Watch for name/shape mismatches, not just presence.** A field read as `entity.ai?.aggroRange`
>    while the editor writes `ai.aggro_range` is drift even though "both exist." Check casing
>    (snake_case in DB vs camelCase in JS), nesting depth, and value shape (scalar vs `{min,max}` range).
>
> 6. **Verify, don't theorize.** For a suspected dead field, prove it: author a content row that sets the
>    field to an extreme value via the dev panel (or a direct `query()` against a scratch row), exercise
>    the mechanic in-game over the WebSocket, and show it has no effect. For a ghost read, show the field
>    is `undefined` at the read site (temporary log). Claims must be demonstrated.
>
> 7. **Report**, per finding: the content type · field/tag · authored? · read? · in catalog? (items) ·
>    the name/shape mismatch if any · the minimal fix (wire the reader, remove the editor widget, or add
>    the catalog entry) · which doc records the contract ([items.md](../items.md) field table,
>    the relevant `systems-*.md`, or the tag catalog). Keep changes surgical (CLAUDE.md): do not
>    redesign the content schema, and never add a boot-time migration (CLAUDE.md "No startup migrations").

---

## Standardization this audit should push toward

- **Every authored field has exactly one reader contract, documented once.** [items.md](../items.md)
  already does this for items ("which JSON keys the engine actually reads"). Each content type should
  reach the same standard: a field table in its `systems-*.md` (or items.md-style doc) listing column →
  who reads it → default.
- **The catalog is law for tags.** If the engine reads a tag, it must be in `TAG_CATALOG`. Treat
  "engine reads a tag the catalog doesn't list" as a defect even when it works — it's invisible to the
  designer and the next reader.
- **One naming convention across the seam.** Pick snake_case-in-DB / camelCase-in-JS (or whatever the
  norm is) and make the read sites match the authored keys exactly. Cross-reference
  [naming-registry-harmony-audit.md](naming-registry-harmony-audit.md).

## Checklist (quick manual version)

- [ ] Read [items.md](../items.md) / [tags.md](../tags.md) and the type's `systems-*.md` + dev-panel editor.
- [ ] List every authorable field/JSON key for this content type (the editor surface).
- [ ] Grep `server/engine/` + consuming plugins for every read of those fields.
- [ ] Authored-but-never-read? (dead content field) — list each.
- [ ] Read-but-never-authorable? (ghost read) — list each.
- [ ] Items: three-way diff catalog ↔ editor ↔ engine reads.
- [ ] Name/casing/shape match at the read site, not just presence?
- [ ] Prove one dead field and one ghost read live before changing code.
- [ ] Record the field→reader contract in the type's doc.
