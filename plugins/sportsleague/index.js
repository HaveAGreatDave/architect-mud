// Leagues for the sports broadcasts: standings + seasons + a championship game.
//
// ONE LEAGUE PER SPORT. This started as "the baseball league for DEADBALL" and every
// function assumed it. Cluster Puck made that assumption wrong rather than incomplete:
// a hockey club would have appeared in Deadball's table, the CPhL could never crown
// anything, and the World Series would have seeded two ballclubs into a hockey sim.
// So `sport` is now threaded through the season row, both caches, every command and
// both read seams, and LEAGUES below is the only place that knows a sport exists.
//
// ZERO-WRITE STANDINGS. The broadcast plugin runs one deterministic game per hour on a
// global clock — every game's result is a pure function of its slot, the same on every
// server and every TV. So the standings aren't stored row-by-row; they're a *computed
// fold* over the schedule for the current season's slot window (broadcast.computeStandings),
// cached here and recomputed only when a game completes. No `sports_game`/staging rows,
// no per-game upserts — the league advances on the clock with nobody watching and with
// essentially no DB traffic. WHAT a game folds into is the sport's business, not this
// plugin's: see `SEASON` in plugins/broadcast/sports/<name>.js.
//
// Seasons still run SPORTS_SEASON_DAYS in-game days; at season's end the top two teams
// meet in a single championship game. The "reset" is just a pointer: the new season's
// `start_slot` moves forward, so its computed window starts fresh. Only `sports_season`
// is persisted — a handful of writes per season, never per game.
// Commands: `standings`, `worldseries`, `cup`, `champions`.
import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { schedule } from '../../server/engine/scheduler.js';
import { hasActivePlayers } from '../../server/engine/world.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

// A season runs SPORTS_SEASON_DAYS in-game days (~a month by default). When that many
// in-game days have elapsed (and enough games have been played), the top two teams meet
// in a single championship game; the winner is crowned, the standings window rolls
// forward, and the next season opens. Tune SPORTS_SEASON_DAYS up if the in-game clock
// makes seasons feel too short, down if they drag. Min-games guard stops a fast clock
// from seeding a final off a thin sample.
const SPORTS_SEASON_DAYS = 30;   // in-game days per season
const SPORTS_MIN_WS_GAMES = 8;   // the #2 team must have played at least this many

// ── the leagues ──────────────────────────────────────────────────────────────
// Presentation only — how each league names itself and prints its table. The STATS come
// from the sport module's `SEASON` fold; this decides what the columns are called and
// which of them are worth showing a player.
const LEAGUES = {
  baseball: {
    sport: 'baseball', icon: '⚾', show: 'DEADBALL', league: 'COLDWATER LEAGUE',
    final: 'WORLD SERIES', finalTitle: 'World Series', finalCmd: 'worldseries',
    empty: 'No baseball games have been played yet — the DEADBALL standings are empty.',
    head: '  W   L    PCT   RDIF',
    cells: (r) => {
      const games = r.wins + r.losses;
      const pctRaw = games ? r.wins / games : 0;
      const pct = games ? (pctRaw >= 1 ? '1.000' : pctRaw.toFixed(3).replace(/^0/, '')) : '.000';
      const rd = (r.runs_for || 0) - (r.runs_against || 0);
      return `${String(r.wins).padStart(3)} ${String(r.losses).padStart(3)}  ${pct.padStart(5)}  ${((rd > 0 ? '+' : '') + rd).padStart(4)}`;
    },
    // Games played, for the "has the runner-up played enough" guard.
    played: (r) => (r.wins || 0) + (r.losses || 0),
  },
  hockey: {
    sport: 'hockey', icon: '🏒', show: 'CLUSTER PUCK', league: 'CPhL',
    final: 'COLDWATER CUP', finalTitle: 'Coldwater Cup', finalCmd: 'cup',
    empty: 'The CPhL has not dropped a puck yet — the Cluster Puck standings are empty.',
    head: '  W   L  OTL   PTS     GD',
    cells: (r) => {
      const gd = (r.goals_for || 0) - (r.goals_against || 0);
      return `${String(r.wins).padStart(3)} ${String(r.losses).padStart(3)} ${String(r.otl || 0).padStart(4)} ` +
        `${String(r.points || 0).padStart(5)} ${((gd > 0 ? '+' : '') + gd).padStart(6)}`;
    },
    played: (r) => (r.wins || 0) + (r.losses || 0) + (r.otl || 0),
  },
};
const leagueOf = (sport) => LEAGUES[sport] || LEAGUES.baseball;

