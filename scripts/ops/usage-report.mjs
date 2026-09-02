// Free-tier usage watch — Neon + Render.
//
// Run: npm run ops:usage            (verdict table, alerts if the pace is bad)
//      npm run ops:usage:discover   (raw API payloads, no verdicts)
//
// WHY PACE AND NOT TOTAL. "You have used 4.1 of 5 GB" arrives too late to act
// on. The question that has a useful answer is "at this rate, where does the
// cycle END", so every cycle metric is projected against how much of the billing
// period has elapsed, and the bands are on the PROJECTION, not the total.
//
// TWO GUARDS ON THAT PROJECTION, because a naive one is noise:
//
//   WARM-UP. On day 1 of a cycle, dividing by an elapsed fraction of 0.03
//   multiplies any early spike by 30. Days 1–3 are therefore suppressed unless
//   absolute usage has already passed a quarter of the month's allowance — at
//   which point it is not noise regardless of the projection.
//
//   ACCELERATION. A flat projection of 0.9 has been fine all month; a 0.5 → 0.9
//   climb over a week is the August failure happening again. Both read as "0.9"
//   to a snapshot, so the report compares against the run from ~7 days ago and
//   says which one it is.
//
// EXIT CODE IS 0 EVEN WHEN CRITICAL, by default. This is a reporter, not a gate:
// a monitor that fails a scheduled task because usage is high produces a red
// task every day for the rest of the cycle, which is how a monitor gets muted.
// `--fail-on-alert` opts into non-zero for a CI caller that wants it.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { LIMITS, staleLimits, fmt } from './limits.js';
import { collectNeon } from './neon-usage.mjs';
import { collectRender } from './render-usage.mjs';
import { loadHistory, saveHistory, runNearDaysAgo, HISTORY_PATH } from './history.mjs';
import { postWebhook } from './alert.mjs';

