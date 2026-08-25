/**
 * Point the drug dreams at the drug symptoms instead of at the weather.
 *
 * Until now the fx vocabulary was six kinds of weather, so every drug dream had
 * to borrow one: DMT got `snow`, the k-hole got `fog`, salvia got `rain`, and
 * nitrous got nothing at all. That is not a small mismatch — the fx canvas is
 * the ONLY visual layer a trip has on foot (flight-drugfx.js owns the cockpit,
 * and `#trip-overlay` is CSS colour), so "what a drug looks like" was literally
 * "which weather did the author pick".
 *
 * weather-fx.js now carries six symptoms. Each one replicates one thing its
 * drugs actually do to sight, under the same law the withdrawal prose is written
 * to: the specific event, never the mood.
 *
 *   static   the grain between channels        dead air, wraithdust, DXM
 *   tunnel   the field closing from the edges  opiates, the k-hole
 *   tracers  moving things drag their own past stimulants, LSD
 *   bloom    light swelling and subsiding      mescaline, psilocybin, DMT
 *   crawl    surfaces that will not sit still  mescaline, psilocybin, salvia
 *   swim     the room refusing to hold still   ether, toluene, nitrous
 *
 * ⚠ NOT EVERY DREAM CHANGES. A drug dream whose weather is doing real work keeps
 * it — the DXM "long stairs" template is a climb out of somewhere and its `ash`
 * is the grit of the place, not a symptom. Only templates whose fx was standing
 * in for pharmacology are repointed, and the mapping is per TEMPLATE rather than
 * per drug for that reason.
 *
 *   node scripts/content/dream-fx-symptoms.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const DIR = path.join(process.cwd(), 'content', 'dream_templates');
const CHECK = process.argv.includes('--check');

// Kept in step with DRUG_FX in client/game/js/panels/weather-fx.js.
const DRUG_FX = ['static', 'tunnel', 'tracers', 'bloom', 'crawl', 'swim'];

// template id -> [fx, intensity, why]
const MAP = {
  // ── DMT · the chamber is built, lit and busy ──────────────────────────────
  dt_dmt_the_chamber:    ['bloom', 0.9, 'every surface working at something, and lit'],
  dt_dmt_the_language:   ['bloom', 0.85, 'a clause completing and something enormous confirmed'],
  dt_dmt_the_ones_waiting: ['bloom', 0.9, 'going past far too fast, and bright'],
  dt_dmt_antechamber:    ['crawl', 0.6, 'the pattern reorganising before you are through it'],
  dt_dmt_workshop:       ['crawl', 0.7, 'structure being made while you watch'],
  dt_dmt_the_gate_back:  ['tracers', 0.6, 'the way out, at speed'],

  // ── the k-hole · distance, and the funnel ─────────────────────────────────
  dt_khole_funnel:       ['tunnel', 0.95, 'the funnel is the symptom, and it is named in the title'],
  dt_khole_shelf:        ['tunnel', 0.7, 'parked somewhere with the edges gone'],
  dt_khole_turned_down:  ['tunnel', 0.8, 'everything at a lower volume, including the edges'],
  dt_khole_back_of_the_room: ['tunnel', 0.75, 'you are at the back of it and the back keeps going'],
  dt_khole_dismantling:  ['static', 0.6, 'the body coming apart into parts that do not add up'],
  dt_khole_continents:   ['swim', 0.5, 'landmasses drifting with no floor under them'],

  // ── DXM · plateaus, and the long climb ────────────────────────────────────
  dt_dxm_the_plateau:    ['tunnel', 0.6, 'the plateau is a held distance'],
  dt_dxm_out_of_sync:    ['tracers', 0.75, 'half a second behind, held very consistently'],
  dt_dxm_shallow_end:    ['swim', 0.5, 'not deep yet, and already not level'],
  dt_dxm_the_corridor_of_slabs: ['static', 0.5, 'the grain of a corridor that is mostly repetition'],

  // ── dead air · the static between channels, which is the drug ─────────────
  dt_deadair_test_card:  ['static', 0.9, 'a test card is what is on when nothing is on'],
  dt_deadair_overnight:  ['static', 0.8, 'the overnight hiss'],
  dt_deadair_carrier:    ['static', 0.7, 'a carrier with nothing riding it'],
  dt_deadair_repeater:   ['static', 0.75, 'the same signal, again, weaker'],
  dt_deadair_patch_bay:  ['tracers', 0.5, 'signal routed and re-routed while you watch'],
  dt_deadair_studio:     ['bloom', 0.45, 'studio lights, and nobody under them'],

  // ── salvia · the plane slips ──────────────────────────────────────────────
  dt_salvia_the_seam:    ['crawl', 0.9, 'a seam is the surface failing to sit still'],
  dt_salvia_the_fence:   ['crawl', 0.85, 'four coats of paint and every one of them remembered'],
  dt_salvia_carousel:    ['swim', 0.8, 'turning, and not on an axis you can point at'],
  dt_salvia_the_page:    ['crawl', 0.7, 'a surface being read and rewriting itself'],
  dt_salvia_the_stack:   ['crawl', 0.75, 'stacked, and each layer moving separately'],
  dt_salvia_the_sum:     ['tunnel', 0.6, 'a number above and a number below, and you between them'],

  // ── nitrous · forty seconds of the room not holding still ─────────────────
  dt_nitrous_compression: ['swim', 0.9, 'the wah, rendered as the field moving'],
  dt_nitrous_the_loop:   ['swim', 0.85, 'the same second arriving repeatedly'],
  dt_nitrous_the_beat:   ['swim', 0.8, 'a beat you are inside rather than hearing'],
  dt_nitrous_announcement: ['bloom', 0.6, 'something enormous being announced, and lit'],
  dt_nitrous_everyone_knew: ['bloom', 0.55, 'the revelation, briefly, at full brightness'],
  dt_nitrous_the_room_afterwards: ['tunnel', 0.35, 'just a person in a room again, and smaller'],

  // ── ibogaine · the long night, and being shown your own life ──────────────
  dt_ibogaine_the_long_night: ['tunnel', 0.5, 'a night that narrows to the one thing'],
  dt_ibogaine_the_screening: ['tracers', 0.6, 'your own life running past at the wrong speed'],
  dt_ibogaine_the_accounting: ['static', 0.4, 'the ledger, and the grain on it'],
  dt_ibogaine_the_table:  ['bloom', 0.4, 'sat at a lit table with company'],
  dt_ibogaine_the_interval: ['tunnel', 0.45, 'the gap between one showing and the next'],
  dt_ibogaine_irregular_beat: ['swim', 0.55, 'the heart that may not agree to it'],

  // ── the threshold · the door, and what is through it ──────────────────────
  dt_threshold_doorway:   ['bloom', 0.6, 'a doorway with light on the other side'],
  dt_threshold_hall:      ['tunnel', 0.5, 'a hall that keeps its ends out of reach'],
  dt_threshold_cathedral: ['bloom', 0.8, 'scale, and light doing the work'],
  dt_threshold_landing:   ['crawl', 0.45, 'a landing that will not settle'],
  dt_threshold_posting_room: ['static', 0.45, 'sorted, filed, and grainy'],
  dt_threshold_residence: ['crawl', 0.5, 'a home you know and have never been in'],
};

// ─── apply ───────────────────────────────────────────────────────────────────
let changed = 0, already = 0, missing = 0;
const problems = [];

for (const [id, [fx, intensity, why]] of Object.entries(MAP)) {
  if (!DRUG_FX.includes(fx)) { problems.push(`${id}: "${fx}" is not a drug fx`); continue; }
  if (!(intensity > 0 && intensity <= 1)) { problems.push(`${id}: intensity ${intensity} out of range`); continue; }
  if (!why || why.length < 12) { problems.push(`${id}: every mapping needs a reason`); continue; }

  const file = path.join(DIR, `${id}.json`);
  if (!fs.existsSync(file)) { missing++; problems.push(`${id}: no such template`); continue; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (d.cause !== 'drug') { problems.push(`${id}: cause is "${d.cause}", not drug`); continue; }
  if (d.fx === fx && d.fx_intensity === intensity) { already++; continue; }
  d.fx = fx;
  d.fx_intensity = intensity;
  if (!CHECK) fs.writeFileSync(file, canonicalJson(d), 'utf8');
  changed++;
}

// What is still on weather, so the ones deliberately left are visible rather
// than merely un-listed.
const onWeather = [];
for (const f of fs.readdirSync(DIR)) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (d.cause !== 'drug') continue;
  if (!DRUG_FX.includes(d.fx)) onWeather.push(`${d.id} (${d.fx || 'null'})`);
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Dream fx: ${changed} repointed, ${already} already correct, ${missing} missing.`);
if (onWeather.length) {
  console.log(`\n  Drug dreams still on a weather effect (${onWeather.length}) — deliberate where the weather is doing real work:`);
  console.log('  ' + onWeather.join(', '));
}
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
