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
