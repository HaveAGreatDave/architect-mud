# amp

**Purpose** — the cassette economy behind the Architect Music Player (AMP). The AMP's server track library ships hidden; a player only sees a track after feeding the deck its physical cassette. Cassettes are ordinary tradeable items (tag `amp_cassette`, `tags.song_id` → an `audio_songs` row) that can be sold, gifted, or looted — until inserted, which destroys the tape and permanently unlocks the track for that player. Also wires a generic NPC "gift trade" so an NPC can hand over a reward cassette in exchange for a specific item (e.g. Nyra Voss trades a cassette for a cigarette).

## Registered actions
None (generic verb `insert`, not a tag-gated specialized Action).

## Events emitted
- `amp.unlocked` — fires when a player inserts a new cassette. Payload `{ player, songId }`.
- `inventory.changed` — after an insert or an accepted gift trade, so the giver's inventory panel refreshes.

## Events consumed
- `npc.gift` — fired by the give command when a player gives an item to an NPC. If the NPC carries `flags.gift_trade` and the offered item matches `give_item`, consume it and grant `reward_item` (honouring `once`).
- `player.login` — pushes the player's current unlock set (`amp_unlocks` flag) to the client so the AMP can filter its library.

## Client protocol
- `amp_unlocks` `{ songIds }` — full unlock set, sent at login.
- `amp_unlock` `{ songId, songName }` — a single new unlock, sent on insert; the open AMP adds it live.

## Data schema
No owned tables. Unlock state persists in the existing `player_flags` substrate under key `amp_unlocks` (a JSON-array string of song ids). One-time gift trades use `amp_gift_<npcId>` flags.

## Extension points
- `npcs.flags.gift_trade` — `{ give_item, reward_item, once?, accept_message?, already_message? }`. Any NPC can be configured (as DB content) to trade a specific item for a reward cassette. Nothing is hardcoded to a particular NPC or item.
