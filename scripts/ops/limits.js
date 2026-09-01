// The free-plan ceilings, as auditable data rather than folklore.
//
// WHY EACH ROW CARRIES A SOURCE AND A DATE. Both providers move their plans.
// Render restructured its workspace plans on 2026-04-23 and third-party
// summaries still disagree about the free bandwidth allowance (100 GB vs 5 GB).
// A number in a script with no provenance is a rumour that fails silently: the
// report keeps printing confident percentages against a ceiling that moved, and
// nobody can tell without re-reading the pricing page. So every limit names the
// page it came from and the day it was read, and `staleLimits()` nags when a row
// goes a quarter without being re-checked.
//
// The correct fix for a stale row is to open `source`, read the number, and
// update `value` + `checkedOn` together. Bumping the date without opening the
// page is how this decays back into folklore.

export const BYTES_PER_GB = 1024 ** 3;

// How old a limit may get before the report starts flagging it (days).
export const LIMIT_STALE_DAYS = 90;

/**
 * Every ceiling we care about. Keys are `<provider>.<metric>` and are the join
 * key between the collectors and the report — a collector returning a key with
 * no row here is reported as unknown rather than silently dropped.
 *
 *   value    — the ceiling, in `unit`
 *   unit     — 'bytes' | 'cu-hours' | 'hours' | 'minutes' | 'count'
 *   scope    — what the ceiling applies to. LOAD-BEARING for Neon transfer,
 *              which pools across every project in the account.
 *   period   — 'cycle' (resets each billing period) | 'point' (a standing cap,
 *              e.g. storage or branch count — projection is meaningless)
 *   overrun  — what actually happens when you cross it. This is the sentence
 *              that belongs in the alert; "80% of quota" motivates nobody.
 */
export const LIMITS = {
  'neon.transfer': {
    label: 'Neon egress',
    value: 5 * BYTES_PER_GB,
    unit: 'bytes',
    scope: 'account-wide, pooled across all projects',
    period: 'cycle',
    overrun: 'Neon suspends compute until the next billing period — the game goes down.',
    source: 'https://neon.com/docs/introduction/plans',
    checkedOn: '2026-08-31',
  },
  'neon.compute': {
    label: 'Neon compute',
    value: 100,
    unit: 'cu-hours',
    scope: 'per project',
    period: 'cycle',
    overrun: 'Neon suspends compute until the next billing period — the game goes down.',
    source: 'https://neon.com/docs/introduction/plans',
    checkedOn: '2026-08-31',
  },
  'neon.storage': {
    label: 'Neon storage',
    value: 0.5 * BYTES_PER_GB,
    unit: 'bytes',
    scope: 'per project',
    period: 'point',
    overrun: 'Writes start failing. Not a cycle reset — it stays over until data is removed.',
    source: 'https://neon.com/docs/introduction/plans',
    checkedOn: '2026-08-31',
  },
  'neon.branches': {
    label: 'Neon branches',
    value: 10,
    unit: 'count',
    scope: 'per project',
    period: 'point',
    // Not a billing risk — a deploy risk. deploy-content.yml creates a
    // predeploy-* snapshot branch per deploy and prunes to the newest 5, but the
    // prune step is continue-on-error. If it wedges, branches climb to the cap
    // and the NEXT deploy's snapshot fails, which aborts the deploy before prod.
    overrun: 'The pre-deploy snapshot fails, which aborts every content deploy.',
    source: 'https://neon.com/docs/introduction/plans',
    checkedOn: '2026-08-31',
  },

  'render.bandwidth': {
    label: 'Render bandwidth',
    value: 100 * BYTES_PER_GB,
    unit: 'bytes',
    scope: 'workspace',
    period: 'cycle',
    overrun: 'Billed at ~$0.15/GB, or the service is throttled — verify which on the plan page.',
    source: 'https://render.com/docs/outbound-bandwidth',
    checkedOn: '2026-08-31',
    // ⚠ The one number in this table I am least sure of. Sources disagree
    // (100 GB vs 5 GB) across Render's April 2026 plan change. `--discover`
    // prints the observed usage; check it against the dashboard's own
    // "x of y GB used" before trusting any percentage computed from this.
    unverified: true,
  },
  'render.instanceHours': {
    label: 'Render instance hours',
    value: 750,
    unit: 'hours',
    scope: 'workspace',
    period: 'cycle',
    // Corroborated in-repo: server/keepalive.js documents spending ~730 of 750
    // on 24/7 health pings, which is why it idle-gates on hasActivePlayers().
    overrun: 'The free service stops serving until the cycle resets.',
    source: 'https://render.com/docs/free',
    checkedOn: '2026-08-31',
  },
  'render.buildMinutes': {
    label: 'Render build minutes',
    value: 500,
    unit: 'minutes',
    scope: 'workspace',
    period: 'cycle',
    overrun: 'Builds queue or fail, so content deploys stop reaching the live world.',
    source: 'https://render.com/docs/free',
    checkedOn: '2026-08-31',
  },
};

/** Limits whose `checkedOn` is older than LIMIT_STALE_DAYS, newest-first. */
export function staleLimits(now = new Date()) {
  return Object.entries(LIMITS)
    .map(([key, l]) => ({
      key,
      ...l,
      ageDays: Math.floor((now - new Date(l.checkedOn)) / 86_400_000),
    }))
    .filter((l) => l.ageDays > LIMIT_STALE_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);
}

/** Human-readable rendering of a value in its limit's unit. */
export function fmt(value, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  switch (unit) {
    case 'bytes': {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = value;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
      return `${v < 10 && i > 0 ? v.toFixed(2) : v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }
    case 'cu-hours': return `${value.toFixed(1)} CU-h`;
    case 'hours': return `${value.toFixed(1)} h`;
    case 'minutes': return `${value.toFixed(1)} min`;
    case 'count': return String(value);
    default: return String(value);
  }
}
