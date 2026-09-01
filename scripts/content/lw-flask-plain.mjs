/**
 * The flask, said plainly — and arrived at sideways. 2026-08-26.
 *
 * ── 1. IT USED TO BE A MENU ITEM ─────────────────────────────────────────────
 *
 * The only way into the whole flask arm was a root option reading "What do you
 * make of the ones who drink for it?", which is a player walking up to a woman
 * with a rifle and asking her for her position on a minority. Nobody opens like
 * that, and it announced the subject as The Subject before she had said a word
 * about it.
 *
 * So it comes in off the LANTERN instead, which is the most ordinary thing about
 * her: she carries one and never lights it, and if you ask why she tells you
 * about seeing in the dark, counting paces, and what a light does to you down
 * here. That is a complete conversation with its own information and no bearing
 * on anything.
 *
 * Then it turns, on an observation rather than an opinion — there is a stretch
 * east where you can watch lights moving a quarter mile off, and whoever is
 * carrying them does not mind being seen. Ask who they are and you are in it.
 *
 * ⚠ THE TURN IS HERS AND THE PLAYER ONLY ASKS WHO. She is not answering "what do
 * you think of them", she is answering "who is that", and everything after is
 * her deciding to tell you. That is the difference between a character with a
 * view and a wiki page with a portrait.
 *
 * It also pays off something already in the file: at `stance_approve` she takes
 * the lantern off her belt and hands it to you, still unlit, for exactly the
 * reason she gives here. That was already written and nothing set it up.
 *
 * ── 2. THE PROSE ─────────────────────────────────────────────────────────────
 *
 * Measured, not felt. Across her 49 nodes: "the whole of/point/difficulty" ×3,
 * "which is (itself) the / which is somehow" ×2, "does not dress it up / does
 * not pretend" ×2, plus "her mouth does the thing a mouth does around a bad
 * smell", which is a circumlocution wearing a description's clothes.
 *
 * Pike has two of the same family and they STAY: "that is the whole point of the
 * place" is ordinary speech, and "which is the most he has moved since you came
 * in" carries a fact. The test is the one from the last pass — narration grading
 * its own image goes, a character's judgement stays — and the reason Teague
 * tripped it and Pike did not is that hers were the narrator explaining her.
 *
 * "That is not me being X. That is Y" appears twice. One stays, because it is
 * how she talks; the second becomes plain.
 *
 * Run: node scripts/content/lw-flask-plain.mjs [--write]
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

// ── 1. THE LANTERN ──────────────────────────────────────────────────────────
t.lantern = {
  _vine: { x: 620, y: 1700 }, actions: [],
  text:
    '"It is not, no."\n\n'
    + 'She does not look down at it.\n\n'
    + '"You get about four seconds of nothing after a light goes out. Everything down here is '
    + 'quicker than four seconds. So the lamp is for finding a body, or reading a number off a '
    + 'pipe. That is what it is for."\n\n'
    + '"Walk it enough and the dark comes apart. There is a grey in it. You get there or you stop '
    + 'coming down."',
  options: [
    opt('Then how do you know where you are?', 'lantern_count'),
    opt('Something must carry a light.', 'lantern_lights'),
    opt('(say nothing)', 'bye'),
  ],
};

t.lantern_count = {
  _vine: { x: 880, y: 1620 }, actions: [],
  text:
    '"Count."\n\n'
    + '"Eleven hundred and forty paces from the door to the sump, and the sump you can smell. Four '
    + 'hundred more to the Blind."\n\n'
    + '"If the paces stop agreeing with the smell then something has changed down here, and I would '
    + 'rather know it than see it."',
  options: [
    opt('Something must carry a light.', 'lantern_lights'),
    opt('(say nothing)', 'bye'),
  ],
};

// The turn. She is answering WHO IS THAT, not what do you think of them.
t.lantern_lights = {
  _vine: { x: 880, y: 1780 }, actions: [],
  text:
    '"Something does."\n\n'
    + 'Now she looks at the lamp.\n\n'
    + '"There is a stretch east where you can stand still and watch lights move about a quarter '
    + 'mile off. Lanterns, most of it. One or two have got proper lamps."\n\n'
    + '"They do not mind being seen. Took me a while to work out why, and then I did. There is '
    + 'nothing down here that would go near them."',
  options: [
    opt('Who are they?', 'the_flask'),
    opt('So people live down here.', 'the_quiet_ones'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── 2. THE FLASK, ANSWERING A QUESTION ABOUT LIGHTS ─────────────────────────
t.the_flask.text =
  '"People who drank for it."\n\n'
  + 'She names it the way she would name a trade.\n\n'
  + '"I have watched it done. A man at the Pool with his sleeves up and his arms out, and somebody '
  + 'tips a flask into him, and everybody there is pleased for him."\n\n'
  + '"Fortnight later there is something walking about wearing his face and his voice and getting '
  + 'on with its day."\n\n'
  + 'Her mouth tightens. She lets go of it straight away.';
t.the_flask.options = [
  opt('It is his body.', 'the_flask_sacred'),
  opt('He is still the same man.', 'the_flask_diseased'),
  opt('(let her walk on)', 'bye'),
];

// The bald menu item goes; the lantern takes its place.
const hadFlaskPick = (t.root.options || []).some(o => o.next === 'the_flask');
t.root.options = (t.root.options || []).filter(o => o.next !== 'the_flask');
if (!t.root.options.some(o => o.next === 'lantern')) {
  t.root.options.splice(Math.max(0, t.root.options.length - 1), 0, opt('Your lamp is not lit.', 'lantern'));
  log.push('  root       ' + (hadFlaskPick ? '-1 flask pick, ' : '') + '+1 lantern');
} else log.push('  root       already routes through the lantern');

// ── 3. THE PROSE ────────────────────────────────────────────────────────────
const LINES = [
  ['earned',
    'She says it the way she would describe any other thing sold to people who should know better.',
    'She talks about it the way she would talk about bad gin.'],
  ['earned_what',
    'She is plain about this and it is worse for being plain.',
    'She lists it. She does not slow down for any of it.'],
  ['earned_bought',
    'It comes out with no particular feeling, which is itself the point.',
    'It comes out flat.'],
  ['earned_seat',
    'because the whole of what we are is that we did not take the shortcut',
    'because what we are is people who did not take the shortcut'],
  ['south',
    'That is the whole of my expertise and it has never been wrong.',
    'That is all my expertise amounts to and it has never been wrong.'],
  ['why_the_walk',
    'She does not dress it up and she does not look for a reaction.',
    'She does not look for a reaction.'],
  ['the_quiet_ones_bay',
    'She does not pretend the sentence is stronger than it is, and she does not add anything to it.',
    'She does not add anything to it.'],
  ['the_flask_sacred',
    '"It was. That is my whole point and you have said it for me."',
    '"It was. That is my point, and you have just made it for me."'],
  ['the_flask_sacred',
    'End to end, it is yours, and it is the only thing left that is.',
    'All of it is yours, and it is the only thing left that is.'],
  ['the_flask_diseased',
    'There is a difference between a man with an illness and a man who went and got one on purpose, and the difference is the whole of my opinion about him.',
    'There is a difference between a man with an illness and a man who went and got one on purpose. That difference is the only thing I think about him.'],
  ['the_flask_cleansed',
    'That is not me being generous.',
    'I am not being generous.'],
  ['the_flask_sea',
    'I have not walked all of it. I have told you that already and I am not going to pretend otherwise now because you have found a way of putting it that stings.',
    'I have not walked all of it. I said so already and I am not going to say something different now because you have found a better way of asking.'],
];
for (const [node, from, to] of LINES) {
  const v = t[node];
  if (!v || typeof v.text !== 'string') { log.push('  MISS  ' + node + ' (no node)'); continue; }
  if (!v.text.includes(from)) { log.push((v.text.includes(to) ? '  skip  ' : '  MISS  ') + node + ' :: ' + from.slice(0, 44)); continue; }
  v.text = v.text.split(from).join(to);
  log.push('  ok    ' + node.padEnd(20) + to.slice(0, 52));
}

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { log.push('DANGLING ' + k + ' -> ' + o.next); bad++; }
const linked = new Set(['root']);
for (const v of Object.values(t)) for (const o of v.options || []) if (o.next) linked.add(o.next);
for (const k of Object.keys(t)) if (!linked.has(k) && !k.startsWith('_')) { log.push('ORPHAN ' + k); bad++; }

console.log(log.join('\n'));
console.log('\n  nodes ' + Object.keys(t).length + ' · problems ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
