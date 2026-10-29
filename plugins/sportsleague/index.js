// Leagues for the sports broadcasts: standings + seasons + a championship game.
//
// ONE LEAGUE PER SPORT. This started as "the baseball league for DEADBALL" and every
// function assumed it. Cluster Puck made that assumption wrong rather than incomplete:
// a hockey club would have appeared in Deadball's table, the CPhL could never crown
// anything, and Deadball's final would have seeded two ballclubs into a hockey sim.
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
// A season is the in-game calendar month. Every club plays every day (the slate, in
// plugins/broadcast), and on the month's last day, Cup day, the top two meet in a single
// championship game. The "reset" is just a pointer: the new season's `start_slot` is the
// first slot of the next month, so its computed window starts fresh. Only `sports_season`
// is persisted — a handful of writes per season, never per game.
// Commands: `standings`, `curtaincall`, `cup`, `champions`.
import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { schedule } from '../../server/engine/scheduler.js';
import { hasActivePlayers } from '../../server/engine/world.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

// The month's days, its Cup day and the final's slot come from broadcast's slate, which
// owns the calendar (`broadcast.getSeasonCalendar`). The min-games guard stops a final
// being seeded off a thin sample; a season that can't seed one by its final's slot
// closes with no champion.
const SPORTS_MAX_SEASON_DAYS = 31;
const SPORTS_MIN_WS_GAMES = 8;   // the #2 team must have played at least this many

