/**
 * The Bench becomes the Vice; the Spine becomes the Drift. 2026-08-25.
 *
 * ── Why they had to move ─────────────────────────────────────────────────────
 *
 * The place-names check found both names held by unrelated places:
 *
 *   "The Bench"  — a Deadwater tile, an Exodus room, THIS room, a Terminus tile
 *   "The Spine"  — THIS room and thirteen Terminus tiles
 *
 * A player reading "meet me at the Bench" had four candidates in four regions.
 *
 * ── Why these names ──────────────────────────────────────────────────────────
 *
 * Both are drawn from what the rooms already are, and both keep the Watch's
 * naming convention, which is plain, functional and quietly unpleasant: the
 * Blind, the Threshold, the Outfall, the Lockers.
 *
 * THE VICE. Halloran's workshop already contains "vices, gravers, a lathe run
 * off a foot treadle". A vice is the thing that holds work still while a person
 * makes something, and this order runs on things that were made rather than
 * bought. It is also a word with an edge on it, which nobody in the fiction ever
 * points out.
 *
 * THE DRIFT. A drift is a mining term for a horizontal passage driven off the
 * main shaft to reach the working. That is exactly what this corridor is -- a
 * long service run behind a second, heavier door, off the part of the base where
 * people actually live. And an order whose whole discipline is waiting for the
 * right moment can afford one name that admits it.
 *
 * Neither word appears in any of the 859 zone names.
 *
 * ── The smell of ink ─────────────────────────────────────────────────────────
 *
 * The corridor already said "a smell of ink and hot metal drifting up it" and
 * nothing anywhere explained it. Ink in a resistance base is forgery: papers,
 * permits, ration books, the documents that let somebody exist. The description
 * now says so, because a player should be able to work out what an order does
 * from the rooms it keeps.
 *
 * Run: node scripts/content/lw-room-renames.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

const zone = (id, fn) => {
  const p = path.join(ROOT, 'zones', id + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── the workshop ────────────────────────────────────────────────────────────
zone('zone_lw_bench', (d) => {
  d.name = 'The Vice';
  d.description =
    'Halloran\'s real workshop, and the room the shop upstairs is a polite lie about. Vices along '
    + 'the bench, gravers, a lathe run off a foot treadle, and racks of the only gear the Watch '
    + 'trust: iron sights, film cameras, wind-up timers, paper maps, a rifle scope with no '
    + 'electronics in it at all.\n\n'
    + 'Nothing in this room can be switched off from somewhere else. Everything on these racks can '
    + 'be fixed by the person carrying it, in the dark, with cold hands.';
  log.push('zone_lw_bench   The Bench -> The Vice');
});

// ── the working corridor ────────────────────────────────────────────────────
zone('zone_lw_spine', (d) => {
  d.name = 'The Drift';
  d.description =
    'A long service corridor behind a second, heavier door: the part of the base most of the Watch '
    + 'have never been shown. Bare bulbs on a hand-strung line, doors off both sides, and a smell '
    + 'of ink and hot metal coming up it.\n\n'
    + 'The ink is the point. Behind one of these doors somebody is making permits, ration books '
    + 'and transit papers, which is how a person who is not supposed to exist buys food and '
    + 'crosses a checkpoint. This is not where the Watch live. This is where the Watch work.';
  log.push('zone_lw_spine   The Spine -> The Drift');
});

// ── somebody says why, once ─────────────────────────────────────────────────
{
  const p = path.join(ROOT, 'npcs/npc_lw_halloran.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.dialogue_tree;
  if (!t.why_vice) {
    t.why_vice = {
      _vine: { x: 1200, y: 1180 }, actions: [],
      text:
        '"Because there is one on every bench in here and because it is what the room does."\n\n'
        + 'He works while he talks.\n\n'
        + '"A vice holds a thing still so you can make it. Nobody sells us anything, so we make '
        + 'it. That is not a philosophy, it is a supply problem, and this is the room where the '
        + 'supply problem gets solved."\n\n'
        + '"The corridor through the back is the Drift. Mining word. A drift is the tunnel you cut '
        + 'sideways to get at the work. Papers get made down there, and you do not go and look."',
      options: [
        { label: 'What kind of papers?', next: 'why_drift_papers', conditions: [], actions: [], enabled: true },
        { label: 'Understood.', next: 'bye', conditions: [], actions: [], enabled: true },
      ],
    };
    t.why_drift_papers = {
      _vine: { x: 1440, y: 1180 }, actions: [],
      text:
        '"Permits. Ration books. Transit papers. A residence card with a real number on it."\n\n'
        + 'He sets the iron down.\n\n'
        + '"If the Architect has got no record of you, you cannot buy food and you cannot cross a '
        + 'checkpoint. There are people in this city who have been alive for nine years on paper '
        + 'that came out of that corridor."\n\n'
        + '"That is the most useful thing we do and it is the least exciting. Bear that in mind '
        + 'before you go asking for the interesting work."',
      options: [{ label: 'Understood.', next: 'bye', conditions: [], actions: [], enabled: true }],
    };
    (t.root.options ||= []).splice(1, 0, {
      label: 'Why is this room called the Vice?', next: 'why_vice',
      conditions: [], actions: [], enabled: true,
    });
    if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
    log.push('Halloran        explains both names, and what the Drift is for');
  }
}

// ── references in prose ─────────────────────────────────────────────────────
const SWAPS = [['the Bench', 'the Vice'], ['The Bench', 'The Vice'],
               ['the Spine', 'the Drift'], ['The Spine', 'The Drift']];
let touched = 0;
for (const dir of ['quests', 'npcs', 'zones']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (!/^(quest_lw_|npc_lw_|zone_lw_)/.test(f)) continue;
    const p = path.join(ROOT, dir, f);
    let s = fs.readFileSync(p, 'utf8');
    const before = s;
    for (const [a, b] of SWAPS) s = s.split(a).join(b);
    if (s === before) continue;
    touched++;
    if (WRITE) fs.writeFileSync(p, s, 'utf8');
    log.push('  ref  ' + f);
  }
}

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n  ' + touched + ' file(s) with references updated');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
