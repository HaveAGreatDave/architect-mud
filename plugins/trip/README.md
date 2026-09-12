# trip

**Purpose** — drug hallucinations, in three escalating shapes:

- **Overlay trips** — the world, wrong.
- **Isolated dream-zone trips** — a separate space with an **attackable phantom body**.
- **Deliriant phantom-mode trips** — the *real* room populated with per-player fake people and animals that only you can see.

## Hooks
- `drug.used`, `drug.overdose`

## Composition, not clobbering
The phantom `look` / `examine` / `talk` / `attack` intercepts ride as **specialized actions**, so they compose with **weapon** and **flight** rather than overriding them. You can attack a hallucination without breaking the real combat verb.

## Shared registry
Phantoms come from the same registry **sanity** uses below 25, so a low-sanity trip is additive rather than two systems fighting over the room.

## ⚠ The screen is not this plugin's any more

A drug with a `phases` block has its visual FX driven by the **phase engine** (`engine/drugs.js` →
the `drug_fx` message), which walks come-up → peak → comedown and is the only clock that knows those
moments. So `trip_start` sends **no `profile`** for such a drug: claiming the windscreen from here as
well would pin it at trip strength for the whole duration and flatten that arc into one slide.

What stays this plugin's: the `#trip-overlay` colour wash, the `[trip]` text palette, the audio bed
and the timed events. What it still drives itself: a hallucinogen with **no** `phases` block — a
spliced compound, which has no `drugs` row and therefore no family to derive a look from.

Teardown clears source `trip` unconditionally (a clear for a source never set is a no-op; a missed
one leaves the player tripping over a sober room). It never clears the engine's own `drug:<key>`
source — the drug is very often still running when the hallucination stops.

See **What a drug LOOKS like** in [docs/systems-survival.md](../../docs/systems-survival.md).
