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
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { registerTabletApp, normScreen } from './registry.js';

// ── Home-widget preference ───────────────────────────────────────────────────
// Two player flags, both optional, both read from the hydrated flag cache (no
// query — see the buildWidget contract in index.js):
//   sports_widget      off | both | baseball | hockey   (default: both)
//   sports_follow_team a club name, or unset
// Following a club narrows the card to the next time THAT club is on television,
// which is the only reason a fan wants a scoreboard on their home screen. With
// nobody followed it's simply whatever airs next.
const WIDGET_MODES = ['both', 'baseball', 'hockey', 'off'];
const WIDGET_MODE_LABEL = { both: 'Both codes', baseball: 'Deadball only', hockey: 'Cluster Puck only', off: 'Off' };
const widgetModeOf = async (player) => {
  const v = await getFlag('player', 'sports_widget', player).catch(() => undefined);
  return WIDGET_MODES.includes(v) ? v : 'both';
};
const followedTeam = async (player) => {
  const v = await getFlag('player', 'sports_follow_team', player).catch(() => undefined);
  return (typeof v === 'string' && v && v !== 'none') ? v : null;
};

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
    empty: "The CPhL hasn't dropped a puck yet.",
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
  const [standings, season, look, cal] = await Promise.all([
    dispatchAction({ type: 'sportsleague.getStandings', actor: player, params: { sport: code.id } }).catch(() => null),
    dispatchAction({ type: 'sportsleague.getSeason', actor: player, params: { sport: code.id } }).catch(() => null),
    dispatchAction({ type: 'broadcast.getClubLook', actor: player, params: { sport: code.id } }).catch(() => null),
    dispatchAction({ type: 'broadcast.getSeasonCalendar', actor: player, params: { sport: code.id } }).catch(() => null),
  ]);
  const rows = standings?.rows || [];
  const clubs = look?.clubs || {};

  // The table. Every club is tappable: its card is the interesting screen.
  const table = rows.map((r, i) => ({
    team: r.team, pos: i + 1,
    abbr: clubs[r.team]?.abbr || r.team.slice(0, 3).toUpperCase(),
    colours: clubs[r.team]?.colours || null,
    cells: code.row(r),
  }));

  // The per-player races, straight off the same fold as the table above them,
  // so a leader can never contradict the standings he appears in.
  const races = [];
  const notes = [];
  if (code.id === 'baseball') {
    pushRace(races, 'Batting', standings?.batters, (r) => `${fmtAvg(r.avg)} avg · ${r.hits} H in ${r.ab} AB`);
    pushRace(races, 'Home runs', standings?.homers, (r) => `${r.hr} HR · ${r.rbi} RBI`);
    pushRace(races, 'Runs batted in', standings?.rbis, (r) => `${r.rbi} RBI · ${r.hr} HR`);
    pushRace(races, 'Stolen bases', standings?.steals, (r) => `${r.sb} SB · ${r.cs} CS`);
    pushRace(races, 'Strikeouts', standings?.strikeouts, (r) => `${r.k} K · ${r.w}-${r.l} · ${(r.era || 0).toFixed(2)} ERA`);
    if (standings?.minAb) notes.push(`Batting race: ${standings.minAb}+ at-bats to qualify.`);
  } else {
    pushRace(races, 'Scoring', standings?.scorers, (r) => `${r.points} pts · ${r.goals} G, ${r.assists} A`);
    if (standings?.injuries) {
      notes.push(`Season casualties: ${standings.injuries} carried off`
        + (standings.deaths ? `, ${standings.deaths} of them permanently.` : '.'));
    }
  }

  const final = await finalFor(player, code, season, cal);

  // What the home-screen card is currently set to, and the button that walks it on
  // to the next setting. One action, four states.
  const mode = await widgetModeOf(player);
  const follow = await followedTeam(player);
  const nextMode = WIDGET_MODES[(WIDGET_MODES.indexOf(mode) + 1) % WIDGET_MODES.length];

  return {
    view: 'sports',
    breadcrumb: ['Sports', code.tab],
    activeTab: code.tab,
    tabs: Object.values(CODES).map(c => ({ id: c.tab, label: `${c.icon} ${c.tab}` })),
    sport: code.id, icon: code.icon, league: code.league, show: code.tab,
    seasonNo: season?.seasonNo || null,
    day: cal ? { of: cal.dayOfMonth, days: cal.monthDays } : null,
    final,
    cols: code.cols, table, empty: code.empty,
    follow,
    races, notes,
    homeCard: WIDGET_MODE_LABEL[mode] + (follow ? ` · following ${follow}` : ''),
    actions: [{ id: `widget:${code.id}:${nextMode}`, label: `Home card: ${WIDGET_MODE_LABEL[nextMode]}` }],
  };
}

