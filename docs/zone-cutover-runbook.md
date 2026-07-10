# Zone Column Cutover — Prod Runbook

**One-time runbook. Delete this file after executing.** Local work is DONE
(data migrated, columns dropped locally, content re-exported, regress 733/733
green). Prod still has the old columns and old data — the deployed code reads
tags-first, so prod behaves identically until you push. Two steps, in order:

## 1. Run the migration one-shot against prod

```
node --env-file=.env.prod scripts/migrate-zone-columns-to-tags.mjs --dry-run   # review first
node --env-file=.env.prod scripts/migrate-zone-columns-to-tags.mjs
```

Safe while the current prod build is deployed (it never reads flags.radiation
etc. — the old columns are still there and still read). Idempotent; re-running
is a no-op. What it does per zone: strips junk flag values, moves
`radiation_level` into `flags.radiation` **rescaled ×10** (radiation becomes
real — it was mathematically cosmetic before), drops `is_safe_zone` (218 zones,
user decision: sleep now needs sanctuary or an owned apartment) and
`pvp_enabled` (was display-only), and prints two review lists:

- **danger review** (`zone_deep_deepmaw`, `zone_deep_gasp`): authored high but
  their spawns infer low — beef their spawns or add a `danger` tag if you want
  them scary.
- **former safe zones** (218): the curation shortlist for painting `sanctuary`
  tags (dev panel → Maps → "Paint Safe Zones" tool now paints sanctuary, or the
  Zone Tags editor). **Until you tag sanctuaries, players can only sleep in
  owned/unlocked apartments** — probably tag the main hubs (Threshold, clone
  facility, precinct lobby, shop interiors you consider safe) soon after deploy.

## 2. Commit + push (this IS the deploy)

Commit everything (engine + 358 zone content files + docs), push to `main`.
CI applies `SCHEMA_SQL` first — the idempotent `ALTER TABLE zones DROP COLUMN
IF EXISTS …` lines remove the four columns on prod — then imports the
regenerated content files (which no longer carry those keys).

**Order matters:** run step 1 before pushing. If the push lands first, the
DROPs discard the legacy column data before the migration read it. (Recovery
would need the pre-deploy backup CI takes, so just don't.)

## Post-deploy sanity walk

- Walk into the Redline: header should read `[LETHAL]` with `☢ RAD:40+`, and
  each step should add 4–5 rads.
- `look` in a former safe zone: no `⛨ SANCTUARY` chip, sleep refused.
- Tag a hub with sanctuary in the dev panel: attack/steal blocked there,
  sleep works, spawns stop.

## Known-stale one-shots (pre-existing, not touched)

These historical seed scripts INSERT the dropped columns and would error if
ever re-run: `scripts/seed-hangar-interiors.js`, `seed-surveillance-vendor.js`,
`seed-furniture-store.js`, `seed-clothing-store.js`, `seed-wanted-police.js`
(selects `danger_rating`), and everything under `server/models/temp/`.
