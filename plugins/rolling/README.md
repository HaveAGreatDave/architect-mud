# rolling

## Purpose

Turns **loose leaf into smokeables**. Loose cannabis and loose tobacco are drugs
sold by the gram (`item_loose_cannabis` / `item_loose_tobacco`, stackable — the
`quantity` is the gram count). This plugin owns the single `roll` verb that
converts **1 gram → 1** finished smoke:

- **loose cannabis → a joint** (`item_joint`, stackable — merged into any existing
  joint stack you carry).
- **loose tobacco → a cigarette** (`item_cigarettes` as a hand-rolled loose stack:
  `quantity` + `custom_data.loose`, smoked one at a time — the same shape the
  `smoking` plugin uses for a bummed cigarette).

Usage:

- `roll` — roll one from whichever loose leaf you're carrying.
- `roll <n>` / `roll all` — roll n (capped at the grams on hand).
- `roll <n> cannabis` / `roll <n> tobacco` — disambiguate when you carry both.

It's a pure verb: nothing else reads its state. The joint/cigarette items and the
loose-leaf drugs are **content** — `scripts/add-loose-leaf.js` (loose leaf),
`scripts/add-joints.js` (joint), `scripts/add-cigarettes.js` (cigarette). This
plugin only references their item IDs.

## Commands

- `roll` — roll loose cannabis/tobacco into joints/cigarettes (1 gram each).

## Hooks

None.

## Content dependencies

- `item_loose_cannabis`, `item_loose_tobacco` (from `scripts/add-loose-leaf.js`)
- `item_joint` (from `scripts/add-joints.js`)
- `item_cigarettes` (from `scripts/add-cigarettes.js`)
