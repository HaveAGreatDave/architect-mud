# party

First-class player **parties** — consent-based groups with a leader, the deliberate
counterpart to the engine's raw `follow` primitive.

## Purpose

`follow` (in `server/engine/commands/movement.js`) is unilateral and used for
casually tailing someone. A **party** is invite → accept, has a leader and a roster,
and is the group that travels together — notably the cohort that crosses the void
as one (see [systems-overland-void-travel.md](../../docs/systems-overland-void-travel.md)
§ Parties).

It **drives** follow rather than replacing it: joining a party sets your
`following` to the leader, so the engine's `dragFollowers` pulls the whole party
along on every move for free — no party-aware code in movement. Leaving/kicking/
disbanding clears it. `follow` stays the single movement substrate; party is the
identity + consent layer on top, and the model the Tablet **Party app** renders.

State is **RAM-only runtime state** (like follow) — parties dissolve on a server
restart, so there is no table and nothing to persist.

## Commands

- `party` — show your party (leader ★, members, pending invites).
- `party invite <player>` — leader invites an online player (creates the party if
  you don't have one). Only the leader may invite.
- `party accept [leader]` — join a party you've been invited to.
- `party decline` — decline pending invites.
- `party leave` / `party disband` — leave (a leader leaving disbands the party).
- `party kick <player>` — leader removes a member.

## Events

- Emits `party.changed` `{ partyId, leaderId, members }` on any roster change (for
  the Tablet app to refresh).
- Consumes `player.logout` — a member dropping offline leaves; a leader dropping
  disbands.

## Read API

`getPartyView(playerId)` → `{ id, leaderId, leader, members[], invites[] }` or
`null`. Other systems read the **follow substrate** (`player.following`) for
movement/cohort purposes rather than importing this plugin.