// The season's final: its name, the date and hour it airs, and who's in it once the
// league has seeded it. Before then it's the last day of the season's month, in the
// sport's last slot that day, the same sum the league seeds it with.
async function finalFor(player, code, season, cal) {
  let slot = season?.phase === 'worldseries' && season.wsSlot != null ? season.wsSlot : null;
  if (slot == null && season?.startSlot != null) {
    const sc = await dispatchAction({ type: 'broadcast.getSeasonCalendar', actor: player, params: { sport: code.id, slot: season.startSlot } }).catch(() => null);
    slot = sc?.finalSlot ?? null;
  }
  if (slot == null) slot = cal?.finalSlot ?? null;
  if (slot == null) return null;
  const when = await dispatchAction({ type: 'broadcast.slotWhen', actor: player, params: { slot } }).catch(() => null);
  if (!when) return null;
  const seeded = season?.phase === 'worldseries' && season.finalistA && season.finalistB;
  return {
    title: FINAL_TITLE[code.id],
    date: when.date, dateLabel: fmtGameDate(when.date),
    hour: when.hour, time: `${String(when.hour).padStart(2, '0')}:00`,
    daysAway: when.daysAway,
    state: when.slotsAway === 0 ? 'live' : when.slotsAway < 0 ? 'played' : 'upcoming',
    teams: seeded ? [season.finalistA, season.finalistB] : null,
  };
}
const FINAL_TITLE = { baseball: 'Curtain Call', hockey: 'Coldwater Cup' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtGameDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function pushRace(out, title, rows, stat) {
  if (!Array.isArray(rows) || !rows.length) return;
  out.push({ title, lines: rows.slice(0, 5).map(r => ({ name: r.name, stat: stat(r) })) });
}

// One club. Record, recent form, and the next time they're on — which is the
// reason to open this screen rather than read the table.
async function teamScreen(player, code, teamParam) {
  // The dispatcher lowercases every command it tokenizes, so the club name that
  // comes back off a tap is 'coldwater kingfishers', never the 'Coldwater
  // Kingfishers' the league knows. Resolve it against the live table BEFORE asking
  // for a card: an exact-match lookup on the lowercased string finds nothing.
  const [standings, season, look] = await Promise.all([
    dispatchAction({ type: 'sportsleague.getStandings', actor: player, params: { sport: code.id } }).catch(() => null),
    dispatchAction({ type: 'sportsleague.getSeason', actor: player, params: { sport: code.id } }).catch(() => null),
    dispatchAction({ type: 'broadcast.getClubLook', actor: player, params: { sport: code.id } }).catch(() => null),
  ]);
  const rows = standings?.rows || [];
  const team = resolveTeam(rows, teamParam);
  const [card, following] = await Promise.all([
    dispatchAction({ type: 'broadcast.getTeamCard', actor: player, params: { sport: code.id, team } }).catch(() => null),
    followedTeam(player),
  ]);
  const idx = rows.findIndex(r => r.team === team);
  const rec = idx >= 0 ? rows[idx] : null;
  const clubs = look?.clubs || {};

  // Upcoming carries NO score. Every game is a pure function of its slot, so the
  // result of a game that hasn't aired is computable, and printing it would spoil
  // the broadcast this whole system exists to make worth watching.
  let next = null;
  if (card?.next) {
    const n = card.next;
    next = {
      opponent: n.opponent, home: n.home, live: !!n.live,
      oppAbbr: clubs[n.opponent]?.abbr || null, oppColours: clubs[n.opponent]?.colours || null,
      when: n.live ? 'On air now' : n.slotsAway <= 1 ? 'Next up' : `${String(Math.floor(n.hour)).padStart(2, '0')}:00 · ${n.slotsAway} slots away`,
    };
  }

  const inFinal = season?.phase === 'worldseries' && [season.finalistA, season.finalistB].includes(team);
  const final = inFinal ? await finalFor(player, code, season, null) : null;

  return {
    view: 'sports_team',
    breadcrumb: ['Sports', code.tab, team],
    sport: code.id, icon: code.icon, league: code.league,
    team, abbr: clubs[team]?.abbr || team.slice(0, 3).toUpperCase(), colours: clubs[team]?.colours || null,
    following: following === team,
    pos: rec ? idx + 1 : null, of: rows.length,
    cols: code.cols, cells: rec ? code.row(rec) : null,
    streak: card?.streak > 1 ? `${card.streak} ${card.streakWon ? 'wins' : 'losses'} running` : null,
    form: (card?.form || []).map(f => ({ won: f.won, us: f.us, them: f.them, home: f.home, opponent: f.opponent, overtime: !!f.overtime })),
    next, final,
    // Following a club points the home-screen card at the next time THEY are on
    // television. The id travels as the action's params.
    detail: { id: team },
    actions: [{
      id: `follow:${code.id}`,
      label: following === team ? '★ Following: tap to unfollow' : '☆ Follow on home screen',
    }],
  };
}

// Match a lowercased (or otherwise scruffy) club name back to the league's own
// spelling. Falls through to the raw string so an unknown club still renders an
// honest "has not played" rather than an error.
function resolveTeam(rows, name) {
  const want = String(name || '').trim().toLowerCase();
  return (rows || []).find(r => String(r.team).toLowerCase() === want)?.team || String(name || '').trim();
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

// ── Home widget: the next game on television ─────────────────────────────────
// ONE game — the next thing the schedule actually puts on air, not the day's
// fixture list. If it's already playing, the score as far as it has been called
// (broadcast.getNextOnAir enforces the spoiler rule; nothing here can leak a
// result the announcer hasn't reached). Off, or narrowed to one code, or pinned
// to a club, from the app's own settings row.
async function buildWidget(player) {
  const mode = await widgetModeOf(player);
  if (mode === 'off') return null;
  const team = await followedTeam(player);
  const game = await dispatchAction({
    type: 'broadcast.getNextOnAir',
    actor: player,
    params: { sport: mode === 'both' ? null : mode, team },
  }).catch(() => null);

  const code = CODES[game?.sport] || null;
  if (!game) {
    // Nothing scheduled is worth saying out loud when you've pinned a club —
    // otherwise the card just goes quiet rather than nagging about an empty grid.
    if (!team) return null;
    return {
      id: 'sports', title: 'Next on TV', kind: 'lines',
      lines: [{ text: team, sub: 'not scheduled' }],
    };
  }

  const scored = game.live || game.final;
  const vs = `${game.awayAbbr} @ ${game.homeAbbr}`;
  return {
    id: 'sports',
    title: `${code?.icon || '🏆'} ${game.live ? 'Live' : 'Next on TV'}`,
    kind: 'stat',
    icon: null,
    // Live: the scoreline is the headline. Upcoming: the matchup is.
    big: scored ? `${game.awayScore}–${game.homeScore}` : vs,
    sub: scored ? vs : (code?.tab || game.sport),
    note: [game.status, game.channel != null ? `CH ${game.channel}` : null].filter(Boolean).join(' · '),
    tone: game.live ? 'warn' : null,
  };
}

// Settings + follow live on the screens themselves: the league screen carries the
// widget mode, a club's card carries Follow/Unfollow. Both are one flag write and
// a re-render — no new verb, no new screen.
// Both controls encode everything they need in the action id — which is safe
// because the ids are single lowercase tokens. A club NAME could never travel that
// way (the tokenizer splits on whitespace and lowercases), so Follow reads the
// club out of `params`, which the detail view fills from the screen's own id, and
// resolves its real spelling off the table.
async function handleAction(player, actionId, params) {
  const [kind, codeId, arg] = String(actionId || '').split(':');
  const code = CODES[codeId] || CODES.baseball;
  if (kind === 'widget') {
    await setFlag('player', 'sports_widget', WIDGET_MODES.includes(arg) ? arg : 'both', player);
    return leagueScreen(player, code);
  }
  if (kind === 'follow') {
    const standings = await dispatchAction({ type: 'sportsleague.getStandings', actor: player, params: { sport: code.id } }).catch(() => null);
    const team = resolveTeam(standings?.rows || [], params || '');
    const cur = await followedTeam(player);
    await setFlag('player', 'sports_follow_team', cur === team ? 'none' : team, player);
    return teamScreen(player, code, team);
  }
  return leagueScreen(player, code);
}

// ── `follow` — pick a club, by typing ────────────────────────────────────────
// `standings`/`cup`/`champions` already read the league out loud, but the
// `sports_follow_team` flag was written in exactly one place: this app's Follow
// button. So a text player could read the table and never take a side.
export async function cmdFollow(args, raw, player) {
  const want = args.join(' ').trim();
  const cur = await followedTeam(player);

  if (!want) {
    return {
      type: 'output',
      message: cur && cur !== 'none'
        ? `You follow <b>${cur}</b>. <span class="text-dim">"follow none" to stop.</span>`
        : 'You follow nobody. <span class="text-dim">"follow &lt;club&gt;": see "standings" for the table.</span>',
    };
  }
  if (/^(none|nobody|off)$/i.test(want)) {
    await setFlag('player', 'sports_follow_team', 'none', player);
    return { type: 'output', message: cur && cur !== 'none' ? `You stop following ${cur}.` : 'You already follow nobody.' };
  }

  // Resolve against the real standings so the stored spelling is the club's own,
  // not whatever case the player typed — the widget renders the flag verbatim.
  for (const code of Object.values(CODES)) {
    const standings = await dispatchAction({ type: 'sportsleague.getStandings', actor: player, params: { sport: code.id } }).catch(() => null);
    const rows = standings?.rows || [];
    const exact = rows.find(r => String(r.team).toLowerCase() === want.toLowerCase());
    const near = exact || rows.find(r => String(r.team).toLowerCase().startsWith(want.toLowerCase()))
      || rows.find(r => String(r.team).toLowerCase().includes(want.toLowerCase()));
    if (near) {
      await setFlag('player', 'sports_follow_team', near.team, player);
      return { type: 'output', message: `<span class="msg-system">You follow <b>${near.team}</b>. Their results will find you.</span>` };
    }
  }
  return { type: 'error', message: `No club by that name. "standings" lists them.` };
}

registerTabletApp({
  id: 'sports', name: 'Sports', icon: '⚾', category: 'General',
  verbs: ['standings', 'support'],
  buildHome, buildScreen, buildWidget, handleAction,
});
