// The final's package: three cards about the two clubs, put up before the first pitch of the
// Curtain Call or the drop of the Coldwater Cup, each with the booth reading it.
//
//   tape   the tale of the tape: where each club is from, when it was founded, its seed, its
//          record, its place and its run or goal differential
//   road   the road to the final: each club's last ten, its streak, and the season series
//          between the two
//   watch  players to watch: the men the caller picks for each club (the sport knows who they
//          are), and anyone out
//
// Pure, over what the season's fold already holds (the table, every game's result, every man's
// line), so the suite builds one without a game on the air. It names no league: the sport, the
// final's name, the brand and the show come in from the caller, and the client draws the crests
// and colours from the club set it already has.

const ORD = (n) => { const v = n % 100; return n + ((v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'); };
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const signed = (n) => (n > 0 ? `+${n}` : String(n));

// A club's results, oldest first: 'W', 'L', or 'O' for a loss past regulation (hockey's point).
export function formOf(results, team) {
  const out = [];
  for (const r of results || []) {
    if (r.a !== team && r.h !== team) continue;
    const us = r.a === team ? r.as : r.hs, them = r.a === team ? r.hs : r.as;
    out.push(us > them ? 'W' : r.ot ? 'O' : 'L');
  }
  return out;
}
// The run a club is on, from its form: { kind: 'W' | 'L', n }. An overtime loss is a loss.
export function streakOf(form) {
  if (!form.length) return null;
  const win = (c) => c === 'W', last = win(form[form.length - 1]);
  let n = 0;
  for (let i = form.length - 1; i >= 0 && win(form[i]) === last; i--) n++;
  return { kind: last ? 'W' : 'L', n };
}
const streakSaid = (s) => !s ? 'yet to play' : s.n === 1 ? (s.kind === 'W' ? 'won their last one' : 'lost their last one')
  : `${s.kind === 'W' ? 'won' : 'lost'} ${word(s.n)} straight`;

// The season series between two clubs: each meeting, oldest first, and the wins either way.
export function seriesOf(results, a, b) {
  const games = [];
  let aw = 0, bw = 0;
  for (const r of results || []) {
    if (!((r.a === a && r.h === b) || (r.a === b && r.h === a))) continue;
    const winner = r.as > r.hs ? r.a : r.h;
    if (winner === a) aw++; else bw++;
    games.push({ away: r.a, home: r.h, awayScore: r.as, homeScore: r.hs, winner, ...(r.ot ? { ot: 1 } : {}) });
  }
  return { games, wins: { [a]: aw, [b]: bw } };
}

// `sport` 'hockey' or 'baseball'; `final` the final's name; `away`/`home` the club names; `rows`
// the sorted table; `results` every game this season ({ a, h, as, hs, ot }); `clubs` the league's
// identities (district, home, founded); `seeds` { away, home }; `watch` { away, home }, each a
// list of { role, name, stat, said } the caller picked; `out` { away, home }, names missing.
export function finalPackage({ sport, final, away, home, rows = [], results = [], clubs = {}, seeds = {}, watch = {}, out = {}, brand = null, show = null, sting = null }) {
  const hockey = sport === 'hockey';
  const rankOf = (t) => { const i = rows.findIndex((r) => r.team === t); return i < 0 ? null : i + 1; };
  const rowOf = (t) => rows.find((r) => r.team === t) || null;
  const base = { overlayType: 'sportsfx', kind: 'package', sport, final, ...(brand ? { brand } : {}), ...(show ? { show } : {}), ...(sting ? { sting } : {}) };

  const tapeOf = (team, side) => {
    const r = rowOf(team), c = clubs[team] || {};
    const diff = r ? (hockey ? (r.goals_for || 0) - (r.goals_against || 0) : (r.runs_for || 0) - (r.runs_against || 0)) : 0;
    const rank = rankOf(team);
    return {
      name: team, home: c.home || null, founded: c.founded ?? null, seed: seeds[side] ?? null, rank,
      record: r ? (hockey ? `${r.wins}-${r.losses}-${r.otl || 0}` : `${r.wins}-${r.losses}`) : null,
      points: hockey && r ? r.points || 0 : null,
      pct: !hockey && r && r.wins + r.losses ? (r.wins / (r.wins + r.losses)).toFixed(3).replace(/^0/, '') : null,
      for: r ? (hockey ? r.goals_for || 0 : r.runs_for || 0) : 0,
      against: r ? (hockey ? r.goals_against || 0 : r.runs_against || 0) : 0,
      diff,
    };
  };
  const roadOf = (team) => {
    const form = formOf(results, team), last = form.slice(-10);
    const w = last.filter((x) => x === 'W').length, o = last.filter((x) => x === 'O').length, l = last.length - w - o;
    return { name: team, last, lastRec: hockey ? `${w}-${l}-${o}` : `${w}-${l}`, streak: streakOf(form) };
  };
  const series = seriesOf(results, away, home);

  const tape = { ...base, page: 'tape', away: tapeOf(away, 'away'), home: tapeOf(home, 'home'), duration: 30 };
  const road = { ...base, page: 'road', away: roadOf(away), home: roadOf(home),
    series: { games: series.games.slice(-6), away: series.wins[away], home: series.wins[home] }, duration: 30 };
  const men = (side) => (watch[side] || []).slice(0, 3).map(({ role, name, stat }) => ({ role, name, stat }));
  const pack = { ...base, page: 'watch', away: { name: away, men: men('away'), out: (out.away || []).slice(0, 6) },
    home: { name: home, men: men('home'), out: (out.home || []).slice(0, 6) }, duration: 30 };

  // What the booth says over each page: one line a club, then one for the series, then one a
  // club for its men, and one for who's missing where anyone is.
  const tapeTok = (t) => ({
    club: t.name, district: t.home || 'nowhere anyone can name', founded: t.founded ?? '',
    record: t.record || 'no record', place: t.rank ? ORD(t.rank) : 'unplaced', seed: t.seed ? ORD(t.seed) : '',
    diff: signed(t.diff), scored: t.for, allowed: t.against, points: t.points ?? '',
  });
  // "6 and 3", or with hockey's overtime losses "6, 3 and 1"
  const lastSaid = (r) => { const [w, l, o] = r.lastRec.split('-'); return o && o !== '0' ? `${w}, ${l} and ${o}` : `${w} and ${l}`; };
  const roadTok = (r) => ({ club: r.name, last10: lastSaid(r), streak: streakSaid(r.streak) });
  const aw = series.wins[away] || 0, hw = series.wins[home] || 0;
  const leader = aw >= hw ? away : home, trailer = leader === away ? home : away;
  const seriesTok = { away, home, leader, trailer, leadWins: word(Math.max(aw, hw)), trailWins: word(Math.min(aw, hw)), meetings: word(aw + hw) };
  const seriesKey = !(aw + hw) ? 'series.none' : aw === hw ? 'series.even' : 'series';
  const watchTok = (side, team) => {
    const [a, b] = watch[side] || [];
    return a ? { club: team, star: a.name, starSaid: a.said || '', next: b?.name || '', nextSaid: b?.said || '' } : null;
  };
  const outTok = (side, team) => ((out[side] || []).length ? { club: team, missing: out[side].join(', '), count: word(out[side].length) } : null);

  return {
    pages: [tape, road, pack],
    lines: [
      { page: 0, key: 'tape.club', tok: tapeTok(tape.away) },
      { page: 0, key: 'tape.club', tok: tapeTok(tape.home) },
      { page: 1, key: 'road.club', tok: roadTok(road.away) },
      { page: 1, key: 'road.club', tok: roadTok(road.home) },
      { page: 1, key: seriesKey, tok: seriesTok },
      ...[['away', away], ['home', home]].flatMap(([side, team]) => [
        watchTok(side, team) && { page: 2, key: watchTok(side, team).next ? 'watch.club' : 'watch.club.one', tok: watchTok(side, team) },
        outTok(side, team) && { page: 2, key: 'watch.out', tok: outTok(side, team) },
      ]).filter(Boolean),
    ],
  };
}

// The package written out, for a viewer on the log rung: one page at a time, as it goes up.
export function packageText(fx) {
  if (fx?.kind !== 'package') return null;
  const hockey = fx.sport === 'hockey';
  if (fx.page === 'tape') {
    const row = (t) => [
      t.name, t.home ? `from ${t.home}` : '', t.founded ? `founded ${t.founded}` : '', t.seed ? `${ORD(t.seed)} seed` : '',
      t.record || '', t.rank ? `${ORD(t.rank)} in the table` : '', `${hockey ? 'GD' : 'RD'} ${signed(t.diff)}`,
    ].filter(Boolean).join(' · ');
    return [`${fx.final}: THE TALE OF THE TAPE`, row(fx.away), row(fx.home)];
  }
  if (fx.page === 'road') {
    const row = (r) => `${r.name}: last ${r.last.length} ${r.lastRec} (${r.last.join('') || 'none'}), ${streakSaid(r.streak)}`;
    const s = fx.series || {};
    return [`${fx.final}: THE ROAD HERE`, row(fx.away), row(fx.home), `Season series: ${fx.away.name} ${s.away || 0}, ${fx.home.name} ${s.home || 0}`];
  }
  if (fx.page === 'watch') {
    const row = (c) => `${c.name}: ${(c.men || []).map((m) => `${m.role} ${m.name} (${m.stat})`).join('; ') || 'nobody listed'}${c.out?.length ? `. Out: ${c.out.join(', ')}` : ''}`;
    return [`${fx.final}: PLAYERS TO WATCH`, row(fx.away), row(fx.home)];
  }
  return null;
}
