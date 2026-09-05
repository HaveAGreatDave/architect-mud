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
      enormous: [`${sub} ass is enormous. It's doing a lot. It is, arguably, doing too much.`, `${sub} rear end is massive — a geographical feature more than a body part.`],
    };
    const assLine = (ASS_DESC[assSize] || ASS_DESC.average)[Math.floor(Math.random() * 2)];
    // Breasts + nipples are described by the MIS chest note (single source of
    // truth); the labia description is hidden for now.
    return assLine;
  }

  return null;
}

// Ejaculate/soil locations are body sites (penis, balls, ass…) but the coveredSlots
// passed in are equipment-slot keys (legs, torso…). Crotch-area sites are hidden by
// whatever fills the `legs` slot — without this map "penis" never matches "legs" and
// fluid shows through fully clothed legs.
const EJAC_COVER_SLOT = { penis: 'legs', balls: 'legs', ass: 'legs', asshole: 'legs', pussy: 'legs', crotch: 'legs' };

// Describe ejaculate visible on a player (if MIS active and not covered)
export function ejaculateDescription(player, isSelf, coveredSlots) {
  const state = player.appearance_data?.ejaculate_state;
  if (!state || !state.locations?.length) return null;
  const visibleLocs = state.locations.filter(loc => !coveredSlots.has(EJAC_COVER_SLOT[loc] || loc));
  if (!visibleLocs.length) return null;
  const subject = isSelf ? 'You have' : `${player.handle} has`;
  return `${subject} dried fluid visible on ${visibleLocs.join(', ')}.`;
}

