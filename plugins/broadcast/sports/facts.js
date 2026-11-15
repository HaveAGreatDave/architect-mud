// THE FACTS FEED. What's known about a game at a moment of it, as one plain object a sequence's
// tokens, lists and conditions read (client/shared/sequence.js). It's counted from the game's own
// beats up to that moment, so the desk can't say anything the play hasn't done yet and can't disagree
// with the booth.
//
// `factsAt(sport, game, at, ctx)`: `at` is null before the first play, a beat, or 'end'. `ctx` is
// { season, clubs, records, rows }: the league's fold, the clubs' identities, a team's record, and
// the table. Any of them can be missing, and the facts that need them are then missing too, which
// loses the lines that use them and nothing else.
//
// A PERSON is any object here with a `name`: a graphic can be pointed at one (`who: 'lastGoal'`), and
// `{lastGoal.name}` or `{lastGoal.num}` read one in a line. `personOf` makes them all, so a man has
// the same number, colour and stat line wherever he's named.
//
// Adding a fact is a line in the sport's section: the Studio's token list reads what comes back.
//
// Pure, so the Studio runs it on a simulated game and regress on a real one.

import { sweaterNumber } from '../../cards/sports.js';
import { ON_GOAL } from './hockey.js';

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const ordinal = (n) => ORD[n] || `${n}th`;
const colourOf = (ctx, team) => ctx.clubs?.[team]?.colours?.[0] || '';
// A count as a line says it, so nobody on air says "1 men": `{fightsSaid}` is "one fight" or "3 fights".
const said = (n, one, many) => (n === 1 ? `one ${one}` : `${n} ${many}`);

// ── Who to watch ───────────────────────────────────────────────────────────────────────────────
// Each club's men, from the season's fold: the CPhL its top scorer and the man in net, Deadball its
// best hitter in the line-up, its home-run man and tonight's starter. The final's package reads them
// too. `out` is who's missing.
export function watchOf(sport, t, ex) {
  if (sport === 'hockey') {
    const P = ex.players || {}, G = ex.goalies || {};
    const men = (t.skaters || []).map((m) => ({ name: m.name, ...(P[m.name] || { gp: 0, g: 0, a: 0 }) }))
      .sort((a, b) => (b.g + b.a) - (a.g + a.a) || b.g - a.g || a.name.localeCompare(b.name));
    const list = men.slice(0, 2).filter((m) => m.gp).map((m) => ({ role: 'F', name: m.name, stat: `${m.g} G · ${m.a} A · ${m.g + m.a} PTS`, said: `${m.g} goals and ${m.a} assists` }));
    const g = t.goalie ? G[t.goalie] : null;
    if (g?.gp) {
      const sv = g.sa ? ((g.sa - g.ga) / g.sa).toFixed(3).replace(/^0/, '') : '.000', gaa = (g.ga / g.gp).toFixed(2);
      list.splice(1, 0, { role: 'G', name: t.goalie, stat: `${g.w} W · ${sv} SV% · ${gaa} GAA`, said: `${g.w} wins, saving ${sv}` });
    }
    return { list, out: (t.dressed || []).filter((d) => d.callup && d.replacing).map((d) => d.replacing) };
  }
  const L = ex.ledger || {}, bats = L.bats instanceof Map ? L.bats : new Map(), arms = L.arms instanceof Map ? L.arms : new Map();
  const lineup = (t.lineup || []).map((n) => bats.get(n)).filter(Boolean);
  const most = lineup.reduce((m, r) => Math.max(m, r.ab), 0), avg = (r) => (r.ab ? r.hits / r.ab : 0);
  const fmt = (r) => avg(r).toFixed(3).replace(/^0/, '');
  const hitter = lineup.filter((r) => r.ab >= Math.max(5, most * 0.4)).sort((a, b) => avg(b) - avg(a) || b.hits - a.hits)[0];
  // the home-run man: the leader, or the next one down when the leader's already up as the best bat
  const slugger = lineup.filter((r) => r !== hitter).sort((a, b) => b.hr - a.hr || b.rbi - a.rbi)[0];
  const list = [];
  if (hitter) list.push({ role: 'AVG', name: hitter.name, stat: `${fmt(hitter)} · ${hitter.hr} HR · ${hitter.rbi} RBI`, said: `hitting ${fmt(hitter)} with ${hitter.rbi} driven in` });
  const p = t.pitcher ? arms.get(t.pitcher) : null;
  if (p) {
    const era = (p.outs ? (p.er * 27) / p.outs : 0).toFixed(2);
    list.push({ role: 'SP', name: t.pitcher, stat: `${p.w}-${p.l} · ${era} ERA · ${p.k} K`, said: `${p.w} and ${p.l} with an earned run average of ${era}` });
  }
  if (slugger && slugger !== hitter && slugger.hr) list.push({ role: 'HR', name: slugger.name, stat: `${slugger.hr} HR · ${slugger.rbi} RBI`, said: `${slugger.hr} home runs` });
  return { list, out: [] };
}

