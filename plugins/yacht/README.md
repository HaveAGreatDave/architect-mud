# yacht

**Purpose** — The Echelon, the invite-only admin superyacht in Coldwater Basin. This plugin owns
the vessel's access control and (in later slices) its movement and emergency broadcast. The rooms,
furniture, and NPCs are plain world content flagged `flags.yacht`; the plugin is the law that keeps
the wrong people off the deck.

## Registered actions

None (specialized actions). Registers a lock type and a move gate imperatively:

- **Lock type `yachtlock`** (`tags['lock:yachtlock']`) — a door that opens for any invited player.
  Tag it `{ ownerOnly: true }` to tighten a threshold to the owner (Cyd) alone — used on Cyd's
  private suite, so even invited guests can't enter her quarters. Not hackable; the invite list (or
  ownership) is the only key.
- **Move gate `yacht:board`** — blocks a foot entry into any `flags.yacht` zone from a non-yacht tile
  unless the mover is invited/admin. The "non-NPC bouncer."

## Commands

- `invite <player>` — add a player to the invite list (admin only).
- `uninvite <player>` — remove a player from the invite list (admin only).
- `invites` — list the invite list (admin only). Admins operate the console but are NOT approved
  to board until they add themselves; only the owner (Cyd) and listed players have access.
- `sail <n|s|e|w>` / `helm` — steer the Echelon one water tile from her bridge (admin only). Each
  move starts a 5-minute cooldown. `helm` (or `sail` with no direction) shows position / cooldown /
  dock status. Only the exterior tile's `grid_x/grid_y` change; the interior map never moves. Coming
  to rest beside a `flags.pier` tile auto-lowers the gangway.
- `dock` — manually lower/retract the gangway to an adjacent pier (admin only).

## Movement & docking notes

The exterior tile shares a coordinate with the underlying Basin water tile; the yacht "floats over"
it. The gangway is a runtime `zone_exit_overrides` exit (`source='yacht_dock'`) wired both ways
between the exterior tile and the pier, guarded by the `yacht:board` gate — so only invitees walk
aboard, while anyone already aboard may step ashore. Getting underway tears every gangway exit down
first. The vessel's position lives in the content column `zones.grid_x/grid_y`, so a `content:import`
(deploy) resets her to her home tile — intended.

## Minimap visibility

Registers a `registerMinimapNodeFilter` predicate (engine seam in `world.js`) so the Echelon's
exterior tile renders as a boat **only** for invitees/admins; everyone else sees the open water tile
underneath it (the yacht floats over a real Basin water tile, and `applyMinimapVisibility` resolves
the overlap per viewer). The filter is backed by an in-memory `invitedIds` cache (the DB stays the
security source of truth; the cache only feeds the sync display path). Applies to the sidebar minimap
and the tablet bigmap (zone/regional). The boat glyph is `client/game/assets/zone-icons/boat.svg`,
selected by the exterior tile's `flags.icon = "boat"`.

## Helipad (fly-in access)

The exterior tile carries `flags.airfield_id` + `flags.hangar_interior_zone = zone_echelon_helipad`,
so a Dragonfly (VTOL) can set down on the yacht's map_world tile and `parkAt` disembarks its occupants
into the open-roof helipad interior (`flags.open_sky`). The airfield moves with the yacht. `parkAt`
now emits `zone.entered` on landing, so an uninvited pilot who sets down on the Echelon is smitten by
the same backstop as any other intruder. This is the "only accessible by helicopter" path.

## Secret teleporter (owner's private access)

A concealed closet (`use`, `requiredTag: teleporter`) links Cyd's Embassy apartment (`zone_apt_9`) to
the boarding foyer and back. `doUseTeleporter` self-resolves the closet in the room and gates on
`isInvited`: an approved user is whisked aboard (bypassing docking, but the destination's own
`zone.entered` smite still applies); anyone else gets a mundane "it's just a closet" line so the
mechanism is never disclosed. Furniture: `furn_echelon_closet_embassy` / `furn_echelon_closet_foyer`.

## Events consumed

- `zone.entered` — if an online player who is not approved (not Cyd, not on the list) lands in a
  `flags.yacht` zone (forced, teleported, glitched past the move gate, or flown in), they are smitten
  via `handlePlayerDeath`. The backstop the move gate can't cover, since `TELEPORT` and flight
  arrivals bypass move gates by design.

## Dependencies

- `doors` — the lock registry (`registerLockType`) the `yachtlock` type plugs into.

## Data schema

- `yacht_invites(player_id PK → players, added_by, added_at)` — one row per approved non-admin
  player. Admins bypass the list. Runtime state, excluded from the content export.

## Access model

Three layers, in the order a body gets aboard: `yachtlock` (interior doors) → `yacht:board` (the
gangway) → `zone.entered` smite (the backstop). Owner: Cyd (an admin).
