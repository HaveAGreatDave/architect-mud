/**
 * Videostore — renting a tape off a wall, and being chased for it.
 *
 * The tapes already worked. `media_cassette` items carrying a `broadcast_id` have
 * loaded into decks since the broadcast system shipped, and two of them (SISTER
 * STEEL, THE METER READER) existed as ordinary loot. What did not exist was any
 * reason for a tape to come BACK, which is the entire reason a video shop is a
 * place in fiction and not just a vendor with a theme.
 *
 * THE RULE THAT SHAPES THIS: a rental is not a sale with extra steps. If tapes were
 * sold, the wall would empty once and the shop would be over. So the wall's stock is
 * FINITE AND SHARED — every copy out is a copy nobody else can have — and that is
 * the only scarcity the system has. It needs no other.
 *
 * Three deliberate decisions:
 *
 *  - **Nothing ticks and nothing accrues.** The late fee is derived on read from
 *    `today - due_day`, both of them game-day indices, exactly the way corp rackets
 *    derive `fearNow` and the way owned-room filth derives its sweep. A server that
 *    was off for a week owes nobody a catch-up pass, and there is no scheduled job
 *    walking every open rental at midnight. `feeFor()` is the whole clock.
 *
 *  - **The debt closes the wall, not the door.** Owing money does not lock you out
 *    of the shop, stop you buying comics, or make the NPC hostile — it stops the
 *    ONE transaction it is about. A system that punished you everywhere for a late
 *    tape would be a wanted level, and there is already one of those.
 *
 *  - **The item is an ordinary item.** A borrowed tape is a plain inventory row with
 *    no rental marker on it, so it drops, trades, gets stolen and gets looted like
 *    anything else — and the rental row survives all of that, because what the shop
 *    lent out was not this row, it was this TITLE, to you. Losing the tape does not
 *    cancel the debt. That is what the replacement charge is for.
 *
 * DB: one table (`tape_rentals`), written only on borrow / return / settle. No tick,
 * no boot load, no hot-path read — every verb here is a deliberate counter action.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { getItem } from '../../server/engine/items-cache.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import { gameDayIndex } from '../../server/engine/zone-filth.js';
import { teachVerb, sendToZone } from '../../server/engine/messaging.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// A week is the loan, because the game already thinks in weeks (rent, the deep
// clean) and because seven days is long enough that forgetting is a real thing a
// player does rather than a punishment for logging off.
export const LOAN_DAYS = 7;
// The fee to take one out at all. Small: the money is not the point, the tape is.
export const RENTAL_FEE = 20;
// Per game-day overdue. Deliberately steeper than the rental itself — three days
// late costs more than the loan did, which is the only thing that makes the due
// date mean anything.
export const LATE_FEE_PER_DAY = 15;
// What the shop charges when a tape simply never comes back. Not punitive; it is
// what a replacement print costs him, and he will say so.
export const REPLACEMENT_FEE = 120;
// Past this many days overdue the shop stops waiting and bills you for the print.
export const WRITE_OFF_DAYS = 21;

const today = () => gameDayIndex(getGameDateTime().date) ?? 0;

// ── The wall ────────────────────────────────────────────────────────────────
// A rental wall is furniture carrying `flags.tape_rental`. Its stock is
// `flags.tape_shelf`, a list of item ids — authored, never inferred, because "every
// beta cassette in the game" would put a shop's private stock on every wall the day
// somebody adds a tape somewhere else entirely.
const wallHere = (zoneId) => getZoneFurniture(zoneId).find(f => f.flags?.tape_rental);

const shelfOf = (wall) => {
  const s = wall?.flags?.tape_shelf;
  return Array.isArray(s) ? s.filter(x => typeof x === 'string') : [];
};

// ── Fees, derived ───────────────────────────────────────────────────────────
/**
 * What this open rental costs to settle right now. Pure arithmetic over two
 * integers — no query, no clock beyond the game date, and the same answer every
 * time it is asked on the same day. That property is the whole reason the dates
 * are stored as day indices rather than timestamps.
 */
export function feeFor(row, day = today()) {
  const over = Math.max(0, day - Number(row.due_day || 0));
  if (!over) return { over, fee: 0, writtenOff: false };
  if (over >= WRITE_OFF_DAYS) {
    return { over, fee: LATE_FEE_PER_DAY * WRITE_OFF_DAYS + REPLACEMENT_FEE, writtenOff: true };
  }
  return { over, fee: LATE_FEE_PER_DAY * over, writtenOff: false };
}

async function openRentals(playerId) {
  const { rows } = await query(
    'SELECT * FROM tape_rentals WHERE player_id=$1 AND returned_day IS NULL ORDER BY due_day',
    [playerId]
  );
  return rows;
}

async function debtOf(playerId) {
  const { rows } = await query(
    'SELECT COALESCE(SUM(debt),0)::int AS n FROM tape_rentals WHERE player_id=$1 AND debt > 0',
    [playerId]
  );
  return Number(rows[0]?.n || 0);
}

