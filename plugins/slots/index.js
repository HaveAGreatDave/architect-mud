// SLOTS — one-armed-bandit furniture. A machine in the room carries
// `flags.slot_machine`; `spin [bet]` deducts the bet in credits, rolls three
// weighted reels, and pays out on matches. Fully data-driven so any slot
// furniture reuses it:
//   flags.slot_machine   marks the furniture as playable (required, truthy)
//   flags.slot_min       minimum bet in credits (optional, default 5)
//   flags.slot_max       maximum bet in credits (optional, default 100)
//   flags.slot_default   the bet a bare `spin` uses (optional, default slot_min)
//
// The Neon Vig floor is the first customer. House-favoured: long-run RTP is
// roughly three-quarters of the money fed in — the machine always eats.
import { adjustCredits } from '../../server/engine/economy.js';
import { getZoneFurniture } from '../../server/engine/world.js';

// ── Reel model ───────────────────────────────────────────────────────────────
// Six single-width glyphs so the reel window always aligns in a <pre>. `weight`
// is the symbol's share of each independent reel strip (rarer 7s = rarer jackpot).
const SYMBOLS = [
  { s: '7', weight: 1,  name: 'sevens'   },
  { s: '$', weight: 3,  name: 'coins'    },
  { s: '★', weight: 4,  name: 'stars'    },
  { s: '♦', weight: 6,  name: 'diamonds' },
  { s: '♣', weight: 8,  name: 'clubs'    },
  { s: '♠', weight: 8,  name: 'spades'   },
];
const TOTAL_WEIGHT = SYMBOLS.reduce((a, x) => a + x.weight, 0);

// Payout is a multiplier of the bet = total credits returned. Three of a kind
// pays by symbol; a rare high-symbol pair pays a small consolation.
const TRIPLE = { '7': 75, '$': 40, '★': 20, '♦': 12, '♣': 8, '♠': 8 };
const PAIR   = { '7': 6,  '$': 4,  '★': 3 }; // only the three high symbols pay a pair

function spinReel() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const sym of SYMBOLS) {
    if ((roll -= sym.weight) < 0) return sym.s;
  }
  return SYMBOLS[SYMBOLS.length - 1].s; // fp safety net
}

// Score a [a,b,c] reel result. Returns { mult, label, jackpot }.
function score(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    return { mult: TRIPLE[a], label: `THREE ${symName(a)}`, jackpot: a === '7' };
  }
  // Count each high symbol; pay the best-paying pair present.
  for (const sym of ['7', '$', '★']) {
    const n = reels.filter(r => r === sym).length;
    if (n === 2) return { mult: PAIR[sym], label: `pair of ${symName(sym)}`, jackpot: false };
  }
  return { mult: 0, label: null, jackpot: false };
}

function symName(s) {
  return SYMBOLS.find(x => x.s === s)?.name || s;
}

// ── ASCII reel window ────────────────────────────────────────────────────────
const IN = 15; // inner width between the ║ walls

function center(str, width = IN) {
  const s = String(str);
  const pad = Math.max(0, width - visibleLen(s));
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + s + ' '.repeat(pad - left);
}
// The glyphs are single-column, but count them plainly (no HTML in the box).
function visibleLen(s) { return [...s].length; }

function renderMachine(machineName, reels, result, bet, winnings, balance) {
  const reelLine = `${reels[0]}     ${reels[1]}     ${reels[2]}`; // spaced trio
  const verdict = result.mult
    ? (result.jackpot ? '★ JACKPOT ★' : 'WINNER')
    : '— no luck —';
  const box = [
    '╔═════════════════╗',
    `║ ${center('THE  NEON  VIG')} ║`,
    '╠═════════════════╣',
    `║ ${center('')} ║`,
    `║ ${center(reelLine)} ║`,
    `║ ${center('')} ║`,
    '╠═════════════════╣',
    `║ ${center(verdict)} ║`,
    '╠═════════════════╣',
    `║ ${center('▸ PULL AGAIN ◂')} ║`,
    '╚═════════════════╝',
  ].join('\n');

  const y = (s) => `<span style="color:var(--yellow)">${s}</span>`;
  const g = (s) => `<span style="color:var(--green,#6f6)">${s}</span>`;
  const r = (s) => `<span style="color:var(--red,#f66)">${s}</span>`;
  const tail = result.mult
    ? `${g(`${result.label} pays ×${result.mult}`)} — you rake in ${g(`₵ ${winnings.toLocaleString()}`)}.`
    : `${r('The reels settle wrong.')} The ${machineName} keeps your ₵ ${bet}.`;

  // The whole reel window is clickable — click to pull again for the same bet.
  const lever = `<span class="action-link slot-pull" data-action="cmd" data-cmd="spin ${bet}" data-label="spin ${bet}" title="Pull the ${machineName} again for ₵ ${bet}"><pre>${box}</pre></span>`;

  return `${lever}${tail}<br><span class="text-dim">bet ₵ ${bet}  ·  balance ${y(`₵ ${balance.toLocaleString()}`)}</span>`;
}

// ── Command ──────────────────────────────────────────────────────────────────
async function cmdSpin(args, raw, player, broadcast) {
  const machine = getZoneFurniture(player.current_zone).find(f => f.flags?.slot_machine);
  if (!machine) return { type: 'error', message: "There's no slot machine here to play." };

  const min = Math.max(1, Number(machine.flags?.slot_min ?? 5));
  const max = Math.max(min, Number(machine.flags?.slot_max ?? 100));
  const def = Math.min(max, Math.max(min, Number(machine.flags?.slot_default ?? min)));

  // The only numeric token is the bet; ignore stray words so `spin the slots`
  // and `spin 25` both work.
  const betTok = args.map(a => parseInt(a, 10)).find(n => Number.isFinite(n));
  const bet = betTok == null ? def : betTok;
  if (!Number.isFinite(bet) || bet < min) return { type: 'error', message: `Minimum bet is ₵ ${min}. Try: spin ${def}` };
  if (bet > max) return { type: 'error', message: `Table max is ₵ ${max} a pull.` };

  // Take the money first — the guarded debit is the affordability check.
  const paid = await adjustCredits(player, -bet, undefined, 'slots:bet');
  if (!paid) return { type: 'error', message: `You don't have ₵ ${bet} on hand.` };

  const reels = [spinReel(), spinReel(), spinReel()];
  const result = score(reels);
  const winnings = result.mult ? bet * result.mult : 0;
  if (winnings) await adjustCredits(player, winnings, undefined, 'slots:win');

  // Liveliness — a big win lights up the whole floor.
  if (result.jackpot) {
    broadcast(player.current_zone, { type: 'zone_event', message: `The ${machine.name} erupts — bells, sirens, a column of light. ${player.handle} just hit the ${result.label.toLowerCase()} for ₵ ${winnings.toLocaleString()}!` }, player.id);
  } else if (result.mult >= 12) {
    broadcast(player.current_zone, { type: 'zone_event', message: `Coins clatter into the tray as ${player.handle}'s machine pays out.` }, player.id);
  }

  return { type: 'output', message: renderMachine(machine.name, reels, result, bet, winnings, player.credits) };
}

export const commands = { spin: cmdSpin, slots: cmdSpin };
