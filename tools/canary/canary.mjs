// Deploy canary — connects to a running server as a real player over the
// actual WebSocket protocol and walks the login → look → ping path.
// Proves the whole stack (HTTP upgrade, auth, DB, world, dispatch) is alive.
//
//   node tools/canary/canary.mjs --url ws://localhost:3000
//   CANARY_URL=wss://<prod-host> node tools/canary/canary.mjs
//
// Credentials come from CANARY_USER / CANARY_PASS (a dedicated canary account).
// Exit code 0 = all steps passed; 1 = a step failed or timed out.
// No server code is touched — this is a pure client. Safe to wire into CI
// as a post-deploy step.
import WebSocket from 'ws';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const URL_ = arg('--url') || process.env.CANARY_URL || 'ws://localhost:3000';
const USER = process.env.CANARY_USER;
const PASS = process.env.CANARY_PASS;
const STEP_TIMEOUT_MS = 10000;

if (!USER || !PASS) {
  console.error('canary: set CANARY_USER and CANARY_PASS (a dedicated player account)');
  process.exit(1);
}

const ws = new WebSocket(URL_);
const inbox = [];
const waiters = [];
ws.on('message', data => {
  let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
  const w = waiters.findIndex(w => w.match(msg));
  if (w >= 0) waiters.splice(w, 1)[0].resolve(msg);
  else inbox.push(msg);
});
ws.on('error', err => { console.error(`canary: socket error — ${err.message}`); process.exit(1); });

const waitFor = (desc, match) => new Promise((resolve, reject) => {
  const hit = inbox.findIndex(match);
  if (hit >= 0) return resolve(inbox.splice(hit, 1)[0]);
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${desc}`)), STEP_TIMEOUT_MS);
  waiters.push({ match, resolve: m => { clearTimeout(t); resolve(m); } });
});
const send = obj => ws.send(JSON.stringify(obj));

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, err: e.message }); console.error(`  ✗ ${name}: ${e.message}`); throw e; }
};

console.log(`canary → ${URL_} as ${USER}`);
try {
  await step('connect', () => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('connection timed out')), STEP_TIMEOUT_MS);
    ws.once('open', () => { clearTimeout(t); res(); });
  }));

  await step('server greeting', () => waitFor('connected', m => m.type === 'connected'));

  await step('login', async () => {
    send({ type: 'auth', username: USER, password: PASS });
    const m = await waitFor('auth result', m => m.type === 'auth_success' || m.type === 'auth_fail');
    if (m.type === 'auth_fail') throw new Error(`auth_fail: ${m.message}`);
    if (!m.player?.id) throw new Error('auth_success without player payload');
  });

  await step('room renders', async () => {
    // login pushes an initial look; ask for one explicitly so we test dispatch too
    send({ type: 'command', command: 'look' });
    const m = await waitFor('look response', m => m.type === 'look');
    if (!m.zone) throw new Error('look response has no zone');
    if (!m.message || m.message.length < 10) throw new Error('look response body suspiciously empty');
  });

  await step('app ping', async () => {
    send({ type: 'ping' });
    await waitFor('pong', m => m.type === 'pong');
  });

  await step('disconnect', () => new Promise(res => { ws.once('close', res); ws.close(); }));

  console.log(`canary PASS — ${results.length} steps, ${results.reduce((a, r) => a + r.ms, 0)}ms total`);
  process.exit(0);
} catch {
  try { ws.terminate(); } catch { /* already dead */ }
  console.error('canary FAIL');
  process.exit(1);
}
