// Ideologies plugin regression suite — run by tests/regress.js (never loaded in production).
import { dispatchAction } from '../../server/engine/actions.js';
import { classifyLean } from '../../server/engine/ideologies.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  let r = await run('rep');
  check('rep verb routed', /IDEOLOGY STANDING/.test(r?.message || ''), r?.message);
  check('rep shows where you stand', /WHERE YOU STAND/.test(r?.message || ''), r?.message);

  // Standing/stance/path Actions: registered + guard bad input (no DB write).
  r = await dispatchAction({ type: 'ADJUST_REPUTATION', actor: player, params: { delta: 5 } });
  check('ADJUST_REPUTATION guards missing ideology', r?.type === 'error', JSON.stringify(r));

  r = await dispatchAction({ type: 'ADJUST_STANCE', actor: null, params: { delta: 5 } });
  check('ADJUST_STANCE guards missing actor', r?.type === 'error', JSON.stringify(r));

  r = await dispatchAction({ type: 'ADJUST_PATH', actor: player, params: { path: 'nope', delta: 5 } });
  check('ADJUST_PATH guards unknown path', r?.type === 'error', JSON.stringify(r));

  // Pure classifier: stance + path resolve to the matching ideology.
  const IDEOS = [
    { id: 'a', name: 'Ascendants', profile: { stance: 'redeem',   path: 'machine' } },
    { id: 'l', name: 'Long Watch', profile: { stance: 'redeem',   path: 'human' } },
    { id: 'w', name: 'Wildblood',  profile: { stance: 'renounce', path: 'flesh' } },
    { id: 'x', name: 'Exodus',     profile: { stance: 'renounce', path: 'mind' } },
  ];
  check('no stance + no path → no lean', classifyLean(0, {}, IDEOS) === null);
  check('renounce + mind → Exodus',
    classifyLean(-80, { mind: 10 }, IDEOS)?.id === 'x');
  check('redeem + machine → Ascendants',
    classifyLean(80, { machine: 10 }, IDEOS)?.id === 'a');
  check('redeem + human → Long Watch',
    classifyLean(60, { human: 10 }, IDEOS)?.id === 'l');
  check('renounce + flesh → Wildblood',
    classifyLean(-90, { flesh: 10 }, IDEOS)?.id === 'w');
}
