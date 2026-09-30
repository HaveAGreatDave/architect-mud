# admin

**Status:** Weather and time built. Players and the staff channel are design; see [docs/systems-admin.md](../../docs/systems-admin.md).

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

## Tablet app
`tablet-app.js` registers `admin`, with Weather and Time tabs. Each shows a hero card and tiles for the live state, with sliders, chip rows and buttons to change it. Each control calls the same function its verb does. The shell doesn't re-check `visible` on `tabletnav`/`tabletaction`, so `buildScreen` and `handleAction` both check the role themselves.

## Data
None of its own. Weather goes through the engine's override (`devOverrideWeather`/`devClearWeatherOverride` in `server/engine/environment.js`). Every change is written to the activity log as `admin_cmd`.