// A man's season, as a graphic shows it: three stats, as "label: value" rows. Deadball's pitchers
// bat, so `as` says which line of his is meant: 'arm' or 'bat'.
function seasonOf(sport, name, ex, as = 'bat') {
  if (sport === 'hockey') {
    const p = ex?.players?.[name], g = ex?.goalies?.[name];
    if (g?.gp) {
      const sv = g.sa ? ((g.sa - g.ga) / g.sa).toFixed(3).replace(/^0/, '') : '.000';
      return { pos: 'G', stats: [`W: ${g.w}`, `SV%: ${sv}`, `GAA: ${(g.ga / g.gp).toFixed(2)}`], said: `${g.w} wins, saving ${sv}` };
    }
    if (p?.gp) return { pos: 'F', stats: [`G: ${p.g}`, `A: ${p.a}`, `PTS: ${p.g + p.a}`], said: `${p.g} goals and ${p.a} assists` };
    return null;
  }
  const bats = ex?.ledger?.bats, arms = ex?.ledger?.arms, a = arms instanceof Map ? arms.get(name) : null, b = bats instanceof Map ? bats.get(name) : null;
  if (as === 'arm' && !a?.outs) return null;
  if (a?.outs && (as === 'arm' || !b?.ab)) { const era = ((a.er * 27) / a.outs).toFixed(2); return { pos: 'P', stats: [`W-L: ${a.w}-${a.l}`, `ERA: ${era}`, `K: ${a.k}`], said: `${a.w} and ${a.l} with an earned run average of ${era}` }; }
  if (b?.ab) { const avg = (b.hits / b.ab).toFixed(3).replace(/^0/, ''); return { pos: 'BAT', stats: [`AVG: ${avg}`, `HR: ${b.hr}`, `RBI: ${b.rbi}`], said: `hitting ${avg} with ${b.rbi} driven in` }; }
  return null;
}

export function personOf(sport, name, team, ctx, { as, ...extra } = {}) {
  if (!name) return null;
  const s = seasonOf(sport, name, ctx.season, as);
  return { name, team: team || '', num: String(sweaterNumber(sport, name)), colour: colourOf(ctx, team), league: sport, pos: s?.pos || '', stats: s?.stats || [], said: s?.said || '', ...extra };
}

