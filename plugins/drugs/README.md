# drugs

**Purpose** — the drug domain: the two ways to take something, and the read-out of what it has done to you.

## Specialized actions
- `use` and `inject`, gated on the `drug` tag.

## Commands
- `habits` — your own tolerance, dependency and withdrawal.

## Hooks
- `player.appearanceNotes` — what a user looks like to someone examining them.
- `drug.overdose`

## Engine seams this plugin rides

`drugForItem(itemId)` / `isDrugItem(itemId)` answer "is this a drug?" from the boot cache, sync,
which is what `use`/`inject` resolve against. The arc after a dose is published as
`drug.addicted`, `drug.withdrawal` (on the beat) and `drug.cleaned` — see
[docs/systems-survival.md](../../docs/systems-survival.md#connecting-to-it).

## See also
[docs/systems-survival.md](../../docs/systems-survival.md). The *behavioural* layers live in their own plugins (**cannabis**, **intoxication**, **trip**) so that being high is separable from being dosed.
