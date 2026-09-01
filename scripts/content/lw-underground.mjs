/**
 * The Long Watch are an underground that has not risen yet. 2026-08-26.
 *
 * ── What the row still said ──────────────────────────────────────────────────
 *
 * lw-canon-arson.mjs took "reformers, not arsonists" out of the description a
 * day ago, but only the sentence. The frame it came from survived everywhere
 * else in the row: tenets ending "Reform civilization", `Reform` sitting in
 * `values`, and a description in which the Watch sabotage constantly and are
 * apparently unbothered about being seen doing it. A reformer is somebody who
 * expects to win the argument. This lot do not expect to win anything yet.
 *
 * ── What they are ────────────────────────────────────────────────────────────
 *
 * A revolutionary underground that has decided it cannot take the Basin today,
 * so it waits — and while it waits it makes the machine weaker and stays out of
 * sight. Sabotage and subterfuge are the whole method: a relay that fails in the
 * wrong weather, a records floor that loses eleven years, a shipment short and
 * correctly signed for. Nothing is claimed, because being CLAIMED is the failure
 * state. An operation that leaves the Watch visible has failed whatever else it
 * achieved.
 *
 * That reframes the restraint rather than removing it: they still will not touch
 * the water, the grid or the trains, but the reason is now inheritance rather
 * than decency, and it lands on the same argument a cell spends its evenings on.
 *
 * The purity paragraph is untouched, again. It is canon, it is an entry
 * requirement rather than a preference, and it is the ugliest true thing about
 * them.
 *
 * Run: node scripts/content/lw-underground.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const p = path.join(ROOT, 'orgs/ideology_long_watch.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));

// The purity half is canon and stays exactly as it is.
const PURITY = d.description.slice(d.description.indexOf('They do not seek to transcend'));
if (!PURITY) throw new Error('purity paragraph not found — description has moved');

d.description =
  'The city belongs to its people, not its machine. The Long Watch is an underground movement that '
  + 'means to take the Coldwater Basin off the Architect, and has decided it cannot do that yet. So '
  + 'it waits, and while it waits it makes the machine weaker: a relay that fails in the wrong '
  + 'weather, a records floor that loses eleven years, a shipment that arrives short and correctly '
  + 'signed for, a clerk who was theirs for six years before anybody asked her for anything. '
  + 'Sabotage and subterfuge, and nothing that cannot be explained as the Basin wearing out. '
  + 'Nothing is ever claimed. An operation that leaves the Watch visible has failed whatever else '
  + 'it achieved, and the cell that ran it goes quiet for a season. They will not touch the water, '
  + 'the grid or the trains, because those belong to the city and the city is what they intend to '
  + 'be holding on the day they surface. Where a thing serves both at once they argue about it, and '
  + 'that argument is most of what a cell does with its evenings. '
  + PURITY;

d.flags.reader.tenets = [
  'The Basin belongs to its people, not its machine.',
  'Weaken the machine now. Take it when we can hold it.',
  'Preserve what the city needs; we intend to inherit it.',
  'Work unseen, and stay human doing it.',
];

d.flags.reader.pull = 'Keep the lights on. Take the switch when we can hold it.';

// One sentence into the reader, because the fantasy is now patience as well as skill.
const EXP = d.flags.reader.experience;
const ANCHOR = 'The fantasy here is the quiet one.';
if (!EXP.includes(ANCHOR)) throw new Error('reader.experience anchor not found');
d.flags.reader.experience = EXP.replace(
  ANCHOR,
  ANCHOR + ' The Watch has been at this longer than you have been alive and does not expect to win '
  + 'this year; the work is to hand the next lot a weaker machine than you were given, without ever '
  + 'having been seen doing it.',
);

d.flags.values = ['Liberty', 'Patience', 'Secrecy', 'Responsibility', 'Community', 'Hope'];

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
console.log('ideology_long_watch  description ' + d.description.length + ' chars, '
  + d.flags.reader.tenets.length + ' tenets, values: ' + d.flags.values.join(', '));
console.log(WRITE ? 'written' : 'dry run — pass --write');
