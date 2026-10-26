# admin

**Status:** Weather, time, the ESP, unrest and the Coliseum roof built. Players and the staff channel are design; see [docs/systems-admin.md](../../docs/systems-admin.md).

**Purpose:** in-game staff controls. There's a typed `sysop` verb, and the Tablet Admin app is a skin over it. Both are open to the dev, admin, builder and designer roles. The verb is `sysop` because the engine already owns `admin`.

## Commands
- `sysop`: the weather readout and usage.
- `sysop weather`: the live weather, whether the override is on, and any named event.
- `sysop weather set <type> [tempC] [precip%]`: force today's weather. Leave out a field to keep its current value.
- `sysop weather temp <C>` and `sysop weather rain <0-100>`: change one field.
- `sysop weather event <type>`: start a named event (ion storm, acid rain, rainbow…).
- `sysop weather reset`: clear the override and return to the forecast.
- `sysop weather wind <kph>`: force the wind.
- `sysop time`: the clock, date, phase, frozen or running, and speed.
- `sysop time skip <4|8|12|24>`: skip forward. Midnights crossed run the daily tick, and the street horns announce it to everyone online.
- `sysop time set <HH:MM>`: set the clock (also announced).
- `sysop time freeze` / `unfreeze`, and `sysop time speed <1|2|3|6>`.
- `sysop esp`: whether the city is locked down. `sysop esp on [message]` starts the ESP (sirens, the Curtain shut, the South Lock down); `sysop esp off` ends it. Same lockdown as the devpanel's button, through the emergency plugin's `ESP_ACTIVATE`/`ESP_DEACTIVATE` actions.
- `sysop unrest`: every city block's mood, worst first. `sysop unrest <block|here>` reads one block. `sysop unrest tick` runs one 30-minute tick of the sim; `calm <block|here|all>`, `stir <block|here>`, `set <block|here> <grip|heat|pressure> <0-100>`, `stage <block|here> <incident>` and `end <block|here>` change it. Calls the unrest plugin's own functions, as the devpanel does.
- `sysop roof`: where the Coliseum's roof is and what today's forecast says. `sysop roof open` / `shut` moves it now (about five minutes) and holds it until the forecast day turns over; `sysop roof auto` hands it back to the forecast.

## Tablet app
`tablet-app.js` registers `admin`, with Weather, Time, ESP, Unrest and Roof tabs. Unrest is a map of the city's blocks coloured by mood; tap one for its gauges and controls ([docs/systems-admin.md](../../docs/systems-admin.md#unrest-)). Each shows a hero card and tiles for the live state, with sliders, chip rows and buttons to change it. Each control calls the same function its verb does. The shell doesn't re-check `visible` on `tabletnav`/`tabletaction`, so `buildScreen` and `handleAction` both check the role themselves.

## Data
None of its own. Weather goes through the engine's override (`devOverrideWeather`/`devClearWeatherOverride` in `server/engine/environment.js`). Every change is written to the activity log as `admin_cmd`.
