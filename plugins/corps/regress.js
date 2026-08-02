// Corps plugin regression suite — run by tests/regress.js (never in production).
// Covers the corp-recruitment-poster `furniture.describe` branch: it claims only
// `corp_poster` furniture and returns undefined for everything else, so the
// posters plugin's own hook still runs (hook contract: last non-undefined wins).
import { _corpPosterPitch, colorDistance, MIN_COLOR_DISTANCE, DESTABILIZE } from './index.js';
import { CORP_ASSET_TYPES, ventureConsoleBlock, warehouseStoreCapacity } from './ventures.js';
import { RACKET_BANDS, FEAR_HALFLIFE_DAYS, FEAR_CAP, fearNow, fearBand, racketConsoleBlock } from './rackets.js';

export default async function regress({ run, check }) {
  // ── Corporate Assets (ventures.js) — registry + console block ──────────────
  // The type registry is the "building framework"; every type must be well-formed
  // so the tick/console can trust its fields without guards.
  const R = CORP_ASSET_TYPES.restaurant;
  check('ventures: restaurant type exists', !!R, R);
  check('ventures: restaurant has a positive passive floor', R?.passiveFloor > 0, R?.passiveFloor);
  check('ventures: restaurant active share is a sane fraction', R?.activeShare > 0 && R?.activeShare <= 1, R?.activeShare);
  check('ventures: restaurant upkeep is non-negative', (R?.upkeep ?? -1) >= 0, R?.upkeep);
  check('ventures: all four types registered', ['restaurant', 'warehouse', 'security_office', 'front_office'].every(k => CORP_ASSET_TYPES[k]));
  check('ventures: every type has a label + numeric fields', Object.values(CORP_ASSET_TYPES).every(t =>
    typeof t.label === 'string' && typeof t.passiveFloor === 'number' && typeof t.upkeep === 'number' && typeof t.influenceProjection === 'number'));
  // The console block is safe for an org that owns nothing (empty array, never throws).
  const emptyBlock = ventureConsoleBlock('org-that-does-not-exist');
  check('ventures: console block for an assetless org is an empty array', Array.isArray(emptyBlock) && emptyBlock.length === 0);

  // ── Warehouse venture + pooled Logistics Store (the Yards build) ────────────
  const W = CORP_ASSET_TYPES.warehouse;
  check('ventures: warehouse type is fleshed (no longer a stub)', !!W && W.passiveFloor > 0 && (W.upkeep ?? -1) >= 0 && !W.TODO, W);
  check('ventures: warehouse has no storefront share (activeShare 0)', W?.activeShare === 0, W?.activeShare);
  check('ventures: warehouse projects territory influence', W?.influenceProjection > 0, W?.influenceProjection);
  // Pooled store capacity = 200kg × level, summed over WAREHOUSE ventures only
  // (a restaurant contributes nothing) — the pure, world-cache-free math.
  const cap = warehouseStoreCapacity([
    { asset_type: 'warehouse', level: 1 },
    { asset_type: 'warehouse', level: 2 },
    { asset_type: 'restaurant', level: 5 },
  ]);
  check('ventures: logistics store capacity = 200kg × level over warehouses only', cap === 600000, cap);
  check('ventures: store capacity for no warehouses is zero', warehouseStoreCapacity([]) === 0);
  // `corp warehouse` routes through the dispatcher (not an "unknown corp command").
  const wh = await run('corp warehouse');
  check('corp warehouse → routes through the corp dispatcher', !!wh && !/Unknown corp command/.test(wh.message || ''), (wh?.message || '').slice(0, 60));

  // ── Phase 3: war / peace / raid route through the dispatcher (not "unknown
  // corp command"). The fake regress player is in no corp, so each lands on the
  // corp-shaped "not in a corp" guard — which proves the verb is wired, same
  // pattern as the `corp warehouse` routing check above.
  for (const verb of ['war rival', 'peace rival', 'raid']) {
    const r = await run(`corp ${verb}`);
    check(`corp ${verb.split(' ')[0]} → routes through the corp dispatcher`,
      !!r && !/Unknown corp command/.test(r.message || ''), (r?.message || '').slice(0, 50));
  }
  // Destabilization weights escalate with how loud the act is (petty < hack < kill)
  // and are all positive — the funnel negates them, so a zero would be a no-op bug.
  check('destabilize weights escalate petty<hack<kill and are positive',
    DESTABILIZE.petty > 0 && DESTABILIZE.petty < DESTABILIZE.hack && DESTABILIZE.hack < DESTABILIZE.kill, DESTABILIZE);

  // `corp territory` — the big-map overlay layer: a corp-free control projection
  // the client merges onto the engine `map` tiles. Returns a control map keyed by
  // zone id + an org legend, and opens nothing (unlike `corp map`).
  const terr = await run('corp territory');
  check('corp territory → map_territory payload', terr?.type === 'map_territory', terr?.type);
  check('corp territory → control is an object', terr && terr.control && typeof terr.control === 'object' && !Array.isArray(terr.control));
  check('corp territory → orgs is an array', Array.isArray(terr?.orgs));

  // ── Protection rackets (rackets.js) ────────────────────────────────────────
  // Bands must be ordered high→low and their rates must fall with them, because
  // fearBand() takes the FIRST band whose minimum is met — an out-of-order table
  // would silently pay the wrong cut rather than throw.
  const mins = RACKET_BANDS.map(b => b.min);
  check('rackets: bands are ordered high → low', mins.every((m, i) => i === 0 || m < mins[i - 1]), mins);
  check('rackets: cut rates fall with fear', RACKET_BANDS.every((b, i) => i === 0 || b.rate <= RACKET_BANDS[i - 1].rate), RACKET_BANDS.map(b => b.rate));
  check('rackets: the bottom band pays nothing', RACKET_BANDS[RACKET_BANDS.length - 1].rate === 0);
  check('rackets: the bottom band catches zero fear', RACKET_BANDS[RACKET_BANDS.length - 1].min === 0);
  check('rackets: every band has a label and a key', RACKET_BANDS.every(b => typeof b.label === 'string' && typeof b.key === 'string'));
  // Each band boundary resolves to its own band — off-by-one here is a silent
  // pay-rate bug, not a crash.
  for (const b of RACKET_BANDS) check(`rackets: fear ${b.min} → ${b.key}`, fearBand(b.min).key === b.key, fearBand(b.min).key);
  check('rackets: fear above the cap still bands as terrified', fearBand(FEAR_CAP).key === 'terrified');

  // Decay is a pure function of elapsed time — this is the whole mechanic, so it
  // gets exercised directly rather than trusted.
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const at = (daysAgo, fear = 80) => ({ fear, last_leaned_at: Math.floor((now - daysAgo * DAY) / 1000) });
  check('rackets: fresh fear is undecayed', Math.round(fearNow(at(0), now)) === 80, fearNow(at(0), now));
  check('rackets: sub-day elapsed does not decay (noise short-circuit)', fearNow(at(0.5), now) === 80, fearNow(at(0.5), now));
  const halved = fearNow(at(FEAR_HALFLIFE_DAYS), now);
  check('rackets: one half-life halves fear', Math.abs(halved - 40) < 0.5, halved);
  check('rackets: two half-lives quarter it', Math.abs(fearNow(at(FEAR_HALFLIFE_DAYS * 2), now) - 20) < 0.5, fearNow(at(FEAR_HALFLIFE_DAYS * 2), now));
  check('rackets: decay is monotonic', fearNow(at(3), now) > fearNow(at(9), now) && fearNow(at(9), now) > fearNow(at(30), now));
  check('rackets: a long-neglected racket lapses to a zero cut', fearBand(fearNow(at(60), now)).rate === 0, fearNow(at(60), now));
  check('rackets: half-life is faster than the 7-day rent clock is slow (never feels like a bill)', FEAR_HALFLIFE_DAYS <= 14, FEAR_HALFLIFE_DAYS);
  check('rackets: zero fear decays to zero, never NaN', fearNow({ fear: 0, last_leaned_at: 0 }, now) === 0);
  check('rackets: a null racket reads as zero fear (no throw)', fearNow(null) === 0);
  check('rackets: a missing timestamp does not produce NaN', Number.isFinite(fearNow({ fear: 50 }, now)));

  // Console block is safe for a corp with nobody on the books.
  const rBlock = racketConsoleBlock('org-that-does-not-exist');
  check('rackets: console block for a corp with no rackets is an empty array', Array.isArray(rBlock) && rBlock.length === 0);

  // Verb routing: `corp racket` reaches the dispatcher and `lean` is registered.
  // The fake player is in no corp, so both land on a corp-shaped guard — which is
  // what proves they're wired (same pattern as `corp warehouse` above).
  const rk = await run('corp racket list');
  check('corp racket → routes through the corp dispatcher', !!rk && !/Unknown corp command/.test(rk.message || ''), (rk?.message || '').slice(0, 60));
  const ln = await run('shakedown somebody');
  check('shakedown → is a registered verb, not an unknown command', !!ln && !/Unknown command/i.test(ln.message || ''), (ln?.message || '').slice(0, 60));
  // Membership is checked before target resolution, so a corp-less player gets the
  // corp refusal rather than "no such shopkeeper" — the cheap gate goes first.
  check('shakedown → refuses a player with no corp', /not in a corp/i.test(ln?.message || ''), (ln?.message || '').slice(0, 60));
  // `lean` must still belong to the interactions plugin (furniture), NOT to corps.
  const leanStill = await run('lean');
  check('lean → still the interactions furniture verb, not hijacked by corps', !/not in a corp/i.test(leanStill?.message || ''), (leanStill?.message || '').slice(0, 60));

  const poster = _corpPosterPitch({ name: 'a recruitment poster', flags: { corp_poster: true } });
  check('corp poster → leads to the recruiter, not a command list', typeof poster === 'string' && /Denny Corliss/.test(poster) && !/corp found/.test(poster), (poster || '').slice(0, 80));
  check('corp poster → no clickable command link (mechanics live in dialogue)', !/action-link/.test(poster || ''));

  const wink = _corpPosterPitch({ name: 'a poster', flags: { corp_poster: true, architect_wink: true } });
  check('architect-wink poster → adds the fine-print motif', /NORTHERN ACCESS|—A/.test(wink || ''));
  check('plain corp poster → no wink motif', !/NORTHERN ACCESS/.test(poster || ''));

  // `corp edit color` distinctness gate — corps must keep a visibly different map
  // colour. colorDistance is the pure perceptual check the command guards on.
  check('color: identical colours have zero distance', colorDistance('#3366ff', '#3366ff') === 0);
  check('color: near-identical shades are below the distinct threshold', colorDistance('#ff2020', '#ff0000') < MIN_COLOR_DISTANCE);
  check('color: red vs green are comfortably distinct', colorDistance('#ff0000', '#00ff00') >= MIN_COLOR_DISTANCE);
  check('color: adjacent greys are too close', colorDistance('#888888', '#999999') < MIN_COLOR_DISTANCE);

  check('non-corp furniture → undefined (yields to other hooks)', _corpPosterPitch({ name: 'a chair', flags: { hero_poster: true } }) === undefined);
  check('flagless furniture → undefined', _corpPosterPitch({ name: 'a crate', flags: {} }) === undefined);
  check('null furniture → undefined (no throw)', _corpPosterPitch(null) === undefined);
}
