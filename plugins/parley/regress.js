// parley regression suite, run by tests/regress.js. The parser against a table of
// lines, then a conversation with a made-up barkeep in memory: greeting, insults
// (warmth and mood), a deflect for gibberish, no repeats, topics, and the end.
import { parse } from './parse.js';
import { answer, partnerOf, _test } from './index.js';
import { _resetTalks, splitLine } from './react.js';
import { converse, _resetGossip, _resetOverheard } from './company.js';
import { getRelation } from '../../server/engine/relations.js';
import { npcMoodOf } from '../../server/engine/npc-mood.js';
import { world } from '../../server/engine/world.js';
import { _setHintChance, HINT_CHANCE, withHint } from './hints.js';
import { sportsMention, sportsSituation, interestOf, exchangeFor, _resetExchanges } from './sports.js';
import { namedPerson, relationBetween, _resetNames } from './people.js';
import { sideOf, politicsLine, politicsMention, opposed } from './politics.js';
import { _test as banter } from '../sports-banter/index.js';
import { makeLeague } from '../sports-banter/fans.js';

// [line, expected act]
const TABLE = [
  ['hello', 'greet'], ['hi there', 'greet'], ['hey lowry', 'greet'], ['evening', 'greet'], ['good morning!', 'greet'],
  ['yo', 'greet'], ['howdy partner', 'greet'], ['hiya', 'greet'], ['heya mate', 'greet'], ['nice to meet you', 'greet'],
  ['bye', 'farewell'], ['goodbye then', 'farewell'], ['see you around', 'farewell'], ['good night', 'farewell'], ['i should go', 'farewell'],
  ['cya', 'farewell'], ['take care', 'farewell'], ['gotta go', 'farewell'],
  ['thanks', 'thank'], ['thank you so much', 'thank'], ['cheers', 'thank'], ['thx', 'thank'], ['much obliged', 'thank'], ['appreciate it', 'thank'],
  ['you are an idiot', 'insult'], ['shut up', 'insult'], ['you smell terrible', 'insult'], ['screw you', 'insult'], ['what a dump', 'insult'],
  ['i hate you', 'insult'], ['useless old man', 'insult'], ['you look awful', 'insult'], ['piss off', 'insult'], ['moron', 'insult'],
  ['you are gorgeous', 'flirt'], ['i like you', 'flirt'], ['come here often?', 'flirt'], ['you look lovely tonight', 'flirt'], ['marry me', 'flirt'],
  ['kiss me', 'flirt'], ['are you single?', 'flirt'], ['i fancy you', 'flirt'],
  ['sorry', 'apologise'], ['i am sorry about that', 'apologise'], ['my bad', 'apologise'], ['forgive me', 'apologise'], ['soz', 'apologise'],
  ['i did not mean it', 'apologise'],
  ['this is a great bar', 'praise'], ['nice place', 'praise'], ['brilliant', 'praise'], ['well done', 'praise'], ['nice vest', 'praise'],
  ['that glass is clean', 'praise'], ['not bad', 'praise'], ['love this place', 'praise'], ['impressive', 'praise'],
  ['how are you?', 'ask_feeling'], ['how is your day', 'ask_feeling'], ['you okay?', 'ask_feeling'], ['rough night?', 'ask_feeling'],
  ['how is business', 'ask_feeling'], ['sup', 'ask_feeling'], ['how have you been', 'ask_feeling'], ['long shift?', 'ask_feeling'],
  ['can i get a beer', 'order_drink'], ['pour me a whiskey', 'order_drink'], ['i would like a gin', 'order_drink'], ['same again', 'order_drink'],
  ['another one', 'order_drink'], ['a pint please', 'order_drink'], ['what do you recommend', 'order_drink'], ['get me a vodka', 'order_drink'],
  ['haha', 'joke'], ['lol', 'joke'], ['just kidding', 'joke'], ['knock knock', 'joke'],
  ['this is overpriced', 'complain'], ['the beer is warm beer', 'complain'], ['what a rip off', 'complain'], ['slow service', 'complain'],
  ['not great', 'complain'],
  ['yes', 'agree'], ['sure', 'agree'], ['exactly', 'agree'], ['fair enough', 'agree'], ['of course', 'agree'], ['yep', 'agree'],
  ['no', 'disagree'], ['nah', 'disagree'], ['not really', 'disagree'], ['nonsense', 'disagree'],
  ['tell me about the hotel', 'ask_about'], ['what is with the vest?', 'ask_about'], ['why do you polish that glass?', 'ask_about'],
  ['how do i rent a room?', 'ask_about'], ['the embassy', 'ask_about'], ['what is coldwater like?', 'ask_about'], ['who plays poker here?', 'ask_about'],
  ['asdfgh', 'gibberish'], ['zzzzzz', 'gibberish'], ['qwrtp', 'gibberish'],
  ['the quantum potato manifesto', 'unknown'], ['purple monkey dishwasher', 'unknown'],
];
const TOPICS = {
  embassy: ['embassy', 'hotel', 'this place'], vest: ['vest'], glass: ['glass'], rooms: ['room', 'rent'],
  city: ['coldwater'], poker: ['poker'],
};

