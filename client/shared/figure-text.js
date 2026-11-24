// What an NPC's own words say they look like, as close-up figure keys (docs/flags-keys.md `figure`).
//
// Most NPCs have no settled `flags.figure`, only a description and an outfit (`flags.clothing_layers`,
// outermost first). Without this the figure rolled its clothes, hair and build off the id, so a man written
// in a red sweater walked about in a blue coat. `figureFromText` reads the outfit and the description for
// what they name (the outer garment and its colour and cloth, the legs, the shoes, a hat, a scarf, glasses,
// the hair's colour, a beard, a big or thin build, a tall or short one) and returns only those keys, with
// `text: 1` so the client still rolls whatever the words leave out (gl/room-people.js lookOf). An authored
// `flags.figure` stands alone, as it always did; one that carries `text: 1` goes over the words key by key.
//
// Pure and sync; the server keeps one per NPC per text (npcFigure's cache), so every screen gets the same
// object and the same person is dressed alike in the room, on the street and on the TV.

import { summerLayers } from './summer-wear.js';

const COLOURS = [
  [/\bhi-?vis\b|\bfluorescent\b|\bsafety[- ]yellow\b/, [222, 232, 40]],
  [/\bcrimson\b|\bscarlet\b|\bblood[- ]red\b/, [160, 22, 30]],
  [/\bmaroon\b|\bburgundy\b|\boxblood\b|\bwine\b/, [104, 26, 36]],
  [/\brust\b|\brusty\b/, [150, 72, 38]],
  [/\bred\b/, [168, 36, 34]],
  [/\borange\b/, [214, 108, 32]],
  [/\bmustard\b/, [196, 156, 40]],
  [/\byellow\b/, [222, 190, 50]],
  [/\bolive\b|\barmy[- ]green\b/, [92, 98, 52]],
  [/\bteal\b/, [30, 112, 116]],
  [/\bgreen\b/, [52, 110, 60]],
  [/\bkhaki\b/, [168, 152, 108]],
  [/\bnavy\b/, [30, 38, 72]],
  [/\bcobalt\b/, [36, 70, 160]],
  [/\bblue\b/, [48, 82, 150]],
  [/\bpurple\b|\bviolet\b|\bplum\b/, [96, 48, 120]],
  [/\bpink\b/, [222, 128, 160]],
  [/\bcharcoal\b/, [52, 54, 58]],
  [/\bgr[ae]y\b|\bslate\b/, [118, 120, 124]],
  [/\bsilver\b/, [176, 180, 186]],
  [/\bblack\b/, [24, 24, 28]],
  [/\bcream\b|\bivory\b|\boff-white\b/, [228, 218, 192]],
  [/\bwhite\b/, [232, 232, 228]],
  [/\bbeige\b|\btan\b|\bcamel\b|\bbuff\b/, [184, 156, 116]],
  [/\bbrown\b|\bchocolate\b|\bumber\b/, [98, 66, 42]],
];
const colourIn = (s) => { for (const [re, rgb] of COLOURS) if (re.test(s)) return rgb; return null; };

