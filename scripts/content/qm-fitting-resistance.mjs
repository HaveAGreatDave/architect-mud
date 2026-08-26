/**
 * The fitting, on the right faction. 2026-08-25.
 *
 * ── The error ────────────────────────────────────────────────────────────────
 *
 * The previous version had the Quartermaster kitting people out for "eight hours
 * of sitting still in the cold looking at one thing". That reads the order's
 * name literally and it is wrong. From their own ideology row:
 *
 *   "an enduring underground movement that would keep Coldwater Basin's
 *    infrastructure and technology intact, but wrest its stewardship back from
 *    the Architect. They are reformers, not arsonists: the tools stay, the hand
 *    on them changes."
 *
 * They are a RESISTANCE. Surveillance, undermining, counter-espionage, staying
 * covert underground until there is a moment worth taking the city in. The
 * closest real model is the French Resistance. Nobody in that organisation was
 * ever handed a flask and told to go and look at a wall for a shift.
 *
 * The name is not about watching things. It is about the long wait for the right
 * moment -- which is a much harder discipline and a much better faction, and it
 * is what the player should hear the first time somebody kits them out.
 *
 * ── What changes in the kit talk ─────────────────────────────────────────────
 *
 * Same shelf, different reasons, and the reasons are the interesting part:
 *
 *   the Under      is not a place they guard, it is how they cross the city
 *                  without walking past a single camera. Light, spare battery,
 *                  ear defenders for the pumps.
 *   a job          is being inside somewhere you should not be. Gloves so you
 *                  leave nothing, tape because it is quiet, and the rule about
 *                  carrying nothing that names the order.
 *   past the wall  is still the rain and the rad band.
 *
 * Every item still maps to a hazard the engine models. What the player now
 * learns is what this organisation IS, from the first person who ever hands
 * them anything.
 *
 * Run: node scripts/content/qm-fitting-resistance.mjs [--write]
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
    opt('Getting across the city unseen.', 'fit_under'),
    opt('Going inside somewhere I should not be.', 'fit_job'),
    opt('Out past the wall.', 'fit_above'),
    opt('I do not know yet. What do people take?', 'fit_basic'),
  ],
};

t.fit_basic = {
  _vine: { x: 80, y: 1140 }, actions: [],
  text:
    '"Water, a light, and a spare battery. That is the answer for everybody, every time."\n\n'
    + 'She sets all three out.\n\n'
    + '"Tell me the actual job and I will do better than that."',
  options: [opt('What kind of jobs are there?', 'fit_jobs_are'), opt('That will do.', 'fit_done')],
};

t.fit_jobs_are = {
  _vine: { x: 340, y: 1240 }, actions: [],
  text:
    '"Three kinds, mostly. Carrying something by hand, because every wire in this city belongs to '
    + 'somebody who reads it. Going and looking at a thing and coming back able to describe it. '
    + 'And making something of theirs stop working in a way that looks like it broke on its own."\n\n'
    + '"None of it is heroic and all of it is necessary. Ask me again when you have been given '
    + 'one."',
  options: [opt('Understood.', 'fit_done')],
};

t.fit_under = {
  _vine: { x: 340, y: 960 }, actions: [],
  text:
    '"The Under, then. The drains and the service tunnels."\n\n'
    + 'A flashlight, a spare battery and ear defenders go on the counter.\n\n'
    + '"We are not down there because we like it. We are down there because it is the only way '
    + 'across Coldwater that does not walk you past forty cameras. Learn the tunnels and you can '
    + 'be on the other side of the city with nothing on record saying you left this room."',
  options: [
    opt('What is the danger down there?', 'fit_under_danger'),
    opt('Understood.', 'fit_done'),
  ],
};

t.fit_under_danger = {
  _vine: { x: 640, y: 1020 }, actions: [],
  text:
    '"The dark, first. There is no daylight at all, so you carry your own or you do not go."\n\n'
    + '"Then the pumps. They start at four every morning, and earlier if it has rained. They are '
    + 'loud enough to take your hearing for a day. Put the defenders on before four, not when you '
    + 'hear them start, because by then it has already happened."',
  options: [opt('Understood.', 'fit_done')],
};

t.fit_job = {
  _vine: { x: 340, y: 780 }, actions: [],
  text:
    '"Inside." She does not ask whose. "Gloves, then, and tape."\n\n'
    + 'Work gloves and a roll of duct tape.\n\n'
    + '"Gloves so you leave nothing of yourself behind. Tape because it is quiet and it holds, '
    + 'and half of what we do is making a thing look like it failed rather than like somebody '
    + 'helped it."',
  options: [
    opt('Anything I should not take?', 'fit_job_not'),
    opt('Understood.', 'fit_done'),
  ],
};

t.fit_job_not = {
  _vine: { x: 640, y: 700 }, actions: [],
  text:
    '"Anything that says who you are, and anything that says who we are."\n\n'
    + 'She taps the counter twice.\n\n'
    + '"If they catch you with a bag of our kit they have got one person. If they catch you with '
    + 'a list, they have got the lot of us. Carry what the job needs and not one item more."',
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
console.log('fit nodes: ' + Object.keys(t).filter(k => k.startsWith('fit_')).length + ' · dangling: ' + bad);
if (WRITE) { fs.writeFileSync(p, canonicalJson(d), 'utf8'); console.log('WROTE'); }
else console.log('dry run');
