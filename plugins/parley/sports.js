// parley: talking sport. Mention a Cluster Puck or Deadball club, the league, the Cup or
// "did you see the game?" and whoever you're talking to reacts by how much they care.
//
// Interest is per NPC: `flags.sports_interest` ('none' | 'casual' | 'fan'), else a hash of
// their id (about a third don't care, a quarter are fans). The club they back is the one
// sports-banter gives them, so a man who argues about the Crows here cheers for them when
// the game's on. A fan in the room who backs a different club, above all the rival, can't
// keep out of it (`exchange`), and it gets louder when both clubs are in the Cup.
//
// Sync and query-free: the league is sports-banter's pinned copy, the Cup is sportsleague's
// season cache.

import { currentLeague } from '../sports-banter/index.js';
import { clubFor, primaryClub, rivalOf } from '../sports-banter/fans.js';
import { cupFinalists } from '../sportsleague/index.js';

const hashOf = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

const SPORT_NAME = { hockey: 'Cluster Puck', baseball: 'Deadball' };
const LEAGUE_NAME = { hockey: 'the CPhL', baseball: 'the league' };
const CUP_NAME = { hockey: 'the Cup', baseball: 'the Curtain Call' };

// 0 none, 1 casual, 2 fan.
export function interestOf(npc) {
  const own = npc?.flags?.sports_interest;
  if (own === 'none') return 0;
  if (own === 'casual') return 1;
  if (own === 'fan') return 2;
  if (!npc?.id) return 0;
  const h = hashOf(`${npc.id}|sport`) % 100;
  return h < 35 ? 0 : h < 75 ? 1 : 2;
}

// "the Crows". Birds and Rats keep the word before, as sports-banter says them.
export function clubWord(team) {
  const w = String(team || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  const last = w[w.length - 1];
  return `the ${w.length > 1 && /^(birds|rats|sox)$/i.test(last) ? w.slice(-2).join(' ') : last}`;
}

// Every way a club gets named in a line, longest first. A last word two clubs share
// (Sox, Birds) isn't enough on its own.
let aliasCache = { league: null, list: [] };
function aliases(league) {
  if (aliasCache.league === league) return aliasCache.list;
  const lastCount = new Map();
  for (const t of league.teams) { const l = t.toLowerCase().split(/\s+/).pop(); lastCount.set(l, (lastCount.get(l) || 0) + 1); }
  const list = [];
  for (const t of league.teams) {
    const w = t.toLowerCase().split(/\s+/);
    list.push([t.toLowerCase(), t]);
    if (w.length > 2) list.push([w.slice(-2).join(' '), t]);
    const last = w[w.length - 1].replace(/s$/, '');
    if (lastCount.get(w[w.length - 1]) === 1 && w[w.length - 1].length > 3) { list.push([w[w.length - 1], t]); list.push([last, t]); }
  }
  list.sort((a, b) => b[0].length - a[0].length);
  aliasCache = { league, list };
  return list;
}

const HOCKEY = /\b(?:hockey|cluster ?puck|cphl|puck|coldwater cup|the cup|stanley)\b/;
const BASEBALL = /\b(?:deadball|baseball|ball ?game|curtain call|innings?|home runs?|pitcher)\b/;
const CUP = /\b(?:the cup|coldwater cup|curtain call|the final|finals|playoffs?|championship)\b/;
const WATCH = /\b(?:did you|have you|you) (?:watch|see|catch|hear about) (?:the|that|last night|yesterday)|\bwho won\b|\bwhat was the score\b|\bthe score\b|\bwatch the game\b/;
const GENERAL = /\b(?:the game|the match|the league|sports?|team|club|fan of|support|rooting for|who do you (?:back|support|follow))\b/;

// → { sport, team, cup, watch } or null when the line isn't about sport.
export function sportsMention(t) {
  const text = ` ${String(t || '')} `;
  const league = currentLeague();
  let team = null;
  for (const [alias, name] of aliases(league)) {
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) { team = name; break; }
  }
  const hockey = HOCKEY.test(text), baseball = BASEBALL.test(text);
  const cup = CUP.test(text), watch = WATCH.test(text);
  if (!team && !hockey && !baseball && !cup && !watch && !GENERAL.test(text)) return null;
  const sport = team ? league.sportOf.get(team) || null : hockey ? 'hockey' : baseball ? 'baseball' : /\bcup\b/.test(text) ? 'hockey' : null;
  return { sport, team, cup, watch };
}

