// Gossip plugin regression suite — run by tests/regress.js (never loaded in production).
import * as pool from './pool.js';
import { renderItem } from './templates.js';
import { emit } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';

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

  // coalescing: a repeated real event refreshes one warm item, never piles rows
  pool.addItem({ templateKey: 'ctest', category: 'world', zoneId: 'zone_ctest', subjectName: 'x' });
  pool.addItem({ templateKey: 'ctest', category: 'world', zoneId: 'zone_ctest', subjectName: 'x' });
  check('repeated events coalesce', pool.all().filter(i => i.templateKey === 'ctest').length === 1, 'two identical adds → one item');

  // planted rumours never coalesce — each is a distinct claim
  pool.plant({ text: 'same lie', zoneId: 'zone_ctest', truth: 0.5, subjectName: 'x' });
  pool.plant({ text: 'same lie', zoneId: 'zone_ctest', truth: 0.5, subjectName: 'x' });
  check("planted rumours don't coalesce", pool.all().filter(i => i.category === 'rumor' && i.vars?.text === 'same lie').length === 2, 'two plants → two items');

  // weather gossip is capped at 5 concurrent items (distinct areas, so no coalescing)
  for (let i = 0; i < 6; i++) pool.addItem({ templateKey: 'storm', category: 'world', heat: 0.45, capGroup: 'weather', zoneId: `zone_w${i}`, coalesceKey: `storm|area${i}` });
  check('weather gossip capped at 5', pool.all().filter(i => i.capGroup === 'weather').length === 5, `weather count = ${pool.all().filter(i => i.capGroup === 'weather').length}`);

  // ask-only gossip (dealer passphrase) is hidden from ambient recall but askable
  const secret = pool.addItem({ templateKey: 'dealer_phrase', category: 'secret', heat: 0.9, zoneId: p.current_zone, askOnly: true, vars: { phrase: 'open sesame' }, coalesceKey: 'dealer_phrase' });
  const ambient = pool.recall(p.current_zone, { n: 50, filter: i => !i.askOnly });
  check('ask-only gossip hidden from ambient', !ambient.some(i => i.id === secret.id), 'secret must not appear in ambient recall');
  const asked = pool.recall(p.current_zone, { n: 50 });
  check('ask-only gossip surfaces when asked', asked.some(i => i.id === secret.id), 'secret must appear in unfiltered recall');

  // sports: an aired game becomes a capped, global 'sports' rumour
  emit('sports.game', { gameId: 'gtest-game-1', away: 'Rustpile Rats', home: 'Coldwater Kingfishers', awayScore: 7, homeScore: 4, winner: 'Rustpile Rats' });
  await Promise.resolve();
  const sportsItem = pool.all().find(i => i.category === 'sports');
  check('sports.game creates a sports item', !!sportsItem, `categories: ${[...new Set(pool.all().map(i => i.category))].join(',')}`);
  check('sports item is capped in the sports group', sportsItem?.capGroup === 'sports', `capGroup ${sportsItem?.capGroup}`);
  // render is speaker-aware: a fan of the winner should name their team in the line
  if (sportsItem) {
    const line = renderItem(sportsItem, false, { fav: 'Rustpile Rats' });
    check('sports line names the speaker\'s winning team', /Rustpile Rats/.test(line || ''), (line || '').slice(0, 120));
    const neutral = renderItem(sportsItem, false, { fav: null });
    check('sports line renders without a favourite team', !!neutral && /7|4/.test(neutral), (neutral || '').slice(0, 120));
  }

  // gc prunes an item aged well past its half-life
  const stale = pool.addItem({ templateKey: 'storm', category: 'world', heat: 0.45, reach: 3, ts: Date.now() - 6 * 60 * 60 * 1000, zoneId: p.current_zone, vars: { zone: 'nowhere' } });
  pool.gc();
  check('gc prunes decayed items', !pool.all().some(i => i.id === stale.id), 'stale storm item should be gone');

  // GOSSIP_TELL dialogue action: delivers a live rumour, then goes dry per-NPC.
  // One known rumour in an isolated pool makes the cooldown deterministic.
  pool.clear();
  pool.plant({ text: 'COOLDOWN-PROBE', zoneId: p.current_zone, truth: 0.9, subjectName: 'x' });
  const tell = (npcId) => dispatchAction({ type: 'GOSSIP_TELL', actor: p, params: {}, context: { npc: { id: npcId } } });
  const t1 = await tell('gtest-a');
  check('GOSSIP_TELL delivers a live rumour', t1?.type === 'dialogue_line' && t1.text.includes('COOLDOWN-PROBE'), JSON.stringify(t1)?.slice(0, 120));
  const t2 = await tell('gtest-a');
  check('GOSSIP_TELL goes dry on cooldown (same NPC)', t2?.type === 'dialogue_line' && !t2.text.includes('COOLDOWN-PROBE'), JSON.stringify(t2)?.slice(0, 120));
  const t3 = await tell('gtest-b');
  check('GOSSIP_TELL cooldown is per-NPC (fresh NPC delivers)', t3?.type === 'dialogue_line' && t3.text.includes('COOLDOWN-PROBE'), JSON.stringify(t3)?.slice(0, 120));
}
