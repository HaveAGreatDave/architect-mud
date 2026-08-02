// GameTable plugin regression — covers the screen-reader "text mode" opt-in:
// the `pokertext` toggle (runtime Set + persisted player_flag) and that the
// narration builders are safe no-ops for players who haven't opted in. The full
// Hold'em flow is exercised live in-game; here we pin the accessibility seam.
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { commands, _test } from './index.js';
import { textModePlayers, isTextMode, narrateTurn, narrateStreet, narrateDeal } from './text-mode.js';
import { getEnvironmentState } from '../../server/engine/environment.js';

export default async function regress({ check }) {
  const PID = `gametable_regress_${process.pid}`;
  const noop = () => {};
  const pokertext = (input, p) => commands.pokertext(input.split(/\s+/).filter(Boolean).slice(1), input, p, noop);
  // The stored preference is the game-wide Display Mode (server/engine/
  // presentation.js), shared with the flight display — poker no longer keeps a
  // `poker_text_mode` flag of its own. Values are 'text' / 'visual'.
  const flagVal = async () =>
    (await query('SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [PID, 'display_mode'])).rows[0]?.flag_value;

  const player = { id: PID, handle: 'CardCounter', current_zone: 'void' };
  world.players.set(PID, player);

  // Off-shift gate: `call dealer` / `summon` must not haul scheduled staff out of
  // bed, because their own commute graph would walk them straight back out again.
  // Unscheduled staff (the Lucky Bastard back room, covert dealers) are never gated.
  // Built against the live GAME clock (not wall time) so the assertions hold at
  // whatever hour the suite happens to run.
  const gameHour = getEnvironmentState().hour;
  const everyDay = (blocks) => Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, blocks]));
  const onNow  = everyDay([{ from: gameHour, to: gameHour + 1 }]);          // covers right now
  const offNow = everyDay([{ from: (gameHour + 2) % 24, to: (gameHour + 3) % 24 }]);

  check('isOffShift: no schedule means always available', _test.isOffShift({ vendor_schedule: {} }) === false);
  check('isOffShift: null schedule means always available', _test.isOffShift({}) === false);
  check('isOffShift: a dealer scheduled for this hour is on', _test.isOffShift({ vendor_schedule: onNow }) === false, `hour=${gameHour}`);
  check('isOffShift: a dealer scheduled for another hour is off', _test.isOffShift({ vendor_schedule: offNow }) === true, `hour=${gameHour}`);

  try {
    // Real players row so the player_flags write has a valid owner.
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
    await query('INSERT INTO players (id, username, handle, password_hash) VALUES ($1,$1,$2,$3)', [PID, player.handle, 'x']);
    textModePlayers.delete(PID);

    // `pokertext on` — opts in at runtime and persists.
    let r = await pokertext('pokertext on', player);
    check('pokertext on returns output', r?.type === 'output', JSON.stringify(r)?.slice(0, 120));
    check('pokertext on adds to the runtime set', isTextMode(PID), 'not in textModePlayers');
    check('pokertext on persists the flag', (await flagVal()) === 'text', `flag=${await flagVal()}`);

    // `pokertext off` — opts back out and persists.
    r = await pokertext('pokertext off', player);
    check('pokertext off removes from the runtime set', !isTextMode(PID), 'still in textModePlayers');
    check('pokertext off persists the flag', (await flagVal()) === 'visual', `flag=${await flagVal()}`);

    // Bare `pokertext` toggles from the current state.
    await pokertext('pokertext', player);
    check('bare pokertext toggles on', isTextMode(PID), 'toggle did not turn on');
    await pokertext('pokertext', player);
    check('bare pokertext toggles off', !isTextMode(PID), 'toggle did not turn off');

    // `text` / `visual` are the same switch under natural names. With no table
    // here they just store the pref (and return an output note, not a pane).
    let tr = await commands.text([], 'text', player, noop);
    check('text switches to text mode', isTextMode(PID), 'text did not opt in');
    check('text with no table returns output', tr?.type === 'output', JSON.stringify(tr)?.slice(0, 120));
    check('text persists the flag', (await flagVal()) === 'text', `flag=${await flagVal()}`);
    let vr = await commands.visual([], 'visual', player, noop);
    check('visual switches back to visual mode', !isTextMode(PID), 'visual did not opt out');
    check('visual persists the flag', (await flagVal()) === 'visual', `flag=${await flagVal()}`);

    // `config.textTable` is the table's OPENING DEFAULT, never an override: it
    // decides the view only for a player with no stored preference, and a stored
    // preference beats it at every table in both directions.
    const plainTable = { config: {} };
    const oldSchool  = { config: { textTable: true } };

    await query('DELETE FROM player_flags WHERE player_id=$1', [PID]);
    await _test.ensureTextPref(player, plainTable);
    check('no stored pref at a normal table → visual', !isTextMode(PID));
    await _test.ensureTextPref(player, oldSchool);
    check('no stored pref at a textTable → opens in text', isTextMode(PID));

    await commands.visual([], 'visual', player, noop);          // store an explicit "visual"
    await _test.ensureTextPref(player, oldSchool);
    check('an explicit `visual` beats a textTable default', !isTextMode(PID), 'textTable overrode the player');

    await commands.text([], 'text', player, noop);              // store an explicit "text"
    await _test.ensureTextPref(player, plainTable);
    check('an explicit `text` survives at a normal table', isTextMode(PID));

    // …and `visual` must never be refused, at any table.
    const vAtOldSchool = await commands.visual([], 'visual', player, noop);
    check('`visual` is not refused at a textTable', vAtOldSchool?.type !== 'error', JSON.stringify(vAtOldSchool)?.slice(0, 120));
    await query('DELETE FROM player_flags WHERE player_id=$1', [PID]);

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
