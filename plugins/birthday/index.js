// BIRTHDAY — the date your account was created, treated as the date you began.
//
// DERIVED, NEVER STORED. The birthday is computed from `players.created_at` at
// the moment it is asked for. There is no birthday column, no birthday flag, and
// therefore nothing to backfill for existing players and nothing that can drift
// out of step with the account it belongs to. Every player already has one and
// always has had; nobody has been told.
//
// HIDDEN BY DEFAULT, deliberately. It is on no sheet, in no panel, and in no
// examine. `birthday` is the only thing that will tell you, which is what makes
// it worth typing — and it means anything built on top of this later (a card, an
// NPC who remembers, a discount) gets to be the one that reveals it.
//
// REAL CALENDAR, not the game one. The game clock is accelerated, so a game-year
// birthday would come round every few days and stop meaning anything. This is the
// anniversary of a real date on a real calendar, which is also the only reading
// of "the date your account was created" that is actually true.
import { query } from '../../server/models/db.js';
import { getFlag, setFlags } from '../../server/engine/flags.js';
import { dispatchAction } from '../../server/engine/actions.js';

const GIFT = 'item_soylent_manyhappy';
const CLAIM_FLAG = 'birthday_gift_year';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th';
  return `${n}${s}`;
};

// Leap-day accounts would otherwise go three years in four without a birthday,
// which is a cute bug the first time and a bad one every time after. A 29th of
// February instance keeps its date on the sheet and celebrates on the 1st of
// March in a year that hasn't got one.
function isTodayTheDay(born, now) {
  const bm = born.getMonth(), bd = born.getDate();
  if (now.getMonth() === bm && now.getDate() === bd) return true;
  if (bm !== 1 || bd !== 29) return false;
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return !leap(now.getFullYear()) && now.getMonth() === 2 && now.getDate() === 1;
}

function daysUntil(born, now) {
  const y = now.getFullYear();
  let next = new Date(y, born.getMonth(), born.getDate());
  // Normalise a 29 Feb into the same day this year's calendar actually has.
  if (next.getMonth() !== born.getMonth()) next = new Date(y, 2, 1);
  if (next < new Date(y, now.getMonth(), now.getDate())) {
    next = new Date(y + 1, born.getMonth(), born.getDate());
    if (next.getMonth() !== born.getMonth()) next = new Date(y + 1, 2, 1);
  }
  return Math.round((next - new Date(y, now.getMonth(), now.getDate())) / 86400000);
}

async function cmdBirthday(args, raw, player, broadcast) {
  const { rows } = await query('SELECT created_at FROM players WHERE id=$1', [player.id]);
  const createdAt = rows[0]?.created_at;
  if (!createdAt) {
    // Every real account has one. A fake/regress player does not, and saying so
    // plainly beats printing the 1st of January 1970 at somebody.
    return { type: 'error', message: 'The registry has no creation date against you, which is its own kind of answer.' };
  }

  const born = new Date(Number(createdAt) * 1000);
  const now = new Date();
  const dateStr = `${ordinal(born.getDate())} of ${MONTHS[born.getMonth()]}`;
  const head = `<span class="text-dim">The registry has you down as commencing on the</span> <span style="color:var(--cyan)">${dateStr}</span><span class="text-dim">, ${born.getFullYear()}.</span>`;

  if (!isTodayTheDay(born, now)) {
    const d = daysUntil(born, now);
    return {
      type: 'output',
      message: `${head}\n<span class="text-dim">That is ${d === 1 ? 'tomorrow' : `${d} days from now`}. Nobody else is counting.</span>`,
    };
  }

  // It is the day. One pouch per calendar year, tracked in player_flags rather
  // than a column — the flag holds the YEAR it was claimed, so the check is a
  // comparison and not a reset anybody has to remember to run.
  const claimed = await getFlag('player', CLAIM_FLAG, player);
  if (String(claimed) === String(now.getFullYear())) {
    return {
      type: 'output',
      message: `${head}\n<span style="color:var(--yellow)">Today, in fact.</span> <span class="text-dim">You have already had your pouch. There is one, and you have had it.</span>`,
    };
  }

  // once:false on purpose — you should get this year's pouch whether or not last
  // year's is still rattling around in your bag.
  await dispatchAction({
    type: 'GRANT_ITEM',
    actor: player,
    params: { item_id: GIFT, quantity: 1, once: false },
    context: { broadcast },
  });
  await setFlags(player, { [CLAIM_FLAG]: String(now.getFullYear()) });

  return {
    type: 'output',
    message: `${head}\n<span style="color:var(--yellow)">Today, in fact.</span>\n\n`
      + `Somewhere a dispenser you are not standing near clunks anyway, and a bronze pouch you did not ask for is in your hands. `
      + `MANY HAPPY RETURNS. <span class="text-dim">Issued once annually per registered instance. Nobody signed it.</span>`,
  };
}

export const commands = { birthday: cmdBirthday };
