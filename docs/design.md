# Game Design Document

## Design Philosophy

This is a browser-based MMO-MUD in the HellMOO tradition: text-driven, real-time, brutal, and funny. The game respects player agency absolutely and punishes passivity. The world is persistent and shared. Your choices define you because nothing else does.

The feel: reading a novel that hits back.

---

## Core Game Loop

```
Arrive in zone → Read the room (descriptions, NPCs, threats)
→ Decide (explore / talk / fight / loot / skill)
→ Act (real-time, cooldown-gated)
→ Consequence (loot, damage, reputation, story flags)
→ Manage resources (health, sanity, hunger, radiation)
→ Return to base / press deeper
```

Every loop should produce a story worth retelling. Death should be memorable.

---

## Character Creation

Players begin with a brief creation sequence that establishes:

- **Handle** — your name in the world. No real names. The old world is gone.
- **Origin Fragment** — a single evocative sentence about who you might have been. Flavor only. No mechanical effect.
- **Starting Archetype** — a soft class that sets initial stat distribution and one starting skill. Fully escapable through play.

### Starting Archetypes (Examples)
| Archetype | Flavor | Stat Lean | Starting Skill |
|---|---|---|---|
| Gutter Rat | Survived by stealing and hiding | reflexes / cool | Pickpocket |
| Corpse Tech | Used to fix machines. Or people. | brains / endurance | Field Surgery |
| True Believer | Devoted to something. Anything. | cool / brains | Intimidate |
| Wrecker | Hits things. Very hard. | brawn / endurance | Fists |
| Ghost | Nobody sees you coming or going | reflexes / brains | Stealth |

---

## Stats (Light Layer)

Six core stats, using HellMOO's grounded names. These make you *generally*
capable; skills do the heavy lifting. There is **no charisma stat** — social
outcomes hang off skills.

| Stat | Governs |
|---|---|
| **brawn** | Melee force, carry weight, physical checks |
| **reflexes** | Attack speed, feeds dodge |
| **endurance** | Health pool, fatigue, feeds physical skills |
| **brains** | Tech use, crafting quality, perception/evaluation |
| **cool** | Nerve under fire, stun/pain resistance |
| **senses** | Perception; feeds dodge, and (later) spotting hidden things |

Stats start at **0** (new characters assign ~6 points at creation) and are raised
slowly by spending XP — earned 1:1 from the IP your skills mint — at an escalating
cost. They are not the primary progression feel.

See [combat.md](combat.md) for the implemented system.

---

## Skills (Primary Progression)

Skills improve by use. Do a thing, get better at it. Skills aren't bought from a pool — only stats
are (with XP). Each skill use can mint IP into that skill, and 100 IP = one skill level.

Skills are grouped into categories but not locked — you can dabble in anything, but depth requires commitment. Skills don't depend on other skills; they pull only from their governing stats.

### Skill Categories
Five categories: **combat**, **survival**, **tech**, **social**, and **arcane** (Architect
Interface alone — rare, dangerous, late-game). The live roster and each skill's governing
stats are in `server/engine/skills.js`'s `SKILLS` table, which is the source of truth; this
doc deliberately doesn't mirror it.

Skills run on a **0–10** level scale, where level = `floor(IP / 100)` and IP is minted by use —
biggest gains (best award odds) come from barely winning. A skill's *effective* level adds the
average of its governing stats on top, which can push it past 10. Most players cap most skills at
3–5; 8+ makes you famous for it. See [combat.md](combat.md) for the implemented skill-check model.

---

## Resource Management

Four survival meters. All are threats. None are fun to micromanage — so the design keeps them slow-moving with clear warnings, and only turns them lethal when ignored.

### Health
- Damage from combat, environment, bad decisions
- Healed by medicine, food, rest, certain NPCs
- At 0: death (see Death section)

### Sanity
- Drained by: witnessing extreme violence, Architect-adjacent events, certain locations, hunger + darkness
- Low sanity: hallucination text injected into room descriptions, NPC dialogue becomes unreliable, skill penalties
- Zero sanity: catatonia event. Player wakes somewhere else. Memory (session notes) may be scrambled.

