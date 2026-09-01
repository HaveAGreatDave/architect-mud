/**
 * The Long Watch are arsonists with a filing system. 2026-08-25.
 *
 * ── What the ideology row said, and why it was misleading me ─────────────────
 *
 *   "They are reformers, not arsonists: the tools stay, the hand on them
 *    changes."
 *
 * Two problems. The first is that it is not true: slot 10 of their own arc is
 * `quest_lw_rite`, in which the player takes a demolition charge off the
 * Quartermaster's counter and brings down the vat colonnade. They burn things.
 *
 * The second is that the sentence is built out of the exact construction this
 * house has spent a week removing -- a contrast frame, "not X but Y", which
 * flattens a real position into a slogan and then gets believed. I read that
 * line, took it literally, and wrote a whole fitting scene about standing still
 * in the cold. The canon text was the thing misleading me.
 *
 * ── What is actually true ────────────────────────────────────────────────────
 *
 * They sabotage, including destructively, and every bit of it has to serve the
 * plan. The distinction is not destruction versus reform. It is that they intend
 * to INHERIT this city, so they will not wreck what the people who live here
 * need, and they will burn anything that only the Architect needs. Where one
 * object is both -- and it often is -- that is an argument, and the argument is
 * most of what a cell does with its evenings.
 *
 * That is a better faction than the one the old sentence described, it matches
 * the content that already ships, and it gives every sabotage quest a test it
 * has to pass: who does this thing serve, and what happens to the district in
 * the morning?
 *
 * The purity paragraph is untouched. It is canon, it is an entry requirement
 * rather than a preference, and it is the ugliest true thing about them.
 *
 * Run: node scripts/content/lw-canon-arson.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');

// ── the ideology row ────────────────────────────────────────────────────────
{
  const p = path.join(ROOT, 'orgs/ideology_long_watch.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const tail = d.description.slice(d.description.indexOf('They do not seek to transcend'));

  d.description =
    'The city belongs to its people, not its machine. The Long Watch is an enduring underground '
    + 'movement that means to take the Coldwater Basin back from the Architect, and to have a city '
    + 'left standing when it does. They sabotage constantly and they are careful about what: a '
    + 'relay, a records floor, a vat hall, anything that serves the machine and nobody else. They '
    + 'will not touch the water, the grid or the trains, because they intend to inherit those, and '
    + 'a city nobody can live in is not worth taking. Where a thing is both at once they argue '
    + 'about it, and that argument is most of what a cell does with its evenings. '
    + tail;

  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  console.log('ideology_long_watch  description rewritten (' + d.description.length + ' chars)');
}

// ── and the Quartermaster describes the work honestly ───────────────────────
{
  const p = path.join(ROOT, 'npcs/npc_lw_quartermaster.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.dialogue_tree.fit_jobs_are.text =
    '"Four kinds, mostly. Carrying something by hand, because every wire in this city belongs to '
    + 'somebody who reads it. Going and looking at a thing and coming back able to describe it. '
    + 'Making something of theirs stop working in a way that looks like it broke on its own."\n\n'
    + '"And now and again, breaking something so badly that everybody knows it was us. That one is '
    + 'rare and it is decided a long way above me."\n\n'
    + '"Ask me again when you have been given one."';

  d.dialogue_tree.fit_jobs_are.options = [
    { label: 'How do you decide what to break?', next: 'fit_what_breaks', conditions: [], actions: [], enabled: true },
    { label: 'Understood.', next: 'fit_done', conditions: [], actions: [], enabled: true },
  ];

  d.dialogue_tree.fit_what_breaks = {
    _vine: { x: 640, y: 1300 }, actions: [],
    text:
      '"By who needs it in the morning."\n\n'
      + 'She turns a page.\n\n'
      + '"A camera on the approach is theirs and nobody else\'s, so it goes. The pumps under the '
      + 'Row are ours as much as theirs, so they stay, and I have sat through four hours of '
      + 'argument about a substation that turned out to be both."\n\n'
      + '"We are taking this city. Not the ashes of it."',
    options: [{ label: 'Understood.', next: 'fit_done', conditions: [], actions: [], enabled: true }],
  };

  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  console.log('Quartermaster        the four kinds of work + how they choose a target');
}

console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
