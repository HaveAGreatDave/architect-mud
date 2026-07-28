# weather

**Purpose** — a **deterministic, seeded** 7-day forecast, plus the moving per-zone weather field. Deterministic is the load-bearing word: the forecast can be shown to players ahead of time because it is derived, not rolled, and a restart cannot change what tomorrow was going to be.

## Hooks
- `environment.init`
- `environment.advanceWeather`
- `environment.recalculateForecast`
- `environment.weatherFieldSync`

## Data schema
- `weather_forecast`

## Commands
None — weather is not something you do.

## See also
[docs/systems-weather-extreme.md](../../docs/systems-weather-extreme.md) — the severity scalar, gear-gated-lethal channels, the ⚠ forecast band and the named hero events (built through step 7d, acid rain and the EMP/ion storm included).