### Hunger / Thirst
- Drains slowly over real time — thirst reaches 0 in ~20 hours unattended, hunger in ~27 hours (slowed 4× on 2026-08-01 from ~5h/~6.7h). Thirst is the faster of the two, matching real survival pacing.
- Ignored long enough (both hit 0): steady, genuinely lethal HP loss, not just a stat penalty — thirst does more damage per minute than hunger does.
- Food and water both grant a secondary timed buff on top of refilling their own meter: food speeds up HP regeneration ("Well-Fed"), water speeds up radiation decay ("Hydrated"). Both last 10 minutes.
- Food and water are abundant enough to not be a grind, scarce enough to matter in the deep zones

### Radiation
- Accumulated in hot zones, from certain enemies, irradiated food/water
- Low radiation: minor stat penalties
- High radiation: mutation events (see Mutations)
- Radiation decays slowly. Meds speed decay. Some factions weaponize it.

---

## Combat

### Feel
Real-time with cooldowns. Inspired by HellMOO. You type or click commands, they execute, they go on cooldown. Multiple enemies gang up. Fleeing is always an option but never guaranteed.

### Structure
- Each **action** has a cooldown — attack ~3.5s, flee ~4s, item use ~2.5s.
- **Attack** rolls against target's defense — modified by skill, stats, and equipment
- **Status effects** — bleeding, stunned, burning, irradiated, panicked — all have durations and tick effects
- **Enemies act on their own timers**, scaled by their AGI stat (faster enemies attack more often) — you are never truly safe standing still next to something hostile

### Death
Death is not the end. It is a setback with flavor.

On death:
- You lose carried items (lootable corpse, persists for a timer)
- You respawn at your last **anchor point** (set in safe zones), stepping out of a cloning vat shaped like a vending machine
- HP, Sanity, Hunger, Thirst, and Radiation are all fully restored on respawn — the body resets completely, but every skill you've learned carries over untouched
- You receive a **death message** — a short, darkly funny description of how it happened, followed by a deadpan note about the cloning process itself
- Repeat deaths in the same zone trigger escalating insults from the game

No permadeath. But death has enough sting to matter.

---

## Mutations

High radiation exposure triggers mutation events. Mutations are permanent (unless treated by rare specialists) and are a mix of drawbacks and advantages.

Examples:
- **Extra Eye** — +2 senses, unsettling to NPCs
- **Necrotic Hand** — melee attacks cause bleeding, you can't wear gloves
- **Static Mind** — partial immunity to sanity loss, Architect signals are louder (strange visions)
- **Iron Stomach** — can eat almost anything, food poisoning immunity

Mutations are part of character identity. Some players collect them.

---

## The World

### Zones
The world is divided into **zones** — named areas with consistent themes, enemy types, loot tables, and ambient text. Zones connect directionally (north/south/east/west/up/down) in the MUD tradition.

Each zone has:
- A **danger rating** (Safe → Lethal)
- **Ambient events** that fire periodically (flavor text, world events, NPC activity)
- **Points of interest** — lootable, interactive, or quest-relevant locations within the zone

### Map Shape (As Built)
The nine-tile hub-and-spoke city this section used to describe no longer exists — it was
replaced by the district world on 2026-07-11. As of 2026-07-24 `map_world` spans **93 × 100
grid cells holding 5,439 outdoor zones**, with interiors hanging off surface cells as their
own child maps. Named geography is content, not design, and is deliberately not listed here;
see [reference/land-taxonomy.md](reference/land-taxonomy.md) for how region / district /
terrain divide a tile and [roadmap-world-expansion.md](roadmap-world-expansion.md) for the
concentric band model the surface was grown against.

The intent that survives the growth: players cluster in a safe core and make a real, legible
decision to head outward to find a fight, rather than getting lost in a large ring of samey
badland tiles. Legibility over sprawl.

