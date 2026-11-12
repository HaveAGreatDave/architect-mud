// CHEM MATTER: what a drug looks like on the bench and how it behaves in the glass.
//
// The Chem Stage (docs/proposals/chem-stage.md) draws a drug from three keys on its drug row:
// `flags.form` (what it is: a liquid, a powder, a crystal...), `flags.color` (#rrggbb, the
// product's own colour, not its trip's) and `flags.matter` (how that form behaves). `matterOf`
// merges `flags.matter` over the form's defaults, so a row only carries what differs. The synth
// plugin already reads `form` and `color` (plugins/synthesis/index.js `cookFamily`, `drugVisual`);
// this file adds the rest.
//
// ⚠ NO DRUG NAMES HERE. A new drug is a content row; nothing in this file or the renderer may
// name one.
//
// ⚠ NO WALL CLOCK AND NO DOM. Pure data and pure functions, imported by the server, the client and
// scripts/content/lint.mjs.

// Every form the splice bench and the cook families know (plugins/synthesis SPLICE_FORMS).
export const DRUG_FORMS = ['liquid', 'gel', 'paste', 'powder', 'pill', 'crystal', 'gas', 'leaf', 'blotter'];
export const GRAINS = ['fine', 'coarse', 'granular'];
export const HABITS = ['needle', 'plate', 'cube', 'shard'];

// The matter keys and what each is.
//   viscosity  0..1  how a liquid pours: 0 is water, 1 barely moves (liquid, gel, paste)
//   grain      how a powder piles and pours (powder, pill)
//   habit      the shape a crystal grows in (crystal)
//   clarity    0..1  how clear a good batch is; a bad batch is cloudier than this (crystal, liquid)
//   fume       #rrggbb  the vapour it gives off while it cooks; absent means none you can see
//   smoke      0..1  how thick its smoke is when it burns (leaf, and anything smoked)
export const MATTER_KEYS = ['viscosity', 'grain', 'habit', 'clarity', 'fume', 'smoke'];

// Defaults per form. A form's own keys are the ones its stage chain needs; `REQUIRED` says which a
// cookable drug must author rather than inherit, because the default would make every drug of
// that form look the same.
export const FORM_DEFAULTS = {
  liquid:  { viscosity: 0.1, clarity: 0.8 },
  gel:     { viscosity: 0.7, clarity: 0.5 },
  paste:   { viscosity: 0.9, clarity: 0 },
  powder:  { grain: 'fine' },
  pill:    { grain: 'fine' },
  crystal: { habit: 'shard', clarity: 0.7 },
  gas:     { fume: '#d8dee4' },
  leaf:    { smoke: 0.5 },
  blotter: {},
};
export const REQUIRED = {
  liquid: ['viscosity'], gel: ['viscosity'], paste: ['viscosity'],
  powder: ['grain'], pill: ['grain'],
  crystal: ['habit', 'clarity'],
  gas: ['fume'],
  leaf: ['smoke'],
  blotter: [],
};

// The cook family a form plays (plugins/synthesis COOK_FAMILY); the stage chain hangs off it.
export const FAMILY = { liquid: 'wet', gel: 'wet', paste: 'wet', powder: 'solids', pill: 'solids', crystal: 'solids', gas: 'gas', leaf: 'botanical', blotter: 'botanical' };

const HEX = /^#[0-9a-f]{6}$/i;
const unit = (v) => typeof v === 'number' && v >= 0 && v <= 1;

// The drug's matter: its form's defaults with `flags.matter` over them.
export function matterOf(drug) {
  const f = drug?.flags || {};
  const form = DRUG_FORMS.includes(f.form) ? f.form : null;
  return { form, color: HEX.test(f.color || '') ? f.color : null, ...(form ? FORM_DEFAULTS[form] : {}), ...(f.matter || {}) };
}

// What's wrong with a drug row's form, colour and matter. `cookable` (a chemistry recipe makes it)
// also demands a form, a colour and the matter keys its form needs.
export function drugMatterProblems(flags, { cookable = false } = {}) {
  const f = flags || {};
  const out = [];
  if (f.form != null && !DRUG_FORMS.includes(f.form)) out.push(`flags.form "${f.form}" is not one of ${DRUG_FORMS.join(', ')}`);
  if (f.color != null && !HEX.test(f.color)) out.push('flags.color must be a #rrggbb colour');
  const m = f.matter;
  if (m != null) {
    if (typeof m !== 'object' || Array.isArray(m)) return [...out, 'flags.matter must be an object'];
    for (const k of Object.keys(m)) if (!MATTER_KEYS.includes(k)) out.push(`flags.matter.${k} is not a matter key (${MATTER_KEYS.join(', ')})`);
    for (const k of ['viscosity', 'clarity', 'smoke']) if (m[k] != null && !unit(m[k])) out.push(`flags.matter.${k} must be a number from 0 to 1`);
    if (m.grain != null && !GRAINS.includes(m.grain)) out.push(`flags.matter.grain "${m.grain}" is not one of ${GRAINS.join(', ')}`);
    if (m.habit != null && !HABITS.includes(m.habit)) out.push(`flags.matter.habit "${m.habit}" is not one of ${HABITS.join(', ')}`);
    if (m.fume != null && !HEX.test(m.fume)) out.push('flags.matter.fume must be a #rrggbb colour');
  }
  if (cookable) {
    if (f.form == null) out.push(`a chemistry recipe cooks this drug, so it needs flags.form (${DRUG_FORMS.join(', ')}); without one it cooks as a liquid`);
    if (f.color == null) out.push('a chemistry recipe cooks this drug, so it needs flags.color, the colour of the product');
    for (const k of REQUIRED[f.form] || []) if (m?.[k] == null) out.push(`a cooked ${f.form} needs flags.matter.${k}`);
  }
  return out;
}