// ── Hockey ─────────────────────────────────────────────────────────────────────────────────────
function hockeyFacts(game, beats, at, ctx) {
  const sport = 'hockey', goals = [], penalties = [], fights = [], injuries = [], tally = new Map();
  let shotsAway = 0, shotsHome = 0, hits = 0, deaths = 0, leadChanges = 0, lastLeader = 0, section = '';
  const man = (name, team) => { let m = tally.get(name); if (!m) { m = { name, team, g: 0, a: 0 }; tally.set(name, m); } return m; };
  const shotBy = (team) => { if (team === game.away.name) shotsAway++; else shotsHome++; };
  for (const b of beats) {
    if (b.section && b.section !== 'F') section = b.section;
    if (b.type === 'chance' && ON_GOAL.has(b.kind)) shotBy(b.teamName);
    else if (b.type === 'goal') {
      shotBy(b.teamName);
      man(b.shooter, b.teamName).g++;
      if (b.assist) man(b.assist, b.teamName).a++;
      goals.push({ n: goals.length + 1, player: b.shooter, assist: b.assist || '', team: b.teamName, period: b.section, clock: b.clockStr, strength: b.strength || 'even', awayScore: b.awayScore, homeScore: b.homeScore });
      const lead = Math.sign((b.awayScore ?? 0) - (b.homeScore ?? 0));
      if (lead && lead !== lastLeader) { if (lastLeader) leadChanges++; lastLeader = lead; }
    } else if (b.type === 'penalty') penalties.push({ n: penalties.length + 1, player: b.player, team: b.teamName, infraction: b.infraction, minutes: b.penaltyMin, period: b.section, clock: b.clockStr });
    else if (b.type === 'fight') fights.push({ n: fights.length + 1, winner: b.winner, loser: b.loser, period: b.section });
    else if (b.type === 'boards') hits++;
    else if (b.type === 'injury') injuries.push({ n: injuries.length + 1, player: b.player || b.victim || '', team: b.teamName || b.victimTeam || '', wound: b.wound || b.label || '', period: b.section });
    else if (b.type === 'death') deaths++;
  }
  const end = at === 'end', last = beats[beats.length - 1];
  const awayScore = end ? game.awayScore : last?.awayScore ?? 0, homeScore = end ? game.homeScore : last?.homeScore ?? 0;
  const lineOf = (m) => `${m.g} G, ${m.a} A`;
  const scored = [...tally.values()].sort((a, b) => (b.g * 2 + b.a) - (a.g * 2 + a.a) || b.g - a.g || a.name.localeCompare(b.name));
  const person = (m) => personOf(sport, m.name, m.team, ctx, { tonight: lineOf(m), goals: m.g, assists: m.a });
  const lastG = goals[goals.length - 1], firstG = goals[0];
  const goalPerson = (g) => (g ? personOf(sport, g.player, g.team, ctx, { clock: g.clock, period: g.period, assist: g.assist, tonight: lineOf(tally.get(g.player)) }) : null);
  const hatTrick = scored.find((m) => m.g >= 3);
  const nextOrd = { '1st': '2nd', '2nd': '3rd' }[section] || 'overtime';
  const facts = {
    section, nextOrd, shotsAway, shotsHome, shots: shotsAway + shotsHome, hits, deaths,
    penalties, goals, fights, injuries, leadChanges,
    penaltyCount: penalties.length, fightCount: fights.length, goalCount: goals.length, injuryCount: injuries.length,
    goalsSaid: said(goals.length, 'goal', 'goals'), fightsSaid: said(fights.length, 'fight', 'fights'), injuriesSaid: said(injuries.length, 'man', 'men'),
    stars: scored.slice(0, 3).map((m, i) => ({ n: i + 1, ...person(m) })),
    ...(lastG ? { lastGoal: goalPerson(lastG), firstGoal: goalPerson(firstG) } : {}),
    ...(scored[0] ? { gameStar: person(scored[0]) } : {}),
    ...(hatTrick ? { hatTrick: person(hatTrick) } : {}),
    awayGoalie: personOf(sport, game.away.goalie, game.away.name, ctx), homeGoalie: personOf(sport, game.home.goalie, game.home.name, ctx),
    overtime: end ? !!game.overtime : false, shootout: end ? !!game.shootout : false,
    ...(end ? hockeyEnd(game, beats, goals, goalPerson, ctx) : {}),
  };
  const status = !beats.length ? 'TONIGHT' : end ? 'FINAL' : `${section} INTERMISSION`;
  return { awayScore, homeScore, status, facts };
}
// How a hockey game was decided, for the booth after it: the goal that put the winner ahead for
// good (`decider`, and the period it came in as said), or the shootout's winner, how it ended
// (`endedIn`), and how far down the winner was (`comebackFrom`, `comebackSaid`).
const PERIOD_SAID = { '1st': 'the first', '2nd': 'the second', '3rd': 'the third', OT: 'overtime' };
const DOWN_SAID = ['', 'down one', 'down two', 'down three', 'down four', 'down five'];
function hockeyEnd(game, beats, goals, goalPerson, ctx) {
  const win = game.awayScore > game.homeScore ? game.away.name : game.home.name;
  let lead = 0, worst = 0, decider = null;
  for (const g of goals) {
    const was = lead;
    lead += g.team === win ? 1 : -1;
    worst = Math.min(worst, lead);
    if (g.team === win && was <= 0 && lead > 0) decider = g;
  }
  const so = !!game.shootout;
  const soWin = so ? [...beats].reverse().find((b) => b.type === 'shootout' && b.scored && b.teamName === win) : null;
  const soEnd = so ? beats.find((b) => b.type === 'shootout_end') : null;
  const out = {
    endedIn: so ? 'a shootout' : game.overtime ? 'overtime' : 'regulation',
    regulation: !game.overtime,
    ...(worst < 0 ? { comebackFrom: -worst, comebackSaid: DOWN_SAID[-worst] || `down ${-worst}` } : {}),
  };
  if (!so && decider) out.decider = { ...goalPerson(decider), periodSaid: PERIOD_SAID[decider.period] || decider.period || '', strength: decider.strength || 'even' };
  if (soWin) out.soWinner = { ...personOf('hockey', soWin.shooter, soWin.teamName, ctx), round: soWin.round };
  if (soEnd) out.soScore = `${Math.max(soEnd.soAway, soEnd.soHome)}-${Math.min(soEnd.soAway, soEnd.soHome)}`;
  return out;
}

