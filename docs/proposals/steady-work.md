# Proposal: Steady Work (careers / advanced jobs over the quest system)

**Status:** **BOTH archetypes BUILT** (`plugins/work/`) — regress-covered
(`plugins/work/regress.js`, 1239/1239).
- **Shift** (`plugins/work/index.js`): the XP gate, venue opt-in (`flags.work_venue`),
  the posture-tick with satisfaction meter + seeded rush + sent-home fail, wage+tips
  payout, the five response verbs. **Two venues** now — Meltwater Diner (`pool:'diner'`)
  and Voltage nightclub (`pool:'bar'`, a Brawn/Cool-leaning event set); a venue picks
  its event pool via `flags.work_venue.pool` (named `POOLS` registry in index.js).
- **Courier** (`plugins/work/courier.js`): the board generator, `courier`/`runs`
  (list / `courier <n>` take), `deliver`, `crack`. The run is a real keepable parcel
  item whose `custom_data` IS the run (no quest row, no player field). Parcel classes
  clean/sketchy/hot; sketchy+hot carry the new **`contraband`** tag so the existing
  jail confiscation / `conceal` / gov-checkpoint stack handles a search for free. Hot
  runs are fence-offered via the `OFFER_COURIER_HOT` dialogue action (Voss the
  salvage-broker), gated on `work_fence_blacklist` being unset; `crack` is the
  irreversible theft commit (yields a class-drawn loot item, burns the run) and burning
  a hot run blacklists you + a value-scaled `WANTED_RAISE` bounty.
- **Tablet Work tab**: a **Steady Work** tile in the Tablet Quests app
  (`plugins/tablet/quests-app.js`), sourced live from the courier board (same pattern
  as Pilot Contracts / Job Board), with a Take Run action and an active-run status row.

Chat-first surface stays for both (matching the other posture activities). **Deferred
(not blocking):** the separate physical pickup leg (the parcel spawns on take),
sting/setup hot jobs, the evidence-locker recovery sub-story (confiscation still works
automatically), and per-employer rep progression. It sits above the existing
[job board](../systems-jobboard.md); read that first.

## One-line

A **tier-two job system for players past the newbie phase**: multi-step, timed,
dynamically generated *work* — shifts at a venue, courier runs across the map — that
lives in a **new gated section of the Tablet Quest app** and unlocks at an XP
threshold. Where the job board is quick errands, this is *employment*: it takes real
time, competes with your other activity, and can be failed.

## Why this fits what's already built (don't reinvent around it)

Three layers already exist that this composes over:

1. **`jobboard`** — legal early-money gigs, greeter-gated, quick one-and-done tasks.
   Steady Work is its grown-up sibling: same *take → do → turn in* spine, longer and
   stateful.
2. **`quests` (unified)** — the DAG-backed record the job board and flight contracts
   both feed through, already surfaced in the Tablet **Quest app**. Steady Work is a
   **new quest *category***, not a new engine.
3. **Posture-tick jobs** (mining, fishing, scavenging) — the "stay in a zone and a
   loop ticks" pattern. The **shift** archetype *is* a posture-tick job with a new
   event layer on top. No new tick machinery.

So the net-new surface is small: one generator, one gated tab, two do-phase handlers.

## The category

