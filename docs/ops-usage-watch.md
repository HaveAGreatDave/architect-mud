# Free-Tier Usage Watch — Neon + Render

**STATUS: BUILT** — local runner and the GitHub Actions cron both ship. The Actions run
is *partially configured*: it reports Neon and attribution today, and lights up its
Render half when two repo secrets are added (§7).

Daily pull of real consumption from both providers, projected against the billing
cycle, alerting to Discord only when the *pace* is bad.

```bash
npm run ops:usage
```

---

## 1. Why this exists

August 2026 blew the free-plan allowances on both services. The Neon half is on
record with an exact shape:

> egress is `boot payload × world loads per day`. The July work cut the second
> factor; **nothing was watching the first**, and the deploy workflow's header
> still said "~4.7MB" months after it was ~30MB.

So this is not a dashboard. It is the thing that was missing: something that
watches the first factor, and says so before the cap is hit rather than after.

---

## 2. Pace, not total

"You have used 4.1 of 5 GB" arrives too late to act on. Every cycle metric is
therefore projected:

```
elapsed   = (now − period_start) / (period_end − period_start)
projected = used / elapsed
band      = projected / limit
```

| Band | Ratio | Meaning |
|---|---|---|
| 🟢 OK | < 0.80 | On pace. |
| 🟡 WATCH | 0.80–1.00 | Would finish the cycle near the cap. |
| 🟠 ALERT | 1.00–1.30 | Will exceed unless something changes. |
| 🔴 CRITICAL | > 1.30, or already over | Act now. |

**Two guards, because a naive projection is noise.**

- **Warm-up.** An hour into a cycle, 1 GB projects to 700 GB. Days 1–3 are
  suppressed unless absolute usage has already passed a quarter of the
  allowance. The table prints `too early` rather than the absurd number — a
  huge projection beside a green light trains you to distrust the colour.
- **Acceleration.** A flat 0.9 all month is fine; 0.5 → 0.9 over a week is
  August happening again. Both read as "0.9" to a snapshot, so the `7d` column
  compares against the run from a week ago.

**Standing caps** (storage, branch count) are not projected — they are not
consumed over a cycle, so the ratio *is* the answer.

---

## 3. Limits, and why they carry dates

[`scripts/ops/limits.js`](../scripts/ops/limits.js) — every ceiling names the page
it came from and the day it was read, and the report nags when a row passes 90
days. Both providers move their plans (Render restructured on 2026-04-23 and
third-party summaries still disagree about free bandwidth), and a number with no
provenance is a rumour that fails silently: the report keeps printing confident
percentages against a ceiling that moved.

**To re-verify:** open `source`, read the number, update `value` and `checkedOn`
*together*. Bumping the date without opening the page is how this decays back
into folklore.

| Key | Free ceiling | Notes |
|---|---|---|
| `neon.transfer` | 5 GB/cycle | **Account-wide**, pooled across all projects. |
| `neon.compute` | 100 CU-hours/cycle | |
| `neon.storage` | 0.5 GB | Standing cap. |
| `neon.branches` | 10 | Standing cap. Deploy risk, not billing — see §6. |
| `render.bandwidth` | 100 GB/cycle | ⚠ marked `unverified`. |
| `render.instanceHours` | 750/cycle | Not exposed by the API — see §5. |
| `render.buildMinutes` | 500/cycle | **Derived**, not measured — see §5. |

### We grade against FREE even though Neon is on Launch

The Neon project reports `subscription_type: launch_v3` (owner
davidjohnlacey@gmail.com) — a metered pay-as-you-go plan, not Free. Grading
against Launch's much larger allowances would print a comfortable green while
the free-plan budget is being blown, which is exactly the question being asked.
So everything is graded against **free** ceilings, and the live plan is printed
on its own line so the drift stays visible.

---

## 4. Attribution — the half that says what to change

A percentage does not tell you what to do, so the report also measures both
factors of the egress model directly, from **production**:

