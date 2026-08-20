// THE LONG HAUL — the market.
//
// The difference between a delivery game and a TRADE game: contracts pay you a fixed fee to move
// somebody else's box, but a market lets you spend your own money on a guess. `haul` is wages.
// This is enterprise, and it is the only part of the system where you can end a run poorer than
// you started it.
//
// PRICES ARE DERIVED, NEVER STORED. A price is a pure function of (commodity, region, game-day):
// no table, no tick, no DB row, and no way for a restart to reroll the market under somebody
// mid-run. That is the same discipline the cleaning plugin's stateless 7-day cadence uses and the
// same reason the freight board seeds on (depot, day) — a market that ticks is a market that needs
// persistence, a scheduler, and a story about what happens while nobody is logged in.
//
// THE TWO-WAY TRADE IS THE WHOLE DESIGN. Regional character is set so that the profitable cargo
// OUT is never the profitable cargo BACK: Coldwater makes things and sits on a basin, so parts,
// chems and water are cheap there and scrap is dear; the Reach is drowning in salvage and has no
// water, no clinic and no factory. Run parts and water out, bring baled alloy home. An empty
// backhaul is a mistake you can make, not a shape the game forces on you.

const DAY_MS = 86400000;

// Weight is what makes a trailer a constraint rather than a wallet. Medical stock is light and
// dear (you can carry a fortune in it); water is heavy and cheap (a full trailer of it is a lot of
// diesel for a modest margin). Those two ends are deliberate — they are the whole reason `kg`
// exists as a number the player has to think about.
export const COMMODITIES = {
  scrap:   { name: 'baled alloy',      kg: 90,  base: 34 },
  water:   { name: 'potable water',    kg: 100, base: 28 },
  protein: { name: 'protein slurry',   kg: 60,  base: 52 },
  chems:   { name: 'industrial chems', kg: 55,  base: 96 },
  parts:   { name: 'machine parts',    kg: 50,  base: 118 },
  medical: { name: 'medical stock',    kg: 35,  base: 210 },
};

// What a region IS, expressed as what it charges. Below 1 means the place produces it (buy here);
// above 1 means it wants it (sell here). Read down a column and you get the region's character;
// read across a row and you get a trade route.
//
// THE MULTIPLIERS ARE KEPT DELIBERATELY UNIFORM — roughly 0.78 producing, 1.28 consuming, for
// every commodity. That is not laziness, it is the balance: it makes the RETURN a near-constant
// ~30% and lets CAPITAL be the only thing that separates the goods. A full trailer of water costs
// about 800₵ and clears 250; a full trailer of medical costs about 19,000 and clears 6,000. Same
// trade, different rung, and the ladder is what you climb rather than a lookup table you memorise.
//
// The first cut had spreads from 0.60 to 1.85, tuned "by character". It produced a market where
// medical stock returned 10,500₵ a load against 731₵ for the best backhaul, and where potable
// water — a commodity chosen to be the cheap boring one — returned 150% because it was dirt in
// Coldwater and gold in the Reach. Wide spreads read as flavour and play as a single correct answer.
//
// THE ASYMMETRY THAT MATTERS is which way each good runs, not how far. Coldwater makes things and
// sits on a basin: water, protein, parts, medical go OUT. The Reach is a salvage economy with a
// chemistry problem: baled alloy and industrial chems come BACK. So the return trip is never empty
// and the two directions never want the same box.
// DEADWATER is a machine shop sitting on a reservoir, and its profile is read straight off that.
// It MAKES parts and it STRIPS scrap, so both go out cheap. It is sitting on the head of the
// Basin's water, so water is cheap too, which is the one place the geography rather than the trade
// sets a number. Nothing grows on graded gravel and nobody here refines anything, so protein,
// chems and medical all come in dear.
//
// Note what that does to the map, because it was not designed in and is the better half of it: the
// Coldwater run and the Reach run trade DIFFERENT BOXES. Coldwater wants scrap (1.28) and sells
// medical and protein cheap, so that corridor is salvage out and food and medicine back. The Reach
// wants parts (1.30) and sells chems cheap (0.78), so THAT corridor is machined parts out and drums
// back. One region, two live routes, and neither of them is the other one with the labels changed.
// Exported so the suite can hold every DEPOT region to having a row here — see the market block in
// regress.js. Terminus and the Scarletwastes each had a depot, a yard and a working board for
// months while falling through to PAR, which neither throws nor looks wrong: the prices are
// plausible and the trades clear. The only symptom is a place with no character to learn, which is
// invisible unless you go looking for it.
export const REGIONS = {
  region_coldwater: { scrap: 1.28, water: 0.80, protein: 0.82, chems: 1.24, parts: 0.76, medical: 0.84 },
  region_the_reach: { scrap: 0.76, water: 1.30, protein: 1.26, chems: 0.78, parts: 1.30, medical: 1.28 },
  region_deadwater:  { scrap: 0.74, water: 0.82, protein: 1.24, chems: 1.32, parts: 0.70, medical: 1.30 },
  // TERMINUS IS BUILDING SOMETHING, and every number here is read off that one fact. The Exodus
  // compound exists to leave, so it eats the two goods a fabrication effort eats — machine parts
  // and feedstock alloy — and it is provisioning a population that intends to depart, which is what
  // makes medical dear in a place with no sickness problem. It sits on redrock at 0.88 dryness and
  // has no basin, so water is the dearest thing on the board.
  //
  // What it SELLS is the exhaust of the same work, which is the half that had to be got right: a
  // region that only consumes is a dead end you deadhead home from. They crack their own propellant
  // chemistry in bulk, so industrial chems come off that line cheap, and a compound that has to feed
  // itself behind a wall for years runs vats rather than fields, so protein does too.
  //
  // Note the pairing it completes without being designed for it: Coldwater already sells parts at
  // 0.76 and already wants chems at 1.24. Parts out, drums back — the east limb is a live two-way
  // route the day this row lands, using only numbers that were already on the board.
  region_terminus:   { scrap: 1.26, water: 1.30, protein: 0.80, chems: 0.76, parts: 1.28, medical: 1.24 },
  // THE THORNWARREN GROWS THINGS AND MACHINES NOTHING. The wall is grown rather than built, which is
  // the whole region in one detail: there is no shop, no refinery and no line, so parts and chems
  // are the dearest goods here and there is nothing they can do about it locally. The water is
  // poisoned — the pool is the point — so that comes in too, and acid rain over redrock means the
  // domestic interior is fed rather than farmed.
  //
  // It sells the two things the Wildblood genuinely have. MEDICAL is the cheapest on any board in
  // the game, because this is where mutation is understood and treated and everywhere else is
  // guessing; that makes a run out of here the highest-capital route on the map, which is the right
  // shape for the region you reach last. And the trophy road is a road through picked-over waste
  // nobody here has a use for, so baled alloy goes out cheap into Coldwater's 1.28.
  //
  // ⚠ NOTHING IN THIS ROW PRICES THE HORROR. The approach is a performance and the inside is
  // domestic, and a market that charged outsiders a fear premium would be the region remarking on
  // its own tell. They trade like a town, because they are one.
  region_scarletwastes: { scrap: 0.78, water: 1.28, protein: 1.22, chems: 1.30, parts: 1.32, medical: 0.74 },
};
// An unknown region trades at par rather than crashing — new content should never break the market.
const PAR = { scrap: 1, water: 1, protein: 1, chems: 1, parts: 1, medical: 1 };

