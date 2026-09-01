// Smoke test for the free-tier watch's decision logic.
//
// Everything the report DECIDES is pure — banding, warm-up suppression, alert
// de-duplication — and none of it needs a network, a key or a DB. So it gets
// gated like every other rule in this repo, and the fiddly cases (day-2 spike,
// sustained-alert nag, recovery notice) are asserted rather than reasoned about
// once and then trusted.
//
// The collectors are deliberately NOT covered here: they are I/O against two
// third-party APIs, and a mock of a response shape we are not yet sure of would
// assert our guess rather than their behaviour. `--discover` is how those get
// checked, against the real thing.
//
// Run: node scripts/ops/smoke.mjs   (wired into pretest:regress)
import { assess, shouldNotify, worstBand } from './usage-report.mjs';
import { LIMITS, staleLimits, fmt, BYTES_PER_GB } from './limits.js';
import { toBytes, pickService } from './render-usage.mjs';

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) passed += 1;
  else failures.push(name);
}

// ------------------------------------------------------------------- limits
check('every limit has a source URL', Object.values(LIMITS).every((l) => /^https:\/\//.test(l.source)));
check('every limit has a checkedOn date', Object.values(LIMITS).every((l) => !Number.isNaN(new Date(l.checkedOn).getTime())));
check('every limit says what overrun costs', Object.values(LIMITS).every((l) => typeof l.overrun === 'string' && l.overrun.length > 20));
check('every limit declares a period', Object.values(LIMITS).every((l) => ['cycle', 'point'].includes(l.period)));
check('no limit is stale on the day it was written', staleLimits(new Date('2026-08-31')).length === 0);
check('limits DO go stale eventually', staleLimits(new Date('2027-06-01')).length === Object.keys(LIMITS).length);

check('fmt renders bytes as GB', fmt(5 * BYTES_PER_GB, 'bytes') === '5.00 GB');
check('fmt renders a null as a dash', fmt(null, 'bytes') === '—');

// -------------------------------------------------------------------- bands
const HALF = 0.5; // half a cycle elapsed
const T = LIMITS['neon.transfer'].value;

check('on-pace usage is OK', assess('neon.transfer', T * 0.3, HALF).band === 'OK');
// 0.4 at half-elapsed projects to exactly 0.8 — the WATCH threshold is
// inclusive, so this is the boundary case, asserted deliberately.
check('exactly 0.8x pace is WATCH', assess('neon.transfer', T * 0.4, HALF).band === 'WATCH');
check('0.85x pace is WATCH', assess('neon.transfer', T * 0.425, HALF).band === 'WATCH');
check('1.1x pace is ALERT', assess('neon.transfer', T * 0.55, HALF).band === 'ALERT');
check('1.5x pace is CRITICAL', assess('neon.transfer', T * 0.75, HALF).band === 'CRITICAL');

// Already over the absolute allowance is CRITICAL no matter how late in the
// cycle it happened — the pace question is moot once the money is spent.
check('over the limit at 99% elapsed is still CRITICAL', assess('neon.transfer', T * 1.01, 0.99).band === 'CRITICAL');

check('an unreported metric is UNKNOWN, not zero', assess('neon.transfer', undefined, HALF).band === 'UNKNOWN');
check('an unknown key is UNKNOWN', assess('nope.nothing', 5, HALF).band === 'UNKNOWN');
check('no cycle boundary suppresses the projection', assess('neon.transfer', T * 0.9, null).band === 'UNKNOWN');

// A standing cap has nothing to project: 60% of the storage cap is 60%, not
// "120% projected". Getting this wrong would alarm on every healthy database.
const st = assess('neon.storage', LIMITS['neon.storage'].value * 0.6, HALF);
check('a point metric is not projected', st.point === true && st.band === 'OK');
check('a point metric over its cap is CRITICAL', assess('neon.storage', LIMITS['neon.storage'].value * 1.4, HALF).band === 'CRITICAL');

// ------------------------------------------------------------------ warm-up
// Day 2 with a modest spike: 10% of the allowance projects to 150% and must NOT
// fire. This is the guard that stops the monitor crying wolf every 1st and 2nd.
const day2 = 2 / 30;
const early = assess('neon.transfer', T * 0.1, day2);
check('a day-2 spike is suppressed', early.band === 'OK' && early.warmup === true);
check('suppression says why', /not yet meaningful/.test(early.reason));

// ...but warm-up is not a blanket amnesty. A third of the month's allowance in
// two days is real regardless of what the projection maths says.
check('warm-up does NOT hide a huge absolute burn', assess('neon.transfer', T * 0.35, day2).band === 'CRITICAL');
check('warm-up expires after day 3', assess('neon.transfer', T * 0.2, 4 / 30).band !== 'OK');

// ----------------------------------------------------------------- roll-up
check('worst band wins', worstBand([{ band: 'OK' }, { band: 'ALERT' }, { band: 'WATCH' }]) === 'ALERT');
check('UNKNOWN never becomes the verdict', worstBand([{ band: 'OK' }, { band: 'UNKNOWN' }]) === 'OK');
check('all-unknown reads OK rather than alarming', worstBand([{ band: 'UNKNOWN' }]) === 'OK');

// ------------------------------------------------------------- notification
const now = new Date('2026-09-10T09:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();

check('first-ever green run says nothing', shouldNotify(null, 'OK', now) === false);
check('first-ever bad run posts', shouldNotify(null, 'ALERT', now) === true);
check('a worsening band posts', shouldNotify({ at: hoursAgo(1), band: 'WATCH' }, 'ALERT', now) === true);
check('recovery to OK posts once', shouldNotify({ at: hoursAgo(1), band: 'ALERT' }, 'OK', now) === true);
check('staying green stays quiet', shouldNotify({ at: hoursAgo(1), band: 'OK' }, 'OK', now) === false);

// The nag rule. An hourly cron and a daily cron must produce the same volume,
// or "run it more often for fresher data" silently becomes 24x the noise.
check('a sustained ALERT does not re-post after 1h', shouldNotify({ at: hoursAgo(1), band: 'ALERT' }, 'ALERT', now) === false);
check('a sustained ALERT nags again after 21h', shouldNotify({ at: hoursAgo(21), band: 'ALERT' }, 'ALERT', now) === true);

// ------------------------------------------------- render unit conversion
// The bug this guards: Render's bandwidth series declares `unit: "mb"`, and
// summing those numbers as bytes understates usage by 10^6 — which shows up as
// a permanently empty, permanently green bandwidth row rather than as an error.
check('mb is megabytes, not bytes', toBytes(1, 'mb') === 1e6);
check('unit matching is case-insensitive', toBytes(1, 'MB') === 1e6);
check('kb/gb scale decimally', toBytes(1, 'kb') === 1e3 && toBytes(1, 'gb') === 1e9);
check('binary units are distinct from decimal', toBytes(1, 'mib') === 1048576);
check('bytes passes through', toBytes(5, 'bytes') === 5);
// Refusing to guess is the point: a silent wrong scale is worse than no number.
check('an unknown unit returns null rather than guessing', toBytes(1, 'furlongs') === null);
check('a missing unit returns null', toBytes(1, undefined) === null);

// ------------------------------------------------------ render service pick
// The service has been called two different things across the July account
// cutover, and a monitor reporting on nothing looks exactly like a monitor
// reporting no problem.
const svcs = [
  { id: 'srv-1', name: 'architect-mud', type: 'web_service' },
  { id: 'srv-2', name: 'something-else', type: 'static_site' },
];
check('resolves the current name', pickService(svcs).service.id === 'srv-1');
check('resolves the old cutover name too', pickService([{ id: 'srv-9', name: 'architect-mud-live', type: 'web_service' }]).service.id === 'srv-9');
check('falls back to the sole web service', pickService([{ id: 'srv-x', name: 'renamed-again', type: 'web_service' }]).service.id === 'srv-x');
check('…and says how it resolved', /only web service/.test(pickService([{ id: 'srv-x', name: 'renamed-again', type: 'web_service' }]).how));
check('no web service at all resolves to nothing', pickService([{ id: 's', name: 'x', type: 'static_site' }]).service === null);
// Ambiguity must NOT be guessed at — two unnamed web services is an error case.
check('two unknown web services is ambiguous, not a coin flip', pickService([
  { id: 'a', name: 'aaa', type: 'web_service' }, { id: 'b', name: 'bbb', type: 'web_service' },
]).service === null);

// ------------------------------------------------------------------- report
if (failures.length) {
  console.error(`✗ ops smoke: ${failures.length} failed of ${passed + failures.length}`);
  for (const f of failures) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`✓ ops smoke: ${passed}/${passed} passed`);
