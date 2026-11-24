// What people wear when it's warm out (docs/npc-clothing.md "Summer clothes").
//
// An NPC's `flags.clothing_layers` is what they wear on an ordinary day, and in Coldwater that's mostly
// sweaters and coats. On a warm day `summerLayers` takes the bulky pieces off and, if that leaves no top,
// puts on a light fitted one from the SUMMER wardrobe; on a hot day some swap their trousers for shorts or a
// skirt too. Nothing is stored: the stored outfit is what they go back to when it cools. Examine
// (npcClothingLine) and the figure (npcFigure) both read it, so the words and the body agree.
//
// The server tells this module the outdoor temperature once a minute (environment.js tick1m). Until it does,
// and in anything that never calls it (the gates, the Room Lab), nobody changes.

let heat = 0; // 0 normal, 1 warm, 2 hot
// the degrees where a coat comes off and goes back on; apart, so a day hovering on one figure doesn't flicker
const WARM_ON = 20, WARM_OFF = 17, HOT_ON = 26, HOT_OFF = 23;

export function setOutdoorTemp(c) {
  if (c == null || !Number.isFinite(c)) return;
  if (heat === 0 && c >= WARM_ON) heat = 1;
  else if (heat > 0 && c < WARM_OFF) heat = 0;
  if (heat === 1 && c >= HOT_ON) heat = 2;
  else if (heat === 2 && c < HOT_OFF) heat = 1;
}
export const weatherHeat = () => heat;

// a layer you'd take off on a warm day: anything quilted, knitted or made for the cold
const BULKY = /\b(?:coat|overcoat|greatcoat|longcoat|trench|pea ?coat|duster|parka|anorak|puffer|quilted|padded|body-?warmer|gilet|fleece|jacket|windcheater|bomber|blazer|sweater|jumper|pullover|sweatshirt|hoodie|cardigan|guernsey|turtle ?neck|roll ?neck|polo ?neck|thermal|knit(?:ted)?|wool(?:len)?|flannel|scarf|muffler|snood|gloves|mittens|beanie|toque|bobble hat|poncho|cloak|cape|shawl|oilskin|raincoat|mac)\b/i;
// a layer that's the job, not the weather: it stays on however warm it is
const WORKWEAR = /\b(?:lab ?coat|apron|tabard|hi-?vis|smock|uniform|overalls|coveralls?|boiler ?suit|jump ?suit|chef'?s|scrubs|vestments?|cassock|robes?|armou?r|plate|kevlar|ballistic|tactical|holster|harness)\b/i;
const UNDER = /\b(?:bra|panties|knickers|briefs|boxers?|underwear|y-fronts|thong|sports bra)\b/i;
const TOP = /\b(?:shirt|t-?shirt|tee|tank ?top|singlet|vest top|cami(?:sole)?|blouse|top|polo|henley|dress|sundress|tunic|crop)\b/i;
const HEAVY_LEGS = /\b(?:trousers|slacks|jeans|chinos|khakis|cargos?|joggers|sweatpants|cords|corduroys?)\b/i;

// Light, close-fitting tops. Each names one garment, a colour and its cloth, so figure-text reads a cut off it.
export const SUMMER = {
  male: [
    'a fitted white T-shirt', 'a tight black T-shirt', 'a grey marl tee', 'a fitted navy polo shirt',
    'a white linen short-sleeved shirt', 'a faded red tank top', 'a sleeveless olive singlet', 'a slim teal T-shirt',
    'a cream linen shirt, sleeves rolled', 'a blue short-sleeved shirt', 'a fitted khaki polo shirt', 'a black vest top',
  ],
  female: [
    'a fitted white T-shirt', 'a black tank top', 'a cropped pink tee', 'a cream linen blouse',
    'a yellow cotton sundress', 'a blue camisole top', 'a fitted grey vest top', 'a sleeveless teal blouse',
    'a white linen shift dress', 'a tight red T-shirt', 'a green cotton sundress', 'a fitted navy polo shirt',
  ],
};
// for a hot day, in place of heavy trousers
const SUMMER_LEGS = {
  male: ['khaki cotton shorts', 'navy chino shorts', 'black cut-off shorts', 'grey bermudas', 'denim cut-offs'],
  female: ['denim cut-off shorts', 'a short black skirt', 'white linen shorts', 'a light floral skirt', 'khaki capris'],
};

// Swimwear, by the person's own hash, so they wear the same costume every trip. Cached on the beach state
// so the figure's cache (keyed on the array's text) doesn't churn.
const SWIM = {
  male: ['navy swim shorts', 'red swim shorts', 'black swim shorts', 'green board shorts', 'blue striped board shorts'],
  female: ['a black swimsuit', 'a red swimsuit', 'a navy bikini top and bikini bottoms', 'a yellow bikini top and bikini bottoms', 'a teal swimsuit'],
};
function beachLayers(npc) {
  const b = npc._beach;
  if (b._wear) return b._wear;
  const sex = npc.sex === 'female' ? 'female' : 'male', seed = hashOf(String(npc.id || npc.name || ''));
  const suit = SWIM[sex][seed % SWIM[sex].length];
  // the figure has no bare chest, so a man's costume is a vest over the shorts
  b._wear = sex === 'male' ? ['a white vest top', suit] : [suit];
  return b._wear;
}

function hashOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }

