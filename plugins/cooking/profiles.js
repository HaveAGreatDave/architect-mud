// Food profiles — reusable behaviour classes referenced by an item's
// `tags.food_profile`. Plugin-local balance data, same choice as config.js and
// preservation/config.js: this describes how a *class* of food behaves, not any
// individual world item, so it isn't content and doesn't want a table.
//
// Six fields, deliberately. This is not a thermal simulation — it's the minimum
// needed for a steak, a potato, a tomato, a soup and a pancake to feel different
// from each other. Anything a profile can't express yet should stay unexpressed
// until a food actually needs it.
//
// `targets` is the important one: it maps an END STATE to the BEST band that end
// state can ever reach. A tomato is excellent raw AND cooked; a potato raw is
// poor no matter how carefully you didn't cook it. The target is a ceiling — the
// process (heat, vessel, turning, timing, skill) decides how close you get to it.

// The quality scale now lives in the engine — cooking is no longer its only
// reader (drinks composes into it, and applyItemUse spends it), so it moved to
// server/engine/quality-bands.js and is re-exported here unchanged. Every
// existing `import { QUALITY_BANDS } from './profiles.js'` keeps working.
export { QUALITY_BANDS, LEGACY_BAND_INDEX, bandIndex } from '../../server/engine/quality-bands.js';
import { QUALITY_BANDS, bandIndex } from '../../server/engine/quality-bands.js';

