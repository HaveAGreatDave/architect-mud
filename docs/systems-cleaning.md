# Cleaning — filth with two clocks (as built)

The engine could already make a room filthy (`stainZone` in `bodily.js`) and
describe the filth (`commands/describe.js`), but nothing could remove it except
the nightly sweep in `dailyMaintenance`. That sweep was right for the street and
wrong for the room you pay rent on: a mess you made in your own kitchen evaporated
overnight whether you touched it or not, so there was nothing to be house-proud
about and no reason for a mop to exist.

This is the body half's counterpart — see [systems-hygiene.md](systems-hygiene.md)
for filth **on a person**; this is filth **on a floor**.

## Two clocks

| Space | Behaviour |
|---|---|
| Unowned (streets, public interiors) | Swept nightly, as before — the city cleans itself |
| **Owned** (an apartment with `owner_id`, a shop with a deed) | Keeps its stains for `STAIN_KEEP_DAYS` (7) game days — one rent cycle |

The 7-day sweep is an **absentee backstop, not a service**: long enough that the
only way to live somewhere clean is to clean it, short enough that an abandoned
flat doesn't stay a health hazard forever. If you are playing, you are mopping.

## `server/engine/zone-filth.js`

The substrate. Sync and query-free by contract — `zone.stains` lives in RAM and is
the source of truth (inherited from `stainZone`'s discipline), so a clean is a Map
mutation and can be called from any path without a round trip.

### Ownership is asked, not assumed

The engine knows about apartments (`world.apartments`, already in memory). A shop
deed lives in the storefront plugin, and **the engine must not import a plugin** —
so plugins register a provider, the same shape as `registerArmorContributor`:

```js
registerOwnedZoneProvider((zoneId) => !!deeds.get(zoneId)?.owner_id);
```

Providers must be **synchronous and query-free** — they run once per owned zone
inside the daily sweep. A provider that throws is contained and cannot take the
sweep down with it.

### The cadence is stateless

`isDeepCleanDay(gameToday())` derives the sweep day from the game date modulo
`STAIN_KEEP_DAYS`. No new column, no counter — **a restart cannot reset everyone's
mess**. An unknown date (pre-boot) **fails safe**: it deep-cleans, i.e. the old
behaviour, rather than letting the world foul up.

`STAIN_KEEP_DAYS` is deliberately the same number as `RENT_PERIOD_DAYS` but not an
import of it — they match for a thematic reason (your place is your responsibility
for as long as you're paying for it), not as a shared constant.

### `cleanZone(zoneId, marks)`

Removes `marks` stain-marks, **smallest pile first**, so partial effort reads as
progress rather than as nothing having happened. An emptied type is deleted, not
left at zero. Cleaning an unknown zone is a safe no-op — the verb is reachable
from transient/void rooms with no `world.zones` entry.

### The daily sweep

`dailyMaintenance` now walks `world.zones` and skips owned zones unless it is a
deep-clean day. The DB `UPDATE` excludes the spared list, so **a reboot cannot
hand an owner back a floor they already mopped**.

## `plugins/cleaning`

Leaf plugin: no table, no tick, no skill. This is a chore, not a career.

`clean` / `mop` — cleans the floor you are standing on.

- **A tool is rewarded, not required.** Anything tagged `cleaning_tool` (carried,
  *or* furniture standing in the room — a utility sink counts) clears the whole
  floor in one action. Bare hands clear **one patch** and leave the filth on you.
  Requiring a tool would just mean players never clean.
- **Cleaning makes you dirty.** It routes through the hygiene substrate's sweat
  meter (`addSweat`) rather than inventing a second filth axis, so a long scrub
  genuinely costs you a wash afterwards.
- Prose is picked off the **worst** thing on the floor, so mopping blood never
  reads like sweeping dust.
- A spotless floor **answers** rather than erroring — "there's nothing to clean"
  is information, and returning it here stops `clean` falling through to
  `Unknown command`.
- **`clean` also takes graffiti off the wall** (2026-08-01), because one verb for
  "make this room right" beats two. Note the deliberate asymmetry with the rule
  above: **paint needs a real tool.** Bare hands do floor filth, not brickwork.
  A tool is *rewarded* on the floor because requiring one would mean nobody ever
  cleans; it is *required* on a wall because if defacing a shopfront cost the
  owner nothing to undo, a tag wouldn't mean anything. See
  [plugins/graffiti/README.md](../plugins/graffiti/README.md).

## Tags

| Tag | Scope | Meaning |
|---|---|---|
| `cleaning_tool` | item **or** furniture | Clears every stain in one action instead of one patch, at lower sweat cost |

Ships on `item_mop` (a fibre mop). The tag is the contract — never an item id — so
a bucket, a rag or a fixed basin needs no code.

## Regress

`plugins/cleaning/regress.js` drives the substrate directly (it is pure and
RAM-only): `cleanZone`'s smallest-pile-first arithmetic, deletion of emptied
types, safe no-ops on unknown zones, exactly one deep-clean day per 7,
`gameDayIndex` monotonicity, fail-safe on an unknown date, and that a throwing
ownership provider is contained without breaking a good one.
