/**
 * Appearance system — random generation at character creation,
 * and helpers for building physical description text.
 */

const HAIR_STYLES = ['short', 'long', 'mohawk', 'shaved', 'dreadlocks', 'braided', 'messy', 'slicked-back', 'curly', 'wavy'];
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
  short:         ['short'],
  messy:         ['short', 'medium'],
  'slicked-back':['short', 'medium'],
  curly:         ['short', 'medium', 'long'],
  wavy:          ['medium', 'long'],
  long:          ['long', 'very_long'],
  braided:       ['long', 'very_long'],
  dreadlocks:    ['medium', 'long', 'very_long'],
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

  // Genital appearance — sizes stored internally, never shown unless MIS active
  const appearance_data = isMale
    ? {
        penis_length_cm: randInRange(9, 18),
        penis_girth_cm: Math.round((randInRange(10, 16)) / 10 * 10) / 10,
        testicle_size: pick(['average', 'average', 'large', 'small']),
        ejaculate_state: null,
      }
    : {
        breast_size: pick(['flat', 'small', 'medium', 'large', 'very large']),
        labia_style: pick(['average', 'prominent', 'tucked']),
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

// Describe ejaculate visible on a player (if MIS active and not covered)
export function ejaculateDescription(player, isSelf, coveredSlots) {
  const state = player.appearance_data?.ejaculate_state;
  if (!state || !state.locations?.length) return null;
  const visibleLocs = state.locations.filter(loc => !coveredSlots.has(loc));
  if (!visibleLocs.length) return null;
  const subject = isSelf ? 'You have' : `${player.handle} has`;
  return `${subject} dried fluid visible on ${visibleLocs.join(', ')}.`;
}