// ── Deadball ───────────────────────────────────────────────────────────────────────────────────
const HIT = new Set(['single', 'double', 'triple', 'homerun']);
function baseballFacts(game, beats, at, ctx) {
  const sport = 'baseball', homers = [], tally = new Map(), line = new Map();
  let hitsAway = 0, hitsHome = 0, strikeouts = 0, errors = 0, leadChanges = 0, lastLeader = 0, inning = 0, half = '';
  const man = (name, team) => { let m = tally.get(name); if (!m) { m = { name, team, hits: 0, rbi: 0, hr: 0 }; tally.set(name, m); } return m; };
  let scoreA = 0, scoreH = 0;
  for (const b of beats) {
    if (b.inning) { inning = b.inning; half = b.half || half; }
    if (b.type !== 'atbat' && b.type !== 'run') continue;
    if (b.type === 'atbat') {
      const m = man(b.batter, b.battingName), top = b.half === 'top';
      if (HIT.has(b.kind)) { m.hits++; if (top) hitsAway++; else hitsHome++; }
      m.rbi += b.rbi || 0;
      if (b.kind === 'strikeout') strikeouts++;
      if (b.kind === 'error') errors++;
      if (b.kind === 'homerun') { m.hr++; homers.push({ n: homers.length + 1, player: b.batter, team: b.battingName, inning: ordinal(b.inning), rbi: b.rbi || 1 }); }
    }
    const was = [scoreA, scoreH];
    scoreA = b.awayScore ?? scoreA; scoreH = b.homeScore ?? scoreH;
    const r = line.get(b.inning) || { inning: ordinal(b.inning), away: 0, home: 0 };
    r.away += scoreA - was[0]; r.home += scoreH - was[1];
    if (r.away || r.home) line.set(b.inning, r);
    const lead = Math.sign(scoreA - scoreH);
    if (lead && lead !== lastLeader) { if (lastLeader) leadChanges++; lastLeader = lead; }
  }
  const end = at === 'end';
  const lineOf = (m) => `${m.hits} H, ${m.rbi} RBI${m.hr ? `, ${m.hr} HR` : ''}`;
  const best = [...tally.values()].filter((m) => m.hits || m.rbi).sort((a, b) => (b.rbi * 2 + b.hits + b.hr * 2) - (a.rbi * 2 + a.hits + a.hr * 2) || a.name.localeCompare(b.name));
  const person = (m) => personOf(sport, m.name, m.team, ctx, { tonight: lineOf(m), hits: m.hits, rbi: m.rbi, homers: m.hr });
  const lastHr = homers[homers.length - 1];
  const facts = {
    section: inning ? ordinal(inning) : '', nextOrd: inning ? `${half === 'top' ? 'bottom' : 'top'} of the ${ordinal(half === 'top' ? inning : inning + 1)}` : '',
    inning, hitsAway, hitsHome, hits: hitsAway + hitsHome, strikeouts, errors, leadChanges,
    homers, homerCount: homers.length, homersSaid: said(homers.length, 'home run', 'home runs'), scoring: [...line.values()],
    stars: best.slice(0, 3).map((m, i) => ({ n: i + 1, ...person(m) })),
    ...(best[0] ? { gameStar: person(best[0]) } : {}),
    ...(lastHr ? { lastHomer: personOf(sport, lastHr.player, lastHr.team, ctx, { inning: lastHr.inning, rbi: lastHr.rbi }) } : {}),
    awayStarter: personOf(sport, game.away.pitcher, game.away.name, ctx, { as: 'arm', pos: 'SP' }), homeStarter: personOf(sport, game.home.pitcher, game.home.name, ctx, { as: 'arm', pos: 'SP' }),
    extras: end ? game.innings > 9 : false, innings: end ? game.innings : inning,
    ...(end ? baseballEnd(game, beats, ctx) : {}),
  };
  const awayScore = end ? game.awayScore : scoreA, homeScore = end ? game.homeScore : scoreH;
  const status = !beats.length ? 'TONIGHT' : end ? 'FINAL' : inning === 7 ? 'SEVENTH-INNING STRETCH' : `${half === 'top' ? 'TOP' : 'BOTTOM'} ${ordinal(inning)}`;
  return { awayScore, homeScore, status, facts };
}
// How a ballgame was decided, for the booth after it: the play that put the winner ahead for good
// (`decider`: who, in which inning, and the play as said), a walk-off, how long it went
// (`endedIn`), and how far down the winner was (`comebackFrom`, `comebackSaid`).
const PLAY_SAID = {
  single: 'a single', double: 'a double', triple: 'a triple', homerun: 'a home run', walk: 'a walk', hitbypitch: 'a hit batter',
  sacfly: 'a sacrifice fly', error: 'an error', doubleplay: 'a double play', popout: 'a pop-up', doublesteal: 'a double steal', productout: 'a ground ball', groundout: 'a ground ball', flyout: 'a fly ball',
  wildpitch: 'a wild pitch', passedball: 'a passed ball', steal: 'a steal', stealhome: 'a steal of home', balk: 'a balk',
};
const RUNS_DOWN = ['', 'down a run', 'down two', 'down three', 'down four', 'down five', 'down six'];
function baseballEnd(game, beats, ctx) {
  const win = game.awayScore > game.homeScore ? game.away.name : game.home.name, winAway = win === game.away.name;
  let a = 0, h = 0, worst = 0, decider = null;
  for (const b of beats) {
    if (b.type !== 'atbat' && b.type !== 'run') continue;
    const wasLead = winAway ? a - h : h - a;
    a = b.awayScore ?? a; h = b.homeScore ?? h;
    const lead = winAway ? a - h : h - a;
    worst = Math.min(worst, lead);
    if (wasLead <= 0 && lead > 0) decider = b;
  }
  const last = [...beats].reverse().find((b) => b.type === 'atbat');
  const out = {
    walkoff: !!last?.walkoff,
    endedIn: game.innings > 9 ? `${game.innings} innings` : 'nine',
    ...(worst < 0 ? { comebackFrom: -worst, comebackSaid: RUNS_DOWN[-worst] || `down ${-worst}` } : {}),
  };
  if (decider) {
    const who = decider.type === 'run' && decider.runner ? decider.runner : decider.batter;
    out.decider = personOf('baseball', who, decider.battingName || win, ctx, {
      inning: ordinal(decider.inning), half: decider.half || '', play: PLAY_SAID[decider.kind] || 'the go-ahead run', rbi: decider.rbi || 0,
    });
  }
  return out;
}

