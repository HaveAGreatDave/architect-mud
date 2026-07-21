// Accolades plugin regression suite — run by tests/regress.js (never loaded in production).
//
// The fake player has no `players` row, so DB writes against its id are no-ops
// and no entry can actually be granted here. What IS worth asserting is the
// stuff that silently rots: that the verb routes, that every catalog entry is
// structurally sound, and — the big one — that no entry listens to an event
// nobody emits. A typo'd or invented event name is a dead trigger that fails
// completely silently in production, which is exactly how the first draft of
// this catalog shipped two entries wired to events that did not exist.
import { ENTRIES, BY_KEY, LISTENED_EVENTS } from './catalog.js';

// Events the catalog is allowed to depend on: real engine/plugin emitters, plus
// the two this plugin emits itself. Keep in sync when adding an entry — the
// point is that adding a NEW name here forces you to confirm someone emits it.
const KNOWN_EMITTERS = new Set([
  'zone.entered',      // server/engine/commands/movement.js
  'player.death',      // server/engine/gameLoop.js, plugins/weapon
  'posture.changed',   // server/engine/posture.js
  'item.taken',        // server/engine/actions.js
  'credits.changed',   // server/engine/economy.js
  'enemy.killed',      // plugins/weapon
  'flight.crashed',    // plugins/flight/state.js
  'accolade.unlocked', // this plugin
  'accolade.opened',   // this plugin
]);

export default async function regress({ run, check }) {
  // Both verbs are registered against the same handler — `accolades` is the
  // discoverable one, `file` is how the fiction refers to it. Assert both route,
  // because a manifest listing a verb nothing registers is a silent dead command.
  let r = await run('accolades');
  check('accolades verb routed', r?.type !== 'error', r?.message);

  r = await run('file');
  check('file verb routed', r?.type !== 'error', r?.message);
  check('empty file has a line', /file is empty/i.test(r?.message || ''), r?.message);

  check('catalog is non-empty', ENTRIES.length > 0, `${ENTRIES.length} entries`);

  const badShape = ENTRIES.filter(
    e => !e.key || !e.title || !e.line || !e.on || typeof e.test !== 'function'
  );
  check('every entry is well-formed', badShape.length === 0, badShape.map(e => e.key || '(no key)').join(', '));

  check('entry keys are unique', BY_KEY.size === ENTRIES.length,
    `${BY_KEY.size} unique of ${ENTRIES.length}`);

  const orphans = LISTENED_EVENTS.filter(e => !KNOWN_EMITTERS.has(e));
  check('no entry listens to an unemitted event', orphans.length === 0, orphans.join(', '));

  // Every test() must tolerate junk: they run inside a shared event subscriber,
  // and one throwing on a malformed payload would take the whole handler with it.
  const ctx = { bump: () => 1, has: () => false };
  const throwers = [];
  for (const e of ENTRIES) {
    for (const payload of [undefined, null, {}, { actor: {} }, { player: {} }]) {
      try { e.test(payload, ctx); } catch { throwers.push(e.key); break; }
    }
  }
  check('entry tests survive malformed payloads', throwers.length === 0, throwers.join(', '));

  // The vat entry is the first thing a new character ever sees; guard its exact
  // trigger so a refactor of the prologue path can't quietly orphan it.
  const vat = BY_KEY.get('so_we_meat_again');
  check('vat entry exists', !!vat);
  if (vat) {
    check('vat entry fires on first emergence',
      vat.test({ zone: 'zone_start', from: 'zone_the_collapse', actor: { id: 'x' } }, ctx) === 'x');
    check('vat entry ignores respawn re-entry',
      !vat.test({ zone: 'zone_start', from: 'zone_somewhere_else', actor: { id: 'x' } }, ctx));
  }
}
