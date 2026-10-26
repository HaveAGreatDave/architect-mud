# Admin controls

**Status:** Phases 1 and 2 (weather, time), the ESP and the unrest tracker built; phases 3 to 5 are design.

Staff controls in the game, in the Tablet Admin app and the `sysop` verb ([plugins/admin](../plugins/admin/README.md)). Staff means the dev, admin, builder and designer roles. Every tab shows the live value and lets you change it. The buttons run the verbs' own code, so the app holds no logic.

## Phase 1: Weather ✅
*Built:* `sysop weather …` and the Weather tab. Force the condition, temperature or precipitation chance, start a named event, or return to the forecast. It uses the engine override, so the change survives a restart until it's cleared.

- Setting a condition without a precipitation chance uses 100% for a wet one (rain, sleet, snow, blizzard, storm, thunderstorm) and 0% for the rest. Keeping today's chance made "set rain" a roll that usually came up dry.
- Rain only falls under a moving cell ([systems-weather-extreme.md](systems-weather-extreme.md)), and the override reseeds the cells across the whole map. So a wet set also moves the nearest rain cell over the tile of the staff member who set it (`bringWetCellOver` in `plugins/weather`), or over the building's facade when they're indoors. The rest of the map keeps local weather.

## Phase 2: Time ✅
*Built:* `sysop time …` and the Time tab. Skip +4h, +8h, +12h or +24h, set an exact time, freeze, and set the speed (1x, 2x, 3x, 6x).

- A skip goes through `devSkipTime` in `server/engine/environment.js`, which runs `tick24h` once for each midnight crossed and then one `tick30m`, as the clock does. `devAdvanceTime` only moves the hands and never turns the calendar, so don't use it for a skip.
- A skip or a set sends `pa_announce` to every live player. The client plays a two-tone chime, writes the line to the log (`.msg-pa`), then speaks it through ORACLE with `pa: true`: a band-pass, a horn peak, soft clipping and two slapback echoes. The lines are in `plugins/admin/time.js`, and the time is read in words ("oh six hundred hours").

## The ESP ✅
*Built:* `sysop esp [on [message]|off]` and the ESP tab. Starts and stops the city lockdown: the sirens, the Curtain shut across the South Gate, and the South Lock's outer door down ([systems-trucking.md](systems-trucking.md#the-outer-door-and-the-lockdown)). It dispatches `ESP_ACTIVATE`/`ESP_DEACTIVATE` and reads its state off `esp.changed`, so it agrees with the devpanel's button. Lockdown with a message sets the warning players see.

## Unrest ✅
*Built:* `sysop unrest …` and the Unrest tab, a tracker for the faction-conflict sim ([systems-unrest.md](systems-unrest.md)). The code is `plugins/admin/unrest.js`, which reads the unrest plugin's ledger and makes the same calls the devpanel's Unrest routes make.

- The tab opens on a map of the city's blocks, north at the top, each square coloured by its mood (quiet, watchful, tense, flashpoint) and named by its biggest building, with 🔥 for a block that's burning, ⚠ for a live incident and 📍 for your own block. Under it: live incidents, how many are burning, and where the Wildblood come up tonight.
- Tapping a square opens that block: a mood gauge with the band cut-offs marked, then Crackdown (grip), Trouble (heat) and Grievance (pressure) with the boiling point marked, a sentence on what it does next, when players last saw each order's mark there, and every incident in the catalogue with the reason it can or can't start.
- Controls: a slider for each of the three numbers, Calm it down (back to the baseline and the burn put out), Stir it up (grievance past boiling point, so the sim kicks the block off on its next tick), Start an incident (an ineligible one is forced, and the notice says what it overrode), End an incident, and Run a tick now (one whole 30-minute tick: the ledger, the street and news voices, then staging).
- The typed form: `sysop unrest` lists every block, worst first; `sysop unrest <block|here>` reads one; `tick`, `calm <block|here|all>`, `stir`, `set <block> <grip|heat|pressure> <0-100>`, `stage <block> <incident>` and `end <block>` do the rest. A block is its key, like `76,75`.
- ⚠ Rule 2 of the unrest design bans a player readout, not a staff one. `buildScreen`, `handleAction` and the verb each check the role, so none of this reaches a player.
- The map and gauges are two generic detail pieces in the tablet, `grid` and `meters` (`renderCellGrid` and `renderMeters` in `tablet-os.js`). Any app can use them; the accessible tablet reads the grid as a list of buttons and the gauges as label/value pairs.

## The Coliseum roof ✅
*Built:* `sysop roof [open|shut|auto]` and the Roof tab. The Hughson Coliseum's roof follows today's forecast; open or shut moves it now (the shells take about five minutes) and holds it until the forecast day turns over, and auto hands it back sooner. It calls `setVenueRoof` in the broadcast plugin ([hughson-coliseum.md](proposals/hughson-coliseum.md)). The call is RAM-only, so a restart returns the roof to the forecast.

## Phase 3: Players
The online list, with chat (a staff DM), kick, mute and set role (admin only).

## Phase 4: Sanctions
A `sanctions` table: account, kind, reason, issued_by, expires_at, lifted_at.

| Kind | Effect | Who can issue it |
|---|---|---|
| warn | Logged, and the player sees a notice | all staff |
| mute | Can't use say, whisper or channels | all staff |
| temp ban | 1h, 24h, 7d or 30d: can't log in | all staff |
| perma ban | Never expires | admin only |
| IP ban | Also blocks new accounts from that address | admin only |

The login and token check reads a cache kept in memory, so enforcing a ban costs no query.

## Phase 5: Staff channel
A `#staff` channel in the tablet Chat app, handled like `#corp:<id>`, for staff sockets only. The Admin app links to it.