// Which sports actually have a broadcast to schedule. Asking rather than assuming keeps
// this from opening a season for a league whose show doesn't exist — a CPhL table on a
// server that never imported Cluster Puck would be an empty table with a proud heading.
let _sportsList = { ts: 0, ids: ['baseball'] };
const SPORTS_LIST_TTL_MS = 120_000;
async function activeSports() {
  if (Date.now() - _sportsList.ts < SPORTS_LIST_TTL_MS) return _sportsList.ids;
  const res = await dispatchAction({ type: 'broadcast.getSports' }).catch(() => null);
  const ids = Array.isArray(res?.sports) ? res.sports.filter((s) => LEAGUES[s]) : null;
  _sportsList = { ts: Date.now(), ids: (ids && ids.length) ? ids : _sportsList.ids };
  return _sportsList.ids;
}

// ── The global clock (owned by broadcast) ────────────────────────────────────
// Which hour-slot are we in? Seasons + the standings window are bounded by slots.
// { slot, ready }. `ready` is false until the in-game clock has loaded — while not ready
// the slot is a boot placeholder, so we must NOT persist it as a season anchor (it would
// mismatch the real slot once the date loads). Callers that only need a read (standings
// window end) can use the placeholder; anchoring waits for ready.
async function currentSlot() {
  const res = await dispatchAction({ type: 'broadcast.getSportsClock' }).catch(() => null);
  return {
    slot: Number.isFinite(res?.slot) ? res.slot : 0,
    gamesPerDay: Number.isFinite(res?.gamesPerDay) ? res.gamesPerDay : 8,
    ready: !!res?.ready,
  };
}

// ── Season lifecycle ───────────────────────────────────────────────────────────

// Current in-game date 'YYYY-MM-DD' (null if the clock isn't ready), its month, and a
// UTC day-count for arithmetic. The season clock counts in-game days between dates.
function gameDate() {
  const d = getEnvironmentState()?.date;
  return (typeof d === 'string' && d.length >= 10) ? d.slice(0, 10) : null;
}
function gameMonth() {
  const d = gameDate();
  return d ? d.slice(0, 7) : '0000-00';
}
function toDayNumber(s) {
  const t = s ? Date.parse(`${s}T00:00:00Z`) : NaN;
  return Number.isNaN(t) ? null : Math.floor(t / 86400000);
}
// Whole days from one 'YYYY-MM-DD' to another (pure; null if either is unparseable).
function daysBetween(fromStr, toStr) {
  const a = toDayNumber(fromStr), b = toDayNumber(toStr);
  return (a === null || b === null) ? null : (b - a);
}
// In-game days elapsed since `fromDate`, or null if either date is unknown.
function daysElapsed(fromDate) {
  return daysBetween(fromDate, gameDate());
}

// The active season row for a sport (the one not yet complete), or null. Highest
// season_no wins.
//
// Cached PER SPORT: this is read from seven places, several of them on scheduled ticks,
// and a season row changes phase perhaps twice in its whole life (days apart). Every
// writer of sports_season lives in this file and drops the cache, so the TTL is only a
// backstop against a hand-edit through the dev panel.
const _seasonCaches = new Map();   // sport -> { ts, row }
const SEASON_TTL_MS = 30_000;
function invalidateSeason(sport) { _seasonCaches.delete(sport); }

async function currentSeason(sport) {
  const hit = _seasonCaches.get(sport);
  if (hit && Date.now() - hit.ts < SEASON_TTL_MS) return hit.row;
  const { rows } = await query(
    `SELECT * FROM sports_season WHERE sport = $1 AND phase <> 'complete' ORDER BY season_no DESC LIMIT 1`,
    [sport],
  ).catch(() => ({ rows: null }));
  if (!rows) return hit ? hit.row : null;   // a failed read keeps the last good answer
  _seasonCaches.set(sport, { ts: Date.now(), row: rows[0] || null });
  return rows[0] || null;
}

