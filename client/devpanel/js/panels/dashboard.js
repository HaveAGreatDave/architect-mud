function renderDashboard(data) {
  const panel = document.getElementById('list-panel');
  const online = (data.online_players || []);
  const admins = online.filter(p => ['admin','dev','builder','designer'].includes(p.role));
  const env = data._env || window._lastEnv || {};
  const forecast = env.forecast || [];
  const timeStr = env.time || '—';
  const dateStr = env.date || '—';
  const season = env.season || '—';
  const weatherStr = env.weatherType ? `${env.weatherIcon || ''} ${env.weatherType}  ${env.tempC != null ? env.tempC + '°C' : ''}`.trim() : '—';

  const card = (icon, label, value, sub, onclick) => `
    <div onclick="${onclick}" style="cursor:pointer;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px 24px;display:flex;flex-direction:column;gap:6px" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="font-size:22px">${icon}</div>
      <div style="font-size:26px;font-weight:700;color:var(--text-bright)">${value}</div>
      <div style="font-size:12px;font-weight:600;color:var(--text)">${label}</div>
      ${sub ? `<div style="font-size:11px;color:var(--text-dim)">${sub}</div>` : ''}
    </div>`;

  const dayLabel = (f, i) => {
    if (f.date) { const d = new Date(f.date); return isNaN(d) ? `Day ${i}` : d.toLocaleDateString(undefined,{weekday:'short'}); }
    return i === 0 ? 'Today' : `+${i}d`;
  };

  const forecastHtml = forecast.length
    ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
        ${forecast.slice(0,7).map((f,i)=>`
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:10px 14px;text-align:center;min-width:72px">
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">${dayLabel(f,i)}</div>
            <div style="font-size:22px;margin-bottom:4px">${f.icon||'?'}</div>
            <div style="font-size:11px;color:var(--text)">${f.weatherType||'?'}</div>
            ${f.tempC!=null?`<div style="font-size:10px;color:var(--text-dim);margin-top:2px">${f.tempC}°C</div>`:''}
          </div>`).join('')}
      </div>`
    : `<div style="font-size:12px;color:var(--text-dim)">No forecast data — weather plugin may not be active.</div>`;

  const btnStyle = (active) => `flex:1;background:${active?'var(--bg3)':'transparent'};border:1px solid ${active?'var(--accent)':'var(--border)'};color:${active?'var(--accent)':'var(--text-dim)'};font-family:var(--font-mono);font-size:11px;padding:5px 8px;cursor:pointer;border-radius:2px`;

  panel.innerHTML = `
    <div style="padding:24px;max-width:1000px">
      <div id="checkin-banner" style="margin-bottom:22px"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:28px">
        ${card('👥', 'Players Online', online.length, online.length ? online.map(p=>p.handle).join(', ') : 'None', "showPanel('players')")}
        ${card('🛡', 'Admins Online', admins.length, admins.length ? admins.map(p=>p.handle).join(', ') : 'None', "showPanel('players')")}
        ${card('🕐', 'Server Time', timeStr, `${dateStr} · ${season} · ${weatherStr}`, "showPanel('timeweather')")}
        ${card('👾', 'Live Enemies', data.live_enemies ?? '—', `${(data.zones||[]).length} zones active`, "showPanel('enemies')")}
        ${card('🚀', 'Deploy Window', '<span id="dep-clock">--:--:--</span>', '<span id="dep-sub">every 4h · click for Actions</span>', "window.open('https://github.com/HaveAGreatDave/architect-mud/actions/workflows/deploy-content.yml','_blank')")}
      </div>

      <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">7-Day Forecast</div>
      ${forecastHtml}

      <div style="margin-top:28px">
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Active Players</div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px">
          <div style="display:flex;align-items:flex-start;gap:28px;margin-bottom:14px">
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">Active Now</div>
              <div id="pcl-active-now" style="font-size:22px;font-weight:700;color:var(--text-bright)">${online.length}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">Peak Concurrent</div>
              <div id="pcl-peak" style="font-size:22px;font-weight:700;color:var(--text-bright)">—</div>
            </div>
            <div style="margin-left:auto;display:flex;gap:4px" id="pcl-range-toggle">
              <button data-range="7d"  style="${btnStyle(false)}">7 Days</button>
              <button data-range="30d" style="${btnStyle(true)}">30 Days</button>
              <button data-range="all" style="${btnStyle(false)}">All Time</button>
            </div>
          </div>
          <div id="pcl-chart" style="width:100%;height:120px"></div>
        </div>
      </div>

      <div style="margin-top:28px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Server Activity Log</div>
          <button id="log-collapse-btn" onclick="(function(){var b=document.getElementById('log-section-body');var btn=document.getElementById('log-collapse-btn');var hidden=b.style.display==='none';b.style.display=hidden?'':'none';btn.textContent=hidden?'Hide':'Show';})()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:2px 8px;cursor:pointer;border-radius:2px">Hide</button>
        </div>
        <div id="log-section-body" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px">
          <textarea id="activity-log-box"
            readonly
            spellcheck="false"
            style="width:100%;height:360px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:10px;box-sizing:border-box;resize:none;border-radius:2px;line-height:1.52;white-space:pre;overflow:auto;word-wrap:normal;overflow-wrap:normal"
            placeholder="Loading…"></textarea>
        </div>
      </div>

      <div style="margin-top:28px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Message of the Day</div>
          <button id="motd-collapse-btn" onclick="(function(){var b=document.getElementById('motd-section-body');var btn=document.getElementById('motd-collapse-btn');var hidden=b.style.display==='none';b.style.display=hidden?'':'none';btn.textContent=hidden?'Hide':'Show';})()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:2px 8px;cursor:pointer;border-radius:2px">Hide</button>
        </div>
        <div id="motd-section-body" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px">

          <!-- Top bar: size toggle + read-only toggle -->
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <div style="display:flex;gap:4px">
              <button id="motd-toggle-big"    style="${btnStyle(true)}">Big</button>
              <button id="motd-toggle-medium" style="${btnStyle(false)}">Medium</button>
              <button id="motd-toggle-small"  style="${btnStyle(false)}">Small</button>
            </div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">Read Only</span>
              <button id="motd-readonly-toggle" style="background:var(--bg3);border:1px solid var(--accent);color:var(--accent);font-family:var(--font-mono);font-size:11px;padding:4px 12px;cursor:pointer;border-radius:2px;min-width:44px">ON</button>
            </div>
          </div>

          <!-- MOTD Template editor -->
          <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:6px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px">MOTD Template</div>
          <div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;font-family:var(--font-mono)">Tokens (expand inside the ascii border): <code>&lt;player name&gt;</code> · <code>&lt;date&gt;</code> · <code>&lt;dynamic text&gt;</code> · <code>&lt;news&gt;</code> — live headlines, one line each</div>
          <textarea id="motd-editor"
            readonly
            spellcheck="false"
            style="width:100%;height:360px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.3;white-space:pre;overflow:auto;word-wrap:normal;overflow-wrap:normal"
            placeholder="Loading…"></textarea>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <button id="motd-save-btn" style="background:var(--accent);border:none;color:#000;font-family:var(--font-mono);font-size:11px;font-weight:600;padding:6px 18px;cursor:pointer;border-radius:2px">Save</button>
            <button id="motd-insert-news" title="Insert the &lt;news&gt; token at the cursor (turn Read Only OFF first)" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:11px;padding:6px 12px;cursor:pointer;border-radius:2px">Insert &lt;news&gt;</button>
          </div>

          <!-- Dynamic text editor -->
          <div style="margin-top:14px">
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:6px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px">Dynamic Text <span style="font-weight:400;color:var(--text-dim);font-size:10px">(replaces &lt;dynamic text&gt; in all sizes)</span></div>
            <textarea id="motd-dynamic"
              spellcheck="false"
              style="width:100%;height:60px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:8px 10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.4"
              placeholder="e.g. Systems are online."></textarea>
            <div style="margin-top:8px">
              <button id="motd-push-btn" style="background:var(--accent);border:none;color:#000;font-family:var(--font-mono);font-size:11px;font-weight:600;padding:6px 18px;cursor:pointer;border-radius:2px">Send</button>
              <span id="motd-status" style="font-size:10px;color:var(--text-dim);margin-left:10px"></span>
            </div>
          </div>

        </div>
      </div>

    </div>`;

  _initMotdEditor();
  _initActivityLog();
  _initPlayerCountChart();
  _initCheckinBanner();
  _initDeployClock();
}

// ── Next deploy window countdown ─────────────────────────────────────────────
// CI debounces deploys onto `cron: '37 */4 * * *'` (see .github/workflows/
// deploy-content.yml) — a push only runs the regress gate.
//
// ⚠ AND A CRON IS NOT A CLOCK, WHICH IS WHY THIS STOPPED BEING PURE ARITHMETIC. The old version
// counted down to the next even hour and knew nothing else, so it was confidently wrong for the
// whole of the part anybody cares about: GitHub's scheduler queues cron runs and starts them late —
// routinely minutes, sometimes much longer — so the card hit 00:00:00, instantly reset to 1:59:59,
// and then the deploy it had been counting down to happened while the card said a full window. Watching
// that once is enough to stop trusting the number, and it read as the timer being out of sync
// because it was: it was showing a SCHEDULE while the question is always "has it gone yet".
//
// There is ground truth available and it was already on the server. The CI job writes a
// `deployments` row as its last step (see the workflow's "Record deployment"), which is the moment
// prod actually restarted onto the new content, and `/staging/deployments` already served it to the
// staging panel. So the card now carries a FACT and an estimate instead of an estimate alone:
//
//  · Before the boundary — count down, as before. This half was never wrong.
//  · After the boundary with no new row — say the window is OPEN and count UP. That is the honest
//    state, and it is exactly the stretch the old clock lied through.
//  · Once a row lands after the boundary — the run has landed, so say when, and resume counting to
//    the next window.
//  · And past `SKIP_AFTER` with nothing recorded — the scheduled run skipped, which is the
//    documented behaviour when HEAD's sha is already live rather than a failure.
//
// Poll is once a minute for three rows: this is a dev panel, not a hot path, and the countdown
// itself still ticks locally every second so nothing depends on the request landing.
//
// ⚠ AND "NOTHING RECORDED YET" IS THREE DIFFERENT THINGS, WHICH IS WHY THE SKIP TIMER WENT AWAY.
// `DEPLOY_SKIP_AFTER` used to call the window a skip once 45 minutes passed with no row. That was
// an inference, and it was usually wrong: GitHub dispatched this cron 29–106 minutes late on every
// one of 12 consecutive windows (see the schedule comment in deploy-content.yml), so the card
// announced a skip and then contradicted itself when the run finally landed. Worse, the three
// states it collapsed are the three you actually want distinguished — *queued* (GitHub has not got
// to us), *running* (it is happening now), and *finished without deploying* (the gate skipped
// because HEAD was already live) — and a FAILED run rendered identically to a healthy skip.
//
// So the run state is now read from the source instead of guessed: the repo is public, so the
// Actions REST API answers unauthenticated straight from the browser, no token and no server hop.
// `deployments` stays the ground truth for *did prod restart*; Actions only explains the gap.
//
// ⚠ UNAUTHENTICATED MEANS 60 REQUESTS PER HOUR PER IP, SHARED WITH EVERY OTHER TAB. Hence: polled
// only while the window is unresolved (never once a deploy has landed), at 3 minutes rather than
// the 1 minute used for our own API, and a failure just sets `_ghBlocked` and drops back to the
// arithmetic — the old behaviour, which is a fine floor to fall to.
const DEPLOY_WINDOW_MIN = 37;            // ⚠ must match the cron minute in deploy-content.yml
const DEPLOY_WINDOW_HRS = 4;             // ⚠ must match the cron hour step in deploy-content.yml
const DEPLOY_FALLBACK_SKIP = 75 * 60000; // only used when Actions is unreachable; see _windowStatus
// `event=schedule` on purpose: this read exists ONLY to explain why a scheduled window has gone
// quiet. A forced deploy (`[deploy]` token, or Run workflow) is a different event and is invisible
// here — correctly, because it writes a `deployments` row, so `landed` already covers it.
const GH_RUNS_URL = 'https://api.github.com/repos/HaveAGreatDave/architect-mud'
                  + '/actions/workflows/deploy-content.yml/runs?event=schedule&per_page=1';
let _lastDeployAt = null;                // ms epoch of the newest recorded deploy, or null
let _deployPollAt = 0;
let _ghRun = null;                       // newest scheduled run: {at, done, status, conclusion}
let _ghPollAt = 0;
let _ghBlocked = false;                  // last Actions fetch failed → fall back to arithmetic

const _pad2 = n => String(n).padStart(2, '0');

function _windowBefore(now) {            // the most recent deploy-window boundary at or before `now`
  const w = new Date(now);
  w.setUTCMinutes(DEPLOY_WINDOW_MIN, 0, 0);
  w.setUTCHours(w.getUTCHours() - (w.getUTCHours() % DEPLOY_WINDOW_HRS));
  // Snapping the minute FORWARD lands us past `now` for the first `DEPLOY_WINDOW_MIN` minutes of
  // each window hour, so step back a whole window rather than reporting a boundary in the future.
  if (w.getTime() > now) w.setUTCHours(w.getUTCHours() - DEPLOY_WINDOW_HRS);
  return w;
}

function _windowLabel(d) { return `${_pad2(d.getUTCHours())}:${_pad2(d.getUTCMinutes())} UTC`; }

// What to say about a window that recorded no deploy. Returns { text, bad, resolved }:
//   · `resolved` false ⇒ the window is still in play, so the clock counts UP and waits.
//   · `resolved` true  ⇒ this window is over and produced nothing, so the clock goes back to
//     counting DOWN to the next one and this text becomes its prefix. Without that split a skipped
//     window would count up for the whole window and never show the next deploy at all.
//   · `bad` reddens the clock, and is reserved for a run that actually FAILED — the state the old
//     card could not draw, because a failure and a healthy skip both looked like silence.
function _windowStatus(prev, sinceWindow, now) {
  const label = _windowLabel(prev);
  const run = _ghRun && _ghRun.at >= prev.getTime() ? _ghRun : null;

  if (run) {
    if (run.status === 'queued')      return { text: `${label} run queued on GitHub`, resolved: false };
    if (run.status === 'in_progress') return { text: `${label} run in progress`, resolved: false };
    if (run.conclusion === 'success') {
      // Succeeded but wrote no `deployments` row ⇒ the gate skipped it. Give our own 60s poll a
      // chance to catch up first, or a real deploy reads as a skip for up to a minute.
      return now - run.done < 90000
        ? { text: `${label} run finished · confirming`, resolved: false }
        : { text: `${label} skipped — HEAD already live`, resolved: true };
    }
    return { text: `${label} run ${run.conclusion || 'ended'} — check Actions`, bad: true, resolved: true };
  }

  // No run exists for this window yet. With Actions readable that is a FACT (GitHub has not
  // dispatched us), so say so, and keep waiting however long it takes — the whole point is that we
  // no longer have to guess when to give up. Blocked, it is the old guess, so keep the old wording
  // and the old skip inference, widened because 45 minutes was inside the observed dispatch lag.
  if (!_ghBlocked) return { text: `${label} window open · waiting on GitHub's scheduler`, resolved: false };
  return sinceWindow > DEPLOY_FALLBACK_SKIP
    ? { text: `${label} no run seen (Actions unreachable)`, resolved: true }
    : { text: `${label} window open · waiting on the runner`, resolved: false };
}

