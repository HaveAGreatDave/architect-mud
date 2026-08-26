/**
 * East is theirs, and east is where she sends people. 2026-08-26.
 *
 * Two corrections to the last pass, and the second one lands on material that
 * has been sitting in this tree for weeks doing something else.
 *
 * ── 1. THE CAMP STILL EXISTS ─────────────────────────────────────────────────
 *
 * I deleted it when the lore said the Wildblood were in the Under first. That
 * was an over-correction: both are true. There are camps out in the wastes AND
 * an old presence underground, and she has seen one of each — which is better
 * than either alone, because the two sightings are different in kind. The camp
 * she watched from a mile off in daylight for a day and a half. The pit she
 * watched from thirty feet in the dark and could not leave.
 *
 * ⚠ AND THE DAY AND A HALF COMES BACK. It was widened to sixteen days only
 * because the man's whole fortnight had to fit inside the camp visit. It does
 * not any more — that transformation happens in the pit in the Under now — so
 * the constraint is gone and the better number returns. Worth knowing before
 * somebody "fixes" it back.
 *
 * ── 2. THE FAR EAST IS THEIRS, AND SHE ALREADY SENDS FAMILIES THERE ──────────
 *
 * The lore puts the heaviest Wildblood presence on the far eastern edge of the
 * Under — out past the Curtain wall, underground, all the way to the bay.
 *
 * `the_quiet_ones_after` has described exactly that tunnel since the day it was
 * written: past the stretch, past the Blind, under the Curtain because the
 * Curtain is a surface problem and nobody ever built it downward, four miles,
 * then the bay. And `the_quiet_ones` has her moving families EAST, because east
 * is the only direction that is not the city and not the wall.
 *
 * So the two halves were already touching and nothing had ever put them
 * together. East is theirs. East is where she walks people to and points.
 *
 * ⚠ SHE MUST NOT LEARN THIS FROM THE PLAYER. She has known the whole time. What
 * the player does is ask, and `the_quiet_ones_bay` already says nobody ever has
 * — "eleven years and nobody has ever asked me where east goes. Not once, and I
 * have walked a lot of people through here."
 *
 * ⚠ AND IT IS NEVER RESOLVED. The invariant on this whole tree is that nothing
 * is ever confirmed: no document, no quest, no second NPC closes it. So she does
 * not know whether the families are taken in, killed or ignored, she says so
 * without hedging, and the thought she has had at four in the morning — that
 * they are walking toward the only people in this city who would not mind what
 * they look like — is offered once and never followed up. There is no node where
 * anybody finds out.
 *
 * Run: node scripts/content/lw-east-is-theirs.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });
const addOpt = (node, o, at) => {
  const list = (node.options ||= []);
  if (list.some(x => x.next === o.next)) return;
  list.splice(at ?? Math.max(0, list.length - 1), 0, o);
};

const p = path.join(ROOT, 'npcs/npc_lw_teague.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;
const log = [];

// ── 1. THE CAMP, RESTORED ───────────────────────────────────────────────────
t.where_from_camp = {
  _vine: { x: 880, y: 2100 }, actions: [],
  text:
    '"Once. Years ago, and not down here — out in the wastes."\n\n'
    + '"Three of us went to see what we were dealing with. We got within a mile of a camp of theirs '
    + 'and sat up on a rise and watched it for a day and a half."\n\n'
    + '"I had gone out there expecting something organised. Somebody in charge, a rule, an order to '
    + 'it. There was none of that. Fires going with nobody at them. People asleep on open ground in '
    + 'the middle of the afternoon. Somebody played the same instrument for about nine hours and '
    + 'nobody stopped him."',
  options: [
    opt('That is just a camp.', 'where_from_camp_fair'),
    opt('So why walk all the way north?', 'where_from_north'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_camp_fair = {
  _vine: { x: 1140, y: 2180 }, actions: [],
  text:
    '"It is."\n\n'
    + 'She does not take it back.\n\n'
    + '"That is the part I keep going over. It looked like a fair. Somebody was cooking and it '
    + 'smelled like food. Two children were running about in it and they were fine, and nobody was '
    + 'watching them either."\n\n'
    + '"I sat on that rise a day and a half waiting for the thing that made sense of it. What I got '
    + 'was people enjoying themselves."',
  options: [
    opt('So why walk all the way north?', 'where_from_north'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_north = {
  _vine: { x: 1400, y: 2180 }, actions: [],
  text:
    '"Some of them do not have to. That is the thing I did not understand for years."\n\n'
    + '"You can get from that camp to this city without ever coming up. Out of the wastes, into the '
    + 'system, under the wall, and along. Nobody has ever watched that road because nobody has ever '
    + 'thought of it as one."\n\n'
    + '"The ones who do walk it on the surface are usually walking away from something. It goes '
    + 'wrong more often than they will tell you, and a man who has come through it and found out he '
    + 'cannot feed himself is a man with nowhere."',
  options: [
    opt('Under the wall?', 'where_from_east'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── 2. EAST ─────────────────────────────────────────────────────────────────
t.where_from_east = {
  _vine: { x: 620, y: 2300 }, actions: [],
  text:
    '"East is theirs. All of it past a certain point, and the point moves."\n\n'
    + '"My stretch is mine. The Blind is ours. After that there is about a mile that is nobody\'s '
    + 'and I do not walk it. Then it is theirs, and it stays theirs the whole way under the Curtain '
    + 'and out to the bay."\n\n'
    + '"The wall stops at the ground. Nobody ever built it downward. So there has been a road from '
    + 'the wastes into this city the entire time and it has never once been watched."',
  options: [
    opt('You move people east.', 'where_from_east_move'),
    opt('Does the Watch know that?', 'where_from_east_watch'),
    opt('(say nothing)', 'bye'),
  ],
};

t.where_from_east_watch = {
  _vine: { x: 880, y: 2380 }, actions: [],
  text:
    '"Rennick knows. Halloran knows. It is on the map in the room, in pencil, and the pencil has '
    + 'not moved in six years."\n\n'
    + '"Five of us walk this system. You cannot hold a mile of tunnel with five people and you '
    + 'certainly cannot hold four."\n\n'
    + '"So it is on the map, and it is not a plan, and everybody has agreed not to say the second '
    + 'part."',
  options: [
    opt('You move people east.', 'where_from_east_move'),
    opt('(say nothing)', 'bye'),
  ],
};

// ⚠ The one she does not have an answer for. She has known the whole time.
t.where_from_east_move = {
  _vine: { x: 1140, y: 2380 }, actions: [],
  text:
    'She does not answer straight away, and it is not the pause of somebody working something '
    + 'out.\n\n'
    + '"I know what you are asking."\n\n'
    + '"Yes. East is where we move them. It is the only direction that is not the city and not the '
    + 'wall, and I have walked families as far as the edge of that mile and pointed."\n\n'
    + '"I have never gone past it with them."',
  options: [
    opt('So they get taken in.', 'where_from_east_taken'),
    opt('You are handing them to the Wildblood.', 'where_from_east_handing'),
    opt('(say nothing)', 'stance_quiet'),
  ],
};

t.where_from_east_taken = {
  _vine: { x: 1400, y: 2300 }, actions: [],
  text:
    '"I do not know."\n\n'
    + '"That is not me being careful with you. Eleven years, and not one of them has ever come back '
    + 'to tell me either way."\n\n'
    + 'She checks the tunnel behind you.\n\n'
    + '"I will give you the thought I have had at four in the morning, because you have got this '
    + 'far. Some of those families are walking toward the only people in this city who would not '
    + 'mind what they look like."\n\n'
    + '"I have never done anything with that thought. I am not going to start tonight."',
  options: [opt('(say nothing)', 'bye')],
};

t.where_from_east_handing = {
  _vine: { x: 1400, y: 2460 }, actions: [],
  text:
    '"I am moving them out of my stretch. Where they go after that is not something I get a say '
    + 'in."\n\n'
    + 'A beat, and then she gives you the rest of it rather than let you have that one.\n\n'
    + '"And yes. I know what is down there and I point that way anyway, and I have known for six '
    + 'years."\n\n'
    + '"You are the first person who has ever said it to me. That is not a defence. It is just '
    + 'true."',
  options: [
    opt('So they get taken in.', 'where_from_east_taken'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── 3. THEY WERE PUT DOWN HERE ──────────────────────────────────────────────
// ⚠ THE CAUSAL SPINE, AND IT RUNS BACKWARDS FROM THE OBVIOUS ONE. The first draft
// had her say they were down here first, full stop, which reads as a people who
// simply live underground. They were PUSHED — no room on the Row, no work, Halcyon
// picking them up, and the Watch moving them on — and the town out south is what
// the ones with anything left did about it. What stayed in the tunnels is what
// could not make that walk. She knows all of this and says it without flinching,
// and nothing in the tree tells the player what to do with it.
t.where_from.text =
  '"They do not come from anywhere. They were put down here."\n\n'
  + 'She says it the way you would correct somebody about a street name.\n\n'
  + '"Everybody has it that the Under filled up after the city died. It filled up because the city '
  + 'stopped having anywhere for them, and those are not the same sentence."\n\n'
  + '"There are handprints on a wall off my stretch that were on it before anybody I have ever met '
  + 'was born. Somebody is still adding to them."';
t.where_from.options = [
  opt('Put down here by who?', 'where_from_by_who'),
  opt('Handprints?', 'where_from_prints'),
  opt('Are there not camps out south as well?', 'where_from_camp'),
  opt('You share a tunnel system with them.', 'where_from_share'),
  opt('(say nothing)', 'bye'),
];

t.where_from_by_who = {
  _vine: { x: 360, y: 1780 }, actions: [],
  text:
    '"Everybody. In order, if you want it."\n\n'
    + '"The Row would not rent to them. Then there was no work. Then Halcyon started picking them '
    + 'up off the street for their own good, and you can ask an Ascendant what that means because '
    + 'I have never got a straight answer."\n\n'
    + '"And then they were in the tunnels, and the tunnels are ours, and we moved them on."\n\n'
    + '"Nine families in eleven years. That is my own count, not the Watch\'s, and tonight is the '
    + 'second time I have said the number out loud."',
  options: [
    opt('And the town out south?', 'where_from_split'),
    opt('You are part of it, then.', 'where_from_east_move'),
    opt('(say nothing)', 'stance_quiet'),
  ],
};

t.where_from_split = {
  _vine: { x: 620, y: 1860 }, actions: [],
  text:
    '"That is what the ones with anything left did about it."\n\n'
    + '"They walked out into the redrock and built somewhere, and put a wall round it, and the '
    + 'whole point of the wall is that nobody can come and move them on from behind it."\n\n'
    + 'She adjusts the sling.\n\n'
    + '"What stayed down here is what could not make that walk. Or would not. It is the same people '
    + 'sorted by whether they got out, and the ones who did not get out are the ones who have gone '
    + 'furthest into it."',
  options: [
    opt('They say there is a town of them, south.', 'south'),
    opt('How far east does it go?', 'where_from_east'),
    opt('(say nothing)', 'bye'),
  ],
};

// ── 4. WIRE IT INTO WHAT WAS ALREADY THERE ──────────────────────────────────

addOpt(t.where_from_share, opt('How far east does it go?', 'where_from_east'), 3);
// The families branch already walks people east; it can now ask what east is.
addOpt(t.the_quiet_ones_after, opt('Who is out there?', 'where_from_east'), 2);
addOpt(t.the_quiet_ones_bay, opt('What is east, then?', 'where_from_east'), 1);
log.push('  wired      where_from, where_from_share, the_quiet_ones_after, the_quiet_ones_bay');

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

// ── checks ──────────────────────────────────────────────────────────────────
const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { log.push('DANGLING ' + k + ' -> ' + o.next); bad++; }
const linked = new Set(['root']);
for (const v of Object.values(t)) for (const o of v.options || []) if (o.next) linked.add(o.next);
for (const k of Object.keys(t)) if (!linked.has(k) && !k.startsWith('_')) { log.push('ORPHAN ' + k); bad++; }
// ⚠ Nothing may ever answer where the families end up.
const blob = JSON.stringify(t);
for (const w of ['they are taken in', 'they were killed', 'they eat them']) {
  if (blob.includes(w)) { log.push('RESOLVED THE UNRESOLVABLE: ' + w); bad++; }
}
log.push('  east reached from: ' + Object.entries(t)
  .filter(([, v]) => (v.options || []).some(o => o.next === 'where_from_east')).map(([k]) => k).join(', '));

console.log(log.join('\n'));
console.log('\n  nodes ' + Object.keys(t).length + ' · problems ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
