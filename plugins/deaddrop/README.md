# deaddrop — a cache a stranger can find

**Status: BUILT (the finding roll, the swept memory, the disturbance mark).** The courier
who stocks a drop for you (§9 of the proposal) and the player-placed cache (§8b) are still
design — see
[docs/proposals/dead-drops.md](../../docs/proposals/dead-drops.md).

A dead drop is a container in a public room that one player stocks and another empties
without the two of them ever being in the same place. The engine has had the **placing**
half for a long time. This plugin is the **finding** half, and it is deliberately almost
nothing: one `search.provider` contributor plus a memory of who has already looked.

## Why it needed to exist at all

The two halves had never met. A census of the world on 2026-08-30:

| | rows |
|---|---|
| furniture with `flags.container` | 57 |
| furniture with `flags.concealed` | 58 |
| **both** | **0** |

A dead drop is that intersection, and it had no members. You could conceal a thing and
you could store in a thing, and no row did both.

## ⚠ Why `flags.dead_drop` is its own flag

The obvious simplification is to drop it and key the roll on `flags.concealed`, which is
already deployed and already means hidden. **Do not.** Of those 58 concealed rows, **53
are planted security devices** — SPECTER's spy cameras. Keying on `concealed` turns
`search` into a generic counter-surveillance sweep, and beating a planted camera is meant
to require knowing where to look rather than typing one verb in the room.

So being findable *as a cache* is an authored opt-in, and everything already concealed
stays exactly as unfindable as it is today.

## Authoring a cache

Three flags on one furniture row. All three, every time:

| flag | what it buys |
|---|---|
| `container` | it is a hole you can put things in — `plugins/container` gives `open` for free |
| `concealed` | the room description refuses to mention it |
| `dead_drop` | it is findable *as a cache* (this plugin) |

⚠ **`object_type: 'container'` is not `flags.container`.** Two rows in the world carry the
object type and not the flag, and `plugins/container` gates `open` on the flag. A cache
authored by setting the object type is found and then cannot be opened — which reads as a
bug in `search`, not as a mis-authored row.

**Finding is not opening.** For a paranoid dropper, add a second row whose
`conceal_hides` points at the cache and `plugins/concealment` supplies the keypad
unmodified — the chem-lab shape, reused. `search` then reports the seam and the finder
still needs the code. A cheap cache is one row and found *is* opened.

## The two rules that carry it

**The provider never creates a cache.** A cache that springs into existence because
somebody rolled well is a faucet whose only limit is walking pace. It reports a row an
author or a player already placed. Same relationship `strays` has to Cathode, and the
same `search`-never-pays-out rule.

**`STRANGER_BAR` is a wall, not a delay.** Margin ≥ 12 against `scavenging` difficulty 4
— compare concealment's 6 (guards a bad feeling) and strays's 6 (guards a cat that wants
finding eventually). The tuning target is the sentence *a character with poor
Brains/Reflexes and no scavenging cannot sweep a district productively at all*, never a
hit percentage. Lower it to make sweeping feel better and the feature becomes a tax on
the dropper rather than a risk to them.

## The swept memory

Per cache per player, **not** per zone — `search`'s own cooldown is per zone, so on a
district grid a failed roll can be re-rolled by stepping one tile out and back, which
converts `STRANGER_BAR` from a wall into a wait. Stamped on a miss as well as a hit, or
that re-roll defeats the bar.

RAM-authoritative (a restart costs a re-roll, the same trade `search`'s cooldown makes).
The one durable piece is the **knower** half — `deaddrop_known_<cacheId>` in
`player_flags` — because being told where a drop is has to survive a logout; that is the
whole value of being told.

The knower ignores the margin, and the stranger's bar is never lowered to compensate. The
provider only sees `margin`, so it cannot tell *was told* from *got lucky* — reliability
comes from the player's own state. Lowering the bar instead would lower it for the
stranger standing next to them.

There is deliberately **no verb that makes you a knower**. `tellPlayerAboutCache()` is
exported for a quest turn-in, an NPC or a note to call: knowing is something the fiction
grants.

## Somebody has been in it

Finding a cache is half a story. The other half is the person who stocked it opening it
later and knowing — and that costs one flag on a row that already exists. No log, no
table, no tick.

A stranger who opens a cache sets `flags.dead_drop_disturbed` on it. The knower sees it
on their next look, and **reading it clears it**, so the notice means *since you were
last here* rather than *at some point, forever* — and the cache re-arms for the next
stranger. A knower opening their own cache never marks it; otherwise every owner reports
themselves and the signal means nothing.

⚠ **It records that it happened, never who.** An owner handed a name has been handed a
kill order by the user interface. "Who" is the question SPECTER exists to answer — go and
find a camera. Regress asserts no identity reaches the row.

It rides `container.view`, the gather hook `open` already fires (cooking and wardrobe
decorate through the same one), so nothing new is wired into the open path. The write goes
through `updateFurniture`, the funnel `concealment` already writes `concealed` through, so
the world cache and the room description agree with no new seam.

⚠ The knower's `search` line reads the same flag. It used to end "has not been touched",
which this phase can make a lie — whether the lid has moved is one fact, told in one
place, rather than two that can disagree.
