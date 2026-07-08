// Quests plugin regression suite — run by tests/regress.js (never loaded in
// production). Exercises the lifecycle Actions directly (dispatchAction), since
// they're the one canonical mutation path dialogue/scripts/jobboard/flight all use.
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';

const TEST_QUEST_ID = 'quest_regress_smoke';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Smoke','',$2,$3,0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2, rewards=$3`,
    [TEST_QUEST_ID, JSON.stringify([{ type: 'visit', zone: 'zone_nowhere', count: 1, desc: 'Go nowhere' }]), JSON.stringify({ credits: 5 })]
  );
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]);

  let r = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: TEST_QUEST_ID } });
  check('START_QUEST starts the quest', r?.started === true, JSON.stringify(r));

  let { rows } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]);
  check('player_quests row is active', rows[0]?.status === 'active', JSON.stringify(rows[0]));

  r = await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: TEST_QUEST_ID, index: 0 } });
  check('ADVANCE completes the single-objective quest', r?.completed === true, JSON.stringify(r));

  r = await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: TEST_QUEST_ID } });
  check('TURN_IN pays out and closes the quest', r?.turned_in === true, JSON.stringify(r));

  ({ rows } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]));
  check('player_quests row is turned_in', rows[0]?.status === 'turned_in', JSON.stringify(rows[0]));

  // ABANDON_QUEST — a fresh active quest bailed on mid-way (e.g. flight jettison).
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]);
  await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: TEST_QUEST_ID } });
  r = await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: TEST_QUEST_ID } });
  check('ABANDON_QUEST abandons an active quest', r?.abandoned === true, JSON.stringify(r));

  ({ rows } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]));
  check('player_quests row is abandoned', rows[0]?.status === 'abandoned', JSON.stringify(rows[0]));

  r = await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: TEST_QUEST_ID } });
  check('ABANDON_QUEST is a no-op once already abandoned', r?.type === 'error', JSON.stringify(r));

  const log = await run('quests');
  check("abandoned quest doesn't show in the quest log", !new RegExp(TEST_QUEST_ID).test(log?.message || '') && !/Regress Smoke/.test(log?.message || ''), log?.message);

  // Cleanup.
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]);
  await query('DELETE FROM quests WHERE id=$1', [TEST_QUEST_ID]);
}
