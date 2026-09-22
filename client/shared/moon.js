/**
 * THE MOON — a synodic cycle over the world calendar, and nothing else.
 *
 * 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last. Purely DERIVED from a game date: no
 * column, no tick, no row, and exactly one right answer for a given day.
 *
 * ⚠ IT IS SHARED FOR THE REASON client/shared/ground-accum.js IS, and that reason is a bug this
 * file was extracted to fix. The arithmetic lived in server/engine/environment.js and the answer
 * reached the client only as `moonPhase` on `getHUDPayload()` — which is carried by
 * `environment.sync`, `environment.daily` and the REST route, and NOT by `environment.clockTick`,
 * the per-minute broadcast. So the frequent route advances the client's DATE while saying nothing
 * about the moon, and any client that kept the wire field would be holding a moon from whenever the
 * last daily tick happened to be.
 *
 * The date is the only input, both sides have the date, and the function is pure — so both sides
 * derive it, and the two answers are identical by construction rather than by a field name matching.
 *
 * ⚠ AND THERE MUST NEVER BE A SECOND COPY OF THIS ARITHMETIC. The server's own comment on
 * `getMoonPhase` already carried that warning about the season table — "a second copy is a second
 * thing to forget when the calendar changes (the weather plugin carried a verbatim duplicate until
 * 2026-08-20)" — and the moon had quietly become the same shape of problem. `getMoonPhase` in
 * environment.js is kept as the server's name for it and delegates here.
 */

export const SYNODIC_DAYS = 29.53059;

// ⚠ THE OFFSET IS NOT COSMETIC AND MUST NOT BE RETUNED. It lands the epoch on a new moon rather
// than at an arbitrary point in the cycle, so every date in the world's history keeps the phase it
// has always had. Moving it by a day moves every night sky in the game, and `moonarc.mjs`'s whole
// premise is that the phase IS the sun-moon angle, so it would move the moon's rise time too.
export const MOON_EPOCH_OFFSET = 6.7;

// What a caller with no date at all gets. ⚠ IT IS 0.5 BY AGREEMENT WITH THE RENDERER, not by
// taste: `paintWindshield` reads `v.moon != null ? … : 0.5`, and at 0.5 `moonArc` gives the
// 18:00-06:00 night that every pinned frame, bench and harness in the repo was captured against.
// See the migration-invariant check at the top of scripts/shapes/moonarc.mjs.
export const DEFAULT_MOON_PHASE = 0.5;

/**
 * @param {string} dateStr  a `YYYY-MM-DD` game date
 * @returns {number} the phase in [0, 1), or DEFAULT_MOON_PHASE if there is no usable date
 */
export function moonPhaseOf(dateStr) {
  if (!dateStr) return DEFAULT_MOON_PHASE;
  const d = String(dateStr);
  const days = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  // ⚠ A MALFORMED DATE MUST FALL BACK RATHER THAN PROPAGATE NaN. `Date.UTC` answers NaN for a
  // string this cannot parse, and NaN carries all the way to `drawMoon`'s gradient stops, where it
  // throws inside a frame — the class of failure the drug-FX and vehicle-model notes both record.
  if (!Number.isFinite(days)) return DEFAULT_MOON_PHASE;
  return ((((days - MOON_EPOCH_OFFSET) / SYNODIC_DAYS) % 1) + 1) % 1;
}