// The spread between buying and selling: a depot buys off you for less than it sells to you, which
// is what stops you from making money by driving in a circle without ever leaving town.
const MARGIN = 0.12;

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function marketDay(now = Date.now()) { return Math.floor(now / DAY_MS); }

// The mid price for one unit, before the buy/sell spread. Daily drift is ±18%, which is enough
// that a route you know is still worth checking and not so much that the regional character —
// the thing you actually learn — gets drowned out by noise.
export function midPrice(commodity, regionId, day = marketDay()) {
  const c = COMMODITIES[commodity];
  if (!c) return 0;
  const mult = (REGIONS[regionId] || PAR)[commodity] ?? 1;
  const drift = 0.82 + mulberry32(hashSeed(`${commodity}|${regionId}|${day}`))() * 0.36;
  return Math.max(1, Math.round(c.base * mult * drift));
}
// What you PAY here, and what you are PAID here.
export function askPrice(commodity, regionId, day) { return Math.max(1, Math.round(midPrice(commodity, regionId, day) * (1 + MARGIN))); }
export function bidPrice(commodity, regionId, day) { return Math.max(1, Math.round(midPrice(commodity, regionId, day) * (1 - MARGIN))); }

// The whole local board, in display order — dearest first, because what a place WANTS is the more
// interesting half of a market you have just driven into.
export function quotesFor(regionId, day = marketDay()) {
  return Object.keys(COMMODITIES)
    .map((k) => ({
      key: k, name: COMMODITIES[k].name, kg: COMMODITIES[k].kg,
      ask: askPrice(k, regionId, day), bid: bidPrice(k, regionId, day),
    }))
    .sort((a, b) => b.bid - a.bid);
}

// What a trailer holds. This is PER TRUCK (`type.kg`) — it is half of what a truck IS, and the
// reason a bigger one is worth 31,000₵. The default is the mid-range Drayman's deck so a caller
// with no truck in hand still gets a sane number to quote.
export const DEFAULT_TRAILER_KG = 3500;
export const capacityFor = (commodity, trailerKg = DEFAULT_TRAILER_KG) =>
  Math.floor(trailerKg / (COMMODITIES[commodity]?.kg || 1));