// What the line is to this NPC.
export function sportsSituation(npc, mention) {
  const level = interestOf(npc);
  const league = currentLeague();
  let sport = mention.sport;
  if (!sport) { const p = primaryClub(npc, league); sport = p ? league.sportOf.get(p) : null; }
  const club = sport ? clubFor(npc, sport, league) : null;
  const rival = rivalOf(club, league);
  const finals = sport ? cupFinalists(sport) : null;
  const base = { level, sport, club, rival, team: mention.team, finals };
  if (!level) return { ...base, sit: 'bored' };
  if (!club) return { ...base, sit: 'other_league', club: primaryClub(npc, league) };
  if (finals && (mention.cup || finals.includes(mention.team) || mention.watch)) {
    if (finals.includes(club)) return { ...base, sit: 'cup_own', foe: finals.find((t) => t !== club) };
    if (rival && finals.includes(rival)) return { ...base, sit: 'cup_rival', foe: rival };
    if (mention.cup) return { ...base, sit: 'cup' };
  }
  if (mention.team === club) return { ...base, sit: 'own' };
  if (mention.team && mention.team === rival) return { ...base, sit: 'rival' };
  if (mention.team) return { ...base, sit: 'other' };
  if (mention.watch) return { ...base, sit: 'watch' };
  if (mention.cup) return { ...base, sit: 'cup' };
  return { ...base, sit: 'league' };
}

// Lines by situation, then fan (2) or casual (1). {mine} their club, {rival} its rival,
// {team} the club you named, {foe} the other side in the Cup, {sport} {league} {cup}.
export const LINES = {
  bored: [[
    '*shrugs.* I don\'t follow it.', 'Sport? Not really my thing.', 'Couldn\'t tell you. I don\'t watch.',
    'Grown men chasing a puck. No thanks.', '*looks blank.* Is that the hockey or the other one?',
    'You\'d want somebody else for that.', 'I had it on once. Fell asleep.',
  ]],
  other_league: [
    ['I don\'t really follow {sport}.', '{Sport}\'s not really my game.'],
    ['{sport}? No. I\'m {mine}, me. Different game.', 'Don\'t talk to me about {sport}. Talk to me about {mine}.', '*waves it off.* {sport}\'s for people who can\'t handle the real thing. {Mine}.'],
  ],
  own: [
    ['Oh, I like {mine}. Don\'t watch every game.', '{Mine}? Yeah, they\'re alright.', 'I keep an eye on {mine}. When I remember.'],
    ['*face lights up.* {Mine}! Now you\'re talking.', 'You\'re a {mine} fan? Get in. Come here.', '{Mine}, best club in the city. Don\'t let anyone tell you different.', '*bangs the counter.* {Mine}! Finally, somebody with taste.', 'I\'ve got {mine} tattooed somewhere. Not telling you where.'],
  ],
  rival: [
    ['{Team}? Hm. Not my lot.', 'Can\'t say I like {team} much.'],
    ['*pulls a face.* {Team}? Wash your mouth out.', 'Don\'t say that name in here. I\'m {mine}.', '{Team}. *spits.* Bunch of cheats.', 'I\'d rather watch paint dry than {team}. {Mine} till I die.', 'You can leave if you\'re {team}. I\'m joking. Mostly.'],
  ],
  other: [
    ['{Team}? They\'re fine, I suppose.', 'Don\'t mind {team}. I\'m more {mine}.'],
    ['{Team}? Decent side. Not {mine}, though.', '{Team} are alright. As long as they beat {rival}.', '*thinks.* {Team}. Good keeper. Soft middle. {Mine} would have them.'],
  ],
  watch: [
    ['Caught a bit of it. Did {mine} win?', 'I had it on in the background.', 'Saw the end. Not bad.'],
    ['Watched every minute. Don\'t ask me about {mine}\'s defence.', 'Course I watched. Did you see {mine}? Did you SEE them?', 'I was up shouting at the set till gone midnight.', 'Every second. My voice is still gone.'],
  ],
  league: [
    ['I watch now and then. I\'m {mine}, if anyone.', 'Bit of {sport} on the set, why not.'],
    ['{League}? Best thing in this city. {Mine}, all day.', 'Don\'t get me started on {league}. Actually, do.', 'I\'m {mine}. Been {mine} since I was a kid.', '*leans in.* You follow {sport}? Who do you back?'],
  ],
  cup: [
    ['{Cup}\'s on, isn\'t it? Might watch.', 'Who\'s in {cup}? I lose track.'],
    ['{Cup}! Whole city stops for it.', 'Not my lot in {cup} this time. Still watching.', 'Whoever wins {cup}, I just hope it\'s not {rival}.'],
  ],
  cup_own: [
    ['{Mine} are in {cup}, aren\'t they? Good for them.', 'I might actually watch {cup}. {Mine}, you know.'],
    ['*grabs your arm.* {Mine} are in {cup}. {Cup}! Against {foe}!', 'I haven\'t slept. {Mine} in {cup}. I can\'t eat.', '{Foe} don\'t know what\'s coming. {Mine} for {cup}!', 'If {mine} win {cup} I\'m buying the whole bar a drink. Hold me to it.', 'I\'ve had {cup} circled since spring. {Mine}. This is the year.'],
  ],
  cup_rival: [
    ['{Rival} in {cup}. Ugh.', 'Hope {rival} lose {cup}. That\'s all.'],
    ['{Rival} in {cup}. I feel sick.', 'Anyone but {rival}. I\'ll cheer for whoever\'s playing them.', 'If {rival} win {cup} I\'m leaving the city.', '*grim.* {Rival}. In {cup}. There\'s no justice.'],
  ],
};