### Safe Zones
Every region has at least one safe zone — a hub where PvP is off, vendors exist, and players can anchor. Safe zones are not paradise. They are just places where you probably won't die *today*.

---

## Power, Lighting & Time

A day/night cycle and a city-wide power grid run independently of zone content — see `docs/architecture.md`'s Environment System section for the implementation. The design intent:

- **Time passes whether or not anyone's watching.** Dusk and dawn are real transitions, not flavor-only — street lights physically turn on and off with them.
- **The city is never dark by default.** Every outdoor zone and every street light is powered by Coldwater Power Station, a piece of pre-Handoff infrastructure that "never stopped running" — thematically, the Architect's silent competence rather than a friendly utility company (see `docs/story.md`).
- **Indoor lighting is a player choice, not ambient.** Overhead lights and lamps in a powered room are switched on or off by hand (`switch`/`flip`) — a room can be fully powered and still dark if nobody's bothered to turn the lights on, which is a small, deliberate piece of texture rather than a bug.
- **Power is local and finite for buildings.** A building generator (installable per-building) only powers that building's own connected rooms — there's no implicit citywide indoor power. This is meant to make "does this building have its own generator" a real, visible fact about a place, not an invisible system detail. Only the city plant and its junction boxes are fuel-free; a player-installed generator burns fuel, faults offline in severe weather, and goes dark if its physical unit is destroyed.
- **Darkness gates what you can perceive, not where you can go.** Light level hides items, enemies, corpses, furniture and eventually other people and NPCs as it falls, but exits and connected destinations stay listed at every level — you can always leave a dark room. The ladder is `gloomy` (items hidden) → `dark` (items, hostiles, corpses, others, furniture) → `murk` (NPCs too).

---

## Ideologies & Reputation

Ideologies are placed by **one bipolar axis + one categorical path**, not a grid of
correlated axes (three correlated axes collapse to a single line). The four below are the
canonical orders — the only ones a player can lean toward. Five more exist as **gated
expansion previews** (`flags.expansion: true`), which the lean scorer deliberately skips;
between them they complete every `{stance, path}` cell, and the one duplicated cell
(redeem · machine) is split by the `authority` axis this section predicted. See
[systems-ideologies.md](systems-ideologies.md) — it owns the roster.

- **Stance — is the world worth saving?** *Redeem it* (stay & resolve) ↔ *Renounce it* (leave & begin).
- **Path — how does humanity go on?** A choice, not a spectrum: **Machine**, **Flesh**, and **Mind** are three sibling ways to *ascend*; **Human** is the fourth answer — *stay as we are*. (Mind is a kind of human advancement like cybernetics or mutation, so it sits beside Machine and Flesh, never opposite "Human".)

| Ideology | Stance | Path | Verb |
| --- | --- | --- | --- |
| **The Ascendants** | Redeem | Machine | *advance* |
| **The Long Watch** | Redeem | Human | *reclaim* |
| **The Wildblood** | Renounce | Flesh | *adapt* |
| **The Exodus** | Renounce | Mind | *awaken* |

- **The Ascendants** — "Humanity's next evolution will be engineered." The Architect is humanity's greatest achievement; civilization should be perfected, not abandoned. *Progress, Order, Technology, Rationality, Optimization.*
- **The Long Watch** — "The city belongs to its people — not its machine." An underground movement to preserve the Basin's tech and infrastructure but reclaim stewardship from the Architect. *Liberty, Responsibility, Reform, Community, Hope.*
- **The Wildblood** — "Life survives by adapting, not by preserving." Reject the Architect and the artificial order; mutation is humanity's natural future, and if the old world must die, so be it. *Adaptation, Freedom, Instinct, Evolution, Resilience.*
- **The Exodus** — "The future cannot be found in the ruins of the past." Abandoned the Basin entirely; Architect, tech, and mutation alike are remnants of a failed world. They cultivate psionics as humanity's true potential. *Renewal, Self-Reliance, Simplicity, Awakening, Discovery.*