- New quest category `work` (or `career`), recorded and surfaced through `quests`.
- New **Work** tab in the Quest app, distinct from the existing *Gigs* (job board).
- **Gate: pure XP threshold — 500 lifetime (Total) XP.** Below the line the tab shows
  a locked teaser ("Steady work goes to those who've proven they can survive out here —
  come back at 500 XP"); at/above, the generated Work list. **Key off `total_xp`, not
  net XP** (`ip.js`): Total only ever grows, so the gate never re-locks when a player
  spends XP raising a stat — gating on net would perversely lock a player *for
  investing in their build*. `total_xp` is already loaded on the live player object
  (`livePlayer.total_xp`), so the gate is a **free in-memory check — no query, no
  stored flag, no new `players` column**. 500 XP ≈ five stat-points' worth of earned
  advancement (100 XP/point), a genuine "past newbie" milestone reached through play
  (skill-check IP + job-board grants), not a grind wall.
- Stored per the persistence tiers: the live Work list is generated/cached in memory
  and refreshed by a scheduler tick **idle-gated on `hasActivePlayers()`**; only the
  taken/active job persists as a quest row.

## One generator, two archetypes

A `WORK_TEMPLATES` table drives everything. Each template declares its
`kind: 'courier' | 'shift'` plus slot-fill rules; the generator fills slots against
**live world state** (real zones for endpoints, real venues for shifts) and scales
payout to distance/XP. Adding a third archetype later (repo runs, bouncing a door,
flight delivery) is a new template + one do-phase handler — the take/turn-in spine and
the Work tab are shared.

| | **Courier** | **Shift** |
|---|---|---|
| Do-phase | carry a spawned parcel across the map, beat a deadline | `clock in` → posture-tick with mini-events |
| Reuses | run/GPS-walk, flight, item spawn, conceal + crime/police | mining/fishing tick loop, skill checks |
| Fail states | deadline blown, searched (contraband), downed (fragile/hot) | satisfaction sub-floor → sent home; leaving the zone |
| Reward driver | distance × XP × parcel class | wage (flat) + tip pool (off satisfaction) |

---

## Archetype A — Shifts ("work for a while")

You `clock in` at a venue and enter a `working` posture in that zone. Every tick
(~15–25s, jittered) there's a chance an **event** fires — a small demand with a
response window. A shift is a *sequence* of these; your performance sets the tip pool
at `clock out`.

### Satisfaction meter (what makes it a shift, not loose dice)

The venue holds a hidden `satisfaction` (0–100, starts ~70). Each event nudges it:
nailed → up, botched → down, *ignored (window expired)* → down hard. Wage is flat;
**tip pool scales off ending satisfaction.**

**Fail state (confirmed):** drop satisfaction below a floor and the manager cuts the
shift short — you're **sent home with reduced pay**. Real stakes, matches the tone; a
slow connection or a mid-shift interruption genuinely costs you.

### Event anatomy

Each event = prompt line + response **verb** + **skill check** + **timer**. Three
outcomes: nailed (fast + passed), botched (failed check), ignored (expired, worst).

Food-venue event pool:

| Event | Prompt | Verb | Check | Fail flavour |
|---|---|---|---|---|
| Order up | "Table 4's noodles are getting cold on the pass." | `serve 4` | Reflexes (speed) | cold food, grumbles |
| The check | "Table 2 is waving for their bill." | `bill 2` | Cool | they stiff the tip |
| Fryer fire | "The fryer's smoking — grab it!" | `douse` | Reflexes | burn (HP tick), chaos |
| The regular | "Old Hensley wants his usual and a chat." | `talk` | Cool (patience) | he leaves, employer-rep dip |
| The drunk | "A drunk at the bar is getting loud." | `eject` / `talk` | Brawn *or* Cool | mini brawl or trashed table |
| **Rush** *(meta)* | "Dinner rush — three tables at once." | rapid sequence | stacked | overwhelm if slow |

The **rush** is the skill ceiling: 2–3 events fire in a tight window, forcing triage.
It rewards players who've raised Reflexes/Cool — which is exactly the audience the XP
gate selects for.

### Reuse notes

- `talk` exists; `eject` already exists (strippers / Cherry Pit bouncer). Only the
  fryer/rush verbs are net-new, and they're **local to the working state** — plugin
  verbs that only resolve while clocked in, no global command pollution.
- **Employer variety without new code:** bar / noodle bar / clinic front-desk draw the
  same event pool weighted differently per venue via the template (`event_weights`).
  Clinic leans Intellect (paperwork, waiting patients); bar leans Brawn/Cool (drunks).

---

## Archetype B — Courier runs (dynamic + heat-aware)

Generator emits `{pickup zone, dropoff zone, parcel, deadline, payout, parcel_class}`.
Pick up the spawned parcel, cross the map (rewards run/GPS-walk and flight), hand it
off before the timer.

### Parcel classes plug into the existing crime system

- **Clean** — ordinary goods. No heat. Baseline pay. The bread-and-butter.
- **Sketchy** — "don't ask." Moderate pay bump. Carrying isn't itself a crime, but if
  searched (downed while wanted, or a cop stop) it's confiscated + a small heat bump.
  Plausible deniability.
- **Hot** — knowingly illegal (job text is explicit, pay is high). The parcel is a
  **concealable contraband item** that rides the existing **live-conceal** mechanic;
  get searched → confiscation + real heat + parcel gone (job failed).

A hot run is *literally* "cross the map while concealing," a loop crime-experienced
players already understand — we're adding an objective and a deadline, not a new system.

### Failure branches (a story, not a coin flip)

- **Searched mid-run** → parcel confiscated, job fails, heat applied — but you're not
  downed; you keep playing, poorer and hotter.
- **Downed while carrying** → parcel routes to the **shared evidence locker** (reuse
  the jail confiscation path). Recovering it becomes its own sub-story.
- **Deadline blown** → job expires, parcel despawns / client wants it back. No heat,
  just lost opportunity.
- **The setup** *(spicy, optional)* → a fraction of hot jobs are stings: the "client"
  at the dropoff is plainclothes and the handoff triggers a bust. Telegraph faintly
  (suspicious dropoff zone, pay too good) so savvy players can smell it. High-XP
  risk/reward peak.

### Who gives out hot jobs (confirmed: NPC fences, not the board)

Clean/sketchy jobs sit on the Work board openly. **Hot jobs never board** — they're
offered by **existing fence/dealer NPCs** (Voss the salvage-broker, the drug-war
dealers) via a "you look like you can handle something delicate" dialogue branch. This
makes the illicit tier feel *discovered* rather than menu-selected, keeps heat away
from players the gate hasn't admitted, and reuses NPCs already in the world.

---

## Progression flavour (reward, not gate)

Repeat work for one employer and unlock better-paying roles / a regular's discount —
a light reuse of the ideology-rep pattern, scoped per employer. It's a *reward* layer,
so it never complicates the single XP lock. Deferred to a later pass.

## Build scope (first cut)

1. Reuse `quests` for the record + Quest-app surface; add the `work` category and the
   XP-gated Work tab.
2. **One plugin** (`work`, or folded into `jobboard`) holding: the generator + refresh
   tick, the XP gate, the shift posture-tick + event/satisfaction layer, the courier
   handoff + parcel-class logic, and the fence dialogue hook for hot jobs.
3. Ship **both archetypes** (1 shift venue + courier, clean→hot) to validate the
   template-driven generator against two genuinely different shapes, then content-scale
   via templates.

Adds a `plugins/work/regress.js` per the plugin standard; runs `npm run test:regress`
before any push (new plugin + new verbs).

## Parcel contents & the theft economy (resolved)

**Parcels are real, keepable items** — not opaque quest tokens — but stealing a
shipment is a **crime with persistent, relational costs**, not a clean opt-out. That's
what keeps "keepable" safe to ship: every lever that makes theft *tempting* is wired to
a lever that makes it *costly*, so no per-parcel number-tuning is needed.

**Class-scaled** — the parcel class decides contents and consequences together, one
mechanic across all three:

| Class | Contents | Keepable? | Theft cost |
|---|---|---|---|
| **Clean** | opaque low-value bulk (soylent, parts) | yes, but never worth it | rep hit only |
| **Sketchy** | opaque, sometimes real goods | yes | contraband-carry heat + rep, blind gamble on value |
| **Hot** | opaque, often real drugs/gear | yes | contraband heat + fence reprisal (below) + blind gamble |

Three self-balancing levers, all from existing primitives:

1. **Clean parcels hold boring bulk** — worth less fenced than the payout, so stealing
   is strictly dumb. The honest job wins for honest cargo; no temptation, no exploit.
2. **Temptation lives in sketchy/hot parcels** — those can out-value the payout, but
   they carry the contraband heat (and, for hot, the fence reprisal). Value and danger
   rise together.
3. **Opaque until cracked** — you can't see contents until you **break the seal**, and
   **cracking is the commit: a tampered parcel can never be delivered** (the client
   knows). Stealing is therefore a *blind gamble* — you bet the contents beat the
   payout before you can confirm it, and sometimes a "high-value" hot parcel is cut
   product worth less than the run. That variance kills the always-steal equilibrium
   more cleanly than perfect pricing ever could.

**Economy hygiene:** parcel contents are **drawn from existing loot/vendor tables**,
not minted fresh. A stolen drug parcel is the same drug items the drug system already
spawns — theft *relocates* where players acquire goods rather than opening a new
faucet, keeping the shadow economy inside existing balance.

**Fence reprisal on a burned hot job — scales with parcel value.** Steal a small hot
parcel → the fence blacklists you (cut off from that fence's future work). Steal a
big one → blacklist **plus** a wanted-style **bounty**: their people (and/or cops) come
looking. Proportionate, and it reuses the wanted/heat flag path — the only genuinely
new bit in the whole theft economy.

**What this costs to build:** modest. Parcels are real items (loot-table spawn) tagged
as the quest objective; "didn't deliver" is a rep/heat call into ideology-rep +
crime/heat + the fence relationship (all existing); "break the seal" is one verb that
flips the parcel from deliverable to opened-contraband and fires the client-knows
consequence. Only the value-scaled fence bounty is net-new, and it's a variation on the
wanted flag.

## Resolved tuning (was: open questions)

All four remaining questions are settled below. Each is a tunable — expose via the
existing tunables table so they're adjustable without a redeploy — but these are the
defaults to build against.

**1. XP threshold — 500 Total XP, keyed off `total_xp` (lifetime), not net.** Rationale
in the category section above: Total only grows so the gate never re-locks; it's
already on the live player so the check is free; 500 ≈ five stat-points of earned
advancement, a real "past newbie" line reached through play.

**2. Shift length & cadence — a 7-minute shift on a ~20 s tick.** ~21 tick windows ×
~55% event-fire chance → **~12 events per shift**, with **exactly one rush seeded
mid-shift** so every shift has a guaranteed skill peak. Long enough to feel like a
shift and to compete with other activity; short enough to fit a session and to keep a
dropped connection from costing more than one shift's pay. Tunables: `work_shift_secs`,
`work_shift_tick_secs`, `work_event_chance`.

**3. Hot-job ideology check — none; the fence relationship IS the gate.** Don't
double-gate. A fence *choosing to trust you* is already an earned, in-world barrier;
stacking an ideology/criminal-lean prerequisite on top would make the illicit tier
unreachable for too many players. Instead, hot jobs are **reactive**: running (or
stealing) them **nudges the hidden criminal axis** (the `architect_axis` / drug-war
lean pattern) rather than requiring it up front. Behaviour *shapes* your lean; a lean
is never a prerequisite.

**4. Fence-reprisal escalation cutoff — bounty when stolen fenced value ≥ 2× the job
payout.** Tie the escalation to a **payout multiple, not absolute credits**, so it
self-scales with the economy and needs no per-parcel tuning. Under 2× → blacklist only
("greedy, not egregious"). At/above 2× → blacklist **plus** a bounty scaled to the
overage. The fence's anger is proportional to how badly you screwed them *relative to
what they offered you*. Tunable: `work_fence_bounty_payout_mult` (default 2.0).

## Open questions

None remaining — the design is complete. Anything below the surface (exact event
copy, per-venue `event_weights`, the loot tables each parcel class draws from) is
content authoring, not design, and belongs in the build.
