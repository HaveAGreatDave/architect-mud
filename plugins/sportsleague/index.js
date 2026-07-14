// Baseball league for the DEADBALL broadcast: standings + seasons + a World Series.
//
// ZERO-WRITE STANDINGS. The broadcast plugin runs one deterministic game per hour on a
// global clock — every game's result is a pure function of its slot, the same on every
// server and every TV. So the standings aren't stored row-by-row; they're a *computed
// fold* over the schedule for the current season's slot window (broadcast.computeStandings),
// cached here and recomputed only when a game completes. No `sports_game`/staging rows,
// no per-game upserts — the league advances on the clock with nobody watching and with
// essentially no DB traffic.
//
// Seasons still run SPORTS_SEASON_DAYS in-game days; at season's end the top two teams
// meet in a single-game World Series. The "reset" is just a pointer: the new season's
// `start_slot` moves forward, so its computed window starts fresh. Only `sports_season`
// is persisted — a handful of writes per season, never per game. Commands: `standings`,
// `worldseries`, `champions`.
import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

// A season runs SPORTS_SEASON_DAYS in-game days (~a month by default). When that many
// in-game days have elapsed (and enough games have been played), the top two teams meet
// in a single-game World Series; the winner is crowned champion, the standings window
// rolls forward, and the next season opens. Tune SPORTS_SEASON_DAYS up if the in-game
// clock makes seasons feel too short, down if they drag. Min-games guard stops a fast
// clock from seeding a Series off a thin sample.
const SPORTS_SEASON_DAYS = 30;   // in-game days per season
const SPORTS_MIN_WS_GAMES = 8;   // the #2 team must have played at least this many

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

