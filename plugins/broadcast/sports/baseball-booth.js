/**
 * DEADBALL — the booth between the plays.
 *
 * Real baseball is mostly the time between pitches, and a booth fills it: who's up and what
 * he's hitting, what the pitcher throws, how each man's season is going against what he's
 * supposed to be, what happened the last time these two met tonight, and two men talking
 * about nothing much. This writes that talk. The play-by-play man (`@announcer`) sets things
 * up and the colour man (`@analyst`) answers; his lines go out as "Name says, ..." so a TV
 * shows who's talking and the voice is seeded off his name, not the station's.
 *
 * Every plate appearance has a budget of seconds from the broadcast (index.js), and the booth
 * spends it: before the pitch, the man coming up and whatever's worth saying about him or the
 * pitcher; after it, a reaction when the play earns one. Each topic is told once a game, so a
 * batter's fourth trip gets something new or nothing. Every line is optional to the pacer
 * (baseball-pacing.js), which keeps the most needed when a slot is short.
 *
 * What it knows, and all of it true: the season so far as each payload carries it (`bl`, `pl`,
 * folded from the standings ledger), the league leaders, the clubs' records, what's happened
 * tonight (counted here as the plays go by), and each man's style (pitcherStyleOf,
 * batterTypeOf). The styles are from names and the numbers are from the sim, which never reads
 * a style, so a power bat can be in a slump all season. That's a storyline, not a bug.
 *
 * Pools (data/scripts/baseball.bsm). Which voice a pool opens with is fixed by its key: `story`,
 * `scout`, `tonight`, `duel` and `react` are the colour man's, the rest the play-by-play man's.
 * A line split by "||" is an exchange, its turns alternating from that first voice.
 *
 * Pure and seeded: its own stream (`rand`), so it moves no other line.
 */
import { sportsFill } from '../rng.js';
import { pitcherStyleOf, batterTypeOf, eraOf, LINEUP_POSITIONS } from './baseball.js';
import { POSITIONS } from '../../../client/game/js/panels/diamond/play.js';
import { holdFor } from './baseball-pacing.js';

const COLOUR = /^(story|scout|tonight|duel|react)\b/;
const PITCH_WORD = { 'Four-Seam Fastball': 'fastball', Sinker: 'sinker', Slider: 'slider', Changeup: 'changeup', Curveball: 'curveball', Cutter: 'cutter', Splitter: 'splitter', Knuckleball: 'knuckleball' };
const DELIVERY_KEY = { 'over the top': 'over', 'three-quarters': 'threequarter', sidearm: 'sidearm', submarine: 'submarine' };
const HIT = new Set(['single', 'double', 'triple', 'homerun']);
const NO_AB = new Set(['walk', 'hitbypitch', 'sacfly']);
const GREAT = new Set(['diving', 'leaping', 'sliding', 'ranging', 'barehand', 'rail']);
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const words = (n) => (n >= 0 && n < NUM.length ? NUM[n] : String(n));
// 'no home runs', 'one home run', '14 home runs': small numbers in words, as a booth says them
const count = (n, one, many = `${one}s`) => `${n >= 0 && n <= 10 ? words(n) : n} ${n === 1 ? one : many}`;
const secsOf = (text) => holdFor(text) / 1000;

export const avgText = (h, ab) => {
  if (!ab) return '.000';
  const v = Math.round((1000 * h) / ab);
  return v >= 1000 ? '1.000' : `.${String(v).padStart(3, '0')}`;
};
// ── how hard the booth sells it ───────────────────────────────────────────────
// Baseball is calm until it isn't: the voice stays level through a 9-2 game and climbs only
// for a big play, or any play that matters late in a close one. `stakes` (0-1) is how much the
// moment matters before the pitch: the innings left, the margin, men on and two out. `exciteFor`
// is the call's `excite` (-1..1 for AudioEngine.speak), the play's size scaled by the stakes,
// and a walk-off is always all the way up. `phase` 'before' is the lean-in while he comes up,
// and only in a big spot; 'after' is the reaction, already coming down.
const PLAY_SIZE = { homerun: 0.75, tripleplay: 0.85, doubleplay: 0.5, triple: 0.5, double: 0.4, sacfly: 0.35,
  error: 0.35, single: 0.3, strikeout: 0.25, walk: 0.1, hitbypitch: 0.15, productout: 0.2, steal: 0.3, stealhome: 0.8 };