// The outfit an NPC is wearing today. Same array back when nothing changes, so callers can compare by identity.
export function summerLayers(npc, layers) {
  // down at the beach (plugins/beach): swimwear, whatever they came in
  if (npc?._beach && npc._beach.state !== 'walk' && !npc.flags?.stripper) return beachLayers(npc);
  if (!heat|| !Array.isArray(layers) || !layers.length) return layers;
  const fl = npc?.flags || {};
  if (fl.stripper || fl.dress_for_weather === false || npc?._clothingPeeled > 0) return layers;
  const seed = hashOf(String(npc?.id || npc?.name || ''));
  // one in six keeps their coat on whatever the weather: the city has its own sort
  if (seed % 6 === 0) return layers;
  const sex = npc?.sex === 'female' ? 'female' : 'male';
  const kept = layers.filter((l) => WORKWEAR.test(l) || !BULKY.test(l) || UNDER.test(l));
  let out = kept;
  if (kept.length !== layers.length && !kept.some((l) => TOP.test(l) && !UNDER.test(l))) {
    const top = SUMMER[sex][seed % SUMMER[sex].length];
    // the light top goes where the first bulky layer was, over whatever was kept under it
    const at = layers.findIndex((l) => !kept.includes(l));
    const before = layers.slice(0, at).filter((l) => kept.includes(l));
    out = [...before, top, ...kept.slice(before.length)];
  }
  // a dress needs nothing on the legs; on a hot day half swap heavy trousers for something short
  const dressed = out.some((l) => /\b(?:sundress|dress)\b/i.test(l) && !UNDER.test(l));
  if (dressed || (heat >= 2 && (seed >>> 8) % 2 === 0)) {
    const i = out.findIndex((l) => HEAVY_LEGS.test(l) && !WORKWEAR.test(l));
    if (i >= 0) {
      // only the trousers' own clause changes: "canvas cargos, a bra and briefs" keeps the underwear,
      // "black work trousers and steel-capped boots" keeps the boots
      const m = out[i].match(/^(.*?)(,\s*|\s+(?:and|with)\s+)(.*)$/);
      const head = m && HEAVY_LEGS.test(m[1]) ? m[1] : out[i], rest = head === out[i] ? '' : m[3];
      const legs = SUMMER_LEGS[sex][(seed >>> 12) % SUMMER_LEGS[sex].length];
      const line = dressed ? rest : rest ? `${legs}${m[2]}${rest}` : legs;
      out = line ? out.map((l, j) => (j === i ? line : l)) : out.filter((_, j) => j !== i);
    }
  }
  return out.length === layers.length && out.every((l, j) => l === layers[j]) ? layers : out;
}
