/**
 * Foreman Duc says what the piece is. 2026-08-25.
 *
 * Duc topped the dialogue audit at 39.8, and most of that score is deserved,
 * but not all of it. Two of the three flags are real and one is not.
 *
 * KEPT: "You have got a pulse and a poor sense of self-preservation. That is the
 * whole specification." The audit reads that as an aphoristic closer. It is one,
 * and it stays, because a specification is a fab foreman's actual vocabulary and
 * he is using it to describe a person. That is the Ascendant contempt in the one
 * register he owns, and nobody in the scene remarks on it.
 *
 * FIXED: "The piece comes back. I am being clear about the piece." He insists on
 * clarity about a thing he never names, twice, which is the same fault as a
 * surgeon selling "the unit". Duc is a fabricator. He would say what it is,
 * what it does, and what he wants to know about it, because those are the terms
 * of the job.
 *
 * FIXED: he asked nothing. His whole description is that he talks to people the
 * way he talks to machines — plainly, and only when there is a point — and a man
 * running in a new part needs to know how hard it is about to be used. So he
 * asks, and the answer changes what he hands over.
 *
 * The piece is a hand actuator, which is chosen rather than invented: slot 4 is
 * about a calibration set for the units that price mortality, Kesh's own scene
 * is about knuckles, and the Weave is where the muscle is spun. It keeps the
 * arc's hands motif and it is a thing a player can picture.
 *
 * Run: node scripts/content/duc-names-the-piece.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

const p = path.join(ROOT, 'npcs/npc_asc_duc.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

t.tolerance_offer.text =
  '"You have got a pulse and a poor sense of self-preservation. That is the whole '
  + 'specification." Duc wipes his hands on the apron and does not look up.\n\n'
  + '"Hand actuator. Second knuckle, index and middle — the two that do the gripping. Mine are '
  + 'good for eleven years and I want to know why the last batch came back at nine."\n\n'
  + '"I need it run in. Not tested. Tested is a bench and a week and it tells you nothing about '
  + 'what a hand actually does. Run in means out there, on somebody, doing work."\n\n'
  + '"So: what do you do with your hands all day?"';

t.tolerance_offer.options = [
  opt('Carrying, mostly.', 'tolerance_carry'),
  opt('Hitting things.', 'tolerance_hit'),
  opt('Not my line of work.', 'bye'),
];

t.tolerance_carry = {
  _vine: { x: 900, y: 980 }, actions: [],
  text:
    '"Load, then. That is the boring failure and the one I care about."\n\n'
    + 'He puts the set on the bench and pushes it across with two fingers.\n\n'
    + '"Do not favour it. People favour a new one and then I get a clean part back and learn '
    + 'nothing."',
  options: [opt('Understood.', 'tolerance_return')],
};

t.tolerance_hit = {
  _vine: { x: 900, y: 1120 }, actions: [],
  text:
    '"Shock loading." Something that is nearly approval. "Good. That is where they break and '
    + 'nobody will admit to it on a form."\n\n'
    + 'He puts the set on the bench and pushes it across with two fingers.\n\n'
    + '"Break it if it is going to break. I would rather find out on you than on a surgeon\'s '
    + 'table in nine years."',
  options: [opt('Understood.', 'tolerance_return')],
};

t.tolerance_return = {
  _vine: { x: 1160, y: 1050 }, actions: [],
  text:
    '"One thing." He holds up a finger, and it is chrome to the second joint.\n\n'
    + '"The actuator comes back. Whatever else happens, the part comes back to this bench. If you '
    + 'are dead I will send somebody for it, and that is not a threat, it is a work order."',
  options: [opt('It comes back.', 'tolerance_accept')],
};

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

const names = new Set([...Object.keys(t), '__shop__']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
console.log('  Duc: names the part, asks how you use your hands, two branches · dangling ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
