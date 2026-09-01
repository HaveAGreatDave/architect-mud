/**
 * Two rooms that promise a direction the room does not have.
 *
 * Chekhov's gun in the form it takes in a MUD: bolding a word in a room
 * description is this game's convention for "this is a thing you can type", so
 * bolding a direction that is not an exit is a gun on the wall that cannot be
 * fired. The player types it, gets nothing, and learns to distrust the bold.
 *
 * Found by checking every `<b>direction</b>` in all 17,259 zone descriptions
 * against that zone's actual `exits` map. Twenty-eight zones bold a direction;
 * two of them were wrong.
 *
 *   zone_district_914_908 — the street outside Solenne Residences says
 *     "Step <b>in</b>." The way into the lobby is NORTH. `in` does nothing here.
 *     ⚠ This is the rule in feedback_building_interior_exit_direction: a facade
 *     is entered on the compass direction its entrance arrow points, never `out`
 *     or `in`.
 *
 *   zone_solenne_lobby — "The way <b>out</b> is south" bolds the noun instead of
 *     the command. `out` is not an exit here; `south` is, and is sitting
 *     unbolded in the same clause. (Its second bold, "step <b>in</b> to the
 *     elevator", is correct — `in` really is an exit from this room.)
 *
 *   node scripts/content/prose-broken-directions.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ZONES = path.join(process.cwd(), 'content', 'zones');
const CHECK = process.argv.includes('--check');

const EDITS = [
  ['zone_district_914_908',
    'Step <b>in</b>.',
    'Step <b>north</b>.'],
  ['zone_solenne_lobby',
    'The way <b>out</b> is south, to the street; step <b>in</b> to the elevator.',
    'The way out is <b>south</b>, to the street; step <b>in</b> to the elevator.'],
];

const DIRS = ['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest', 'in', 'out'];
const BOLD_DIR = new RegExp(`<b>\\s*(${DIRS.join('|')})\\s*</b>`, 'gi');

let applied = 0, already = 0;
const problems = [];

for (const [id, from, to] of EDITS) {
  const file = path.join(ZONES, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: missing`); continue; }
  const z = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (z.description.includes(to)) { already++; continue; }
  if (!z.description.includes(from)) { problems.push(`${id}: no match`); continue; }
  z.description = z.description.replace(from, to);

  // Do not trade one broken promise for another.
  const exits = Object.keys(z.exits || {}).map((s) => s.toLowerCase());
  BOLD_DIR.lastIndex = 0;
  let m;
  while ((m = BOLD_DIR.exec(z.description)) !== null) {
    if (!exits.includes(m[1].toLowerCase())) {
      problems.push(`${id}: replacement still bolds <b>${m[1]}</b>, which is not an exit (${exits.join(', ')})`);
    }
  }
  if (!CHECK) fs.writeFileSync(file, canonicalJson(z), 'utf8');
  applied++;
}

// Sweep the whole tree so this cannot come back unnoticed.
let bolded = 0, broken = 0;
for (const f of fs.readdirSync(ZONES)) {
  const z = JSON.parse(fs.readFileSync(path.join(ZONES, f), 'utf8'));
  if (typeof z.description !== 'string') continue;
  const exits = Object.keys(z.exits || {}).map((s) => s.toLowerCase());
  BOLD_DIR.lastIndex = 0;
  let m, any = false;
  while ((m = BOLD_DIR.exec(z.description)) !== null) {
    any = true;
    if (!exits.includes(m[1].toLowerCase())) { broken++; console.error(`  ! ${z.id}: bolds <b>${m[1]}</b>, exits are ${exits.join(', ') || '(none)'}`); }
  }
  if (any) bolded++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Directions: ${applied} fixed, ${already} already done. Swept ${bolded} zone(s) that bold a direction; ${broken} still broken.`);
if (problems.length || (!CHECK && broken)) { process.exit(1); }
