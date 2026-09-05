/**
 * Drugs as fluids — the content half.
 *
 * The engine change (plugins/fillable) gave a container a CARRIER (`fluid_type`)
 * and a CARGO (`drug_id`). This stamps the world so that the shape actually
 * occurs: the raw precursors become the jerrycans their own descriptions have
 * always claimed to be, the finished liquids become bottles you can pour and
 * decant, and the solids that go into solution get the `soluble` tag `dissolve`
 * is gated on.
 *
 * Three sets, and the split between them is the whole design:
 *
 *   RAW      — carrier `chem`, and deliberately NO drug_id. A drum of crude
 *              precursor is not a dose; it is feedstock that still has to be
 *              titrated. Giving it a drug_id would make the entire synthesis
 *              bench optional, because you could drink the input. `chem` is an
 *              existing topical fluid with a stain already registered, so a
 *              thrown drum ruins a coat with nothing new authored.
 *
 *   FLUID    — carrier `drug` plus the drug_id. These are the ones that were
 *              always liquid in prose and stackable in fact: a bottle of Slow,
 *              a pint of ether, the cough syrup. Bottled at strength.
 *
 *   SOLUBLE  — untouched physically, tagged `soluble` so a tab or a powder can
 *              be put INTO a fluid. This is the answer to "make some drugs
 *              soluble in water like blotter": blotter stays a square of paper,
 *              and the paper goes in the canteen.
 *
 * Idempotent: re-running stamps the same values. Run it, then `content:import`.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ITEMS = path.join(process.cwd(), 'content', 'items');
const DRUGS = path.join(process.cwd(), 'content', 'drugs');

// item_id -> drug id, read off the authored drugs rather than restated here. A
// second copy of this mapping is a second thing to keep in step, and the drugs
// table is already the one place that decides which item is which substance.
const DRUG_BY_ITEM = {};
for (const name of fs.readdirSync(DRUGS)) {
  const d = JSON.parse(fs.readFileSync(path.join(DRUGS, name), 'utf8'));
  if (d.item_id) DRUG_BY_ITEM[d.item_id] = d.id;
}

// A drum. Same capacity as the jerry can it has been describing itself as.
const RAW_CAPACITY = 40;

// A bottle. Small enough that carrying a dose around is a decision, big enough
// that DRUG_DOSE_UNITS (4) divides it into a handful of real swallows.
const BOTTLE_CAPACITY = 12;

// Finished drugs that are liquid. Beer, coffee and the spliced `item_compound`
// are deliberately absent: the first two are the drinks plugin's business and
// already have a vessel story, and a compound carries its whole effects blob on
// the inventory row, which a prefill would not survive.
const FLUID = [
  'item_amyls',            // poppers, in a glass vial
  'item_blacktar',         // viscous, cut and cooked down
  'item_coldfire',
  'item_deadair',
  'item_dxm',              // a bottle of cough syrup, already
  'item_ether',            // "a pint of raw ether"
  'item_drug_glasshollow',
  'item_memhack',
  'item_overclock',
  'item_redline',
  'item_screamers',
  'item_drug_slow',        // "a thick blue syrup"
  'item_static',
  'item_reagent_solvent',  // toluene, in a dented can
];

// Solids that go into solution. Blotter is the example the whole verb exists
// for; the rest are tabs, powders and gelcaps that dissolve the same way.
// Smokables (cigarettes, joints, loose leaf, salvia), gases (nitrous) and
// vapour (threshold) are absent on purpose — they are the explicit non-fluid
// half, and `dissolve` must refuse them.
const SOLUBLE = [
  'item_blotter',
  'item_laughers',
  'item_lull',
  'item_khole',
  'item_wraithdust',
  'item_ibogaine',
  'item_precursor_stim',
  'item_psilocybin',
  'item_grey',
  'item_drug_buzz',
  'item_mescaline',
  'item_opium',
];

function load(id) {
  const f = path.join(ITEMS, `${id}.json`);
  if (!fs.existsSync(f)) return null;
  return { f, j: JSON.parse(fs.readFileSync(f, 'utf8')) };
}

function save(f, j) { fs.writeFileSync(f, canonicalJson(j) + '\n'); }

let raws = 0, fluids = 0, solubles = 0, missing = [];

// -- RAW: every item tagged raw_drug that is described as a jerrycan ---------
for (const name of fs.readdirSync(ITEMS)) {
  if (!name.startsWith('item_raw_')) continue;
  const f = path.join(ITEMS, name);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const desc = j.description || '';
  // The bales and root barks are not drums. A re-run sees the rewritten wording,
  // so an already-stamped drum is recognised by its prefill rather than by prose
  // this same script just changed — otherwise the second run silently does
  // nothing and reports zero, which reads as a broken selector.
  const isDrum = /jerrycan/i.test(desc) || j.flags?.prefill?.fluid_type === 'chem';
  if (!isDrum) continue;

  j.tags = { ...(j.tags || {}), fillable: RAW_CAPACITY };
  j.flags = { ...(j.flags || {}), prefill: { fluid_amount: RAW_CAPACITY, fluid_type: 'chem' } };

  // The description claimed a container and a phase change it could not deliver.
  // It is a drum of crude feedstock; what comes out the far side of the bench is
  // the finished product, and this line has no business promising which.
  j.description = desc
    .replace(/^A jerrycan of/, 'A sealed steel drum of')
    .replace(/ into the finished liquid\./, ' into the finished product.');

  save(f, j);
  raws++;
}

// -- FLUID: bottled at strength ---------------------------------------------
for (const id of FLUID) {
  const hit = load(id);
  if (!hit) { missing.push(id); continue; }
  const { f, j } = hit;
  const drugId = DRUG_BY_ITEM[id];
  if (!drugId) { missing.push(`${id} (no drugs row points at it)`); continue; }
  j.tags = { ...(j.tags || {}), fillable: BOTTLE_CAPACITY, unique: true };
  j.flags = { ...(j.flags || {}), prefill: { fluid_amount: BOTTLE_CAPACITY, fluid_type: 'drug', drug_id: drugId } };

  // A CONTAINER CANNOT STACK. vendor.js merges a stackable purchase into the
  // existing row and only writes `prefill` down the non-stacking branch, so a
  // stackable bottle would arrive full the first time and EMPTY every time after
  // -- and two half-drunk bottles would collapse into one row holding whichever
  // custom_data happened to survive. Every fillable in the game is already
  // `unique` for exactly this reason; these have to join them.
  delete j.tags.stackable;
  save(f, j);
  fluids++;
}

// -- SOLUBLE: unchanged physically, openable to solution ---------------------
for (const id of SOLUBLE) {
  const hit = load(id);
  if (!hit) { missing.push(id); continue; }
  const { f, j } = hit;
  j.tags = { ...(j.tags || {}), soluble: true };
  save(f, j);
  solubles++;
}

console.log(`raw drums: ${raws}`);
console.log(`bottled fluids: ${fluids}`);
console.log(`soluble solids: ${solubles}`);
if (missing.length) console.log(`MISSING (no such item file): ${missing.join(', ')}`);
