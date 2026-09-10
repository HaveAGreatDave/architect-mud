# fillable

**Purpose** — fluid containers. FILL at a water, fuel or drug source, DRINK to restore thirst or take a dose, POUR between containers, DISSOLVE a soluble solid into one, EMPTY to discard. Gated on the `fillable` capacity tag (and `soluble`, for `dissolve`).

## The carrier and the cargo

A container holds two things, and they are two fields on purpose:

- **`fluid_type`** — the CARRIER. What is physically in it: `water`, `fuel`, `chem`, `drug`.
- **`drug_id`** — the CARGO. What is dissolved in that carrier, if anything.

Neat product bottled at strength is carrier `drug`. A tab of blotter dropped into a canteen leaves the carrier as `water` and adds the cargo. Collapsing the two into one field (`fluid_type: 'drug_blotter'`) would make dosed water indistinguishable from a bottle of solvent, and every question asked downstream — does this slake thirst, what does it stain, what happens when it lands on somebody — would have had to learn drug ids to answer. Kept apart, laced water still hydrates and still stains as water, and the only thing that knows about the drug is the code that doses you.

None of this shape is new. The topical substrate's resolver has read `custom_data.drug_id` since dousing was built, months before anything in the game could produce it. Drinking product is the second consumer of a field that was already there.

## Specialized actions

- `fill` · `empty` · `drink` · `pour` — gated on `fillable`
- `dissolve` — gated on `soluble`

## Ordering note

**drinks** deliberately claims `drink` and `pour` before this plugin, so a cup holding a mixed drink is not treated as an empty vessel. The `holdsDrink()` guard here is the ordering-independent backstop for that.

## Rules worth knowing before you change it

**The dose is the volume.** `drinkDosed` decides how much went down and nothing else — onset, tolerance, overdose weight, addiction and the come-up prose all belong to `useDrug`, which is why a drink of laced water and a swallowed tab of the same drug land in the same state row. One pull is capped at 1.5 doses, which is what stops a jerry can of neat product being an instant lethal overdose off a single verb.

**A drug tap loses.** When a room holds several sources, fuel wins, then water, then `drug_source`. The accident you can afford is a can of water.

**A fillable drug item must not stack.** `vendor.js` merges a stackable purchase into the existing row and only writes `flags.prefill` down the non-stacking branch — so a stackable bottle would arrive full the first time and empty every time after, and two half-drunk bottles would collapse into one row. Every fillable in the game is `unique` for this reason.

**Emptying clears the cargo too.** A stale `drug_id` left on a row re-doses the next person to fill it from a tap, and the failure reads as water that is inexplicably laced. `CLEAR` is the one place that list is written.

## Known gap

`flags.prefill` is applied by **vendor.js only** — a purchased bottle arrives full, a looted or authored-into-a-container one arrives empty. `spawnOnGround`/`spawnInContainer` take an item id rather than a template, so honouring prefill there means a lookup on a spawn path; not done, deliberately, pending a decision about that read.

## Commands

None.
