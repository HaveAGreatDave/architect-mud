// Baseball league standings for the DEADBALL broadcast.
//
// The broadcast plugin SIMULATES a fresh nine-inning game every airing and, the
// instant a game starts airing on a channel, emits a `sports.game` event carrying
// the already-decided result (teams, final score, winner). This plugin listens for
// that event and books the result into the persistent `sports_standings` table —
// one row per team, accumulating wins/losses plus runs-for/against (kept for
// tiebreakers and future World Series seeding).
//
// `standings` prints the league table, sorted by win percentage.
//
// Dedupe: the same game can be announced on more than one channel (same gameId),
// so results are deduped by gameId in memory. A restart can't double-count — a game
// re-airs under a new cycle id, so it's simply a new game. The record is booked at
// air-start because the whole game is decided the moment it's assembled; the
// play-by-play only reveals it.
//
// This is the foundation for seasons + a World Series (a season clock, top-two
// seeding off this table, a scripted Series, champion, then reset) — those land in
// later phases and will live here.
import { query } from '../../server/models/db.js';
import { on, emit } from '../../server/engine/events.js';
import { registerAction } from '../../server/engine/actions.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

// A season runs SPORTS_SEASON_DAYS in-game days (~a month by default). When that many
// in-game days have elapsed (and enough games have been played), the top two teams meet
// in a single-game World Series; the winner is crowned champion, the standings reset,
// and the next season opens. Tune SPORTS_SEASON_DAYS up if the in-game clock makes
// seasons feel too short, down if they drag. Min-games guard stops a fast clock from
// seeding a Series off a thin sample.
const SPORTS_SEASON_DAYS = 30;   // in-game days per season
const SPORTS_MIN_WS_GAMES = 8;   // the #2 team must have played at least this many

// Bounded in-memory dedupe of already-booked game ids. Cleared when large — a
// re-book after a clear is astronomically unlikely (a gameId won't re-emit once its
// airing cycle has passed) and at worst adds one duplicate result.
const _booked = new Set();

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

