# strippers

**Purpose** — the strip club economy: NPC dancers who escalate a live show as the
money hits the rail, and the VIP room a big spender earns. A dancer is any NPC
with `flags.stripper = true` and an ordered `flags.clothing_layers` (outermost →
innermost). Tips feed one decaying "stage heat" pool per dancer that peels her
clothing (via the engine's `npc._clothingPeeled`, shown in the examine line) and
ramps her dance text; at 500 heat she is fully naked and the show turns graphic.
Nudity and explicit lines are shown only to players opted into MIS.

## Player verbs

- `tip <dancer> <credits>` — debit credits, add to the dancer's shared stage heat.
  Also accepts `tip <credits> <dancer>`.

## Escalation

| Shared heat | Show |
|---|---|
| 0–49 | clothed, tame |
| 50–299 | suggestive, first layers come off |
| 300–499 | risqué, nearly bare |
| 500+ | completely naked, graphic (MIS players only) |

Heat cools by 12 every 15s; the dancer re-dresses as it falls back through the
layer thresholds.

## VIP

A player who has tipped **1000 total** earns a 24h VIP pass — the player Flag
`stripclub_vip_until` (expiry in ms). The `viplock` door type (registered here)
opens only while that pass is active; it is not hackable.

MIS (sex) is refused in the main room and allowed in the VIP room. That gate is
generic and lives in the **mis** plugin: a dancer carries
`flags.mis_requires_zone_flag = "mis_ok"`, and the VIP zone carries
`flags.mis_ok = true`. Elsewhere the dancer just waves you off — no fleeing, no
fight — so the main-room rule is "tip and watch".

## Tick usage

- `15s` — each dancer in an occupied zone cools its heat, re-dresses if it dropped
  a tier, and (55% chance) emits a dance line at the current tier.

## Dependencies

- **mis** — the intimacy system and its zone-gated NPC consent path.
- **doors** — the lock registry the `viplock` type plugs into.

## Content contract

Author a dancer NPC with:

```jsonc
"flags": {
  "stripper": true,
  "clothing_layers": ["a sequined dress", "a lace bra", "a g-string"],
  "mis_requires_zone_flag": "mis_ok"
}
```

The VIP zone gets `flags.mis_ok = true`; the door into it is tagged
`{ "lock:viplock": {} }` and left `lock_state = "locked"`.
