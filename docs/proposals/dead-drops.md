# Dead drops — a cache a stranger can find

**Status: DESIGN ONLY, with one exception** — the `handling` ambient routines of
§9 are seeded and live as ordinary street life, deliberately ahead of everything
else here (see the base-rate rule). No other part of this document is built.

A dead drop is a container in a public room that one player stocks and another
player empties, without the two of them ever being in the same place. The engine
already has the *placing* half. This proposal is the *finding* half: `search`
becomes the thing that turns a stranger up at your cache, and everything else
here exists to make that survivable.

---

## 1. What already exists (and is not being rebuilt)

| Piece | Where | What it already does |
|---|---|---|
| Item in a container, not on the floor | `spawnInContainer` via the VINE `spawn` node's `container` field ([server/engine/graph.js:139](../../server/engine/graph.js)) | Authored dead drops. Deliberately does **not** fall back to the floor — a drop that misses its container is skipped, because a leaked drop is worse than a missing one |
| Opening a container | `plugins/container` — one specialized action, `open`, gated on the `container` tag | The retrieval verb. Unchanged by this |
| Furniture that is a hole to put things in | `flags.container` (capacity, grams) | The cache row itself |
| Furniture the room description refuses to mention | `flags.concealed` ([commands/describe.js](../../server/engine/commands/describe.js) — the same filter a planted spy camera uses) | The concealment primitive. **Already exists; this proposal consumes it and adds nothing to it** |
| A locked face over a hidden piece | `plugins/concealment` — `conceal_hides` / `conceal_code`, keypad private, reveal public | The "found it, still can't open it" layer in §4 |
| The one-deliberate-look roll | `plugins/search` + the `search.provider` gather hook | The finding seam |
| A named fixed cache, air-serviced | `FENCE_CACHES` ([plugins/flight/contracts.js:319](../../plugins/flight/contracts.js)) | Prior art, and explicitly **out of scope** — those are `cargo_drops` rows, not containers, and nothing here touches them |

The only genuinely new state is §6.

---

## 2. The three decisions

**A dead drop is a CONTAINER, never a new kind of thing.** The moment it has its
own table it needs its own capacity, its own item rows, its own `look`, its own
loot-on-death interaction and its own way to be full. A cache is a furniture row
with `flags.container` and `flags.dead_drop`, and every one of those questions is
already answered. If you are writing a `dead_drops` table you have gone wrong.

**`search` reveals the CACHE, never the contents.** The provider returns
knowledge — *there is a cache here* — and the item comes out through `open`,
which is a placed item somebody paid for, not a generated one. This is the
`search`-never-pays-out rule ([plugins/search/index.js:25](../../plugins/search/index.js))
kept exactly, not argued around: the same relationship `strays` has to Cathode.
⚠ **The provider must never create the cache on a successful roll.** A cache that
springs into existence because you rolled well is a faucet whose only limit is
walking pace, and it is the specific failure the whole plugin is built to refuse.

**Finding is not opening.** A stranger's success makes the cache visible. Whether
they can get into it is a second, separate problem, answered by machinery that
already exists (§4). Without this split, "search can find it" degrades to "every
drop in the game is on a timer," which makes the feature a tax on the dropper
rather than a risk.

---

## 3. The finding roll

A new `plugins/deaddrop/` declaring `search.provider`. No imports into `search`,
no `after:` ordering — the same shape `concealment` and `strays` use.

```js
function searchForCaches({ player, zoneId, margin }) {
  const cache = hiddenCacheIn(zoneId);          // furniture, flags.dead_drop + flags.concealed
  if (!cache) return null;
  if (knowsCache(player, cache.id))             // the drop is YOURS, or you were told
    return { found: true, priority: 40, message: knownLine(cache) };
  if (swept(player, cache.id)) return null;     // §6 — you have already had your look
  if (margin < STRANGER_BAR) { markSwept(player, cache.id); return null; }
  markSwept(player, cache.id);
  return { found: true, priority: 60, message: strangerLine(cache) };
}
```

**Two priorities, on purpose.** 40 beats `strays` (50), because your own cache
outranks a cat when you are deliberately looking for it. 60 sits under `strays`
and over `concealment` (200), because a genuinely findable *thing* should beat a
hunch about panelling, but a live animal in the room beats a box that will still
be there in a minute.

**`STRANGER_BAR` is a wall, not a delay.** Start at **margin ≥ 12** against
`scavenging`'s difficulty 4 — compare `concealment`'s 6, which guards nothing but
a bad feeling, and `strays`'s 6, which guards a cat that wants finding eventually.
This one takes somebody's property. A character with poor Brains/Reflexes and no
`scavenging` should be unable to sweep a district productively *at all*, and the
tuning target is that statement, not a percentage.

