# deaddrop — a cache a stranger can find

**Status: BUILT — all four phases.** The keypad *tier* of §8b (the two-row disguise pair)
and the `hack`-it-open route are still authoring rather than code — see
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

## Placing your own (phase 3)

Buy a **stash box** (`item_stash_box`), `deploy` it in a room, `recover` it to take it
back up. Placement is limited by what you paid for, so the world gains no cache nobody
bought. The rejected alternative — *any existing container in a public room* — needs no
content at all, and that is exactly why it fails: every bin and locker in Coldwater
becomes potentially somebody's stash, which makes sweeping every room worth doing forever.

**Taking somebody else's cache is not a crime.** No stars, no witness check, no ownership
test at `open`. A found cache is simply lost. ⚠ Which is what makes the bar and the
concealment tiers the *entire* defence — if a competent sweeper can clear a district's
caches profitably, the fix is `STRANGER_BAR`, never a crime flag bolted on afterwards.

⚠ **`recover` works for anyone, but only on an EMPTY box.** Ownership is not tested,
because finders keepers is the rule — but a loaded box cannot be lifted, so a thief has to
open it and take the contents out through the path that already exists. Without that,
`recover` is a one-word way to walk off with a stranger's whole cache, skipping every
interesting part of it including the disturbance mark the owner would have read.

⚠ **One cache per room.** The `search` provider can only ever report the first, so a
second would be invisible forever — and stacking them is the obvious way to defeat a
sweeper.

**Going stale.** An untouched cache is cleared a cycle later (7 days, the same number
`zone-filth.js` sweeps stains on, for the same reason). It rides `environment.dayRollover`
— the event rent and daily maintenance already use — so the feature adds **no tick of its
own**, and age is the difference of two game-day numbers rather than a running timer, so a
restart cannot reset everyone's clock. A **loaded** box is left alone: deleting furniture
with inventory rows pointing into it orphans them forever, and a forgotten cache with
something in it is a better story than a vanished one.

`deploy` is tag-gated on the carried box, which is how it shares a verb with
`plugins/generator` — two plugins may register one specialized action when the **gate**
differs, the same way `use` belongs to both the ATM and the TV. ⚠ It could not be a plain
command: `deploy` as a global verb is the generator's, and a plugin command silently beats
a specialized action.

## The courier (phase 4)

**A cache is never conjured.** An authored drop does not spring into existence when a
dialogue node fires — `BOOK_COURIER` commissions one, an NPC walks it there on ordinary
movement, and puts it in. Until they arrive there is nothing to find, so a player told
early can get there first and watch it happen.

⚠ **The one who tells you and the one who stashes are never the same NPC**, and booking
enforces it rather than trusting authoring. The advisor knows *where*, the courier knows
*what*, neither knows both — so killing, robbing or interrogating the advisor still leaves
you looking for the courier, and whoever watched the stash has no idea who paid for it.
⚠ Neither NPC's dialogue may ever name the other.

⚠ **It waits for privacy and stashes anyway when patience runs out** (4 minutes). This is
deliberately not a deadlock: if a loiterer could deny a drop, standing in a room would be a
hard counter to the whole system — discoverable in one evening, unbeatable after — and
worse, every drop you *didn't* see would be one that provably hadn't happened, turning a
system built on ambiguity into a reliable sensor. The recipient never counts as a witness.

**The line it broadcasts is the same one cover traffic uses.** On stashing it asks
ambient-life for a `handling` line naming the courier — the identical pool fourteen
non-couriers draw from every day. That is the rule the whole thing rests on:

> A line is deniable if and only if non-couriers emit it more often than couriers do.

Covert is not invisible. The act is performed in front of you, described accurately, and
reads as nothing. ⚠ The line never names the container and never fires on a failed stash: a
player paying attention gets one signal only — *this NPC was here, and later there was a
cache here* — and that must stay inference.

**Nothing imports across plugins.** `zone.witnessed` (surveillance's cameras-and-cops
sweep) and `ambient.categoryLine` (ambient-life) are both reached by **hook**, the same
reason the ESP actions live inside `plugins/emergency` rather than being called from unrest.
⚠ Both degrade to "no": without surveillance the courier judges the room on who is standing
in it, and a missing line must never mean a missing stash.

Bookings are **RAM only**, like the unrest incidents and for the same reason — a booking
holds a live NPC and a half-walked route, and a persisted "somebody is on their way" that
outlives the walk is a promise the world cannot keep.