function _initDeployClock() {
  if (!document.getElementById('dep-clock')) return;
  clearInterval(window._depTimer);   // panel re-renders; never stack intervals

  const pad = _pad2;
  const hms = (ms) => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms % 3600000 / 60000))}:${pad(Math.floor(ms % 60000 / 1000))}`;
  const ago = (ms) => (ms < 90000 ? 'just now' : ms < 3600000 ? `${Math.round(ms / 60000)} min ago` : `${(ms / 3600000).toFixed(1)}h ago`);

  const poll = () => {
    // Failure is silent on purpose: a dev panel that cannot reach the API has bigger problems to
    // report than this card, and falling back to the arithmetic is exactly the old behaviour.
    // `directAPI`, like the rest of this panel: a GET needs none of the staging interception `API`
    // wraps every call in, and this one runs on a timer.
    directAPI('/staging/deployments').then((d) => {
      const t = d?.deployments?.[0]?.deployedAt;
      const ms = t ? Date.parse(t) : NaN;
      if (!Number.isNaN(ms)) _lastDeployAt = ms;
    }).catch(() => {});
  };

  const pollRuns = () => {
    // Unauthenticated, public-repo read — no token, no server hop, and CORS-clean. A non-2xx is
    // almost always the 60/hour rate limit, and is treated exactly like being offline.
    fetch(GH_RUNS_URL, { headers: { Accept: 'application/vnd.github+json' } })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        const r = d?.workflow_runs?.[0];
        _ghRun = r ? {
          at: Date.parse(r.created_at),      // when GitHub DISPATCHED it, which is the late number
          done: Date.parse(r.updated_at),
          status: r.status,                  // queued | in_progress | completed
          conclusion: r.conclusion,          // success | failure | cancelled | skipped | null
        } : null;
        _ghBlocked = false;
      })
      .catch(() => { _ghBlocked = true; });
  };

  const tick = () => {
    const clock = document.getElementById('dep-clock');
    if (!clock) { clearInterval(window._depTimer); return; }  // panel switched away
    const now = Date.now();
    if (now - _deployPollAt > 60000) { _deployPollAt = now; poll(); }

    const prev = _windowBefore(now);
    const next = new Date(prev); next.setUTCHours(next.getUTCHours() + DEPLOY_WINDOW_HRS);
    const sinceWindow = now - prev.getTime();
    const landed = _lastDeployAt != null && _lastDeployAt >= prev.getTime();
    const sub = document.getElementById('dep-sub');

    // Only while this window is unrecorded, and never at the 1s tick rate — see the rate-limit ⚠.
    if (!landed && now - _ghPollAt > 180000) { _ghPollAt = now; pollRuns(); }

    const st = landed ? null : _windowStatus(prev, sinceWindow, now);

    if (st && !st.resolved) {
      // The window is open and still in play. Counting UP is the only honest thing to show, and
      // `st.text` now names WHICH of the three reasons rather than implying one.
      clock.textContent = `+${hms(sinceWindow)}`;
      clock.style.color = 'var(--yellow)';
      if (sub) sub.textContent = st.text;
      return;
    }

    const ms = Math.max(0, next.getTime() - now);
    clock.textContent = hms(ms);
    clock.style.color = st?.bad ? 'var(--red)' : (ms < 600000 ? 'var(--yellow)' : '');
    if (!sub) return;
    const at = `${_windowLabel(next)} · ${next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} local`;
    sub.textContent = landed ? `deployed ${ago(now - _lastDeployAt)} · next ${at}`
      : `${st.text} · next ${at}`;
  };

  tick();
  window._depTimer = setInterval(tick, 1000);
}

// ── "Since you last checked in" banner ────────────────────────────────────────
// Surfaces what other contributors added since this dev last cleared the banner:
// recent commits + any unresolved action-required Dev Log notes. Last-seen is a
// per-handle localStorage marker (nothing server-side to keep in sync).

async function _initCheckinBanner() {
  const el = document.getElementById('checkin-banner');
  if (!el) return;
  const handle = (typeof devHandle !== 'undefined' && devHandle) || 'dev';
  const key = 'devLastSeen:' + handle;
  const last = localStorage.getItem(key);
  const firstVisit = !last;

  const [act, notesResp] = await Promise.all([
    directAPI('/dev/activity' + (last ? `?since=${encodeURIComponent(last)}` : '')),
    directAPI('/dev/notes'),
  ]);
  const allCommits = (act && act.commits) || [];
  // "By others" — exclude commits resolved to this dev's own handle. Unmapped
  // authors count as others (can't prove they're you).
  const commits   = allCommits.filter(c => !(c.handle && c.handle === handle));
  const notes     = (notesResp && notesResp.notes) || [];
  const actionReq = notes.filter(n => n.kind === 'action-required' && !n.resolved);

  if (!commits.length && !actionReq.length && !firstVisit) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text-dim);border:1px solid var(--border);border-radius:4px;padding:10px 14px;background:var(--bg2)">✓ You're up to date — nothing new since your last check-in.</div>`;
    return;
  }

  const authors = [...new Set(commits.map(c => c.handle || c.author))];
  const sinceLabel = last
    ? `since ${new Date(last).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}`
    : 'in the last 14 days';

  const coreCount = commits.filter(c => c.core).length;
  const bits = [];
  if (commits.length) bits.push(`<strong style="color:var(--text-bright)">${commits.length}</strong> commit${commits.length===1?'':'s'}${authors.length ? ` by ${authors.slice(0,4).map(a=>_dashEsc(a)).join(', ')}${authors.length>4?'…':''}` : ''}`);
  if (coreCount) bits.push(`<strong style="color:var(--red)">⚙ ${coreCount}</strong> core-engine change${coreCount===1?'':'s'}`);
  if (actionReq.length) bits.push(`<strong style="color:var(--red)">${actionReq.length}</strong> action-required note${actionReq.length===1?'':'s'}`);
  const summary = bits.length ? bits.join(' · ') : 'Welcome — no code activity yet.';

  const noteList = actionReq.slice(0, 4).map(n =>
    `<div style="font-size:11px;color:var(--text);margin-top:4px">⚠ <strong>${_dashEsc(n.title)}</strong><span style="color:var(--text-dim)"> — ${_dashEsc(n.author)}</span></div>`
  ).join('');

  const accent = actionReq.length ? 'var(--red)' : 'var(--accent)';
  el.innerHTML = `
    <div style="border:1px solid var(--border);border-left:3px solid ${accent};border-radius:4px;padding:12px 16px;background:var(--bg2)">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Since you last checked in</span>
        <span style="font-size:12px;color:var(--text)">${summary} <span style="color:var(--text-dim)">${sinceLabel}</span></span>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button onclick="showPanel('devlog')" style="background:transparent;border:1px solid var(--border);color:var(--accent);font-family:var(--font-mono);font-size:10px;padding:3px 10px;cursor:pointer;border-radius:2px">Open Dev Log</button>
          <button onclick="_checkinMarkRead()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:3px 10px;cursor:pointer;border-radius:2px">Mark all read</button>
        </span>
      </div>
      ${noteList}
    </div>`;
}