// the outer garment's cut (figure.js FIGURE_CUTS), most specific first
const CUTS = [
  [/\blab ?coat\b/, 'labcoat'], [/\btrench ?coat\b|\btrench\b/, 'trench'], [/\bpea ?coat\b/, 'peacoat'], [/\bover ?coat\b|\bgreatcoat\b/, 'overcoat'],
  [/\bduster\b/, 'duster'], [/\bparka\b|\banorak\b/, 'parka'], [/\braincoat\b|\bmac\b|\bslicker\b|\boilskin\b/, 'mac'],
  [/\bbomber\b|\bflight jacket\b/, 'bomber'], [/\bblazer\b|\bsport ?s? ?coat\b/, 'blazer'], [/\bsuit\b(?! of)/, 'suit'],
  [/\bbody-?warmer\b|\bgilet\b|\bpuffer vest\b|\bquilted vest\b|\bpadded vest\b|\bsleeveless (?:quilted |padded )?jacket\b/, 'gilet'],
  [/\bhi-?vis\b|\btabard\b|\bwork ?vest\b|\bsafety vest\b/, 'workvest'],
  [/\bcoveralls?\b|\boveralls\b|\bjump ?suit\b|\bboiler ?suit\b|\bfreezer suit\b|\bflight ?suit\b/, 'coverall'],
  [/\bjacket\b|\bwindcheater\b|\bwindbreaker\b/, 'jacket'], [/\bcoat\b/, 'coat'],
  [/\bcassock\b|\bvestments?\b/, 'cassock'], [/\brobes?\b|\bdressing gown\b|\bhousecoat\b|\bkimono\b/, 'robe'], [/\bponcho\b|\bcloak\b|\bcape\b|\bshawl\b/, 'poncho'],
  [/\buniform\b/, 'uniform'], [/\bjersey\b/, 'jersey'],
  [/\bball ?gown\b|\bevening gown\b|\bgown\b/, 'gown'], [/\bmaxi\b/, 'maxi'], [/\bsundress\b|\bshift dress\b|\bshift\b/, 'shift'], [/\bknit(?:ted)? dress\b|\bsweater dress\b/, 'knitdress'], [/\bdress\b|\bfrock\b/, 'dress'],
  [/\btunic\b|\bsmock\b/, 'tunic'], [/\bhoodie\b|\bhooded (?:top|sweat)/, 'hoodie'], [/\bturtle ?neck\b|\broll ?neck\b|\bpolo ?neck\b/, 'turtleneck'],
  [/\bcardigan\b/, 'cardigan'], [/\bsweater\b|\bjumper\b|\bpullover\b|\bsweatshirt\b|\bguernsey\b|\bfisherman'?s knit\b/, 'sweater'],
  [/\bflannel\b|\bplaid shirt\b|\bcheck(?:ed)? shirt\b|\blumberjack\b/, 'flannel'], [/\bwaistcoat\b/, 'vest'],
  [/\bswimsuit\b|\bbikini top\b|\btank ?top\b|\bsinglet\b|\bvest top\b|\bcami(?:sole)?\b/, 'tank'], [/\bt-?shirt\b|\btee\b/, 'tee'], [/\bpolo shirt\b|\bshort-?sleeved shirt\b/, 'shortsleeve'],
  [/\bsleeves? rolled\b|\brolled sleeves\b|\bsleeves pushed up\b/, 'rolled'], [/\bthermal\b|\blong-?sleeved?\b|\bhenley\b/, 'longsleeve'], [/\bshirt\b|\bblouse\b/, 'oxford'],
];
// the garment's cloth (figure.js FIG_FABRIC)
const FABRICS = [
  [/\bleather\b|\bsuede\b|\bhide\b/, 'leather'], [/\bdenim\b|\bjeans?\b/, 'denim'], [/\bcanvas\b|\bduck\b|\bwaxed\b/, 'canvas'],
  [/\bquilted\b|\bpadded\b|\bpuffer\b|\bdown\b/, 'quilt'], [/\bknit(?:ted)?\b|\bwool(?:len)?\b|\bcable\b|\bfisherman/, 'knit'],
  [/\bcord(?:uroy|s)?\b/, 'cord'], [/\bplaid\b|\btartan\b|\bcheck(?:ed)?\b|\bflannel\b/, 'plaid'], [/\bcamo(?:uflage)?\b/, 'camo'],
  [/\brubber(?:ised|ized)?\b|\boilskin\b|\bpvc\b|\bvinyl\b|\blatex\b/, 'rubber'], [/\brags?\b|\btattered\b|\bpatched\b|\bpatchwork\b|\bsacking\b|\bburlap\b/, 'rag'],
];
const fabricIn = (s) => { for (const [re, f] of FABRICS) if (re.test(s)) return f; return null; };
const LEGS = /\b(?:trousers|pants|slacks|jeans|chinos|khakis|cargos?|leggings|breeches|joggers|sweatpants|swimsuit|bikini bottoms|shorts|cut-?offs|bermudas?|capris?|skirt|kilt|dungarees|overalls)\b/;
const BOTTOMS = [[/\bcut-?offs\b|\bswimsuit\b|\bbikini bottoms\b/, 'cutoffs'], [/\bbermudas?\b/, 'bermudas'], [/\bshorts\b/, 'shorts'], [/\bcapris?\b|\bpedal pushers\b/, 'capris'],
  [/\bmini ?skirt\b|\bmini\b/, 'mini'], [/\bpencil skirt\b/, 'pencil'], [/\ba-line\b/, 'aline'], [/\b(?:long|maxi|ankle-length) skirt\b/, 'longskirt'], [/\bskirt\b|\bkilt\b/, 'midi']];
const SHOES = /\b(?:boots?|shoes|trainers|sneakers|brogues|loafers|sandals|heels|clogs|wellies|wellingtons|slippers|plimsolls|flip-?flops)\b/;
const HATS = [[/\bhard ?hat\b|\bsafety helmet\b/, 'hardhat'], [/\bflat ?cap\b/, 'flatcap'], [/\bbaseball cap\b|\bball ?cap\b|\btrucker cap\b/, 'ballcap'],
  [/\bfedora\b|\btrilby\b|\bhomburg\b|\bpork ?pie\b/, 'fedora'], [/\bbucket hat\b/, 'bucket'], [/\bbeanie\b|\bwatch cap\b|\bknit(?:ted)? cap\b|\bwool(?:len)? hat\b|\bbobble hat\b|\btoque\b/, 'beanie'], [/\bcap\b/, 'cap']];
const SCARVES = [[/\bbandana\b|\bneckerchief\b/, 'bandana'], [/\bsnood\b/, 'snood'], [/\bchunky scarf\b|\bknitted scarf\b/, 'chunky'], [/\bscarf\b|\bmuffler\b|\bcravat\b/, 'scarf']];
const firstOf = (list, s) => { for (const [re, v] of list) if (re.test(s)) return v; return null; };

// hair: a colour said of the hair, never a colour that only sits near the word
const HAIR = [
  [/\b(?:platinum|bleached|peroxide)\b/, [226, 214, 176]], [/\b(?:blonde?|fair-haired|flaxen|sandy)\b/, [196, 160, 96]],
  [/\b(?:ginger|redhead|red-haired|copper|carrot)\b|\bred hair\b/, [150, 64, 30]], [/\bauburn\b/, [112, 48, 30]],
  [/\b(?:white-haired|white hair|snow-white)\b/, [222, 220, 214]], [/\b(?:silver|grey|gray|greying|graying|grizzled|salt-and-pepper|iron-grey)\b(?=[^.]{0,30}\b(?:hair|beard|head|crop|ponytail|braid|plait)\b)|\b(?:grey|gray)-haired\b/, [150, 148, 144]],
  [/\b(?:black|jet|raven)(?:-haired| hair\b)|\bblack (?:braids|dreads|dreadlocks|ponytail|curls)\b/, [20, 18, 18]],
  [/\b(?:brunette|brown-haired|brown hair|dark-haired|dark hair|chestnut)\b/, [62, 40, 26]],
];
const HAIR_STYLES = [[/\bmohawk\b|\bmohican\b/, 9], [/\bafro\b/, 10], [/\bdread(?:s|locks)\b|\blocs\b/, 11], [/\bcornrows\b/, 12], [/\bundercut\b/, 13], [/\bpompadour\b|\bquiff\b/, 14],
  [/\bpixie\b/, 15], [/\bplaits\b|\bbraids\b/, 16], [/\btop ?knot\b/, 17], [/\bmullet\b/, 18], [/\bman ?bun\b/, 29], [/\bbun\b/, 8], [/\bponytail\b/, 7], [/\bbob\b/, 6],
  [/\bslicked(?:-| )back\b/, 22], [/\bcomb-?over\b/, 24], [/\bflat ?top\b/, 32], [/\bbuzz ?cut\b|\bcrew ?cut\b|\bcropped\b|\bshaved head\b|\bshaven head\b/, 1]];
const FACIAL = [[/\bwalrus\b/, 'walrus'], [/\bhandlebar\b|\bmoustache\b|\bmustache\b/, 'moustache'], [/\bgoatee\b/, 'goatee'], [/\bmutton ?chops?\b|\bsideburns\b/, 'mutton'],
  [/\b(?:long|bushy|wild|great|big) beard\b/, 'bushy'], [/\b(?:trimmed|neat|short) beard\b/, 'trimmed'], [/\bbeard(?:ed)?\b/, 'full'], [/\bstubble\b|\bunshaven\b|\bfive o'clock\b/, 'stubble'], [/\bclean-?shaven\b/, 'clean']];

// The outfit's layers as plain lower-case strings, outermost first, with the underwear dropped.
const UNDER = /\b(?:bra|panties|knickers|briefs|boxers?(?: shorts)?|underwear|underthings|smalls|y-fronts|thong)\b/;

export function figureFromText(description = '', layers = null, sex = '') {
  const desc = String(description || '').toLowerCase();
  const worn = (Array.isArray(layers) ? layers : []).map((l) => String(l || '').toLowerCase()).filter(Boolean);
  const out = {};
  // the outer garment: the outermost layer that names one, or what the description has them "in" or "wearing"
  const dressed = desc.match(/\b(?:in|wearing|wears|dressed in)\s+(?:an?\s+|the\s+|his\s+|her\s+|their\s+)?([^.;]{3,80})/g) || [];
  const tops = [...worn.filter((l) => !UNDER.test(l) || firstOf(CUTS, l.replace(UNDER, ''))), ...dressed];
  for (const l of tops) {
    const head = l.split(/\b(?:over|under|with|and)\b/)[0];
    const cut = firstOf(CUTS, head) || firstOf(CUTS, l);
    if (!cut) continue;
    // a dress or a gown is a woman's here: a man's word for one is usually a robe
    out.cut = /^(?:dress|gown|maxi|shift|knitdress)$/.test(cut) && sex === 'male' ? 'robe' : cut;
    const col = colourIn(head) || (cut === 'workvest' && /hi-?vis/.test(l) ? [222, 232, 40] : null);
    if (col) out.top = col;
    const fab = fabricIn(head);
    if (fab && fab !== 'denim') out.fabric_top = fab;
    else if (/\bdenim\b/.test(head)) out.fabric_top = 'denim';
    break;
  }
  // a work apron over it all: a half or bar apron ties at the waist, any other has a bib (figure.js apronParts)
  const apronL = worn.find((l) => /\bapron\b/.test(l));
  if (apronL) out.apron = /\b(?:half|waist|bar|cafe|café|server'?s)[- ]?apron\b/.test(apronL) ? 'waist' : 'bib';
  // the legs: the layer that names trousers or a skirt, then the description's
  const legLine = worn.find((l) => LEGS.test(l)) || (desc.match(new RegExp(`[^.,;]{0,40}${LEGS.source}`)) || [])[0];
  if (legLine) {
    const m = legLine.match(LEGS), before = legLine.slice(Math.max(0, m.index - 40), m.index + m[0].length);
    const bottoms = firstOf(BOTTOMS, before);
    if (bottoms) out.bottoms = bottoms;
    const col = colourIn(before.split(/\band\b/).pop());
    if (col) out.legs = col;
    else if (/\bjeans\b/.test(before)) out.legs = [52, 70, 110];
    else if (/\bkhakis\b|\bchinos\b/.test(before)) out.legs = [168, 152, 108];
    const fab = fabricIn(before.split(/\band\b/).pop());
    if (fab) out.fabric_legs = fab;
    else if (/\bjeans\b/.test(before)) out.fabric_legs = 'denim';
  }
  // the shoes
  const all = [...worn, desc].join(' . ');
  const sm = all.match(new RegExp(`([^.,;]{0,30})${SHOES.source}`));
  if (sm) {
    const col = colourIn(sm[1].split(/\band\b/).pop());
    if (col) out.shoes = col;
    if (/\bsteel-?(?:capped|toed?|toe)\b|\bsteel in the toes?\b|\bwork ?boots\b|\bsafety boots\b/.test(sm[0])) out.boots = 'steeltoe';
    else if (/\bsandals\b|\bheels\b/.test(sm[0]) && sex === 'female') out.boots = 'sandal';
    if (/\bleather\b/.test(sm[1])) out.fabric_shoes = 'leather';
    else if (/\brubber\b|\bwellies\b|\bwellingtons\b/.test(sm[0])) out.fabric_shoes = 'rubber';
  }
  // a hat, a scarf, glasses
  const hat = firstOf(HATS, all);
  if (hat) {
    out.hat = hat;
    const hm = all.match(/([^.,;]{0,24})\b(?:hard ?hat|cap|hat|beanie|fedora|trilby|toque|helmet)\b/);
    const col = hm && colourIn(hm[1]);
    if (col) out.hat_col = col;
  } else if (/\bbald\b|\bshaved head\b|\bshaven head\b|\bbareheaded\b/.test(desc)) out.hat = false;
  const scarf = firstOf(SCARVES, all);
  if (scarf) out.scarf = scarf;
  if (/\b(?:glasses|spectacles|specs|bifocals|pince-nez)\b/.test(all) && !/\bsun ?glasses\b|\bshot glass/.test(all)) out.glasses = [30, 32, 38];
  // the hair and the face, from the description only: an outfit doesn't say
  const hair = firstOf(HAIR, desc);
  if (hair) out.hair = hair;
  const style = firstOf(HAIR_STYLES, desc);
  if (style != null) out.hair_style = style;
  if (sex !== 'female') { const fac = firstOf(FACIAL, desc); if (fac) out.facial = fac; }
  // the build: a big or heavy body, a thin one; tall and short; old
  if (/\b(?:huge|enormous|massive|heavy-?set|heavyset|fat|obese|portly|stout|barrel-chested|big-bellied|paunch(?:y)?|built like)\b/.test(desc)) out.weight = 0.9;
  else if (/\b(?:big|broad|thickset|stocky|burly|beefy|hulking|solid)\b/.test(desc)) out.weight = 0.7;
  else if (/\b(?:gaunt|skeletal|emaciated|skin and bone|bony)\b/.test(desc)) out.weight = 0;
  else if (/\b(?:thin|skinny|wiry|lean|slight|slender|scrawny|willowy|rangy)\b/.test(desc)) out.weight = 0.2;
  if (/\b(?:very tall|towering|giant|huge man|huge woman)\b/.test(desc)) out.height = 1.95;
  else if (/\btall\b/.test(desc)) out.height = 1.87;
  else if (/\b(?:short|small|tiny|little|diminutive|squat)\s+(?:man|woman|person|fellow|figure|frame)\b|\b(?:very short|stunted)\b/.test(desc)) out.height = 1.6;
  if (/\b(?:elderly|old (?:man|woman)|aged|in (?:his|her|their) (?:sixties|seventies|eighties|nineties)|wizened|ancient)\b/.test(desc)) out.age = 0.85;
  else if (/\b(?:older|middle-aged|in (?:his|her|their) fifties|greying|graying|grizzled)\b/.test(desc)) out.age = 0.6;
  return Object.keys(out).length ? { text: 1, ...out } : null;
}

// What an NPC looks like on any screen: their own words, with anything authored in `flags.figure` over them.
// Kept per NPC until its text or its settled look changes, so the object (and gl/room-people.js's key off it)
// is stable.
const seen = new WeakMap();
export function npcFigure(npc) {
  if (!npc) return null;
  const fl = npc.flags || {}, own = fl.figure || null;
  // an authored look stands alone unless it asks for the words under it
  if (own && !own.text) return own;
  // what they've got on today: on a warm day the coats and sweaters come off (summer-wear.js)
  const layers = summerLayers(npc, fl.clothing_layers);
  const sig = (npc.description || '') + '|' + JSON.stringify(layers || null) + '|' + (npc.sex || '') + '|' + (own ? JSON.stringify(own) : '');
  const hit = seen.get(npc);
  if (hit && hit.sig === sig) return hit.fig;
  const words = figureFromText(npc.description, layers, npc.sex);
  const fig = words && own ? { ...words, ...own } : words || own;
  seen.set(npc, { sig, fig });
  return fig;
}