- **Boot payload** — `sum(pg_column_size(t.*))` over every table declaring
  `readTier: 'boot'` in [`content-registry.js`](../server/models/content-registry.js).
  One `UNION ALL`, not one query per table.
- **World loads/day** — gaps in `player_count_log`. The log samples once a minute
  while the server is up, so a gap is a spin-down or a deploy reboot, and the far
  side of every gap is a cold start that re-read the whole payload.

**The divergence is the point.** If model ≈ API, world boot is the budget and the
payload is the lever. If Neon reports much more, something *else* is leaking and
trimming the payload would be wasted work. Neither number alone tells you that.

⚠ **Attribution owns its own pool, pointed at `PROD_DATABASE_URL`.**
`server/models/db.js` connects to `DATABASE_URL`, which in a dev `.env` is the
*local* database — whose `player_count_log` is empty, so world-loads silently
comes back null and the model evaporates with no error. If `PROD_DATABASE_URL`
is unset the report says so in its notes rather than quietly describing your dev
world.

---

## 5. What the APIs will and won't tell you

**⚠ Neon's `/consumption_history` is a paid endpoint.** The obvious API for this
— the one Neon's own consumption-metrics guide documents — answers 403 on
anything below a Scale plan, with the *same* 403 for every metric name, so it
reads like an auth failure rather than a plan gate. The free-accessible answer is
the **project object**: `GET /projects/{id}` carries the billing-period counters
as plain fields (`data_transfer_bytes`, `compute_time_seconds`,
`synthetic_storage_size`) plus `consumption_period_start`/`_end`. Two cheap
calls, no plan gate, and the cycle boundary is stated rather than guessed.

**⚠ Render's bandwidth series is in megabytes, not bytes.** Each series carries
its own `unit` field (observed: `"mb"`). Summing the raw numbers as bytes
understates usage by 10⁶, which presents as a permanently, reassuringly empty
bandwidth row. `toBytes()` converts through the declared unit and refuses to
guess an unrecognised one.

**⚠ Render reports no instance-count for free services** — `200` with an empty
array. That is a plan limitation, not a zero, so it is left **unreported**;
recording 0 would read as a wide-open budget on the metric a 24/7 free service
is most likely to exhaust (750 h/month is only ~30 h above a full month of
wall-clock — see [`server/keepalive.js`](../server/keepalive.js)). Read it from
the dashboard: **Billing → Usage**.

**Build minutes are derived**, by summing deploy durations, because Render
exposes no build-minutes endpoint. Labelled `derived` everywhere it travels.

---

## 6. Runbook — what to do when a row goes red

| Row | First thing to check |
|---|---|
| **Neon egress** | The attribution block. High payload → trim boot-tier tables (`zones.description` and `power_zones` are the named remaining wins in [neon-egress-cause](../CLAUDE.md)). High loads/day → deploy frequency, or Render cold starts. Model ≪ API → something other than world boot is reading prod. |
| **Neon compute** | A tick pinning a connection stops Neon suspending. See the persistence tiers in [architecture.md](architecture.md) and `hasActivePlayers()` idle-gating. |
| **Neon storage** | `neon_usage_log.top_tables` names the biggest tables; the report prints growth per day. |
| **Neon branches** | Almost always `predeploy-*` snapshots. The prune in `deploy-content.yml` keeps the newest 5 but is `continue-on-error`, so a wedged prune is silent — until the *next* deploy's snapshot fails and aborts the deploy before prod. Delete stale branches in the Neon console. |
| **Render bandwidth** | Client asset payload, then player count. |
| **Render instance hours** | `keepalive.js` idle-gating, and whether the service is spinning down at all. |
| **Render build minutes** | Deploy frequency. `autoDeploy: false`, so this is CI's deploy hook. |

---

## 7. Running it

Keys live in **`.env`** (git-ignored), not `.env.prod` — so a
`--env-file=.env.prod` one-shot never carries them:

```
NEON_API_KEY=…       # console.neon.tech → Settings → API keys
RENDER_API_KEY=…     # dashboard.render.com → Account Settings → API Keys
OPS_WEBHOOK_URL=…    # Discord channel → Integrations → Webhooks
```