// Open a fresh regular-season row if none is active. The season's `start_slot` anchors
// its standings window: games from this slot forward count toward it. Season numbers run
// per sport, so both leagues have a Season 1.
async function ensureSeason(sport) {
  const active = await currentSeason(sport);
  if (active) return active;
  const { rows } = await query(
    `SELECT COALESCE(MAX(season_no), 0) + 1 AS n FROM sports_season WHERE sport = $1`, [sport],
  ).catch(() => ({ rows: [{ n: 1 }] }));
  const n = rows[0]?.n || 1;
  const { slot, ready } = await currentSlot();
  await query(
    `INSERT INTO sports_season (sport, season_no, start_month, start_date, start_slot, phase)
     VALUES ($1, $2, $3, $4, $5, 'regular')
     ON CONFLICT (sport, season_no) DO NOTHING`,
    [sport, n, gameMonth(), gameDate(), ready ? slot : null],   // anchor only once the clock is live
  ).catch((e) => console.error('[sportsleague] ensureSeason error:', e.message));
  invalidateSeason(sport);
  return currentSeason(sport);
}

// Seed the championship: the top two teams (needs a real sample). It airs at the NEXT
// nightly airtime slot (ws_slot) — the same fixed time the regular game airs, so it's a
// scheduled marquee event, not a random hour — and the regular standings freeze at that
// boundary. Returns the updated season row, or null if it couldn't seed.
async function seedFinal(sport, season) {
  const L = leagueOf(sport);
  const table = await queryStandings(sport);
  if (table.length < 2) return null;
  const [a, b] = table;
  if (L.played(b) < SPORTS_MIN_WS_GAMES) return null;           // guard: #2 must have played enough
  const clock = await currentSlot();
  if (!clock.ready) return null;                                // don't seed off a boot-placeholder slot
  // Pin the final to the next featured airtime slot (falls back to next slot if the
  // league airs continuously), so it lands at the advertised nightly time.
  const air = await dispatchAction({ type: 'broadcast.nextSportsAirSlot', params: { after: clock.slot, sport } }).catch(() => null);
  const wsSlot = Number.isFinite(air?.slot) ? air.slot : clock.slot + 1;
  const airHour = Number.isFinite(air?.hour) ? air.hour : null;
  await query(
    `UPDATE sports_season SET phase = 'worldseries', finalist_a = $1, finalist_b = $2, ws_slot = $3
      WHERE sport = $4 AND season_no = $5`,
    [a.team, b.team, wsSlot, sport, season.season_no],
  ).catch((e) => console.error('[sportsleague] seed error:', e.message));
  invalidateSeason(sport);
  _standCaches.delete(sport);   // freeze the window at ws_slot now
  // Advertise WHEN it airs so the news app + TV guide can state the time.
  const gpd = clock.gamesPerDay || 8;
  const dayNow = Math.floor(clock.slot / gpd), dayWs = Math.floor(wsSlot / gpd);
  const when = dayWs <= dayNow ? 'tonight' : (dayWs === dayNow + 1 ? 'tomorrow night' : `in ${dayWs - dayNow} nights`);
  emit('sports.worldseries', { sport, seasonNo: season.season_no, teams: [a.team, b.team], wsSlot, airHour, when });
  console.log(`[sportsleague] ${L.final} seeded (${sport} season ${season.season_no}): ${a.team} vs ${b.team} @ slot ${wsSlot} (${when}${airHour != null ? `, ${airHour}:00` : ''})`);
  return { ...season, phase: 'worldseries', finalist_a: a.team, finalist_b: b.team, ws_slot: wsSlot };
}

// The championship slot has aired — crown the winner from that game's (deterministic)
// result, close the season (champions history), and open the next season, whose
// start_slot lands past the final's slot so the new window is clean.
async function crownChampion(sport, season) {
  const L = leagueOf(sport);
  const g = await dispatchAction({
    type: 'broadcast.getSlotResult',
    params: { slot: Number(season.ws_slot), teams: [season.finalist_a, season.finalist_b], sport },
  }).catch(() => null);
  if (!g || !g.winner) return;
  const winner = g.winner, loser = winner === g.away ? g.home : g.away;
  const champScore = winner === g.away ? g.awayScore : g.homeScore;
  const runScore = winner === g.away ? g.homeScore : g.awayScore;
  await query(
    `UPDATE sports_season SET phase = 'complete', champion = $1, runner_up = $2,
       champ_score = $3, runner_score = $4, decided_at = NOW() WHERE sport = $5 AND season_no = $6`,
    [winner, loser, champScore, runScore, sport, season.season_no],
  ).catch((e) => console.error('[sportsleague] crown error:', e.message));
  invalidateSeason(sport);
  _standCaches.delete(sport);
  await ensureSeason(sport);   // opens the next season with start_slot = now (past ws_slot)
  emit('sports.champion', { sport, seasonNo: season.season_no, champion: winner, runnerUp: loser, champScore, runScore, overtime: !!g.overtime });
  console.log(`[sportsleague] ${L.final} CHAMPION (${sport} season ${season.season_no}): ${winner} beat ${loser} ${champScore}-${runScore}`);
}

