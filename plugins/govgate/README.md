# govgate — government-quarter checkpoint

North City's NW enclave (the govt/elite quarter — 14 tiles: the `gov_*` ministry
blocks + `up_vellum` + Halcyon/Skyline/Datum/Sable/Spindle) is a sealed single
chokepoint. Two ways in:

- **The Steps** — the front stair, `zone_civ_steps` → `zone_up_vellum`. **Guarded** (this plugin).
- **The Under** — `zone_gov_mezzanine` ↓ the tunnel. **Unguarded** — the covert bypass.

## The checkpoint (a `registerMoveGate` law)

Fires only when entering the `flags.gov_checkpoint` tile **from outside** (a `from`
zone that isn't `flags.gov_enclave`). Moving around inside the quarter never triggers it.

1. **Wanted → hard turn-away.** Any active wanted star and the guards bounce you back
   down The Steps. No bluffing a rap sheet. Clear your stars — or take the Under.
2. **Contraband scan.** Carrying raw drug material or any `contraband`-tagged item
   (bagged counts — the scanner sees through a coat) runs a **Deception** check at
   difficulty 7. **Pass** → through. **Fail** → a `contraband_possession`
   **WANTED_RAISE** + bounced back + ~45s guard-heat (no instant retry). No Deception
   XP on a pass — it's a gate, not a training ground (kills the walk-in-out farm).

## Content / wiring

- `scripts/add-gov-checkpoint.js` flags the 14 enclave tiles (`gov_enclave`) and the
  gate tile `zone_up_vellum` (`gov_checkpoint`). `--dry` to preview. Idempotent.
- No new tables, no verbs. Reads the `wanted` player flag (set by surveillance) via
  the flag store — no coupling to the surveillance plugin.

## Activate

1. `node scripts/add-gov-checkpoint.js`
2. Restart / world-reload.
