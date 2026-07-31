# dealer

**Purpose** — the covert shadow drug-dealer. He is not a shop with a menu on it; his stock opens to a **spoken passphrase**, and only when he is actually present, at night. The passphrase is **one-time** — once he knows you, you can just talk to him like anyone else.

That progression is the design: the password is an introduction, not a lock.

## Hooks
- `player.say` — listens for the passphrase.
- `npc.talk` — the ordinary route once you have been introduced.

## Commands
None — you speak to him.

## Gate
Trust-gated stock, presence-gated, night-gated.