// ── Detailed body-part examination (MIS drill-down) ──────────────────────────
// `examine <who>'s <part>` routes here through the MIS plugin's input matcher.
// Returns tone-appropriate prose for a single part. Works on players (sized from
// appearance_data) and NPCs (no stored sizes — generic, sex-driven copy). The
// caller has already confirmed MIS is active.
function rp(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const PENIS_DETAIL = {
  small: [
    `{sub} cock is on the small side — {state}, and making no apologies for it.`,
    `{sub} dick is modest. Compact. It does what it needs to and clocks out.`,
    `{sub} cock is small and {state}. Nature was working within a budget.`,
  ],
  'average-sized': [
    `{sub} cock is average and {state} — reassuringly unremarkable.`,
    `{sub} dick is a textbook build, {state}, no notes.`,
    `{sub} cock hangs {state} at a perfectly respectable size.`,
  ],
  large: [
    `{sub} cock is large and {state}. It commands the room a little.`,
    `{sub} dick is big, {state}, and clearly used to being the main event.`,
    `{sub} cock is generously sized and {state}. Gravity has an opinion.`,
  ],
  'very large': [
    `{sub} cock is enormous and {state} — frankly it's showing off.`,
    `{sub} dick is massive, {state}, a genuine logistical concern.`,
    `{sub} cock is huge and {state}. You could set a watch by it.`,
  ],
};
const BALLS_DETAIL = {
  small:      [`{sub} balls are small and tucked up tight.`, `{sub} testicles are compact, keeping a low profile.`, `{sub} balls sit high and neat.`],
  average:    [`{sub} balls hang at an ordinary, unbothered weight.`, `{sub} testicles are average — nothing to write home about.`, `{sub} balls are perfectly standard-issue.`],
  large:      [`{sub} balls are heavy and low-slung.`, `{sub} testicles are large, hanging with real conviction.`, `{sub} balls are substantial — they've got presence.`],
  'very large': [`{sub} balls are enormous, swinging like they pay rent.`, `{sub} testicles are massive and heavy.`, `{sub} balls are huge — an anatomical statement.`],
};
const PUSSY_DETAIL = {
  average:   [`{sub} pussy is neat and unremarkable, {wet}.`, `{sub} cunt sits average and tidy, {wet}.`, `{sub} pussy is a textbook build, {wet}.`],
  prominent: [`{sub} pussy is full and prominent, lips soft and parted, {wet}.`, `{sub} cunt has generous, pronounced lips, {wet}.`, `{sub} pussy is lush and full, {wet}.`],
  tucked:    [`{sub} pussy is neat and tucked, lips closed and tidy, {wet}.`, `{sub} cunt is compact and tucked away, {wet}.`, `{sub} pussy is small and neatly closed, {wet}.`],
};
const PUSSY_WET = {
  wet: [`slick and obviously worked up`, `wet enough to leave no doubt`, `glistening, well past pretending`],
  dry: [`dry and composed for now`, `unbothered and dry`, `keeping its opinions to itself`],
};
const BREAST_DETAIL = {
  flat:         [`{sub} chest is nearly flat — efficient, no complaints from physics.`, `{sub} breasts are barely there, present mostly in theory.`, `{sub} chest is smooth and flat, aerodynamic.`],
  small:        [`{sub} breasts are small and high, perky to the point of smug.`, `{sub} tits are modest and pert, making no apologies.`, `{sub} breasts sit small and neat.`],
  medium:       [`{sub} breasts are a solid handful each — the satisfying kind.`, `{sub} tits are average in the best sense, full and round.`, `{sub} breasts are a comfortable medium, unbothered by gravity.`],
  large:        [`{sub} breasts are large and full. Gravity is aware of them.`, `{sub} tits are heavy and generous, impossible to ignore.`, `{sub} breasts are big and soft, with real weight to them.`],
  'very large': [`{sub} breasts are enormous — their own gravitational field.`, `{sub} tits are massive, structurally impressive.`, `{sub} breasts are huge, and doing frankly too much.`],
};
const NIPPLE_DETAIL_HARD = [
  `{poss} nipples are rock hard, standing at full attention.`,
  `{poss} nipples are stiff and pointed, not remotely subtle.`,
  `{poss} nipples are hard enough to cut glass. They have opinions.`,
];
const NIPPLE_DETAIL_SOFT = [
  `{poss} nipples are soft and relaxed, diplomatically neutral.`,
  `{poss} nipples are at ease — no agenda, no complaints.`,
  `{poss} nipples are soft, resting quietly.`,
];
const ASS_DETAIL = {
  flat:     [`{sub} ass is completely flat — more suggestion than ass.`, `{sub} rear is aerodynamically optimized. No drag, no drama.`, `{sub} backside barely registers.`],
  small:    [`{sub} ass is small and tight — compact, quietly excellent.`, `{sub} backside is modest but well-formed.`, `{sub} ass is trim and firm.`],
  average:  [`{sub} ass is average — a solid, dependable rear.`, `{sub} ass occupies exactly the expected amount of space. Respectable.`, `{sub} backside is unremarkable and content about it.`],
  round:    [`{sub} ass is round and full, the kind you notice leaving.`, `{sub} rear is geometrically satisfying.`, `{sub} ass is plump and well-shaped.`],
  large:    [`{sub} ass is large and pronounced, a presence unto itself.`, `{sub} backside is generous — substantial enough to have an agenda.`, `{sub} ass is big and heavy, impossible to overlook.`],
  enormous: [`{sub} ass is enormous. It is, arguably, doing too much.`, `{sub} rear is massive — a geographical feature more than a body part.`, `{sub} ass is colossal, and unbothered by your staring.`],
};
const ASSHOLE_DETAIL = [
  `{sub} asshole is tight and puckered, keeping to itself.`,
  `{sub} asshole is neat, clenched, and minding its own business.`,
  `{sub} asshole is a tight little knot, unbothered by the scrutiny.`,
  `{sub} asshole twitches slightly under the attention. Rude of you, honestly.`,
];
const GENERIC_NPC_PART = {
  penis:   [`It's a cock. Attached to {name}. You've seen one before.`, `{name} is packing the standard equipment.`],
  balls:   [`{name} has balls. They hang there, doing balls things.`],
  pussy:   [`{name} has a pussy. It exists. It's right there.`],
  breasts: [`{name} has a chest. It's doing fine.`],
  nipples: [`{name} has nipples. Two of them, by the look of it.`],
  ass:     [`{name} has an ass. It's an ass.`],
  asshole: [`{name}'s asshole is where you'd expect it to be. Congratulations on finding it.`],
};

// partKey ∈ genitals|penis|balls|pussy|breasts|nipples|ass|asshole
export function describeBodyPart(subject, partKey, isSelf) {
  const sex = subject.biological_sex || subject.sex;
  const name = subject.handle || subject.name || 'they';
  const sub = isSelf ? 'Your' : `${name}'s`;
  const poss = isSelf ? 'Your' : `${name}'s`;
  const data = subject.appearance_data || null; // NPCs have none → generic copy
  const horny = subject.horniness || 0;

  // Resolve "genitals"/"crotch" to the sex-appropriate part
  if (partKey === 'genitals') partKey = sex === 'male' ? 'penis' : 'pussy';

  const fill = s => s.replace(/\{sub\}/g, sub).replace(/\{poss\}/g, poss).replace(/\{name\}/g, name);

  switch (partKey) {
    case 'penis': {
      if (sex !== 'male') return isSelf ? `You don't have one of those.` : `${name} isn't equipped that way.`;
      if (!data) { const line = fill(rp(GENERIC_NPC_PART.penis)); return line; }
      const len = data.penis_length_cm || 13;
      const sizeWord = len <= 11 ? 'small' : len <= 14 ? 'average-sized' : len <= 17 ? 'large' : 'very large';
      const state = subject.erect ? 'stiff and standing' : 'soft and hanging';
      const penisLine = fill(rp(PENIS_DETAIL[sizeWord]).replace(/\{state\}/g, state));
      const ballsLine = fill(rp(BALLS_DETAIL[data.testicle_size || 'average']));
      return `${penisLine} ${ballsLine}`;
    }
    case 'balls': {
      if (sex !== 'male') return isSelf ? `You don't have any.` : `${name} isn't equipped that way.`;
      if (!data) return fill(rp(GENERIC_NPC_PART.balls));
      return fill(rp(BALLS_DETAIL[data.testicle_size || 'average']));
    }
    case 'pussy': {
      if (sex !== 'female') return isSelf ? `You don't have one of those.` : `${name} isn't equipped that way.`;
      if (!data) return fill(rp(GENERIC_NPC_PART.pussy));
      const wet = rp(horny > 30 ? PUSSY_WET.wet : PUSSY_WET.dry);
      return fill(rp(PUSSY_DETAIL[data.labia_style || 'average']).replace(/\{wet\}/g, wet));
    }
    case 'breasts': {
      if (sex !== 'female') return isSelf ? `Nothing much to report up top.` : `${name}'s chest is flat and unremarkable.`;
      if (!data) return fill(rp(GENERIC_NPC_PART.breasts));
      const bLine = fill(rp(BREAST_DETAIL[data.breast_size || 'medium']));
      const nLine = fill(rp(horny > 30 ? NIPPLE_DETAIL_HARD : NIPPLE_DETAIL_SOFT));
      return `${bLine} ${nLine}`;
    }
    case 'nipples': {
      if (!data && sex !== 'female') return fill(rp(GENERIC_NPC_PART.nipples));
      return fill(rp(horny > 30 ? NIPPLE_DETAIL_HARD : NIPPLE_DETAIL_SOFT));
    }
    case 'ass': {
      if (!data) return fill(rp(GENERIC_NPC_PART.ass));
      return fill(rp(ASS_DETAIL[data.ass_size || 'average']));
    }
    case 'asshole': {
      if (!data) return fill(rp(GENERIC_NPC_PART.asshole));
      return fill(rp(ASSHOLE_DETAIL));
    }
    default:
      return null;
  }
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
