/**
 * The Ascendant quest briefs use the same vocabulary their people do. 2026-08-25.
 *
 * Companion to asc-actuarial-voice.mjs, which put the real terms in Ives',
 * Maresh's and Vess's mouths. The briefs were still describing the same events
 * in ordinary English, which made the dialogue sound like an affectation rather
 * than the way this company actually thinks.
 *
 * The point of the vocabulary is that it is not a euphemism. A euphemism is a
 * softer word for a hard thing and everybody knows what is meant. These are
 * PRECISE technical terms that happen to have no person in them, used by people
 * who are not hiding anything and would be puzzled to hear the objection.
 *
 * Three briefs, three places where the plain word was doing the flinching:
 *
 *   Proof of Loss    "a number" -> the number is a man's remaining lifetime,
 *                    and the brief now says which man, and that Ives will never
 *                    know his name either.
 *   Adjuster         "close an account" is already theirs. What was missing is
 *                    what closing one does to a household, stated as procedure.
 *   Within Tolerance the unit prices mortality and the brief said so kindly.
 *                    It now says what the output is used for.
 *
 * Run: node scripts/content/asc-quest-vocabulary.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

const quest = (id, fn) => {
  const p = path.join(ROOT, 'quests', id + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

quest('quest_asc_file', (d) => {
  d.description =
    'There is a settled claim file sitting with a broker two districts over, and it needs to be '
    + 'on the underwriting floor before the desk closes. It is a walk with a wallet in it.\n\n'
    + 'Verity Ives is candid about that.\n\n'
    + '"I could give you something dramatic instead, and it would tell you nothing true about us '
    + 'at all. This is what the work is. Most of it is carrying a number from where it was '
    + 'measured to where it is decided."\n\n'
    + 'The number is a man called Aldous Frear, forty-one, a substandard risk out of the Yards, '
    + 'and the figure in the file is how many years the model thinks he has left. Somebody on the '
    + 'ninth floor will read it this afternoon and set his premium against it.\n\n'
    + 'Ives has not read the name and will not. She has told you, without being asked, that she '
    + 'files about four hundred of these a month.';
  log.push('Proof of Loss     the number is a named man, and she will never learn the name');
});

quest('quest_asc_fav_adjuster', (d) => {
  d.description =
    'An adjuster is going to a residence on the ninth floor this afternoon to close an account '
    + 'that has been in arrears for a year, and she would like somebody in the corridor while she '
    + 'does it.\n\n'
    + 'Not to come in. Not to be introduced. Not to intervene, and she is firm about that, and she '
    + 'is firm about it early.\n\n'
    + '"He will not take it well and it will not last long," she says, checking the floor number '
    + 'against a card she does not need to check.\n\n'
    + 'Closing an account is four things in a fixed order: the cover ends, the chrome in him '
    + 'reverts to Halcyon and is scheduled for recovery, the household comes off the water and '
    + 'power book at the end of the month, and the file goes into run-off. None of it happens to '
    + 'him this afternoon. This afternoon he is only told.\n\n'
    + '"An hour of unpleasantness," she says, "against a reserve we have been carrying since '
    + 'March."';
  log.push('Adjuster          closing an account, stated as the four-step procedure it is');
});

quest('quest_asc_fav_tolerance', (d) => {
  d.description =
    'There is a calibration set to go into a unit on the underwriting floor, and Kesh would '
    + 'rather you did it than one of his technicians.\n\n'
    + 'The unit is one of nine that price mortality for the eastern districts. A person stands in '
    + 'front of it, it reads them, and it returns an expected remaining lifetime. That figure sets '
    + 'what they are charged to stay covered, so the people it reads worst are charged the most, '
    + 'and the ones who cannot pay come off the book and stop being anybody\'s problem.\n\n'
    + 'Kesh explains none of that, because to Kesh it is a mount with a set going into it.\n\n'
    + 'He gives you the tolerance, and he gives it to four decimal places, and he expects it back '
    + 'inside that.';
  log.push('Within Tolerance  says out loud what the machine\'s output is used for');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
