// Surveillance plugin regression suite — run by tests/regress.js (never loaded
// in production). Verb routing plus the crime→star registry defaults/cap.
import { CRIME_DEFAULTS, getCrimeStars, getCrimeList } from '../../server/engine/crimes.js';

export default async function regress({ run, check }) {
  const r = await run('wanted');
  check('wanted verb routed', /clean|WANTED/.test(r?.message || ''), r?.message);

  // Crime registry ships the five canonical acts with the spec'd star weights.
  check('drug_use default = 0.5 stars', getCrimeStars('drug_use') === 0.5, getCrimeStars('drug_use'));
  check('attack_player default = 3 stars', getCrimeStars('attack_player') === 3, getCrimeStars('attack_player'));
  check('attack_npc default = 3 stars', getCrimeStars('attack_npc') === 3, getCrimeStars('attack_npc'));
  check('kill_police default = 5 stars', getCrimeStars('kill_police') === 5, getCrimeStars('kill_police'));
  check('hacking default = 2 stars', getCrimeStars('hacking') === 2, getCrimeStars('hacking'));
  check('unknown crime = 0 stars', getCrimeStars('nope') === 0, getCrimeStars('nope'));

  const list = getCrimeList();
  check('crime list covers all defaults', list.length === Object.keys(CRIME_DEFAULTS).length, list.length);
  check('drug_use caught by camera only', list.find(c => c.id === 'drug_use')?.witness === 'camera');
  check('kill_police always reported', list.find(c => c.id === 'kill_police')?.witness === 'always');
}