function _dashEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function _checkinMarkRead() {
  const handle = (typeof devHandle !== 'undefined' && devHandle) || 'dev';
  localStorage.setItem('devLastSeen:' + handle, new Date().toISOString());
  _initCheckinBanner();
}

// ── MOTD editor logic ────────────────────────────────────────────────────────

async function _initMotdEditor() {
  const editor        = document.getElementById('motd-editor');
  const dynamicBox    = document.getElementById('motd-dynamic');
  const saveBtn       = document.getElementById('motd-save-btn');
  const insertNewsBtn = document.getElementById('motd-insert-news');
  const pushBtn       = document.getElementById('motd-push-btn');
  const status        = document.getElementById('motd-status');
  const readonlyBtn   = document.getElementById('motd-readonly-toggle');
  const toggleBig     = document.getElementById('motd-toggle-big');
  const toggleMedium  = document.getElementById('motd-toggle-medium');
  const toggleSmall   = document.getElementById('motd-toggle-small');
  if (!editor || !saveBtn) return;

  let _view     = 'big';      // 'big' | 'medium' | 'small'
  let _readonly = true;
  let _motd     = { big: '', medium: '', small: '', dynamic: '', news: [] };

  const btnStyle = (active) => {
    if (active) {
      return 'var(--bg3)';
    }
    return 'transparent';
  };

  function _refreshToggleBtns() {
    [['big', toggleBig], ['medium', toggleMedium], ['small', toggleSmall]].forEach(([key, btn]) => {
      if (!btn) return;
      const active = _view === key;
      btn.style.background   = active ? 'var(--bg3)'    : 'transparent';
      btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border)';
      btn.style.color        = active ? 'var(--accent)' : 'var(--text-dim)';
    });
  }

  function _getPreview(view) {
    const dyn = (dynamicBox?.value ?? _motd.dynamic) || '';
    const news = (_motd.news && _motd.news.length ? _motd.news : ['[No recent broadcasts available]']).join('\n');
    return (_motd[view] || '')
      .replace(/<dynamic text>/g, dyn || '[dynamic text]')
      .replace(/<news>/g, news);
  }

  function _setEditorContent(text) {
    if (!editor) return;
    editor.value = text != null ? text : (_motd[_view] || '');
  }

  function _updateEditor() {
    if (!editor) return;
    editor.readOnly = _readonly;
    editor.style.color       = _readonly ? 'var(--text-dim)' : 'var(--text)';
    editor.style.borderColor = _readonly ? 'var(--border)' : 'var(--accent)';
  }

  function _setView(v) {
    if (!_readonly && editor) _motd[_view] = editor.value;
    _view = v;
    _refreshToggleBtns();
    _setEditorContent();
    _updateEditor();
  }

  function _toggleReadonly() {
    if (!_readonly && editor) _motd[_view] = editor.value;
    _readonly = !_readonly;
    readonlyBtn.textContent  = _readonly ? 'ON' : 'OFF';
    readonlyBtn.style.borderColor = _readonly ? 'var(--accent)' : 'var(--yellow)';
    readonlyBtn.style.color       = _readonly ? 'var(--accent)' : 'var(--yellow)';
    _updateEditor(); // only toggles editability — content unchanged
  }

  toggleBig?.addEventListener('click',    () => _setView('big'));
  toggleMedium?.addEventListener('click', () => _setView('medium'));
  toggleSmall?.addEventListener('click',  () => _setView('small'));
  readonlyBtn?.addEventListener('click',  _toggleReadonly);

  // Drop the <news> token in at the cursor (editor must be editable). The token
  // expands to the live headlines at render time, wrapped inside the ascii border.
  insertNewsBtn?.addEventListener('click', () => {
    if (!editor) return;
    if (_readonly) { _showStatus('Turn Read Only OFF to edit', false); return; }
    const s = editor.selectionStart ?? editor.value.length;
    const e = editor.selectionEnd ?? editor.value.length;
    editor.value = editor.value.slice(0, s) + '<news>' + editor.value.slice(e);
    editor.selectionStart = editor.selectionEnd = s + 6;
    _motd[_view] = editor.value;
    editor.focus();
  });

  function _showStatus(msg, ok = true) {
    if (!status) return;
    status.textContent  = msg;
    status.style.color  = ok ? 'var(--green)' : 'var(--red)';
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
  }

  saveBtn.addEventListener('click', async () => {
    if (!_readonly && editor) _motd[_view] = editor.value;
    const dyn = dynamicBox?.value ?? '';
    const body = { big: _motd.big, medium: _motd.medium, small: _motd.small, dynamic: dyn };

    saveBtn.disabled = true;
    const d = await directAPI('/motd', 'PUT', body);
    if (d.ok) {
      _motd.dynamic = dyn;
      _showStatus('✓ Saved (all)');
    } else {
      _showStatus(d.error || 'Error', false);
    }
    saveBtn.disabled = false;
  });

  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true;
    const dyn = dynamicBox?.value ?? '';
    const d = await directAPI('/motd/push', 'POST', { dynamic: dyn });
    if (d.ok) _motd.dynamic = dyn;
    _showStatus(d.ok ? '✓ Pushed to all players' : (d.error || 'Error'), d.ok);
    pushBtn.disabled = false;
  });

  // Load from server
  const d = await directAPI('/motd');
  if (d.error) {
    if (editor) editor.placeholder = 'Failed to load MOTD.';
  } else {
    _motd = { big: d.big || '', medium: d.medium || '', small: d.small || '', dynamic: d.dynamic || '', news: Array.isArray(d.news) ? d.news : [] };
    if (dynamicBox) dynamicBox.value = _motd.dynamic;
    _refreshToggleBtns();
    _setEditorContent();
    _updateEditor();
  }
}