// ── The feed ───────────────────────────────────────────────────────────────────────────────────
export function factsAt(sport, game, at = null, ctx = {}) {
  const i = at && at !== 'end' ? game.beats.indexOf(at) : -1;
  const beats = at === 'end' ? game.beats : i >= 0 ? game.beats.slice(0, i + 1) : [];
  const { awayScore, homeScore, status, facts } = (sport === 'hockey' ? hockeyFacts : baseballFacts)(game, beats, at, ctx);
  const margin = Math.abs(awayScore - homeScore), away = game.away.name, home = game.home.name;
  const lead = awayScore === homeScore ? '' : awayScore > homeScore ? away : home, behind = !lead ? '' : lead === away ? home : away;
  const ex = ctx.season || {}, men = ['away', 'home'].flatMap((side) => watchOf(sport, game[side], ex).list.map((m) => ({ ...m, team: game[side].name })));
  const out = ['away', 'home'].flatMap((side) => watchOf(sport, game[side], ex).out);
  const manOf = (m) => personOf(sport, m.name, m.team, ctx, { as: m.role === 'SP' ? 'arm' : 'bat', pos: m.role, stat: m.stat, said: m.said });
  const star = men[0] ? manOf(men[0]) : null;
  return {
    sport, away, home, awayScore, homeScore, status, margin, tied: margin === 0, leader: lead, trailer: behind,
    awayRecord: ctx.records?.(away) ?? '', homeRecord: ctx.records?.(home) ?? '', awayColour: colourOf(ctx, away), homeColour: colourOf(ctx, home),
    ...(star ? { star } : {}),
    watch: men.map((m, n) => ({ n: n + 1, ...manOf(m) })),
    missing: out.map((name, n) => ({ n: n + 1, name })), missingCount: out.length, missingSaid: said(out.length, 'man', 'men'),
    ...(ctx.rows?.length ? { table: ctx.rows.slice(0, 8).map((r, n) => ({ n: n + 1, team: r.team, wins: r.wins ?? r.w ?? 0, losses: r.losses ?? r.l ?? 0, points: r.points ?? '' })) } : {}),
    ...(at === 'end' && lead ? { winner: lead, loser: behind, shutout: Math.min(awayScore, homeScore) === 0 } : {}),
    ...facts,
  };
}