// Which titles on this wall are physically out — anybody's, not just yours. This is
// the shared-stock rule, and it is one grouped query rather than a loop.
async function outOnWall(furnitureId) {
  const { rows } = await query(
    'SELECT item_id, COUNT(*)::int AS n FROM tape_rentals WHERE furniture_id=$1 AND returned_day IS NULL GROUP BY item_id',
    [furnitureId]
  );
  return new Map(rows.map(r => [r.item_id, Number(r.n)]));
}

const titleOf = (itemId) => getItem(itemId)?.name || itemId;

// ── rentals ─────────────────────────────────────────────────────────────────
async function cmdRentals(args, raw, player) {
  const wall = wallHere(player.current_zone);
  if (!wall) return { type: 'error', message: `There's no rental wall here.` };

  const shelf = shelfOf(wall);
  const [out, mine, debt] = await Promise.all([
    outOnWall(wall.id), openRentals(player.id), debtOf(player.id),
  ]);
  const day = today();

  const lines = [`<b>${wall.name.toUpperCase()}</b>`, ''];

  if (!shelf.length) {
    lines.push(`<span class="text-dim">Every pigeonhole is empty. Somebody has cleared it out.</span>`);
  } else {
    for (const id of shelf) {
      const held = mine.find(r => r.item_id === id);
      const gone = out.get(id) || 0;
      if (held) {
        const { over, fee, writtenOff } = feeFor(held, day);
        const due = held.due_day - day;
        const state = writtenOff
          ? `<span class="warning">WRITTEN OFF — ₵${fee} to square it</span>`
          : over
            ? `<span class="warning">${over} day${over === 1 ? '' : 's'} overdue — ₵${fee}</span>`
            : `<span class="text-dim">due in ${due} day${due === 1 ? '' : 's'}</span>`;
        lines.push(`  <b>${titleOf(id)}</b> — <span class="success">yours</span>, ${state}`);
      } else if (gone) {
        lines.push(`  <span class="text-dim">${titleOf(id)} — out</span>`);
      } else {
        lines.push(`  <b>${titleOf(id)}</b> — in`);
      }
    }
  }

  lines.push('');
  if (debt) {
    lines.push(`<span class="warning">You owe ₵${debt}. The wall doesn't open for you until that's cleared — ${teachVerb('settle')}.</span>`);
  } else {
    lines.push(`<span class="text-dim">₵${RENTAL_FEE} for ${LOAN_DAYS} days. ₵${LATE_FEE_PER_DAY} a day after that.</span>`);
    lines.push(`<span class="text-dim">${teachVerb('borrow')} &lt;title&gt; to take one, ${teachVerb('returntape', 'returntape')} &lt;title&gt; to bring it back.</span>`);
  }
  return { type: 'output', message: lines.join('\n') };
}

// ── borrow ──────────────────────────────────────────────────────────────────
async function cmdBorrow(args, raw, player) {
  const wall = wallHere(player.current_zone);
  if (!wall) return { type: 'error', message: `There's no rental wall here.` };

  const want = (args || []).join(' ').trim();
  if (!want) return { type: 'error', message: `Borrow what? <span class="cmd">rentals</span> lists the wall.` };

  const debt = await debtOf(player.id);
  if (debt) {
    return { type: 'error', message: `<span class="warning">Not until you're square.</span> You owe ₵${debt} on a tape. <span class="cmd">settle</span> first.` };
  }

  const shelf = shelfOf(wall);
  const needle = want.toLowerCase();
  const id = shelf.find(x => titleOf(x).toLowerCase().includes(needle)) || shelf.find(x => x === want);
  if (!id) return { type: 'error', message: `Nothing on this wall called "${want}".` };

  const [out, mine] = await Promise.all([outOnWall(wall.id), openRentals(player.id)]);
  if (mine.some(r => r.item_id === id)) {
    return { type: 'error', message: `You already have <b>${titleOf(id)}</b> out. Bring it back first.` };
  }
  if (out.get(id)) {
    return { type: 'error', message: `<b>${titleOf(id)}</b> is out. The card in the slot has somebody else's name on it.` };
  }
  if ((player.credits || 0) < RENTAL_FEE) {
    return { type: 'error', message: `It's ₵${RENTAL_FEE} to take one out. You have ₵${player.credits || 0}.` };
  }

  const day = today();
  player.credits -= RENTAL_FEE;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query(
    'INSERT INTO tape_rentals (id, player_id, item_id, furniture_id, taken_day, due_day) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), player.id, id, wall.id, day, day + LOAN_DAYS]
  );
  await query('INSERT INTO player_inventory (id, player_id, item_id, quantity) VALUES ($1,$2,$3,1)',
    [randomUUID(), player.id, id]);

  sendToZone(player.current_zone, {
    type: 'zone_event',
    message: `A card goes into a slot on the tape wall with ${player.handle}'s name on it, in blunt pencil.`,
  }, player.id);

  return {
    type: 'output',
    refresh: true,
    message: `You slide <b>${titleOf(id)}</b> out of its pigeonhole. A card goes in where it was, your name on it and a date under it.\n`
      + `<span class="success">Due back in ${LOAN_DAYS} days.</span> <span class="text-dim">₵${RENTAL_FEE} gone, ₵${player.credits} left. `
      + `After that it's ₵${LATE_FEE_PER_DAY} a day, and he does not forget.</span>`,
  };
}

