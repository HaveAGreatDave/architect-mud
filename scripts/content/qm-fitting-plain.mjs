/**
 * The fitting, said plainly. 2026-08-25.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * Read cold, by somebody who does not already know this game, the scene was
 * incomprehensible. "Then it is dark and it is loud" -- what is? "Watch the
 * band" -- what band? "The pumps come on at four" -- what pumps, where, and why
 * would that matter to me? Every line assumed the reader had already played for
 * a month.
 *
 * That is not a style problem, it is a FUNCTION problem. This scene is the one
 * place a new Watch member is handed equipment by an expert, and the expert says
 * nothing about what any of it is for. A player should come out of a dialogue
 * knowing more than they went in with.
 *
 * ── And an over-correction of my own ─────────────────────────────────────────
 *
 * The previous pass measured spoken turns in the nine books (median 6 words) and
 * drove this scene toward that number. That was the wrong target for THIS scene.
 * Six-word turns are what conversation looks like when both people already share
 * the context. A tradesperson explaining kit to a newcomer is exactly the case
 * where real speech gets longer, because the listener does not know yet and the
 * speaker can see that they do not.
 *
 * So: short turns are a symptom of shared context, never a goal in themselves.
 * Chasing the median produced dialogue that sounded clipped and expert and told
 * the player nothing.
 *
 * ── What she now actually does ───────────────────────────────────────────────
 *
 * She names each thing as she puts it down and says what it is for, and every
 * one maps to a hazard the engine really models: thirst, light and darkness,
 * hearing damage, radiation, cold and wet. A new player leaves this scene
 * knowing five things that will otherwise kill them, and they learned it from a
 * woman doing her job rather than from a tutorial box.
 *
 * Run: node scripts/content/qm-fitting-plain.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

const p = path.join(ROOT, 'npcs/npc_lw_quartermaster.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

for (const k of Object.keys(t)) if (k.startsWith('fit_')) delete t[k];

t.fit_what = {
  _vine: { x: 80, y: 900 }, actions: [],
  text: 'She closes the ledger on one finger.\n\n"What do you need it for?"',
  options: [
    opt('I am standing a watch.', 'fit_watch'),
    opt('I am going down into the Under.', 'fit_under'),
    opt('Out past the wall.', 'fit_above'),
    opt('I do not know. What do people take?', 'fit_basic'),
  ],
};

t.fit_basic = {
  _vine: { x: 80, y: 1120 }, actions: [],
  text:
    '"Water, a light, and a spare battery. That is the answer for everybody, every time, and '
    + 'most people find out the hard way."\n\n'
    + 'She sets all three out.\n\n'
    + '"Come back and tell me where you are actually going and I will do better than that."',
  options: [opt('Where should I be going?', 'fit_advice'), opt('That will do.', 'fit_done')],
};

t.fit_advice = {
  _vine: { x: 340, y: 1220 }, actions: [],
  text:
    '"There are three places the Watch send people. A post above ground, where the problem is the '
    + 'rain. The Under, which is the drains and the tunnels beneath the city, where the problem is '
    + 'the dark. And errands across Coldwater, where the problem is people."\n\n'
    + '"Ask me again when you know which."',
  options: [opt('Understood.', 'fit_done')],
};

t.fit_watch = {
  _vine: { x: 340, y: 780 }, actions: [],
  text:
    '"A watch is eight hours of sitting still in the cold looking at one thing. Dusk until about '
    + 'four. Nothing happens for nearly all of it, and that is the difficult part."\n\n'
    + 'She puts things on the counter and names them as she does.\n\n'
    + '"Water, because you will not leave the post to go and find any. A spare battery, because a '
    + 'light that dies out there is how people get lost. A towel, because your feet will get wet, '
    + 'and wet feet in the cold is how you lose toes."',
  options: [
    opt('What am I watching for?', 'fit_watch_for'),
    opt('Understood.', 'fit_done'),
  ],
};

t.fit_watch_for = {
  _vine: { x: 640, y: 700 }, actions: [],
  text:
    '"Cameras going back up, mostly. The Architect puts an eye somewhere, we see it go up, and '
    + 'then somebody goes and puts it out again."\n\n'
    + '"You are not there to stop anything. You are there so that we know."',
  options: [opt('Understood.', 'fit_done')],
};

t.fit_under = {
  _vine: { x: 340, y: 960 }, actions: [],
  text:
    '"The Under is the drains and the service tunnels under the city. There is no daylight down '
    + 'there at all, so you carry your own or you do not go."\n\n'
    + 'A flashlight, a spare battery, and a pair of ear defenders.\n\n'
    + '"The pumps start at four every morning, and if it has been raining, before that. They are '
    + 'loud enough to take your hearing for a day. Put those on before four. Not when you hear '
    + 'them start, because by then it has already happened."',
  options: [
    opt('What is down there?', 'fit_under_what'),
    opt('Understood.', 'fit_done'),
  ],
};

t.fit_under_what = {
  _vine: { x: 640, y: 1020 }, actions: [],
  text:
    '"People who did not want to be up here. Some of them will talk to you. A few things that '
    + 'will not."\n\n'
    + '"And our own door, which is why we care about it."',
  options: [opt('Understood.', 'fit_done')],
};

t.fit_above = {
  _vine: { x: 340, y: 620 }, actions: [],
  text:
    '"Then you want lenses and a band."\n\n'
    + 'Smoked glass, and a paper strip she snaps once to show it still works.\n\n'
    + '"The rain out past the wall has had radiation in it since before I was born. You cannot '
    + 'feel it and you cannot taste it. The band changes colour when you have had as much as a '
    + 'body should take in a day. When it changes, you turn round and come home."',
  options: [
    opt('And if it changes early?', 'fit_above_early'),
    opt('Understood.', 'fit_done'),
  ],
};

t.fit_above_early = {
  _vine: { x: 640, y: 560 }, actions: [],
  text:
    '"Then it changes early and you have wasted a night."\n\n'
    + 'She shrugs.\n\n'
    + '"I have got more bands. I have not got more of you."',
  options: [opt('Understood.', 'fit_done')],
};

t.fit_done = {
  _vine: { x: 940, y: 860 }, actions: [],
  text:
    'She writes the lot into the ledger and turns it round so you can see your own name against '
    + 'it.\n\n'
    + '"None of that is a gift. Bring back whatever you do not use, and tell me what you did use, '
    + 'because that is how I know what to keep on the shelf."',
  options: [opt('Show me the shelves.', '__shop__'), opt('Understood.', 'bye')],
};

for (const o of t.root.options || []) if (String(o.next).startsWith('fit_')) o.next = 'fit_what';

const names = new Set([...Object.keys(t), '__shop__']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
console.log('fit nodes: ' + Object.keys(t).filter(k => k.startsWith('fit_')).length + '  ·  dangling: ' + bad);

if (WRITE) { fs.writeFileSync(p, canonicalJson(d), 'utf8'); console.log('WROTE'); }
else console.log('dry run');