export const PROFILES = {
  // A thick cut of meat: slow, forgiving to turn once, punishing past the window.
  dense_meat: {
    unitWeight: 250,   // grams that count as one of this in a recipe
    label: 'dense meat',
    needsPrep: true,   // arrives whole — has to be cut down before it goes in
    cookRateMult: 1.0,       // scales COOK_SECONDS_PER_KG
    peakFraction: 0.35,      // peak window length, as a fraction of cookMs
    burnFraction: 0.9,       // how long past peak before it's burnt
    turns: 1,                // ideal turns; 0 means turning it is fussing
    heatTolerance: 'low',    // the curve's dominant phase — see validateProfiles
    // Sear it hard, then let it come through gently. The single most-taught
    // thing about cooking meat, and the reason heatCurve exists at all.
    heatCurve: [{ until: 0.25, tier: 'high' }, { until: 1, tier: 'low' }],
    // DONENESS. Where the peak window sits, as a multiple of the cook time —
    // the one place the player chooses the target instead of being graded
    // against a universal one. `risk` is the chance of food poisoning from
    // eating it that way, which is what stops "blue" being a free speed-run.
    doneness: {
      default: 'medium',
      levels: [
        { name: 'blue', at: 0.55, risk: 0.45 },
        { name: 'rare', at: 0.75, risk: 0.20 },
        { name: 'medium', at: 1.00 },
        { name: 'well done', at: 1.35 },
      ],
    },
    difficulty: 7,
    targets: { raw: 'good', peak: 'masterful', over: 'acceptable', burnt: 'poor' },
  },
  // Bad raw, good for a long time once cooked. Slow, and hard to actually ruin.
  starchy_vegetable: {
    unitWeight: 250,   // grams that count as one of this in a recipe
    label: 'starchy vegetable',
    needsPrep: true,   // arrives whole — has to be cut down before it goes in
    cookRateMult: 1.4,
    peakFraction: 0.6,
    burnFraction: 1.2,
    turns: 1,
    heatTolerance: 'low',
    difficulty: 4,
    targets: { raw: 'poor', peak: 'excellent', over: 'good', burnt: 'poor' },
  },
  // Pasta, rice, noodles, dried pulses. Its own class, and it had to become one:
  // all of it was riding `starchy_vegetable`, which declares `needsPrep` — the
  // "arrives whole, cut it down first" rule that is right for a potato and
  // absurd for a box of penne. The game was asking you to chop dry pasta with a
  // knife, and the recipe card was printing "250g of starchy vegetable, cut
  // down" for what is plainly a portion of penne.
  //
  // The shape of the numbers is what separates it from a root: it is INEDIBLE
  // raw (a potato raw is merely poor; dry pasta is not food), it needs a lot of
  // liquid and time rather than heat, it is very hard to burn while there is
  // still water around it, and it is ruined by stirring — which is the one
  // handling mistake everyone makes with rice.
  dry_starch: {
    unitWeight: 125,   // a portion, not a sack — you cook 125g of pasta per head
    label: 'dry starch',
    needsPrep: false,  // you do not chop pasta. This is the whole point.
    cookRateMult: 1.1,
    peakFraction: 0.25,      // the window between al dente and paste is narrow
    burnFraction: 1.6,       // ...but it will not actually burn while it's wet
    turns: 0,                // stirring rice is how you get wallpaper paste
    heatTolerance: 'mid',
    doneness: {
      default: 'al dente',
      levels: [
        { name: 'chalky', at: 0.7, risk: 0.05 },
        { name: 'al dente', at: 1.00 },
        { name: 'soft', at: 1.3 },
      ],
    },
    difficulty: 4,
    targets: { raw: 'poor', peak: 'excellent', over: 'acceptable', burnt: 'poor' },
  },
  // Fine raw, fine cooked, ruined by handling. Fast.
  soft_vegetable: {
    unitWeight: 120,   // grams that count as one of this in a recipe
    label: 'soft vegetable',
    needsPrep: true,   // arrives whole — has to be cut down before it goes in
    cookRateMult: 0.6,
    peakFraction: 0.3,
    burnFraction: 0.5,
    turns: 0,
    heatTolerance: 'low',
    difficulty: 5,
    targets: { raw: 'excellent', peak: 'excellent', over: 'acceptable', burnt: 'poor' },
  },
  // Wants stirring, wants low heat, very hard to burn but easy to scorch.
  liquid: {
    unitWeight: 400,   // grams that count as one of this in a recipe
    label: 'liquid',
    cookRateMult: 1.2,
    peakFraction: 0.7,
    burnFraction: 0.8,
    turns: 2,                // stirs count as turns — same act, different verb
    heatTolerance: 'low',
    // Bring it up fast, then hold it at a simmer. Boil it the whole way and you
    // get something cloudy and bitter instead of something clear.
    heatCurve: [{ until: 0.2, tier: 'high' }, { until: 1, tier: 'low' }],
    difficulty: 6,
    targets: { raw: 'poor', peak: 'excellent', over: 'good', burnt: 'poor' },
  },
  // Sweet, excellent as it is, and it caramelises fast in a hot pan — which is
  // also how it goes from caramel to carbon while you're looking elsewhere.
  fruit: {
    unitWeight: 160,   // grams that count as one of this in a recipe
    label: 'fruit',
    needsPrep: true,   // arrives whole — has to be cut down before it goes in
    cookRateMult: 0.5,
    peakFraction: 0.35,
    burnFraction: 0.4,
    turns: 1,
    heatTolerance: 'mid',
    difficulty: 5,
    targets: { raw: 'excellent', peak: 'excellent', over: 'acceptable', burnt: 'poor' },
  },
  // The fussiest thing in the kitchen: fast, low, and a window measured in
  // seconds. Nothing else rewards attention this steeply or punishes it faster.
  egg: {
    unitWeight: 80,   // grams that count as one of this in a recipe
    label: 'egg',
    // An egg is light, so a realistically fast rate multiplier gave a 60g egg a
    // 1.6-SECOND peak window on the most forgiving kit in the game — a window no
    // player can act inside. Slowed deliberately: this is still the tightest
    // window of any profile, which is the design intent, but it is now a test of
    // attention rather than of reflexes.
    cookRateMult: 1.2,
    peakFraction: 0.3,
    burnFraction: 0.35,
    doneness: {
      default: 'soft',
      levels: [
        { name: 'runny', at: 0.70, risk: 0.30 },
        { name: 'soft', at: 1.00 },
        { name: 'hard', at: 1.40 },
      ],
    },
    turns: 1,
    heatTolerance: 'low',
    difficulty: 7,
    targets: { raw: 'poor', peak: 'masterful', over: 'acceptable', burnt: 'poor' },
  },
  // Cured, salted, tinned. Already survived worse than your cooking — fine as
  // it is, better warmed, and very hard to actually ruin.
  preserved: {
    unitWeight: 300,   // grams that count as one of this in a recipe
    label: 'preserved',
    cookRateMult: 0.7,
    peakFraction: 0.7,
    burnFraction: 0.9,
    turns: 0,
    heatTolerance: 'high',
    difficulty: 3,
    targets: { raw: 'good', peak: 'excellent', over: 'good', burnt: 'poor' },
  },
  // Fat is a modifier, not a meal. Almost no cook time of its own, wants a hot
  // pan, and its whole job is to be in the vessel while something else cooks.
  fat_or_oil: {
    unitWeight: 300,   // grams that count as one of this in a recipe
    label: 'fat',
    cookRateMult: 0.3,
    peakFraction: 0.5,
    burnFraction: 0.5,
    turns: 0,
    heatTolerance: 'high',
    difficulty: 3,
    modifier: true,
    targets: { raw: 'acceptable', peak: 'excellent', over: 'acceptable', burnt: 'poor' },
  },
  // Herbs and spice. Tiny, fast, and the first thing in the pan to scorch — the
  // reason a dish that wanted seasoning can still be ruined by seasoning it.
  aromatic: {
    unitWeight: 60,   // grams that count as one of this in a recipe
    label: 'aromatic',
    cookRateMult: 0.25,
    peakFraction: 0.3,
    burnFraction: 0.25,
    turns: 0,
    heatTolerance: 'low',
    difficulty: 5,
    modifier: true,
    targets: { raw: 'good', peak: 'excellent', over: 'acceptable', burnt: 'poor' },
  },
  // Bread. Its own class, and it had to become one the moment sandwiches
  // existed: bread was riding `starchy_vegetable`, whose raw target is `poor`,
  // because a raw potato IS poor — which would have made every cold sandwich in
  // the game bad on the strength of its bread. Bread is the opposite case. It
  // arrives already baked, so it is GOOD raw, better toasted, and past that it's
  // just burnt toast. It also stops turning up in stews, which is its own small
  // mercy.
  bread: {
    unitWeight: 180,   // grams that count as one of this in a recipe
    label: 'bread',
    cookRateMult: 0.35,      // toasts fast
    peakFraction: 0.3,
    burnFraction: 0.4,
    turns: 1,
    heatTolerance: 'mid',
    difficulty: 3,
    targets: { raw: 'good', peak: 'excellent', over: 'acceptable', burnt: 'poor' },
  },
  // Cheese, and what cheese does. The only profile whose whole character is a
  // CHANGE OF STATE rather than a degree of cooking: it is fine raw, it becomes
  // something else entirely when it melts, and shortly after that it splits into
  // oil and rubber and cannot be brought back. Hence the shape of the numbers —
  // a good raw target (nobody ruins cheese by not cooking it), the highest peak
  // in the catalog outside meat and egg, and the shortest burn window of any
  // non-modifier profile. Low heat, and don't poke it: melting is something you
  // let happen, not something you do.
  dairy: {
    unitWeight: 90,    // grams that count as one of this in a recipe
    label: 'dairy',
    cookRateMult: 0.5,
    peakFraction: 0.4,       // a generous melt...
    burnFraction: 0.3,       // ...and it splits fast once it's gone past
    turns: 0,                // stirring melting cheese is how you get a stringy mess
    heatTolerance: 'low',
    difficulty: 5,
    targets: { raw: 'good', peak: 'masterful', over: 'acceptable', burnt: 'poor' },
  },
  // Fast, one turn, a narrow window either side of it.
  batter: {
    unitWeight: 250,   // grams that count as one of this in a recipe
    label: 'batter',
    cookRateMult: 0.4,
    peakFraction: 0.25,
    burnFraction: 0.4,
    turns: 1,
    heatTolerance: 'high',
    difficulty: 6,
    targets: { raw: 'poor', peak: 'excellent', over: 'acceptable', burnt: 'poor' },
  },
};

