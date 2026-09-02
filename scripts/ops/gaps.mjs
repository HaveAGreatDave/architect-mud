// Are the gaps in Render's CPU timeline real spin-downs, or missed scrapes?
//
// The usage report derives two numbers from ONE series and they disagree.
// Measured 2026-09-02: instance-hours tracked wall clock at 93–96% (the service
// was up essentially all month), while cold starts came out at 12.6/day. Those
// cannot both be true. 12.6 gaps a day against ~1.4h/day of missing samples is
// an average gap under 7 minutes, and Render will not spin a free service down
// until 15 minutes have passed with no inbound request. So either:
//
//   • the gaps are scrape misses, and the cold-start rate — which is the
//     MULTIPLIER in the whole egress model — is inflated; or
//   • they are real, the service is being woken constantly, and the spin-down
//     saving keepalive.js was written to collect is not being collected.
//
// A gap HISTOGRAM tells the two apart, and a histogram is about twenty lines.
// `--discover` dumps the whole series instead: a week at one-minute resolution
// is ~10,000 timestamps of JSON, which is why it scrolls off a terminal and why
// pasting it around is the wrong move. Same API, same auth, one question.
//
// Read it like this: a cluster at exactly 2–3× the resolution is a scraper
// missing a beat. A population at 15 minutes and above is the idle threshold,
// i.e. genuine spin-downs. A handful of multi-minute gaps at deploy times are
// the 4-hourly content deploy rebooting the service, and are expected.
//
//   node scripts/ops/gaps.mjs [--days 7]
//
// Needs RENDER_API_KEY in .env, same as the report.
import { readFileSync, existsSync } from 'node:fs';
import { api, pickService, SERVICE_NAMES } from './render-usage.mjs';

// Same .env convenience the report has, so this runs from a bare checkout.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 7;

const key = process.env.RENDER_API_KEY;
if (!key) {
  console.error('RENDER_API_KEY is not set (put it in .env, next to the one ops:usage uses).');
  process.exit(1);
}

const now = new Date();
const from = new Date(now.getTime() - days * 86_400_000);

const services = (await api('/services?limit=100', key)).map((r) => r?.service ?? r).filter(Boolean);
const { service: svc, how } = pickService(services);
if (!svc) {
  console.error(`No production Render service found (tried: ${SERVICE_NAMES.join(', ')}).`);
  process.exit(1);
}

const body = await api(
  `/metrics/cpu?resource=${svc.id}&startTime=${from.toISOString()}&endTime=${now.toISOString()}`,
  key,
);
const stamps = [...new Set(
  (Array.isArray(body) ? body : []).flatMap((s) => (s.values ?? []).map((v) => +new Date(v.timestamp))),
)].filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);

if (stamps.length < 3) {
  console.error(`Only ${stamps.length} CPU samples over ${days}d — nothing to analyse.`);
  process.exit(1);
}

// Resolution is the MODAL gap, never the minimum — Render coarsens the series as
// the window widens, and one anomalous short gap would otherwise set the scale
// for everything below it. Same rule as render-usage.mjs.
const counts = new Map();
for (let i = 1; i < stamps.length; i += 1) {
  const g = stamps[i] - stamps[i - 1];
  counts.set(g, (counts.get(g) ?? 0) + 1);
}
const res = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
const resMin = res / 60_000;

const span = (stamps[stamps.length - 1] - stamps[0]) / 86_400_000;
const gaps = [];
for (let i = 1; i < stamps.length; i += 1) {
  const g = stamps[i] - stamps[i - 1];
  if (g > res * 3) gaps.push({ at: new Date(stamps[i - 1]), min: g / 60_000 });
}
const downMin = gaps.reduce((a, g) => a + g.min, 0);

const fmt = (n, d = 1) => n.toFixed(d);
console.log(`service            ${svc.name}  (${how})`);
console.log(`window             ${fmt(span, 2)}d, ${stamps.length} samples at ${fmt(resMin, 1)}min resolution`);
console.log(`uptime             ${fmt((stamps.length * res) / 3_600_000, 1)}h of ${fmt(span * 24, 1)}h wall clock`);
console.log(`gaps (>3x res)     ${gaps.length}  →  ${fmt((gaps.length + 1) / span, 1)}/day, ${fmt(downMin, 0)}min missing total`);
console.log();

// The histogram is the answer. Buckets straddle the 15-minute idle threshold
// deliberately: everything below it is something other than a spin-down.
const BUCKETS = [
  ['under 5min      ', (m) => m < 5],
  ['5–15min         ', (m) => m >= 5 && m < 15],
  ['15–30min  (idle)', (m) => m >= 15 && m < 30],
  ['30–120min       ', (m) => m >= 30 && m < 120],
  ['over 2h         ', (m) => m >= 120],
];
console.log('gap distribution   (15min is Render\'s idle threshold — below it is NOT a spin-down)');
for (const [label, test] of BUCKETS) {
  const n = gaps.filter((g) => test(g.min)).length;
  const bar = '█'.repeat(Math.min(Math.round((n / Math.max(gaps.length, 1)) * 40), 40));
  console.log(`  ${label} ${String(n).padStart(4)}  ${bar}`);
}

const short = gaps.filter((g) => g.min < 15).length;
console.log();
console.log(short / Math.max(gaps.length, 1) > 0.5
  ? `VERDICT  ${short}/${gaps.length} gaps are shorter than the idle threshold, so most are not spin-downs.\n         The cold-start rate — the multiplier in the egress model — is overstated by roughly that much.`
  : `VERDICT  ${gaps.length - short}/${gaps.length} gaps reach the idle threshold, so the spin-downs are real.\n         The service is being woken ${fmt((gaps.length + 1) / span, 1)}x/day, and each wake re-reads the boot payload.`);

console.log();
console.log('ten longest gaps (UTC):');
for (const g of [...gaps].sort((a, b) => b.min - a.min).slice(0, 10)) {
  console.log(`  ${g.at.toISOString().slice(0, 16).replace('T', ' ')}  ${fmt(g.min, 0).padStart(5)}min`);
}
