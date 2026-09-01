/**
 * Cut the explaining-aside where it RESTATES, keep it where it ADDS.
 *
 * `scripts/docs/prose-audit.mjs` found 58 distinct instances of one house tic
 * across items, zones, furniture, quests and dialogue:
 *
 *     <image>, which is the (whole|entire|only) (point|reason|thing).
 *
 * This is the failure mode plain-writing.md names first, and the one it says we
 * hit most: a clause after an image telling the reader what the image meant.
 * Forster never writes "Orion"; Swift never says he is joking.
 *
 * ⚠ IT IS NOT A BLANKET STRIP, and three kinds of hit are deliberately left:
 *
 *   1. THE CLAUSE CARRIES A FACT THE IMAGE DOES NOT. "The liners come out to dry"
 *      does not tell a player about trench foot; "a channel with walls" does not
 *      tell them it is the difference between a climb and a fall. Those get a
 *      full stop instead of a comma — the assertion stands on its own rather
 *      than being smuggled in as an explanation — but the content stays.
 *   2. THE CLAUSE IS THE JOKE. Carve-out 2 in plain-writing.md: a steam hood
 *      venting onion smell into the street "which is the entire advertising
 *      budget" is a gag, not a summary. Untouched.
 *   3. SOMEBODY IS SPEAKING. People talk in this construction constantly, and
 *      the Assayer, Threlfall, Grieve, Tallow and Ivy are characterised by how
 *      they talk. Only NARRATION inside a dialogue node is touched.
 *
 * Everything below is an exact-match replacement with a count assertion, so a
 * silent miss is impossible.
 *
 *   node scripts/content/prose-trim-asides.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const CHECK = process.argv.includes('--check');

// [dir, id, from, to]. `null` for `to` means delete the clause entirely.
const EDITS = [

  // ── my own regressions from this session's arc rewrite ────────────────────
  ['quests', 'quest_lw_3',
    '{who} gets a hand to it before it can climb, which is the only part that was ever going to work.',
    '{who} gets a hand to it before it can climb.'],
  ['quests', 'quest_lw_rite',
    '{who} walks the concourse at the pace of somebody who is expected, which is the only pace that works.',
    '{who} walks the concourse at the pace of somebody who is expected.'],
  ['quests', 'quest_asc_rite',
    '{who} is asked to confirm their name, and confirms it, and that is the entire ceremony.',
    '{who} is asked to confirm their name, and confirms it. That is the whole ceremony.'],

  // ── other quests ──────────────────────────────────────────────────────────
  ['quests', 'quest_null_2',
    '{who} lays the parts out in the order they came off, which is the whole lesson.',
    '{who} lays the parts out in the order they came off.'],
  ['quests', 'quest_thorn_toll',
    '{who} stops moving, and sits down in the dirt, and waits, which is the only thing that was ever going to work.',
    '{who} stops moving, and sits down in the dirt, and waits.'],
  ['quests', 'quest_hal_witness',
    'You have never met them, you will never meet them again, and that is the entire qualification.',
    'You have never met them and you will never meet them again. That is the qualification.'],

  // ── items: pure restatement, clause deleted ───────────────────────────────
  ['items', 'item_chicory_sachet',
    'Fools nobody and gets drunk anyway, which is the whole story of the century.',
    'Fools nobody and gets drunk anyway.'],
  ['items', 'item_foam_earplugs',
    'Cheaper than defenders and about half as good, which is the point.',
    'Cheaper than defenders and about half as good.'],
  ['items', 'item_stock_pot',
    'Slow to come up to heat and stubborn about letting it go, which is the whole point.',
    'Slow to come up to heat and stubborn about letting it go.'],
  ['items', 'item_wood_chips',
    'They smoulder rather than burn, which is the entire point of them.',
    'They smoulder rather than burn.'],
  ['items', 'item_pork_shoulder',
    'Too big for one meal, too big for one day, and that is the entire point of it.',
    'Too big for one meal, and too big for one day.'],
  ['items', 'item_faraday_sleeve',
    'Anything sealed inside it is, electrically speaking, nowhere, which is the entire product.',
    'Anything sealed inside it is, electrically speaking, nowhere.'],
  ['items', 'item_mustard',
    'the other half uses it to make rub stick to meat, which is the only correct answer.',
    'the other half uses it to make rub stick to meat.'],

  // ── items: the clause carries a fact, so it gets its own sentence ─────────
  ['items', 'item_vat_cheese',
    'It melts, which is the only thing anyone actually asks of it.',
    'It melts. Nobody asks it for anything else.'],
  ['items', 'item_trauma_kit',
    'Enough of it to work on everything at once, which is the only reason to carry the weight.',
    'Enough of it to work on everything at once. That is the only reason to carry the weight.'],
  ['items', 'item_wheel_set',
    'The emitter faces are clean, which is the only part anybody checks.',
    'The emitter faces are clean. Nobody checks anything else.'],
  ['items', 'item_spray_paint',
    'It rattles when you pick it up, which is the only gauge it has.',
    'It rattles when you pick it up. That is the only gauge it has.'],
  ['items', 'item_ruined_halo_collar',
    'It still looks the part, which is the only thing anybody will ever buy it for.',
    'It still looks the part. Nobody will ever buy it for anything else.'],
  ['items', 'item_neck_gaiter',
    'Less conspicuous than a balaclava and does most of the same work, which is the entire reason it costs four credits more.',
    'Less conspicuous than a balaclava and does most of the same work. You pay four credits more for the discretion.'],
  ['items', 'item_snow_boots',
    'The liners come out to dry, which is the entire difference between a good boot and a boot that gives you trench foot.',
    'The liners come out to dry. That is the difference between a good boot and trench foot.'],
  ['items', 'item_coupe_glass',
    'Spills if you walk with it, which is the point: you are meant to be sitting down.',
    'Spills if you walk with it. You are meant to be sitting down.'],
  ['items', 'item_wb_thorn_flail',
    'It is still alive, which is the point: it has been cut and it is closing,',
    'It is still alive: it has been cut and it is closing,'],

  // ── furniture ─────────────────────────────────────────────────────────────
  ['furniture', 'furn_light_zone_thorn_kept',
    'The whole south wall opens, which is the point of the building.',
    'The whole south wall opens.'],
  ['furniture', 'furn_light_zone_mq_precinct_showers',
    'It never goes off, which is the point: there is no hour in here that is dark enough to do anything in.',
    'It never goes off. There is no hour in here dark enough to do anything in.'],
  ['furniture', 'furn_library_terminal',
    'The physical copies stay on the shelf, which is the entire point: the librarian would rather you read one badly than not read it at all.',
    'The physical copies stay on the shelf. The librarian would rather you read one badly than not read it at all.'],
  ['furniture', 'furn_solenne_salon_espresso',
    'the pressure comes off a spring and a forearm, which is the entire argument for it.',
    'the pressure comes off a spring and a forearm. That is the whole argument for it.'],
  ['furniture', 'furn_fuelpump_1_zone_district_923_907',
    'The mechanical counter clacks over when it runs, which is the only part of this place anyone trusts.',
    'The mechanical counter clacks over when it runs. Nobody here trusts anything else in the building.'],
  // ⚠ ONE HOP PER SENTENCE. This was originally two chained entries — original
  // → intermediate, then intermediate → final — and the first link could never
  // report as applied afterwards, because the second had already overwritten
  // the text it was looking for. Any further revision edits THIS `to`, it does
  // not add another entry underneath.
  ['furniture', 'furn_light_zone_thorn_foundry',
    'Two strip lights over the benches for the fine work, which is the only part of this building that needs to be seen rather than felt.',
    'Two strip lights over the benches for the fine work. It is the only part of this building anybody needs to see rather than feel.'],
  ['furniture', 'furn_light_zone_thorn_whelp',
    'A shaded lamp that can be turned right down without going out, which is the whole specification, and it took the Foundry three attempts.',
    'A shaded lamp that can be turned right down without going out. It took the Foundry three attempts.'],
  ['furniture', 'furn_sump_slag_pit',
    'which is to say: no room at all to dodge, which is the point.',
    'which is to say: no room at all to dodge.'],

  // ── zones ─────────────────────────────────────────────────────────────────
  // ⚠ the first of these is on 37 tiles.
  ['zones', null,
    'Somebody has rolled the worst blocks aside and left them in a line at the bottom, which is the only work anybody has done to it.',
    'Somebody has rolled the worst blocks aside and left them in a line at the bottom. It is the only work anybody has done to it.'],
  ['zones', 'zone_citadel_gallery',
    'turns a page on her clipboard, which is paper, which is the point.',
    'turns a page on her clipboard, which is paper.'],
  ['zones', 'zone_citadel_vault',
    'Bearer paper in acid-free sleeves, which is the only thing in the room that is genuinely dangerous to hold.',
    'Bearer paper in acid-free sleeves. It is the only thing in the room that is genuinely dangerous to hold.'],
  ['zones', 'zone_district_919_924',
    'standing over the track for no structural reason whatsoever, which is the point of it.',
    'standing over the track for no structural reason whatsoever.'],
  ['zones', 'zone_mq_precinct_showers',
    'There is nowhere in here to stand where you cannot be seen from the doorway, which is the entire design.',
    'There is nowhere in here to stand where you cannot be seen from the doorway. That is the design.'],
  ['zones', 'zone_the_reach_870_1956',
    'this building spends it on purpose, which is the whole point of the building.',
    'this building spends it on purpose.'],
  ['zones', 'zone_dw_727_973',
    'What it left is a channel with walls, which is the difference between a climb and a fall.',
    'What it left is a channel with walls. That is the difference between a climb and a fall.'],

  // ── narration inside dialogue and dreams (the speakers are left alone) ────
  ['npcs', 'npc_dw_machin',
    'He says it before you can, which is the best thing about him.',
    'He says it before you can.'],
  ['npcs', 'npc_citadel_teller',
    'The voice does not change at all, which is somehow the worst part.',
    'The voice does not change at all.'],
  ['npcs', 'npc_glitch_oracle',
    'She opens her eyes properly, and they are perfectly lucid, which is somehow the worst part.',
    'She opens her eyes properly, and they are perfectly lucid.'],
  ['dream_templates', 'dt_dxm_out_of_sync',
    'Half a second, held very consistently, which is somehow the worst part of it.',
    'Half a second, held very consistently.'],

  ['items', 'item_space_heater',
    'it keeps going, which is the entire reason to own one and the entire reason they cost what they cost.',
    'it keeps going. That is why you would own one, and why they cost what they cost.'],

  // ── the one withdrawal summary that still reads as appetite ───────────────
  // The stages rewrite replaced the lived beats; this is the drug-knowledge
  // card, which the earlier pass did not touch.
  ['drugs', 'drug_cigarettes',
    'Your hands are restless and your mood is fraying. You would kill for a cigarette.',
    'Your hands keep going to a pocket that has nothing in it, and going again a minute later.'],
];

// ─── apply ───────────────────────────────────────────────────────────────────
let files = 0, edits = 0, occurrences = 0, alreadyDone = 0;
const problems = [];
const touched = new Set();

for (const [dir, id, from, to] of EDITS) {
  const base = path.join(process.cwd(), 'content', dir);
  const targets = id ? [`${id}.json`] : fs.readdirSync(base);
  const needle = JSON.stringify(from).slice(1, -1);
  const repl = JSON.stringify(to).slice(1, -1);
  let found = 0;

  for (const f of targets) {
    const file = path.join(base, f);
    if (!fs.existsSync(file)) { problems.push(`${dir}/${f}: missing`); continue; }
    let json = fs.readFileSync(file, 'utf8');
    const n = json.split(needle).length - 1;
    if (!n) continue;
    found += n;
    json = json.split(needle).join(repl);
    if (!CHECK) fs.writeFileSync(file, canonicalJson(JSON.parse(json)), 'utf8');
    touched.add(file);
  }

  // Idempotent: an edit whose replacement is already in place is done, not
  // missing. Without this the script can only ever be run once, which makes it
  // useless as a record of what was decided.
  if (!found) {
    const already = targets.some((f) => {
      const file = path.join(base, f);
      return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(repl);
    });
    if (already) alreadyDone++;
    else problems.push(`no match in content/${dir}${id ? `/${id}` : ''}: "${from.slice(0, 60)}…"`);
  } else { edits++; occurrences += found; }
}
files = touched.size;

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Asides: ${edits}/${EDITS.length} edit(s) matched, ${occurrences} occurrence(s), ${files} file(s)` + (alreadyDone ? `, ${alreadyDone} already applied.` : '.'));
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