// When a fan in the room backs another club, they chip in. Even turns are theirs (B),
// odd turns the one you were talking to (A). {to} the other one's first name.
export const THREADS = {
  cup_feud: [
    ['{Mine} are going to bury {theirs} in {cup}, {to}.', 'Big talk. {Theirs} haven\'t beaten us all year.', 'They\'ll win the one that counts.', 'Fiver says they don\'t.', 'Make it a tenner.'],
    ['*turns round.* Did I hear {theirs}? In {cup}? Enjoy it while it lasts.', 'Oh, here we go. {To}\'s woken up.', 'Woken up, warmed up. {Mine} lift it this year.', 'You said that last year.', 'Last year I was being polite.'],
    ['{Cup} against {theirs}. I\'ve waited my whole life for this.', 'And you\'ll wait a bit longer. {Mine}.', 'You lot couldn\'t score in an empty rink.', 'Remind me who\'s top of the table, {to}?', '*stands up.* Remind me after {cup}.'],
  ],
  feud: [
    ['{Theirs}? *laughs.* Don\'t listen to {to}, they don\'t know anything.', 'Says the {mine} fan. How\'s the bottom of the table?', 'Better than being {theirs}.'],
    ['*from across the room.* {Theirs}! Boo!', 'Oh, shut up, {to}.', '{Mine} forever. {Theirs} never.'],
    ['You\'re never talking up {theirs} in front of me.', 'In front of you, behind you, every day, {to}.', '*mutters.* Bloody {theirs} fans.'],
  ],
  clash: [
    ['{Theirs}? Nah. {Mine}, mate.', '{Mine} couldn\'t beat a team of drunks, {to}.'],
    ['*leans over.* {Mine} are better, for the record.', 'Nobody asked you, {to}.'],
  ],
  together: [
    ['*overhears.* {Mine}! Good lad.', 'Told you, {to}. Everyone\'s {mine} in here.'],
    ['Are we talking {mine}? *pulls up a stool.*', 'Course we are, {to}. Sit down.'],
  ],
};

const cap = (s) => s && s.charAt(0).toUpperCase() + s.slice(1);
export function fillSports(line, tok) {
  let ok = true;
  const out = String(line).replace(/\{([A-Za-z]+)\}/g, (m, key) => {
    const v = tok[key.toLowerCase()];
    if (!v) { ok = false; return m; }
    return key[0] === key[0].toUpperCase() ? cap(v) : v;
  });
  return ok ? out : null;
}