| Command | Does |
|---|---|
| `npm run ops:usage` | Verdict table, attribution, alert if warranted. |
| `npm run ops:usage:discover` | Raw API payloads, no verdicts. Use when a shape changes. |
| `npm run ops:smoke` | The pure decision logic. Wired into `pretest:regress`. |

Flags: `--json`, `--no-alert`, `--no-db` (skip attribution), `--fail-on-alert`
(non-zero exit for a CI caller).

**Exit code is 0 even when CRITICAL, by default.** This is a reporter, not a
gate: a monitor that fails a scheduled task because usage is high produces a red
task every day for the rest of the cycle, which is how a monitor gets muted.

### Alerting

Discord/Slack webhook. Posts on a band **change**, then at most once per 20h
while the band stays bad — so an hourly cron and a daily one produce the same
volume. A green run is silent unless it is a *recovery*.

**The alarm never raises the alarm.** Every webhook failure prints and returns
false; the full report is always written to stdout first, so a failed post loses
the notification, never the information. Same doctrine as the `notify` job in
`deploy-content.yml`, which learned it from a GitHub outage painting green
deploys red.

### Scheduling

Phase 1 is a local daily task. Gaps are harmless: **every run re-reads the full
cumulative total from both providers** — nothing here is a delta accumulator, so
the history file is only for the 7-day trend and alert de-duplication.

Windows Task Scheduler, daily at 09:15:

```powershell
schtasks /create /tn "Architect free-tier watch" /tr "cmd /c cd /d C:\Users\johna\Documents\Github\architect-mud && npm run ops:usage" /sc daily /st 09:15
```

**Phase 2 — [`.github/workflows/usage-watch.yml`](../.github/workflows/usage-watch.yml)**,
daily on `schedule: '17 8 * * *'`. Off-the-hour, per the cron-delay lesson
`deploy-content.yml` records at `:37` (29–106 min dispatch delays measured on
this repo at `:00`).

**Three keys are in three different places, and only one of them is the repo.**
`.env` on the developer's machine is git-ignored, so it is not in the checkout,
so an Actions runner never sees it — the same values must exist independently as
**repo secrets**. `.env.prod` is a third store and is deliberately not involved:
keeping ops keys out of it means a `--env-file=.env.prod` one-shot never carries
an API key into an unrelated script.

| Secret | Present | Used for |
|---|---|---|
| `NEON_API_KEY` | yes | the Neon half |
| `PROD_DATABASE_URL` | yes | attribution (boot payload, world loads/day) |
| `RENDER_API_KEY` | **no** | the Render half |
| `OPS_WEBHOOK_URL` | **no** | Discord alerting |

**Missing secrets degrade, they do not break.** The two that exist already carry
the Neon report and the whole attribution model, so the workflow is useful the
day it lands; the report exits 0 on every collection failure and records the
reason as a note, and a step raises a workflow *annotation* naming what is
absent. Adding the secrets later needs no change to the file. This is deliberate:
a job that went red every morning until somebody acted would train the team to
ignore it, which is the failure this whole system exists to avoid.

Adding them needs repo **admin**, which johna does not have
(`admin: false` on `HaveAGreatDave/architect-mud`) — so it is an owner ask.

⚠ **The commit-back's `[skip ci]` marker is load-bearing.** `sync-commits.yml`
triggers on *every* push to main with no path filter and writes to the prod
database. Without the marker, a bookkeeping commit whose only purpose is to
record a number would kick off a prod DB write every morning. (`data/ops/**` is
already outside `deploy-content.yml`'s push filter, so a content deploy was
never at risk.)

---

## 8. History

`data/ops/usage-history.json`, one row per run. **Not a DB table**: the thing
being measured is DB egress, and a monitor that writes to prod every run spends
from the budget it reports on. A flat file costs nothing and makes the trend
readable with `git log -p`. `data/**` is outside `deploy-content.yml`'s push path
filter, so committing it cannot trigger a production deploy.
