// Leagues: Deadball's Coldwater League and the CPhL, each with its open season, the
// table as it stands and a button that starts the league over. Live state, so every
// call is directAPI. The restart itself is restartLeague in index.js.

const _lgEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _lgPhase = { regular: 'regular season', worldseries: 'final seeded', complete: 'closed' };

function _lgCard(l) {
  const s = l.season;
  const day = l.day ? `day ${l.day.of} of ${l.day.days}${l.day.cupDay ? ' (Cup day)' : ''}` : 'clock not loaded';
  const status = !s ? 'No season open yet.'
    : s.finalists ? `Season ${s.no} · ${_lgEsc(l.final)}: ${_lgEsc(s.finalists[0])} vs ${_lgEsc(s.finalists[1])}`
    : `Season ${s.no} · ${_lgPhase[s.phase] || _lgEsc(s.phase)} · ${day}`;
  const started = s ? `Opened ${_lgEsc(s.startDate || '?')}${s.startsLater ? ', first game still to come' : ''}` : '';
  const champ = l.champion
    ? `Reigning champion: ${_lgEsc(l.champion.team)}, beat ${_lgEsc(l.champion.over)} ${_lgEsc(l.champion.score)} (Season ${l.champion.season})`
    : 'No champion yet.';
  const table = l.table.length
    ? `<pre style="margin:10px 0 0;font-size:11px;line-height:1.45;color:var(--text);overflow-x:auto">` +
      `  #  ${'TEAM'.padEnd(26)} ${_lgEsc(l.head)}\n` +
      l.table.map((r, i) => ` ${String(i + 1).padStart(2)}  ${_lgEsc(r.team).padEnd(26)} ${_lgEsc(r.cells)}`).join('\n') +
      `</pre>`
    : `<div style="margin-top:10px;font-size:12px;color:var(--text-dim)">No games in this season yet.</div>`;
  return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px 20px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
        <div style="font-weight:700;color:var(--text-bright)">${l.icon} ${_lgEsc(l.show)} <span style="color:var(--text-dim);font-weight:400">· ${_lgEsc(l.league)}</span></div>
        <div style="font-size:11px;color:var(--text-dim)">${l.seasons} season${l.seasons === 1 ? '' : 's'} played, ${l.crowned} crowned</div>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text)">${status}</div>
      <div style="margin-top:2px;font-size:11px;color:var(--text-dim)">${started}</div>
      <div style="margin-top:2px;font-size:11px;color:var(--text-dim)">${champ}</div>
      ${table}
      <div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="action-btn danger" onclick="leaguesRestart('${l.sport}')">Start a fresh season</button>
        <label style="font-size:11px;color:var(--text-dim);display:flex;gap:6px;align-items:center">
          <input type="checkbox" id="lg-wipe-${l.sport}"> Also wipe the history (back to Season 1, no champions)
        </label>
      </div>
    </div>`;
}

function renderLeaguesPanel(data) {
  const leagues = Array.isArray(data?.leagues) ? data.leagues : [];
  document.getElementById('list-panel').innerHTML = `
    <div style="padding:24px;max-width:760px;display:flex;flex-direction:column;gap:16px">
      <div style="font-size:11px;color:var(--text-dim);line-height:1.5">
        A fresh season opens 0-0 from the next game and still ends on the month's last day.
        The season it replaces closes with no champion. Started late in the month, the new one
        may not have enough games for a final and will close uncrowned on Cup day.
        TVs pick up the new season within about 30 seconds.
      </div>
      ${leagues.map(_lgCard).join('') || '<div style="color:var(--text-dim)">No leagues.</div>'}
    </div>`;
}

window.leaguesRestart = async function (sport) {
  const l = (window._lgLast || []).find(x => x.sport === sport);
  const name = l ? `${l.show} (${l.league})` : sport;
  const wipe = !!document.getElementById(`lg-wipe-${sport}`)?.checked;
  const msg = wipe
    ? `Wipe every ${name} season, champions included, and start again at Season 1? This can't be undone.`
    : `Close ${name}${l?.season ? ` Season ${l.season.no}` : ''} with no champion and start a fresh season from the next game?`;
  if (!(await dpConfirm(msg, { title: 'Start a fresh season', okLabel: wipe ? 'Wipe and restart' : 'Restart', danger: true }))) return;
  const r = await directAPI('/sportsleague/restart', 'POST', { sport, wipe });
  if (!r || r.error) { toast(r?.error || 'Restart failed', true); return; }
  toast(`${l?.icon || ''} ${name}: Season ${r.seasonNo} has started${r.wiped ? ', history wiped' : ''}`);
  showPanel('leagues');
};

registerDevPanel({
  id: 'leagues',
  title: 'Leagues',
  description: "Deadball's and the CPhL's seasons: the open season, its table, and a fresh start for either league.",
  fetch: async () => {
    const d = await directAPI('/sportsleague/state');
    window._lgLast = d?.leagues || [];
    return d;
  },
  noEdit: true,
  render: renderLeaguesPanel,
});