// Match db.js: walk up to the nearest .env so this works inside a git worktree,
// which git populates with tracked files only and so never receives one.
function findEnvFile(start) {
  let dir = start;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const envPath = findEnvFile(process.cwd());
dotenv.config(envPath ? { path: envPath, quiet: true } : { quiet: true });

const args = new Set(process.argv.slice(2));
const DISCOVER = args.has('--discover');
const AS_JSON = args.has('--json');
const NO_ALERT = args.has('--no-alert');
const NO_DB = args.has('--no-db');
const FAIL_ON_ALERT = args.has('--fail-on-alert');

// ---------------------------------------------------------------- assessment

export const BANDS = ['OK', 'WATCH', 'ALERT', 'CRITICAL'];
const BAND_ICON = { OK: '🟢', WATCH: '🟡', ALERT: '🟠', CRITICAL: '🔴', UNKNOWN: '⚪' };

const WARMUP_DAYS = 3;
const WARMUP_ABSOLUTE_FRACTION = 0.25;

/**
 * Band one metric. Pure — the smoke test drives this directly.
 *
 * @param used     absolute usage so far this cycle (or the standing value, for
 *                 a 'point' metric)
 * @param elapsed  fraction of the billing cycle elapsed, 0..1
 */
export function assess(key, used, elapsed) {
  const limit = LIMITS[key];
  if (!limit) return { key, band: 'UNKNOWN', reason: 'no limit defined for this key' };
  if (used === null || used === undefined || Number.isNaN(used)) {
    return { key, limit, band: 'UNKNOWN', reason: 'not reported by the API' };
  }

  // A standing cap (storage, branch count) has nothing to project: it is not
  // consumed over a cycle, so the ratio IS the answer.
  if (limit.period === 'point') {
    const ratio = used / limit.value;
    return { key, limit, used, ratio, projected: used, band: bandFor(ratio), point: true };
  }

  if (!elapsed || elapsed <= 0) {
    return { key, limit, used, band: 'UNKNOWN', reason: 'cycle boundary unknown — cannot project' };
  }

  const projected = used / elapsed;
  const ratio = projected / limit.value;
  let band = bandFor(ratio);

  // Warm-up suppression.
  const daysIn = elapsed * 30;
  const warm = daysIn < WARMUP_DAYS && used < limit.value * WARMUP_ABSOLUTE_FRACTION;
  if (warm && band !== 'OK') {
    return {
      key, limit, used, projected, ratio, band: 'OK', warmup: true,
      reason: `day ${daysIn.toFixed(1)} of the cycle — projection is not yet meaningful`,
    };
  }

  // Already over the absolute limit is CRITICAL regardless of pace: the pace
  // question is moot once the cycle's allowance is spent.
  if (used >= limit.value) band = 'CRITICAL';

  return { key, limit, used, projected, ratio, band };
}

function bandFor(ratio) {
  if (ratio >= 1.3) return 'CRITICAL';
  if (ratio >= 1.0) return 'ALERT';
  if (ratio >= 0.8) return 'WATCH';
  return 'OK';
}

/**
 * Should this run post to the webhook?
 *
 * Three rules, in order:
 *   1. Never post a green run unless it is a RECOVERY from a previous alert —
 *      "everything is fine" every day is how a channel gets muted.
 *   2. Always post a band CHANGE. Getting worse is news; getting better is the
 *      confirmation that whatever you changed worked.
 *   3. Otherwise, a sustained bad band nags once per 20h, not once per run —
 *      so an hourly cron and a daily one produce the same volume.
 *
 * `last` is the last DELIVERED alert ({at, band}), not the last run. A failed
 * post must not count as having notified anybody.
 */
export function shouldNotify(last, worst, now = new Date(), minHours = 20) {
  const changed = last?.band !== worst;
  if (worst === 'OK') return changed && Boolean(last); // rule 1: recovery only
  if (changed) return true;                            // rule 2
  const hoursSince = (now - new Date(last.at)) / 3_600_000;
  return hoursSince >= minHours;                       // rule 3
}

export function worstBand(assessments) {
  let worst = 'OK';
  for (const a of assessments) {
    if (a.band === 'UNKNOWN') continue;
    if (BANDS.indexOf(a.band) > BANDS.indexOf(worst)) worst = a.band;
  }
  return worst;
}

/** One month on from `start` — the fallback when a provider states no end. */
function addMonth(start) {
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

// ------------------------------------------------------------------ rendering

function pct(x) {
  return x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(0)}%`;
}

function renderTable(assessments, accel) {
  const rows = assessments.map((a) => {
    const unit = a.limit?.unit;
    const arrow = accel.get(a.key);
    // During warm-up the projection is arithmetically real but meaningless —
    // an hour into a cycle, 1 GB projects to 700 GB. Printing that next to a
    // green light reads as a contradiction and trains the reader to distrust
    // the colour, so the number is withheld and the reason named instead.
    const hideProjection = a.point || a.warmup || a.projected === undefined;
    return [
      `${BAND_ICON[a.band] ?? '⚪'} ${a.limit?.label ?? a.key}`,
      a.used === undefined ? '—' : fmt(a.used, unit),
      a.limit ? fmt(a.limit.value, unit) : '—',
      hideProjection ? (a.warmup ? 'too early' : '—') : fmt(a.projected, unit),
      a.warmup ? '—' : (a.ratio === undefined ? '—' : pct(a.ratio)),
      arrow ?? '',
    ];
  });
  const head = ['metric', 'used', 'limit', 'projected', 'of limit', '7d'];
  const all = [head, ...rows];
  const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd();
  return [line(head), w.map((n) => '─'.repeat(n)).join('  '), ...rows.map(line)].join('\n');
}

// ---------------------------------------------------------------------- main

async function main() {
  const now = new Date();
  const out = [];
  const say = (s = '') => { out.push(s); if (!AS_JSON) console.log(s); };

  // --- collect -------------------------------------------------------------
  const notes = [];
  let neon = null;
  let render = null;

  try {
    neon = await collectNeon({ now });
    notes.push(...neon.notes.map((n) => `neon: ${n}`));
  } catch (e) {
    notes.push(`neon: COLLECTION FAILED — ${e.message}`);
  }

  try {
    // Render exposes no cycle boundary. If Neon reported one, reuse it: both
    // accounts were opened in the same week, so the boundaries are close, and a
    // shared boundary makes the two halves of the table comparable. Flagged as
    // assumed either way.
    render = await collectRender({ now, cycleStart: neon?.cycleStart ?? undefined });
    notes.push(...render.notes.map((n) => `render: ${n}`));
  } catch (e) {
    notes.push(`render: COLLECTION FAILED — ${e.message}`);
  }

  // --- discover mode: dump and stop ----------------------------------------
  if (DISCOVER) {
    console.log(JSON.stringify({
      at: now.toISOString(),
      neon: neon ? { metrics: neon.metrics, cycleStart: neon.cycleStart, raw: neon.raw } : null,
      render: render ? { metrics: render.metrics, cycleStart: render.cycleStart, service: render.raw.service, raw: render.raw } : null,
      notes,
    }, null, 2));
    return 0;
  }

  // --- cycle position ------------------------------------------------------
  const cycleStart = neon?.cycleStart ?? render?.cycleStart ?? null;
  // Neon states its period end outright; Render does not, so it inherits Neon's
  // boundary and only falls back to a calendar month if Neon was unreachable.
  const end = neon?.cycleEnd ?? (cycleStart ? addMonth(cycleStart) : null);
  const elapsed = cycleStart && end
    ? Math.min(Math.max((now - cycleStart) / (end - cycleStart), 0), 1)
    : null;

  // --- assess --------------------------------------------------------------
  const metrics = { ...(neon?.metrics ?? {}), ...(render?.metrics ?? {}) };
  const assessments = Object.keys(LIMITS).map((key) => assess(key, metrics[key], elapsed));
  const worst = worstBand(assessments);

  // --- acceleration vs ~7 days ago ----------------------------------------
  const history = loadHistory();
  const past = runNearDaysAgo(history.runs, 7);
  const accel = new Map();
  if (past) {
    for (const a of assessments) {
      const then = past.ratios?.[a.key];
      if (typeof then !== 'number' || a.ratio === undefined || a.point) continue;
      const delta = a.ratio - then;
      if (Math.abs(delta) < 0.05) accel.set(a.key, '→');
      else accel.set(a.key, `${delta > 0 ? '↑' : '↓'}${Math.abs(delta * 100).toFixed(0)}%`);
    }
  }

  // --- print ---------------------------------------------------------------
  say(`Free-tier usage watch — ${now.toISOString().replace('T', ' ').slice(0, 16)}Z`);
  if (cycleStart) {
    say(`Cycle ${cycleStart.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}  ·  ${pct(elapsed)} elapsed${neon?.cycleStart ? '' : ' (assumed calendar month)'}`);
    // Grading is always against the FREE ceilings, because "can we live on free"
    // is the question. Say plainly when the live plan is not free, or a green
    // table would read as "we are within the free plan" when we are not on it.
    const planBits = [];
    if (neon) planBits.push(`Neon ${neon.plan ?? 'unknown'}${neon.onFree === false ? ' (NOT free)' : ''}`);
    if (render?.raw?.service) planBits.push(`Render ${render.raw.service.plan ?? 'unknown'}${render.raw.service.plan && render.raw.service.plan !== 'free' ? ' (NOT free)' : ''}`);
    if (planBits.length) say(`Plans: ${planBits.join('  ·  ')}  —  graded against FREE ceilings throughout`);
  } else {
    say('Cycle boundary unknown — projections suppressed.');
  }
  say();
  say(renderTable(assessments, accel));
  say();
  say(`Overall: ${BAND_ICON[worst]} ${worst}${past ? '' : '   (no 7-day-old run yet — trend column fills in next week)'}`);

  // --- attribution ---------------------------------------------------------
  let attribution = null;
  if (!NO_DB) {
    try {
      const { collectAttribution, connection, bootTablesOffDb } = await import('./attribution.mjs');
      attribution = await collectAttribution({ coldStartsPerDay: render?.uptime?.coldStartsPerDay ?? null });
      if (connection.note) notes.push(`attribution: ${connection.note}`);
      const { payload, loads, storage, modelledEgressPerDay } = attribution;
      say();
      say(`Attribution — where the egress comes from  (read from ${connection.target})`);
      say(`  boot payload      ${fmt(payload.totalBytes, 'bytes')} across ${payload.tables.length} boot-tier tables`);
      say(`  biggest three     ${payload.tables.slice(0, 3).map((t) => `${t.table} ${fmt(t.bytes, 'bytes')}`).join(', ')}`);
      // Say what was left out, or the number silently halves one day and the next
      // person reading this report has no way to know why.
      const offDb = bootTablesOffDb();
      if (offDb.length) say(`  not counted       ${offDb.join(', ')} — read off the checkout in prod, no egress`);
      say(`  world loads/day   ${loads.loadsPerDay === null ? '—' : loads.loadsPerDay.toFixed(1)}  [${loads.source}]`);
      if (loads.fallbackComparison) say(`                    (player_count_log alone would say ${loads.fallbackComparison.toFixed(1)} — it is idle-gated, so it cannot tell "down" from "up but empty")`);
      if (modelledEgressPerDay !== null) {
        const perCycle = modelledEgressPerDay * 30;
        say(`  modelled egress   ${fmt(modelledEgressPerDay, 'bytes')}/day → ${fmt(perCycle, 'bytes')}/cycle (${pct(perCycle / LIMITS['neon.transfer'].value)} of the 5 GB pool)`);

        // The divergence check. This is the part that tells you whether the
        // payload is the lever or a red herring.
        const actual = metrics['neon.transfer'];
        if (typeof actual === 'number' && elapsed > 0.15) {
          const actualPerCycle = actual / elapsed;
          const ratio = actualPerCycle / perCycle;
          if (ratio > 2) {
            say(`  ⚠ Neon reports ${ratio.toFixed(1)}× the modelled figure — world boot is NOT the main consumer this cycle. Look elsewhere before trimming the payload.`);
          } else if (ratio < 0.5) {
            say(`  · Neon reports ${ratio.toFixed(1)}× the model — fewer cold starts than the gap count implies. Model is pessimistic; trust the API number.`);
          } else {
            say(`  · Model and API agree within ${ratio.toFixed(1)}× — world boot is the budget, and boot payload is the lever.`);
          }
        }
      }
      if (storage.samples && storage.bytesPerDay) {
        say(`  db growth         ${fmt(storage.bytesPerDay, 'bytes')}/day over ${storage.samples} snapshots (pg_database_size, not the Neon quota figure)`);
      }
    } catch (e) {
      notes.push(`attribution: skipped — ${e.message}`);
    }
  }

  // --- notes + stale limits ------------------------------------------------
  const stale = staleLimits(now);
  for (const l of stale) notes.push(`limits: ${l.key} was last verified ${l.ageDays} days ago (${l.source}) — re-check the number`);
  for (const [key, l] of Object.entries(LIMITS)) {
    if (l.unverified) notes.push(`limits: ${key} ceiling (${fmt(l.value, l.unit)}) is UNVERIFIED — confirm against the dashboard before trusting its percentage`);
  }
  if (notes.length) {
    say();
    say('Notes');
    for (const n of notes) say(`  · ${n}`);
  }

  // --- persist -------------------------------------------------------------
  const ratios = {};
  for (const a of assessments) if (a.ratio !== undefined) ratios[a.key] = Number(a.ratio.toFixed(4));
  history.runs.push({
    at: now.toISOString(),
    cycleStart: cycleStart?.toISOString() ?? null,
    elapsed: elapsed === null ? null : Number(elapsed.toFixed(4)),
    used: Object.fromEntries(Object.entries(metrics).filter(([, v]) => typeof v === 'number')),
    ratios,
    band: worst,
    bootPayloadBytes: attribution?.payload.totalBytes ?? null,
    loadsPerDay: attribution?.loads.loadsPerDay ?? null,
  });

  // --- alert ---------------------------------------------------------------
  // De-dup: post on any band CHANGE, otherwise at most once per 20h while the
  // band is WATCH or worse. A sustained ALERT should nag daily, not hourly, and
  // a drop back to OK is worth saying once.
  if (!NO_ALERT && shouldNotify(history.lastAlert, worst, now)) {
    const lines = [
      `**${BAND_ICON[worst]} Free-tier watch — ${worst}**`,
      cycleStart ? `Cycle ${cycleStart.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}, ${pct(elapsed)} elapsed` : 'Cycle boundary unknown',
      '```',
      renderTable(assessments.filter((a) => a.band !== 'UNKNOWN' || a.used !== undefined), accel),
      '```',
    ];
    for (const a of assessments) {
      if (a.band === 'ALERT' || a.band === 'CRITICAL') lines.push(`• **${a.limit.label}** — ${a.limit.overrun}`);
    }
    if (attribution?.modelledEgressPerDay) {
      lines.push(`Boot payload ${fmt(attribution.payload.totalBytes, 'bytes')} × ${attribution.loads.loadsPerDay?.toFixed(1)} loads/day.`);
    }
    const delivered = await postWebhook(process.env.OPS_WEBHOOK_URL, lines.join('\n'));
    if (delivered) history.lastAlert = { at: now.toISOString(), band: worst };
  }

  saveHistory(history);
  if (AS_JSON) {
    console.log(JSON.stringify({ at: now.toISOString(), cycleStart, elapsed, band: worst, assessments, attribution, notes }, null, 2));
  } else {
    say();
    say(`History: ${HISTORY_PATH.replace(process.cwd(), '.')} (${history.runs.length} runs)`);
  }

  return FAIL_ON_ALERT && (worst === 'ALERT' || worst === 'CRITICAL') ? 1 : 0;
}

// Only run when invoked directly. The smoke test imports `assess`,
// `shouldNotify` and `worstBand` from this file; without this guard that import
// would fire a live API call and a webhook post as a side effect of testing.
const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) main()
  .then(async (code) => {
    // The pg pool keeps the process alive if attribution ran; close it.
    if (!NO_DB) {
      try {
        const { closeAttribution } = await import('./attribution.mjs');
        await closeAttribution();
      } catch { /* pool was never opened */ }
    }
    process.exit(code);
  })
  .catch((e) => {
    console.error(`Usage report failed: ${e.stack || e.message}`);
    process.exit(1);
  });
