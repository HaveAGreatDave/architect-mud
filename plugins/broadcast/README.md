# broadcast

**Purpose** — the unified media framework. Everything that comes out of a screen or a speaker: scripted channels, dynamic news, live cameras and recorded footage. The largest plugin in the repo, and the hub several other systems present themselves through.

## Commands
**Watching:** `tune` · `watch` · `listen` · `tv` · `tablettune`
**Decks:** `load` · `eject` · `selectcassette`
**Airing:** `air` · `airemergency` · `endemergency`
**Piracy:** `pirate` · `pirateresolve`
**Game shows:** `guess`

## REST
- `/broadcast`

## Actions registered
- `TUNE_DEVICE` · `CAMERA_RECORD` · `CAMERA_STREAM`

## Events
- **Emits:** `broadcast.message` · `device.tuned` · `camera.recorded` · `sports.game` · `npc.broadcast_say`
- **Consumes:** `tv.watch` · `tv.unwatch` · `tv.schedule` · `tv.poweroff` · `tablet_tv.watch` · `tablet_tv.unwatch` · `deck.watch` · `deck.unwatch` · `player.logout` · `player.death` · `flag.set` · `zone.broadcast`

## Discovery: everything here is panel-reached
Almost every verb is furniture-gated and discovered through a panel rather than on examine:
- `tune` gates on `broadcast_receiver` furniture. `use` and `watch` are registered against tag `tv` **or** flag `broadcast_receiver`, so either marker alone surfaces them; the handler is additionally lenient about furniture merely *named* like a television.
- `load` / `eject` / `selectcassette` gate on `media_deck` furniture, discovered through the `use`/media_deck panel.
- `tablettune` needs no furniture at all — the tablet is its own receiver. Sent by the TV app's viewport, never typed.
- `guess` is inert everywhere except a channel's `studio_zone_id` while a game-show round is open. **The studio floor and the live round are the gate**, not furniture; discovery is the host's on-air invitation, which carries the `teachVerb` shimmer.

## Reading an episode without a television
A talk show is assembled fresh every in-game night, so the only way to see one used to be to
boot the server, tune a set and wait. `regress.js` will print one instead:

```bash
TALKSHOW_DUMP=2026-08-01 node tests/regress.js
```

It dumps the night for that day-bucket from the **live DB** pools, attributed by cast, with both
presence gates expanded (host-present / host-absent, guest-present / guest-absent) so all four
versions of the show are on one page. Off unless the env var is set. Note it reads the database —
after editing `data/scripts/Tonight_Show.bsm`, run `node scripts/content/build-tonight-show.mjs`
then `npm run content:import`, or you'll be reading the previous draft.

## Size note
At ~8k lines this is the plugin most in need of being split by concern (channels / playlists / show modes / sports). It has the seams available.

## See also
[docs/systems-broadcast.md](../../docs/systems-broadcast.md) — channels, playlists, VINE scripts, NPC hosts, camera feeds, the five live-assembled show modes, and the two-sport pipeline.
[docs/bsm-format.md](../../docs/bsm-format.md) — read before touching any `data/scripts/*.bsm`.
