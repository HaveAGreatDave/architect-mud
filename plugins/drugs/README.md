# drugs

**Purpose** — the drug domain: the two ways to take something, and the read-out of what it has done to you.

## Specialized actions
- `use` and `inject`, gated on the `drug` tag.

## Commands
- `habits` — your own tolerance, dependency and withdrawal.

## Hooks
- `player.appearanceNotes` — what a user looks like to someone examining them.
- `drug.overdose`

## See also
[docs/systems-survival.md](../../docs/systems-survival.md). The *behavioural* layers live in their own plugins (**cannabis**, **intoxication**, **trip**) so that being high is separable from being dosed.
