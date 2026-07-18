// GameTable plugin regression — covers the screen-reader "text mode" opt-in:
// the `pokertext` toggle (runtime Set + persisted player_flag) and that the
// narration builders are safe no-ops for players who haven't opted in. The full
// Hold'em flow is exercised live in-game; here we pin the accessibility seam.
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { commands } from './index.js';
import { textModePlayers, isTextMode, narrateTurn, narrateStreet, narrateDeal } from './text-mode.js';

export default async function regress({ check }) {
  const PID = `gametable_regress_${process.pid}`;
  const noop = () => {};
  const pokertext = (input, p) => commands.pokertext(input.split(/\s+/).filter(Boolean).slice(1), input, p, noop);
  const flagVal = async () =>
    (await query('SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [PID, 'poker_text_mode'])).rows[0]?.flag_value;

  const player = { id: PID, handle: 'CardCounter', current_zone: 'void' };
  world.players.set(PID, player);

  try {
    // Real players row so the player_flags write has a valid owner.
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
    await query('INSERT INTO players (id, username, handle, password_hash) VALUES ($1,$1,$2,$3)', [PID, player.handle, 'x']);
    textModePlayers.delete(PID);

    // `pokertext on` — opts in at runtime and persists.
    let r = await pokertext('pokertext on', player);
    check('pokertext on returns output', r?.type === 'output', JSON.stringify(r)?.slice(0, 120));
    check('pokertext on adds to the runtime set', isTextMode(PID), 'not in textModePlayers');
    check('pokertext on persists the flag', (await flagVal()) === 'true', `flag=${await flagVal()}`);

    // `pokertext off` — opts back out and persists.
    r = await pokertext('pokertext off', player);
    check('pokertext off removes from the runtime set', !isTextMode(PID), 'still in textModePlayers');
    check('pokertext off persists the flag', (await flagVal()) === 'false', `flag=${await flagVal()}`);

    // Bare `pokertext` toggles from the current state.
    await pokertext('pokertext', player);
    check('bare pokertext toggles on', isTextMode(PID), 'toggle did not turn on');
    await pokertext('pokertext', player);
    check('bare pokertext toggles off', !isTextMode(PID), 'toggle did not turn off');

    // Narration builders must be safe no-ops when nobody at the table is opted in.
    const fakeGame = {
      pot: 100, currentBet: 40, bigBlind: 20, smallBlind: 10, dealerIdx: 0, community: [{ rank: 'A', suit: 's' }],
      seats: [{ playerId: PID, seatIdx: 0, chips: 480, bet: 0, hand: [{ rank: 'K', suit: 'h' }, { rank: 'K', suit: 'd' }] }],
    };
    const fakeTable = { game: fakeGame, seats: [{ playerId: PID, seatIdx: 0, isBot: false }], spectators: new Set() };
    let threw = false;
    try {
      narrateTurn(fakeTable, PID);    // opted out → should short-circuit
      narrateStreet(fakeTable, 'flop');
      narrateDeal(fakeTable);
      textModePlayers.add(PID);
      narrateTurn(fakeTable, PID);    // opted in → builds + sends (no live socket = harmless)
      narrateStreet(fakeTable, 'flop');
      narrateDeal(fakeTable);
    } catch (e) { threw = true; check('narration builders do not throw', false, e.message); }
    check('narration builders run cleanly', !threw, 'a builder threw');
  } finally {
    textModePlayers.delete(PID);
    await query('DELETE FROM player_flags WHERE player_id=$1', [PID]).catch(() => {});
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
    world.players.delete(PID);
  }
}
