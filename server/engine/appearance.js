/**
 * Appearance system — random generation at character creation,
 * and helpers for building physical description text.
 */

const HAIR_STYLES = ['mohawk', 'shaved', 'dreadlocks', 'braided', 'messy', 'slicked-back', 'curly', 'wavy', 'undercut', 'fade', 'afro', 'cornrows', 'pompadour', 'pixie'];
const HAIR_LENGTHS = {
  shaved: 'shaved',
  short: 'short',
  medium: 'medium-length',
  long: 'long',
  very_long: 'very long',
};
const HAIR_COLORS = ['black', 'dark brown', 'brown', 'auburn', 'dirty blonde', 'blonde', 'red', 'grey', 'white', 'silver', 'dyed blue', 'dyed green', 'dyed purple', 'dyed red'];
const EYE_COLORS = ['brown', 'dark brown', 'blue', 'light blue', 'green', 'hazel', 'grey', 'amber'];

// Hair style → plausible length buckets
const STYLE_LENGTHS = {
  shaved:        ['shaved'],
  mohawk:        ['short', 'medium'],
  messy:         ['short', 'medium'],
  'slicked-back':['short', 'medium'],
  curly:         ['short', 'medium', 'long'],
  wavy:          ['medium', 'long'],
  braided:       ['long', 'very_long'],
  dreadlocks:    ['medium', 'long', 'very_long'],
  undercut:      ['short', 'medium'],
  fade:          ['short'],
  afro:          ['short', 'medium'],
  cornrows:      ['short', 'medium', 'long'],
  pompadour:     ['medium'],
  pixie:         ['short'],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Gaussian-ish using average of two randoms
function randInRange(min, max) {
  return Math.round(min + ((Math.random() + Math.random()) / 2) * (max - min));
}

export function randomAppearance(sex) {
  const hair_style = pick(HAIR_STYLES);
  const lengthKeys = STYLE_LENGTHS[hair_style] || ['short', 'medium'];
  const hair_length = pick(lengthKeys);
  const hair_color = pick(HAIR_COLORS);
  const eye_color = pick(EYE_COLORS);

  const isMale = sex === 'male';
  const height_cm = isMale ? randInRange(162, 192) : randInRange(152, 182);
  // Weight roughly proportional to height
  const bmi = randInRange(18, 28);
  const weight_kg = Math.round(bmi * Math.pow(height_cm / 100, 2));

  // Genital appearance — sizes stored internally, never shown unless MIS active.
  // Length: Gaussian around 13cm (10–16 typical), ~10% chance of outlier (7–9 or 17–21).
  function genLength() {
    const roll = Math.random();
    if (roll < 0.07) return randInRange(7, 9);   // small outlier
    if (roll < 0.14) return randInRange(17, 21);  // large outlier
    return randInRange(10, 16);                    // typical majority
  }
  const appearance_data = isMale
    ? {
        penis_length_cm: genLength(),
        testicle_size: pick(['small', 'average', 'average', 'large', 'very large']),
        ass_size: pick(['flat', 'small', 'average', 'round', 'large']),
        ejaculate_state: null,
      }
    : {
        breast_size: pick(['flat', 'small', 'medium', 'large', 'very large']),
        labia_style: pick(['average', 'prominent', 'tucked']),
        ass_size: pick(['flat', 'small', 'average', 'round', 'large', 'enormous']),
        vagina_tightness: pick(['tight', 'average', 'loose']),
        ejaculate_state: null,
      };

  return { hair_style, hair_length, hair_color, eye_color, height_cm, weight_kg, appearance_data };
}

export function heightDescriptor(cm) {
  if (cm < 158) return 'short';
  if (cm < 168) return 'slightly below-average height';
  if (cm < 178) return 'average height';
  if (cm < 188) return 'tall';
  return 'very tall';
}

export function buildDescriptor(weight_kg, height_cm) {
  const bmi = weight_kg / Math.pow(height_cm / 100, 2);
  if (bmi < 18.5) return 'lean';
  if (bmi < 22)   return 'slender';
  if (bmi < 25)   return 'average build';
  if (bmi < 28)   return 'stocky';
  return 'heavyset';
}

export function physicalDescription(player, isSelf) {
  const { handle, biological_sex, hair_style, hair_length, hair_color, eye_color, height_cm, weight_kg } = player;
  if (!biological_sex) return null; // old player without appearance data

  const sexLabel = biological_sex === 'male' ? 'man' : 'woman';
  const height = heightDescriptor(height_cm || 170);
  const build = buildDescriptor(weight_kg || 70, height_cm || 170);
  const lengthLabel = HAIR_LENGTHS[hair_length] || hair_length || 'short';
  const subject = isSelf ? 'You are' : `${handle} is`;

  // shaved heads need different phrasing
  const hairDesc = hair_style === 'shaved'
    ? `a shaved head`
    : `${lengthLabel} ${hair_style} ${hair_color} hair`;

  return `${subject} a ${height} ${build} ${sexLabel} with ${hairDesc} and ${eye_color} eyes.`;
}

// Describe genitals/breasts — shown naked when MIS is active
export function describeGenitals(player, isSelf) {
  const data = player.appearance_data;
  if (!data) return null;
  const sex = player.biological_sex;
  const sub = isSelf ? 'Your' : `${player.handle}'s`;
  const subLow = isSelf ? 'your' : `${player.handle}'s`;

  if (sex === 'male') {
    const len = data.penis_length_cm || 13;
    const testes = data.testicle_size || 'average';
    const assSize = data.ass_size || 'average';
    const erect = player.erect ? 'erect' : 'flaccid';
    const sizeWord = len <= 11 ? 'small' : len <= 14 ? 'average-sized' : len <= 17 ? 'large' : 'very large';
    const testesNote = testes !== 'average' ? ` ${sub} testicles are ${testes}.` : '';
    const MALE_ASS = {
      flat:    [`${sub} ass is completely flat — barely a suggestion.`, `${sub} rear is aerodynamically optimized.`],
      small:   [`${sub} ass is small and tight — compact, quietly functional.`, `${sub} backside is modest but well-formed.`],
      average: [`${sub} ass is average — a solid, dependable rear.`, `${sub} ass occupies exactly the expected amount of space.`],
      round:   [`${sub} ass is notably round — more than you'd expect.`, `${sub} rear is surprisingly full and round.`],
      large:   [`${sub} ass is large and pronounced. It has opinions.`, `${sub} backside is substantial — it makes itself known.`],
    };
    const assLine = (MALE_ASS[assSize] || MALE_ASS.average)[Math.floor(Math.random() * 2)];
    return `${sub} penis is ${sizeWord} and ${erect}.${testesNote} ${assLine}`;
  }

  if (sex === 'female') {
    const assSize = data.ass_size || 'average';

    const ASS_DESC = {
      flat:     [`${sub} ass is completely flat — it's less of an ass and more of a suggestion.`, `${sub} rear end is aerodynamically optimized. No drag. No drama.`],
      small:    [`${sub} ass is small and tight — compact, unassuming, quietly excellent.`, `${sub} backside is modest in scope but well-formed.`],
      average:  [`${sub} ass is average — a solid, dependable rear with no outstanding grievances.`, `${sub} ass occupies exactly the expected amount of space. Respectable.`],
      round:    [`${sub} ass is round and full, the kind you notice leaving before you notice arriving.`, `${sub} rear is notably round — geometrically satisfying.`],
      large:    [`${sub} ass is large and pronounced, a presence unto itself.`, `${sub} backside is generous — substantial enough to have its own agenda.`],
      enormous: [`${sub} ass is enormous. It is doing a lot. It is, arguably, doing too much.`, `${sub} rear end is massive — a geographical feature more than a body part.`],
    };
    const assLine = (ASS_DESC[assSize] || ASS_DESC.average)[Math.floor(Math.random() * 2)];
    // Breasts + nipples are described by the MIS chest note (single source of
    // truth); the labia description is hidden for now.
    return assLine;
  }

  return null;
}

// Describe ejaculate visible on a player (if MIS active and not covered)
export function ejaculateDescription(player, isSelf, coveredSlots) {
  const state = player.appearance_data?.ejaculate_state;
  if (!state || !state.locations?.length) return null;
  const visibleLocs = state.locations.filter(loc => !coveredSlots.has(loc));
  if (!visibleLocs.length) return null;
  const subject = isSelf ? 'You have' : `${player.handle} has`;
  return `${subject} dried fluid visible on ${visibleLocs.join(', ')}.`;
}

// Describe bare-skin urine/feces residue (bodily plugin's stainCreatureBodyPart
// falls back to this when the targeted body part has no garment to soak).
// Not MIS-gated — bodily functions aren't a sexual mechanic.
export function soilDescription(player, isSelf, coveredSlots) {
  const state = player.appearance_data?.soiled_state;
  if (!state || !state.locations?.length) return null;
  const visibleLocs = state.locations.filter(loc => !coveredSlots.has(loc));
  if (!visibleLocs.length) return null;
  const subject = isSelf ? 'You have' : `${player.handle} has`;
  const noun = state.type === 'feces' ? 'a foul stain' : 'a wet stain';
  return `${subject} ${noun} visible on ${visibleLocs.join(', ')}.`;
}