// The beat a moment means, on a game: `break` is the first intermission or the stretch, or the
// `n`th of them, and the booth's moments are the desk's (`booth_cut` is the `n`th of boothCuts).
// For the Studio's samples: a broadcast calls factsAt with the beat it's at.
export function momentBeat(sport, game, moment, n = 0) {
  if (moment === 'open' || moment === 'booth_open') return null;
  if (moment === 'close' || moment === 'booth_end') return 'end';
  if (moment === 'booth_cut') { const c = boothCuts(sport, game); return c.length ? c[Math.min(n, c.length - 1)].beat : 'end'; }
  const stops = game.beats.filter((b) => (sport === 'hockey' ? b.type === 'period_end' && b.section !== '3rd' && !b.sudden : b.type === 'half_start' && b.inning === 7 && b.half === 'bottom'));
  return stops[Math.min(n, stops.length - 1)] || 'end';
}
// The facts at a moment, with a cut's own: what a broadcast hands the show at that moment.
export function momentFacts(sport, game, moment, n = 0, ctx = {}) {
  const facts = factsAt(sport, game, momentBeat(sport, game, moment, n), ctx);
  if (moment !== 'booth_cut') return facts;
  const c = boothCuts(sport, game);
  return c.length ? { ...facts, ...cutFacts(sport, c[Math.min(n, c.length - 1)], ctx) } : facts;
}