**The knower ignores the margin entirely.** The roll cannot distinguish "this
player was told" from "this player is lucky" — the provider only sees `margin` —
so reliability has to come from the player's own state, never from a lowered bar,
which would lower it for the stranger standing next to them.

---

## 4. Finding ≠ opening

The strongest version of this: `search` clears `flags.concealed`, and the cache
is *still* behind a keypad.

That layer is `plugins/concealment` **used as authored, with no changes**. A
paranoid dropper's cache is two furniture rows — a disguise piece with
`conceal_hides` pointing at a container with `flags.concealed` — which is exactly
the chem-lab shape. `search` then reports the seam and the finder needs the code;
the concealment plugin's own provider (priority 200) is the fallback for the case
where the disguise is not a dead drop at all.

A cheap cache is one row, `flags.concealed`, no keypad: found is opened.

**This is a spending sink, and that is the point.** It gives a dropper something
to buy, and it turns a successful sweep into a second problem rather than an
instant payout.

---

## 5. What the lines may say

The tone rule is inherited whole from `search`: a failure must be
indistinguishable from an empty room, and `regress.js` asserts every failure line
against a leak pattern. Nothing here weakens that — a failed cache roll returns
`null` and the player reads one of the ordinary `FAILURES`.

A success must not name the owner, the contents, or the quantity:

> Someone has been using this bin for something other than rubbish.

> There is a gap behind the meter housing, and it has been widened by hand.

⚠ **No line may imply a person.** "Someone" is a fact about the widened gap, not
an accusation, and the finder should leave still not knowing whether they have
found a courier's drop or a squatter's stash. They open it to find out, the same
as everything else in this game.

---

## 6. The new state: swept

One cooldown, and it is **per cache per player**, not per zone.

`search`'s own cooldown is per zone and RAM-only, which is right for what it
guards. It is wrong here: a district grid means a failed roll can be re-rolled by
stepping one tile out and back, which converts `STRANGER_BAR` from a wall into a
wait. So a stranger's roll against a specific cache is stamped whether it
succeeded or failed, and that cache refuses to be reconsidered by that player for
a long window (start at **6 hours**).

Per the persistence tiers, and per the no-new-`players`-column rule, this is
RAM-authoritative with a `player_flags` write only for the window that matters:

- **In RAM**, keyed `${playerId}:${cacheId}`. A restart costs a re-roll, which is
  the same trade `search`'s own cooldown makes.
- **`player_flags`** carries the *knower* half only (`deaddrop_known_<cacheId>`),
  because being told where a drop is must survive a logout — that is the whole
  value of being told.

**Disturbance is a flag on the cache, not a log.** When a stranger opens one,
set `flags.dead_drop_disturbed` on the furniture row through `updateFurniture`
(the funnel `concealment` already writes `concealed` through, so the world cache,
the room description and this all agree with no new seam). The owner sees it on
their next `open`. ⚠ **It records that it happened, never who** — an owner who
learns the name has been handed a kill order by the UI, and the answer to "who"
is SPECTER's, which is the system built to answer it.

---

## 7. Authoring

Nothing new in the dev panel. A cache is furniture:

```
flags.container   = 8000          // grams, as any container
flags.dead_drop   = true          // makes it findable by this provider
flags.concealed   = true          // the engine's own visibility filter
```

Plus, optionally, the `concealment` pair from §4. New keys go in
[docs/flags-keys.md](../flags-keys.md) with `deaddrop` as owner when this is built.

---

## 8. Phasing

| Phase | What | Proves |
|---|---|---|
| 0 | `plugins/deaddrop/` + the provider, knower path only (`margin` ignored, no stranger branch) | The seam, with zero risk to anybody's property |
| 1 | The stranger branch + `STRANGER_BAR` + the swept window | The wall holds against a real sweep |
| 2 | `dead_drop_disturbed` on the owner's next open | The story half |
| 3 | Player-placed caches — a dropper stocks one themselves (§8b) | Everything above is content-agnostic; this is the first thing that needs a verb |
| 4 | NPC couriers place and lock the authored caches; `hack` opens them (§9) | The drop becomes an event in the world rather than a flag |

### 8b. Phase 3 — the player-placed cache

Phases 0–2 are authored caches, and their worst failure is a quest item going
missing. Phase 3 is the moment `search` becomes a way to take another player's
property, so its three decisions are recorded here rather than left to whoever
builds it.

**A cache is bought, carried and deployed.** You buy a stash box — an ordinary
item — and `deploy` it in a room, which mints the furniture row; picking it up
again removes it. Placement is therefore limited by what you paid for, the world
gains no furniture nobody bought, and the concealment tiers of §4 have something
to be sold alongside. The rejected alternative, *any existing container in a
public room*, needs no content at all and is exactly why it fails: every bin and
locker in the game becomes potentially somebody's stash, which makes a sweep
worth doing in every room in Coldwater, forever.

