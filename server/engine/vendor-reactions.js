/**
 * Vendor buy reactions — a short, in-character line the shopkeeper throws at the
 * player when a purchase lands (or bounces for lack of credits). Deliberately a
 * mixed bag: some warm, some amused, some openly annoyed, all in the HellMOO
 * register (brutal and funny). Appended to the buy result message so it surfaces
 * both in the text `buy` line and in the GUI shop panel's result banner.
 *
 * `outcome` is 'success' (paid) or 'poor' (couldn't afford it).
 *
 * Lines are `(name, p) => string`, where `p` is the vendor's pronouns. Only two
 * of them need it today, but the parameter is on every line so the next author
 * doesn't have to notice the distinction exists — "rolls their eyes" was written
 * about a woman for as long as this file has existed, because nothing in the
 * signature suggested there was a choice to make.
 */

// The vendor's own pronouns. `sex` is authored 'male'/'female' on the NPC row;
// anything else (unset, or a value this doesn't know) stays they/them, which is
// both the right default and what every line used to say unconditionally.
function pronounsFor(npc) {
  if (npc?.sex === 'female') return { subj: 'she', obj: 'her', poss: 'her' };
  if (npc?.sex === 'male') return { subj: 'he', obj: 'him', poss: 'his' };
  return { subj: 'they', obj: 'them', poss: 'their' };
}

const SUCCESS = [
  (n, p) => `${n} makes your credits vanish with a satisfied grunt. "Pleasure."`,
  (n, p) => `${n} slides it across. "Enjoy it. Or don't. Not my problem anymore."`,
  (n, p) => `${n} pockets the payment and almost smiles. "Good doing business."`,
  (n, p) => `${n} counts your credits twice, just to be sure, then nods. "We're square."`,
  (n, p) => `${n} snorts. "Look at you, spending like you'll live long enough to regret it."`,
  (n, p) => `${n} flashes a grin missing a tooth or two. "Come back when your wallet's fat again."`,
  (n, p) => `${n} wraps it without a word, then winks. "Tell your friends. Actually — don't. I hate a crowd."`,
];

const POOR = [
  (n, p) => `${n} looks at your balance, then at you, and laughs. "Come back when you can afford to breathe in here."`,
  (n, p) => `${n} yanks it back out of reach. "Credits first. This isn't a soup kitchen."`,
  (n, p) => `${n} rolls ${p.poss} eyes so hard you can hear it. "Broke. Figures."`,
  (n, p) => `${n} taps the counter twice. "Cute. Now show me the real money."`,
  (n, p) => `${n} sighs like you've personally aged ${p.obj} a year. "Window-shopping's free. This isn't."`,
  (n, p) => `${n} smirks. "Bold move, strolling in here with pocket lint and big dreams."`,
  (n, p) => `${n} waves you off. "No credits, no goods. Try the gutter, it's cheaper."`,
];

// Pick a reaction line for the given outcome. Returns a plain third-person
// string (no leading/trailing whitespace); callers decide how to attach it.
export function vendorBuyReaction(npc, outcome) {
  const name = npc?.name || 'The vendor';
  const pool = outcome === 'success' ? SUCCESS : POOR;
  return pool[Math.floor(Math.random() * pool.length)](name, pronounsFor(npc));
}
