/**
 * The Watch's scrub room becomes The Lockers. 2026-08-25.
 *
 * Renaming their approach channel to the Outfall left one collision: their scrub
 * room was still called The Wash, which is also the name of the laundrette on
 * Ironside Street. Both are rooms where you get clean, so nothing in the name
 * itself tells a player which one somebody means.
 *
 * The Lockers is free across all 859 zone names, and it is what the room is FOR.
 * Washing is the least of what happens in there: you put anything with a cell in
 * it into a lead-lined locker with your name chalked on the door, and then
 * somebody checks you for chrome with calipers. Naming it after the lockers puts
 * the surveillance discipline in the name instead of the plumbing, which is more
 * useful to a player and more like what a resistance would call it.
 *
 * Pike's explanation changes with it. He was answering "why is the scrub room
 * called that too", a question that no longer exists; he now says what the room
 * does, which is what the player needed in the first place.
 *
 * Run: node scripts/content/lw-lockers-rename.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

// ── the room ────────────────────────────────────────────────────────────────
{
  const p = path.join(ROOT, 'zones/zone_lw_wash.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.name = 'The Lockers';
  d.description =
    'A tiled room with a run of lead-lined lockers along one wall, each with a name chalked on '
    + 'the door, and a drain in the middle of the floor. Anything that can be listened to goes in '
    + 'a locker before you go any further in: tablet, chip, anything with a cell in it. There is a '
    + 'hose fed from somewhere upstream and a mirror bolted at eye height, and beside the mirror a '
    + 'set of calipers and a probe, because the Watch check for chrome and they do not take your '
    + 'word for it.';
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  log.push('zone_lw_wash   name + description -> The Lockers');
}

// ── the Blind's mirror looks at it ──────────────────────────────────────────
{
  const p = path.join(ROOT, 'zones/zone_lw_blind.json');
  let s = fs.readFileSync(p, 'utf8');
  const from = 'shows you the whole wash room behind you';
  const to = 'shows you the whole of the lockers behind you';
  if (s.includes(from)) {
    if (WRITE) fs.writeFileSync(p, s.split(from).join(to), 'utf8');
    log.push('zone_lw_blind  mirror now looks at the lockers');
  } else log.push('zone_lw_blind  MISS');
}

// ── Pike explains the room rather than the shared name ──────────────────────
{
  const p = path.join(ROOT, 'npcs/npc_lw_pike.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.dialogue_tree;
  if (t.what_wash_room) {
    t.what_wash_room.text =
      '"That is the lockers. Everything that can be listened to goes in one before you come any '
      + 'further in. Tablet, chip, anything with a cell in it. There is a locker with your name on '
      + 'it now, and it is lead-lined, and that is not decoration."\n\n'
      + '"Then somebody checks you for chrome. With calipers, not by asking."\n\n'
      + '"Nobody enjoys it. Nobody skips it either."';
    log.push('Pike           what_wash_room -> explains the lockers');
  }
  for (const o of t.what_wash?.options || []) {
    if (o.next === 'what_wash_room') o.label = 'What is the room at the bottom of it?';
  }
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
}

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
