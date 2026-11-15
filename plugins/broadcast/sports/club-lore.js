// CLUB LORE. What a booth knows about a club's history, and which of it is worth saying tonight.
//
// History is the league's closed seasons (sportsleague's `getHistory`): who won each final, who
// lost it, and where every club finished the month. From that a club has a story, and the story
// moves with the results: a club that wins two Cups is a dynasty until somebody beats them, a
// club that keeps losing finals is cursed until it doesn't, a club that finished last three times
// and is second tonight has turned it round. Nothing here is stored. It's worked out again from
// the seasons each time, so it can't go stale or disagree with the trophy case.
//
// `loreTopics(history, team, opponent, opts)` returns what's worth saying about one club, best
// first, as `{ key, p, tok }`: `key` is a line pool (`lore.dynasty`, `lore.heartbreak`, ...),
// `p` its priority and `tok` the tokens its lines fill. `rivalryTopic` is the same for a pair of
// clubs that have met in a final. A pool a show doesn't have is skipped by the narrator, so a
// script with no lore lines says nothing about history and loses nothing else.
//
// Pure: regress and the Studio run it on made-up seasons.

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const words = (n) => (n >= 0 && n < NUM.length ? NUM[n] : String(n));
const count = (n, one, many = `${one}s`) => `${words(n)} ${n === 1 ? one : many}`;
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const ordinal = (n) => ORD[n] || `${n}th`;
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${words(n)} times`);

// How many closed seasons count as "recent" for finishes and form.
export const RECENT = 5;

// `history.seasons` newest first, each { seasonNo, champion, runnerUp, score: [w, l] | null,
// table: [team, ...] | null }. Only seasons that were played count: an uncrowned season with
// no table (a roster change closed it before a game) says nothing about anybody.
const played = (seasons) => (Array.isArray(seasons) ? seasons : []).filter((s) => s && (s.champion || (Array.isArray(s.table) && s.table.length)));

// One club's record, as plain numbers. `rows` is the open season's table (sorted), and `minGames`
// the games a club must have played before its place tonight means anything.
export function clubRecord(history, team, { rows = [], minGames = 8, played: playedOf = null } = {}) {
  // Only the seasons this club was in: it's in the season's final or its table, or the season
  // was played under the roster the league has now (`history.era`). A club that joined two
  // seasons ago hasn't gone six without a title.
  const seasons = played(history?.seasons).filter((s) =>
    s.champion === team || s.runnerUp === team || (s.table && s.table.includes(team)) || (history?.era && s.era === history.era));
  const crowned = seasons.filter((s) => s.champion);
  const titles = crowned.filter((s) => s.champion === team);
  const finals = crowned.filter((s) => s.champion === team || s.runnerUp === team);

  // Cups won back to back, counting from the latest crowned season down.
  let streak = 0;
  for (const s of crowned) { if (s.champion === team) streak++; else break; }
  // Finals lost in a row, counting this club's own finals from its latest one down.
  let lostStreak = 0;
  for (const s of finals) { if (s.runnerUp === team) lostStreak++; else break; }
  // Seasons since the last title, counted in played seasons.
  const lastTitle = titles[0] || null;
  const since = lastTitle ? seasons.indexOf(lastTitle) : null;

  // Where it finished in each recent season with a table, newest first (null where it wasn't in it).
  const tabled = seasons.filter((s) => Array.isArray(s.table) && s.table.length).slice(0, RECENT);
  const finishes = tabled.map((s) => { const i = s.table.indexOf(team); return i < 0 ? null : i + 1; });
  const known = finishes.filter((f) => f != null);
  const sizes = tabled.map((s) => s.table.length);
  const cellar = finishes.filter((f, i) => f != null && f === sizes[i]).length;
  const top2 = known.filter((f) => f <= 2).length;

  // Tonight's place, once there's enough of the season for it to mean something.
  const at = rows.findIndex((r) => r.team === team);
  const gp = at >= 0 && playedOf ? playedOf(rows[at]) : (at >= 0 ? (rows[at].wins || 0) + (rows[at].losses || 0) + (rows[at].otl || 0) : 0);
  const now = at >= 0 && gp >= minGames ? at + 1 : null;

  return {
    team, seasons: seasons.length, titles: titles.length, lastTitle, since, streak,
    finals: finals.length, finalsLost: finals.filter((s) => s.runnerUp === team).length, lostStreak, lastFinal: finals[0] || null,
    finishes, cellar, top2, now, size: rows.length || sizes[0] || 0,
    // the last season the league played was won by this club
    reigning: played(history?.seasons)[0]?.champion === team,
  };
}

// What's worth saying about one club tonight, best first. `opponent` names who they're playing,
// for lines that set the two against each other.
export function loreTopics(history, team, opponent = '', opts = {}) {
  const r = clubRecord(history, team, opts);
  if (!r.seasons) return [];
  const out = [];
  const lf = r.lastFinal;
  const tok = {
    club: team, opponent,
    titles: r.titles, titlesSaid: count(r.titles, 'title'), cupsSaid: count(r.titles, 'Cup'),
    lastTitle: r.lastTitle ? `Season ${r.lastTitle.seasonNo}` : '',
    sinceSaid: r.since != null ? count(r.since, 'season') : '',
    streak: r.streak, streakSaid: words(r.streak),
    finalsSaid: count(r.finals, 'final'), lostSaid: count(r.finalsLost, 'final'), lostStreakSaid: words(r.lostStreak),
    // the club that beat them in their last final, and the score as said ("five to four")
    beatenBy: lf && lf.runnerUp === team ? lf.champion : '',
    beat: lf && lf.champion === team ? lf.runnerUp : '',
    finalScore: lf?.score ? `${words(lf.score[0])} to ${words(lf.score[1])}` : '',
    lastFinalSeason: lf ? `Season ${lf.seasonNo}` : '',
    span: count(r.finishes.length, 'season'),
    lastFinish: r.finishes[0] ? ordinal(r.finishes[0]) : '',
    oldFinish: r.finishes.some((f) => f) ? ordinal(r.finishes.filter(Boolean).pop()) : '',
    bestFinish: r.finishes.some((f) => f) ? ordinal(Math.min(...r.finishes.filter(Boolean))) : '',
    cellarSaid: times(r.cellar), top2Said: times(r.top2),
    place: r.now ? ordinal(r.now) : '',
  };
  const add = (key, p) => out.push({ key, p, tok });
  const known = r.finishes.filter((f) => f != null);

  // The champions, and how long they've held it.
  if (r.reigning && r.streak >= 2) add('lore.dynasty', 6);
  else if (r.reigning) add('lore.defending', 5);
  // Losing finals.
  if (r.lostStreak >= 2) add('lore.heartbreak', 5);
  else if (r.lostStreak === 1 && lf === played(history.seasons).find((s) => s.champion)) add('lore.lastfinal', 4);
  // The season they're having, against the ones they've had.
  if (r.now && known.length >= 2) {
    if (r.now <= 2 && Math.min(...known) >= 4) add('lore.breakout', 4);
    if (r.now >= r.size - 1 && r.titles && r.since != null && r.since <= 3) add('lore.fallen', 4);
    else if (r.now >= r.size - 1 && Math.max(...known) <= 3) add('lore.slump', 3);
  }
  // Silverware, or the lack of it.
  if (r.titles >= 2 && !(r.reigning && r.streak >= 2)) add('lore.titles', 3);
  if (r.titles && r.since >= 4) add('lore.drought', 3);
  if (!r.titles && r.finals && r.seasons >= 3) add('lore.close', 3);
  if (!r.titles && !r.finals && r.seasons >= 4) add('lore.never', 3);
  // Form over the last few months.
  if (known.length >= 3) {
    const newest = r.finishes[0], oldest = known[known.length - 1];
    if (newest != null && newest <= oldest - 3) add('lore.rising', 2);
    if (newest != null && newest >= oldest + 3) add('lore.falling', 2);
  }
  if (r.cellar >= 2) add('lore.cellar', 2);
  if (r.top2 >= 3 && !r.titles) add('lore.contender', 2);
  return out.sort((a, b) => b.p - a.p);
}

// Two clubs that have met in a final: how often, and who's had the better of it.
export function rivalryTopic(history, a, b) {
  const met = played(history?.seasons).filter((s) => s.champion && [s.champion, s.runnerUp].includes(a) && [s.champion, s.runnerUp].includes(b));
  if (!met.length) return null;
  const aw = met.filter((s) => s.champion === a).length, bw = met.length - aw;
  const last = met[0];
  const lead = aw === bw ? '' : aw > bw ? a : b;
  return {
    key: met.length === 1 ? 'lore.rematch' : (aw && bw ? 'lore.rivalry' : 'lore.rivalry.owned'), p: 4,
    tok: {
      club: a, opponent: b, metSaid: times(met.length), meetings: met.length,
      lastWinner: last.champion, lastLoser: last.runnerUp, lastFinalSeason: `Season ${last.seasonNo}`,
      finalScore: last.score ? `${words(last.score[0])} to ${words(last.score[1])}` : '',
      leader: lead, trailer: lead ? (lead === a ? b : a) : '', leadSaid: lead ? `${words(Math.max(aw, bw))} of ${words(met.length)}` : '',
    },
  };
}

// The history a pre-game or a break can lean on for one game: each club's best topic and the
// rivalry, if any, in the order worth saying.
export function gameLore(history, home, away, opts = {}) {
  return {
    home: loreTopics(history, home, away, opts),
    away: loreTopics(history, away, home, opts),
    rivalry: rivalryTopic(history, home, away),
  };
}
