# Strays — the cat in Dray Lane

**STATUS: BUILT** (`plugins/strays/`, `plugins/search/`)

A grey tabby called Cathode lives in Dray Lane. Her right front leg stops at the
wrist and continues as machined steel. Most of the time she is not there. Every
few minutes, if somebody is standing in the lane, she comes out for a minute or
two, does cat things, and goes again.

You can pet her, which is worth sanity and an accolade. You can kill her, which
is easy, permitted, costs you and everyone watching, and takes her out of the
world for a day. **She remembers which you did, permanently.**

---

## 1. Why this exists

Every other NPC in Coldwater is transactional — a vendor, a dealer, a
quest-giver, a mark. There was nothing in the city you could have a relationship
with that wasn't an exchange. Petting a stray is the smallest possible kindness,
it pays almost nothing, and the game had no way to notice you'd done it.

The design constraint that produced everything below: **the kindness has to be
rare and the cruelty has to be easy**, or it isn't a moral choice, it's a vending
machine.

## 2. The four decisions

### Hiding is absence, not suppression

There is no hidden-NPC concept in the engine and this does not invent one. While
hidden, Cathode is in `zone_dray_lane_den` — a real zone, no exits, `map_id:
null`, `parent_zone: zone_district_921_907`, unreachable by movement and not on
any map.

So `look`, `getZoneNpcs`, SIFT, `attack` and `pet` **all agree, for free**,
because there is only ever one truth about where she is. The alternative — a
`flags.hidden` honoured by the room-description filter — would need honouring by
six other readers too, and the first one anybody forgot would be an invisible cat
you could still stab.

### The den is also the fail-safe

`home_zone` is the den. That single authored field means the engine's own boot
placement (`server/engine/world.js`) and its own respawn
(`server/engine/gameLoop.js` `npcWanderTick`) both return her to hiding **without
knowing this plugin exists**. The default state after any restart, crash, or code
path nobody anticipated is *hidden*, which is the safe one.

`content:lint` enforces the other half: `zone_id` is a runtime column and may not
be authored, so the den is reached through `home_zone` or not at all.

### We retune the engine's respawn timer, we don't replace it

`server/engine/combat.js` sets `npc._respawnAt = Date.now() + 60_000` on any NPC
death. The 24-hour hide **is that same field with a bigger number in it**, written
as the first synchronous line of the `npc.killed` handler.

> **This is the most fragile line in the feature.** `emit()` is fire-and-forget.
> If an `await` ever creeps above that assignment, `npcWanderTick` can fire in the
> gap and put the cat back in the world sixty seconds after she died, and the
> entire 24-hour grief window silently becomes a one-minute sulk. Nothing else in
> the codebase would notice. `plugins/strays/regress.js` asserts the window is
> greater than 23 hours.

There is **no respawn code in this plugin at all**. The world flag
`stray_cat_hidden_until` is an independent second mechanism covering the one case
the RAM field cannot: a restart, which clears `_dead` entirely. Either alone
holds the line; neither can strand her.

### `zone.npcs` has no reconciler

`reconcileZoneMembership()` repairs `zone.players` drift because that drift
silently breaks broadcasts. There is **no equivalent for `zone.npcs`**. A raw
`zone.npcs.add/delete` that gets it wrong produces a cat who is in two rooms, or
in none, permanently, with no self-heal and no error.

Every position change goes through `moveNpcToZone()` and nothing else. The
regress suite asserts she is in exactly one room after every transition.

## 3. State model

| Fact | Where | Why there |
|---|---|---|
| `stray_cat_pets`, `stray_cat_kills`, `stray_cat_pet_at` | `player_flags` | durable, never decays, never cleared |
| warmth / familiarity | `player_npc_relations` (`adjustRelation`) | tiering, decay and VINE conditions for free |
| `stray_cat_hidden_until` | `world_flags` | must survive a restart |
| appearance window, recency ring, follow-flag | RAM (`plugins/strays/index.js`) | losing it costs one appearance |

