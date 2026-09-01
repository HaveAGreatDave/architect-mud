/**
 * The grades, and the reason she is down there at all. 2026-08-25.
 *
 * ── The brief ────────────────────────────────────────────────────────────────
 *
 * The Long Watch should read as a noble rebellion against the Architect AND have
 * a hierarchy of mutants that is genuinely ugly. Both, in one person, without
 * the text picking a side.
 *
 * ── The nobility has to be real, not a set-up ────────────────────────────────
 *
 * If her decency is written as a veneer to be peeled off, the scene is a reveal
 * and the player is being told what to think. So the reason she walks the tunnel
 * is true and sufficient: eleven years of nights in the cold so that people who
 * are not her can sleep behind a door that has never been opened. She is not
 * paid. She will not be thanked. She has buried friends doing it and she is
 * going out again tomorrow.
 *
 * That has to be the strongest thing in the encounter, or the rest is cheap.
 *
 * ── And then the grades ──────────────────────────────────────────────────────
 *
 * A ladder of how much of a person you still count as, which she can recite
 * because it is practical to her:
 *
 *   CLEAN            nothing in you, nothing done to you. Full member.
 *   MARKED           something small that does not show. Tolerated, quietly.
 *   TURNED           it shows. Kept out.
 *   BOUGHT           chrome. Refused, and she would not have them at her back.
 *   DRANK            the flask. Desecration, and the bottom of the ladder.
 *
 * ── The line that makes it worse than doctrine ───────────────────────────────
 *
 * The boundary between MARKED and TURNED is not how much a person has changed.
 * It is WHETHER IT SHOWS. So the Watch tolerate exactly as much mutation as they
 * can avoid looking at, and Teague knows this, says so, and does not think it is
 * a problem — because to her the visible ones bring Halcyon down the tunnel and
 * the hidden ones do not.
 *
 * It also means she is standing next to people she would throw out if she knew,
 * and she has worked that out, and she has decided not to go looking.
 *
 * ⚠ She is not exposed, corrected or punished for any of this. Nobody argues her
 * down. The player is left holding it.
 *
 * Run: node scripts/content/lw-the-grades.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });

const p = path.join(ROOT, 'npcs/npc_lw_teague.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

// ── why she is down here, and it is not a trick ─────────────────────────────
t.why_the_walk = {
  _vine: { x: 620, y: 1760 }, actions: [],
  text:
    '"Because somebody has to and I am good at it."\n\n'
    + 'She does not dress it up and she does not look for a reaction.\n\n'
    + '"A mile back down this tunnel there is a door. Forty of us live behind it. The oldest is '
    + 'eighty-one. Two of them are children, and I said children should not be down here, and I '
    + 'was outvoted, and they are still here."\n\n'
    + '"If anybody comes down this tunnel at night, there is me, and then there is that door."\n\n'
    + '"Nobody pays me for it. I walk it again tomorrow and the night after. One night I will not '
    + 'come back, and one of the other four will take the round."',
  options: [
    opt('That is a life.', 'why_the_walk_life'),
    opt('Nobody has ever thanked you for it.', 'why_the_walk_thanks'),
    opt('(say nothing)', 'bye'),
  ],
};

t.why_the_walk_life = {
  _vine: { x: 880, y: 1680 }, actions: [],
  text:
    '"It is the one I have got and I am not sorry about it."\n\n'
    + 'She checks the tunnel behind you, which she has done every ninety seconds since you met '
    + 'her, and will keep doing after you have gone.\n\n'
    + '"The Architect sees the whole city. Every wire, every meter, every face on every street. '
    + 'It does not see this tunnel."\n\n'
    + '"That is five of us. Walking."',
  options: [opt('(say nothing)', 'bye')],
};

t.why_the_walk_thanks = {
  _vine: { x: 880, y: 1840 }, actions: [],
  text:
    '"No."\n\n'
    + 'She sounds faintly surprised anybody would expect it.\n\n'
    + '"Pike has sat that post ten thousand times and nobody has thanked him either. That is not '
    + 'a complaint. If it needed thanking to get done it would not get done, and then there would '
    + 'be nothing down here but Halcyon."',
  options: [opt('(say nothing)', 'bye')],
};

// ── the grades ──────────────────────────────────────────────────────────────
t.the_grades = {
  _vine: { x: 620, y: 2000 }, actions: [],
  text:
    '"There are grades to it. Nobody has written them down and everybody knows them."\n\n'
    + 'She counts them off without hesitating, which tells you how often this comes up.\n\n'
    + '"Clean is nothing in you and nothing done to you. That is a seat at any table we have '
    + 'got."\n\n'
    + '"Marked is something small that does not show. Half the Row has something. A man with a '
    + 'bad chest and grey patches on him is a man with a bad chest."\n\n'
    + '"Turned is when it shows. Bought is chrome. And then there is the flask."',
  options: [
    opt('What is the difference between marked and turned?', 'the_grades_line'),
    opt('You have a ladder for how much of a person somebody is.', 'stance_object'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_grades_line = {
  _vine: { x: 880, y: 2000 }, actions: [],
  text:
    '"Whether you can look at them without noticing."\n\n'
    + 'She says it plainly and does not appear to hear how it sounds.\n\n'
    + '"That is not me being shallow. A man nobody looks at twice brings nobody down this tunnel. '
    + 'A man people cross the road to stare at gets that road watched, and we are at the end of '
    + 'that road."',
  options: [
    opt('So you tolerate exactly what you can avoid seeing.', 'the_grades_honest'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_grades_honest = {
  _vine: { x: 1140, y: 2000 }, actions: [],
  text:
    '"Yes."\n\n'
    + 'No hesitation at all. She has been here before and she got here on her own.\n\n'
    + '"There will be two people behind that door tonight with something they have not told '
    + 'anybody, and I have thought about which two, and then I stopped thinking about it. I am '
    + 'not going to go looking and I am not going to ask."\n\n'
    + '"You can call that whatever you like. I have called it a few things myself, walking."',
  options: [
    opt('And if you found out?', 'the_grades_found'),
    opt('(say nothing)', 'bye'),
  ],
};

t.the_grades_found = {
  _vine: { x: 1400, y: 2000 }, actions: [],
  text:
    'She takes a while over that one.\n\n'
    + '"Then it would be in front of me and I would have to do something about it, and I would, '
    + 'and I would be sick about it for a month."\n\n'
    + 'She starts walking again.\n\n'
    + '"Which is exactly why I do not go looking. I am not proud of that one. It is the only part '
    + 'of any of this I am not proud of."',
  options: [opt('(say nothing)', 'bye')],
};

// ── hooks ───────────────────────────────────────────────────────────────────
const rootOpts = (t.root.options ||= []);
for (const o of [
  opt('Why do you do this every night?', 'why_the_walk'),
  opt('Is there a line, or is it just anybody changed?', 'the_grades'),
]) if (!rootOpts.some(e => e.label === o.label)) rootOpts.splice(1, 0, o);

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
console.log('  Teague   why she walks it — forty people, two children, nobody pays her');
console.log('  Teague   the grades: clean / marked / turned / bought / drank');
console.log('  Teague   the line is whether it SHOWS, and she knows it, and does not go looking');
console.log('  nodes ' + Object.keys(t).length + ' · dangling ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