// The verb a profile's ideal handling reads as, for flavour and for the
// wrong-tool message. Stirring a steak and flipping a soup are both "handling".
export const HANDLING_VERB = { liquid: 'stir' };

// A MODIFIER seasons a dish rather than being part of it. Fat and aromatics are
// light and cook in seconds, so in any vessel holding a real main they would be
// cinders long before it was ready — scoring them as ingredients made every dish
// that "optionally" allowed them strictly worse for having them, which is the
// opposite of the intent. So they never take a cook session of their own, are
// never scored or burnt, and contribute a flat seasoning bonus to the finished
// dish instead. You do not plate the garlic separately.
// Profiles that arrive WHOLE — a cut, a root, a bulb, a fruit. Combining them
// into a dish means cutting them down first, which is what the knife is for.
// Declared on the profile rather than per-recipe so every dish that uses one is
// covered the moment it is written, and none can be forgotten.
export const profileNeedsPrep = name => !!PROFILES[name]?.needsPrep;

// Already cut down to nothing — mince needs no further prep, whatever its
// profile normally demands. It IS the prep.
export const isMinced = invRow => !!invRow?.custom_data?.minced;
export const needsPrep = invRow => !isMinced(invRow) && profileNeedsPrep(profileNameFor(invRow));

export const isModifierProfile = name => !!PROFILES[name]?.modifier;
export const isModifier = invRow => isModifierProfile(profileNameFor(invRow));

