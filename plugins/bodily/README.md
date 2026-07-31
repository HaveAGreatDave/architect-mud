# bodily

**Purpose** — the body's plumbing, and what it does to a room. Bowel and bladder pressure simulation, involuntary release, and the relief verbs — plus the social consequences, which are the actual point.

The **stains and the digestion loads stay in the engine** (`server/engine/bodily.js` substrate); this plugin owns the verbs, the routines and the reactions.

## Commands
**Relief:** `pee` / `urinate` / `piss` · `poop` / `defecate` / `shit` · `fart` · `flush`
**Washing:** `shower` · `soap` / `scrub`

## The routines are timed, and specific
Relief is a **timed routine onto a target** — a toilet, the ground, furniture, or a lying creature.
- **poop** drops legwear and squats for 20–40s.
- **pee** takes 10s, standing for male and sitting for female.
- Farts are **pressure-scaled**; plops and surface-varied pee-stream cues go out through `bodily.sfx`.

## The social layer
NPCs **yell when peed on**. Bystanders recoil at public elimination, and that also emits `bodily.publicRelief` → an **indecent-exposure charge**. Toilets stay **fouled until flushed**.

## `shower` vs. MIS `wash`
`shower` is the **superset**: it strips `clothing_contamination`, `soiled_state`, `ejaculate_state` and `covered_in_blood`, and leaves a brief cosmetic "refreshed" badge. MIS `wash` deliberately leaves the bodily stains.

## Hooks
- `furniture.describe` — toilet and sink panels.
- `zone.smells` — the body's contribution to the smell pass.

## Events
- **Emits:** `bodily.sfx`, `bodily.publicRelief`
- **Consumes:** `player.logout`

## Tick
- **1m** — pressure.

## Discovery gaps (known, documented in the manifest)
`flush` and `shower` are room-object gated and error otherwise; both are surfaced as action-links inside the `use toilet` / `use shower` panels rather than on examine, because toilet and sink are not in examine's hardcoded `object_type` branches. `soap` is a declaration-only specialized action on `water_source` furniture — the sink advertises SOAP, and the verb self-resolves its target given a carried item tagged `soap`.

## See also
[docs/systems-hygiene.md](../../docs/systems-hygiene.md) — this is the source of most of what the hygiene substrate smells.
