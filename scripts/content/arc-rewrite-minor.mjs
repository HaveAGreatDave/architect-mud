/**
 * The other four faction ladders: the Null, the Exodus, the Wildblood and
 * Terminus. Twelve quests, brought up to the standard the Long Watch and
 * Ascendant ladders were rewritten to.
 *
 * ⚠ THIS IS NOT A RESCUE, and the pass is deliberately narrow because of that.
 * The prose here is already good — "he is fifty-one and he will not stop", "she
 * would only say something she would be embarrassed about later", "{who} comes
 * up the trophy road at a walking pace with something enormous following four
 * feet behind them". Rewriting lines that work in order to look busy is the
 * failure this document spent all day arguing against. Three things were
 * actually wrong.
 *
 * 1. TWO NPCs ARE MISGENDERED IN PLAYER-FACING TEXT.
 *    `npc_thorn_bracken` (Bracken Hale) is **male**; `quest_wild_proving` calls
 *    him "her" twice. `npc_thorn_ossa` (Ossa Vurn) is **male**; `quest_wild_seen`
 *    calls him "she". `quest_thorn_toll` already has Bracken right, which is how
 *    the contradiction was visible at all.
 *
 * 2. ONE OBJECTIVE PROMISES A PERSON WHO IS SOMEWHERE ELSE.
 *    `quest_wild_proving` o0 says "Collect the hounds from Bracken Hale" and
 *    sends you to `zone_scw_1048_974` — "The Runs", the wire enclosure where the
 *    hounds are. Bracken is next door in `zone_thorn_hounds`, "The Houndyard".
 *    Same Chekhov failure as the bolded directions: the text names something the
 *    room does not contain. Reworded to the hounds, who are there.
 *
 * 3. EVERY OBJECTIVE CARRIES EXACTLY ONE EMOTE. The rewritten ladders carry
 *    three to five, and the emote is where the close psychic distance lives (see
 *    the per-surface table in plain-writing.md) — it is the only surface that
 *    fires once, in a sequence we chose, and can afford your hands and your four
 *    seconds of deciding. Two more per objective, in each order's own voice.
 *
 * OBJECTIVES ARE OTHERWISE UNTOUCHED, and that is a judgement rather than an
 * oversight. All twelve quests are `visit`-only, and the fiction plainly wants
 * the turn-ins to be conversations — "go back and tell her she was right" is a
 * `talk`, not a walk. But **no quest in the game ends on a `talk` to its own
 * turn-in NPC**; the pattern appears zero times in 101 quests. Introducing it
 * across eight quests on a hunch, where the objective and the TURN_IN dialogue
 * action fire on the same interaction, is not something to do without running it.
 * Left as a proposal.
 *
 * VOICE. None of these four orders gets an em dash; that is the Ascendant and
 * Architect tell. ⚠ The Exodus lines must never claim a mechanism for how
 * Oracle-9 knows things (systems-psionics.md: below Seer no output line may say
 * how). She is right, it is never explained, and nobody in the scene explains it.
 *
 *   node scripts/content/arc-rewrite-minor.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const QUESTS = path.join(process.cwd(), 'content', 'quests');
const CHECK = process.argv.includes('--check');
const DASH = /[—–]/;

// Descriptions only where something is wrong. Everything else keeps its text.
const DESCRIPTIONS = {
  quest_wild_proving:
    "Bracken Hale walks the road out past the wall twice a week and checks what is on it, and the hounds go with him. He is short a pair of hands this week.\n\n" +
    "It is a long walk in bad ground and the dogs do most of the work.",
  // ⚠ Not a misgendering, but the same confusion one step further on: the
  // original read "One of Bracken Hale's hounds went out onto the flats four
  // days ago and did not come back, and she is heavy in whelp. He has been out
  // three nights looking." The "she" is the hound and the "he" is Bracken, and
  // that only parses if you already know Bracken is a man — which the sentence
  // does not tell you and which the OTHER Wildblood quest actively contradicted.
  // One subject per sentence fixes it without losing a word of the content.
  quest_thorn_toll:
    "A hound of Bracken Hale's went out onto the flats four days ago and has not come back. She is heavy in whelp.\n\n" +
    "Bracken has been out three nights looking for her. He is fifty-one and he will not stop.\n\n" +
    "Quarrel Nine asked you to go and find the dog, and was extremely clear that this is not a test and buys you nothing, and asked anyway.\n\n" +
    "She will not come to you. Find her, stay with her, and she will follow when she has decided about you.",
  quest_wild_seen:
    "The Chorus keeps the gate rota and the gate masks, and one of the masks has a lining that has been chafing Ossa Vurn for a month. He has mentioned it to everyone who has come through and nobody has ever picked it up.\n\n" +
    "Pick it up.",
};

// [quest, objective, desc|null to keep, [extra emotes]]
const OBJ = [
  // ═══ THE NULL · the dam. Hands, rota, nothing owned that cannot be opened ══
  ['quest_null_1', 'o_gauge', null, [
    '{who} finds the drum stiff for the first half turn and easier after, the way it is described on the card.',
    '{who} copies the figure onto the chart in the box provided, and not in the margin.',
  ]],
  ['quest_null_1', 'o_back', null, [
    '{who} gets back inside the hour, which nobody comments on and everybody notices.',
  ]],
  ['quest_null_2', 'o_school', null, [
    '{who} is handed a tray with a thing on it and no name for the thing.',
    '{who} finds the first three parts obvious and the fourth one seated in a way that means somebody has been here before.',
  ]],
  ['quest_null_2', 'o_bench', null, [
    '{who} watches Machin turn it over twice without saying anything.',
  ]],
  ['quest_null_3', 'o_breach', null, [
    '{who} finds a cut in the hillside, a stub of conduit, and the weather getting into both.',
    '{who} works out how much cable came through here once, and stops working it out.',
  ]],
  ['quest_null_3', 'o_tally', null, [
    '{who} comes in to find Threlfall away from the board and facing the door.',
  ]],

  // ═══ THE EXODUS · the Under. She is right and nobody says how ══════════════
  ['quest_exo_1', 'o_relay', null, [
    '{who} finds the water exactly where it was said to be, at the height it was said to be at.',
    '{who} checks the run of the wall twice, because once is not enough to settle it.',
  ]],
  ['quest_exo_1', 'o_back', null, [
    '{who} says it out loud and gets a nod rather than an explanation.',
  ]],
  ['quest_exo_2', 'o_sit', null, [
    '{who} listens for the hum that is in every other wall down here, and it is not in this one.',
    '{who} lasts longer than they meant to, and could not say by how much.',
  ]],
  ['quest_exo_2', 'o_report', null, [
    '{who} is not asked what it was like, which is the first surprising thing all night.',
  ]],
  ['quest_exo_3', 'o_again', null, [
    '{who} takes the same spot on the floor as last time without looking for it.',
    '{who} notices the room is the same and that they are not, and puts that down to the walk.',
  ]],
  ['quest_exo_3', 'o_return', null, [
    '{who} arrives to find Oracle-9 has already put the kettle on for two.',
  ]],

  // ═══ THE WILDBLOOD · terror on the road, domestic inside ═══════════════════
  ['quest_wild_seen', 'o0',
    'Restitch the lining of the gate mask at the north gate.', [
    '{who} borrows a needle from a box of needles kept for exactly this.',
    '{who} finds the old stitching has been picked out and redone twice already by somebody in a hurry.',
  ]],
  ['quest_wild_proving', 'o0',
    'Take the hounds off the wire at the Runs.', [
    '{who} gets the wire gate open one-handed while a dozen animals decide whether to be interested.',
    '{who} counts four leads out and puts the rest back on the peg.',
  ]],
  ['quest_wild_proving', 'o1', null, [
    '{who} keeps the wall on one side for as long as there is wall, and then there is not.',
    '{who} lets the dogs get out in front, because they know the ground and the ground is the difficulty.',
  ]],
  ['quest_wild_quickening', 'o0', null, [
    '{who} is told once more what it will cost, in the same voice, with nothing taken out of it.',
    '{who} finds the water is warmer than the air and stops being able to tell where the edge of it is.',
  ]],
  ['quest_thorn_toll', 'o_flats', null, [
    '{who} works the low ground in lines rather than circles, which takes longer and finds things.',
    '{who} finds a print, and then the same print going the other way, and follows the second one.',
  ]],
  ['quest_thorn_toll', 'o_found', null, [
    '{who} finds her wedged under an overhang with her back to the open and her eyes on it.',
    '{who} does not reach out, and does not talk, and lets a very large animal make up its own mind.',
  ]],
  ['quest_thorn_toll', 'o_home', null, [
    '{who} matches her pace all the way in, which is slower than a walk and not negotiable.',
  ]],

  // ═══ TERMINUS · a walled town, and everything is a formality ═══════════════
  ['quest_terminus_1', 'o_gate', null, [
    '{who} walks the box up a road with nobody on it and a wall at the end of it.',
    '{who} does not open the box, and is aware for the whole walk of not opening it.',
  ]],
  ['quest_terminus_1', 'o_back', null, [
    '{who} hands the empty over and watches a man look at it for longer than an empty box needs.',
  ]],
  ['quest_terminus_2', 'o_north', null, [
    '{who} counts the courses of block up as far as the light goes and loses count twice.',
  ]],
  ['quest_terminus_2', 'o_east', null, [
    '{who} finds a stretch back here that has been repaired with something that is not block.',
  ]],
  ['quest_terminus_2', 'o_south', null, [
    '{who} passes a gate on this side that is bricked up to the lintel and was not always.',
  ]],
  ['quest_terminus_2', 'o_back', null, [
    '{who} is not asked what they saw, and Tace does not look up from the stool.',
  ]],
];

// ─── apply ───────────────────────────────────────────────────────────────────
const skeleton = (q) => JSON.stringify({
  ...q, description: null,
  objectives: (q.objectives || []).map((o) => ({ ...o, desc: null, emotes: null })),
});

const files = new Map();
const load = (id) => {
  if (!files.has(id)) {
    const p = path.join(QUESTS, `${id}.json`);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    files.set(id, { p, data, before: skeleton(data) });
  }
  return files.get(id);
};

let descs = 0, objs = 0, added = 0;
const problems = [];

for (const [id, text] of Object.entries(DESCRIPTIONS)) {
  const f = load(id);
  if (!f) { problems.push(`${id}: missing`); continue; }
  if (DASH.test(text)) problems.push(`${id}: em dash, and this order does not get one`);
  f.data.description = text; descs++;
}

for (const [id, oid, desc, extra] of OBJ) {
  const f = load(id);
  if (!f) { problems.push(`${id}: missing`); continue; }
  const o = (f.data.objectives || []).find((x) => x.id === oid);
  if (!o) { problems.push(`${id}: no objective "${oid}"`); continue; }
  if (desc !== null) {
    if (DASH.test(desc)) problems.push(`${id}/${oid}: em dash`);
    o.desc = desc; objs++;
  }
  const have = o.emotes || [];
  for (const e of extra) {
    if (DASH.test(e)) problems.push(`${id}/${oid}: em dash in emote`);
    if (!e.includes('{who}')) problems.push(`${id}/${oid}: emote without {who}`);
    if (!have.includes(e)) { have.push(e); added++; }
  }
  o.emotes = have;
}

for (const { p, data, before } of files.values()) {
  if (skeleton(data) !== before) { problems.push(`${path.basename(p)}: STRUCTURE CHANGED, refusing`); continue; }
  if (!CHECK) fs.writeFileSync(p, canonicalJson(data), 'utf8');
}

// Nothing may misgender these two again.
const SEX = { 'Bracken Hale': 'male', 'Ossa Vurn': 'male' };
for (const [id] of files) {
  const raw = JSON.stringify(files.get(id).data);
  for (const [name, sex] of Object.entries(SEX)) {
    if (!raw.includes(name)) continue;
    const wrong = sex === 'male' ? /\b(She|she|her|Her)\b/ : /\b(He|he|him|His|his)\b/;
    // Only inspect the sentence the name appears in.
    for (const sent of (files.get(id).data.description || '').split(/(?<=[.!?])\s+/)) {
      if (sent.includes(name) && wrong.test(sent)) problems.push(`${id}: "${name}" is ${sex} but the sentence naming him uses the other pronoun`);
    }
  }
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Minor ladders: ${files.size} quest(s), ${descs} description(s), ${objs} objective line(s), ${added} emote(s) added.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