// A COOKING MEDIUM is in the pan to carry heat rather than to be eaten: the
// water pasta boils in. It is a liquid for every question about the PAN — is it
// wet, does it lift fond, does it boil rather than sizzle, will dry starch cook
// in it — and nothing at all for every question about the DISH. That split is
// the whole tag. Water in the pot must never take a cook session (a pot of water
// cannot burn), never score, and never satisfy a recipe asking for stock, or
// "penne and two bottles of water" comes straight back as a valid pan of sauce.
export const isMedium = invRow => !!(invRow?.tags?.cooking_medium);

// A per-INSTANCE noun beats the class one: meat butchered off a feral dog is
// tagged with what it came off, so it cooks into "feral dog and potato stew"
// rather than the generic "meat and potato stew". Set by plugins/butchering.
export const instanceNoun = invRow => {
  const n = invRow?.custom_data?.food_noun;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
};

export function profileNameFor(invRow) {
  // A smoked cut IS preserved, whatever it started as — that's the whole point
  // of smoking it, and it's why smoked meat slots into every preserved recipe
  // without a single new dish template.
  const smoked = invRow?.custom_data?.smoked;
  if (smoked && PROFILES[smoked]) return smoked;
  const bag = invRow?.tags || invRow?.flags || {};
  const name = bag.food_profile;
  return typeof name === 'string' && PROFILES[name] ? name : null;
}

export function profileFor(invRow) {
  const name = profileNameFor(invRow);
  return name ? PROFILES[name] : null;
}

// ── Doneness ─────────────────────────────────────────────────────────────────
// Only some foods have a meaningful target. A potato is cooked or it isn't; a
// steak has four answers and the player picks one. A profile without a
// `doneness` block behaves exactly as it always did (one window, at 1.0).

export const donenessLevels = profile => profile?.doneness?.levels || null;
export const defaultDoneness = profile => profile?.doneness?.default || null;

export function donenessLevel(profile, name) {
  const levels = donenessLevels(profile);
  if (!levels) return null;
  return levels.find(l => l.name === name) || levels.find(l => l.name === defaultDoneness(profile)) || null;
}

// Where the window sits for this target, as a multiple of cookMs. 1 — the old
// universal behaviour — for anything without a doneness block.
export function donenessAt(profile, name) {
  return donenessLevel(profile, name)?.at ?? 1;
}

// What you ACTUALLY produced, whatever you were aiming at: the level nearest to
// how far through the cook you pulled it. This is what gets stamped on the food,
// so the record is the truth rather than the intention.
export function achievedDoneness(profile, fraction) {
  const levels = donenessLevels(profile);
  if (!levels) return null;
  return levels.reduce((best, l) =>
    Math.abs(l.at - fraction) < Math.abs(best.at - fraction) ? l : best, levels[0]).name;
}

// (bandIndex is re-exported from server/engine/quality-bands.js at the top.)