// ── Standings (computed, cached) ────────────────────────────────────────────────

// The league table for a sport's current season, folded from the deterministic schedule
// by the broadcast plugin. Cached on (season, window-end) so it recomputes only when a
// game completes (the slot advances) or the season rolls — not on every read. `extras`
// carries whatever else that sport's fold harvests (hockey's scoring race and its
// casualty count); baseball's is simply empty.
const _standCaches = new Map();   // sport -> { key, rows, extras }
async function queryStandings(sport) {
  const s = await currentSeason(sport);
  const { slot, gamesPerDay } = await currentSlot();
  // BIGINT columns come back as strings from node-pg — coerce before use.
  const startRaw = s?.start_slot != null ? Number(s.start_slot) : slot;
  const endSlot = (s?.phase === 'worldseries' && s?.ws_slot != null) ? Number(s.ws_slot) : slot;
  // Guardrail: a season can never span more than its own length (one game/team/day).
  // If the roller ever stalls and the anchor goes stale, show the most recent
  // season-length window rather than folding tens of thousands of games.
  const maxWindow = SPORTS_SEASON_DAYS * (gamesPerDay || 8);
  const startSlot = (endSlot - startRaw > maxWindow) ? endSlot - maxWindow : startRaw;
  const key = `${s?.season_no || 0}:${startSlot}:${endSlot}`;
  const hit = _standCaches.get(sport);
  if (!hit || hit.key !== key) {
    const res = await dispatchAction({ type: 'broadcast.computeStandings', params: { startSlot, endSlot, sport } }).catch(() => null);
    _standCaches.set(sport, {
      key,
      rows: Array.isArray(res?.rows) ? res.rows : [],
      extras: { scorers: res?.scorers || [], injuries: res?.injuries || 0, deaths: res?.deaths || 0 },
    });
  }
  return _standCaches.get(sport).rows;
}
async function queryExtras(sport) {
  await queryStandings(sport);
  return _standCaches.get(sport)?.extras || { scorers: [], injuries: 0, deaths: 0 };
}

// Pure formatter — a monospace league table. Rows are pre-sorted by the sport's fold,
// and the sport's league config supplies the column head + the cells.
function formatStandings(rows, sport = 'baseball') {
  const L = leagueOf(sport);
  if (!rows.length) return L.empty;
  const nameW = Math.min(28, Math.max(12, ...rows.map((r) => r.team.length)));
  const head = `  #  ${'TEAM'.padEnd(nameW)} ${L.head}`;
  const sep = '  ' + '─'.repeat(head.length - 2);
  const lines = rows.map((r, i) => ` ${String(i + 1).padStart(2)}  ${r.team.padEnd(nameW)} ${L.cells(r)}`);
  return [`${L.icon} ${L.show} — ${L.league} STANDINGS`, head, sep, ...lines].join('\n');
}

// The scoring race + the butcher's bill. Only leagues whose fold harvests them have
// anything to print, which today is hockey — the one sport where a season costs lives.
function formatExtras(extras, sport) {
  if (sport !== 'hockey' || !extras) return '';
  const out = [];
  if (extras.scorers?.length) {
    out.push('', '  SCORING RACE            G    A   PTS');
    for (const s of extras.scorers.slice(0, 5)) {
      out.push(`  ${String(s.name).padEnd(20)} ${String(s.goals).padStart(3)} ${String(s.assists).padStart(4)} ${String(s.points).padStart(5)}`);
    }
  }
  if (extras.injuries) {
    out.push('', `  Season casualties: ${extras.injuries} carried off` +
      (extras.deaths ? `, ${extras.deaths} of them permanently.` : '.'));
  }
  return out.join('\n');
}