**Decay is stateless, on the rent cycle.** An untouched cache goes stale and is
cleared a cycle later, derived from the game date the way `zone-filth.js` already
derives its 7-day sweep — so a restart cannot reset everyone's clock and no
reaper tick exists. This is what stops the map silting up with the boxes of
players who stopped logging in. ⚠ Do not add a timestamp column for this; the
cadence is a function of the date, and the moment it is stored it is a thing that
can disagree with itself.

**Taking somebody else's cache is not a crime — finders keepers.** No wanted
stars, no witness check, no ownership test at `open`. A found cache is simply
lost, which is the tone this game is written in.

⚠ **That decision is what makes §4 load-bearing.** With no legal defence, the
only two things between a stocked cache and a sweeper are `STRANGER_BAR` and the
keypad. So:

- The one-row cache (concealed, no keypad) is the **disposable** tier. It is for
  a handoff measured in minutes, and losing one should feel like weather.
- The `conceal_hides` pair is the tier you buy when the contents matter, and its
  price should reflect that it is the *entire* defence rather than half of one.
- `STRANGER_BAR` must be tuned against a stocked player cache, not an authored
  one. If a competent sweeper clears a district's caches profitably, the bar is
  wrong — and the fix is the bar, never a crime flag bolted on afterwards.

The tempting fourth rule is a "nominate a recipient" pairing, so only your
courier can open it. Deliberately not built: it turns a dead drop into a mailbox,
and the reason to use one is precisely that the world can get at it and mostly
doesn't.

## 9. Who actually stashes it — the courier

**A cache is never conjured.** An authored drop does not spring into existence
when a dialogue node fires; an NPC walks it there and puts it in. This is the
single decision the rest of this section falls out of, and it is worth the extra
machinery because it turns the whole feature from a quest-flag into a thing that
happens in the world, at a time, in front of whoever is standing there.

The VINE node that used to be `spawn` + `container` (§1) instead **books a
courier**: an NPC is dispatched, walks to the zone on ordinary NPC movement, and
stashes on arrival when it can. Until it does, there is nothing to find, and a
player who was told early can get there first and watch it happen.

### The two NPCs are never the same NPC

The one who **tells** you and the one who **stashes** are different characters,
always, and this is enforced rather than merely authored — booking a courier
excludes the advisor from the candidate set.

It reads as tradecraft, and it is: the advisor knows *where*, the courier knows
*what*, and neither knows both. But the mechanical reason is that it stops one
NPC being the entire chain — kill, rob or interrogate the advisor and you still
have to find the courier, and the person who watched the stash happen has no idea
who commissioned it. ⚠ **Neither NPC's dialogue may ever name the other.**

### Waiting for the coast to be clear — and going ahead anyway

A courier **prefers** an empty room and will wait a short while for one. The
check is `isWitnessed(zoneId)`
([plugins/surveillance/index.js:1471](../../plugins/surveillance/index.js)) — the
same cameras-and-cops sweep the wanted system already runs — plus any player
present who is not the one the drop is for.

⚠ **But it stashes regardless when its patience runs out.** These are hired
hands doing this for the fourth time this week, in a city where nobody looks up.
The job is covert, not impossible, and it gets done.

**This is deliberately NOT a deadlock design, and the reason matters.** If a
loiterer could deny a drop, then standing in a room would be a hard counter to
the entire system, discoverable in one evening and unbeatable thereafter — and
worse, every drop the player didn't see would be one that provably hadn't
happened yet, which converts a system built on ambiguity into a reliable sensor.

The room is not being lied to when this happens, because the stash still emits
its line. **Covert is not invisible**: the act is performed in front of you,
described accurately, and reads as nothing. Missing it is a failure of attention,
not a thing the game hid. That distinction is the whole feature, and it only
works because of what the line is drawn from.

### The line it broadcasts

When it stashes, the room gets a line, and the line comes from the
`handling` category of `ambient_routines` — **the same table, drawn by the same
`plugins/ambient-life` tick that fires it for NPCs who are not couriers and are
not doing anything.** ✅ **Those 14 routines are seeded and shipping**
(`content/ambient_routines/routine_handling_*.json`); they are the only part of
this document that exists, and they exist as ordinary street life.

**Deniability is a BASE RATE, not a wording.** This is the rule the whole section
rests on:

> A line is deniable if and only if non-couriers emit it more often than couriers
> do.

