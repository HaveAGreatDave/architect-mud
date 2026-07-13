# consort

**Purpose** — Brings `flags.consort` NPCs to life as kept companions rather than
club performers. Forked in spirit from the [strippers](../strippers/) plugin, but
the tip/heat economy is gone: a consort is on the payroll, and what makes them
undress is **arousal**, and arousal comes from exactly one person — the handle in
`flags.devoted_to`. Today that's **Roxy** & **Bijou** in the Echelon's owner suite
(`zone_echelon_suite`), devoted to **Cyd**.

## The model

A `15s` tick reads the live room each consort is standing in:

- **Alone with their keeper** (the `devoted_to` handle is present and no other
  player is) → `arousal` climbs `RISE_PER_TICK` toward `MAX_AROUSAL`. As it crosses
  thresholds they peel their own `flags.clothing_layers` one piece at a time
  (`_clothingPeeled`, the same engine seam the club reads on examine), murmur
  devotion, and — with both of them in the room — run tender two-hander banter,
  some of it addressed to him.
- **A stranger in the cabin** (any non-keeper player) → the mood dies. Arousal
  cools `COOL_PER_TICK`, they cover back up one layer per tick, and go **shy**:
  quiet, guarded, keeping the other one between themselves and the guest.
- **No witness** → nothing (same rule as the banter engine).

Nudity and the explicit beats are **MIS-gated** — shown only to players with MIS
on, tamer version to everyone else — exactly like the club (`tieredZoneLine`).

## Talk

Registers the **`npc.talk` hook**: talking to a consort answers **warmly/devoted**
if you're their keeper, and **shyly/deflecting** if you're anyone else. Returns
`undefined` for non-consorts so normal dialogue handling continues.

## `strip` verb vs. self-stripping

The mis plugin's `strip` verb — *someone else* removing their clothes — is
unchanged and still bares them on command (it sets `_forcedNude`). This plugin
**honours `_forcedNude`** and holds a force-stripped consort bare instead of
covering her back up. Their own arousal-driven undressing is the separate thing
this plugin adds.

## Boundary with the strippers plugin

The strippers tick skips any `flags.consort` NPC (one guard line in
`plugins/strippers/index.js`) so the two never fight over `_clothingPeeled`. A
consort is not a `flags.stripper`, so the `tip` verb doesn't apply to them either.

## The consort archetype

`flags.personality = 'consort'` is a real archetype in
`server/engine/npc-personality.js` (registry entry + `CLOTHING` wardrobe), forked
from `stripper`. It supplies the auto-clothing and the baseline chitchat/MIS lines
for any *future* consort dropped into an autonomous role; Roxy & Bijou are static
set-pieces (`npc_type: 'npc'`, no work zone) and run their whole life off this
plugin, with `flags.no_banter` handing their two-hander conversations here rather
than to the generic banter engine.

## State

All in-memory (resets on restart) — `arousal`, `lastSpoke`, per-zone scene
bookkeeping. A consort's arousal doesn't warrant a persisted Flag.

## Ticks / hooks

- Tick: `15s` (`consortTick`)
- Hook: `npc.talk`