None are simply good or evil; each holds a coherent vision of the future. Players build reputation with each ideology independently (completing jobs, killing enemies, delivering items, talking your way in), and dialogue choices move the player's own **stance** (`stance_axis`) and **path affinities** (`path_*`). `classifyLean` scores stance-agreement + path-affinity to show which ideology you lean toward (canonical orders only). The two-part model proved expandable exactly as designed, and the hypothetical in this paragraph was built: the Prometheans are `redeem · machine` like the Ascendants, separated by an *authority* axis (`flags.authority`: `architect` vs `human`). Activating an expansion order means dropping `"expansion": true` from its JSON — and, for that duplicated cell, teaching the scorer an authority-agreement term (`server/engine/ideologies.js:65-70`).

Reputation tiers: **Hostile → Unknown → Neutral → Known → Trusted → Inner Circle**

Benefits scale: discounts, quest access, safe houses, unique items, lore unlocks.

Ideologies notice each other. Being Inner Circle with The Wildblood makes The Ascendants nervous.

---

## Multiplayer Dynamics

This is a shared persistent world. All players exist in the same space.

- **PvP** is zone-flagged — allowed in dangerous zones, off in safe hubs
- **Player economy** — trading, crafting, and selling to other players is viable
- **Social layer** — guilds/crews, shared anchors, group combat bonuses
- **World events** — periodic server-wide events that all players can participate in or ignore

## Loot & Death Economy

### Full Loot PvP
When a player kills another player, the corpse is fully lootable — every item, every piece of equipment. This is the rule everywhere, in all zones.

This is a hard design commitment with cascading implications:
- **Economy is player-driven and brutal.** Rare items circulate because they can be taken.
- **Safe zones are sacred.** Players will treat hub zones with genuine relief.
- **Social reputation matters.** Being known as a griefer has real consequences in a persistent world.
- **Gear is never truly safe.** Players make active decisions about what to carry into dangerous zones.

Death from the environment (enemies, traps, starvation) drops a lootable corpse too — but any player can loot it, not just the killer.

Corpses persist for 10 minutes real-time. A timer is shown to the dead player so they can race back.

---

## Credit Economy

- New characters start with **20 credits** carried — enough to get a drink and something to eat, not much past that. The scarcity is deliberate; the first session is meant to feel tight.
- Credits split into two pools: **carried** (on your person at all times, vulnerable to theft) and **banked** (parked at an ATM, completely theft-proof until withdrawn again). This is the entire reason the bank exists — it gives a real, mechanical reason to occasionally walk to a known safe zone instead of just hoarding credits on your person indefinitely.
- ATMs are **furniture** carrying an `atm` flag (paired with an `atm_units` row), not a zone flag, so they can be placed anywhere as the city map grows. Full city coverage is still deferred to the world-map expansion pass, where ATM placement can be considered alongside actual zone layout instead of guessed at in isolation. See [systems-atm.md](systems-atm.md).
- **Theft** is a skill check (Deception) against the act of pickpocketing a specific player, not a stat-vs-stat opposed roll against the victim — keeping it simple and fast rather than turning every theft attempt into a mini combat-style exchange. It only ever touches carried credits, has a cooldown to stop spam, and is disabled in safe zones entirely (the threat is meant to live in the badlands and the gray-area street zones, not the social hub everyone passes through).
- Getting caught stealing broadcasts to the whole zone — reputational risk is the actual deterrent here, more than the cooldown.

---

## Crafting System

Crafting is a deep simulation. Tool skill drives output. This is a primary progression path, not a side system.

### How It Works
- **Tools have condition** — a degraded workbench produces worse results than a maintained one
- **Skill governs outcomes** — Fabrication (and sub-skills) determine success rate and what recipes are available
- **Recipes are discovered** — found in the world, traded, or unlocked through faction rep. Some are faction-exclusive.

