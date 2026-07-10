// Quests plugin regression suite — run by tests/regress.js (never loaded in
// production). Exercises the lifecycle Actions directly (dispatchAction), since
// they're the one canonical mutation path dialogue/scripts/jobboard/flight all use.
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { setFlag } from '../../server/engine/flags.js';
import { renderDialogueNode } from '../../server/engine/dialogue.js';
import { findTurnInNpc, trackEvent, cancelTasksLeavingZone } from './index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // ── Per-objective emotes + progress tick via real zone.entered events ──────
  const TWO_STEP_QUEST_ID = 'quest_regress_emote';
  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Emote','',$2,'{}',0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2`,
    // taskSeconds:0 opts these back into instant completion — a bare visit now
    // defaults to a short "doing the work" delay (DEFAULT_VISIT_SECONDS), so this
    // test pins the instant path to assert the emote/gating tick without a sleep.
    [TWO_STEP_QUEST_ID, JSON.stringify([
      { id: 'o0', type: 'visit', zone: 'zone_regress_nowhere_a', count: 1, desc: 'Step one', taskSeconds: 0, emote: '{who} does the first thing.' },
      { id: 'o1', type: 'visit', zone: 'zone_regress_nowhere_b', count: 1, desc: 'Step two', requires: ['o0'], taskSeconds: 0, emote: '{who} does the second thing.' },
    ])]
  );
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TWO_STEP_QUEST_ID]);
  await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: TWO_STEP_QUEST_ID } });

  // Calls trackEvent directly (same predicate the real on('zone.entered', ...)
  // subscriber uses) rather than emit() — the event bus is fire-and-forget and
  // doesn't await subscribers, which would race these assertions.
  await trackEvent(player, (obj) => obj.type === 'visit' && obj.zone === 'zone_regress_nowhere_a');
  ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TWO_STEP_QUEST_ID]));
  check('first objective ticks progress without finishing the quest', rows[0]?.status === 'active' && rows[0]?.progress?.[0] === 1 && (rows[0]?.progress?.[1] || 0) === 0, JSON.stringify(rows[0]));

  await trackEvent(player, (obj) => obj.type === 'visit' && obj.zone === 'zone_regress_nowhere_b');
  ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TWO_STEP_QUEST_ID]));
  check('second objective completes the quest', rows[0]?.status === 'completed' && rows[0]?.progress?.[1] === 1, JSON.stringify(rows[0]));

  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TWO_STEP_QUEST_ID]);
  await query('DELETE FROM quests WHERE id=$1', [TWO_STEP_QUEST_ID]);

  // ── Timed tasks (meta.taskSeconds) — job board's "the work takes a moment" ─
  const TIMED_QUEST_ID = 'quest_regress_timed';
  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Timed','',$2,'{}',0,'standard',$3,EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2, meta=$3`,
    [TIMED_QUEST_ID,
      JSON.stringify([{ id: 'o0', type: 'visit', zone: 'zone_regress_timed_spot', count: 1, desc: 'Do the thing', emotes: ['{who} does the thing.', '{who} keeps doing the thing.'] }]),
      JSON.stringify({ taskSeconds: 0.2 })]
  );
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TIMED_QUEST_ID]);
  await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: TIMED_QUEST_ID } });

  await trackEvent(player, (obj) => obj.type === 'visit' && obj.zone === 'zone_regress_timed_spot');
  ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TIMED_QUEST_ID]));
  check('timed objective does not complete instantly', rows[0]?.status === 'active' && (rows[0]?.progress?.[0] || 0) === 0, JSON.stringify(rows[0]));

  await sleep(400);
  ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TIMED_QUEST_ID]));
  check('timed objective completes once its countdown elapses', rows[0]?.status === 'completed' && rows[0]?.progress?.[0] === 1, JSON.stringify(rows[0]));

  // Leaving the zone mid-task cancels it outright — no partial credit.
  await query("UPDATE player_quests SET status='active', progress='[0]' WHERE player_id=$1 AND quest_id=$2", [player.id, TIMED_QUEST_ID]);
  await trackEvent(player, (obj) => obj.type === 'visit' && obj.zone === 'zone_regress_timed_spot');
  cancelTasksLeavingZone(player.id, 'zone_regress_timed_spot');
  await sleep(400);
  ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TIMED_QUEST_ID]));
  check('leaving the zone cancels the pending task', rows[0]?.status === 'active' && (rows[0]?.progress?.[0] || 0) === 0, JSON.stringify(rows[0]));

  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TIMED_QUEST_ID]);
  await query('DELETE FROM quests WHERE id=$1', [TIMED_QUEST_ID]);

  // ── Per-objective task time — obj.taskSeconds (no quest meta) ───────────────
  // Timing now lives on the objective, not quest.meta, so different steps can take
  // different times. Empty meta here proves the per-objective path stands alone.
  const POBJ_QUEST_ID = 'quest_regress_objtimed';
  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress ObjTimed','',$2,'{}',0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2`,
    [POBJ_QUEST_ID,
      JSON.stringify([{ id: 'o0', type: 'visit', zone: 'zone_regress_objtimed_spot', count: 1, desc: 'Do the thing', taskSeconds: 0.2 }])]
  );
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, POBJ_QUEST_ID]);
  await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: POBJ_QUEST_ID } });
  await trackEvent(player, (obj) => obj.type === 'visit' && obj.zone === 'zone_regress_objtimed_spot');
  ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, POBJ_QUEST_ID]));
  check('per-objective taskSeconds defers completion (no quest meta)', rows[0]?.status === 'active' && (rows[0]?.progress?.[0] || 0) === 0, JSON.stringify(rows[0]));
  await sleep(400);
  ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, POBJ_QUEST_ID]));
  check('per-objective taskSeconds completes once elapsed', rows[0]?.status === 'completed' && rows[0]?.progress?.[0] === 1, JSON.stringify(rows[0]));
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, POBJ_QUEST_ID]);
  await query('DELETE FROM quests WHERE id=$1', [POBJ_QUEST_ID]);

  // ── Retrieve objective — auto-spawns the item, completes on pickup ──────────
  const RETRIEVE_QUEST_ID = 'quest_regress_retrieve';
  const RETRIEVE_ZONE = 'zone_regress_retrieve_spot';
  const GROUND = `_ground_${RETRIEVE_ZONE}`;
  const { rows: itemRows } = await query('SELECT id FROM items LIMIT 1');
  const RETRIEVE_ITEM = itemRows[0]?.id;
  if (RETRIEVE_ITEM) {
    await query('DELETE FROM player_inventory WHERE player_id=$1', [GROUND]);
    await query(
      `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
       VALUES ($1,'Regress Retrieve','',$2,'{}',0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (id) DO UPDATE SET objectives=$2`,
      [RETRIEVE_QUEST_ID, JSON.stringify([{ id: 'o0', type: 'retrieve', item_id: RETRIEVE_ITEM, zone: RETRIEVE_ZONE, spawn: true, count: 1, desc: 'Recover the item' }])]
    );
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, RETRIEVE_QUEST_ID]);
    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: RETRIEVE_QUEST_ID } });

    ({ rows } = await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [GROUND, RETRIEVE_ITEM]));
    check('retrieve objective auto-spawns its item onto the zone ground', rows[0]?.n >= 1, JSON.stringify(rows[0]));

    // Same predicate the real on('item.taken', ...) subscriber uses.
    await trackEvent(player, (obj) => obj.type === 'retrieve' && obj.item_id === RETRIEVE_ITEM);
    ({ rows } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, RETRIEVE_QUEST_ID]));
    check('retrieve objective completes when the item is picked up', rows[0]?.status === 'completed' && rows[0]?.progress?.[0] === 1, JSON.stringify(rows[0]));

    // spawn:false must place nothing (the item is expected to already be in the world).
    await query('UPDATE quests SET objectives=$2 WHERE id=$1', [RETRIEVE_QUEST_ID, JSON.stringify([{ id: 'o0', type: 'retrieve', item_id: RETRIEVE_ITEM, zone: RETRIEVE_ZONE, spawn: false, count: 1, desc: 'Recover the item' }])]);
    await query('DELETE FROM player_inventory WHERE player_id=$1', [GROUND]);
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, RETRIEVE_QUEST_ID]);
    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: RETRIEVE_QUEST_ID } });
    ({ rows } = await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [GROUND, RETRIEVE_ITEM]));
    check('retrieve with spawn:false places nothing', rows[0]?.n === 0, JSON.stringify(rows[0]));

    await query('DELETE FROM player_inventory WHERE player_id=$1', [GROUND]);
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, RETRIEVE_QUEST_ID]);
    await query('DELETE FROM quests WHERE id=$1', [RETRIEVE_QUEST_ID]);
  }
}