// ── the leagues ──────────────────────────────────────────────────────────────
// Presentation only — how each league names itself and prints its table. The STATS come
// from the sport module's `SEASON` fold; this decides what the columns are called and
// which of them are worth showing a player.
//
// …and `era`, which is not presentation. It names the roster a league is playing with. A
// season records the era it opened in, and when the two differ the season tick closes the
// open season with no champion and opens a fresh one (`staleEra`, below). So a new roster
// starts at 0-0 on the deploy that ships it, and a final already seeded with clubs that no
// longer exist never airs. Change the era only when the roster changes; a league with none
// is never reset this way.
const LEAGUES = {
  baseball: {
    sport: 'baseball', icon: '⚾', show: 'DEADBALL', league: 'COLDWATER LEAGUE',
    // Eight clubs, the Blue Birds and the Crows among them (docs/systems-broadcast.md, Deadball's
    // clubs), October 2026. The sixteen before had no era.
    // 'deadball-8-slate' from the daily slate (docs/proposals/daily-slate.md), which changed
    // every matchup, so the season open at the cutover closes uncrowned.
    // 'deadball-rosters' from sim v3 (October 2026): clubs keep thirteen men a season, so
    // the season the squads arrived in closes uncrowned too and they start at 0-0.
    era: 'deadball-rosters',
    // the final is the Curtain Call (the season's last act, under the city's wall); its phase
    // in sports_season is still 'worldseries', a value, not a name anyone reads
    final: 'CURTAIN CALL', finalTitle: 'Curtain Call', finalCmd: 'curtaincall', start: 'First Pitch',
    empty: 'No baseball games have been played yet. The DEADBALL standings are empty.',
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
    // The eight neighbourhood clubs (docs/systems-broadcast.md, the clubs table), October 2026.
    // 'cphl-8-slate' from the daily slate, as Deadball's.
    era: 'cphl-8-slate',
    final: 'COLDWATER CUP', finalTitle: 'Coldwater Cup', finalCmd: 'cup', start: 'Puck Drop',
    empty: "The CPhL hasn't dropped a puck yet. The Cluster Puck standings are empty.",
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
// broadcast answers from RAM (its channel runtime, else its cached sports library), so
// the TTL only spares the dispatch; it doesn't stand between the tick and the database.
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

// The season calendar for a sport around a slot: the month's days, Cup day, the final's
// slot and where the next season starts. Pure on broadcast's side, so no round trip.
async function calendar(sport, slot) {
  return dispatchAction({ type: 'broadcast.getSeasonCalendar', params: { sport, slot } }).catch(() => null);
}

// ── Season lifecycle ───────────────────────────────────────────────────────────

// Current in-game date 'YYYY-MM-DD' (null if the clock isn't ready) and its month, for a
// season row opened before the calendar can answer.
function gameDate() {
  const d = getEnvironmentState()?.date;
  return (typeof d === 'string' && d.length >= 10) ? d.slice(0, 10) : null;
}
function gameMonth() {
  const d = gameDate();
  return d ? d.slice(0, 7) : '0000-00';
}

// The active season row for a sport (the one not yet complete), or null. Highest
// season_no wins.
//
// Cached PER SPORT, with no expiry: this is read from seven places, several of them on
// scheduled ticks, and a season row changes phase perhaps twice in its whole life (days
// apart). Every writer of sports_season lives in this file and drops the cache. Nothing
// else writes the table (it's a runtime table, so the dev panel, the content import and
// the backups never touch its rows). The old 30s TTL was shorter than the 1-minute
// season tick, so it re-read the row on every tick. A hand edit in psql needs a restart.
//
// Invalidating marks the entry stale rather than deleting it, so a failed re-read can
// still answer with the last good row. `gen` matters now there's no expiry: a read
// that was in flight across a write must not store what it saw before the write, or
// that answer would stand until the next write (and a stale null here would make
// ensureSeason open a second season).
const _seasonCaches = new Map();   // sport -> { row, fresh }
let _seasonGen = 0;
function invalidateSeason(sport) {
  _seasonGen++;
  const hit = _seasonCaches.get(sport);
  if (hit) hit.fresh = false;
}

async function currentSeason(sport) {
  const hit = _seasonCaches.get(sport);
  if (hit?.fresh) return hit.row;
  const gen = _seasonGen;
  const { rows } = await query(
    `SELECT * FROM sports_season WHERE sport = $1 AND phase <> 'complete' ORDER BY season_no DESC LIMIT 1`,
    [sport],
  ).catch(() => ({ rows: null }));
  if (!rows) return hit ? hit.row : null;   // a failed read keeps the last good answer
  const row = rows[0] || null;
  _seasonCaches.set(sport, { row, fresh: gen === _seasonGen });
  return row;
}

// Open a fresh regular-season row if none is active. The season's `start_slot` anchors
// its standings window: games from this slot forward count toward it. It's the first slot
// of the month, or of the next month on Cup day. Season numbers run per sport, so both
// leagues have a Season 1.
async function ensureSeason(sport) {
  const active = await currentSeason(sport);
  if (active) return active;
  const { rows } = await query(
    `SELECT COALESCE(MAX(season_no), 0) + 1 AS n FROM sports_season WHERE sport = $1`, [sport],
  ).catch(() => ({ rows: [{ n: 1 }] }));
  const n = rows[0]?.n || 1;
  const { slot, ready } = await currentSlot();
  const cal = ready ? await calendar(sport, slot) : null;   // anchor only once the clock is live
  const startDate = cal?.seasonStartDate || gameDate();
  await query(
    `INSERT INTO sports_season (sport, season_no, start_month, start_date, start_slot, phase, era)
     VALUES ($1, $2, $3, $4, $5, 'regular', $6)
     ON CONFLICT (sport, season_no) DO NOTHING`,
    [sport, n, startDate ? startDate.slice(0, 7) : gameMonth(), startDate, cal ? cal.seasonStartSlot : null, leagueOf(sport).era || null],
  ).catch((e) => console.error('[sportsleague] ensureSeason error:', e.message));
  invalidateSeason(sport);
  return currentSeason(sport);
}

// Seed the championship: the top two teams (needs a real sample), playing in `wsSlot`,
// the sport's last slot on Cup day (or the next slot, when staff force it). The regular
// standings freeze at that slot. Returns the updated season row, or null if it couldn't
// seed.
async function seedFinal(sport, season, wsSlot) {
  const L = leagueOf(sport);
  if (!Number.isFinite(wsSlot)) return null;
  const table = await queryStandings(sport);
  if (table.length < 2) return null;
  const [a, b] = table;
  if (L.played(b) < SPORTS_MIN_WS_GAMES) return null;           // guard: #2 must have played enough
  const clock = await currentSlot();
  if (!clock.ready) return null;                                // don't seed off a boot-placeholder slot
  const gpd = clock.gamesPerDay || 8;
  const airHour = (((wsSlot % gpd) + gpd) % gpd) * (24 / gpd);
  await query(
    `UPDATE sports_season SET phase = 'worldseries', finalist_a = $1, finalist_b = $2, ws_slot = $3
      WHERE sport = $4 AND season_no = $5`,
    [a.team, b.team, wsSlot, sport, season.season_no],
  ).catch((e) => console.error('[sportsleague] seed error:', e.message));
  invalidateSeason(sport);
  _standCaches.delete(sport);   // freeze the window at ws_slot now
  // Advertise WHEN it airs so the news app + TV guide can state the time. A final seeded
  // late, after its slot (nobody was online on Cup day), is crowned on the next tick and
  // isn't news.
  const dayNow = Math.floor(clock.slot / gpd), dayWs = Math.floor(wsSlot / gpd);
  const when = dayWs <= dayNow ? 'tonight' : (dayWs === dayNow + 1 ? 'tomorrow night' : `in ${dayWs - dayNow} nights`);
  if (wsSlot >= clock.slot) emit('sports.worldseries', { sport, show: L.show, final: L.finalTitle, start: L.start, seasonNo: season.season_no, teams: [a.team, b.team], wsSlot, airHour, when });
  console.log(`[sportsleague] ${L.final} seeded (${sport} season ${season.season_no}): ${a.team} vs ${b.team} @ slot ${wsSlot} (${when}, ${airHour}:00)`);
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
  const toll = await seasonToll(sport);
  await query(
    `UPDATE sports_season SET phase = 'complete', champion = $1, runner_up = $2,
       champ_score = $3, runner_score = $4, decided_at = NOW(), toll = $7::jsonb WHERE sport = $5 AND season_no = $6`,
    [winner, loser, champScore, runScore, sport, season.season_no, toll],
  ).catch((e) => console.error('[sportsleague] crown error:', e.message));
  invalidateSeason(sport);
  _standCaches.delete(sport);
  _careers.delete(sport);
  await ensureSeason(sport);   // opens the next season with start_slot = now (past ws_slot)
  emit('sports.champion', { sport, show: L.show, final: L.finalTitle, seasonNo: season.season_no, champion: winner, runnerUp: loser, champScore, runScore, overtime: !!g.overtime });
  console.log(`[sportsleague] ${L.final} CHAMPION (${sport} season ${season.season_no}): ${winner} beat ${loser} ${champScore}-${runScore}`);
}

// Was this season opened under a roster the league has since replaced? Pure, so the
// regress suite can hold it to the rule without a database.
function staleEra(sport, season) {
  const era = leagueOf(sport).era || null;
  return !!(era && season && (season.era || null) !== era);
}

// Close a season with no champion (the champions history lists only seasons that have one)
// and open the next. Whatever phase it was in, including a final already seeded with two
// clubs that are no longer in the league.
async function closeUncrowned(sport, season, why) {
  const toll = await seasonToll(sport);
  await query(
    `UPDATE sports_season SET phase = 'complete', decided_at = NOW(), toll = $3::jsonb
      WHERE sport = $1 AND season_no = $2 AND phase <> 'complete'`,
    [sport, season.season_no, toll],
  ).catch((e) => console.error('[sportsleague] season close error:', e.message));
  invalidateSeason(sport);
  _standCaches.delete(sport);
  _careers.delete(sport);
  console.log(`[sportsleague] ${leagueOf(sport).league} season ${season.season_no} closed with no champion (${why}), a fresh one opens`);
  return ensureSeason(sport);
}
// The league's roster has changed since this season opened. The next season records the
// new era.
const closeForEra = (sport, season) => closeUncrowned(sport, season, `the league is now ${leagueOf(sport).era}`);

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
  let endSlot = (s?.phase === 'worldseries' && s?.ws_slot != null) ? Number(s.ws_slot) : slot;
  // A regular season ends at Cup day, even when nobody was online to seed its final then
  // and the clock has run on into next month's games.
  if (s?.phase === 'regular' && s?.start_slot != null) {
    const cal = await calendar(sport, startRaw);
    if (Number.isFinite(cal?.cupDayStartSlot)) endSlot = Math.min(endSlot, cal.cupDayStartSlot);
  }
  // Guardrail: a season can never span more than a month. If the roller ever stalls and
  // the anchor goes stale, show the most recent month-long window rather than folding
  // tens of thousands of games.
  const maxWindow = SPORTS_MAX_SEASON_DAYS * (gamesPerDay || 8);
  const startSlot = (endSlot - startRaw > maxWindow) ? endSlot - maxWindow : startRaw;
  const key = `${s?.season_no || 0}:${startSlot}:${endSlot}`;
  const hit = _standCaches.get(sport);
  if (!hit || hit.key !== key) {
    const res = await dispatchAction({ type: 'broadcast.computeStandings', params: { startSlot, endSlot, sport } }).catch(() => null);
    // Keep everything the sport's fold returned beside the table: hockey's scoring race
    // and injury counts, Deadball's batting, home-run and RBI races and their qualifier.
    // This kept only hockey's three, so Deadball's leaders were folded and thrown away.
    const { rows, sport: _sport, ...extras } = res || {};
    _standCaches.set(sport, {
      key,
      rows: Array.isArray(rows) ? rows : [],
      extras: { scorers: [], injuries: 0, deaths: 0, ...extras },
    });
  }
  return _standCaches.get(sport).rows;
}
async function queryExtras(sport) {
  await queryStandings(sport);
  const extras = _standCaches.get(sport)?.extras || { scorers: [], injuries: 0, deaths: 0 };
  // A sport whose fold keeps a toll also gets every man's career from the closed seasons.
  return extras.toll ? { ...extras, career: await careerToll(sport) } : extras;
}

// ── The toll: who was hurt and who died ─────────────────────────────────────────
// The open season's toll is in the fold (hockey's summariseExtras). It's written to the
// season's row once, as the season closes, and a man's career is the closed seasons
// added up. One read per league, cached until the next season closes.
async function seasonToll(sport) {
  const t = (await queryExtras(sport).catch(() => null))?.toll;
  return t && Object.keys(t).length ? JSON.stringify(t) : null;
}
const _careers = new Map();   // sport -> { toll: { name: { hurt, died } } } or { retryAt }
const CAREER_RETRY_MS = 10 * 60_000;
function addTolls(rows) {
  const sum = {};
  for (const t of rows) {
    for (const [name, v] of Object.entries(t || {})) {
      const s = sum[name] || (sum[name] = { hurt: 0, died: 0 });
      s.hurt += Number(v?.hurt) || 0; s.died += Number(v?.died) || 0;
    }
  }
  return sum;
}
async function careerToll(sport) {
  const hit = _careers.get(sport);
  if (hit?.toll) return hit.toll;
  if (hit && Date.now() < hit.retryAt) return {};
  const { rows } = await query(
    `SELECT toll FROM sports_season WHERE sport = $1 AND phase = 'complete' AND toll IS NOT NULL`, [sport],
  ).catch(() => ({ rows: null }));
  if (!rows) { _careers.set(sport, { retryAt: Date.now() + CAREER_RETRY_MS }); return {}; }
  const toll = addTolls(rows.map(r => r.toll));
  _careers.set(sport, { toll });
  return toll;
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
  return [`${L.icon} ${L.show}: ${L.league} STANDINGS`, head, sep, ...lines].join('\n');
}

// A batting average, the way a scoreboard writes one: no leading zero, three
// places. `.312`, not `0.312` — getting this wrong makes the whole table look
// like a spreadsheet instead of a sports page.
const fmtAvg = (v) => (v >= 1 ? '1.000' : (v || 0).toFixed(3).replace(/^0/, ''));

// The per-player races each league harvests. Hockey counts goals and bodies;
// baseball counts hitting. Both come out of the same season fold, so neither can
// disagree with the table above it.
function formatExtras(extras, sport) {
  if (!extras) return '';
  if (sport === 'baseball') {
    const out = [];
    // Headers are BUILT from the same widths the cells use, never hand-spaced —
    // a monospace table whose heading is three columns off its numbers is the
    // kind of thing that survives forever because it is nobody's bug.
    const NAME_W = 20;
    const race = (title, cols, rows, cells) => {
      if (!rows?.length) return;
      const head = cols.map(([label, w]) => String(label).padStart(w)).join(' ');
      out.push('', `  ${String(title).padEnd(NAME_W)} ${head}`);
      for (const r of rows) out.push(`  ${String(r.name).padEnd(NAME_W)} ${cells(r).join(' ')}`);
    };
    race('BATTING', [['AVG', 5], ['AB', 4], ['H', 4]], extras.batters,
      (r) => [fmtAvg(r.avg).padStart(5), String(r.ab).padStart(4), String(r.hits).padStart(4)]);
    race('HOME RUNS', [['HR', 4], ['RBI', 4]], extras.homers,
      (r) => [String(r.hr).padStart(4), String(r.rbi).padStart(4)]);
    race('RUNS BATTED IN', [['RBI', 4], ['HR', 4]], extras.rbis,
      (r) => [String(r.rbi).padStart(4), String(r.hr).padStart(4)]);
    race('STOLEN BASES', [['SB', 4], ['CS', 4]], extras.steals,
      (r) => [String(r.sb).padStart(4), String(r.cs).padStart(4)]);
    race('STRIKEOUTS', [['K', 4], ['W-L', 6], ['ERA', 6]], extras.strikeouts,
      (r) => [String(r.k).padStart(4), `${r.w}-${r.l}`.padStart(6), (r.era || 0).toFixed(2).padStart(6)]);
    // Say the bar. A leaderboard that quietly drops a .600 hitter for want of
    // at-bats looks broken unless it tells you why.
    if (out.length && extras.minAb) out.push('', `  Qualified: ${extras.minAb}+ at-bats.`);
    return out.join('\n');
  }
  if (sport !== 'hockey') return '';
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
  if (s?.phase === 'worldseries' && s.finalist_a) lines.push(`Season ${s.season_no} · ${L.icon} ${L.final}: ${s.finalist_a} vs ${s.finalist_b}`);
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
  if (!rows.length) return `No ${L.finalTitle} has been played yet. The trophy case is empty.`;
  const lines = rows.map((r) => ` S${String(r.season_no).padStart(2)}  🏆 ${r.champion}  (def. ${r.runner_up} ${r.champ_score}-${r.runner_score})`);
  return [`${L.icon} ${L.show}: ${L.final} CHAMPIONS`, ...lines].join('\n');
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

// The championship status command, one per league (`curtaincall`, `cup`). Everyone sees
// the current final / season status + reigning champion; a dev/admin can `<cmd> start`
// to force-seed it now (for testing without waiting for the in-game month to roll).
async function cmdFinal(sport, args, raw, player) {
  const L = leagueOf(sport);
  const isDev = player?.role === 'admin' || player?.role === 'dev';
  if (String(args?.[0] || '').toLowerCase() === 'start' && isDev) {
    const s = await ensureSeason(sport);
    if (!s) return { type: 'error', message: `No ${L.show} season is open yet.` };
    if (s.phase !== 'regular') return { type: 'error', message: `A ${L.finalTitle} is already set or underway.` };
    // Forced, it's played in the sport's next slot rather than on Cup day.
    const clock = await currentSlot();
    const cal = clock.ready ? await calendar(sport, clock.slot) : null;
    const seeded = await seedFinal(sport, s, cal?.nextSlot);
    if (!seeded) return { type: 'error', message: `Can't seed yet: need 2+ teams with the runner-up at ${SPORTS_MIN_WS_GAMES}+ games played.` };
    const gpd = clock.gamesPerDay || 8;
    const hour = String(((seeded.ws_slot % gpd) + gpd) % gpd * (24 / gpd)).padStart(2, '0');
    return { type: 'output', message: `${L.icon} ${L.final} forced: ${seeded.finalist_a} vs ${seeded.finalist_b}. It's played at ${hour}:00.` };
  }
  const s = await currentSeason(sport);
  const champ = await lastChampion(sport);
  const out = [];
  if (s?.phase === 'worldseries') out.push(`${L.icon} ${L.final} is ON: ${s.finalist_a} vs ${s.finalist_b} (Season ${s.season_no}). Winner takes all.`);
  else {
    const clock = await currentSlot();
    const cal = clock.ready ? await calendar(sport, clock.slot) : null;
    const prog = cal ? `, day ${cal.dayOfMonth} of ${cal.monthDays}` : '';
    out.push(`Season ${s?.season_no || 1}: regular season${prog}. The top two meet in the ${L.finalTitle} on the last day of the month.`);
  }
  if (champ) out.push(`Reigning champion: ${champ.champion}, beat ${champ.runner_up} ${champ.champ_score}-${champ.runner_score} (Season ${champ.season_no}).`);
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
  if (staleEra(sport, s)) { await closeForEra(sport, s); return; }
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
    const cal = await calendar(sport, c.slot);
    if (!cal) return;
    await query(
      `UPDATE sports_season SET start_date = COALESCE(start_date, $1), start_month = COALESCE(NULLIF(start_month,'0000-00'), $2), start_slot = COALESCE(start_slot, $3)
        WHERE sport = $4 AND season_no = $5`,
      [cal.seasonStartDate, cal.seasonStartDate.slice(0, 7), cal.seasonStartSlot, sport, s.season_no],
    ).catch(() => {});
    invalidateSeason(sport);
    return;
  }
  // Seed the final once Cup day of the season's month comes, measured in SLOTS, the same
  // axis the standings fold uses, so the roll can't drift from the window. A tick that
  // comes late (nobody online on Cup day) still seeds the final in its own slot, which is
  // then crowned from its deterministic result. One that can't seed by then closes the
  // season uncrowned rather than leaving it open into next month.
  const c = await currentSlot();
  if (!c.ready) return;
  const cal = await calendar(sport, Number(s.start_slot));
  if (!cal || c.slot < cal.cupDayStartSlot) return;
  const seeded = await seedFinal(sport, s, cal.finalSlot);
  if (!seeded && c.slot > cal.finalSlot) await closeUncrowned(sport, s, 'too few games for a final');
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
  curtaincall: (args, raw, player) => cmdFinal('baseball', args, raw, player),
  cup: (args, raw, player) => cmdFinal('hockey', args, raw, player),
  champions: (args) => cmdChampions(args),
};

export const _test = { formatStandings, formatChampions, formatExtras, staleEra, LEAGUES, queryExtras, addTolls };

console.log('[sportsleague] Plugin loaded.');
