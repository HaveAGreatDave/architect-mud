// Surveillance plugin regression suite — run by tests/regress.js (never loaded
// in production). Verb routing plus the crime→star registry defaults/cap.
import { CRIME_DEFAULTS, getCrimeStars, getCrimeList } from '../../server/engine/crimes.js';

export default async function regress({ run, check, getPlayer }) {
  const r = await run('wanted');
  check('wanted verb routed', /clean|WANTED/.test(r?.message || ''), r?.message);

  // apprehendresolve is the silent client→server resolve for the arrest prompt.
  // With no prompt live it must no-op cleanly (never throw / never mis-arrest).
  const ar = await run('apprehendresolve submit');
  check('apprehendresolve no-ops with no prompt', ar?.type === 'noop', ar?.type);
  const ar2 = await run('apprehendresolve run');
  check('apprehendresolve run no-ops with no prompt', ar2?.type === 'noop', ar2?.type);

  // collect physicalizes an auto-banked evidence clip; with none on record for
  // the fake player it must report cleanly rather than throw.
  const col = await run('collect');
  check('collect with no clips errors cleanly', col?.type === 'error' && /no un-collected evidence/i.test(col?.message || ''), col?.message);

  // clip needs a deployed device; the fake player owns none.
  const clip = await run('clip');
  check('clip with no device errors cleanly', clip?.type === 'error' && /no deployed device/i.test(clip?.message || ''), clip?.message);

  // purge is admin-only: a normal player gets the generic unknown-command reply
  // (the verb stays hidden); an admin runs it clean with no police in the room.
  const denied = await run('purge');
  check('purge denied for non-admin', /Unknown command/.test(denied?.message || ''), denied?.message);
  const p = getPlayer();
  const prevRole = p.role;
  p.role = 'admin';
  const purged = await run('purge');
  check('purge clears cleanly for admin', purged?.type === 'system' && /Slate wiped/.test(purged?.message || ''), purged?.message);
  p.role = prevRole;

  // Crime registry ships the five canonical acts with the spec'd star weights.
  check('drug_use default = 0.5 stars', getCrimeStars('drug_use') === 0.5, getCrimeStars('drug_use'));
  check('attack_player default = 4 stars', getCrimeStars('attack_player') === 4, getCrimeStars('attack_player'));
  check('attack_npc default = 4 stars', getCrimeStars('attack_npc') === 4, getCrimeStars('attack_npc'));
  check('kill_police default = 5 stars', getCrimeStars('kill_police') === 5, getCrimeStars('kill_police'));
  check('hacking default = 2 stars', getCrimeStars('hacking') === 2, getCrimeStars('hacking'));
  check('unknown crime = 0 stars', getCrimeStars('nope') === 0, getCrimeStars('nope'));

  const list = getCrimeList();
  check('crime list covers all defaults', list.length === Object.keys(CRIME_DEFAULTS).length, list.length);
  check('drug_use caught by camera only', list.find(c => c.id === 'drug_use')?.witness === 'camera');
  check('kill_police always reported', list.find(c => c.id === 'kill_police')?.witness === 'always');
}