// The active season row (the one not yet complete), or null. Highest season_no wins.
async function currentSeason() {
  const { rows } = await query(
    `SELECT * FROM sports_season WHERE phase <> 'complete' ORDER BY season_no DESC LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

// Open a fresh regular-season row if none is active. Season numbers just increment.
async function ensureSeason() {
  const active = await currentSeason();
  if (active) return active;
  const { rows } = await query(`SELECT COALESCE(MAX(season_no), 0) + 1 AS n FROM sports_season`).catch(() => ({ rows: [{ n: 1 }] }));
  const n = rows[0]?.n || 1;
  await query(
    `INSERT INTO sports_season (season_no, start_month, start_date, phase) VALUES ($1, $2, $3, 'regular')
     ON CONFLICT (season_no) DO NOTHING`,
    [n, gameMonth(), gameDate()],
  ).catch((e) => console.error('[sportsleague] ensureSeason error:', e.message));
  return currentSeason();
}

// Seed the World Series: the top two teams (needs a real sample). Returns the updated
// season row, or null if it couldn't seed (too few teams / not enough games yet).
async function seedWorldSeries(season) {
  const table = await queryStandings();
  if (table.length < 2) return null;
  const [a, b] = table;
  if ((b.wins + b.losses) < SPORTS_MIN_WS_GAMES) return null;   // guard: #2 must have played enough
  await query(
    `UPDATE sports_season SET phase = 'worldseries', finalist_a = $1, finalist_b = $2 WHERE season_no = $3`,
    [a.team, b.team, season.season_no],
  ).catch((e) => console.error('[sportsleague] seed error:', e.message));
  emit('sports.worldseries', { seasonNo: season.season_no, teams: [a.team, b.team] });
  console.log(`[sportsleague] WORLD SERIES seeded (season ${season.season_no}): ${a.team} vs ${b.team}`);
  return { ...season, phase: 'worldseries', finalist_a: a.team, finalist_b: b.team };
}

// The World Series game just aired — crown the champion from its result, close the
// season (champions history), wipe the standings, and open the next season.
async function crownChampion(season, g) {
  const winner = g.winner, loser = winner === g.away ? g.home : g.away;
  const champScore = winner === g.away ? g.awayScore : g.homeScore;
  const runScore = winner === g.away ? g.homeScore : g.awayScore;
  await query(
    `UPDATE sports_season SET phase = 'complete', champion = $1, runner_up = $2,
       champ_score = $3, runner_score = $4, decided_at = NOW() WHERE season_no = $5`,
    [winner, loser, champScore, runScore, season.season_no],
  ).catch((e) => console.error('[sportsleague] crown error:', e.message));
  await query(`TRUNCATE sports_standings`).catch(() => query(`DELETE FROM sports_standings`).catch(() => {}));
  await ensureSeason();
  emit('sports.champion', { seasonNo: season.season_no, champion: winner, runnerUp: loser, champScore, runScore });
  console.log(`[sportsleague] WORLD SERIES CHAMPION (season ${season.season_no}): ${winner} beat ${loser} ${champScore}-${runScore}`);
}

async function bumpTeam(team, w, l, rf, ra) {
  await query(
    `INSERT INTO sports_standings (team, wins, losses, runs_for, runs_against, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (team) DO UPDATE SET
       wins         = sports_standings.wins + $2,
       losses       = sports_standings.losses + $3,
       runs_for     = sports_standings.runs_for + $4,
       runs_against = sports_standings.runs_against + $5,
       updated_at   = NOW()`,
    [team, w, l, rf, ra],
  ).catch((e) => console.error('[sportsleague] record error:', e.message));
}

// Book one aired game into the standings. Guards against ties / missing data (the
// sim guarantees a winner, so those never fire — but a malformed event is ignored
// rather than corrupting a record).
async function recordGame(g) {
  if (!g?.gameId || _booked.has(g.gameId)) return;
  const { away, home, awayScore, homeScore, winner } = g;
  if (!winner || away == null || home == null || awayScore == null || homeScore == null) return;
  if (winner !== away && winner !== home) return;

  _booked.add(g.gameId);
  if (_booked.size > 2000) _booked.clear();

  // If the World Series is on and this is the finalists' game, it's the championship —
  // crown the winner and roll the season over instead of booking it to the standings.
  const season = await currentSeason();
  if (season?.phase === 'worldseries') {
    const finalists = [season.finalist_a, season.finalist_b];
    if (finalists.includes(away) && finalists.includes(home)) {
      await crownChampion(season, g);
      return;
    }
  }

  const loser      = winner === away ? home : away;
  const winScore   = winner === away ? awayScore : homeScore;
  const loseScore  = winner === away ? homeScore : awayScore;
  await bumpTeam(winner, 1, 0, winScore, loseScore);
  await bumpTeam(loser, 0, 1, loseScore, winScore);
}

on('sports.game', (g) => { recordGame(g).catch((e) => console.error('[sportsleague] event error:', e.message)); });

// Pure formatter — a monospace league table. Rows are pre-sorted by the query.
function formatStandings(rows) {
  if (!rows.length) return "No baseball games have been played yet — the DEADBALL standings are empty.";
  const nameW = Math.min(28, Math.max(12, ...rows.map((r) => r.team.length)));
  const head = `  #  ${'TEAM'.padEnd(nameW)}   W   L    PCT   RDIF`;
  const sep = '  ' + '─'.repeat(head.length - 2);
  const lines = rows.map((r, i) => {
    const games = r.wins + r.losses;
    const pctRaw = games ? r.wins / games : 0;
    const pct = games ? (pctRaw >= 1 ? '1.000' : pctRaw.toFixed(3).replace(/^0/, '')) : '.000';
    const rd = (r.runs_for || 0) - (r.runs_against || 0);
    const rds = (rd > 0 ? '+' : '') + rd;
    return ` ${String(i + 1).padStart(2)}  ${r.team.padEnd(nameW)} ${String(r.wins).padStart(3)} ${String(r.losses).padStart(3)}  ${pct.padStart(5)}  ${rds.padStart(4)}`;
  });
  return ['⚾ DEADBALL — COLDWATER LEAGUE STANDINGS', head, sep, ...lines].join('\n');
}

// The league table, sorted the canonical way (win% → wins → run diff → name).
// Shared by the `standings` command and the `sportsleague.getStandings` Action.
async function queryStandings() {
  const { rows } = await query(
    `SELECT team, wins, losses, runs_for, runs_against
       FROM sports_standings
      ORDER BY (wins::float / NULLIF(wins + losses, 0)) DESC NULLS LAST,
               wins DESC,
               (runs_for - runs_against) DESC,
               team ASC`,
  ).catch(() => ({ rows: [] }));
  return rows;
}

// The most recent crowned champion (for the standings header / trophy line).
async function lastChampion() {
  const { rows } = await query(
    `SELECT season_no, champion, runner_up, champ_score, runner_score
       FROM sports_season WHERE champion IS NOT NULL ORDER BY season_no DESC LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function seasonHeaderLines() {
  const s = await currentSeason();
  const champ = await lastChampion();
  const lines = [];
  if (s?.phase === 'worldseries' && s.finalist_a) lines.push(`Season ${s.season_no} · ⚾ WORLD SERIES — ${s.finalist_a} vs ${s.finalist_b}`);
  else lines.push(`Season ${s?.season_no || 1} · regular season`);
  if (champ) lines.push(`Reigning champ: ${champ.champion} (S${champ.season_no})`);
  return lines;
}

async function cmdStandings() {
  const header = await seasonHeaderLines();
  const table = formatStandings(await queryStandings());
  return { type: 'output', message: [...header, '', table].join('\n') };
}

function formatChampions(rows) {
  if (!rows.length) return "No World Series has been played yet — the trophy case is empty.";
  const lines = rows.map((r) => ` S${String(r.season_no).padStart(2)}  🏆 ${r.champion}  (def. ${r.runner_up} ${r.champ_score}-${r.runner_score})`);
  return ['⚾ DEADBALL — WORLD SERIES CHAMPIONS', ...lines].join('\n');
}

async function cmdChampions() {
  const { rows } = await query(
    `SELECT season_no, champion, runner_up, champ_score, runner_score
       FROM sports_season WHERE champion IS NOT NULL ORDER BY season_no DESC LIMIT 15`,
  ).catch(() => ({ rows: [] }));
  return { type: 'output', message: formatChampions(rows) };
}

// `worldseries` — everyone sees the current Series / season status + reigning champ;
// a dev/admin can `worldseries start` to force-seed it now (for testing without
// waiting for the in-game month to roll).
async function cmdWorldSeries(args, raw, player) {
  const isDev = player?.role === 'admin' || player?.role === 'dev';
  if ((args[0] || '').toLowerCase() === 'start' && isDev) {
    const s = await ensureSeason();
    if (s.phase !== 'regular') return { type: 'error', message: 'A World Series is already set or underway.' };
    const seeded = await seedWorldSeries(s);
    if (!seeded) return { type: 'error', message: `Can't seed yet — need 2+ teams with the runner-up at ${SPORTS_MIN_WS_GAMES}+ games played.` };
    return { type: 'output', message: `⚾ WORLD SERIES forced: ${seeded.finalist_a} vs ${seeded.finalist_b}. It airs on the next game cycle.` };
  }
  const s = await currentSeason();
  const champ = await lastChampion();
  const out = [];
  if (s?.phase === 'worldseries') out.push(`⚾ WORLD SERIES is ON — ${s.finalist_a} vs ${s.finalist_b} (Season ${s.season_no}). Winner takes all.`);
  else {
    const day = s?.start_date ? daysElapsed(s.start_date) : null;
    const prog = (day !== null) ? ` — day ${Math.max(0, day) + 1} of ${SPORTS_SEASON_DAYS}` : '';
    out.push(`Season ${s?.season_no || 1}: regular season${prog}. The top two meet in the World Series when the season ends.`);
  }
  if (champ) out.push(`Reigning champion: ${champ.champion} — beat ${champ.runner_up} ${champ.champ_score}-${champ.runner_score} (Season ${champ.season_no}).`);
  if (isDev && (!s || s.phase === 'regular')) out.push(`(dev: "worldseries start" to force it now.)`);
  return { type: 'output', message: out.join('\n') };
}

// Cross-plugin read seam: the broadcast plugin dispatches these to drive the on-air
// standings bug, pre-game record mentions, AND the World Series takeover (which two
// teams to run + branding). Meeting through an Action keeps broadcast from reaching
// into this plugin's tables directly.
registerAction({
  type: 'sportsleague.getStandings',
  handler: async () => ({ rows: await queryStandings() }),
});
registerAction({
  type: 'sportsleague.getSeason',
  handler: async () => {
    const s = await currentSeason();
    return {
      seasonNo: s?.season_no || null,
      phase: s?.phase || 'regular',
      finalistA: s?.finalist_a || null,
      finalistB: s?.finalist_b || null,
    };
  },
});

// Season clock: once a minute, make sure a season exists and, once SPORTS_SEASON_DAYS
// in-game days have elapsed since it began, seed the World Series off the standings.
async function seasonTick() {
  const s = await ensureSeason();
  if (!s || s.phase !== 'regular') return;
  // Start the clock late if the world date wasn't ready when the season opened.
  if (!s.start_date) {
    const d = gameDate();
    if (d) await query(`UPDATE sports_season SET start_date = $1, start_month = $2 WHERE season_no = $3`, [d, gameMonth(), s.season_no]).catch(() => {});
    return;
  }
  const elapsed = daysElapsed(s.start_date);
  if (elapsed !== null && elapsed >= SPORTS_SEASON_DAYS) await seedWorldSeries(s);
}
schedule('1m', seasonTick);
setTimeout(() => ensureSeason().catch((e) => console.error('[sportsleague] boot season error:', e.message)), 8000);

export const commands = {
  standings: () => cmdStandings(),
  worldseries: (args, raw, player) => cmdWorldSeries(args, raw, player),
  champions: () => cmdChampions(),
};

export const _test = { formatStandings, formatChampions, recordGame, daysBetween };

console.log('[sportsleague] Plugin loaded.');