**Two stores for the memory, on purpose.** Warmth is a shared substrate — buying
things, being clean, standing near people all nudge it, and it decays. The fact
that you killed this animal must not be launderable by being pleasant for a
fortnight. So it lives in its own flag, never decays, and outranks everything
else.

No schema change: three player flags and one world flag, per the
no-sparse-columns rule.

### `moodToward()` — the one function every reaction derives from

```
kills > 0                     -> 'flee'      won't approach; can't be petted; can't be found
pets >= 5 (or 1 + familiar)   -> 'seek'      comes to you, greets you; brings you things at 10
pets >= 1                     -> 'neutral'   knows you; doesn't fuss
otherwise                     -> 'wary'      watches from exactly out of reach
```

Awaited but **query-free** — flags and relations are both hydrated at login.
Resolved once per player per tick in `buildCtx()` and handed down as a string;
never called from inside the behaviour loop.

## 4. The appearance window

`schedule('30s', strayTick)` — idle-gated by default, which is exactly right: a
cat appearing to nobody is wasted.

```
hidden until the deadline?        -> nothing
dead?                             -> nothing
already out?                      -> one behaviour beat at 65%; leave when the window ends or the room empties
inside the quiet gap (4-9 min)?   -> nothing
otherwise -> pick an occupied lane tile and surface for 45-120s
```

A room whose **only** occupants have killed her is not a candidate at all —
surfacing there just to bolt would burn the whole quiet timer on a non-event.

The lane is six contiguous tiles, `zone_district_921_903` through `_908`, with a
dead-side pocket at `_907` (no east exit) which is where the den hangs off.

## 5. The behaviours

32 entries in `plugins/strays/behaviours.js`, code rather than content: every one
is welded to a predicate over live world state, so there is nothing an author
could edit without editing the gate beside it.

| Group | Count | Gated on |
|---|---|---|
| the paw | 7 | always |
| weather | 4 | `currentPrecip`, wind |
| time of day | 4 | `env.hour` |
| the room | 5 | furniture names, `flags.terrain` |
| what it remembers about you | 6 | `mood`, pet count |
| just a cat | 8 | always |

Selection filters by gate, drops anything in a 6-deep recency ring, then picks by
weight. If recency starves the pool it allows a repeat rather than going silent —
**silence reads as a bug, a repeat reads as a cat.**

> **The plain-cat baseline is load-bearing.** Without those eight, every
> appearance is A Bionic Paw Moment and the animal reads as a mechanism with fur
> on it. The paw should be something you notice about a cat, not the reason the
> cat exists. `regress.js` asserts `loaf` and `groom` survive.

`flee_bolt` is fired directly on surfacing, never picked from the table — a
killer never gets a window.

## 6. Petting

The engine's `cmdPet` (`server/engine/commands/social.js`) gained two lines: a
`npc.petAttempt` hook before the wholesome default, and an `npc.petted` emit
after it. Same convention as the `npc.talk` hook directly above it — return
`undefined` to fall through, a response object to claim.

The plugin **claims**, because the default line is generic and this is the one
animal in the game the line is about. Claiming means the engine does not emit, so
the plugin emits `npc.petted` itself on the identical success condition. Exactly
one fires per pet.

- **+6 sanity**, on a **6-hour cooldown** (`stray_cat_pet_at`).
- Inside the cooldown the pet still *works* and still reads warmly — it just pays
  nothing and doesn't bump the counter. **Never punish a player for petting a
  cat; just don't pay them twice.** So "a regular" means six real days.
### The refusal ladder

A killer who keeps reaching for her gets a worse answer each time, and **the
ladder is the animal's, not the game's**: warn, then defend, then leave.

| state | answer |
|---|---|
| 1 kill, first reach | **hiss** — a warning, flat to the ground, and a real one |
| 1 kill, reaching again | **bite** — 2–4 HP, self-defence, over at once; she leaves |
| 2+ kills | **bolt** — no warning, no defence; she is simply not there |

That order is the whole characterisation. A cat that bit on the first reach
would be vicious; one that never escalated would be scenery. Killing her twice is
the point at which she stops treating you as a person she has a problem with and
starts treating you as weather.