async function _initActivityLog() {
  const box = document.getElementById('activity-log-box');
  if (!box) return;
  const d = await directAPI('/server-activity-log');
  if (d.error || !d.rows?.length) { box.value = d.error ? 'Failed to load activity log.' : '(no activity yet)'; return; }
  const lines = d.rows.map(row => {
    const ts = new Date(row.occurred_at).toLocaleString();
    if (row.event_type === 'connect')      return `[${ts}] *** ${row.handle} Connects`;
    if (row.event_type === 'disconnect')   return `[${ts}] *** ${row.handle} Disconnects`;
    if (row.event_type === 'death')        return `[${ts}] ${row.handle} Dies`;
    if (row.event_type === 'kick')         return `[${ts}] ${row.handle} was kicked by ${row.admin_handle || 'An administrator'}`;
    if (row.event_type === 'pvp_kill')     return `[${ts}] ☠ ${row.handle} killed ${row.detail || '???'}`;
    if (row.event_type === 'char_created') return `[${ts}] ✦ ${row.handle} created`;
    if (row.event_type === 'admin_cmd')    return `[${ts}] [ADMIN] ${row.handle}: ${row.detail || ''}`;
    if (row.event_type === 'timescale')    return `[${ts}] ⏱ [ADMIN] ${row.handle} ${row.detail || 'changed game speed'}`;
    return `[${ts}] ${row.event_type}: ${row.handle}`;
  });
  box.value = lines.join('\n');
}

