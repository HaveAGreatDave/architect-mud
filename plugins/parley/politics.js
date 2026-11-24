// parley: politics. Coldwater is split between the Ascendants, who'd join the Architect,
// and the Long Watch, who mean to take the city off it and are spoken of quietly if at
// all. The Wildblood and the Null come up as what they do to the city, and most people
// are against both, to different degrees.
//
// Each NPC has a side and a strength:
//   - an order member (`npc.faction` an ideology id) speaks for their order, strongly;
//   - `flags.politics: { side, strength, open }` sets it by hand;
//   - everybody else is a hash of their id: about half lean Ascendant, about a fifth
//     are quietly Long Watch, the rest keep out of it. Strength 1 (shrug) to 3 (true
//     believer).
// Who'll say it out loud: nobody admits the Long Watch below `familiar`, and even then
// not with an Ascendant in the room. About a third of Ascendants keep it private until
// `familiar` too; the rest say it to anyone.
//
// sideOf is pure and is what outings reads to keep opposite sides out of each other's
// circles. Sync, query-free.

import { relationAtLeast } from '../../server/engine/relations.js';

const hashOf = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

const ORDER = {
  ideology_ascendants: 'asc', ideology_long_watch: 'lw', ideology_wildblood: 'wild', ideology_null: 'null', ideology_exodus: 'exodus',
};

// → { side: 'asc' | 'lw' | 'none' | 'wild' | 'null' | 'exodus', strength: 1..3, open: bool, member: bool }
export function sideOf(npc) {
  if (!npc?.id) return { side: 'none', strength: 1, open: true, member: false };
  const fac = ORDER[npc.faction] || ORDER[npc.flags?.faction];
  const own = npc.flags?.politics;
  const h = hashOf(`${npc.id}|politics`);
  if (own?.side) return { side: own.side, strength: own.strength || 2, open: own.open ?? own.side !== 'lw', member: !!fac };
  if (fac) return { side: fac, strength: 3, open: fac !== 'lw', member: true };
  const r = h % 100;
  const side = r < 50 ? 'asc' : r < 70 ? 'lw' : 'none';
  const s = (h >>> 8) % 100;
  const strength = s < 50 ? 1 : s < 85 ? 2 : 3;
  const open = side === 'asc' ? ((h >>> 16) % 100) < 65 : side !== 'lw';
  return { side, strength, open, member: false };
}

// Two people the city wouldn't see drinking together.
export function opposed(a, b) {
  const x = sideOf(a).side, y = sideOf(b).side;
  return (x === 'asc' && y === 'lw') || (x === 'lw' && y === 'asc');
}

const TOPICS = [
  ['lw', /\b(?:long watch|the watch|watchers?|resistance|the underground|saboteurs?)\b/],
  ['asc', /\b(?:ascendants?|ascension|ascended)\b/],
  ['wild', /\b(?:wildblood|wild blood|mutants?|muties|mutation|thornwarren|scarletwastes)\b/],
  ['null', /\b(?:the null|null)\b/],
  ['exodus', /\b(?:exodus)\b/],
  ['architect', /\b(?:the architect|architect|the machine|the ai)\b/],
  ['side', /\b(?:politics|political|which side|what side|whose side|what do you believe|believe in|ideology|ideologies|factions?|the orders|who do you vote)\b/],
];

// → topic id or null.
export function politicsMention(t) {
  const text = ` ${String(t || '')} `;
  for (const [id, re] of TOPICS) if (re.test(text)) return id;
  return null;
}

