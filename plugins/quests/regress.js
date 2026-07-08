// Quests plugin regression suite — run by tests/regress.js (never loaded in
// production). Exercises the lifecycle Actions directly (dispatchAction), since
// they're the one canonical mutation path dialogue/scripts/jobboard/flight all use.
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { setFlag } from '../../server/engine/flags.js';
import { renderDialogueNode } from '../../server/engine/dialogue.js';
import { findTurnInNpc } from './index.js';

const TEST_QUEST_ID = 'quest_regress_smoke';
const TEST_NPC_ID = 'npc_regress_turnin';

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

  // ── Turn-in NPC gating (server/engine/dialogue.js + findTurnInNpc) ──────────
  // Mirrors the real authoring pattern (npc_registrar/npc_ma_cinder/npc_slake):
  // a "report back" option leads to a node whose Actions fire TURN_IN.
  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Smoke','',$2,'{}',0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2`,
    [TEST_QUEST_ID, JSON.stringify([{ type: 'visit', zone: 'zone_nowhere', count: 1, desc: 'Go nowhere' }])]
  );
  const dialogueTree = {
    root: { text: 'Hello.', options: [{ next: 'reported', label: "I've dealt with it." }, { next: 'bye', label: 'Nothing.' }] },
    reported: { text: 'Filed.', actions: [{ action: 'TURN_IN', quest_id: TEST_QUEST_ID }], options: [{ next: 'bye', label: 'Obliged.' }] },
    bye: { text: 'Go on, then.', options: [] },
  };
  await query(
    `INSERT INTO npcs (id,name,description,zone_id,dialogue_tree,home_zone)
     VALUES ($1,'Regress Turn-In NPC','','zone_regress_turnin',$2,'zone_regress_turnin')
     ON CONFLICT (id) DO UPDATE SET dialogue_tree=$2`,
    [TEST_NPC_ID, JSON.stringify(dialogueTree)]
  );

  const found = await findTurnInNpc(TEST_QUEST_ID);
  check('findTurnInNpc locates the NPC whose dialogue turns the quest in', found?.npcId === TEST_NPC_ID, JSON.stringify(found));

  const { rows: npcRows } = await query('SELECT * FROM npcs WHERE id=$1', [TEST_NPC_ID]);
  const npc = npcRows[0];

  await setFlag('player', TEST_QUEST_ID, 'active', player);
  let rendered = await renderDialogueNode(npc, 'root', player, {});
  check('turn-in option is hidden while the quest is only active', !rendered.options.some(o => o.next === 'reported'), JSON.stringify(rendered.options));

  await setFlag('player', TEST_QUEST_ID, 'completed', player);
  rendered = await renderDialogueNode(npc, 'root', player, {});
  check('turn-in option appears once the quest is completed', rendered.options.some(o => o.next === 'reported'), JSON.stringify(rendered.options));

  // Cleanup.
  await query('DELETE FROM npcs WHERE id=$1', [TEST_NPC_ID]);
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]);
  await query('DELETE FROM quests WHERE id=$1', [TEST_QUEST_ID]);
}
