# accolades

**Purpose** — Accolades: a sardonic achievement system framed as a surveillance file rather than a trophy case. The prologue already establishes the watcher ("somewhere far above, an algorithm notes that its very large number is, once again, correct"), and this plugin is that algorithm doing its filing. Entries are observations, not awards — the voice is clinical and unimpressed, and it never congratulates. Three design constraints hold the whole thing together: it is **discovery-only** (no locked list, no total, no denominator anywhere in the UI), **fully private** (no broadcast, no viewing another player's file), and every entry is worth **exactly 1 XP, flat, forever** — including the hardest one. The flatness is the joke: the system does not care what you did.

Adding entry N+1 is one object literal in `catalog.js` and nothing else. Because there is no visible total, additions are invisible to players by construction — the launch set can be small and grow silently, and nobody ever sees a seam.

## Registered actions

None. One player verb, `accolades` (with `file` as a second verb), prints your own entries newest-first.

## Events emitted

| Event | When | Payload |
|---|---|---|
| `accolade.unlocked` | An entry is genuinely logged for the first time (the INSERT actually took) | `{ playerId, key, total }` |
| `accolade.opened` | A player opens their file, via the `file` verb or the tablet app | `{ playerId }` |

## Events consumed

`zone.entered`, `player.death`, `posture.changed`, `item.taken`, `credits.changed`, `enemy.killed`, `flight.crashed` — the trigger surface, one subscription per distinct event named in the catalog. Plus `player.login` / `player.logout` for the in-memory state lifecycle, and its own `accolade.unlocked` / `accolade.opened` (entries can key off the act of being noticed, which is how *Meta* and *Reading This* work).

## Tick usage

None. Everything is event-driven; there is no scheduled work and nothing to idle-gate.

## Dependencies

None at load. Reaches `grantXp` (`server/engine/ip.js`) to award XP and `sendToPlayer` for the banner. The tablet app lives in `plugins/tablet/accolades-app.js` and reaches this plugin by cached dynamic import, matching `surveillance-app.js`.

## Config

None. The one number worth knowing — 1 XP per entry — is deliberately not configurable; making it tunable invites someone to scale it by difficulty, which converts the feature into a checklist.

## Data schema

`player_achievements (player_id, entry_key, unlocked_at)`, PK `(player_id, entry_key)`.

The composite primary key **is** the entire XP safety story. A re-trigger is an `ON CONFLICT DO NOTHING` no-op, and `rowCount` — not the in-memory set — decides whether XP is granted, so two events racing the same unlock can only pay once. Lifetime grant is therefore capped at one XP per entry in the catalog, against 100 XP per stat point. There is nothing repeatable here, so there is nothing to farm.

Progress counters (`deaths`, `moves`, per-item pickup tallies) live in `player_flags` under a `rec_` prefix. They are held in memory and flushed on logout rather than written per bump: a bump can happen on every single move, and a per-bump write would put a DB round trip on the movement path. The tradeoff is bounded — a hard kill loses partial progress toward a threshold entry, never a granted one.

## Extension points

`accolade.unlocked` — `{ playerId, key, total }` fires on every genuinely new entry, for anything that wants to react to a player being noticed.
