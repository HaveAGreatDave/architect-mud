/**
 * She sat on a rise for sixteen days and watched it. 2026-08-26.
 *
 * ── THE LANTERN LEAD-IN DID NOT LAND ─────────────────────────────────────────
 *
 * The last pass routed the flask in off her unlit lamp, on the theory that an
 * unrelated practical topic is a better door than a menu item. The door was
 * fine; what came through it was not. She arrived at the subject by pointing at
 * some lights a quarter mile off, which is a rumour with a torch on it, and then
 * had to be authoritative about people she had only ever seen at that distance.
 *
 * So the door is now WHERE DO THEY COME FROM — the one question a player who has
 * met three of these things in a tunnel would actually ask — and the answer is a
 * place she has stood.
 *
 * ⚠ AND SHE HAS ONLY BEEN THERE ONCE, YEARS AGO, TO A CAMP. Not the Thornwarren.
 * `south` already has her admitting she has only been TOLD about the walled town
 * with a gate in it, and Rennick has explained it to her at length, twice. If
 * she had seen that, that node is a lie. What she saw was a camp at a Pool, from
 * a rise, for sixteen days — which is exactly what `the_flask` has always
 * said she saw ("I have watched it done", "a man at the Pool") and nothing had
 * ever put a place around it.
 *
 * The line it earns is already written and three nodes away: in `south` she says
 * what she hears about the town is "a nest that has learned to keep house". That
 * lands differently once you know she has seen the nest.
 *
 * ── WHAT THE CHAOS IS ────────────────────────────────────────────────────────
 *
 * Not violence, and not squalor. She went expecting an enemy with a shape to it
 * — a leader, a rule, somebody deciding — and found fires nobody was at, people
 * asleep on open ground in the afternoon, somebody playing an instrument for
 * nine hours, and a queue that was not a queue. What disgusts her is that it
 * looked like a fair. People were enjoying themselves while it happened.
 *
 * ⚠ THE CHILDREN WERE FINE, and she says so unprompted. Take that line out and
 * she is describing a monster camp; leave it in and she is describing something
 * she could not make sense of, which is the only version worth writing.
 *
 * ── THE MAN ──────────────────────────────────────────────────────────────────
 *
 * `the_flask` used to be a summary — a man at the Pool, and a fortnight later
 * something wearing his face. It is one man now, followed the whole way through,
 * in order, because a transformation is a thing that happens over days to
 * somebody with a laugh you could hear over everything, and a summary is a way
 * of not looking at it.
 *
 * ⚠ It must not duplicate `earned_what`, which is her catalogue across four
 * hundred of them — the jaw, the hands, ribs on the outside. This is one man and
 * a fortnight, and the last thing in it is the camp's own word for what happened
 * to him.
 *
 * ⚠ AND THE TWO CLOCKS HAVE TO AGREE. The camp watch was written as "a day and a
 * half", which is a better-sounding number and makes the node it sits three
 * clicks from impossible: she cannot follow a man from the flask to day nine to
 * the end of the fortnight if she went home on the second morning. Sixteen days
 * is the fortnight plus the days either side of it, and it is worse than the
 * good number was — three of them lay on a rise for over two weeks watching
 * this happen and then walked home.
 *
 * ── THE LAMP ─────────────────────────────────────────────────────────────────
 *
 * Rewritten and demoted to an ordinary topic. It keeps its place because
 * `stance_approve` — written long before any of this — has her unhook the lamp
 * off her belt and hand it to you unlit, and nothing else in 52 nodes says why
 * a person would carry a light they never use.
 *
 * Run: node scripts/content/lw-the-camp.mjs [--write]
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

// ── 1. WHERE THEY COME FROM ─────────────────────────────────────────────────
t.where_from = {
  _vine: { x: 620, y: 1700 }, actions: [],
  text:
    '"South. Nearly all of it."\n\n'
    + '"There is bad ground east of the wall and that gives you the marked. Small things, things '
    + 'that do not show. That is not what I am putting down."\n\n'
    + '"The ones I put down walked here. Out of the wastes, through the Curtain the way everything '
    + 'else gets through it, and then down. Four or five weeks on foot. Some of them make it."',
  options: [
    opt('You have been out there?', 'where_from_camp'),
    opt('Why walk all that way?', 'where_from_north'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_north = {
  _vine: { x: 880, y: 1600 }, actions: [],
  text:
    '"Because it goes wrong."\n\n'
    + '"They will not tell you that down there. But a man who has come through it and found out he '
    + 'cannot feed himself any more is a man with nowhere, and there is a great deal of nowhere '
    + 'between here and there."\n\n'
    + '"They come north because north is where the buildings are. I would."',
  options: [
    opt('You have been out there?', 'where_from_camp'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── 2. THE CAMP ─────────────────────────────────────────────────────────────
t.where_from_camp = {
  _vine: { x: 880, y: 1780 }, actions: [],
  text:
    '"Once. Years ago."\n\n'
    + '"Three of us went to see what we were dealing with. We got within a mile of a camp of theirs '
    + 'and sat up on a rise and watched it for sixteen days."\n\n'
    + '"I had gone out there expecting something organised. Somebody in charge, a rule, an order to '
    + 'it. There was none of that. Fires going with nobody at them. People asleep on open ground in '
    + 'the middle of the afternoon. Somebody played the same instrument for about nine hours and '
    + 'nobody stopped him."\n\n'
    + '"And down in the middle of it a queue that was not a queue, for a man with a flask."',
  options: [
    opt('What happened to them?', 'the_flask'),
    opt('That is just a camp.', 'where_from_camp_fair'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_camp_fair = {
  _vine: { x: 1140, y: 1860 }, actions: [],
  text:
    '"It is."\n\n'
    + 'She does not take it back.\n\n'
    + '"That is the part I keep going over. It looked like a fair. Somebody was cooking and it '
    + 'smelled like food. Two children were running about in it and they were fine, and nobody was '
    + 'watching them either."\n\n'
    + '"I sat on that rise sixteen days waiting for the thing that made sense of it. What I got '
    + 'was people enjoying themselves while it happened."',
  options: [
    opt('While what happened?', 'the_flask'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── 3. THE MAN ──────────────────────────────────────────────────────────────
t.the_flask.text =
  '"I watched one of them go the whole way through it."\n\n'
  + 'It comes out in order. She has not told it often.\n\n'
  + '"Sleeves up, arms out, and somebody tips a flask into him, and the camp is pleased for him. '
  + 'He was about thirty. He had a laugh you could hear over everything else going on down '
  + 'there."\n\n'
  + '"Day four he could not keep water down. Day six his jaw had started to come apart at the back '
  + 'and he was still talking through it, and they were still pleased."\n\n'
  + '"Day nine I watched him try to use his hands and find out they were not hands."\n\n'
  + '"End of the fortnight there was something lying in his blankets that was the wrong shape for a '
  + 'man, and it turned its head when somebody said his name."\n\n'
  + 'Whatever is on her face, she gets rid of it.\n\n'
  + '"They had a word for it. They said he had come through."';
t.the_flask.options = [
  opt('It is his body.', 'the_flask_sacred'),
  opt('He is still the same man.', 'the_flask_diseased'),
  opt('(let her walk on)', 'bye'),
];

// ── 4. THE LAMP, REWRITTEN AND DEMOTED ──────────────────────────────────────
delete t.lantern_count;
delete t.lantern_lights;
t.lantern = {
  _vine: { x: 620, y: 1980 }, actions: [],
  text:
    '"It is not, no."\n\n'
    + 'She does not look down at it.\n\n'
    + '"A light out here makes one of you and none of them. They see it coming a long way before '
    + 'you see anything at all."\n\n'
    + '"So it stays on the belt. It is for finding a body, or reading a number off a pipe, and I '
    + 'have used it four times in eleven years and I remember all four."',
  options: [
    opt('Then how do you know where you are?', 'lantern_count'),
    opt('(say nothing)', 'bye'),
  ],
};
t.lantern_count = {
  _vine: { x: 880, y: 1980 }, actions: [],
  text:
    '"Count."\n\n'
    + '"Eleven hundred and forty paces from the door to the sump, and the sump you can smell. Four '
    + 'hundred more to the Blind."\n\n'
    + '"If the paces stop agreeing with the smell then something down here has changed, and I would '
    + 'rather know it than see it."',
  options: [opt('(say nothing)', 'bye')],
};

// ── 5. ROOT ─────────────────────────────────────────────────────────────────
const opts = (t.root.options ||= []);
const tail = Math.max(0, opts.length - 1);
if (!opts.some(o => o.next === 'where_from')) {
  opts.splice(tail, 0, opt('Where do the ones down here come from?', 'where_from'));
  log.push('  root       +1 "Where do the ones down here come from?"');
}
// Nothing routes to the flask off the root any more, by design.
const bald = opts.filter(o => o.next === 'the_flask');
if (bald.length) { t.root.options = opts.filter(o => o.next !== 'the_flask'); log.push('  root       -' + bald.length + ' direct flask pick'); }

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

// ── checks ──────────────────────────────────────────────────────────────────
const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { log.push('DANGLING ' + k + ' -> ' + o.next); bad++; }
const linked = new Set(['root']);
for (const v of Object.values(t)) for (const o of v.options || []) if (o.next) linked.add(o.next);
for (const k of Object.keys(t)) if (!linked.has(k) && !k.startsWith('_')) { log.push('ORPHAN ' + k); bad++; }
// The flask must be reachable, and never in one hop from the root.
const flaskFrom = Object.entries(t).filter(([, v]) => (v.options || []).some(o => o.next === 'the_flask')).map(([k]) => k);
log.push('  the_flask reached from: ' + (flaskFrom.join(', ') || 'NOTHING'));
if (!flaskFrom.length || flaskFrom.includes('root')) { log.push('  ⚠ the flask is orphaned or back on the root menu'); bad++; }

console.log(log.join('\n'));
console.log('\n  nodes ' + Object.keys(t).length + ' · problems ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