**There is deliberately no rung above bolting.** She never becomes hostile, never
hunts you, never gets a revenge arc. She just goes.

> The bite is floored at **1 HP, never 0**. A cat must not be able to kill a
> player — that would route a `pet` command into the entire death path (corpse,
> gear, respawn, wanted state) and would be absurd besides. Do not "fix" this to
> match the ordinary damage helpers.

The attempt counter is RAM (`refusalAttempts`): forgetting it on a restart costs
one extra hiss, and the durable fact — the kill count — is the flag that decides
which ladder you are on in the first place.

**No rung ever says why.** No NPC explains it and no message names it. The player
knows. `regress.js` checks *every* authored line on *every* rung against an
accusation pattern, not just whichever one a run happened to roll — a random pick
means a leaky line would only fail the build sometimes, which is worse than not
testing it.

> `cmdPet` builds its candidate pool from **spread copies** (`{ ...n }`), so the
> `npc` a subscriber receives is not the live NPC. Read its flags freely;
> re-look-up by id before mutating anything.

## 7. Killing

Ordinary `attack`. Deliberately **no `flags.no_attack`** — that would make her a
statue with a personality, and the whole weight of the feature is that killing
her is easy, permitted, and yours.

1. `_respawnAt` → +24h, synchronously (§2).
2. `stray_cat_hidden_until` → +24h.
3. Killer: **−18 sanity**, kill counter, warmth −60.
4. Every witness in the room: **−6 sanity** and a directed line.
5. Every NPC in the room, against every player present: **warmth −12**. Sync and
   query-free, so this adds no round trips however busy the room is.
6. The death line, which is deliberately not funny.
7. `plugins/gossip` spreads it through town for free off the same event.

Steps 2–7 are wrapped: a sanity write failing must never cost the hide.

## 8. Calling her

You don't type a verb. You shout her name, anywhere in Coldwater:

```
Cathode!          Here Cathode!!          call cathode
summon cathode    pspsps  (psps, pspspsps, …)
```

Registered with `registerInputMatcher`, not `registerCommand`, because it isn't a
command — there's no verb `cathode`, there's a person in a street saying a name
out loud.

> **Bare `call` and `summon` belong to gametable (poker).** Verb ownership is the
> plugin loader — one plugin per name, and a second claimant logs a collision and
> silently wins or loses. **SIFT does not arbitrate this**: it resolves which
> *target* you meant among candidates, and its `context.verb` is only a replay key
> so the picker knows which handler to re-invoke. So every pattern above except
> `pspsps` **carries her name**; bare `call` never reaches this plugin and still
> folds a hand. Matchers run before command routing (`commands/index.js` —
> `fireInputMatchers` at :294, `fireCommand` at :297), which is what lets the named
> form win without taking a verb off anybody. `regress.js` asserts bare `call` and
> `summon` are *not* matched — that check exists to protect poker, not the cat.
>
> The house pattern for genuinely sharing a verb is **context fallthrough, not a
> prompt** — see `listen` in [plugins.md](plugins.md), which means "what's on" with
> a radio in the room and falls through to the engine sense everywhere else.

### Spamming does not help, and the code has to mean it

There is deliberately **no streak counter, no pity timer, no "you're due"**. The
per-call chance is flat. An escalating bonus would make this a slot machine with a
60-second lever, and the optimal play would be standing in an alley shouting at
nothing for an hour.

Two gates, because one wouldn't be enough:

| gate | value | why |
|---|---|---|
| between attempts | **60 s** | the ask |
| after she actually comes | **45 min** | she is not a taxi |

The 60 s alone does not deliver "rare": an hour of shouting is ~60 rolls, and any
workable chance turns that into a reliable summon. The second gate is what keeps
her rare against a patient player without punishing anyone.

**The relationship is the only thing that moves the number** — which is the whole
point of the system:

| mood | chance |
|---|---|
| `wary` (stranger) | 4% |
| `neutral` (petted once) | 9% |
| `seek` (a regular) | 20% |
| `flee` (a killer) | **never** |