No amount of careful phrasing survives a line that only ever appears when a stash
happened. Players will have it pinned inside a week and it becomes a notification
with extra steps. Which is why the cover traffic is content that ships *first*
and independently: by the time a courier ever draws one, players have been
reading these lines on street corners for months and have learned they mean
nothing. Because they do mean nothing, nearly always.

**The line names the NPC, in both cases.** A routine line may now carry `{npc}`,
which resolves to a real, idle, present NPC — the `{npc}` convention `home-life.js`
and `intrusion.js` in the same plugin already used, extended to the DB routine
pool (`matches()` + `fireRoutine()` in
[plugins/ambient-life/index.js](../../plugins/ambient-life/index.js)). Eligibility
is `eligibleNpcs()`, now exported from
[server/engine/npc-banter.js](../../server/engine/npc-banter.js) — one predicate,
so an NPC who is asleep, on shift, in combat or mid-trade is never described
crouching over a bootlace in the road, for the same reasons they never banter.

Naming is what makes this read as the world rather than as scenery, and it is
what makes the courier's line *the same string* as the cover — a matched pair of
anonymous and named lines would have been a tell in itself. It also gives the
player something to hold: not "somebody was here" but *Halloran was here*, which
is a suspicion you can carry to the next room.

⚠ **A routine carrying `{npc}` with nobody eligible in the room is SKIPPED, never
printed.** Gated at `matches()` and re-checked at fire time, because the tick and
the fire are not the same instant and an NPC can walk out in between. Regress
covers both, plus the routine-with-no-lines case.

Each line puts hands somewhere out of sight for a stated ordinary reason, with
the destination unstated:

> Halloran crouches at the base of the meter housing, retying a boot that did not
> need it.

> Halloran goes through both pockets by the vent grille, finds whatever it was,
> and keeps walking.

> Halloran ties off a bin bag and leaves it among the others, without looking
> back at it.

The test a new one has to pass is not "is it innocuous" — it is **could this have
been a stash, and does it also read as nothing?** "Checks their reflection in the
glass" fails the first half: nothing could have been left, so a player learns to
skip it and it is cover that covers nothing. "Tucks something behind the housing"
fails the second: that is not deniable, just quiet.

⚠ The line must never name the container, and must never fire on a *failed*
stash. A player paying attention gets one real signal and one only: *this NPC was
here, and later there was a cache here*. That must stay inference, never
notification.

### Locking, and breaking the lock

The courier **locks what it stashes**: the cache is the `conceal_hides` pair from
§4, and the courier writes a rolled `conceal_code` on arrival.

The advisor gives you the code. That is what being told is *worth*, and it is
now cleanly separated from being told *where* — two different NPCs, two halves,
and losing either one leaves you with a real but harder problem.

For everyone else there is **`hack`**. The keypad becomes an ordinary `hack`
target — the same specialized action, the same Circuit Breach, the same deck
condition bill as an ATM or a vendor safe (`marginOf` in
[hack-gear.js](../../server/engine/hack-gear.js)), at a difficulty set by what
the dropper paid for. Success reveals the code and opens it.

Two notes on that:

- ⚠ **It is not a crime, per §8b.** No stars, no witness roll on the hack itself.
  Nobody reports a stash — that is what makes it a stash — and adding a crime
  flag here would quietly reintroduce the law that §8b decided against.
- The hack difficulty, not a crime flag, is the cache's real defence. It is the
  same knob as `STRANGER_BAR` and should be tuned with it: `search` decides
  whether you *find* it, hacking decides whether you *get* it, and a player who
  is good at exactly one of the two should be reliably stopped by the other.

### Phasing note

This is **phase 4**, after §8b. Phases 0–2 can ship with the cache placed
directly, because an authored cache with no courier behind it behaves correctly
in every respect — it is simply less interesting. Nothing in this section
invalidates anything above it.

## 10. Regress

`plugins/deaddrop/regress.js` must assert, at minimum:

- a knower finds their cache at `margin` well below `STRANGER_BAR`
- a stranger below the bar gets a line matching the existing `search` leak
  pattern (i.e. an ordinary failure, indistinguishable from an empty room)
- a second stranger search inside the swept window returns `null` **even on a
  margin that would have succeeded** — this is the re-roll hole and it is the one
  a refactor will quietly reopen
- no success line contains a player handle or an item name
- a courier with a player parked in the room **still stashes** once its patience
  window has elapsed, and the cache row exists afterwards — loitering must never
  become a hard counter, and this is the assertion that stops one being
  reintroduced as a "fix" for players complaining they missed a drop
- the stash broadcast is a member of the ambient-life pool (assert the line is
  drawn from that array, not from a private one — this is the deniability, and a
  well-meaning refactor that gives couriers "better" lines silently deletes it)
- the booked courier is never the advisor