export function stakesOf(b, home = '', bases = null) {
  const runs = b.runs ?? b.rbi ?? 0;
  const homeBats = b.battingName === home;
  const hs = (b.homeScore ?? 0) - (homeBats ? runs : 0), as = (b.awayScore ?? 0) - (homeBats ? 0 : runs);
  const margin = Math.abs(hs - as);
  const close = margin === 0 ? 1 : margin === 1 ? 0.9 : margin === 2 ? 0.55 : margin === 3 ? 0.25 : 0;
  const late = Math.max(0, Math.min(1, ((b.inning || 1) - 5) / 4));
  const on = Array.isArray(bases) ? bases.filter(Boolean).length : 0;
  return Math.max(0, Math.min(1, close * (0.25 + 0.75 * late) + 0.06 * on * close));
}
export function exciteFor(b, home = '', phase = 'call', bases = null) {
  if (!b) return 0;
  const s = stakesOf(b, home, bases);
  if (phase === 'before') return s >= 0.6 ? Math.round(0.3 * s * 100) / 100 : 0;
  if (b.walkoff) return phase === 'after' ? 0.7 : 1;
  let size = PLAY_SIZE[b.kind] ?? (b.out ? 0.1 : 0.3);
  if (b.kind === 'homerun' && (b.rbi || 0) >= 4) size = 0.9;
  if ((b.runs ?? b.rbi ?? 0) > 0) size = Math.max(size, 0.45);
  // the out that ends a big inning is a big out
  if (b.out && b.outs >= 3) size += 0.35 * s;
  const x = Math.min(1, size * (0.55 + 0.65 * s));
  return Math.round((phase === 'after' ? x * 0.6 : x) * 100) / 100;
}

const rankIn = (list, name) => (Array.isArray(list) ? list.slice(0, 3).findIndex((r) => r.name === name) : -1);