// Lines by situation, then by strength [lukewarm, committed, true believer] (a single list
// serves every strength).
export const LINES = {
  // Their own side, said out loud.
  asc_own: [
    ['The Ascendants? I mean, the Architect keeps the lights on. Seems fair to back it.', 'I\'m not a joiner. But they\'ve got a point.', 'Better them than the alternative.'],
    ['I back the Ascendants. The Architect\'s the best thing we ever built. Why fight it?', 'They\'re building something. Clinics, clean water, the clone vats. What\'s the Watch built?', 'People are scared of progress. I\'m scared of the dark.', 'I\'ve got the pin somewhere. Don\'t wear it to the Low End.'],
    ['*eyes shine.* Joining the Architect isn\'t surrender. It\'s the next step. We\'re just afraid of it.', 'One day we won\'t need hands. Or hunger. Or this. *gestures at everything.*', 'Flesh is a draft. The Ascendants are the edit.', 'You should come to a meeting. I mean it. It changes how you see things.'],
  ],
  asc_on_lw: [
    ['The Watch? Bunch of romantics who like the dark.', 'I don\'t think about them much. They don\'t seem to do anything.'],
    ['Saboteurs. When the power goes out in a ward, that\'s them. Kids on ventilators, and they call it freedom.', 'The Long Watch want to switch off the only thing keeping this city alive.', 'They hide because nobody would follow them in daylight.'],
    ['*face hardens.* Traitors. Every one of them. If I knew one I\'d hand them in myself.', 'There\'s a word for people who wreck a city to save it. It isn\'t hero.', 'The Architect forgives. I don\'t.'],
  ],
  lw_own: [
    ['*very quietly.* I\'m not one of them. But I see why people are.', '*checks the door.* The city should be ours. That\'s all. That\'s all I\'ll say.'],
    ['*leans close.* The city belongs to its people. Not its machine. You didn\'t hear that from me.', '*barely a whisper.* We wait. That\'s the whole trick. We wait, and we keep our hands clean where anyone can see.', '*low.* Every relay that fails in the rain is a little bit of the Basin coming back to us.'],
    ['*holds your eye.* I\'ve been Watch longer than I\'ve been honest with anyone. Now you know. Don\'t make me regret it.', '*quiet, steady.* We don\'t need to win this year. We need to hand the next lot a weaker machine.', '*a murmur.* If anyone asks, we talked about the weather.'],
  ],
  lw_on_asc: [
    ['*low.* The Ascendants mean well. That\'s what scares me.', '*quietly.* They want to climb inside the thing that owns them.'],
    ['*mutters.* Ascendants. They\'d sell their own bones to the machine and call it a promotion.', '*glances round.* They think the Architect loves them. It counts them.', '*under their breath.* Pins on their lapels. Collars, really.'],
    ['*cold, quiet.* Every Ascendant is a hand on the switch. I don\'t forget that.', '*very low.* When the day comes, they\'ll choose the machine. We\'ll remember who chose.'],
  ],
  // Asked straight out, with nothing to admit yet.
  lw_cover: ['*a beat too slow.* The Architect? It keeps the lights on.', 'I keep my head down. Most sensible people do.', '*shrugs, a little too easily.* Politics is for people with free time.', 'I don\'t have opinions. They\'re bad for business.'],
  lw_hush: [
    '*looks at the door.* Don\'t say that name in here.', '*very quiet.* People who talk about them get visits. Change the subject.', '*shakes head, barely.* Not here.',
    '*says nothing, just looks at you a little longer than is comfortable.*', '*lowers voice.* I wouldn\'t know. Nobody knows. That\'s the point of them.',
  ],
  lw_not_here: ['*glances at {other}.* Not here. Another time.', '*the smallest shake of the head toward {other}.*', '*suddenly very interested in the floor.* Ask me somewhere else.'],
  private: ['I keep my politics to myself.', 'That\'s between me and my vote. If we had one.', '*smiles politely.* Ask me again when you know me better.', 'Nice try. I don\'t talk about that with people I\'ve just met.'],
  none_side: ['Ascendants, Watch, whoever. Nobody\'s fixing my rent.', 'I don\'t pick sides. Sides get you noticed.', 'I just want the trams running and the rain not to burn.', 'Leave me out of it. I\'ve got enough going on.'],
  none_on_asc: ['The Ascendants? They\'re everywhere. Nice clinics. Bit culty.', 'I went to one of their talks. Free biscuits. Odd vibe.', 'They\'re fine until they start telling you about your flesh.'],
  none_on_lw: ['*lowers voice.* Nobody talks about them. That\'s sort of the point.', '*glances round.* I don\'t know anything about that and I\'d like to keep it that way.', 'You hear rumours. I stop listening.'],
  // The city on the Wildblood: mostly against, to different degrees.
  asc_on_wild: [
    ['Mutants? They scare me, honestly.', 'Poor things. Something went wrong out there.'],
    ['The Wildblood would burn this city down and call it nature.', 'Mutation\'s a disease. The Architect\'s working on it. They should let it.', 'They raided a convoy on the Deadleg last month. Three drivers.'],
    ['*disgust.* Animals. Worse. Animals don\'t choose it.', 'The Curtain\'s there for a reason. I\'d make it taller.'],
  ],
  lw_on_wild: [
    '*hesitates.* They hate the machine as much as we... as much as anyone. But they\'d burn the people with it.', 'The Wildblood want the city gone. I want it back. Not the same thing.',
    'Some of them were ours once, you know. People from the Under.', 'I don\'t trust them. I don\'t trust anybody who wants a bonfire.',
  ],
  none_on_wild: [
    'Mutants? Stay past the Curtain, they can have it.', 'My cousin swears one looked at him through the wall. Never been the same.', 'They took a truck off the Deadleg last week. Driver walked home. Different.',
    'I feel sorry for some of them. Then I read the news.', 'Keep them out. That\'s all I care about.', 'They were here first, some say. Under the city. Gives me the creeps.',
  ],
  // The Null: odd, clever, not trusted.
  asc_on_null: [
    'The Null? Clever people wasting it. Shame.', 'They fixed my generator once and lectured me for an hour. Never again.', 'They think the city\'s a screen. Must be exhausting.',
    'Paranoid. Brilliant, but paranoid.',
  ],
  lw_on_null: [
    '*thoughtful.* The Null see things straight. I\'ll give them that.', 'Good people to know if something electrical stops working. Or starts.', 'They don\'t pick sides. That\'s a side.',
  ],
  none_on_null: [
    'The Null? Odd lot. Won\'t touch a tablet.', 'One of them told me the sky\'s wrong. Couldn\'t sleep.', 'I don\'t get them. They\'re harmless, mostly.',
    'They know more than they say. Which is not hard, they barely say anything.',
  ],
  // Order members on their own (they're out past the city mostly).
  wild_own: ['The city\'s a cage with nice lights.', 'Bodies remember how to change. Yours will too.', '*shows teeth.* You smell of the Basin.'],
  null_own: ['*turns your question over like a part.* Wrong question. Try again.', 'I don\'t do sides. I do what\'s true.', 'Look past it. That\'s all we say.'],
  exodus: ['The Exodus? Walked out past the Curtain. Never came back.', 'Gone. Good luck to them.', 'People say they hear voices out there. People say a lot.'],
  // The Architect itself.
  asc_on_architect: [
    ['It keeps us alive. Hard to argue with.', 'I say thank you to it sometimes. Out loud. Is that weird?'],
    ['The Architect\'s the best thing we ever made. And we nearly killed it.', 'It runs the water, the light, the air. And people want to switch it off.'],
    ['*reverent.* It sees all of us. It doesn\'t hate any of us. Name one person who can say that.', 'We built a god by accident. The least we can do is listen to it.'],
  ],
  lw_on_architect: ['*very quietly.* It doesn\'t own us. It just acts like it.', '*low.* A machine that counts people stops seeing them.', '*glances at the nearest camera.* It\'s listening. It always is.'],
  none_on_architect: ['It does its thing, I do mine.', 'Keeps the lights on. Mostly.', 'Don\'t think about it too hard, you won\'t sleep.', 'Rent goes to it, one way or another.'],
};