She won't come outside Coldwater (`region_id`), into a transient zone (void rooms,
dreams), or while she's already out — it's a call, not a teleport. A killer gets
**the ordinary miss line**, never a special one: a bespoke message would tell them
what they'd done. Regress asserts that specifically.

Misses never hint. You cannot tell "three streets away" from "dead" from "heard
you and didn't care", which is correct — you are shouting a cat's name in a city.

Discovery is Dorrit: *"You shout her name… She'll not come, mind. Nine times in
ten she'll not come. That's not the shouting being wrong, that's a cat."*

## 9. `search` — `plugins/search/`

A new single-shot verb, unowned before this. One `scavenging` check (there is no
perception skill and this was not the place to invent one), and results
contributed entirely through the **`search.provider` gather hook** — the same
seam as `workspace.provider` and `zone.smells`, so contributors import nothing and
need no load-order declaration.

Two providers ship: `strays` (finds the cat, priority 50) and `concealment`
(notices that a disguise piece is a disguise piece — never the code, never what's
behind it, priority 200).

Three rules, all in [plugins/search/README.md](../plugins/search/README.md):
**search never pays out** (the cooldown is per-zone, so a district grid makes any
loot provider a faucet limited only by walking pace — extend the scavenging tables
instead); **a failure must be indistinguishable from an empty room** (no
near-miss lines, asserted against a leak pattern in regress); **it is not a
posture** (`scavenge` already owns that shape).

A player who has killed the cat always gets the ordinary failure prose. She is
right there. She will not be found by them. This is never stated anywhere.

## 10. Accolades

Four entries in `plugins/accolades/catalog.js`:

| key | on |
|---|---|
| `bionic_purr` | `npc.petted` |
| `regular` (six pets) | `npc.petted` |
| `nine_lives_one_paw` | `npc.killed` |
| `found_you` | `stray.found` |

Two new events: `npc.petted` (engine + plugin, §6) and `stray.found` (plugin).
Both are registered in `plugins/accolades/regress.js`'s `KNOWN_EMITTERS`
allowlist, which fails the build for an accolade listening to an event nothing
emits.

## 11. Tone rules

**Nothing explains the paw.** Dorrit Tallow, the salvage man in `_921_907` who
named her, has examined it twice and does not know who fitted it. That is the
whole of the lore. If you add an answer, the stray stops being a stray and
becomes a quest.

**He named her wrong, and won't be corrected.** He thought the paw looked like a
cathode. It doesn't. He'd been on the blanket four days and hadn't learned the
trade yet, and he is entirely unembarrassed about it.

**She is not cute at the player.** She is busy, and you are allowed to watch.

**The killing is not funny.** The accolade is dry because the Architect files
rather than moralises. The sadness is carried by the room prose at the moment it
happens. Keep the voices apart.

## 12. Traps

1. **The 60s-vs-24h race** (§2). Assert it, never move it.
2. **`zone.npcs` has no reconciler** (§2). One funnel: `moveNpcToZone`.
3. **`cmdPet` passes spread copies**, not the live NPC (§6).
4. **A dev-panel NPC move writes a home override** (`world.js`) that beats the
   authored `home_zone` on the next boot. Drag Cathode out of the den once in the
   dev panel and hiding stops working forever, silently. The tick logs a one-shot
   warning if `home_zone !== zone_dray_lane_den`; if you see it, fix the row.
5. **`isAnimal()` matches on substring** (`social.js`) and already contains
   `'cat'` — which is exactly why `Cathode` is pettable with no list edit. If the
   name is ever changed, re-check it against that list or `pet` stops working.
6. **`plugins/corps` destabilises territory on any `npc.killed`**, so killing the
   cat nudges corp stability. Emergent and arguably correct; know it before
   somebody files it as a bug.
7. **Never touch the DB from the 30s tick.** The kill handler's per-witness
   `UPDATE players` is fine — rare, bounded by one room. Do not copy that shape
   into the tick.
