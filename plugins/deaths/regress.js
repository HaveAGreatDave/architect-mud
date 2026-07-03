// Deaths plugin regression suite — run by tests/regress.js (never loaded in production).
import { emit } from '../../server/engine/events.js';
import { query } from '../../server/models/db.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // Clean slate for this player so the assertions are deterministic.
  await query('DELETE FROM player_deaths WHERE player_id=$1', [p.id]).catch(() => {});

  // Empty state: no rows on record.
  const empty = await run('deaths');
  check('deaths dispatches with empty state',
    empty && empty.type === 'output' && /No deaths on record/.test(empty.message),
    JSON.stringify(empty)?.slice(0, 120));

  // A broadcast death is catalogued from the event alone (listener never inspects state).
  emit('player.death', {
    player: p,
    killer: null,
    cause: { type: 'weather', label: 'Lightning Strike' },
    deathZone: p.current_zone,
  });
  await new Promise((r) => setTimeout(r, 200)); // let the fire-and-forget INSERT land

  const { rows } = await query('SELECT cause_label FROM player_deaths WHERE player_id=$1', [p.id]);
  check('player.death is catalogued', rows.some((r) => r.cause_label === 'Lightning Strike'),
    `rows: ${rows.map((r) => r.cause_label).join(',')}`);

  // The command renders the logged death.
  const listed = await run('deaths');
  check('deaths lists the catalogued death',
    listed && listed.type === 'output' && /Lightning Strike/.test(listed.message),
    JSON.stringify(listed)?.slice(0, 160));

  // Clean up so the test doesn't leave rows behind.
  await query('DELETE FROM player_deaths WHERE player_id=$1', [p.id]).catch(() => {});
}