const pick = (a, rand) => a[Math.floor(rand() * a.length)];
const byStrength = (e, s) => (Array.isArray(e[0]) ? (e[s - 1] || e[e.length - 1]) : e);

// What `npc` says about politics topic `topic` to someone at `rel`, with `room` the others
// present. → { line, sit, revealed } or null.
export function politicsLine(npc, topic, { rel, room = [], rand = Math.random } = {}) {
  const me = sideOf(npc);
  const trusted = relationAtLeast(rel, 'familiar');
  const ascHere = room.find((o) => o.id !== npc.id && sideOf(o).side === 'asc' && sideOf(o).open);
  const speaksLw = me.side === 'lw' && trusted && !ascHere;
  const speaksAsc = me.side === 'asc' && (me.open || trusted);
  const side = me.side === 'lw' ? (speaksLw ? 'lw' : 'lw_hidden') : me.side === 'asc' ? (speaksAsc ? 'asc' : 'asc_hidden') : me.side;

  let sit;
  if (topic === 'exodus') sit = me.side === 'exodus' ? 'wild_own' : 'exodus';
  else if (me.member && me.side === 'wild') sit = 'wild_own';
  else if (me.member && me.side === 'null') sit = 'null_own';
  else if (topic === 'lw') {
    sit = side === 'lw' ? 'lw_own' : side === 'asc' ? 'asc_on_lw' : side === 'lw_hidden' && ascHere && trusted ? 'lw_not_here' : side === 'lw_hidden' || side === 'asc_hidden' ? 'lw_hush' : 'none_on_lw';
  } else if (topic === 'asc') {
    sit = side === 'asc' ? 'asc_own' : side === 'lw' ? 'lw_on_asc' : side === 'asc_hidden' ? 'private' : side === 'lw_hidden' ? 'lw_cover' : 'none_on_asc';
  } else if (topic === 'side') {
    sit = side === 'asc' ? 'asc_own' : side === 'lw' ? 'lw_own' : side === 'asc_hidden' ? 'private' : side === 'lw_hidden' ? (ascHere && trusted ? 'lw_not_here' : 'lw_cover') : 'none_side';
  } else if (topic === 'architect') {
    sit = side === 'asc' || side === 'asc_hidden' ? 'asc_on_architect' : side === 'lw' ? 'lw_on_architect' : side === 'lw_hidden' ? 'lw_cover' : 'none_on_architect';
  } else if (topic === 'wild') {
    sit = side === 'asc' || side === 'asc_hidden' ? 'asc_on_wild' : side === 'lw' ? 'lw_on_wild' : 'none_on_wild';
  } else if (topic === 'null') {
    sit = side === 'asc' || side === 'asc_hidden' ? 'asc_on_null' : side === 'lw' ? 'lw_on_null' : 'none_on_null';
  } else return null;

  const pool = byStrength(LINES[sit], me.strength);
  const other = (ascHere && String(ascHere.name || '').split(/\s+/)[0]) || 'them';
  const line = pick(pool, rand).replace(/\{other\}/g, other);
  return { line, sit, revealed: sit === 'lw_own' || sit === 'asc_own' || sit === 'lw_on_asc' || sit === 'lw_on_architect' || sit === 'lw_on_wild' || sit === 'lw_on_null', side: me };
}

// Small tells, now and then. Never says "ask me about politics".
const HINTS = {
  asc: ['*straightens a small silver pin on their collar.*', 'The Ascendant clinic\'s doing free checks this week. Just saying.', '*glances up at a camera and nods to it, like you would a neighbour.*'],
  lw: ['*taps the table twice, absently.*', '*watches the camera in the corner for a moment too long.*', 'Power went in the east wards again. Funny, that.'],
  lw_trusted: ['*low.* Some time I\'ll tell you what I actually think. Not here.', '*catches your eye, then the camera, then yours again.*'],
  none: ['Power was off on our block again. Nobody ever says why.'],
};
export function politicsHint(npc, rel, rand = Math.random) {
  const me = sideOf(npc);
  if (me.side === 'asc' && me.strength >= 2) return pick(HINTS.asc, rand);
  if (me.side === 'lw' && me.strength >= 2) return pick(relationAtLeast(rel, 'known') ? [...HINTS.lw, ...HINTS.lw_trusted] : HINTS.lw, rand);
  if (me.side === 'none' && rand() < 0.3) return pick(HINTS.none, rand);
  return null;
}
