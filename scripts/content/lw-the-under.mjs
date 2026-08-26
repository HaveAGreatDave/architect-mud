/**
 * They were down here first. 2026-08-26.
 *
 * Rewrites Teague against [docs/lore-wildblood.md](../../docs/lore-wildblood.md),
 * which arrived after her material was written and moves the ground under most
 * of it.
 *
 * ── THE TRIP SOUTH GOES ──────────────────────────────────────────────────────
 *
 * The last pass had her sit on a rise sixteen days watching a camp in the
 * wastes, which was the best available answer to "where has she seen this" when
 * the assumption was that mutants come UP from the south. The lore says the
 * opposite and says it first: the Wildblood were in the Under before the Long
 * Watch put a door on one of these tunnels. Shrines in maintenance chambers,
 * mutagen pits in flooded rooms, dens behind collapsed walls.
 *
 * So she has not travelled to see any of this. It is on her round. That is
 * better on every axis — she is the one who walks it, it costs no expedition
 * nobody else remembers, and it stops straining `south`, where she admits she
 * has only ever been TOLD about the walled town.
 *
 * ⚠ AND SHE WAS IN THE DARK WITH ONE OF THEM. The ritual ends with the initiate
 * taken into the dark and left, and the dark is her office. She did not go and
 * watch a ceremony; she was on the far side of a flooded chamber when twenty of
 * them came in with torches, and she could not leave for eleven hours. The
 * horror is not that she saw it. It is that she heard it, in the dark, from
 * about thirty feet away, and could not go anywhere.
 *
 * ── "THE MARKED" GOES ────────────────────────────────────────────────────────
 *
 * She had a four-rung vocabulary — clean, marked, turned, bought — invented for
 * her and used by nobody else in the game. A woman with a rifle does not carry a
 * taxonomy; she describes people. So the grades node now names an actual person
 * on her own round and says what she can and cannot live with, and the ugly line
 * underneath it survives untouched, because that one is hers.
 *
 * ── THE MUTATIONS ARE NAMED ──────────────────────────────────────────────────
 *
 * ⚠ The single most useful thing in the lore is that the initiate CHOOSES. They
 * say out loud what they want in front of everybody, and then get it (a Gift),
 * or get something else (a Lesson), or die (a Refusal) — and all three are good
 * days. Nothing outside the Wildblood knows that, which makes it exactly the
 * kind of thing Teague would have worked out by watching and would report flat.
 *
 * It also gives the worst image in her tree for free: a man asks for gills,
 * gets gills, and drowns in air while everybody is delighted for him. She does
 * not editorialise it and there is no option that lets her.
 *
 * ── WHAT SHE WILL NOT DESCRIBE ───────────────────────────────────────────────
 *
 * They leave food, they leave teeth, and they leave their dead. The Long Watch
 * calls what is done to the dead cannibalism and the Wildblood call it
 * inheritance, and ⚠ the lore is explicit that nothing may ever settle it. So
 * she refuses the sentence — not coyly, and not as a tease with an answer behind
 * it. There is no node where she says it.
 *
 * Run: node scripts/content/lw-the-under.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

const p = path.join(ROOT, 'npcs/npc_lw_teague.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;
const log = [];

// ── 1. WHERE THEY COME FROM: NOWHERE. THEY ARE ALREADY HERE ─────────────────
t.where_from = {
  _vine: { x: 620, y: 1700 }, actions: [],
  text:
    '"They do not come from anywhere. They were down here before we were."\n\n'
    + 'She says it the way you would correct somebody about a street name.\n\n'
    + '"Everybody thinks the Under filled up after the city died. It did not. There are handprints '
    + 'on the wall of a chamber off my stretch that were on it before anybody I have ever met was '
    + 'born, and somebody is still adding to them."',
  options: [
    opt('Handprints?', 'where_from_prints'),
    opt('You share a tunnel system with them.', 'where_from_share'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_prints = {
  _vine: { x: 880, y: 1600 }, actions: [],
  text:
    '"Thousands. On a wall in a room you cannot stand up in, going back further than my lamp '
    + 'reaches."\n\n'
    + '"They are hands, mostly. I counted four with too many fingers on them."\n\n'
    + 'A beat.\n\n'
    + '"There is one about chest height that is not a hand and I do not know what it is. I have '
    + 'stopped going in there."',
  options: [
    opt('What else do you find?', 'where_from_leave'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_share = {
  _vine: { x: 880, y: 1780 }, actions: [],
  text:
    '"We do. It is not a thing anybody says out loud at the table."\n\n'
    + '"They have got rooms down here. A shrine in an old maintenance chamber. A pit in a flooded '
    + 'room four hundred paces off my round. Dens behind walls that came down before the war."\n\n'
    + '"We walk around all of it and they walk around us, and that has held for longer than I have '
    + 'been alive. Rennick calls it an arrangement. It is not an arrangement. Nobody agreed to '
    + 'anything."',
  // ⚠ THE JOIN. She names the pit in passing here and `the_flask` opens on the same
  // flooded chamber four hundred paces off her round — so this is the door into the
  // ritual, and the player walks through it by asking about a room rather than about
  // a people. Without this option the whole Under branch dead-ends at the leavings
  // and the ritual is reachable only from `earned`.
  options: [
    opt('What is the pit for?', 'the_flask'),
    opt('What else do you find?', 'where_from_leave'),
    opt('So what happens if it stops holding?', 'where_from_holds'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_holds = {
  _vine: { x: 1140, y: 1860 }, actions: [],
  text:
    '"Then there are forty of us and a door."\n\n'
    + 'She checks the tunnel behind you.\n\n'
    + '"I do not know how many of them there are. That is not me being dramatic, it is the actual '
    + 'answer. Eleven years and I have never once seen the same face twice down here."',
  options: [opt('(say nothing)', 'bye')],
};

// ⚠ Three things, and the third is the one she will not finish.
t.where_from_leave = {
  _vine: { x: 1140, y: 1680 }, actions: [],
  text:
    '"Three things, and you learn all three in your first year."\n\n'
    + '"They leave food out. Not a store — a plate, set down in the middle of a floor, for '
    + 'something. I have never seen what comes for it and I have waited."\n\n'
    + '"They leave teeth. Pressed into the mortar in rows, at about the height of your face. Human '
    + 'ones, and I know that because I have looked."\n\n'
    + '"And they leave their dead."\n\n'
    + 'She does not go on.',
  options: [
    opt('Leave them how?', 'where_from_dead'),
    opt('(let it go)', 'bye'),
  ],
};

t.where_from_dead = {
  _vine: { x: 1400, y: 1680 }, actions: [],
  text:
    '"No."\n\n'
    + 'It is not sharp. She simply does not do it.\n\n'
    + '"I will tell you what blood does to a man in as much detail as you have got the stomach for, '
    + 'and twice if you want it twice. I am not telling you that."\n\n'
    + '"Ask Rennick. He has a word for it and he will give you the word and the argument that goes '
    + 'with it, and you can decide which of us you believe."',
  options: [opt('(say nothing)', 'bye')],
};

// ── 2. THE RITUAL SHE COULD NOT WALK OUT OF ─────────────────────────────────
t.the_flask.text =
  '"Blood. That is their word for it and I have never found a better one."\n\n'
  + '"I have seen it done once, all the way through, and I did not mean to."\n\n'
  + '"There is a flooded chamber four hundred paces off my round with a pit cut into the floor. I '
  + 'was on the far side of it in the dark because I had heard something and gone quiet. Then '
  + 'twenty of them came in with torches, and there was no way out that did not go past them."\n\n'
  + '"So I stayed where I was, and I watched the whole thing from about thirty feet."';
t.the_flask.options = [
  opt('What did they do?', 'the_flask_rite'),
  opt('Twenty of them, and you sat still?', 'the_flask_still'),
  opt('(let her walk on)', 'bye'),
];

t.the_flask_still = {
  _vine: { x: 1400, y: 1440 }, actions: [],
  text:
    '"I sat very still."\n\n'
    + '"There is a version of me that stands up and puts a stop to it. I have met her a few times, '
    + 'walking, at about four in the morning."\n\n'
    + '"She does not get out of that room and neither does anybody behind our door, because they '
    + 'would have known who to look for by the end of the week."',
  options: [
    opt('What did they do?', 'the_flask_rite'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_flask_rite = {
  _vine: { x: 1400, y: 1600 }, actions: [],
  text:
    '"They had a young man with them. Twenty-two, twenty-three. He had not eaten in a day or two '
    + 'by the look of him, and they had washed him and painted him with ash, and he had nothing '
    + 'on."\n\n'
    + '"They were kind to him. That is the part I want you to have, because nobody believes it. '
    + 'They told him about his grandparents for the best part of an hour and he laughed twice."\n\n'
    + '"Then he drank it, and they all said the same three lines at the same time, and they put '
    + 'him down at the bottom of that pit and took the torches away."\n\n'
    + '"And then it was dark, and it was him and me in it, and they were between me and the way '
    + 'out. Eleven hours."',
  options: [
    opt('You heard it.', 'the_flask_heard'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_flask_heard = {
  _vine: { x: 1660, y: 1600 }, actions: [],
  text:
    '"I heard all of it."\n\n'
    + '"He talked to himself for the first few hours. Then he stopped talking to himself and '
    + 'started asking for his sister."\n\n'
    + '"Somewhere around the seventh hour he made a sound I had not heard before and have not '
    + 'heard since, and I want to be exact about it, because people think I put things on top of '
    + 'this when I tell it. He was not screaming. He was trying to get air through something that '
    + 'had grown."',
  options: [
    opt('And in the morning?', 'the_flask_morning'),
    opt('(say nothing)', 'bye'),
  ],
};

// The Gift. She reports it flat and there is no option that lets her comment.
t.the_flask_morning = {
  _vine: { x: 1920, y: 1600 }, actions: [],
  text:
    '"They came back for him at first light and they were delighted."\n\n'
    + '"He had gills. Down both sides of the neck, four a side, and they worked. That is the thing '
    + 'to understand. They worked, and he was drowning in the air, and they were delighted, because '
    + 'gills are what he had asked for."\n\n'
    + '"They carried him to the water and put him in it. He is still in it. They call that a '
    + 'Gift."',
  options: [
    opt('He asked for it?', 'earned_chosen'),
    opt('It is his body.', 'the_flask_sacred'),
    opt('He is still the same man.', 'the_flask_diseased'),
    opt('(let her walk on)', 'bye'),
  ],
};

// ── 3. THEY CHOOSE, AND THAT IS WHAT SHE CANNOT GET PAST ────────────────────
t.earned_chosen = {
  _vine: { x: 1920, y: 1780 }, actions: [],
  text:
    '"Out loud, in front of everybody, before he drank."\n\n'
    + '"That is the part nobody up top knows and it is the only part I think about. It is not done '
    + 'to them. They stand up and say the thing they want and then they go and get it."\n\n'
    + '"He wanted to be able to go where nobody could follow him. He got it."',
  options: [
    opt('And when they do not get what they asked for?', 'earned_what'),
    opt('(say nothing)', 'bye'),
  ],
};

// The catalogue. Specific, named, and it does not repeat the gills.
// ⚠ ITS OPENING HAS TO WORK FROM TWO PLACES. `earned_chosen` arrives at it asking what
// happens when they do NOT get what they asked for, and `earned` arrives cold asking
// what the stuff does at all. The first draft opened "Then they are pleased about that
// instead", which is an answer to the first question and a non-sequitur to the second.
t.earned_what.text =
  '"Whatever it does. That is the honest answer and they do not mind it."\n\n'
  + 'She lists it. She does not slow down for any of it.\n\n'
  + '"A man asks for an arm that will lift a door and gets one, and I have seen that arm and it '
  + 'would take a door off. That is the good outcome and it does happen."\n\n'
  + '"More often it is teeth coming up through the cheek. A second pupil in one eye with nothing '
  + 'behind it. A jaw that comes apart at the back and sets like that. I have seen an arm that '
  + 'started growing and did not stop, and they had to keep him on his side for it."\n\n'
  + '"And a man who asks for a strong arm and comes out blind is still a good day to them, because '
  + 'he went and asked. They have got a word for that one as well."';
t.earned_what.options = [
  opt('They are still people.', 'earned_still'),
  opt('And the ones it kills?', 'earned_refusal'),
  opt('(let her walk on)', 'bye'),
];

t.earned_refusal = {
  _vine: { x: 1660, y: 1440 }, actions: [],
  text:
    '"They have got a word for that too, and it is the one that finished me."\n\n'
    + '"When it kills somebody they say the body told the truth. Not a mistake. Not bad blood, not '
    + 'a batch that went wrong, not somebody who should not have been given it."\n\n'
    + '"The body told the truth, and everybody goes home."',
  options: [
    opt('They are still people.', 'earned_still'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── 4. "THE MARKED" GOES. SHE DESCRIBES PEOPLE INSTEAD ──────────────────────
t.the_grades.text =
  '"There is no list. People keep expecting one."\n\n'
  + '"Half the people behind that door have got something. Grey patches. A chest that will not '
  + 'clear. Ostrow on the second round has a hand that never finished growing and she is the best '
  + 'shot the five of us have got."\n\n'
  + '"That is bad ground and bad water and forty years, and not one of them picked it. Nobody down '
  + 'here gives it a thought."\n\n'
  + '"What I will not have in this tunnel is somebody who went and asked."';
t.the_grades.options = [
  opt('So where is your line, really?', 'the_grades_line'),
  opt('You have a ladder for how much of a person somebody is.', 'stance_object'),
  opt('(say nothing)', 'bye'),
];

// ── 5. TIDY UP WHAT THE CAMP LEFT BEHIND ────────────────────────────────────
for (const k of ['where_from_camp', 'where_from_camp_fair', 'where_from_north']) delete t[k];
for (const v of Object.values(t)) {
  if (!Array.isArray(v.options)) continue;
  v.options = v.options.filter(o => !['where_from_camp', 'where_from_camp_fair', 'where_from_north'].includes(o.next));
}
log.push('  removed    the trip south (where_from_camp, _fair, _north)');

// `earned` still opens the doctrine; point it at the new spine.
if (typeof t.earned?.text === 'string') {
  t.earned.text =
    '"There is a drink. They call it blood, and they make it themselves, and no two lots of it are '
    + 'the same."\n\n'
    + 'She talks about it the way she would talk about bad gin.\n\n'
    + '"You pay nothing for it and you swallow it and about a fortnight later it has finished with '
    + 'you. I have seen what gets up at the end of that fortnight. It is not the person who lay '
    + 'down and it is not a person at all."';
  t.earned.options = [
    opt('What does it do to them?', 'earned_what'),
    opt('Where does this happen?', 'the_flask'),
    opt('And a chromed man?', 'earned_bought'),
    opt('You are describing a drug.', 'earned_drug'),
    opt('Not all of them chose it.', 'earned_fault'),
    opt('(let her walk on)', 'bye'),
  ];
}

// ── 6. ROOT ─────────────────────────────────────────────────────────────────
const opts = (t.root.options ||= []);
const tail = Math.max(0, opts.length - 1);
for (const [label, next] of [['Where do the ones down here come from?', 'where_from']]) {
  const ex = opts.find(o => o.next === next);
  if (ex) ex.label = label; else opts.splice(tail, 0, opt(label, next));
}
t.root.options = opts.filter(o => o.next !== 'the_flask');

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

// ── checks ──────────────────────────────────────────────────────────────────
const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { log.push('DANGLING ' + k + ' -> ' + o.next); bad++; }
const linked = new Set(['root']);
for (const v of Object.values(t)) for (const o of v.options || []) if (o.next) linked.add(o.next);
for (const k of Object.keys(t)) if (!linked.has(k) && !k.startsWith('_')) { log.push('ORPHAN ' + k); bad++; }
// The vocabulary that was invented for her and used by nobody else must be gone.
const blob = JSON.stringify(t);
for (const w of ['Marked is', 'Turned is when it shows', 'Bought is chrome', 'that gives you the marked']) {
  if (blob.includes(w)) { log.push('STALE VOCAB: ' + w); bad++; }
}
const flaskFrom = Object.entries(t).filter(([, v]) => (v.options || []).some(o => o.next === 'the_flask')).map(([k]) => k);
log.push('  the_flask reached from: ' + (flaskFrom.join(', ') || 'NOTHING'));
if (!flaskFrom.length || flaskFrom.includes('root')) { log.push('  ⚠ orphaned, or back on the root menu'); bad++; }

console.log(log.join('\n'));
console.log('\n  nodes ' + Object.keys(t).length + ' · problems ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