// The most recent crowned champion for a sport (for the standings header / trophy line).
async function lastChampion(sport) {
  const { rows } = await query(
    `SELECT season_no, champion, runner_up, champ_score, runner_score
       FROM sports_season WHERE sport = $1 AND champion IS NOT NULL ORDER BY season_no DESC LIMIT 1`,
    [sport],
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function seasonHeaderLines(sport) {
  const L = leagueOf(sport);
  const s = await currentSeason(sport);
  const champ = await lastChampion(sport);
  const lines = [];
  if (s?.phase === 'worldseries' && s.finalist_a) lines.push(`Season ${s.season_no} · ${L.icon} ${L.final} — ${s.finalist_a} vs ${s.finalist_b}`);
  else lines.push(`Season ${s?.season_no || 1} · regular season`);
  if (champ) lines.push(`Reigning champ: ${champ.champion} (S${champ.season_no})`);
  return lines;
}

// `standings [sport]` — one league, or every league with a show on the air.
async function cmdStandings(args) {
  const want = String(args?.[0] || '').toLowerCase();
  const sports = LEAGUES[want] ? [want] : await activeSports();
  const blocks = [];
  for (const sport of sports) {
    const header = await seasonHeaderLines(sport);
    const rows = await queryStandings(sport);
    const extras = await queryExtras(sport);
    blocks.push([...header, '', formatStandings(rows, sport), formatExtras(extras, sport)].filter(Boolean).join('\n'));
  }
  return { type: 'output', message: blocks.join('\n\n') };
}

function formatChampions(rows, sport = 'baseball') {
  const L = leagueOf(sport);
  if (!rows.length) return `No ${L.finalTitle} has been played yet — the trophy case is empty.`;
  const lines = rows.map((r) => ` S${String(r.season_no).padStart(2)}  🏆 ${r.champion}  (def. ${r.runner_up} ${r.champ_score}-${r.runner_score})`);
  return [`${L.icon} ${L.show} — ${L.final} CHAMPIONS`, ...lines].join('\n');
}

async function cmdChampions(args) {
  const want = String(args?.[0] || '').toLowerCase();
  const sports = LEAGUES[want] ? [want] : await activeSports();
  const blocks = [];
  for (const sport of sports) {
    const { rows } = await query(
      `SELECT season_no, champion, runner_up, champ_score, runner_score
         FROM sports_season WHERE sport = $1 AND champion IS NOT NULL ORDER BY season_no DESC LIMIT 15`,
      [sport],
    ).catch(() => ({ rows: [] }));
    blocks.push(formatChampions(rows, sport));
  }
  return { type: 'output', message: blocks.join('\n\n') };
}

// The championship status command, one per league (`worldseries`, `cup`). Everyone sees
// the current final / season status + reigning champion; a dev/admin can `<cmd> start`
// to force-seed it now (for testing without waiting for the in-game month to roll).
async function cmdFinal(sport, args, raw, player) {
  const L = leagueOf(sport);
  const isDev = player?.role === 'admin' || player?.role === 'dev';
  if (String(args?.[0] || '').toLowerCase() === 'start' && isDev) {
    const s = await ensureSeason(sport);
    if (!s) return { type: 'error', message: `No ${L.show} season is open yet.` };
    if (s.phase !== 'regular') return { type: 'error', message: `A ${L.finalTitle} is already set or underway.` };
    const seeded = await seedFinal(sport, s);
    if (!seeded) return { type: 'error', message: `Can't seed yet — need 2+ teams with the runner-up at ${SPORTS_MIN_WS_GAMES}+ games played.` };
    return { type: 'output', message: `${L.icon} ${L.final} forced: ${seeded.finalist_a} vs ${seeded.finalist_b}. It airs at the top of the hour.` };
  }
  const s = await currentSeason(sport);
  const champ = await lastChampion(sport);
  const out = [];
  if (s?.phase === 'worldseries') out.push(`${L.icon} ${L.final} is ON — ${s.finalist_a} vs ${s.finalist_b} (Season ${s.season_no}). Winner takes all.`);
  else {
    const day = s?.start_date ? daysElapsed(s.start_date) : null;
    const prog = (day !== null) ? ` — day ${Math.max(0, day) + 1} of ${SPORTS_SEASON_DAYS}` : '';
    out.push(`Season ${s?.season_no || 1}: regular season${prog}. The top two meet in the ${L.finalTitle} when the season ends.`);
  }
  if (champ) out.push(`Reigning champion: ${champ.champion} — beat ${champ.runner_up} ${champ.champ_score}-${champ.runner_score} (Season ${champ.season_no}).`);
  if (isDev && (!s || s.phase === 'regular')) out.push(`(dev: "${L.finalCmd} start" to force it now.)`);
  return { type: 'output', message: out.join('\n') };
}

// Cross-plugin read seam: the broadcast + tablet plugins dispatch these to drive the
// on-air standings bug, pre-game record mentions, and the championship takeover. Meeting
// through an Action keeps them from reaching into this plugin's table directly. Both take
// an optional `sport` and default to baseball, so every existing caller is unchanged.
registerAction({
  type: 'sportsleague.getStandings',
  handler: async ({ params = {} } = {}) => {
    const sport = LEAGUES[params.sport] ? params.sport : 'baseball';
    return { sport, rows: await queryStandings(sport), ...(await queryExtras(sport)) };
  },
});
registerAction({
  type: 'sportsleague.getSeason',
  handler: async ({ params = {} } = {}) => {
    const sport = LEAGUES[params.sport] ? params.sport : 'baseball';
    const s = await currentSeason(sport);
    return {
      sport,
      seasonNo: s?.season_no || null,
      phase: s?.phase || 'regular',
      finalistA: s?.finalist_a || null,
      finalistB: s?.finalist_b || null,
      wsSlot: s?.ws_slot != null ? Number(s.ws_slot) : null,
      // The window the season's computed fold starts at. Broadcast anchors its injury
      // chain to the same slot so the aired games and the table walk one history.
      startSlot: s?.start_slot != null ? Number(s.start_slot) : null,
    };
  },
});

// Season clock: once a minute, for every league with a show on the air, keep a season
// open, seed the championship when the season has run its course, and crown the winner
// once its slot has aired.
async function seasonTickFor(sport) {
  const s = await ensureSeason(sport);
  if (!s) return;
  if (s.phase === 'worldseries') {
    const ws = s.ws_slot != null ? Number(s.ws_slot) : null;
    const c = await currentSlot();
    if (ws != null && c.ready && c.slot > ws) await crownChampion(sport, s);
    return;
  }
  if (s.phase !== 'regular') return;
  // Backfill the anchors if the world clock / slot wasn't ready when the season opened.
  if (!s.start_date || s.start_slot == null) {
    const c = await currentSlot();
    if (!c.ready) return;                     // wait for the in-game clock before anchoring
    await query(
      `UPDATE sports_season SET start_date = COALESCE(start_date, $1), start_month = COALESCE(NULLIF(start_month,'0000-00'), $2), start_slot = COALESCE(start_slot, $3)
        WHERE sport = $4 AND season_no = $5`,
      [gameDate(), gameMonth(), c.slot, sport, s.season_no],
    ).catch(() => {});
    invalidateSeason(sport);
    return;
  }
  // End the season by SLOTS elapsed — the same axis the standings fold uses — so the
  // roll can never drift from the window. (Measuring off start_date left the season
  // stranded in 'regular' whenever the date math failed, letting the window balloon.)
  const c = await currentSlot();
  const seasonSlots = SPORTS_SEASON_DAYS * (c.gamesPerDay || 8);
  if (c.ready && (c.slot - Number(s.start_slot)) >= seasonSlots) await seedFinal(sport, s);
}
async function seasonTick() {
  for (const sport of await activeSports()) {
    await seasonTickFor(sport).catch((e) => console.error(`[sportsleague] ${sport} season tick error:`, e.message));
  }
}
// Idle-gated: every phase transition derives from the game clock (slots
// elapsed), so skipping ticks while nobody is online just means the first tick
// after a login catches the season up — no DB reads on an empty server.
schedule('1m', () => { if (hasActivePlayers()) return seasonTick(); });
setTimeout(() => seasonTick().catch((e) => console.error('[sportsleague] boot season error:', e.message)), 8000);

export const commands = {
  standings: (args) => cmdStandings(args),
  worldseries: (args, raw, player) => cmdFinal('baseball', args, raw, player),
  cup: (args, raw, player) => cmdFinal('hockey', args, raw, player),
  champions: (args) => cmdChampions(args),
};

export const _test = { formatStandings, formatChampions, formatExtras, daysBetween, LEAGUES };

console.log('[sportsleague] Plugin loaded.');