async function _initPlayerCountChart(rangeKey = '30d') {
  const container = document.getElementById('pcl-chart');
  const peakEl    = document.getElementById('pcl-peak');
  const toggle    = document.getElementById('pcl-range-toggle');
  if (!container) return;

  // Wire the range buttons once, on first render.
  if (toggle && !toggle.dataset.wired) {
    toggle.dataset.wired = '1';
    toggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach(b => {
          const active = b === btn;
          b.style.background  = active ? 'var(--bg3)'    : 'transparent';
          b.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
          b.style.color       = active ? 'var(--accent)' : 'var(--text-dim)';
        });
        _initPlayerCountChart(btn.dataset.range);
      });
    });
  }

  container.innerHTML = `<div style="height:120px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-dim)">Loading…</div>`;
  const d = await directAPI('/player-count-log?range=' + encodeURIComponent(rangeKey));
  const rows = (d.rows || []);

  const peak = rows.length ? Math.max(...rows.map(r => r.count)) : 0;
  if (peakEl) peakEl.textContent = rows.length ? peak : '—';

  if (rows.length < 2) {
    container.innerHTML = `<div style="height:120px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-dim)">${rows.length === 0 ? 'No data yet — check back in a minute.' : 'Collecting data…'}</div>`;
    return;
  }

  const W = 900, H = 100, PAD = 4;
  const counts = rows.map(r => r.count);
  const maxV   = Math.max(...counts, 1);
  const minV   = 0;
  const range  = maxV - minV || 1;

  // x is TIME, not row index. The server zero-fills every bucket so the two
  // agree today, but an index axis silently squeezes any missing stretch down
  // to a single pixel — which is how a server that was empty for three days
  // drew as an unbroken line that never touched the floor.
  const ts   = rows.map(r => new Date(r.recorded_at).getTime());
  const t0   = ts[0];
  const tSpan = (ts[ts.length - 1] - t0) || 1;

  const x = (i) => PAD + ((ts[i] - t0) / tSpan) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - minV) / range) * (H - PAD * 2);

  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.count).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${H} ` +
    rows.map((r, i) => `L${x(i).toFixed(1)},${y(r.count).toFixed(1)}`).join(' ') +
    ` L${x(rows.length - 1).toFixed(1)},${H} Z`;

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:120px;display:block">
      <defs>
        <linearGradient id="pcl-line-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e05555"/>
          <stop offset="100%" stop-color="#55bb55"/>
        </linearGradient>
        <linearGradient id="pcl-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e05555" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#55bb55" stop-opacity="0.04"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#pcl-area-grad)"/>
      <polyline points="${pts}" fill="none" stroke="url(#pcl-line-grad)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

// --- Players panel ---