export function tokensOf(s, extra = {}) {
  return {
    mine: clubWord(s.club), rival: clubWord(s.rival), team: clubWord(s.team), foe: clubWord(s.foe),
    sport: SPORT_NAME[s.sport] || 'the game', league: LEAGUE_NAME[s.sport] || 'the league', cup: CUP_NAME[s.sport] || 'the Cup',
    ...extra,
  };
}

const pick = (a, rand = Math.random) => a[Math.floor(rand() * a.length)];

// One line for this NPC about the mention, or null.
export function sportsLine(npc, mention, rand = Math.random) {
  const s = sportsSituation(npc, mention);
  const pools = LINES[s.sit];
  const pool = (pools[Math.min(s.level, pools.length) - 1] || pools[0] || []).slice();
  const tok = tokensOf(s);
  while (pool.length) {
    const i = Math.floor(rand() * pool.length);
    const text = fillSports(pool.splice(i, 1)[0], tok);
    if (text) return { text, s };
  }
  return null;
}

// A fan in the room who'll join in when `s` (the addressee's situation) is raised: the rival
// first, then any other club, then their own side. → { other, type, turns } or null.
const lastExchange = new Map();   // zoneId → ms
const EXCHANGE_GAP_MS = 45_000;
const firstName = (npc) => {
  const w = String(npc?.name || '').trim().split(/\s+/)[0] || '';
  return /^[A-Z]/.test(w) && !/^(The|A|An)$/.test(w) ? w : null;
};

export function exchangeFor(npc, s, room, zoneId, rand = Math.random, now = Date.now()) {
  if (!s?.club || s.sit === 'bored' || s.sit === 'other_league' || s.level < 1) return null;
  if (zoneId && now - (lastExchange.get(zoneId) || 0) < EXCHANGE_GAP_MS) return null;
  const league = currentLeague();
  const finals = s.finals;
  const cands = [];
  for (const o of room) {
    if (o.id === npc.id || !firstName(o) || !firstName(npc)) continue;
    const lv = interestOf(o);
    if (!lv) continue;
    const c = clubFor(o, s.sport, league);
    if (!c) continue;
    const cupFeud = finals && finals.includes(c) && finals.includes(s.club) && c !== s.club;
    const type = cupFeud ? 'cup_feud' : c === s.rival ? 'feud' : c !== s.club ? 'clash' : 'together';
    const want = { cup_feud: 1, feud: 0.9, clash: 0.55, together: 0.4 }[type] * (lv === 2 ? 1 : 0.5) * (s.level === 2 ? 1 : 0.7);
    cands.push({ o, c, type, want, rank: { cup_feud: 0, feud: 1, clash: 2, together: 3 }[type] });
  }
  cands.sort((a, b) => a.rank - b.rank || b.want - a.want);
  const best = cands[0];
  if (!best || rand() > best.want) return null;
  const tokB = tokensOf({ ...s, club: best.c, rival: rivalOf(best.c, league) }, { theirs: clubWord(s.club), to: firstName(npc) });
  const tokA = tokensOf(s, { theirs: clubWord(best.c), to: firstName(best.o) });
  const threads = THREADS[best.type].slice().sort(() => rand() - 0.5);
  for (const th of threads) {
    const turns = th.map((l, i) => fillSports(l, i % 2 === 0 ? tokB : tokA));
    if (turns.every(Boolean)) {
      if (zoneId) lastExchange.set(zoneId, now);
      return { other: best.o, type: best.type, turns };
    }
  }
  return null;
}
export function _resetExchanges() { lastExchange.clear(); }

// A passing remark that tells you they follow it, without saying "ask me about sport".
export const HINTS = [
  '*glances up at the set.* Is the game on yet?',
  '*checks the time.* Puck drops soon.',
  '*hums something that might be a terrace chant.*',
  'Long as {mine} win tonight, I don\'t care.',
  '*has a {mine} scarf tucked half in a pocket.*',
  'I\'ve got money on {mine}. Don\'t tell anyone.',
];
export function sportsHint(npc, rand = Math.random) {
  if (interestOf(npc) < 2) return null;
  const league = currentLeague();
  const club = primaryClub(npc, league);
  if (!club) return null;
  return fillSports(pick(HINTS, rand), { mine: clubWord(club) });
}
