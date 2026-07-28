// Tablet OS — SPORTS. The league desk: both codes, their tables, their leaders,
// and what any given club has been doing lately.
//
// It owns NO data. Standings, the per-player races and the season state all come
// through the sportsleague and broadcast plugins' registered Actions, never their
// tables — which is what keeps this a screen rather than a second source of truth
// that can disagree with the game you just watched on TV.
//
// The whole thing is a fold over the deterministic schedule, so there is nothing
// stored to go stale and nothing to migrate: a season that has not been played is
// simply an empty table with an honest line under it.
import { dispatchAction } from '../../server/engine/actions.js';
import { registerTabletApp, normScreen } from './registry.js';

// The two codes, and how each one's table reads. Column sets differ (a hockey
// table has four result columns, a baseball table three), so the shape is data
// here exactly as it is in the leagues themselves.
const CODES = {
  baseball: {
    id: 'baseball', tab: 'Deadball', league: 'Coldwater League', icon: '⚾',
    empty: 'No games played yet. The season opens when the first one airs.',
    cols: ['W', 'L', 'PCT', 'RDIF'],
    row: (r) => {
      const gp = (r.wins || 0) + (r.losses || 0);
      const pct = gp ? (r.wins / gp) : 0;
      const rd = (r.runs_for || 0) - (r.runs_against || 0);
      return [String(r.wins || 0), String(r.losses || 0), fmtAvg(pct), (rd > 0 ? '+' : '') + rd];
    },
  },
  hockey: {
    id: 'hockey', tab: 'Cluster Puck', league: 'CPhL', icon: '🏒',
    empty: 'The CPhL has not dropped a puck yet.',
    cols: ['W', 'L', 'OTL', 'PTS', 'GD'],
    row: (r) => {
      const gd = (r.goals_for || 0) - (r.goals_against || 0);
      return [String(r.wins || 0), String(r.losses || 0), String(r.otl || 0), String(r.points || 0), (gd > 0 ? '+' : '') + gd];
    },
  },
};

// A batting average the way a scoreboard writes one — no leading zero.
const fmtAvg = (v) => (v >= 1 ? '1.000' : (v || 0).toFixed(3).replace(/^0/, ''));
const codeOf = (screenId) => {
  const n = normScreen(screenId);
  for (const c of Object.values(CODES)) if (n === c.tab.toLowerCase() || n === c.id) return c;
  return CODES.baseball;
};

// ── Screens ──────────────────────────────────────────────────────────────────
// screenId = a code's tab name -> that league. params = a team name -> its card.

async function leagueScreen(player, code) {
  const [standings, season] = await Promise.all([
    dispatchAction({ type: 'sportsleague.getStandings', actor: player, params: { sport: code.id } }).catch(() => null),
    dispatchAction({ type: 'sportsleague.getSeason', actor: player, params: { sport: code.id } }).catch(() => null),
  ]);
  const rows = standings?.rows || [];

  // The table. Every club is tappable — its card is the interesting screen.
  const items = rows.map((r, i) => ({
    id: r.team,
    label: `${String(i + 1).padStart(2)}  ${r.team}`,
    sub: code.cols.map((c, k) => `${c} ${code.row(r)[k]}`).join('  ·  '),
    badge: i === 0 ? 'ready' : 'active',
    badgeLabel: i === 0 ? 'TOP' : `#${i + 1}`,
  }));

  if (!items.length) {
    items.push({ id: '', label: code.empty, sub: 'Tables are folded from games as they air.', badge: 'active', badgeLabel: '—' });
  }

  // The per-player races, straight off the same fold as the table above them —
  // so a leader can never contradict the standings he appears in.
  const races = [];
  if (code.id === 'baseball') {
    pushRace(races, 'Batting', standings?.batters, (r) => `${fmtAvg(r.avg)} avg · ${r.hits} H in ${r.ab} AB`);
    pushRace(races, 'Home runs', standings?.homers, (r) => `${r.hr} HR · ${r.rbi} RBI`);
    pushRace(races, 'Runs batted in', standings?.rbis, (r) => `${r.rbi} RBI · ${r.hr} HR`);
    if (standings?.minAb) races.push({ note: `Qualified: ${standings.minAb}+ at-bats.` });
  } else {
    pushRace(races, 'Scoring', standings?.scorers, (r) => `${r.points} pts · ${r.goals} G, ${r.assists} A`);
    if (standings?.injuries) {
      races.push({ note: `Season casualties: ${standings.injuries} carried off`
        + (standings.deaths ? `, ${standings.deaths} of them permanently.` : '.') });
    }
  }

  const rowsOut = [];
  if (season?.seasonNo) rowsOut.push({ label: 'Season', value: `#${season.seasonNo}` });
  if (season?.phase && season.phase !== 'regular') {
    rowsOut.push({ label: 'Phase', value: season.phase === 'worldseries' ? 'Championship' : season.phase });
  }
  if (season?.finalistA && season?.finalistB) {
    rowsOut.push({ label: 'Final', value: `${season.finalistA} v ${season.finalistB}` });
  }
  for (const r of races) {
    if (r.note) { rowsOut.push({ label: '', value: r.note }); continue; }
    rowsOut.push({ label: r.title, value: '' });
    for (const line of r.lines) rowsOut.push({ label: `  ${line.name}`, value: line.stat });
  }

  return {
    view: 'list',
    breadcrumb: ['Sports', code.tab],
    activeTab: code.tab,
    tabs: Object.values(CODES).map(c => ({ id: c.tab, label: c.tab })),
    boardName: `${code.icon} ${code.league}`,
    items,
    rows: rowsOut,
  };
}

