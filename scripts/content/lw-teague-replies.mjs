/**
 * Seventeen places where the player could only say nothing. 2026-08-26.
 *
 * Counted, not felt: 17 of Teague's nodes offered no reply but "(say nothing)",
 * and 29 more offered exactly one — and the ones with one were usually the
 * hostile read, so the player's only move at her worst moments was to accuse
 * her. The tree already has the machinery for better than that: `stance_object`
 * writes `lw_purity_stance`, `stance_quiet` costs you her trust, and
 * `teague_warning` → `teague_left` is a real ending where she walks off. None of
 * the material written this week routed into any of it.
 *
 * ── WHAT STAYS MUTE, ON PURPOSE ──────────────────────────────────────────────
 *
 * Not every dead end is a fault and this does not touch them:
 *
 *   stance_approve    "(take it)" — she is handing you the lantern. Taking it
 *                     IS the reply and a sentence on top would spoil it.
 *   teague_backdown   "(keep walking)" — you have just been warned off. Talking
 *                     more is exactly what she told you not to do.
 *   teague_left       no options at all — END_CONVERSATION. She has gone.
 *   why_the_walk_life "That is five of us. Walking." Her mission statement, and
 *                     every reply I drafted made it smaller.
 *   lantern_count     the paces. A fact, finished.
 *
 * ── THE RULE FOR THE REST ────────────────────────────────────────────────────
 *
 * A choice asks who you are, not what happens next. So where she has just said
 * something heavy, the options are two or three genuinely different people —
 * and ⚠ AT LEAST ONE OF THEM IS NOT AN ACCUSATION. She concedes more than
 * anybody expects when she is met rather than prosecuted, and the tree had no
 * way to meet her.
 *
 * ⚠ AND `stance_object` IS NOT A BIN FOR ANYTHING SHARP. It sets a flag meaning
 * the player objected to the purity doctrine. Routing every hard line into it
 * would make the flag mean "was rude once", so the new sharp replies mostly get
 * their own short answers and only doctrine goes to the flag.
 *
 * ── THE ONE THAT MATTERS ─────────────────────────────────────────────────────
 *
 * `where_from_east_taken` is the heaviest node in the tree — she has just told
 * you the thought she has at four in the morning about the families she points
 * east — and it ended with the player unable to speak. It now offers to stop
 * her, to absolve her, or to send her to go and find out, and the last of those
 * gets the answer the whole character is built on: there are two answers down
 * there and she can only carry one of them.
 *
 * Run: node scripts/content/lw-teague-replies.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });
const node = (x, y, text, options) => ({ _vine: { x, y }, actions: [], text, options });
// Replace a node's options wholesale, keeping any silent exit last.
const setOpts = (key, ...options) => {
  if (!t[key]) { log.push('  MISS  ' + key); return; }
  t[key].options = options;
  log.push('  ok    ' + key.padEnd(24) + options.filter(o => !/^\(/.test(o.label)).length + ' real repl(ies)');
};

const p = path.join(ROOT, 'npcs/npc_lw_teague.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;
const log = [];

// ── THE FOUR-IN-THE-MORNING THOUGHT ─────────────────────────────────────────
t.east_taken_stop = node(1660, 2300,
  '"And do what with them."\n\n'
  + 'Not a question, and then she waits — actually waits — in case you have one.\n\n'
  + '"That is not me being clever with you. If there is somewhere in this city that will take nine '
  + 'families who look like that, say it now and I will walk them there myself on my own time."\n\n'
  + 'She gives you about four seconds.\n\n'
  + '"No. Nobody has ever had one."',
  [opt('I will find somewhere.', 'east_taken_find'), opt('(say nothing)', 'bye')]);

t.east_taken_find = node(1920, 2300,
  'She looks at you properly, which she has not done all night.\n\n'
  + '"Right."\n\n'
  + 'She does not believe you, and she does not say so, and not saying so is the most generous '
  + 'thing she has done since you met her.\n\n'
  + '"If you do, come down on a Thursday and tell me. I will be here. I am always here."',
  [opt('(say nothing)', 'bye')]);

t.east_taken_look = node(1660, 2460,
  '"Past the mile."\n\n'
  + '"I have thought about it more than you would want me to. Four of us could do it. We would '
  + 'need a week, lights, and somebody who can draw."\n\n'
  + '"And then we would know. Knowing is the part I have never talked myself into."',
  [opt('Why not?', 'east_taken_look_why'), opt('(say nothing)', 'bye')]);

// ⚠ The character in four lines. She is not being evasive; she has done the sum.
t.east_taken_look_why = node(1920, 2460,
  '"Because there are two answers down there and I have only got room for one of them."\n\n'
  + 'She starts walking.\n\n'
  + '"If they are all right, then I have been wrong for eleven years about a thing I have been '
  + 'very sure about, and I can carry that. People carry that."\n\n'
  + '"If they are not all right, then I walked nine families up to the edge of it and pointed."\n\n'
  + '"I have not worked out how to carry the second one. So I do not go and look, and you can '
  + 'call that whatever it is."',
  [opt('That is cowardice.', 'stance_object'), opt('(say nothing)', 'bye')]);

setOpts('where_from_east_taken',
  opt('Then stop moving them.', 'east_taken_stop'),
  opt('Then go and look.', 'east_taken_look'),
  opt('You could not have done anything else.', 'stance_approve'),
  opt('(say nothing)', 'stance_quiet'));

// ── SHE HAS LOOKED ──────────────────────────────────────────────────────────
t.where_from_dead_looked = node(1660, 1680,
  '"I have."\n\n'
  + '"Once, early on, because I did not believe what I had been told and I had decided somebody '
  + 'was making it worse than it was."\n\n'
  + '"Nobody was making it worse than it was."',
  [opt('(say nothing)', 'bye')]);

setOpts('where_from_dead',
  opt('You have looked, though.', 'where_from_dead_looked'),
  opt('Then I will ask Rennick.', 'bye'),
  opt('(let it go)', 'bye'));

// ── SHE TRIED, TWICE ────────────────────────────────────────────────────────
t.earned_still_tried = node(1660, 780,
  '"I did."\n\n'
  + '"The second one had a wedding ring on. I have never got past that. Somebody put that on him '
  + 'and meant it, and he was still wearing it."\n\n'
  + '"And he did not know what a word was. Both of those, at the same time, and I have had eleven '
  + 'years to make them into one thing and I cannot."',
  [opt('(say nothing)', 'bye')]);

setOpts('earned_still',
  opt('You tried, though. Twice.', 'earned_still_tried'),
  opt('That is not an answer.', 'stance_object'),
  opt('(say nothing)', 'bye'));

// ── THE ONE THAT LETS HER CONCEDE ───────────────────────────────────────────
t.the_flask_sacred_theirs = node(1920, 1080,
  '"It is."\n\n'
  + '"That is your argument and it is a good one and I have never had anything to put against '
  + 'it."\n\n'
  + 'She keeps walking.\n\n'
  + '"I still would not have it in the room."',
  [opt('(say nothing)', 'bye')]);

setOpts('the_flask_sacred',
  opt('And that is desecration.', 'the_flask_desecration'),
  opt('It is still theirs to spend.', 'the_flask_sacred_theirs'),
  opt('(let her walk on)', 'bye'));

setOpts('the_flask_desecration',
  opt('It is still theirs to spend.', 'the_flask_sacred_theirs'),
  opt('(say nothing)', 'bye'));

// ── WHAT SHE WANTS FROM RENNICK ─────────────────────────────────────────────
t.earned_bother_argue = node(1920, 1180,
  '"Maybe I do."\n\n'
  + 'She does not deny it and she does not go soft about it either.\n\n'
  + '"Rennick has had eleven years to talk me out of it and he has not managed. You have had about '
  + 'twenty minutes."\n\n'
  + '"You are still standing here, mind. That is more than most of them."',
  [opt('(say nothing)', 'bye')]);

setOpts('earned_bother',
  opt('You want somebody to argue you out of it.', 'earned_bother_argue'),
  opt('That is not an argument, it is a rota.', 'stance_object'),
  opt('(say nothing)', 'bye'));

// ── BEING THANKED ───────────────────────────────────────────────────────────
t.why_the_walk_thanked = node(1660, 940,
  'She stops.\n\n'
  + 'It takes her a moment, and she does not do it gracefully.\n\n'
  + '"Right. Well."\n\n'
  + 'She adjusts the sling, which is what she does when she has nothing to do with her hands.\n\n'
  + '"Do not do that again."',
  [opt('(say nothing)', 'bye')]);

setOpts('why_the_walk_thanks',
  opt('Thank you, then.', 'why_the_walk_thanked'),
  opt('(say nothing)', 'bye'));

// ── THE REST OF THE MUTE ONES ───────────────────────────────────────────────
setOpts('earned_seat',
  opt('You owe him that and not the people out east.', 'stance_object'),
  opt('(say nothing)', 'bye'));

setOpts('earned_fault_same',
  opt('That is convenient.', 'stance_object'),
  opt('(say nothing)', 'bye'));

setOpts('where_from_holds',
  opt('Then you are not holding anything. You are being tolerated.', 'stance_object'),
  opt('(say nothing)', 'bye'));

setOpts('the_grades_found',
  opt('Not looking is a decision too.', 'stance_object'),
  opt('(say nothing)', 'bye'));

setOpts('stance_recover',
  opt('I will come Thursday.', 'bye'),
  opt('(say nothing)', 'bye'));

// ── AND THE ONES WHERE THE ONLY REPLY WAS AN ACCUSATION ─────────────────────
t.the_grades_line_sense = node(1660, 1260,
  '"It is. That is what is wrong with it."\n\n'
  + '"Everything I have said to you tonight is operational sense. So is the other thing, and I '
  + 'have never been able to get a knife between them."',
  [opt('(say nothing)', 'bye')]);

setOpts('the_grades_line',
  opt('So you tolerate exactly what you can avoid seeing.', 'the_grades_honest'),
  opt('That is just operational sense.', 'the_grades_line_sense'),
  opt('(say nothing)', 'bye'));

setOpts('earned_refusal',
  opt('They are still people.', 'earned_still'),
  opt('That is a way of never being wrong.', 'stance_object'),
  opt('(say nothing)', 'bye'));

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

// ── checks ──────────────────────────────────────────────────────────────────
const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { log.push('DANGLING ' + k + ' -> ' + o.next); bad++; }
const linked = new Set(['root']);
for (const v of Object.values(t)) for (const o of v.options || []) if (o.next) linked.add(o.next);
for (const k of Object.keys(t)) if (!linked.has(k) && !k.startsWith('_')) { log.push('ORPHAN ' + k); bad++; }

// Re-count the thing this script exists to fix, and name what is left.
// ⚠ EVERY ENTRY IS A DECISION, NOT AN EXEMPTION. A node lands here only because
// a reply would make it worse, and the check is worth keeping precisely because
// it is easy to add one more.
const KEEP = new Set([
  // pre-existing, and argued for in the header
  'stance_approve', 'teague_backdown', 'teague_left', 'why_the_walk_life', 'lantern_count',
  'quiet_report', 'bye',
  // the leaves this script adds. Each is her last word on a thread she has just
  // conceded, refused or been thanked for, and every reply drafted for them read
  // as the player getting the last word off somebody who had stopped defending
  // herself. "Both of those, at the same time, and I have had eleven years to
  // make them into one thing and I cannot" does not want an answer.
  'east_taken_find', 'where_from_dead_looked', 'earned_still_tried', 'the_flask_sacred_theirs',
  'earned_bother_argue', 'why_the_walk_thanked', 'the_grades_line_sense',
]);
const mute = Object.entries(t).filter(([k, v]) =>
  !KEEP.has(k) && !(v.options || []).some(o => !/^\(/.test(o.label))).map(([k]) => k);
log.push('  still mute (unlisted): ' + (mute.join(', ') || 'none'));
if (mute.length) bad++;

console.log(log.join('\n'));
console.log('\n  nodes ' + Object.keys(t).length + ' · problems ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
