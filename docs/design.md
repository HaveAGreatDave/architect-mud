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
- **Tech** — Hacking, Electronics, Fabrication, Drone Ops
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
- Drains slowly over real time (or time-in-game, TBD)
- Ignored long enough: END and STR penalties, then health damage
- Food and water are abundant enough to not be a grind, scarce enough to matter in the deep zones

### Radiation
- Accumulated in hot zones, from certain enemies, irradiated food/water
- Low radiation: minor stat penalties
- High radiation: mutation events (see Mutations)
- Radiation decays slowly. Meds speed decay. Some factions weaponize it.

---

## Combat

### Feel
Real-time with cooldowns. Inspired by HellMOO. You type or click commands, they execute, they go on cooldown. Positioning matters within a room (range, cover flags). Multiple enemies gang up. Fleeing is always an option but never guaranteed.

### Structure
- Each **action** has a cooldown (0.5s – 4s depending on action weight)
- **Attack** rolls against target's defense — modified by skill, stats, and equipment
- **Status effects** — bleeding, stunned, burning, irradiated, panicked — all have durations and tick effects
- **Enemies act on their own timers** — you are never truly safe standing still

### Death
Death is not the end. It is a setback with flavor.

On death:
- You lose carried items (lootable corpse, persists for a timer)
- You respawn at your last **anchor point** (set in safe zones)
- You receive a **death message** — a short, darkly funny description of how it happened
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

---

## Progression Feel

Early game: fragile, funny, dying a lot, learning the world
Mid game: a recognizable character with a reputation and a build
Late game: a force in the world — factions react to you, the Architect notices you, your death actually matters to other players

The arc is: **nobody → somebody → legend or corpse**

---

## Open Design Questions
- PvP looting rules — full loot or protected inventory?
- Crafting depth — simple (combine X+Y) or complex (recipes, tools, stations)?
- Does the Architect Interface skill have a quest line, or is it purely emergent?
- Housing / base building for players or crews?
