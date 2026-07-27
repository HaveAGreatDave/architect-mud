# clinic

Paid treatment at a medic — the service half of a clinic. The medics already
*sell* supplies through an ordinary vendor `__shop__` node; this is what you walk
in for when you can't patch yourself: they put you back together, and they bill
you for it.

## Model

One Action, no state, no tables, no ticks. `CLINIC_TREAT` reads the player's HP,
quotes a price off what's actually wrong with them, moves credits through the
engine economy service, and writes the same `player.hp` / `player.statuses`
fields every other healing path already writes. HP is persisted by the existing
gameLoop save — this plugin never touches the DB directly.

**The bill**

```
base = max(minimum, ceil(missingHP × rate)) + (bleeding ? bleed_fee : 0)
cost = round(base × (1 − relationHelp))     ... and 0 outright at `close`
```

The floor is applied **before** the relationship adjustment, so a friend can
actually get below it — otherwise the floor eats exactly the generosity that's
supposed to be felt. At `close` the medic waves the money away entirely: a hard
cliff rather than an asymptote, because "she waves it off" is a moment and "she
charges you 4₵" is a rounding error nobody notices. A `wary` or `hostile` medic
charges you *more*.

Passing no NPC id (the `treatmentQuote(player, params)` form) prices exactly as
it did before relationships existed.

| Param | Default | Meaning |
|---|---|---|
| `rate` | `2` | credits per point of missing HP |
| `minimum` | `10` | floor — nobody opens a sterile pack for less |
| `bleed_fee` | `25` | flat surcharge to stop an active bleed |
| `free` | `false` | treat at no charge (charity ward, quest reward, faction perk) |

Every param is per-node, so a back-alley cutter and a corporate trauma bay charge
wildly different money off the same Action.

**What treatment does:** restores HP to `hp_max`, clears the `bleeding` status,
and discards any pending `healOverTime` (a paid patch-up supersedes the kit you'd
already cracked on yourself).

**Refusals**, both returned as ordinary dialogue lines rather than errors:

- *Not injured* — no charge, no state change. This also makes the Action safe to
  re-render: `renderDialogueNode` fires a node's actions **every time the node is
  drawn**, so a second look at a patched-up player is a free flavour line rather
  than a second bill.
- *Can't afford it* — the engine's guarded credit UPDATE fails atomically, so
  there is no window where the debit lands but the healing doesn't.

## Actions

| Action | Params | Result |
|---|---|---|
| `CLINIC_TREAT` | `rate`, `minimum`, `bleed_fee`, `free` (all optional, read **flat** off the dialogue node) | `{ type: 'dialogue_line', text }` |

Dialogue actions are authored flat by the VINE editor (`{action, rate, …}`), which
is why the params sit alongside `action` rather than nested under `params`.

## Content wiring

```json
{ "action": "CLINIC_TREAT", "rate": 2, "minimum": 10, "bleed_fee": 25 }
```

Live on both medics — Sister Ida Adler (`npc_clinic_medic`, Meltwater clinic,
2/10/25) and Dr. Priya Anand (`npc_medic_anand`, clinic interior, 3/15/30) — as a
`treat` node reached from a "Patch me up." option on `root`.

## Commands

None. Treatment is a negotiation with a person, so it lives in the medic's own
dialogue tree rather than in a verb. (`heal` is taken by **dev-tools** as an admin
cheat and is deliberately not shadowed.)

## Known gaps

Treatment is instant and has no aftermath — no occupancy time, no triage queue,
no convalescence, no infection risk, no severity tiers. Those are the interesting
part and none of them are built here; this plugin is the transaction they'd hang
off.
