// verify-deploy: wait for the Render deploy the deploy hook just started, and say how it ended.
//
//   node scripts/ops/verify-deploy.mjs --since <ISO time> [--sha <commit>] [--timeout-min 20]
//
// Exit 0: the newest deploy created after --since is live.
// Exit 1: it failed or was cancelled. Prod is still on the previous build.
// Exit 2: Render couldn't be asked (no RENDER_API_KEY, API down) or it timed out.
//
// Why it exists. The hook returns as soon as Render queues a build, and the workflow used
// to record the deployment right after, so a build or boot that failed was still stamped
// as deployed and every later window skipped with "HEAD already deployed". With --sha it
// also warns when Render built a different commit from the one that passed regress.
import { api, pickService } from './render-usage.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const since = Date.parse(opt('--since', ''));
const sha = opt('--sha', '');
const timeoutMs = Number(opt('--timeout-min', '20')) * 60_000;
const key = process.env.RENDER_API_KEY;

const LIVE = new Set(['live']);
const FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled']);
const unwrap = (body, k) => (Array.isArray(body) ? body.map((r) => r?.[k] ?? r).filter(Boolean) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!Number.isFinite(since)) { console.error('verify-deploy: --since <ISO time> is required'); process.exit(2); }
if (!key) { console.log('::warning::RENDER_API_KEY is not set, so the deploy cannot be verified.'); process.exit(2); }

let serviceId;
try {
  const { service } = pickService(unwrap(await api('/services?limit=100', key), 'service'));
  if (!service) throw new Error('no production service found');
  serviceId = service.id;
} catch (err) {
  console.log(`::warning::Could not find the Render service: ${err.message}`);
  process.exit(2);
}

const deadline = Date.now() + timeoutMs;
let last = '';
while (Date.now() < deadline) {
  let deploys = [];
  try {
    deploys = unwrap(await api(`/services/${serviceId}/deploys?limit=10`, key), 'deploy');
  } catch (err) {
    console.log(`Render API: ${err.message}; retrying`);
  }
  // A minute of slack for clock skew between the runner and Render.
  const ours = deploys
    .filter((d) => Date.parse(d.createdAt) >= since - 60_000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (ours) {
    const commit = ours.commit?.id || '';
    const line = `deploy ${ours.id}: ${ours.status}${commit ? ` (commit ${commit.slice(0, 9)})` : ''}`;
    if (line !== last) { console.log(line); last = line; }
    if (LIVE.has(ours.status)) {
      if (sha && commit && commit !== sha) {
        console.log(`::warning::Render built ${commit.slice(0, 9)}, not ${sha.slice(0, 9)}, the commit that passed regress. Code that wasn't gated may be live.`);
      }
      process.exit(0);
    }
    if (FAILED.has(ours.status)) {
      console.log(`::error::The Render deploy ended "${ours.status}". Content is in Neon, but prod is still on the previous build.`);
      process.exit(1);
    }
  } else if (!last) {
    console.log('waiting for Render to register the deploy…');
    last = 'waiting';
  }
  await sleep(20_000);
}
console.log(`::warning::Gave up after ${timeoutMs / 60_000} minutes waiting for the deploy to go live.`);
process.exit(2);