// Sanity gate over the catalog, asserted by regress. This is the validation
// layer the AI-generated catalog will lean on later — cheap to add now, and it
// catches the contradictions a generator produces (raw beating cooked on a food
// that has to be cooked, a peak that's worse than being past it, and so on).
export function validateProfiles(profiles = PROFILES) {
  const errors = [];
  for (const [key, p] of Object.entries(profiles)) {
    const at = f => `${key}.${f}`;
    for (const f of ['cookRateMult', 'peakFraction', 'burnFraction']) {
      const v = p[f];
      if (!Number.isFinite(v) || v <= 0 || v > 2) errors.push(`${at(f)} must be in (0, 2] — got ${v}`);
    }
    if (!Number.isInteger(p.turns) || p.turns < 0) errors.push(`${at('turns')} must be a non-negative integer — got ${p.turns}`);
    if (!['low', 'mid', 'high'].includes(p.heatTolerance)) errors.push(`${at('heatTolerance')} must be low/mid/high — got ${p.heatTolerance}`);

    if (p.heatCurve) {
      let prev = 0;
      const share = {};
      for (const step of p.heatCurve) {
        if (!['low', 'mid', 'high'].includes(step.tier)) errors.push(`${at('heatCurve')} step tier must be low/mid/high — got ${step.tier}`);
        if (!(step.until > prev) || step.until > 1) errors.push(`${at('heatCurve')} steps must have strictly increasing 'until' in (0,1] — got ${step.until} after ${prev}`);
        share[step.tier] = (share[step.tier] || 0) + Math.max(0, step.until - prev);
        prev = step.until;
      }
      if (Math.abs(prev - 1) > 1e-9) errors.push(`${at('heatCurve')} must cover the whole cook — last 'until' is ${prev}, not 1`);
      // A cook held at one setting scores by how much of the curve that setting
      // covers, so heatTolerance — the "just leave it there" answer — has to be
      // the curve's dominant phase or the two disagree about the same food.
      const dominant = Object.entries(share).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (dominant && p.heatTolerance !== dominant) {
        errors.push(`${at('heatTolerance')} is ${p.heatTolerance}, but the heatCurve spends most of the cook at ${dominant} — they must agree`);
      }
    }
    if (!Number.isFinite(p.difficulty) || p.difficulty < 1) errors.push(`${at('difficulty')} must be >= 1 — got ${p.difficulty}`);

    if (p.doneness) {
      const levels = p.doneness.levels;
      if (!Array.isArray(levels) || levels.length < 2) errors.push(`${at('doneness.levels')} needs at least two levels to be a choice`);
      else {
        let prev = 0;
        for (const l of levels) {
          if (!l.name) errors.push(`${at('doneness.levels')} entry is missing a name`);
          if (!Number.isFinite(l.at) || l.at <= 0) errors.push(`${at('doneness')} "${l.name}" needs a positive 'at' — got ${l.at}`);
          else if (l.at <= prev) errors.push(`${at('doneness')} levels must be ordered rarest-first — "${l.name}" at ${l.at} follows ${prev}`);
          prev = l.at;
          if (l.risk !== undefined && (!Number.isFinite(l.risk) || l.risk < 0 || l.risk > 1)) errors.push(`${at('doneness')} "${l.name}" risk must be 0..1 — got ${l.risk}`);
        }
        if (!levels.some(l => l.name === p.doneness.default)) errors.push(`${at('doneness.default')} "${p.doneness.default}" isn't one of the levels`);
        // The default is the food cooked as the rest of the system assumes —
        // shifting it off 1.0 would silently retune every duration in the game.
        const def = levels.find(l => l.name === p.doneness.default);
        if (def && def.at !== 1) errors.push(`${at('doneness.default')} must sit at 1.0 (the profile's own cook time) — "${def.name}" is at ${def.at}`);
      }
    }

    const t = p.targets || {};
    for (const state of ['raw', 'peak', 'over', 'burnt']) {
      if (!QUALITY_BANDS.includes(t[state])) errors.push(`${at(`targets.${state}`)} isn't a quality band — got ${t[state]}`);
    }
    if (errors.length) continue; // the comparisons below assume valid bands

    // Cooking must be worth doing: no profile may peak below what it's worth raw.
    if (bandIndex(t.peak) < bandIndex(t.raw)) errors.push(`${at('targets')} — peak (${t.peak}) is worse than raw (${t.raw}); cooking would be pointless`);
    // Past the peak must never be an improvement on the peak.
    if (bandIndex(t.over) > bandIndex(t.peak)) errors.push(`${at('targets')} — over (${t.over}) beats peak (${t.peak})`);
    // Burnt is the floor, always.
    if (bandIndex(t.burnt) > bandIndex(t.over)) errors.push(`${at('targets')} — burnt (${t.burnt}) beats over (${t.over})`);
  }
  return { ok: errors.length === 0, errors };
}