// ── The cut to the booth ───────────────────────────────────────────────────────────────────────
// Now and then the picture leaves the play for the two men in the press box, after something
// worth stopping for. `boothCuts` is every such moment in a game, in order: a hat trick, a man
// killed, a fight, and in the third a goal that ties it or puts a side ahead; in Deadball a grand
// slam, and from the 7th to the 9th a play that ties it or puts a side ahead. Never the play that
// ends a game: the booth has the end to itself. `pickBoothCut` takes one at most, each kind on
// its sport's odds (BOOTH_CUT_ODDS) off the caller's own stream. Measured over 150 games, about
// one hockey game in four has a cut and one ballgame in seven; a hat trick is common in this league.
export const BOOTH_CUT_ODDS = Object.freeze({
  hockey: { hattrick: 0.25, death: 0.5, fight: 0.05, late: 0.15 },
  baseball: { grandslam: 0.6, late: 0.4 },
});
export function boothCuts(sport, game) {
  const out = [], beats = game.beats || [];
  if (sport === 'hockey') {
    const goalsBy = new Map();
    for (const b of beats) {
      if (b.type === 'goal' && b.section !== 'OT') {
        const n = (goalsBy.get(b.shooter) || 0) + 1;
        goalsBy.set(b.shooter, n);
        const mine = b.teamName === game.away.name ? b.awayScore - b.homeScore : b.homeScore - b.awayScore;
        if (n === 3) out.push({ beat: b, cut: 'hattrick', player: b.shooter, team: b.teamName });
        else if (b.section === '3rd' && (mine === 0 || mine === 1)) out.push({ beat: b, cut: 'late', player: b.shooter, team: b.teamName, tied: mine === 0 });
      } else if (b.type === 'death' && b.player) out.push({ beat: b, cut: 'death', player: b.player, team: b.teamName || '' });
      else if (b.type === 'fight' && b.winner) out.push({ beat: b, cut: 'fight', player: b.winner, team: b.winnerTeam || '', loser: b.loser || '' });
    }
    return out;
  }
  let a = 0, h = 0;
  for (const b of beats) {
    if (b.type !== 'atbat' && b.type !== 'run') continue;
    const top = b.half === 'top', was = top ? a - h : h - a;
    a = b.awayScore ?? a; h = b.homeScore ?? h;
    const now = top ? a - h : h - a;
    if (b.walkoff || b.inning > 9 || now <= was) continue;
    if (b.type === 'atbat' && b.kind === 'homerun' && (b.rbi || 0) >= 4) out.push({ beat: b, cut: 'grandslam', player: b.batter, team: b.battingName });
    else if (b.inning >= 7 && was <= 0 && (now === 0 || now === 1)) out.push({ beat: b, cut: 'late', player: b.type === 'run' && b.runner ? b.runner : b.batter, team: b.battingName, tied: now === 0, play: PLAY_SAID[b.kind] || 'the play' });
  }
  return out;
}
export function pickBoothCut(sport, cuts, rand) {
  const odds = BOOTH_CUT_ODDS[sport] || {};
  for (const c of cuts) if (rand() < (odds[c.cut] ?? 0)) return c;
  return null;
}
// What a cut tells the show: which kind it is (`cut`), the man it's about (`cutMan`, a person),
// the man he beat in a fight (`cutLoser`), whether the play tied it (`cutTied`), and the play as said.
export function cutFacts(sport, c, ctx = {}) {
  if (!c) return {};
  return {
    cut: c.cut, cutMan: personOf(sport, c.player, c.team, ctx), cutTied: !!c.tied,
    ...(c.loser ? { cutLoser: personOf(sport, c.loser, '', ctx) } : {}),
    ...(c.play ? { cutPlay: c.play } : {}),
    status: sport === 'hockey' ? `${c.beat.section || ''} PERIOD`.trim() : `${c.beat.half === 'top' ? 'TOP' : 'BOTTOM'} ${ordinal(c.beat.inning)}`,
  };
}
