// Gossip plugin regression suite — run by tests/regress.js (never loaded in production).
import * as pool from './pool.js';
import { emit } from '../../server/engine/events.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // spread plants a rumour into the pool
  const before = pool.size();
  const r1 = await run('spread the water in sector seven is poisoned');
  check('spread routes without error', r1 && r1.type !== 'error', JSON.stringify(r1)?.slice(0, 120));
  check('spread grows the pool', pool.size() > before, `size ${before} -> ${pool.size()}`);

  // ingestion: a death event becomes a violence item
  emit('player.death', { player: { id: 'gossip-test-victim', handle: 'Testcorpse', current_zone: p.current_zone }, killer: { handle: 'Testkiller' } });
  await Promise.resolve();
  check('player.death creates a violence item', pool.all().some(i => i.category === 'violence'), `categories: ${[...new Set(pool.all().map(i => i.category))].join(',')}`);

  // gossip verb dispatches (empty room → graceful output, still not an error)
  const r2 = await run('gossip');
  check('gossip verb dispatches', r2 && r2.type !== 'error', JSON.stringify(r2)?.slice(0, 120));

  // gc prunes an item aged well past its half-life
  const stale = pool.addItem({ templateKey: 'storm', category: 'world', heat: 0.45, reach: 3, ts: Date.now() - 6 * 60 * 60 * 1000, zoneId: p.current_zone, vars: { zone: 'nowhere' } });
  pool.gc();
  check('gc prunes decayed items', !pool.all().some(i => i.id === stale.id), 'stale storm item should be gone');
}
