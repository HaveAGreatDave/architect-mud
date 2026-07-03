/**
 * Vendor buy reactions — a short, in-character line the shopkeeper throws at the
 * player when a purchase lands (or bounces for lack of credits). Deliberately a
 * mixed bag: some warm, some amused, some openly annoyed, all in the HellMOO
 * register (brutal and funny). Appended to the buy result message so it surfaces
 * both in the text `buy` line and in the GUI shop panel's result banner.
 *
 * `outcome` is 'success' (paid) or 'poor' (couldn't afford it).
 */

const SUCCESS = [
  n => `${n} makes your credits vanish with a satisfied grunt. "Pleasure."`,
  n => `${n} slides it across. "Enjoy it. Or don't. Not my problem anymore."`,
  n => `${n} pockets the payment and almost smiles. "Good doing business."`,
  n => `${n} counts your credits twice, just to be sure, then nods. "We're square."`,
  n => `${n} snorts. "Look at you, spending like you'll live long enough to regret it."`,
  n => `${n} flashes a grin missing a tooth or two. "Come back when your wallet's fat again."`,
  n => `${n} wraps it without a word, then winks. "Tell your friends. Actually — don't. I hate a crowd."`,
];

const POOR = [
  n => `${n} looks at your balance, then at you, and laughs. "Come back when you can afford to breathe in here."`,
  n => `${n} yanks it back out of reach. "Credits first. This isn't a soup kitchen."`,
  n => `${n} rolls their eyes so hard you can hear it. "Broke. Figures."`,
  n => `${n} taps the counter twice. "Cute. Now show me the real money."`,
  n => `${n} sighs like you've personally aged them a year. "Window-shopping's free. This isn't."`,
  n => `${n} smirks. "Bold move, strolling in here with pocket lint and big dreams."`,
  n => `${n} waves you off. "No credits, no goods. Try the gutter, it's cheaper."`,
];

// Pick a reaction line for the given outcome. Returns a plain third-person
// string (no leading/trailing whitespace); callers decide how to attach it.
export function vendorBuyReaction(npc, outcome) {
  const name = npc?.name || 'The vendor';
  const pool = outcome === 'success' ? SUCCESS : POOR;
  return pool[Math.floor(Math.random() * pool.length)](name);
}
