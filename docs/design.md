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
| Gutter Rat | Survived by stealing and hiding | AGI / PER | Pickpocket |
| Corpse Tech | Used to fix machines. Or people. | INT / TEC | Field Surgery |
| True Believer | Devoted to something. Anything. | WIL / CHA | Intimidate |
| Wrecker | Hits things. Very hard. | STR / END | Brawling |
| Ghost | Nobody sees you coming or going | AGI / INT | Stealth |

---

## Stats (Light Layer)

Six core stats. These set ceilings and unlock skill thresholds — they don't do the heavy lifting, skills do.

| Stat | Governs |
|---|---|
| **STR** | Melee damage, carry weight, physical checks |
| **AGI** | Cooldown speed, dodge, stealth checks |
| **INT** | Tech use, crafting quality, dialogue options |
| **WIL** | Sanity resistance, addiction resistance, morale |
| **END** | Max health, radiation resistance, hunger rate |
| **CHA** | NPC disposition, faction rep gains, trade prices |

Stats increase very slowly — a handful of points over a full playthrough. They are not the primary progression feel.

---

## Skills (Primary Progression)

Skills improve by use. Do a thing, get better at it. There is no XP pool to allocate.

Skills are grouped into trees but not locked — you can dabble in anything, but depth requires commitment.

### Skill Categories
- **Combat** — Brawling, Bladed, Firearms, Explosives, Energy Weapons
- **Survival** — Scavenging, Cooking, Medicine, Navigation
- **Tech** — Hacking, Electronics, Fabrication, Drone Ops, Security
- **Social** — Persuasion, Intimidate, Deception, Faction Lore
- **Arcane-Tech** — Architect Interface (rare, dangerous, late-game)

Skill ranks: **0 (untrained) → 10 (legendary)**. Most players cap most skills at 3–5. 8+ in anything makes you famous for it.

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
- Drains slowly over real time — thirst reaches 0 in ~5 hours unattended, hunger in ~6–7 hours. Thirst is the faster of the two, matching real survival pacing.
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
- Each **action** has a cooldown — attack ~3.5s, flee ~4s, item use ~2.5s. Tuned deliberately slower than an early draft that played faster than HellMOO itself.
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
- **Extra Eye** — +2 PER, unsettling to NPCs (-CHA)
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
The world is a 5×5 grid. The center 3×3 is the safe city core (Coldwater Basin) — always PvP-off, zero enemy spawns, no radiation. It's surrounded by a 16-zone ring of badlands where every enemy spawn lives, with danger increasing the further a zone sits from the city: tiles directly bordering the city are medium danger, the next ring out is mostly high, and the four corners are lethal.

This was a deliberate shape, not just a generic grid — the goal is that players cluster and interact with each other in the safe core, and have to make a real decision to leave it and travel into danger to find combat. Enemies do not spawn in the city under any circumstance.

A residential block (apartments — see below) branches off the city core via a `down` exit, off the main directional grid.

### Safe Zones
Every region has at least one safe zone — a hub where PvP is off, vendors exist, and players can anchor. Safe zones are not paradise. They are just places where you probably won't die *today*.

---

## Factions & Reputation

Players build reputation with each faction independently. Reputation is gained by: completing jobs, killing enemies, delivering items, talking your way in.

Reputation tiers: **Hostile → Unknown → Neutral → Known → Trusted → Inner Circle**

Benefits scale: discounts, quest access, safe houses, unique items, lore unlocks.

Factions notice each other. Being Inner Circle with The Breakers makes The Custodians nervous.

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
- ATMs are a per-zone flag rather than a fixed list, so they can be placed anywhere as the city map grows. Currently only one exists (the starting hub) — full city coverage is intentionally deferred to the world-map expansion pass, where ATM placement can be considered alongside actual zone layout instead of guessed at in isolation.
- **Theft** is a skill check (Deception) against the act of pickpocketing a specific player, not a stat-vs-stat opposed roll against the victim — keeping it simple and fast rather than turning every theft attempt into a mini combat-style exchange. It only ever touches carried credits, has a cooldown to stop spam, and is disabled in safe zones entirely (the threat is meant to live in the badlands and the gray-area street zones, not the social hub everyone passes through).
- Getting caught stealing broadcasts to the whole zone — reputational risk is the actual deterrent here, more than the cooldown.
- Vendors (Reg, the barkeep) already supported faction-rep discounts before this system existed; the credit economy slots in underneath that, unchanged.

---

## Crafting System

Crafting is a deep simulation. Material quality and tool skill both affect output. This is a primary progression path, not a side system.

### How It Works
- **Materials have quality tiers** — Scrap / Common / Refined / Pristine / Architect-Grade
- **Tools have condition** — a degraded workbench produces worse results than a maintained one
- **Skill governs outcomes** — Fabrication (and sub-skills) determine success rate, quality ceiling, and what recipes are available
- **Recipes are discovered** — found in the world, traded, or unlocked through faction rep. Some are faction-exclusive.

### Output Variability
The same recipe with the same materials produces different results based on skill roll + material quality:
- Low skill + scrap materials = functional but poor quality (lower durability, weaker stats)
- High skill + pristine materials = exceptional output (top-tier stats, sometimes bonus properties)
- Critical success (rare): unique named item with a randomly generated bonus property

### Crafting Stations
Some recipes require specific stations — a weapons bench, a chemistry set, an Architect terminal. Stations exist in the world and are sometimes contested, controlled by factions, or hidden in dangerous zones.

Players can build and own portable stations (lower quality ceiling than world stations).

---

Early game: fragile, funny, dying a lot, learning the world
Mid game: a recognizable character with a reputation and a build
Late game: a force in the world — factions react to you, the Architect notices you, your death actually matters to other players

The arc is: **nobody → somebody → legend or corpse**

---

---

## Apartments & Property

Players can rent a fixed apartment unit, lock it, and use it as a guaranteed-safe place to rest — the answer to "where do I actually feel safe" in a world built around full-loot PvP.

### Renting
Apartment zones are unowned by default and cost a flat credit price to claim (`rent`). Once rented, the unit belongs to that player until further notice — there's currently no rent decay or repossession, so it's a one-time purchase rather than an ongoing cost. (Flagged as a likely future addition — see Open Design Questions.)

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
This was originally an open question ("Housing / base building for players or crews?"). The answer that shipped is deliberately small in scope: no decor, no storage, no crew-shared housing yet. It exists to give the full-loot-PvP economy a "home base" concept and to give the Security skill a clear, repeatable use, without committing to a much larger base-building system before there's a player base to validate it's wanted.

---

## Open Design Questions
- Do crafting stations degrade and need maintenance, or are they permanent?
- Can players set up player-run shops / vending in safe zones?
- PvP flagging in mid-tier zones — fully open or opt-in?
- Apartment storage — a per-unit inventory chest is a natural extension, not yet built
- Apartment upkeep — should ownership lapse without payment, or is a one-time purchase the final design?
- Crew/guild-shared apartments — currently single-owner only