// ── returntape ──────────────────────────────────────────────────────────────
async function cmdReturn(args, raw, player) {
  const wall = wallHere(player.current_zone);
  if (!wall) return { type: 'error', message: `There's no rental wall here.` };

  const mine = await openRentals(player.id);
  if (!mine.length) return { type: 'error', message: `You haven't got anything out.` };

  const want = (args || []).join(' ').trim().toLowerCase();
  const row = want
    ? mine.find(r => titleOf(r.item_id).toLowerCase().includes(want) || r.item_id === want)
    : (mine.length === 1 ? mine[0] : null);
  if (!row) {
    return want
      ? { type: 'error', message: `You haven't got "${want}" out.` }
      : { type: 'error', message: `You've got ${mine.length} out. Which one?` };
  }

  // The tape has to actually be in your hands. A rental you lost is still a rental,
  // and it settles at the replacement price rather than quietly closing.
  const { rows: held } = await query(
    'SELECT id, quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL LIMIT 1',
    [player.id, row.item_id]
  );
  if (!held.length) {
    return { type: 'error', message: `You haven't got <b>${titleOf(row.item_id)}</b> on you. He'll want it, or he'll want ₵${REPLACEMENT_FEE} for the print.` };
  }

  const day = today();
  const { over, fee, writtenOff } = feeFor(row, day);
  const credits = player.credits || 0;
  const paid = Math.min(fee, credits);
  const shortfall = fee - paid;

  if (paid) {
    player.credits = credits - paid;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  }
  await query('UPDATE tape_rentals SET returned_day=$1, debt=$2 WHERE id=$3', [day, shortfall, row.id]);

  if ((held[0].quantity ?? 1) > 1) {
    await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [held[0].id]);
  } else {
    await query('DELETE FROM player_inventory WHERE id=$1', [held[0].id]);
  }

  let msg = `You put <b>${titleOf(row.item_id)}</b> back in its hole and the card comes out.`;
  if (!over) {
    msg += `\n<span class="success">On time. He checks the date, says nothing, and that is as close to praise as this gets.</span>`;
  } else if (writtenOff) {
    msg += `\n<span class="warning">${over} days.</span> "I had written that off," he says, not unkindly, and charges you for the print anyway. <b>₵${fee}</b>.`;
  } else {
    msg += `\n<span class="warning">${over} day${over === 1 ? '' : 's'} late.</span> He writes the number down before he says it. <b>₵${fee}</b>.`;
  }
  if (shortfall) {
    msg += `\n<span class="warning">You could only cover ₵${paid}. You owe ₵${shortfall}, and the wall is shut to you until you don't.</span>`;
  } else if (fee) {
    msg += ` <span class="text-dim">₵${player.credits} left.</span>`;
  }
  return { type: 'output', message: msg, refresh: true };
}

// ── settle ──────────────────────────────────────────────────────────────────
async function cmdSettle(args, raw, player) {
  const wall = wallHere(player.current_zone);
  if (!wall) return { type: 'error', message: `There's no rental wall here.` };

  const debt = await debtOf(player.id);
  if (!debt) return { type: 'output', message: `You're square. He checks anyway.` };
  if ((player.credits || 0) < debt) {
    return { type: 'error', message: `You owe ₵${debt} and you have ₵${player.credits || 0}. He waits, which is worse than being shouted at.` };
  }

  player.credits -= debt;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query('UPDATE tape_rentals SET debt=0 WHERE player_id=$1 AND debt > 0', [player.id]);

  return {
    type: 'output',
    refresh: true,
    message: `You pay the ₵${debt}. He rubs your name off the card with the side of a thumb and puts the card back in the box.\n`
      + `<span class="success">"Right. Don't do that again."</span> <span class="text-dim">₵${player.credits} left.</span>`,
  };
}

export const commands = {
  rentals: cmdRentals,
  borrow: cmdBorrow,
  returntape: cmdReturn,
  settle: cmdSettle,
};

// Declaration-only: nothing dispatches through these, they exist so examining a
// rental wall advertises the verbs. Without them the whole system is invisible to
// a player who never reads a plugin manifest.
export const specializedActions = [
  { verb: 'rentals',    requiredFlag: 'tape_rental', handler: null },
  { verb: 'borrow',     requiredFlag: 'tape_rental', handler: null },
  { verb: 'returntape', requiredFlag: 'tape_rental', handler: null },
  { verb: 'settle',     requiredFlag: 'tape_rental', handler: null },
];

export const _test = { feeFor, shelfOf, wallHere, titleOf };

console.log('[videostore] Plugin loaded.');
