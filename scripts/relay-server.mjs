// The Relay — a local-only web console for shipping work between architects.
// Two lanes:
//   • World  — publish / sync the shared DB seed (wraps content:publish / content:sync)
//   • Code   — a regress-gated push (runs `npm run test:regress`, and only pushes if it's green)
// Plus a pre-flight panel that flags "this will be a problem" BEFORE you push.
//
//   npm run relay
//
// It shells out to the same scripts/git the CLI uses — nothing new touches the DB
// or git. Dev-only; never wired into the game server or production boot.
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4599;
const GAME_PORT = 3000; // Architect game server (server/index.js)
const NODE = process.execPath;

// Is something listening on a local port? Used to tell whether the game server
// is already up (started here or in a terminal) before offering to launch it.
const portOpen = (port) =>
  new Promise((res) => {
    const sock = connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); res(v); };
    sock.setTimeout(500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });

// The regress gate, spawned as real `node` processes (not `npm run`, which on
// Windows means npm.cmd — Node refuses to spawn .cmd without a shell). This
// mirrors the `pretest:regress` hook: sweep orphaned pool connections first,
// then run the suite.
const REGRESS_STEPS = [
  ['Sweep orphans', NODE, ['scripts/kill-orphans.js']],
  ['Regression gate', NODE, ['tests/regress.js']],
];

// --- shell helpers ----------------------------------------------------------
const git = (args, raw = false) =>
  new Promise((res) => {
    execFile('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, out, se) =>
      // `raw` preserves the leading status column (porcelain lines start with a
      // space) — trimming would drop the first line's " " and shift the offset.
      res({ ok: !err, out: raw ? (out || '') : (out || '').trim(), err: (se || '').trim() }),
    );
  });

// Run a sequence of commands, streaming combined output to the response. Stops
// at the first non-zero exit (this is what makes the regress gate a real gate).
const streamSeq = async (steps, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  for (const [label, cmd, args] of steps) {
    res.write(`\n── ${label} ──\n`);
    const code = await new Promise((done) => {
      let child;
      try {
        // spawn can throw synchronously (e.g. EINVAL on Windows) — don't let
        // that escape the promise executor and crash the whole server.
        child = spawn(cmd, args, { cwd: ROOT });
      } catch (e) {
        res.write(`\n[failed to launch: ${e.message}]`);
        return done(1);
      }
      child.stdout.on('data', (d) => res.write(d));
      child.stderr.on('data', (d) => res.write(d));
      child.on('close', done);
      child.on('error', (e) => {
        res.write(`\n[failed to launch: ${e.message}]`);
        done(1);
      });
    });
    if (code !== 0) {
      res.write(`\n✗ ${label} failed (exit ${code}) — aborting, nothing pushed.`);
      return res.end();
    }
  }
  res.write('\n✓ done');
  res.end();
};