const NPC = {
  id: 'npc_regress_parley', name: 'Lowry Regress', zone_id: 'zone_regress_parley',
  flags: { parley: {
    topics: TOPICS,
    react: {
      greet: { stranger: ['*nods.* Evening.', 'Welcome.'], familiar: ['{name}, again.'] },
      insult: ['Noted.', 'Charming.', 'Lovely.'],
      insult_last: ['*sets the glass down.* Out.'],
      'ask_about:embassy': ['It was a hotel.'],
      farewell: ['Mind how you go.'],
    },
    deflect: ['Quite.', 'Hm.', 'Is that an order?', 'I will pretend you said something nice.'],
  } },
};
const player = () => ({ id: 'regress_parley_player', handle: 'Tester', current_zone: 'zone_regress_parley', _relations: new Map() });

export default async function regress({ check }) {
  const hintChance = HINT_CHANCE;
  _setHintChance(0);   // the exact-line checks below; hints get their own section
  // ── The parser ────────────────────────────────────────────────────────────
  let right = 0;
  const wrong = [];
  for (const [line, want] of TABLE) {
    const got = parse(line, { topics: TOPICS, names: ['Lowry', 'Regress'] }).act;
    if (got === want) right++; else wrong.push(`${line} → ${got} (want ${want})`);
  }
  check(`the parser reads the table (${right}/${TABLE.length})`, wrong.length === 0, wrong.join('; '));
  check('a topic comes back with ask_about', parse('tell me about the hotel', { topics: TOPICS }).topic === 'embassy');
  check('a name is an address, not content', parse('lowry', { names: ['Lowry'] }).act === 'gibberish');
  check('a line is split into action and speech',
    JSON.stringify(splitLine('*nods.* Evening.')) === JSON.stringify({ act: 'nods.', say: 'Evening.' }));

  // ── A conversation ────────────────────────────────────────────────────────
  _resetTalks();
  _test.partners.clear();
  const p = player();
  const hi = answer(NPC, p, 'hello');
  check('a greeting gets a greeting', hi.key === 'greet' && ['nods.', ''].includes(hi.line.act), JSON.stringify(hi));
  check('…and you are now talking to them', _test.partners.get(p.id)?.npcId === NPC.id);

  const before = getRelation(p, NPC.id).warmth;
  const ins = answer(NPC, p, 'you are an idiot');
  check('an insult gets an insult answer', ins.key === 'insult');
  check('…and costs warmth', getRelation(p, NPC.id).warmth < before, `${before} → ${getRelation(p, NPC.id).warmth}`);
  check('…and makes them angry', npcMoodOf(NPC)?.m === 'angry', JSON.stringify(npcMoodOf(NPC)));

  const gib = answer(NPC, p, 'qwrtpz');
  check('gibberish gets a deflect', gib.key === 'deflect');
  check('a deflect moves nothing', getRelation(p, NPC.id).familiarity === 1);

  const said = new Set();
  let repeat = false;
  for (let i = 0; i < 3; i++) {
    const r = answer(NPC, p, 'the quantum potato manifesto');
    if (said.has(r.line.say)) repeat = true;
    said.add(r.line.say);
  }
  check('no deflect repeats while there are fresh ones', !repeat, [...said].join(' | '));

  check('a topic gets its own answer', answer(NPC, p, 'what was the embassy?').line.say === 'It was a hotel.');

  answer(NPC, p, 'moron');
  const third = answer(NPC, p, 'shut up');
  check('the third insult ends it', third.key === 'insult_last' && third.ended);
  check('…and they stop listening to unnamed lines', partnerOf(p) === null);
  check('the {name} token is filled', (answer(NPC, { ...player(), id: 'regress_parley_b', _relations: new Map([[NPC.id, { familiarity: 10, warmth: 40 }]]) }, 'hi').line.say) === 'Tester, again.');

  // ── The generic layer ─────────────────────────────────────────────────────
  const plain = { id: 'npc_regress_parley_plain', name: 'Dana Plain', zone_id: 'zone_regress_parley', flags: {} };
  const q = player();
  const nm = answer(plain, q, 'what is your name?');
  check('somebody with no lines still gives their name', nm?.generic && /Dana/.test(nm.line.say), JSON.stringify(nm));
  check('somebody called by what they are has no name to give',
    !/chrome/i.test(answer({ ...plain, id: 'npc_regress_parley_att', name: 'chrome attendant' }, q, 'what is your name?').line.say));
  check('…but says nothing to a line nobody could read', answer(plain, q, 'the quantum potato manifesto') === null);
  check('…unless it was said to their face', answer(plain, q, 'the quantum potato manifesto', { direct: true })?.key === 'deflect');
  const barkeep = { ...plain, id: 'npc_regress_parley_bar', flags: { personality: 'bartender' } };
  check('a bartender answers a drinks order as a bartender', /menu|What'll/.test(answer(barkeep, q, 'can i get a beer').line.say));
  check('an own line beats the generic one', answer(NPC, player(), 'hello').generic === false);
  check("flags.parley false keeps somebody out of it", answer({ ...plain, flags: { parley: false } }, q, 'hello') === null);
  const acts = { 'who are you?': 'ask_name', 'what do you do?': 'ask_job', 'where are you from?': 'ask_origin',
    'heard anything?': 'ask_news', 'any advice?': 'ask_advice', 'i am new here': 'ask_advice' };
  const bad = Object.entries(acts).filter(([l, a]) => parse(l).act !== a).map(([l, a]) => `${l} → ${parse(l).act} (want ${a})`);
  check('the question acts are read', !bad.length, bad.join('; '));

  // ── Beats ─────────────────────────────────────────────────────────────────
  const teller = { id: 'npc_regress_parley_beat', name: 'Beat Teller', zone_id: 'zone_regress_parley', flags: { parley: {
    topics: { hotel: ['hotel'] },
    react: { 'ask_about:hotel': ['Just a hotel.'] },
    beats: [{ id: 'past', topic: 'hotel', tier: 'known', steps: ['One.', 'Two.', 'Three.'], warmth: 7 }],
  } } };
  const b = player(); b.id = 'regress_parley_beat'; b._flags = new Map();
  check('a beat stays shut to a stranger', answer(teller, b, 'tell me about the hotel').line.say === 'Just a hotel.');
  b._relations.set(teller.id, { familiarity: 5, warmth: 0 });
  b._flags.set(`parley_beat:${teller.id}:past`, '0');
  // A hydrated cache is written through setFlag; this player has no row, so keep it in RAM.
  delete b._flags;
  const told = ['tell me about the hotel', 'and the hotel?', 'what about the hotel?'].map((l) => answer(teller, b, l).line.say);
  check('…and opens once they know you, a step at a time', told.join(' ') === 'One. Two. Three.', told.join(' '));
  check('…then the ordinary answer comes back', answer(teller, b, 'the hotel?').line.say === 'Just a hotel.');
  const c2 = player(); c2.id = 'regress_parley_beat_2'; c2._relations.set(teller.id, { familiarity: 5, warmth: 0 });
  answer(teller, c2, 'the hotel?');
  check('"go on" carries on the story', answer(teller, c2, 'go on').line.say === 'Two.');
  check('the last step warmed them', getRelation(b, teller.id).warmth >= 7, JSON.stringify(getRelation(b, teller.id)));

  // ── In company ────────────────────────────────────────────────────────────
  _resetGossip(); _resetOverheard();
  const bar = { id: 'npc_regress_parley_bar2', name: 'Barry Keep', flags: { parley: {
    topics: { poker: ['poker'] }, defer: { poker: 'npc_regress_parley_deal' }, circle: ['npc_regress_parley_deal'],
    react: { greet: ['Evening.'], 'defer:poker': ['Ask {other}.'], gossip_rude: ['{other} says you were rude.'] },
  } } };
  const deal = { id: 'npc_regress_parley_deal', name: 'Dee Dealer', flags: { parley: {
    topics: { poker: ['poker'] }, circle: ['npc_regress_parley_bar2'],
    react: { 'ask_about:poker': ['Seat\'s open.'], overheard: ['I heard my name.'], insult: ['Noted.'] },
  } } };
  const room = [bar, deal];
  const t = player(); t.id = 'regress_parley_company';
  const talkTo = (to, l) => converse({ player: t, npc: to, text: l, room, direct: true });
  const h = talkTo(bar, 'who plays poker?');
  check('a topic left to somebody else gets "ask them"', h.out.key === 'defer' && h.out.line.say === 'Ask Dee.', JSON.stringify(h.out));
  check('…and they answer it', h.extra[0]?.npc === deal && h.extra[0].line.say === 'Seat\'s open.');
  check('…and the talk moves to them', h.partner === deal);
  const o = talkTo(bar, 'what do you make of dee?');
  check('somebody named while you talk chips in', o.extra.some((x) => x.npc === deal && x.key === 'overheard'));
  check('…but only once a minute', !talkTo(bar, 'dee again').extra.some((x) => x.key === 'overheard'));
  talkTo(deal, 'you are an idiot');
  _resetTalks();
  const g = talkTo(bar, 'hello');
  check('rudeness to one reaches their circle', g.out.key === 'gossip' && g.out.line.say === 'Dee says you were rude.', JSON.stringify(g.out));
  _resetTalks();
  check('…and is said once', talkTo(bar, 'hello').out.key !== 'gossip');
  check('a compliment is never handed off', talkTo(bar, 'poker is great').out.key !== 'defer');

  // ── Sport ─────────────────────────────────────────────────────────────────
  const prevLeague = banter.getLeague();
  banter.setLeague(makeLeague({
    teams: ['Yard Birds', 'Westside Warlords', 'Boomtown Bulldogs', 'Coldwater Crows', 'Basin Blue Birds'],
    sports: { 'Yard Birds': 'hockey', 'Westside Warlords': 'hockey', 'Boomtown Bulldogs': 'hockey', 'Coldwater Crows': 'baseball', 'Basin Blue Birds': 'baseball' },
    rivals: { 'Yard Birds': 'Westside Warlords', 'Westside Warlords': 'Yard Birds', 'Coldwater Crows': 'Basin Blue Birds', 'Basin Blue Birds': 'Coldwater Crows' },
  }));
  const m = (l) => sportsMention(parse(l).text);
  check('a club is heard by its nickname', m('the warlords are rubbish')?.team === 'Westside Warlords');
  check('two clubs called Birds stay apart', m('go yard birds')?.team === 'Yard Birds' && m('blue birds!')?.team === 'Basin Blue Birds');
  check('"did you see the game" is heard', m('did you see the game last night?')?.watch === true);
  check('a line about nothing sporty is not', m('nice weather today') === null);
  const fan = (id, club) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Fan`, flags: { sports_interest: 'fan', fav_team: club } });
  const birdman = fan('tobias', 'Yard Birds'), warman = fan('warren', 'Westside Warlords');
  const nobody = { id: 'nofan', name: 'Nora Nofan', flags: { sports_interest: 'none' } };
  check('somebody who does not care says so', sportsSituation(nobody, m('go yard birds')).sit === 'bored');
  check('a fan hears their own club', sportsSituation(birdman, m('go yard birds')).sit === 'own');
  check('…and their rival', sportsSituation(birdman, m('the warlords')).sit === 'rival');
  const spread = [0, 0, 0];
  for (let i = 0; i < 300; i++) spread[interestOf({ id: 'n' + i })]++;
  check('interest is spread: some care, some do not', spread.every((n) => n > 40), spread.join('/'));
  const sp = player(); sp.id = 'regress_parley_sport';
  const fanSays = answer(birdman, sp, 'how about those yard birds?', { direct: true });
  check('a fan answers their club with enthusiasm', fanSays?.key === 'sports:own' && npcMoodOf(birdman)?.m === 'happy', JSON.stringify(fanSays));
  _resetExchanges();
  let ex = null;
  for (let i = 0; i < 20 && !ex; i++) ex = exchangeFor(birdman, sportsSituation(birdman, m('the yard birds')), [warman], null);
  check('a rival fan in the room joins in', ex?.type === 'feud' && ex.turns.length >= 3, JSON.stringify(ex));
  check('…not somebody who does not care', !exchangeFor(birdman, sportsSituation(birdman, m('the yard birds')), [nobody], null));
  banter.setLeague(prevLeague);

  // ── Other people ──────────────────────────────────────────────────────────
  const ann = { id: 'npc_regress_ann', name: 'Annika Reggs', home_zone: 'z_home_a', flags: { parley: { knows: { npc_regress_ben: 'lover' } } } };
  const ben = { id: 'npc_regress_ben', name: 'Benedikt Torr', home_zone: 'z_home_b', flags: {} };
  const cal = { id: 'npc_regress_cal', name: 'Calloway Reggs', home_zone: 'z_home_a', flags: {} };
  const dot = { id: 'npc_regress_dot', name: 'Dorothea Plum', home_zone: 'z_home_d', flags: {} };
  for (const n of [ann, ben, cal, dot]) world.npcs.set(n.id, n);
  _resetNames();
  try {
    check('a name in a line is found', namedPerson(parse('do you know Benedikt?'), ann)?.id === ben.id);
    check('an authored partner is a lover, both ways', relationBetween(ann, ben) === 'lover' && relationBetween(ben, ann) === 'lover');
    check('one home and one surname is family', relationBetween(ann, cal) === 'family');
    check('nobody in common is a stranger', relationBetween(ann, dot) === 'stranger');
    const pp = player(); pp.id = 'regress_parley_people';
    const guarded = answer(ann, pp, 'do you know Benedikt?', { direct: true });
    check('a stranger asking about a partner gets the guarded answer', guarded?.key === 'person:lover' && !/Benedikt/.test(guarded.line.say), JSON.stringify(guarded));
  } finally { for (const n of [ann, ben, cal, dot]) world.npcs.delete(n.id); _resetNames(); }

  // ── Politics ──────────────────────────────────────────────────────────────
  const watcher = { id: 'npc_regress_lw', name: 'Wen Watch', flags: { politics: { side: 'lw', strength: 2 } } };
  const asc = { id: 'npc_regress_asc', name: 'Aster Pin', flags: { politics: { side: 'asc', strength: 3, open: true } } };
  const cold = { familiarity: 0, warmth: 0 }, warm = { familiarity: 60, warmth: 30 };
  check('the Long Watch is heard', politicsMention(parse('what about the long watch').text) === 'lw');
  check('a Watcher hushes a stranger', /hush|cover/.test(politicsLine(watcher, 'lw', { rel: cold }).sit));
  check('…and talks, quietly, to a friend', politicsLine(watcher, 'lw', { rel: warm }).sit === 'lw_own');
  check('…but not with an Ascendant in the room', politicsLine(watcher, 'lw', { rel: warm, room: [asc] }).sit === 'lw_not_here');
  check('an open Ascendant says so to anyone', politicsLine(asc, 'side', { rel: cold }).sit === 'asc_own');
  const sides = {};
  for (let i = 0; i < 500; i++) { const s = sideOf({ id: 'c' + i }).side; sides[s] = (sides[s] || 0) + 1; }
  check('the city leans Ascendant, some are quietly Watch', sides.asc > sides.lw && sides.lw > 50 && sides.none > 50, JSON.stringify(sides));
  check('Ascendant and Watch are opposed', opposed(asc, watcher) && !opposed(asc, asc));

  // ── Hints ─────────────────────────────────────────────────────────────────
  _setHintChance(1);
  _resetTalks();
  const hinter = { id: 'npc_regress_hint', name: 'Hal Hint', flags: { parley: { hints: ['*glances at the old photo behind the bar.*'], react: { greet: ['Evening.'] } } } };
  const hp = player(); hp.id = 'regress_parley_hint';
  const hs = [1, 2, 3].map(() => answer(hinter, hp, 'hello', { direct: true }));
  check('a hint rides on an answer now and then', hs.some((x) => x.line.act === 'glances at the old photo behind the bar.' && x.line.say === 'Evening.'), JSON.stringify(hs));
  check('…no more than twice a conversation', hs.filter((x) => x.hinted).length <= 2);
  check('two actions never stack', withHint({ act: 'nods.', say: 'Hi.' }, '*waves.*', splitLine).act === 'nods.');
  _setHintChance(hintChance);
}
