// Neon consumption collector.
//
// ⚠ DO NOT REACH FOR /consumption_history — IT IS A PAID ENDPOINT.
// The obvious API for this, and the one Neon's own "consumption metrics" guide
// documents, answers 403 on anything below a Scale plan:
//
//     "This endpoint is not available. It is included with Scale plans and above"
//
// Every metric name returns that same 403, so it reads like an auth problem
// rather than a plan gate. The free-accessible answer is the PROJECT OBJECT:
// GET /projects/{id} carries the same billing-period counters as plain fields
// (`data_transfer_bytes`, `compute_time_seconds`, `synthetic_storage_size`)
// plus `consumption_period_start`/`_end`. Two cheap calls, no plan gate, and the
// cycle boundary is stated rather than guessed.
//
// WE MEASURE AGAINST THE *FREE* CEILINGS EVEN THOUGH THIS PROJECT IS ON LAUNCH.
// The stated goal is to live within the free plan; grading against Launch's much
// larger allowances would report a comfortable green while the free-plan budget
// is being blown, which is precisely the question being asked. The live plan is
// reported separately so the drift is visible — see `planNote` below.
//
// Auth: NEON_API_KEY. Ids come from the committed `.neon` file, never hardcoded
// — memory holds two stale project ids from earlier migrations, and the deploy
// workflow reads them the same way.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://console.neon.tech/api/v2';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Neon's own plan slugs, as they appear in project.owner.subscription_type. */
export const FREE_PLAN_SLUGS = new Set(['free_v2', 'free_v3', 'free']);

export function neonIds() {
  const raw = readFileSync(join(REPO_ROOT, '.neon'), 'utf8');
  const { orgId, projectId } = JSON.parse(raw);
  if (!orgId || !projectId) throw new Error('.neon is missing orgId or projectId');
  return { orgId, projectId };
}

async function api(path, key) {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Neon ${path.split('?')[0]} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

export async function collectNeon({ apiKey, now = new Date() } = {}) {
  const key = apiKey ?? process.env.NEON_API_KEY;
  if (!key) throw new Error('NEON_API_KEY is not set (put it in .env)');
  const { projectId } = neonIds();

  const notes = [];
  const raw = {};
  const metrics = {};

  const body = await api(`/projects/${projectId}`, key);
  const p = body.project ?? {};
  raw.project = p;

  // --- cycle boundary, as stated by Neon ------------------------------------
  const cycleStart = p.consumption_period_start ? new Date(p.consumption_period_start) : null;
  const cycleEnd = p.consumption_period_end ? new Date(p.consumption_period_end) : null;
  if (!cycleStart) notes.push('project carried no consumption_period_start — cycle boundary unknown, projections suppressed');

  // --- the counters ---------------------------------------------------------
  // All three are cumulative for the CURRENT billing period and reset with it.
  if (typeof p.data_transfer_bytes === 'number') metrics['neon.transfer'] = p.data_transfer_bytes;
  // compute_time_seconds is CU-seconds (it tracks cpu_used_sec), so CU-hours is
  // a plain /3600. active_time_seconds is WALL-CLOCK time the compute was awake
  // and is a different, larger number — using it here would overstate compute by
  // whatever factor the autoscaler was below its ceiling.
  if (typeof p.compute_time_seconds === 'number') metrics['neon.compute'] = p.compute_time_seconds / 3600;
  // synthetic_storage_size is Neon's billing figure, and what the plan page's
  // 0.5 GB refers to. pg_database_size (what server/usage-log.js records) is a
  // different, smaller number — do not conflate them.
  if (typeof p.synthetic_storage_size === 'number') metrics['neon.storage'] = p.synthetic_storage_size;

  // --- plan drift -----------------------------------------------------------
  const plan = p.owner?.subscription_type ?? null;
  raw.plan = plan;
  raw.ownerEmail = p.owner?.email ?? null;
  const onFree = plan ? FREE_PLAN_SLUGS.has(plan) : null;
  if (onFree === false) {
    notes.push(`project is on plan "${plan}" (owner ${p.owner?.email ?? 'unknown'}), NOT the free plan — figures below are still graded against FREE ceilings, because that is the stated goal`);
  }

  // A cycle that rolled over in the last couple of hours can report the previous
  // period's tail before the counters settle. Say so, rather than letting a
  // reader panic at "1 GB in 40 minutes".
  if (cycleStart) {
    const minsIn = (now - cycleStart) / 60_000;
    if (minsIn >= 0 && minsIn < 180) {
      notes.push(`billing cycle rolled over ${Math.round(minsIn)} min ago — counters may still be settling; tomorrow's run is the first trustworthy one`);
    }
  }

  // --- branches -------------------------------------------------------------
  try {
    const br = await api(`/projects/${projectId}/branches`, key);
    const branches = br.branches ?? [];
    raw.branchCount = branches.length;
    metrics['neon.branches'] = branches.length;
    const snaps = branches.filter((b) => b.name?.startsWith('predeploy-'));
    if (snaps.length > 5) {
      // deploy-content.yml prunes predeploy-* to the newest 5, but that step is
      // continue-on-error. More than 5 means the prune is silently failing, and
      // the failure surfaces later as an aborted deploy, not as a prune error.
      notes.push(`${snaps.length} predeploy-* snapshot branches (the prune keeps 5) — the prune step in deploy-content.yml may be failing`);
    }
  } catch (e) {
    notes.push(`branches unavailable (${e.message.split('\n')[0]})`);
  }

  return { metrics, cycleStart, cycleEnd, plan, onFree, raw, notes };
}