// `pools` the script's line pools, `rand` the booth's stream, `game` the sim's game, `leaders`
// gamedayLeaders' shape, `recordOf(team)` the club's record, `ledger` the season's every-man
// ledger (for a pitcher's own batting line).
export function makeBooth({ pools, rand, announcer = '', analyst = '', game, leaders = null, recordOf = () => '', ledger = null }) {
  const used = new Set();          // lines aired tonight
  const told = new Set();          // topics told tonight
  const night = { bats: new Map(), arms: new Map(), met: new Map() };
  let grp = 0;

  // A pool has something to say while it has a line not yet aired tonight; once it's spent it
  // stays quiet rather than repeat itself (the 'up' pools excepted: a man still has to come up).
  const REUSABLE = /^up(\.|$)/;
  const has = (key) => Array.isArray(pools?.[key]) && pools[key].length > 0 && (REUSABLE.test(key) || pools[key].some((l) => !used.has(l)));
  const draw = (key) => {
    const L = pools[key];
    const fresh = L.filter((l) => !used.has(l));
    const from = fresh.length ? fresh : L;
    const l = from[Math.floor(rand() * from.length)];
    used.add(l);
    return l;
  };
  // A pool's line as spoken lines, the exchange's turns alternating voices. Each carries its
  // priority for the pacer and the exchange's group.
  const render = (key, tok, p) => {
    if (!has(key)) return [];
    let colour = COLOUR.test(key);
    const g = grp++;
    return draw(key).split(/\s*\|\|\s*/).map((t) => {
      const said = sportsFill(t, tok).trim();
      const voice = colour; colour = !colour;
      if (!said) return null;
      // inside his quotes a nickname's quotes go single: Dusty Merriman says, "... 'Wheels' McGraw ..."
      return { text: voice && analyst ? `${analyst} says, "${said.replace(/"/g, "'")}"` : said, secs: secsOf(said), opt: { p, g } };
    }).filter(Boolean);
  };
  const first = (...keys) => keys.find(has) || null;

  const batNight = (name) => night.bats.get(name) || { pa: 0, ab: 0, h: 0, hr: 0, k: 0, bb: 0, rbi: 0, last: '' };
  const armNight = (name) => night.arms.get(name) || { bf: 0, k: 0, runs: 0, hits: 0, bb: 0, from: 0 };
  const tonightText = (r) => {
    let s = `${r.h ? words(r.h) : 'oh'} for ${words(r.ab)}`;
    if (r.hr) s += r.hr > 1 ? ` with ${words(r.hr)} home runs` : ' with a home run';
    else if (r.k >= 2) s += ` with ${words(r.k)} strikeouts`;
    else if (r.bb) s += r.bb > 1 ? ` and ${words(r.bb)} walks` : ' and a walk';
    return s;
  };

  // Every token a booth line can use, for the man up and the man pitching to him.
  function tokens(b, gd) {
    const bl = gd?.bl || [0, 0, 0, 0, 0], pl = gd?.pl || [0, 0, 0, 0, 0];
    const ps = pitcherStyleOf(b.pitcher), bt = batterTypeOf(b.batter);
    const bn = batNight(b.batter), pn = armNight(b.pitcher);
    const hrL = leaders?.hr?.[0], avgL = leaders?.avg?.[0], sbL = leaders?.sb?.[0], kL = leaders?.k?.[0];
    return {
      announcer, analyst, batter: b.batter || '', pitcher: b.pitcher || '',
      team: b.battingName || '', fielding: b.fieldingName || '', home: game?.home?.name || '', away: game?.away?.name || '',
      inningOrd: gd?.inningOrd || '',
      avg: avgText(bl[1], bl[0]), ab: bl[0], hits: bl[1], hr: bl[2], rbi: bl[3], sb: bl[4],
      hrWord: words(bl[2]), sbWord: words(bl[4]),
      hrs: count(bl[2], 'home run'), rbis: count(bl[3], 'run batted in', 'runs batted in'), sbs: count(bl[4], 'stolen base'),
      pks: count(pl[4], 'strikeout'), nks: count(pn.k, 'strikeout'), wl: `${pl[0]} and ${pl[1]}`,
      pAvg: avgText(ledger?.bats?.get(b.pitcher)?.hits || 0, ledger?.bats?.get(b.pitcher)?.ab || 0),
      chip: String(announcer).split(' ')[0], dusty: String(analyst).split(' ')[0],
      tonight: tonightText(bn),
      type: bt.type,
      pitch: PITCH_WORD[ps.out] || 'fastball', pitch2: PITCH_WORD[ps.second] || 'fastball',
      velo: ps.top, delivery: ps.delivery,
      pw: pl[0], pl: pl[1], era: eraOf({ outs: pl[2], er: pl[3] }).toFixed(2), pk: pl[4],
      nk: pn.k, nkWord: words(pn.k), runs: pn.runs, runsWord: words(pn.runs),
      record: recordOf(b.battingName), fieldRecord: recordOf(b.fieldingName),
      hrLeader: hrL?.name || '', hrLead: hrL?.hr ?? '', avgLeader: avgL?.name || '', avgLead: avgL ? avgText(Math.round(avgL.avg * 1000), 1000) : '',
      sbLeader: sbL?.name || '', sbLead: sbL?.sb ?? '', kLeader: kL?.name || '', kLead: kL?.k ?? '',
      hrLeaderTeam: hrL?.team || '', kLeaderTeam: kL?.team || '',
    };
  }

  // What's worth saying about the batter, best first: [topic, pool, priority].
  function batterTopics(b, gd) {
    const out = [];
    const bl = gd?.bl || [0, 0, 0, 0, 0];
    const [ab, h, hr, , sb] = bl;
    const avg = ab ? h / ab : 0, rate = ab ? hr / ab : 0;
    const { type, speedy } = batterTypeOf(b.batter);
    const bn = batNight(b.batter);
    const met = night.met.get(`${b.batter}|${b.pitcher}`);
    if (met) out.push(['duel', met === 'strikeout' ? 'duel.k' : HIT.has(met) ? (met === 'homerun' ? 'duel.hr' : 'duel.hit') : NO_AB.has(met) ? 'duel.walk' : 'duel.out', 3]);
    if (bn.hr) out.push(['tonight', 'tonight.hitter.hr', 3]);
    else if (bn.h >= 2) out.push(['tonight', 'tonight.hitter.multi', 3]);
    else if (bn.ab >= 3 && !bn.h) out.push(['tonight', 'tonight.hitter.hitless', 2]);
    if (rankIn(leaders?.hr, b.batter) >= 0 && hr > 0) out.push(['story', 'story.leader.hr', 3]);
    else if (rankIn(leaders?.avg, b.batter) >= 0 && ab >= 40) out.push(['story', 'story.leader.avg', 3]);
    else if (rankIn(leaders?.sb, b.batter) >= 0 && sb > 0) out.push(['story', 'story.leader.sb', 3]);
    if (ab >= 40) {
      if (type === 'power' && rate < 0.025) out.push(['story', 'story.power.slump', 2]);
      if (type === 'power' && rate >= 0.055) out.push(['story', 'story.power.hot', 2]);
      if (type !== 'power' && hr >= 4 && rate >= 0.045) out.push(['story', 'story.power.surprise', 2]);
      if (type === 'contact' && avg >= 0.315) out.push(['story', 'story.contact.hot', 2]);
      if (type === 'contact' && avg < 0.225) out.push(['story', 'story.contact.cold', 2]);
      if (type === 'glove' && avg >= 0.29) out.push(['story', 'story.glove.hitting', 2]);
      if (type === 'glove' && avg < 0.215) out.push(['story', 'story.glove.cold', 2]);
      if (type === 'balanced' && avg >= 0.31) out.push(['story', 'story.hot', 2]);
      if (type === 'balanced' && avg < 0.205) out.push(['story', 'story.cold', 2]);
      if (speedy && sb >= 4) out.push(['legs', 'story.speed.running', 2]);
      if (speedy && sb === 0 && ab >= 60) out.push(['legs', 'story.speed.idle', 2]);
    }
    out.push(['scout', `scout.${type}`, 1]);
    if (speedy) out.push(['legs', 'scout.speed', 1]);
    return out;
  }
  // And about the man pitching to him.
  function pitcherTopics(b, gd) {
    const out = [];
    const pl = gd?.pl || [0, 0, 0, 0, 0];
    const [w, l, outs, , k] = pl;
    const era = eraOf({ outs: pl[2], er: pl[3] });
    const ps = pitcherStyleOf(b.pitcher);
    const pn = armNight(b.pitcher);
    if (pn.k >= 5) out.push(['tonight', 'tonight.pitcher.k', 3]);
    if (pn.runs === 0 && b.inning >= 5) out.push(['zeros', 'tonight.pitcher.zeros', 3]);
    if (pn.runs >= 5) out.push(['rocky', 'tonight.pitcher.rocky', 3]);
    out.push(['scout.pitch', `scout.pitch.${ps.style}`, 2]);
    if (rankIn(leaders?.k, b.pitcher) >= 0 && k > 0) out.push(['story', 'story.leader.k', 2]);
    if (outs >= 45 && era < 2.9) out.push(['story', 'story.pitcher.ace', 2]);
    if (outs >= 45 && era > 5.4) out.push(['story', 'story.pitcher.rough', 2]);
    if (w - l >= 3) out.push(['record', 'story.pitcher.winning', 1]);
    if (l - w >= 3) out.push(['record', 'story.pitcher.losing', 1]);
    if ((ledger?.bats?.get(b.pitcher)?.ab || 0) >= 10) out.push(['twoway', 'story.twoway', 1]);
    out.push(['scout.delivery', `scout.delivery.${DELIVERY_KEY[ps.delivery]}`, 1]);
    if (ps.tempo !== 'even') out.push(['scout.tempo', `scout.tempo.${ps.tempo}${gd?.basesBefore?.[0] ? '.runner' : ''}`, 1]);
    return out;
  }
  // The first topic not yet told tonight whose pool has lines.
  const fresh = (who, list) => list.find(([topic, key]) => !told.has(`${who}:${topic}`) && has(key));
  const tell = (who, item, tok, out) => { told.add(`${who}:${item[0]}`); const ls = render(item[1], tok, item[2]); out.push(...ls); return ls.reduce((a, l) => a + l.secs, 0); };

  // Filler: an exchange or a line of colour, chosen by what has the most left unaired.
  const filler = (tok, out) => {
    const key = rand() < 0.6 ? first('banter', 'chatter') : first('chatter', 'banter');
    if (!key) return 0;
    const ls = render(key, tok, 1);
    out.push(...ls);
    return ls.reduce((a, l) => a + l.secs, 0) || 0;
  };

  // The talk as the batter comes up, in about `secs` seconds.
  function before(b, gd, secs) {
    const out = [];
    if (!(secs > 2.5) || b.type !== 'atbat') return out;
    const tok = tokens(b, gd);
    const bn = batNight(b.batter);
    let left = secs;
    // who's up: the first time with his season, later with his night
    // (with no season on the payload, nothing about his season: the first day, or no ledger)
    const ab = gd?.bl ? gd.bl[0] : 0;
    const key = bn.pa === 0 ? (ab < 15 ? first('up.early', 'up') : first('up.first', 'up'))
      : !bn.ab ? first('up') : ab >= 15 && rand() < 0.4 ? first('up.again.season', 'up.again', 'up') : first('up.again', 'up');
    if (key) { const ls = render(key, tok, 3); out.push(...ls); left -= ls.reduce((a, l) => a + l.secs, 0); }
    // then what's worth saying, the batter and the pitcher taking turns at going first
    const pair = rand() < 0.6
      ? [['b', batterTopics(b, gd)], ['p', pitcherTopics(b, gd)]]
      : [['p', pitcherTopics(b, gd)], ['b', batterTopics(b, gd)]];
    for (const [who, list] of pair) {
      if (left <= 3) break;
      const item = fresh(`${who}:${who === 'b' ? b.batter : b.pitcher}`, list);
      if (item) left -= tell(`${who}:${who === 'b' ? b.batter : b.pitcher}`, item, tok, out);
    }
    // the situation, once an inning
    const margin = Math.abs((gd?.awayScore ?? 0) - (gd?.homeScore ?? 0));
    const bases = gd?.basesBefore || [false, false, false];
    const sit = bases.every(Boolean) ? 'sit.loaded' : (bases[1] || bases[2]) ? 'sit.risp'
      : b.inning >= 8 && margin <= 1 ? 'sit.late' : margin >= 6 ? 'sit.blowout' : null;
    const sitTopic = `sit:${b.inning}${b.half}:${sit}`;
    if (left > 3 && sit && has(sit) && !told.has(sitTopic)) { told.add(sitTopic); const ls = render(sit, tok, 2); out.push(...ls); left -= ls.reduce((a, l) => a + l.secs, 0); }
    // and passing the time, a line or an exchange, two when there's plenty of it: the pacer
    // leaves air between lines rather than have the booth talk wall to wall
    let guard = 0;
    while (left > 5 && guard++ < (left > 40 ? 2 : 1)) { const s = filler(tok, out); if (!s) break; left -= s; }
    return out;
  }

  // The talk after the play, when it earns some, in no more than about `secs` seconds.
  function after(b, gd, secs) {
    const out = [];
    if (!(secs > 2.5) || b.type !== 'atbat') return out;
    const tok = tokens(b, gd);
    const ps = pitcherStyleOf(b.pitcher), bt = batterTypeOf(b.batter);
    const bl = gd?.bl || [0, 0, 0, 0, 0];
    const lastPitch = gd?.pitches?.[gd.pitches.length - 1];
    let key = null;
    if (b.kind === 'homerun') {
      tok.hr = bl[2] + 1; tok.hrWord = words(bl[2] + 1); tok.hrs = count(bl[2] + 1, 'home run');
      key = rankIn(leaders?.hr, b.batter) >= 0 ? first('react.hr.leader', 'react.hr')
        : bt.type === 'power' && bl[0] >= 40 && bl[2] / bl[0] < 0.025 ? first('react.hr.slump', 'react.hr')
          : bt.type === 'power' ? first('react.hr.power', 'react.hr')
            : bt.type === 'glove' || bt.type === 'contact' ? first('react.hr.surprise', 'react.hr') : first('react.hr');
    } else if (b.kind === 'strikeout') {
      if (lastPitch && lastPitch.type === ps.out && rand() < 0.7) { tok.pitch = PITCH_WORD[lastPitch.type] || tok.pitch; key = first('react.k.outpitch'); }
      else if (tok.nk >= 6) key = first('react.k.many');
    } else if (HIT.has(b.kind) && bt.type === 'power' && bl[0] >= 40 && bl[2] / bl[0] < 0.025 && rand() < 0.5) {
      key = first('react.hit.slump');
    } else if (b.kind === 'doubleplay' && ps.style === 'sinkerballer') {
      key = first('react.dp.sinker', 'react.dp');
    } else if (b.kind === 'doubleplay' && rand() < 0.5) {
      key = first('react.dp');
    } else if (b.out && gd?.play && GREAT.has(gd.play.g)) {
      // the man who made it, from where he plays
      const pos = POSITIONS[gd.play.f?.[0]];
      const side = game?.home?.name === b.fieldingName ? game.home : game?.away;
      const fielder = pos === 'P' ? b.pitcher : side?.lineup?.[LINEUP_POSITIONS.indexOf(pos)];
      if (fielder) {
        tok.fielderName = fielder;
        key = batterTypeOf(fielder).type === 'glove' ? first('react.glove', 'react.defence') : first('react.defence');
      }
    } else if (b.kind === 'walk' && (ps.style === 'flamethrower' || ps.style === 'knuckleballer') && rand() < 0.4) {
      key = first(`react.walk.${ps.style}`, 'react.walk');
    }
    if (key) out.push(...render(key, tok, 2));
    if (out.reduce((a, l) => a + l.secs, 0) > secs + 6) out.length = 0;
    // then the time till the next man's up is the booth's, a line or an exchange, two when
    // there's plenty of it
    let left = secs - out.reduce((a, l) => a + l.secs, 0), guard = 0;
    while (left > 8 && guard++ < (left > 40 ? 2 : 1)) { const s2 = filler(tok, out); if (!s2) break; left -= s2; }
    return out;
  }

  // Over a half-inning's changeover: the starting pitchers in the first inning, the leaders and
  // the table later on, the seventh-inning stretch, and talk.
  function changeover(hs, hp, secs) {
    const out = [];
    if (!(secs > 3)) return out;
    const b = { batter: '', pitcher: hs.pitcher || '', battingName: hs.battingName, fieldingName: hs.fieldingName, inning: hs.inning, half: hs.half, type: 'half' };
    const tok = { ...tokens(b, { pl: hp?.pl, inningOrd: hp?.inningOrd, awayScore: hs.awayScore, homeScore: hs.homeScore }), inningOrd: hp?.inningOrd || '' };
    let left = secs;
    const take = (key, p) => { const ls = render(key, tok, p); out.push(...ls); left -= ls.reduce((a, l) => a + l.secs, 0); };
    if (hs.inning === 7 && hs.half === 'bottom' && has('break.stretch')) take('break.stretch', 2);
    else if (hs.inning === 5 && hs.half === 'bottom' && has('break.drag')) take('break.drag', 2);
    // a pitcher's first inning: his style, once
    const ps = pitcherStyleOf(hs.pitcher);
    const who = `p:${hs.pitcher}`;
    if (hs.inning === 1 && hs.pitcher && !told.has(`${who}:scout.pitch`) && has(`scout.pitch.${ps.style}`)) {
      told.add(`${who}:scout.pitch`);
      const starter = (hp?.pl?.[2] || 0) > 0 ? 'break.starter' : first('break.starter.new', 'break.starter');
      if (starter && has(starter)) take(starter, 2);
      if (left > 3) take(`scout.pitch.${ps.style}`, 2);
    }
    const races = [['leaders.hr', 'break.leaders.hr', leaders?.hr?.length], ['leaders.avg', 'break.leaders.avg', leaders?.avg?.length], ['leaders.sb', 'break.leaders.sb', leaders?.sb?.length], ['leaders.k', 'break.leaders.k', leaders?.k?.length], ['standings', 'break.standings', tok.record && tok.record !== '0-0']];
    for (const [topic, key, ok] of races) {
      if (left <= 4) break;
      if (!ok || told.has(topic) || !has(key) || hs.inning < 2 || rand() < 0.5) continue;
      told.add(topic); take(key, 2);
    }
    let guard = 0;
    while (left > 5 && guard++ < 3) { const s = filler(tok, out); if (!s) break; left -= s; }
    return out;
  }

  // Count the play into tonight's lines, after it's been called.
  function track(b, gd) {
    if (b.type !== 'atbat' || !b.batter) return;
    const r = { ...batNight(b.batter) };
    r.pa++; r.last = b.kind;
    if (!NO_AB.has(b.kind)) r.ab++;
    if (HIT.has(b.kind)) r.h++;
    if (b.kind === 'homerun') r.hr++;
    if (b.kind === 'strikeout') r.k++;
    if (b.kind === 'walk' || b.kind === 'hitbypitch') r.bb++;
    r.rbi += b.rbi || 0;
    night.bats.set(b.batter, r);
    const a = { ...armNight(b.pitcher) };
    a.bf++;
    if (b.kind === 'strikeout') a.k++;
    if (HIT.has(b.kind)) a.hits++;
    if (b.kind === 'walk') a.bb++;
    a.runs += Number.isFinite(gd?.runs) ? gd.runs : (b.runs ?? b.rbi ?? 0);
    night.arms.set(b.pitcher, a);
    night.met.set(`${b.batter}|${b.pitcher}`, b.kind);
  }
  // A run scored on the bases (a steal of home, a wild pitch) counts against the pitcher too.
  function trackRun(b, gd) {
    if (!b.pitcher) return;
    const runs = Number.isFinite(gd?.runs) ? gd.runs : (b.runs || 0);
    if (runs > 0) { const a = { ...armNight(b.pitcher) }; a.runs += runs; night.arms.set(b.pitcher, a); }
  }

  return { before, after, changeover, track, trackRun };
}
