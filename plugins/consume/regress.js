// Consume plugin regression suite — category routing, config integrity, the
// interrupt contract, and the examine note. Never loaded in production.
import { _test, hooks } from './index.js';

export default async function regress({ check, getPlayer }) {
  const { CONFIG, categoryOf, interrupt, clearConsume, thirstOf } = _test;

  // --- drink thirst is read + split per sip ----------------------------------
  check('thirstOf reads structured instant.thirst', thirstOf({ effects: { instant: { thirst: 12 } } }) === 12);
  check('thirstOf reads flat effects.thirst', thirstOf({ effects: { thirst: 8 } }) === 8);
  check('thirstOf of a thirstless drug is 0', thirstOf({ effects: { instant: { hp: 5 } } }) === 0);
  // A 12-thirst drink over start+2 mids+finish = 4 sips: 3 per sip, exact.
  check('a drink thirst splits evenly across sips', Math.round(12 / (CONFIG.drink.steps + 2)) === 3);

  // --- category detection off content flags ----------------------------------
  check('alcoholic → drink',  categoryOf({ flags: { alcoholic: true } }) === 'drink');
  check('smokeable → smoke',  categoryOf({ flags: { smokeable: true } }) === 'smoke');
  check('cannabis → joint',   categoryOf({ flags: { cannabis: true } }) === 'joint');
  check('plain drug → none',  categoryOf({ flags: {} }) === null);
  check('missing drug → none', categoryOf(undefined) === null);

  // --- config integrity ------------------------------------------------------
  for (const cat of ['drink', 'smoke', 'joint']) {
    const c = CONFIG[cat];
    check(`${cat} has a positive duration`, c.seconds > 0);
    check(`${cat} has start/mid/finish lines`, c.start.length && c.mid.length && c.finish.length);
    check(`${cat} has at least as many mid lines as steps`, c.mid.length >= c.steps);
  }

  // --- interrupt clears the timed act ----------------------------------------
  const player = getPlayer();
  const timer = setTimeout(() => {}, 60000);
  player._consume = { itemRowId: 'x', timers: [timer], finishLine: 'done', category: 'drink', name: 'beer' };
  interrupt(player);
  check('interrupt clears _consume', !player._consume);

  // --- examine note while consuming ------------------------------------------
  player._consume = { itemRowId: 'x', timers: [], finishLine: 'done', category: 'smoke', name: 'cigarette' };
  const noteOther = hooks['player.appearanceNotes']({ target: player, isSelf: false });
  const noteSelf  = hooks['player.appearanceNotes']({ target: player, isSelf: true });
  check('examine shows a consuming note to others', typeof noteOther === 'string' && /smoking/i.test(noteOther), noteOther);
  check('examine shows a consuming note to self', typeof noteSelf === 'string' && noteSelf.length > 0, noteSelf);
  clearConsume(player);
  check('no note once not consuming', hooks['player.appearanceNotes']({ target: player, isSelf: false }) === undefined);
}
