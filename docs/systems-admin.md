# Admin controls

**Status:** Phases 1 and 2 (weather, time) and the ESP built; phases 3 to 5 are design.

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
