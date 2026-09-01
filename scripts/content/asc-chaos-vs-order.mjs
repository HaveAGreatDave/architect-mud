/**
 * Halcyon's objection to the mutagen is an engineering objection. 2026-08-26.
 *
 * ── The line that had to go ──────────────────────────────────────────────────
 *
 * Maresh: "Nothing that happens to a person out in the weather is any of those
 * things." That is a mutation-is-getting-rained-on reference, it is the third
 * weather metaphor this material has produced, and it makes the Ascendant
 * position sound like a policy on outdoor work.
 *
 * ── What they actually object to ─────────────────────────────────────────────
 *
 * Not that the mutagen is dirty. That it is UNREPEATABLE.
 *
 * Their creed is engineered ascent — designed, tested, licensed, recorded,
 * removable. Every one of those words is about a process that produces the same
 * result twice. The mutagen has no dose, no schedule, no two batches alike, and
 * the same flask from the same hand on the same afternoon does two different
 * things to two men.
 *
 * And the people who make it do not consider that a defect. Asked why, they say
 * it chose. To an order whose entire self-image is control over outcome, that is
 * the single most offensive sentence available, and Maresh answers it with the
 * flattest line he has: WE DO NOT BUILD THINGS THAT CHOOSE.
 *
 * That gives the two orders opposite objections to the same substance, which is
 * what the mirror needs:
 *
 *   TEAGUE   it is a drug, and what stands up afterwards is not a person
 *   MARESH   it is a process with no control over its own output
 *
 * Neither has heard the other say it.
 *
 * ── The other weather line ───────────────────────────────────────────────────
 *
 * The rad band's "the rain out past the wall has had radiation in it since
 * before I was born" STAYS. That one is literal — it is the Quartermaster
 * explaining a piece of safety kit and the rain is doing the thing rain does.
 *
 * Run: node scripts/content/asc-chaos-vs-order.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });
const insertOpts = (node, ...opts) => {
  const list = (node.options ||= []);
  const fresh = opts.filter(o => !list.some(e => e.label === o.label));
  if (fresh.length) list.splice(1, 0, ...fresh);
};

const p = path.join(ROOT, 'npcs/npc_asc_recruiter.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

t.why_us.text =
  '"Because what we do to you is chosen, and it is repeatable."\n\n'
  + '"Every piece is designed, tested, licensed and written down. If it fails we know whose bench '
  + 'it came off. If you want it out, it comes out. Fit the same unit to a thousand people and you '
  + 'get a thousand of the same result, which is the entire achievement."';
t.why_us.options = [
  opt('And the flask?', 'why_us_flask'),
  opt('What about mutants?', 'why_us_variation'),
  opt('And the price?', 'why_us_price'),
  opt('(say nothing)', 'bye'),
];

t.why_us_flask = {
  _vine: { x: 1160, y: 1460 }, actions: [],
  text:
    '"They drink it. That is the procedure in full."\n\n'
    + 'He does not raise his voice, but this is the only subject on which he stops being '
    + 'charming.\n\n'
    + '"No dose. No schedule. No two batches alike, because there is no method — it is made in a '
    + 'pool by people who do not write anything down."\n\n'
    + '"Two men take the same flask from the same hand on the same afternoon. One of them ends up '
    + 'with a second heart. The other gets a fever and four bad years."',
  options: [
    opt('So it is unpredictable.', 'why_us_flask_chose'),
    opt('It works, though.', 'why_us_flask_works'),
    opt('(say nothing)', 'bye'),
  ],
};

t.why_us_flask_chose = {
  _vine: { x: 1420, y: 1380 }, actions: [],
  text:
    '"Ask the people who make it why, and they will tell you it chose."\n\n'
    + 'He lets that sit, because to him it is self-evidently the end of the argument.\n\n'
    + '"That is their answer. Not a variable they have not isolated yet. Not a contaminant. It '
    + 'chose."\n\n'
    + '"<b>We do not build things that choose.</b>"',
  options: [
    opt('Neither do you. You buy them.', 'why_us_flask_barb'),
    opt('(say nothing)', 'bye'),
  ],
};

t.why_us_flask_works = {
  _vine: { x: 1420, y: 1540 }, actions: [],
  text:
    '"Sometimes. That is the problem, not the defence."\n\n'
    + '"A thing that works four times in six is not a technology. It is a wager, and they are '
    + 'running it on people, and when it goes wrong there is nobody to write to."\n\n'
    + '"Kesh has a form he fills in when a joint fails at nine years instead of eleven. It goes to '
    + 'the bench that made it. Somebody is answerable. Ask out south who is answerable."',
  options: [opt('(say nothing)', 'bye')],
};

t.why_us_flask_barb = {
  _vine: { x: 1680, y: 1380 }, actions: [],
  text:
    'The smile comes back, and he is genuinely enjoying himself for the first time.\n\n'
    + '"We do. And the bench that built it has a name, and the man at the bench has a name, and '
    + 'the record has a date on it."\n\n'
    + '"You are welcome to think that is worse. Nobody has ever explained to me why."',
  options: [opt('(say nothing)', 'bye')],
};

insertOpts(t.root, opt('What do you make of the flask?', 'why_us_flask'));

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
console.log('  Maresh   the flask has no method, and the makers say it chose');
console.log('  Maresh   "We do not build things that choose."');
console.log('  nodes ' + Object.keys(t).length + ' · dangling ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
