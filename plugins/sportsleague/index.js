// Baseball league for the DEADBALL broadcast: standings + monthly seasons + a World
// Series.
//
// The broadcast plugin SIMULATES a fresh game every airing and, the instant one starts
// airing, emits a `sports.game` event with the already-decided result and when its
// airing window wraps (`endsAtMs`). Rather than book immediately, this plugin STAGES
// the result as a pending row (`sports_results`, keyed by gameId) and a 1-minute sweep
// books it into `sports_standings` once the window ends. That's:
//   • end-of-game — a game only counts once its airing window completes;
//   • restart-safe — pending rows live in the DB, and the sweep catches up after
//     downtime, so nothing is lost;
//   • churn-proof — the gameId is keyed to an absolute time-window (see broadcast), so a
//     mid-window restart re-sims the same slot and the INSERT no-ops (no double-count).
//
// Seasons run SPORTS_SEASON_DAYS in-game days; at season's end the top two teams meet in
// a single-game World Series (the finalists' game crowns a champion, resets standings,
// opens the next season). Commands: `standings`, `worldseries`, `champions`.
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

// Stage an aired game as PENDING. It books into the standings only when its airing
// window ends (resolve_at), via the sweep below — so a game that never finished airing
// (mid-window restart) isn't counted. The game_id primary key makes this idempotent and
// restart-safe: a re-simmed same-slot game (after a restart) INSERTs as a no-op, so no
// double-count and no churn. No in-memory dedupe needed — the DB is the source of truth.
async function stageResult(g) {
  if (!g?.gameId) return;
  const { away, home, awayScore, homeScore, winner, endsAtMs } = g;
  if (!winner || away == null || home == null || awayScore == null || homeScore == null) return;
  if (winner !== away && winner !== home) return;
  const resolveAt = Number.isFinite(endsAtMs) ? endsAtMs : (Date.now() + 300000);
  await query(
    `INSERT INTO sports_results (game_id, away_team, home_team, away_score, home_score, winner, resolve_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))
     ON CONFLICT (game_id) DO NOTHING`,
    [g.gameId, away, home, awayScore, homeScore, winner, resolveAt],
  ).catch((e) => console.error('[sportsleague] stage error:', e.message));
}

on('sports.game', (g) => { stageResult(g).catch((e) => console.error('[sportsleague] event error:', e.message)); });

// Book one finished game. The World Series decider (the finalists' game while the
// Series is on) crowns a champion and rolls the season; every other game goes to the
// standings. Guards against ties / malformed rows (the sim guarantees a winner).
async function bookResult(g) {
  const { away, home, awayScore, homeScore, winner } = g;
  if (!winner || winner !== away && winner !== home) return;
  const season = await currentSeason();
  if (season?.phase === 'worldseries') {
    const finalists = [season.finalist_a, season.finalist_b];
    if (finalists.includes(away) && finalists.includes(home)) { await crownChampion(season, g); return; }
  }
  const loser     = winner === away ? home : away;
  const winScore  = winner === away ? awayScore : homeScore;
  const loseScore = winner === away ? homeScore : awayScore;
  await bumpTeam(winner, 1, 0, winScore, loseScore);
  await bumpTeam(loser, 0, 1, loseScore, winScore);
}

// Sweep: book every pending game whose airing window has ended, oldest first, then mark
// it booked. Restart-safe (no per-game timers; catches up rows that came due during
// downtime) and idempotent (the status flip means a game is booked exactly once).
async function settleResults() {
  const { rows } = await query(
    `SELECT * FROM sports_results WHERE status = 'pending' AND resolve_at <= NOW() ORDER BY resolve_at ASC`,
  ).catch(() => ({ rows: [] }));
  for (const row of rows) {
    await bookResult({ away: row.away_team, home: row.home_team, awayScore: row.away_score, homeScore: row.home_score, winner: row.winner })
      .catch((e) => console.error('[sportsleague] book error:', e.message));
    await query(`UPDATE sports_results SET status = 'booked' WHERE game_id = $1`, [row.game_id]).catch(() => {});
  }
}

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

// Book finished games once a minute (restart-safe; catches up rows that came due while
// the server was down). A short post-boot pass settles anything already overdue.
schedule('1m', settleResults);
setTimeout(() => settleResults().catch((e) => console.error('[sportsleague] boot settle error:', e.message)), 9000);

export const commands = {
  standings: () => cmdStandings(),
  worldseries: (args, raw, player) => cmdWorldSeries(args, raw, player),
  champions: () => cmdChampions(),
};

export const _test = { formatStandings, formatChampions, bookResult, stageResult, settleResults, daysBetween };

console.log('[sportsleague] Plugin loaded.');
