/**
 * The three insurance briefs, cut back. 2026-08-25.
 *
 * Same note as asc-colder.mjs: the vocabulary was right and the length was
 * making it warm. A brief that walks the player through why a thing is chilling
 * has done the reacting for them.
 *
 * Proof of Loss loses its explanation of what the number is FOR. It says whose
 * lifetime it is, and that she has not read the name, and stops.
 *
 * Adjuster keeps the four-step procedure, because that list IS the horror and
 * every item on it is load-bearing, but loses the sentence that summarised it.
 *
 * Within Tolerance stops walking the reader from the machine's output to its
 * consequence. Two facts, adjacent, no connective.
 *
 * Run: node scripts/content/asc-briefs-colder.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const quest = (id, text) => {
  const p = path.join(ROOT, 'quests', id + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const was = (d.description || '').split(/\s+/).length;
  d.description = text;
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  log.push(String(was).padStart(4) + ' -> ' + String(text.split(/\s+/).length).padStart(4) + ' words  ' + d.name);
};

quest('quest_asc_file',
  'A settled claim file is with a broker two districts over. It needs to be on the underwriting '
  + 'floor before the desk closes.\n\n'
  + '"Most of the work is carrying a number from where it was measured to where it is decided," '
  + 'Ives says.\n\n'
  + 'The number is how many years the model gives Aldous Frear, forty-one, a substandard risk out '
  + 'of the Yards. Somebody on the ninth floor reads it this afternoon and sets his premium '
  + 'against it.\n\n'
  + 'Ives files about four hundred of these a month. She has not read the name.');

quest('quest_asc_fav_adjuster',
  'An adjuster is closing an account on the ninth floor this afternoon. A year in arrears. She '
  + 'wants somebody in the corridor while she does it.\n\n'
  + 'Not to come in. Not to be introduced. Not to intervene.\n\n'
  + '"He will not take it well and it will not last long."\n\n'
  + 'Closing an account is four things. The cover ends. The chrome in him reverts to Halcyon and '
  + 'is scheduled for recovery. The household comes off the water and power book at the end of '
  + 'the month. The file goes into run-off.\n\n'
  + 'None of that happens this afternoon. This afternoon he is only told.');

quest('quest_asc_fav_tolerance',
  'A calibration set goes into a unit on the underwriting floor. Kesh would rather you did it '
  + 'than one of his technicians.\n\n'
  + 'The unit is one of nine that price mortality for the eastern districts. A person stands in '
  + 'front of it and it returns an expected remaining lifetime. That figure is what they are '
  + 'charged to stay covered.\n\n'
  + 'To Kesh it is a mount with a set going into it.\n\n'
  + 'He gives you the tolerance to four decimal places and expects it back inside that.');

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
