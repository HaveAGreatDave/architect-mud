# surveillance

**Purpose** — SPECTER: player-run spy networks, and the witnessed-crime wanted system they share plumbing with. Two halves of one idea — *someone saw that*.

- **P1–5** — plant devices, run a hub, record, counterplay, and the devices themselves.
- **P6** — the 0–5 star wanted system, escalating police tiers up to Arbiters, evidence and bounties.

## Commands
**Network:** `plant` · `retrieve` · `sweep` · `feed` · `hub` · `hubclose`
**Footage:** `record` · `clip` · `clips` · `replay` · `wipe` · `collect`
**Counterplay:** `smash` · `hijack` · `hijackresolve` · `pilot`
**Law:** `wanted` · `bribe` · `submit` · `scrub` · `apprehendresolve` · `purge`

## Specialized actions
- `use` on `specter_program`, `spy_deck`, `security_console`, `datachip`
- `scrub` gated on the `police_terminal` flag (declaration-only — the terminal advertises it on examine; `cmdScrub` still owns the verb)

## Hooks
- `zone.delete` — planted devices do not outlive their room.

## REST
- `/surveillance`

## The forced-witness convention
Some things are witnessed by definition rather than by a roll. Two systems feed this plugin that way:
- `storefront.staffWitnessed` — hired shop staff are a forced witness for shoplifting and hacking.
- `vendor.safeHackWitnessed` — the same convention for vendor safes.

**dealing** and **burglary** also route their charges through here. This plugin owns the star; the other systems own *when*.

## Discovery gaps (known)
`bribe` and `submit` are advertised by on-scene cop NPCs through **dialogue only** — NPC examine prints just talk and attack. `retrieve`, `smash` and `hijack` all act on concealed device furniture revealed only by `sweep`, which carries no tag, so examine cannot list them.

## See also
[docs/systems-surveillance.md](../../docs/systems-surveillance.md)
