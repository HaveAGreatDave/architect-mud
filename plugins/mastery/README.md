# mastery

**Purpose** — the Long Watch's discipline, and their answer to Wildblood mutation and Ascendant
chrome: eight trainable disciplines (body, movement, senses, mind, combat, pain, breath, will) on a
body that is never modified. The full as-built account is
[docs/systems-mastery.md](../../docs/systems-mastery.md); this file is the signpost and the rules
that decide where code may go.

## The rule the whole system is built on

**A Long Watch veteran must not look supernatural on inspection.** No paper-doll entry, no
appearance note, nothing an `examine` can see — and therefore **no permanent passive** is granted
anywhere. A contribution is made at the moment of the act or not at all.

## Two limiters, and a stain

Rank is **stored raw and capped on READ**: chrome and mutation lower the ceiling (floored at 10 —
chrome makes mastery impossible, not discipline). Removing them leaves a **decaying stain**, without
which chrome would be rentable: install, train, uninstall, keep the rank.

⚠ **Read `effectiveRank`, never `storedRank`**, anywhere a door is being opened — including the
`mastery` VINE condition shape. Reading the stored value lets chrome open a door the discipline
exists to hold shut.

## Read is the mechanical identity

Every other build in the game gets **worse** over a long fight; this one gets better. It keys on
`enemy.templateId`, so four hundred dogs are one row, and it learns from **misses**, which is why it
rides the sync `registerSwingContributor` seam rather than damage events.

## Traps

⚠ **Blind Fighting is NOT a `visibility.perceive` contributor**, though its own design doc
prescribed exactly that. That hook hands every handler the same original args and keeps the LAST
answer, and `plugins/flashlight` is already on it and sorts first — so a second opinion *replaces* a
torch's boost and a carried light stops working for anyone who trained. It rides the swing seam
instead, where it can only ever give back a share of what the dark took, and therefore contributes
exactly 0 in a lit room **by arithmetic rather than by a guard**.

⚠ **Fear Discipline resists what you WITNESSED, never what you did to yourself** — an allow-list
that fails closed, because most sanity loss in this game is self-inflicted and softening all of it
would be a flat passive on the resource with no other defence. The list is short because the game
is: a new horror source opts in by naming its reason in `FEAR_REASONS`.

⚠ **`regardOf` / `standingGreeting` exist to be SAID, never CHECKED.** Nothing may gate on them.

⚠ **The instructors are content, and they were missing for months.** Mastery shipped a `train` verb,
a rep gate, a purity gate and a per-teacher ceiling with no teacher anywhere in the world —
`grep -rl mastery_instructor content/` returned nothing. Three now ladder it (Pike 35 /
Quartermaster 65 / Teague 100). See §8 of [systems-ascension.md](../../docs/systems-ascension.md).
