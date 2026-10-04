# Guest characters

**Status:** built (2026-10-01).

A guest plays without an account. They type a name on the auth screen and arrive in the prologue like anyone else. The browser keeps a remember token, which is the only way back to the character. `register` turns a guest into a full account and keeps everything.

## How it fits

- **A guest is an ordinary `players` row** with `role='guest'`, a generated `guest_<id>` username, a random password hash nobody knows, and no email. There are no new columns or tables.
- **Creation** is the WebSocket `auth_guest` message (`handleAuthGuest` in `server/index.js`). It's refused while registrations are closed, and limited by `AUTH_LIMITS['/auth/guest']` (5 an hour per address, 100 an hour in total), then calls the shared `insertNewPlayer` and the same `finishAuth` a login uses.
- **Names** go through `handleProblem` and `handleTaken` (`server/engine/new-player.js`), which registration now shares. A name has to match `HANDLE_RE`, can't be a reserved word (`me`, `all`, `admin`, `architect` and so on), and can't match an NPC's name or another player's handle in any letter case.
- **Claiming** is `register` → the `claim_form` window → `claim_account` → `claimGuestAccount` (`server/api/routes.js`). One UPDATE sets the username, password, email and `role='player'`. The password travels over the socket, never as a typed command, so it stays out of the log. When email verification is on, the address has to be verified before the next login. The current session carries on.

## Home

A guest's home is the zone content flags `guest_home`: the first floor of Hostel Takeover, the free hostel beside the clone facility at 917,903. The hostel has five floors of communal bunks (`zone_hostel_dorm` to `zone_hostel_dorm_5`) over the desk, with no lock on any door. Every room in it is a `sanctuary`, so anyone can sleep there and a body left there by logging off can't be attacked, looted, robbed or shoved. Only the first floor carries `guest_home`. `handleAuthGuest` writes it as `home_zone` at creation; `homeZoneOf(player)` in `server/engine/guest.js` falls back to it for a guest with none, so `gohome` and `gps $home` work for guests made before the flag. Renting a unit replaces it, for guests and players alike. `scripts/backfill-home-zone.mjs` homes existing guests and tenants.

## What a guest can't do

Guests can't move value to another player or leave public text that outlives them. A guest costs nothing to make, so without this every guest would be a free alt for a main account.

`GUEST_DENIED_VERBS` in `server/engine/guest.js` is read once at dispatch (`commands/index.js`, after alias resolution), so plugin verbs are covered without the plugin knowing. It refuses:

- `give`, `pay`/`acceptpay` and `trade`
- `corp` and `shakedown`
- shop ownership and sales
- bounties and wagers
- `rent`
- graffiti, rumours, minting cards and broadcast piracy

Poker's money buy-in is refused in `joinTable` (`plugins/gametable/table-base.js`), because `join` is shared with free tables.

A guest is shown as "(guest)" in `who` and is left off the bulletin leaderboard. Signing out as a guest warns that the character can't be recovered.

Items a guest drops can still be picked up by anyone. Dropping things is the one transfer path left open, and it's limited by how little a guest can earn and by the purge.

## Cleanup

`purgePlayers(ids)` (`server/engine/new-player.js`):

- releases owned aircraft and apartments
- deletes from every per-player table, with one statement per table for the whole batch
- deletes the rows themselves

It skips anyone online. The admin `DELETE /players/:id` uses it too. That route used to clear five tables and orphan the rest.

The guest plugin's sweep:

- purges guests whose `last_seen` is more than `GUEST_TTL_DAYS` (7) old, up to 200 at a time
- runs on the `1h` cadence, which only fires while someone is online, and is throttled to once every 6 hours, because a cold start resets the scheduler and a `24h` timer might never fire

## Tests

`plugins/guest/regress.js` covers the verb gate, the name rules, claim, and that a purge and the sweep leave no rows behind.