### Output Variability
The same recipe produces different results based on the skill roll — a four-rung ladder, so a craft
is a real gamble rather than a yes/no:
- **Critical success** (rare, and rarer skills make it likelier): double output
- **Success**: the recipe's normal output
- **Failure**: nothing made, but your materials survive — try again
- **Catastrophic failure** (a badly missed roll): the ingredients are destroyed

A station doesn't change the ladder, it shifts you up it — a flat margin bonus by station quality.
Implemented in `server/engine/crafting.js`.

### Crafting Stations
Some recipes require specific stations — a weapons bench, a chemistry set, an Architect terminal. Stations exist in the world and are sometimes contested, controlled by factions, or hidden in dangerous zones.

---

Early game: fragile, funny, dying a lot, learning the world
Mid game: a recognizable character with a reputation and a build
Late game: a force in the world — factions react to you, the Architect notices you, your death actually matters to other players

The arc is: **nobody → somebody → legend or corpse**

---

## Apartments & Property

Players can rent a fixed apartment unit, lock it, and use it as a guaranteed-safe place to rest — the answer to "where do I actually feel safe" in a world built around full-loot PvP.

### Renting
Apartment zones are unowned by default and cost a flat credit price to claim (`rent`). Ownership is then an **ongoing cost**: rent comes due every few *game* days (so it scales with the game-speed knob), drafts from the bank first then carried credits, and auto-evicts a tenant who can cover neither. A corp can hold a unit too (`owner_type='org'`), controlled by any member with the manage-HQ permission; corp HQs pay no rent.

A zone becomes a rentable apartment by checking "Rentable Apartment" on it in the dev panel's Zone Editor (which also auto-registers the underlying ownership/lock/rent record), rather than through a dedicated apartment-building tool — apartments are just zones with that flag set, edited the same way as any other room.

### Locks & Lockpicking
An owner can `lock`/`unlock` their own door at will. A locked door blocks everyone but the owner from entering or sleeping there.

Anyone can `pick` a locked door that isn't theirs. This runs a skill check using the new **Security** skill (tech category) against the door's **lock difficulty** — same d10 + rank + stat-bonus formula used everywhere else in the game. A failed attempt still grants a small amount of Security XP, so repeated failed attempts make a player gradually better at picking locks in general, even without succeeding on this particular door.

Owners can `upgrade lock` to spend credits raising the difficulty, making their door harder to pick over time. This creates a small, ongoing economic sink and a light security arms race — a well-funded player can make their apartment meaningfully safer than a new player's.

### Sleeping
`sleep` (or `rest`) begins a gradual, timed rest — HP and Sanity recover minute by minute while hunger and thirst drain, rather than an instant full restore. The rate scales by how safe the location actually is:
- **Your own locked apartment** — fastest, deepest rest. This is the only guaranteed-safe full rest in the game.
- **Any other safe zone, or someone else's unlocked apartment** — slower, shallower. Good enough to keep going, not as good as home.
- **Anywhere dangerous** — sleep doesn't work at all.

Sleep auto-ends on full rest, on hunger/thirst running out, or after a 30-minute cap — and any other command wakes the player early, keeping whatever was already recovered.

This gives apartments a clear, constant value (better rest) without making them mandatory — a player who never rents one can still recover in the city core, just more slowly.

### Why this design
Deliberately small in scope — no decor, no storage — so the full-loot-PvP economy gets a "home base" concept and the Security skill gets a clear, repeatable use, without committing to a much larger base-building system before there's a player base to validate it's wanted.

---

## Open Design Questions
- Do crafting stations degrade and need maintenance, or are they permanent? (Permanent today — a station is a quality tier that buys a flat margin bonus, with no condition or upkeep.)
- Can *individual* players set up player-run shops / vending in safe zones? (A **corp** can: claimable storefront businesses take a live cut of vendor sales. A solo player still can't.)
- PvP flagging in mid-tier zones — fully open or opt-in? (Protection is currently all-or-nothing: the `sanctuary` tag, published through the protection substrate. There is no mid-tier flag.)
- Apartment storage — a per-unit inventory chest is a natural extension, not yet built