// --- pre-flight checks ------------------------------------------------------
// Read an env var straight from .env (uncommented lines only), so the pre-flight
// reflects the file the scripts will actually load, not this process's own env.
const readEnvUrl = (name) => {
  try {
    const env = readFileSync(resolve(ROOT, '.env'), 'utf8');
    const re = new RegExp(`^\\s*${name}\\s*=`);
    const line = env.split(/\r?\n/).find((l) => re.test(l));
    if (!line) return '';
    return line.replace(re, '').trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
};
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const isLocalHost = (h) => /^(localhost|127\.0\.0\.1|::1)$/.test(h);

const status = async () => {
  const dbUrl = readEnvUrl('DATABASE_URL');
  const host = hostOf(dbUrl);
  const isLocal = isLocalHost(host);

  const prodUrl = readEnvUrl('PROD_DATABASE_URL');
  const prodHost = hostOf(prodUrl);
  const prodReady = !!prodUrl && !isLocalHost(prodHost);

  const branchR = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchR.ok ? branchR.out : '?';
  const hasUpstream = (await git(['rev-parse', '--abbrev-ref', '@{u}'])).ok;

  // Best-effort fetch so ahead/behind reflect the remote (catches "push rejected").
  const fetchR = await git(['fetch', '--quiet']);

  let ahead = 0;
  let behind = 0;
  if (hasUpstream) {
    const a = await git(['rev-list', '--count', '@{u}..HEAD']);
    const b = await git(['rev-list', '--count', 'HEAD..@{u}']);
    ahead = a.ok ? parseInt(a.out, 10) || 0 : 0;
    behind = b.ok ? parseInt(b.out, 10) || 0 : 0;
  }

  const porcelain = await git(['status', '--porcelain'], true);
  const lines = porcelain.ok ? porcelain.out.split('\n').filter(Boolean) : [];
  const seedDirty = lines.some((l) => l.slice(3) === 'db/seed.sql');
  const otherDirty = lines.filter((l) => l.slice(3) !== 'db/seed.sql').map((l) => l.slice(3));

  const serverUp = await portOpen(GAME_PORT);

  return {
    server: { running: serverUp, port: GAME_PORT },
    db: { host, isLocal, present: !!dbUrl },
    prod: { host: prodHost, ready: prodReady, present: !!prodUrl },
    git: {
      branch,
      hasUpstream,
      ahead,
      behind,
      diverged: ahead > 0 && behind > 0,
      seedDirty,
      otherDirty,
      offline: !fetchR.ok,
    },
  };
};

// Recent commit activity, pulled LIVE from git (the devpanel reads a synced DB
// table; here we just run git log, so it's always current). 14-day feed + a
// per-author summary, with unpushed commits (ahead of the remote) flagged.
const activity = async () => {
  const SEP = '\x1e', FS = '\x1f';
  const r = await git(
    ['log', '--since=14 days ago', '--date=short', '--numstat', `--pretty=format:${SEP}%H${FS}%an${FS}%ad${FS}%s`],
    true,
  );
  if (!r.ok) return { ok: false, commits: [], authors: [] };

  let unpushed = new Set();
  if ((await git(['rev-parse', '--abbrev-ref', '@{u}'])).ok) {
    const rl = await git(['rev-list', '@{u}..HEAD']);
    if (rl.ok && rl.out) unpushed = new Set(rl.out.split('\n'));
  }

  const commits = [];
  for (const rec of r.out.split(SEP)) {
    if (!rec.trim()) continue;
    const lines = rec.split('\n');
    const [hash, author, date, subject] = lines[0].split(FS);
    let files = 0, add = 0, del = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length < 3 || !parts[2]) continue;
      files++;
      const a = parseInt(parts[0], 10), d = parseInt(parts[1], 10); // "-" for binary → NaN
      if (!isNaN(a)) add += a;
      if (!isNaN(d)) del += d;
    }
    commits.push({ hash, author, date, subject, files, add, del, unpushed: unpushed.has(hash) });
  }

  const byAuthor = {};
  for (const c of commits) {
    const a = (byAuthor[c.author] ||= { author: c.author, commits: 0, files: 0, add: 0, del: 0 });
    a.commits++; a.files += c.files; a.add += c.add; a.del += c.del;
  }
  const authors = Object.values(byAuthor).sort((x, y) => y.commits - x.commits);
  // Author summary covers the whole window; the feed is capped (we only render
  // the most recent handful) to keep the payload small.
  return { ok: true, commits: commits.slice(0, 50), total: commits.length, authors };
};