function pushRace(out, title, rows, stat) {
  if (!Array.isArray(rows) || !rows.length) return;
  out.push({ title, lines: rows.slice(0, 5).map(r => ({ name: r.name, stat: stat(r) })) });
}

// One club. Record, recent form, and the next time they're on — which is the
// reason to open this screen rather than read the table.
async function teamScreen(player, code, team) {
  const [standings, card] = await Promise.all([
    dispatchAction({ type: 'sportsleague.getStandings', actor: player, params: { sport: code.id } }).catch(() => null),
    dispatchAction({ type: 'broadcast.getTeamCard', actor: player, params: { sport: code.id, team } }).catch(() => null),
  ]);
  const rows = standings?.rows || [];
  const idx = rows.findIndex(r => r.team === team);
  const rec = idx >= 0 ? rows[idx] : null;

  const out = [];
  if (rec) {
    out.push({ label: 'Position', value: `${idx + 1} of ${rows.length}` });
    code.cols.forEach((c, k) => out.push({ label: c, value: code.row(rec)[k] }));
  } else {
    out.push({ label: 'Record', value: 'Has not played yet this season.' });
  }

  if (card?.streak > 1) {
    out.push({ label: 'Streak', value: `${card.streak} ${card.streakWon ? 'wins' : 'losses'} running` });
  }

  if (card?.form?.length) {
    out.push({ label: '—', value: '' });
    out.push({ label: 'Form', value: card.form.map(f => (f.won ? 'W' : 'L')).join(' ') + '   (newest first)' });
    for (const f of card.form) {
      out.push({
        label: `  ${f.won ? 'W' : 'L'} ${f.us}–${f.them}`,
        value: `${f.home ? 'vs' : 'at'} ${f.opponent}${f.overtime ? ' (OT)' : ''}`,
      });
    }
  }

  // Upcoming carries NO score. Every game is a pure function of its slot, so the
  // result of a game that hasn't aired is computable — and printing it would spoil
  // the broadcast this whole system exists to make worth watching.
  out.push({ label: '—', value: '' });
  if (card?.next) {
    const n = card.next;
    const when = n.live ? 'On air now'
      : n.slotsAway <= 1 ? 'Next up'
      : `${n.slotsAway} slots away · ${String(Math.floor(n.hour)).padStart(2, '0')}:00`;
    out.push({ label: 'Next game', value: `${n.home ? 'vs' : 'at'} ${n.opponent}` });
    out.push({ label: 'When', value: when });
  } else {
    out.push({ label: 'Next game', value: 'Nothing scheduled in the current window.' });
  }

  return {
    view: 'detail',
    breadcrumb: ['Sports', code.tab, team],
    detail: {
      id: team, name: team,
      desc: `${code.icon} ${code.league}`,
      rows: out,
    },
    actions: [],
  };
}

async function buildScreen(player, screenId, params) {
  const code = codeOf(screenId);
  const team = (params || '').trim();
  if (team) return teamScreen(player, code, team);
  return leagueScreen(player, code);
}

// The home tile's badge: the leader of the league you'd look at first.
async function buildHome(player) {
  const s = await dispatchAction({ type: 'sportsleague.getStandings', actor: player, params: { sport: 'baseball' } }).catch(() => null);
  return { count: (s?.rows || []).length };
}

registerTabletApp({
  id: 'sports', name: 'Sports', icon: '🏆', category: 'General',
  buildHome, buildScreen,
});
