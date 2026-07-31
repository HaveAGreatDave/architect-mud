# atm

**Purpose** — cash machines that behave like cash machines. An ATM is power-aware (an outage kills it), belongs to a faction network, holds a **finite** amount of cash, caps what you can pull in one transaction, and can be hacked by someone who would rather not use a card. A `bank_teller` NPC at a bank counter lifts the per-transaction cap — which is the reason to walk into a bank instead of using the machine outside it.

## Commands
- `atm` — the terminal itself.
- `deposit` / `withdraw` — the honest path.
- `jack` / `jackresolve` — the dishonest one (the resolve is the client minigame's silent callback).
- `drain` — empty a machine you have broken into.
- `.hackpreview` — dev/inspection aid.

## Specialized actions
- `use` on anything tagged `atm`, so a machine advertises itself on examine.

## REST
- `/atm`

## Notes
Stock is finite and replenishes on a tick, so a network can be milked dry; the power dependency means an ATM in a blacked-out district is just a box.

## See also
[docs/systems-atm.md](../../docs/systems-atm.md)
