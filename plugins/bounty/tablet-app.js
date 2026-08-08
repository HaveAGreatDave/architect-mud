// Tablet OS — THE BOARD. Every open contract, readable from anywhere.
//
// The in-world boards are where money changes hands; this is where you find out
// there is money to be made in the first place. Posting and redeeming are
// deliberately NOT here — they need a board, and an app that could do them would
// make every board in the city decoration.
//
// It reads the bounty plugin's in-memory mirror, so opening it costs no query.
import { registerTabletApp } from '../tablet/registry.js';
import { buildPoster, posterLines } from './poster.js';

// Cached module rather than a static import: index.js imports THIS file (for its
// registration side effect), so a static import back would be a cycle. Same
// pattern accolades-app.js uses on the record plugin.
const core = () => import('./index.js');

async function buildScreen(player, screenId) {
  const { openList, bountiesOn, totalOn } = await core();
  const list = openList().map(b => buildPoster(b, { viewer: player.id }));
  const onMe = bountiesOn(player.id).map(b => buildPoster(b, { viewer: player.id }));

  // A screen id that names a target opens that sheet. The tablet's tokenizer
  // lowercases everything before it gets here (see registry.js normScreen), so
  // the match is case-insensitive by necessity rather than by kindness.
  const want = String(screenId || '').toLowerCase().replace(/_/g, ' ').trim();
  const one = want && want !== 'board'
    ? list.find(p => p.target.toLowerCase() === want) || list.find(p => p.target.toLowerCase().includes(want))
    : null;

  return {
    view: 'bounties',
    breadcrumb: one ? [one.target] : [],
    // `sheet` is the SAME character block the log gets. The tablet draws it on
    // paper; it does not re-word it.
    sheet: one ? { ...one, lines: posterLines(one) } : null,
    contracts: list.map(p => ({
      id: p.id, target: p.target, reward: p.reward, band: p.band,
      deadline: p.deadline, isTarget: p.isTarget, isBacker: p.isBacker,
    })),
    onMe: onMe.length,
    onMeTotal: onMe.length ? totalOn(player.id) : 0,
    // The one thing the app can tell you that the board cannot: where a board is.
    hint: 'Contracts are posted and paid at a board, never from here.',
  };
}

registerTabletApp({
  id: 'bounties', name: 'The Board', icon: '✱', category: 'City',
  verbs: ['bounty', 'bounties', 'redeem'],
  buildScreen,
  // The home-screen widget exists for ONE case: paper is out on you and you do
  // not know it. It is silent otherwise — a tile that always says "0 contracts"
  // is a tile players learn to stop reading.
  //
  // Query-free by contract: it reads the plugin's in-memory mirror, which is the
  // same Map the death path reads. `alwaysOn` because an alarm you have to opt
  // into is not an alarm — the same reasoning the Crime app's Wanted card carries.
  buildWidget: async (player) => {
    const { bountiesOn, totalOn } = await core();
    const n = bountiesOn(player.id).length;
    if (!n) return null;
    const total = totalOn(player.id);
    return {
      id: 'bounty-onme', kind: 'stat', alwaysOn: true,
      title: '✱ WANTED',
      icon: '✱',
      big: `₵${total.toLocaleString('en-US')}`,
      sub: `${n === 1 ? 'a contract' : `${n} contracts`} out on you`,
      note: 'No name on the sheet.',
    };
  },
});