// --- HTTP -------------------------------------------------------------------
const readBody = (req) =>
  new Promise((res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => res(b));
  });

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (req.url === '/favicon.ico') {
      try {
        const buf = readFileSync(resolve(ROOT, 'client/game/favicon.ico'));
        res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'max-age=3600' });
        return res.end(buf);
      } catch {
        res.writeHead(404);
        return res.end();
      }
    }
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(await status()));
    }
    if (req.url === '/api/activity') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(await activity()));
    }

    // Launch the game server (detached, mirrors `npm run dev`). It's long-running,
    // so we don't stream it — but we DO watch stdout/stderr for a few seconds so an
    // early boot crash (bad DB, missing schema) surfaces here instead of vanishing
    // into a detached process. If it's still alive after the grace window, we detach
    // and let the port check confirm it's up.
    if (req.url === '/api/launch' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      if (await portOpen(GAME_PORT)) {
        return res.end(`✓ Architect is already running on http://localhost:${GAME_PORT}`);
      }
      let child;
      try {
        child = spawn(NODE, ['--watch', 'server/index.js'], { cwd: ROOT, detached: true });
      } catch (e) {
        return res.end('✗ Failed to launch: ' + e.message);
      }
      // Watch the boot for up to 4s: if the process exits (crash) in that window,
      // report its captured output; otherwise assume it booted and detach.
      const BOOT_GRACE_MS = 4000;
      let output = '';
      let booting = true; // stop accumulating once detached, but keep draining the
                          // pipes so a filled OS buffer never blocks the child.
      child.stdout.on('data', (d) => { if (booting) output += d; });
      child.stderr.on('data', (d) => { if (booting) output += d; });
      const outcome = await new Promise((done) => {
        const timer = setTimeout(() => done({ crashed: false }), BOOT_GRACE_MS);
        child.once('exit', (code) => { clearTimeout(timer); done({ crashed: true, code }); });
        child.once('error', (e) => { clearTimeout(timer); done({ crashed: true, error: e.message }); });
      });
      if (outcome.crashed) {
        const why = outcome.error ? outcome.error : `exit code ${outcome.code}`;
        const tail = output.trim().split('\n').slice(-20).join('\n');
        return res.end(`✗ Architect crashed on boot (${why}).\n\n${tail || '(no output captured)'}`);
      }
      booting = false; // detach: keep listeners (draining) but drop the buffer
      child.unref();
      return res.end(`🏚  Architect launching on http://localhost:${GAME_PORT} …\nGive it a second to boot, then use the ▶ Architect link. Stop it with:  npm run kill:orphans`);
    }

    // World lane — publish seed (guarded to localhost).
    if (req.url === '/api/publish' && req.method === 'POST') {
      const body = await readBody(req);
      const s = await status();
      if (!s.db.isLocal) {
        res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`✗ Refusing to publish: DATABASE_URL host is "${s.db.host}", not localhost.\nPoint .env back at your local DB first.`);
      }
      let msg = '';
      try { msg = (JSON.parse(body || '{}').message || '').trim(); } catch {}
      const args = ['scripts/content-publish.mjs', ...(msg ? ['--', msg] : [])];
      return streamSeq([['Publish world seed', process.execPath, args]], res);
    }

    // World lane — sync (pull + conditional DB rebuild).
    if (req.url === '/api/sync' && req.method === 'POST') {
      return streamSeq([['Sync world', process.execPath, ['scripts/content-sync.mjs']]], res);
    }

    // Code lane — regress only (no push), for a quick pre-check.
    if (req.url === '/api/regress' && req.method === 'POST') {
      return streamSeq(REGRESS_STEPS, res);
    }

    // Code lane — the regress-gated push. Server enforces the gate + fast-forward.
    if (req.url === '/api/ship' && req.method === 'POST') {
      const s = await status();
      const g = s.git;
      const blocker =
        !g.hasUpstream ? 'no upstream tracking branch to push to.'
        : g.diverged ? 'branch has diverged — Sync and resolve first.'
        : g.behind > 0 ? `${g.behind} commit(s) behind — Sync first so the push fast-forwards.`
        : g.ahead === 0 ? 'nothing to push — no local commits ahead of the remote.'
        : '';
      if (blocker) {
        res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`✗ Can't ship: ${blocker}`);
      }
      return streamSeq([...REGRESS_STEPS, ['Push', 'git', ['push']]], res);
    }

    // Production lane — additive content deploy. Gated by: typed confirmation,
    // local-read + remote-write checks, regress must pass, and a prod backup runs
    // first. Sequence aborts on any failure (streamSeq stops at first non-zero).
    if (req.url === '/api/deploy-prod' && req.method === 'POST') {
      const body = await readBody(req);
      let confirm = '';
      try { confirm = (JSON.parse(body || '{}').confirm || '').trim(); } catch {}
      const s = await status();
      const blocker =
        confirm !== 'DEPLOY' ? 'confirmation text did not match.'
        : !s.db.isLocal ? `DATABASE_URL host is "${s.db.host}", not local — we push LOCAL content.`
        : !s.prod.ready ? 'PROD_DATABASE_URL is missing or not a remote host.'
        : '';
      if (blocker) {
        res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`✗ Deploy blocked: ${blocker}`);
      }
      return streamSeq(
        [
          ...REGRESS_STEPS,
          ['Back up production first', NODE, ['scripts/backup-prod.mjs']],
          ['Deploy content (additive)', NODE, ['scripts/deploy-content-to-prod.mjs', '--yes']],
        ],
        res,
      );
    }

    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('error: ' + e.message);
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  The Relay → ${url}\n  (Ctrl-C to stop)\n`);
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
  else if (process.platform === 'darwin') execFile('open', [url]);
});

// --- the page (inline, no build, no external requests) ----------------------
const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>The Relay</title>
<link rel="icon" href="/favicon.ico">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace;
         background: #0b0e13; color: #cdd6e4; padding: 24px; max-width: 1180px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .col { min-width: 0; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
  h1 { font-size: 18px; margin: 0 0 4px; color: #7fd1ff; letter-spacing: 1px; }
  .sub { color: #61708a; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .logo { width: 64px; height: 64px; image-rendering: pixelated; border-radius: 10px;
          border: 1px solid #212a38; background: #06080c; flex: none; }
  .links { display: flex; gap: 8px; }
  .linkbtn { text-decoration: none; font-size: 13px; background: #212a38; color: #cdd6e4;
             border: 1px solid #2a3547; border-radius: 6px; padding: 8px 12px; white-space: nowrap; }
  .linkbtn:hover { border-color: #7fd1ff; color: #7fd1ff; }
  .card { background: #131923; border: 1px solid #212a38; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .lane-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #7fd1ff; margin: 0 0 10px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .ok { background: #37d67a; } .warn { background: #f5b544; } .bad { background: #ff5b5b; } .mute { background: #3a4557; }
  .checks .row span.msg { color: #9fb0c8; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  button { font: inherit; background: #1c66d6; color: #fff; border: 0; border-radius: 6px;
           padding: 9px 16px; cursor: pointer; }
  button.ghost { background: #212a38; color: #cdd6e4; }
  button:disabled { opacity: .4; cursor: not-allowed; }
  input { font: inherit; background: #0b0e13; border: 1px solid #2a3547; color: #cdd6e4;
          border-radius: 6px; padding: 8px 10px; min-width: 240px; }
  pre { background: #06080c; border: 1px solid #1a2230; border-radius: 8px; padding: 14px;
        white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; margin: 0; color: #b7c4d8; }
  .hint { color: #61708a; font-size: 12px; margin-top: 8px; min-height: 16px; }
  .badge { font-size: 12px; color: #61708a; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .chip { background: #0b0e13; border: 1px solid #212a38; border-radius: 3px; padding: 3px 9px; font-size: 11px; color: #9fb0c8; }
  .chip b { color: #e6edf6; }
  .add { color: #37d67a; } .del { color: #ff5b5b; }
  .rows { background: #06080c; border: 1px solid #1a2230; border-radius: 8px; padding: 4px 12px; max-height: 62vh; overflow: auto; }
  .crow { display: flex; gap: 10px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid #161d29; font-size: 12px; }
  .crow:last-child { border-bottom: 0; }
  .crow.unpushed { border-left: 2px solid #7fd1ff; margin-left: -12px; padding-left: 10px; }
  .cdate { flex: 0 0 50px; color: #61708a; font-size: 10px; font-variant-numeric: tabular-nums; }
  .cauth { flex: 0 0 104px; color: #7fd1ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .csub { flex: 1; color: #cdd6e4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .upush { flex: 0 0 auto; color: #7fd1ff; font-size: 9px; border: 1px solid #2a4a63; border-radius: 3px; padding: 0 5px; }
  .cfiles { flex: 0 0 auto; color: #61708a; font-size: 10px; }
</style></head>
<body>
  <div class="head">
    <div class="brand">
      <img class="logo" src="/favicon.ico" alt="Architect">
      <div>
        <h1>◆ THE RELAY</h1>
        <div class="sub">Ship world + code between architects — with a pre-flight check.</div>
      </div>
    </div>
    <div class="links">
      <button id="launch">🏚 Launch server</button>
      <a class="linkbtn" href="http://localhost:3000" target="_blank" rel="noopener">▶ Architect</a>
      <a class="linkbtn" href="http://localhost:3000/dev" target="_blank" rel="noopener">⚙ Devpanel</a>
    </div>
  </div>

  <div class="layout">
  <div class="col">

  <div class="card">
    <div class="row" style="justify-content:space-between">
      <strong>Pre-flight</strong>
      <button class="ghost" id="refresh">↻ Recheck</button>
    </div>
    <div class="checks" id="checks"><div class="row"><span class="dot mute"></span>Checking…</div></div>
  </div>

  <div class="card">
    <div class="lane-title">World — shared DB seed</div>
    <div style="margin-bottom:12px"><input id="msg" placeholder="commit message (optional)" style="width:100%" /></div>
    <div class="actions">
      <button id="publish">⇧ Publish content</button>
      <button class="ghost" id="sync">⇩ Sync content</button>
    </div>
    <div class="hint" id="worldHint"></div>
  </div>

  <div class="card">
    <div class="lane-title">Code — regress-gated push</div>
    <div class="actions">
      <button class="ghost" id="regress">▶ Run regress</button>
      <button id="ship">⇧ Ship code</button>
    </div>
    <div class="hint" id="codeHint"></div>
  </div>

  <div class="card">
    <div class="lane-title" style="color:#f5b544">Production — push content live (additive)</div>
    <div class="actions">
      <button id="deploy" style="background:#8a2f2f">⇧ Deploy content → Production</button>
    </div>
    <div class="hint" id="prodHint"></div>
  </div>

  <div class="card">
    <div class="row"><strong>Output</strong> <span class="badge" id="running"></span></div>
    <pre id="out">—</pre>
  </div>

  </div><!-- /col left -->

  <div class="col">
  <div class="card">
    <div class="lane-title">Recent activity — last 14 days (live from git)</div>
    <div id="activity"><div class="hint">Loading…</div></div>
  </div>
  </div><!-- /col right -->

  </div><!-- /layout -->

<script>
const $ = (id) => document.getElementById(id);
let st = null;
let streaming = false;  // an action (publish/sync/ship/deploy/launch) is running
let refreshing = false; // a status refresh is in flight — avoid overlapping polls

function line(cls, label, msg) {
  return '<div class="row"><span class="dot ' + cls + '"></span><span>' + label +
    '</span>' + (msg ? ' <span class="msg">— ' + msg + '</span>' : '') + '</div>';
}

async function refresh(showSpinner = true) {
  if (refreshing) return; // don't stack polls on top of each other
  refreshing = true;
  if (showSpinner) $('checks').innerHTML = line('mute', 'Checking…', '');
  try {
    await refreshInner();
  } finally {
    refreshing = false;
  }
}

async function refreshInner() {
  try {
    st = await (await fetch('/api/status')).json();
  } catch (e) {
    // Server down/restarted — say so instead of freezing on "Checking…".
    $('checks').innerHTML = line('bad', 'Relay server not responding', 'restart it in your terminal:  npm run relay');
    document.querySelectorAll('.actions button, .links button').forEach((b) => (b.disabled = true));
    return;
  }
  const g = st.git, d = st.db, sv = st.server, p = st.prod;
  let html = '';

  if (sv.running) html += line('ok', 'Architect server running', 'localhost:' + sv.port);
  else html += line('mute', 'Architect server not running', 'use Launch server');

  if (!d.present) html += line('bad', 'DATABASE_URL missing from .env', '');
  else if (d.isLocal) html += line('ok', 'DB is local', d.host);
  else html += line('bad', 'DB is NOT local', d.host + ' — publishing is blocked');

  if (!g.hasUpstream) html += line('warn', 'No upstream tracking branch', g.branch);
  else if (g.offline) html += line('warn', 'Could not reach remote', 'ahead/behind may be stale');
  else html += line('ok', 'Tracking ' + g.branch, '');

  if (g.diverged) html += line('bad', 'Branch diverged', g.ahead + ' ahead / ' + g.behind + ' behind — sync & resolve');
  else if (g.behind > 0) html += line('warn', g.behind + ' commit(s) behind', 'Sync before pushing');
  else if (g.ahead > 0) html += line('ok', g.ahead + ' commit(s) to push', '');
  else html += line('ok', 'Up to date with remote', '');

  if (p.ready) html += line('ok', 'Production target set', p.host);
  else if (p.present) html += line('bad', 'PROD_DATABASE_URL is local', 'must point at Supabase');
  else html += line('mute', 'No PROD_DATABASE_URL', 'prod deploy disabled');

  if (g.seedDirty) html += line('warn', 'db/seed.sql has uncommitted edits', 'publish will commit it');
  if (g.otherDirty.length) html += line('warn', g.otherDirty.length + ' uncommitted code file(s)', 'commit in git before Ship — Relay pushes commits, not working changes');
  if (!g.seedDirty && !g.otherDirty.length) html += line('ok', 'Working tree clean', '');

  $('checks').innerHTML = html;

  const canPublish = d.isLocal && !g.diverged;
  const canShip = g.hasUpstream && !g.diverged && g.behind === 0 && g.ahead > 0;
  $('publish').disabled = !canPublish;
  $('sync').disabled = false;
  $('regress').disabled = false;
  $('ship').disabled = !canShip;
  $('launch').disabled = sv.running;
  $('launch').textContent = sv.running ? '🏚 Server up' : '🏚 Launch server';
  const canDeploy = d.isLocal && p.ready && !g.diverged;
  $('deploy').disabled = !canDeploy;
  $('prodHint').textContent = !p.ready
    ? 'Set PROD_DATABASE_URL (Supabase session pooler) in .env to enable prod deploys.'
    : !d.isLocal ? 'Deploy disabled: DATABASE_URL must be local (we push your LOCAL content).'
    : 'Runs regress → backs up production → applies your local content additively (never overwrites/deletes live rows). Asks you to type DEPLOY.';

  $('worldHint').textContent = !d.isLocal
    ? 'Publish disabled: point .env DATABASE_URL back at localhost.'
    : g.behind > 0 ? 'Tip: Sync before publishing so your push fast-forwards.' : '';
  $('codeHint').textContent = !g.hasUpstream ? 'No upstream branch set.'
    : g.diverged ? 'Ship disabled: resolve the diverged branch first.'
    : g.behind > 0 ? 'Ship disabled: Sync first (' + g.behind + ' behind).'
    : g.ahead === 0 ? 'Nothing to ship — commit code first, then Ship runs regress and pushes.'
    : 'Ship runs the full regress suite; it only pushes if regress is green.';

  loadActivity(); // fire-and-forget; refreshes the feed on every recheck
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function loadActivity() {
  const el = $('activity');
  let a;
  try {
    a = await (await fetch('/api/activity')).json();
  } catch (e) {
    el.innerHTML = '<div class="hint">Relay server not responding — restart: npm run relay</div>';
    return;
  }
  if (!a.ok) { el.innerHTML = '<div class="hint">git log unavailable.</div>'; return; }
  if (!a.commits.length) { el.innerHTML = '<div class="hint">No commits in the last 14 days.</div>'; return; }
  const chips = a.authors.map((au) =>
    '<span class="chip"><b>' + esc(au.author) + '</b> ' + au.commits + ' commit' + (au.commits === 1 ? '' : 's') +
    ' · ' + au.files + 'f <span class="add">+' + au.add.toLocaleString() + '</span> <span class="del">−' + au.del.toLocaleString() + '</span></span>',
  ).join('');
  const rows = a.commits.map((c) =>
    '<div class="crow' + (c.unpushed ? ' unpushed' : '') + '">' +
    '<span class="cdate">' + esc(c.date) + '</span>' +
    '<span class="cauth" title="' + esc(c.author) + '">' + esc(c.author) + '</span>' +
    '<span class="csub" title="' + esc(c.subject) + '">' + esc(c.subject) + '</span>' +
    (c.unpushed ? '<span class="upush">▲ unpushed</span>' : '') +
    '<span class="cfiles">' + c.files + 'f</span></div>',
  ).join('');
  const more = a.total > a.commits.length ? '<div class="hint">Showing ' + a.commits.length + ' of ' + a.total + ' commits.</div>' : '';
  el.innerHTML = '<div class="chips">' + chips + '</div><div class="rows">' + rows + '</div>' + more;
}

async function runStream(url, payload, label) {
  streaming = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  $('running').textContent = '● ' + label + '…';
  $('out').textContent = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      $('out').textContent += dec.decode(value, { stream: true });
      $('out').scrollTop = $('out').scrollHeight;
    }
  } finally {
    $('running').textContent = '';
    streaming = false;
    await refresh();
  }
}

$('launch').onclick = async () => {
  streaming = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  $('running').textContent = '● Launching server…';
  $('out').textContent = '';
  try {
    $('out').textContent = await (await fetch('/api/launch', { method: 'POST' })).text();
  } finally {
    $('running').textContent = '';
    streaming = false;
    await refresh();
    setTimeout(() => refresh(false), 2500); // give the server a moment to bind :3000, then reflect it
  }
};

// Auto-poll: keep pre-flight + activity current without a manual refresh, so
// merges/pushes made elsewhere show up on their own. Skipped while an action is
// streaming (would fight the button states) and while a refresh is already running.
setInterval(() => { if (!streaming) refresh(false); }, 15000);

$('refresh').onclick = () => refresh(true);
$('publish').onclick = () => runStream('/api/publish', { message: $('msg').value }, 'Publishing');
$('sync').onclick = () => runStream('/api/sync', {}, 'Syncing');
$('regress').onclick = () => runStream('/api/regress', {}, 'Running regress');
$('ship').onclick = () => runStream('/api/ship', {}, 'Shipping code');
$('deploy').onclick = () => {
  const host = (st && st.prod && st.prod.host) || 'production';
  const answer = prompt('This pushes your LOCAL content to PRODUCTION (' + host + ').\\nIt runs regress, backs prod up first, and only ADDS content.\\n\\nType DEPLOY to proceed:');
  if (answer === 'DEPLOY') runStream('/api/deploy-prod', { confirm: 'DEPLOY' }, 'Deploying to production');
};
refresh();
</script>
</body></html>`;