// The active season row (the one not yet complete), or null. Highest season_no wins.
async function currentSeason() {
  const { rows } = await query(
    `SELECT * FROM sports_season WHERE phase <> 'complete' ORDER BY season_no DESC LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

// Open a fresh regular-season row if none is active. The season's `start_slot` anchors
// its standings window: games from this slot forward count toward it.
async function ensureSeason() {
  const active = await currentSeason();
  if (active) return active;
  const { rows } = await query(`SELECT COALESCE(MAX(season_no), 0) + 1 AS n FROM sports_season`).catch(() => ({ rows: [{ n: 1 }] }));
  const n = rows[0]?.n || 1;
  const { slot, ready } = await currentSlot();
  await query(
    `INSERT INTO sports_season (season_no, start_month, start_date, start_slot, phase) VALUES ($1, $2, $3, $4, 'regular')
     ON CONFLICT (season_no) DO NOTHING`,
    [n, gameMonth(), gameDate(), ready ? slot : null],   // anchor only once the clock is live
  ).catch((e) => console.error('[sportsleague] ensureSeason error:', e.message));
  return currentSeason();
}

// Seed the World Series: the top two teams (needs a real sample). The Series airs at the
// NEXT nightly airtime slot (ws_slot) — the same fixed time the regular game airs, so it's
// a scheduled marquee event, not a random hour — and the regular standings freeze at that
// boundary. Returns the updated season row, or null if it couldn't seed.
async function seedWorldSeries(season) {
  const table = await queryStandings();
  if (table.length < 2) return null;
  const [a, b] = table;
  if ((b.wins + b.losses) < SPORTS_MIN_WS_GAMES) return null;   // guard: #2 must have played enough
  const clock = await currentSlot();
  if (!clock.ready) return null;                                // don't seed off a boot-placeholder slot
  // Pin the Series to the next featured airtime slot (falls back to next slot if the
  // league airs continuously), so it lands at the advertised nightly time.
  const air = await dispatchAction({ type: 'broadcast.nextSportsAirSlot', params: { after: clock.slot } }).catch(() => null);
  const wsSlot = Number.isFinite(air?.slot) ? air.slot : clock.slot + 1;
  const airHour = Number.isFinite(air?.hour) ? air.hour : null;
  await query(
    `UPDATE sports_season SET phase = 'worldseries', finalist_a = $1, finalist_b = $2, ws_slot = $3 WHERE season_no = $4`,
    [a.team, b.team, wsSlot, season.season_no],
  ).catch((e) => console.error('[sportsleague] seed error:', e.message));
  _standCache.key = null;   // freeze the window at ws_slot now
  // Advertise WHEN it airs so the news app + TV guide can state the time.
  const gpd = clock.gamesPerDay || 8;
  const dayNow = Math.floor(clock.slot / gpd), dayWs = Math.floor(wsSlot / gpd);
  const when = dayWs <= dayNow ? 'tonight' : (dayWs === dayNow + 1 ? 'tomorrow night' : `in ${dayWs - dayNow} nights`);
  emit('sports.worldseries', { seasonNo: season.season_no, teams: [a.team, b.team], wsSlot, airHour, when });
  console.log(`[sportsleague] WORLD SERIES seeded (season ${season.season_no}): ${a.team} vs ${b.team} @ slot ${wsSlot} (${when}${airHour != null ? `, ${airHour}:00` : ''})`);
  return { ...season, phase: 'worldseries', finalist_a: a.team, finalist_b: b.team, ws_slot: wsSlot };
}

// The World Series slot has aired — crown the champion from that game's (deterministic)
// result, close the season (champions history), and open the next season, whose
// start_slot lands past the WS slot so the new window is clean.
async function crownChampion(season) {
  const g = await dispatchAction({ type: 'broadcast.getSlotResult', params: { slot: Number(season.ws_slot), teams: [season.finalist_a, season.finalist_b] } }).catch(() => null);
  if (!g || !g.winner) return;
  const winner = g.winner, loser = winner === g.away ? g.home : g.away;
  const champScore = winner === g.away ? g.awayScore : g.homeScore;
  const runScore = winner === g.away ? g.homeScore : g.awayScore;
  await query(
    `UPDATE sports_season SET phase = 'complete', champion = $1, runner_up = $2,
       champ_score = $3, runner_score = $4, decided_at = NOW() WHERE season_no = $5`,
    [winner, loser, champScore, runScore, season.season_no],
  ).catch((e) => console.error('[sportsleague] crown error:', e.message));
  _standCache.key = null;
  await ensureSeason();   // opens the next season with start_slot = now (past ws_slot)
  emit('sports.champion', { seasonNo: season.season_no, champion: winner, runnerUp: loser, champScore, runScore });
  console.log(`[sportsleague] WORLD SERIES CHAMPION (season ${season.season_no}): ${winner} beat ${loser} ${champScore}-${runScore}`);
}

// ── Standings (computed, cached) ────────────────────────────────────────────────

// The league table for the current season, folded from the deterministic schedule by
// the broadcast plugin. Cached on (season, window-end) so it recomputes only when a
// game completes (the slot advances) or the season rolls — not on every read.
let _standCache = { key: null, rows: [] };
async function queryStandings() {
  const s = await currentSeason();
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
  if (_standCache.key !== key) {
    const res = await dispatchAction({ type: 'broadcast.computeStandings', params: { startSlot, endSlot } }).catch(() => null);
    _standCache = { key, rows: Array.isArray(res?.rows) ? res.rows : [] };
  }
  return _standCache.rows;
}

// Pure formatter — a monospace league table. Rows are pre-sorted by the fold.
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
    return { type: 'output', message: `⚾ WORLD SERIES forced: ${seeded.finalist_a} vs ${seeded.finalist_b}. It airs at the top of the hour.` };
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

// Cross-plugin read seam: the broadcast + tablet plugins dispatch these to drive the
// on-air standings bug, pre-game record mentions, and the World Series takeover. Meeting
// through an Action keeps them from reaching into this plugin's table directly.
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
      wsSlot: s?.ws_slot != null ? Number(s.ws_slot) : null,
    };
  },
});

// Season clock: once a minute, keep a season open, seed the World Series when the season
// has run its course, and crown the champion once the Series slot has aired.
async function seasonTick() {
  const s = await ensureSeason();
  if (!s) return;
  if (s.phase === 'worldseries') {
    const ws = s.ws_slot != null ? Number(s.ws_slot) : null;
    const c = await currentSlot();
    if (ws != null && c.ready && c.slot > ws) await crownChampion(s);
    return;
  }
  if (s.phase !== 'regular') return;
  // Backfill the anchors if the world clock / slot wasn't ready when the season opened.
  if (!s.start_date || s.start_slot == null) {
    const c = await currentSlot();
    if (!c.ready) return;                     // wait for the in-game clock before anchoring
    await query(`UPDATE sports_season SET start_date = COALESCE(start_date, $1), start_month = COALESCE(NULLIF(start_month,'0000-00'), $2), start_slot = COALESCE(start_slot, $3) WHERE season_no = $4`,
      [gameDate(), gameMonth(), c.slot, s.season_no]).catch(() => {});
    return;
  }
  // End the season by SLOTS elapsed — the same axis the standings fold uses — so the
  // roll can never drift from the window. (Measuring off start_date left the season
  // stranded in 'regular' whenever the date math failed, letting the window balloon.)
  const c = await currentSlot();
  const seasonSlots = SPORTS_SEASON_DAYS * (c.gamesPerDay || 8);
  if (c.ready && (c.slot - Number(s.start_slot)) >= seasonSlots) await seedWorldSeries(s);
}
schedule('1m', seasonTick);
setTimeout(() => ensureSeason().catch((e) => console.error('[sportsleague] boot season error:', e.message)), 8000);

export const commands = {
  standings: () => cmdStandings(),
  worldseries: (args, raw, player) => cmdWorldSeries(args, raw, player),
  champions: () => cmdChampions(),
};

export const _test = { formatStandings, formatChampions, daysBetween };

console.log('[sportsleague] Plugin loaded.');
