// Quests plugin regression suite — run by tests/regress.js (never loaded in
// production). Exercises the lifecycle Actions directly (dispatchAction), since
// they're the one canonical mutation path dialogue/scripts/jobboard/flight all use.
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { setFlag } from '../../server/engine/flags.js';
import { renderDialogueNode } from '../../server/engine/dialogue.js';
import { emit } from '../../server/engine/events.js';
import { clearEffect } from '../../server/engine/effects.js';
import { world } from '../../server/engine/world.js';
import { findTurnInNpc, trackEvent, cancelTasksLeavingZone, invalidateQuestCache, loadPlayerQuest } from './index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEST_QUEST_ID = 'quest_regress_smoke';
const TEST_NPC_ID = 'npc_regress_turnin';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  await query(
    `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
     VALUES ($1,'Regress Smoke','',$2,$3,0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (id) DO UPDATE SET objectives=$2, rewards=$3`,
    [TEST_QUEST_ID, JSON.stringify([{ type: 'visit', zone: 'zone_nowhere', count: 1, desc: 'Go nowhere' }]), JSON.stringify({ credits: 5, xp: 7 })]
  );
  await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]);

  let r = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: TEST_QUEST_ID } });
  check('START_QUEST starts the quest', r?.started === true, JSON.stringify(r));

  let { rows } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TEST_QUEST_ID]);
  check('player_quests row is active', rows[0]?.status === 'active', JSON.stringify(rows[0]));

  r = await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: TEST_QUEST_ID, index: 0 } });
  check('ADVANCE completes the single-objective quest', r?.completed === true, JSON.stringify(r));

  // rewards.xp — until 2026-07-21 quests awarded none at all, so the whole quest
  // economy fed no progression. The DB half (grantXp → players.bonus_xp) can't be
  // asserted here: the harness player is in-memory only and has no players row, so
  // the UPDATE legitimately hits zero rows. What IS testable is the live mirror —
  // total_xp/xp are computed columns refreshed only at login, so a turn-in that
  // forgot to bump them would leave every mid-session reader stale.
  const mirrorBefore = Number(player.total_xp) || 0;
  const netBefore = Number(player.xp) || 0;

  r = await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: TEST_QUEST_ID } });
  check('TURN_IN pays out and closes the quest', r?.turned_in === true, JSON.stringify(r));

  check('TURN_IN moves the live total_xp mirror by rewards.xp',
    (Number(player.total_xp) || 0) - mirrorBefore === 7, `${mirrorBefore} → ${player.total_xp}`);
  check('TURN_IN moves the live net-xp mirror too',
    (Number(player.xp) || 0) - netBefore === 7, `${netBefore} → ${player.xp}`);
  player.total_xp = mirrorBefore; player.xp = netBefore;

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
  // Direct quests write behind loadQuest's cache — bust it so the re-authored
  // objectives/rewards are what the lifecycle Actions below actually see.
  invalidateQuestCache(TEST_QUEST_ID);
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

  // Never accepted → the turn-in option is hidden entirely.
  let rendered = await renderDialogueNode(npc, 'root', player, {});
  check('turn-in option is hidden while the quest is not accepted', !rendered.options.some(o => o.next === 'reported'), JSON.stringify(rendered.options));

  // Accepted but not yet complete → the option is SHOWN but disabled (the client
  // routes a click to the Tablet quest screen), carrying the quest id to route to.
  await setFlag('player', TEST_QUEST_ID, 'active', player);
  rendered = await renderDialogueNode(npc, 'root', player, {});
  const activeOpt = rendered.options.find(o => o.next === 'reported');
  check('turn-in option is shown-but-disabled while the quest is only active', !!activeOpt && activeOpt._turninDisabled === true && activeOpt._turninQuestId === TEST_QUEST_ID, JSON.stringify(rendered.options));

  // Completed → the option is shown and clickable (not disabled).
  await setFlag('player', TEST_QUEST_ID, 'completed', player);
  rendered = await renderDialogueNode(npc, 'root', player, {});
  const doneOpt = rendered.options.find(o => o.next === 'reported');
  check('turn-in option appears and is enabled once the quest is completed', !!doneOpt && !doneOpt._turninDisabled, JSON.stringify(rendered.options));

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
    invalidateQuestCache(RETRIEVE_QUEST_ID); // direct write behind the cache
    await query('DELETE FROM player_inventory WHERE player_id=$1', [GROUND]);
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, RETRIEVE_QUEST_ID]);
    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: RETRIEVE_QUEST_ID } });
    ({ rows } = await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [GROUND, RETRIEVE_ITEM]));
    check('retrieve with spawn:false places nothing', rows[0]?.n === 0, JSON.stringify(rows[0]));

    await query('DELETE FROM player_inventory WHERE player_id=$1', [GROUND]);
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, RETRIEVE_QUEST_ID]);
    await query('DELETE FROM quests WHERE id=$1', [RETRIEVE_QUEST_ID]);
  }

  // ── The event-driven objective types ───────────────────────────────────────
  //
  // One quest per type, each driven through the REAL event the world emits rather
  // than through trackEvent directly, so a subscriber wired to the wrong payload
  // key (`actor` vs `player`, `item_id` vs `itemId`) fails here instead of silently
  // never advancing in play. Those two shapes genuinely differ across the bus.
  {
    const TYPES_QUEST = 'quest_regress_types';
    const mkQuest = async (objectives) => {
      await query(
        `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
         VALUES ($1,'Regress Types','',$2,'{}',1,'standard','{}',EXTRACT(EPOCH FROM NOW()))
         ON CONFLICT (id) DO UPDATE SET objectives=$2`,
        [TYPES_QUEST, JSON.stringify(objectives)]
      );
      invalidateQuestCache(TYPES_QUEST);   // direct write behind the cache
      await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TYPES_QUEST]);
      await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: TYPES_QUEST } });
      // ⚠ WAIT FOR THE ROW BEFORE HANDING BACK. START_QUEST's write is not
      // guaranteed to have landed when dispatchAction resolves, and a NEGATIVE
      // check only sleeps 120ms (see settle() below) — so if the row is late,
      // progressOf() returns [] and `[][0] === 0` is false. That fails as
      // "survive credited somebody who sheltered indoors", which is a sentence
      // about weather and shelter and has nothing to do with what went wrong.
      // Seen 2026-08-25: the two survive checks went red and were green on a
      // re-run with no code change in between.
      for (let i = 0; i < 120; i++) {
        const { rows } = await query('SELECT 1 FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TYPES_QUEST]);
        if (rows.length) return;
        await sleep(25);
      }
    };
    const progressOf = async () => {
      const { rows: pr } = await query('SELECT progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TYPES_QUEST]);
      return pr[0]?.progress || [];
    };
    // The bus is fire-and-forget; give the subscriber a beat to land its UPDATE.
    // NEGATIVE cases sleep, because proving nothing happened means giving it the
    // chance to: there is no value to wait for.
    const settle = () => sleep(120);
    // A POSITIVE case waits for the value instead. 120ms is a GUESS about how long
    // a fire-and-forget subscriber takes to reach Postgres, and on a loaded CI
    // runner against a container DB it is sometimes wrong — which surfaced as one
    // red that was green locally and MOVED between runs (the equip case, CI
    // 2026-08-14). Polling makes the wait exactly as long as it needs to be, so a
    // slow box costs a few milliseconds instead of a false failure, and a genuine
    // regression still fails — it just takes the full budget to do it.
    const settled = async (n, ms = 3000) => {
      const until = Date.now() + ms;
      for (;;) {
        const p = await progressOf();
        if (p[0] === n || Date.now() > until) return p;
        await sleep(25);
      }
    };
    const statusSettled = async (want, ms = 3000) => {
      const until = Date.now() + ms;
      for (;;) {
        const { rows: s } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TYPES_QUEST]);
        if (s[0]?.status === want || Date.now() > until) return s[0]?.status;
        await sleep(25);
      }
    };

    // assassinate — an exact NPC, and never an NPC-on-NPC kill with no player behind it.
    await mkQuest([{ id: 'o0', type: 'assassinate', target: 'npc_regress_mark', count: 1, desc: 'Do it' }]);
    emit('npc.killed', { npc: { id: 'npc_regress_mark', name: 'The Mark' } });   // no actor
    await settle();
    check('assassinate ignores a kill with no player behind it', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_mark', name: 'The Mark' } });
    await settle();
    check('assassinate advances on npc.killed by a player', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // …and it must not fire for a DIFFERENT NPC — the whole difference from 'kill'
    // is that it names a person, so a near-miss here means it's just kill again.
    await mkQuest([{ id: 'o0', type: 'assassinate', target: 'npc_regress_mark', count: 1, desc: 'Do it' }]);
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_bystander', name: 'Someone Else' } });
    await settle();
    check('assassinate does not fire for a different NPC', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));

    // escort — needs BOTH the right NPC and the destination zone.
    await mkQuest([{ id: 'o0', type: 'escort', target: 'npc_regress_ward', zone: 'zone_regress_dest', count: 1, desc: 'Walk them' }]);
    emit('escort.arrived', { actor: player, npc: { id: 'npc_regress_ward', name: 'Ward' }, zone: 'zone_regress_wrong' });
    await settle();
    check('escort does not advance at the wrong destination', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('escort.arrived', { actor: player, npc: { id: 'npc_regress_ward', name: 'Ward' }, zone: 'zone_regress_dest' });
    await settle();
    check('escort advances when the escortee arrives at the destination', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // talk
    await mkQuest([{ id: 'o0', type: 'talk', target: 'npc_regress_talker', count: 1, desc: 'Go and listen' }]);
    emit('npc.talked', { actor: player, npc: { id: 'npc_regress_talker', name: 'Talker' } });
    await settle();
    check('talk advances on npc.talked', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // buy / sell — the vendor events carry `player`, not `actor`, and `itemId`,
    // not `item_id`. Both are easy to get backwards and silent when wrong.
    await mkQuest([{ id: 'o0', type: 'buy', target: 'medkit', count: 2, desc: 'Buy two' }]);
    // Settled between the two, deliberately: trackEvent is read-modify-write over
    // player_quests and emit() does not await its subscribers, so two events fired
    // in the SAME tick both read the same pre-state and the second write wins. That
    // race predates these objective types (it's just as true of two kills a
    // millisecond apart) and isn't what this case is testing.
    emit('vendor.purchase', { player, itemId: 'medkit' });
    await settle();
    emit('vendor.purchase', { player, itemId: 'medkit' });
    await settle();
    check('buy advances on vendor.purchase (payload uses player/itemId)', (await settled(2))[0] === 2, JSON.stringify(await progressOf()));

    await mkQuest([{ id: 'o0', type: 'sell', count: 1, desc: 'Sell anything' }]);
    emit('vendor.sale', { player, itemId: 'whatever' });
    await settle();
    check('sell with no target counts any sale', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // craft — counts the STACK, so one critical craft satisfies "craft 2".
    await mkQuest([{ id: 'o0', type: 'craft', target: 'shiv', count: 2, desc: 'Make two' }]);
    emit('item.crafted', { actor: player, item_id: 'shiv', quantity: 2 });
    await settle();
    check('craft counts the output quantity, not the craft', (await settled(2))[0] === 2, JSON.stringify(await progressOf()));

    // equip
    await mkQuest([{ id: 'o0', type: 'equip', item_id: 'dinner_jacket', count: 1, desc: 'Dress up' }]);
    emit('item.equipped', { actor: player, item: { item_id: 'dinner_jacket' }, slot: 'torso' });
    await settle();
    check('equip advances on item.equipped', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // hack — zone-scoped.
    await mkQuest([{ id: 'o0', type: 'hack', zone: 'zone_regress_till', count: 1, desc: 'Crack it' }]);
    emit('hack.success', { player, zoneId: 'zone_regress_elsewhere' });
    await settle();
    check('hack does not advance for the wrong site', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('hack.success', { player, zoneId: 'zone_regress_till' });
    await settle();
    check('hack advances at the named site', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // spend — the numeric-predicate path. This is the one that proves trackEvent
    // can count something other than repetitions; if the generalisation regresses,
    // 900 credits would read as one tick and the objective would never finish.
    await mkQuest([{ id: 'o0', type: 'spend', count: 1000, desc: 'Blow a grand' }]);
    emit('credits.changed', { actor: player, delta: 400, reason: 'vendor:sell' });   // income
    await settle();
    check('spend ignores incoming credits', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('credits.changed', { actor: player, delta: -250, reason: 'bank:deposit' });
    await settle();
    check('spend ignores a bank transfer', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('credits.changed', { actor: player, delta: -900, reason: 'vendor:buy' });
    await settle();
    check('spend accumulates the AMOUNT, not a count', (await settled(900))[0] === 900, JSON.stringify(await progressOf()));
    let { rows: st } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TYPES_QUEST]);
    check('spend is not complete below the credit target', st[0]?.status === 'active', JSON.stringify(st[0]));
    emit('credits.changed', { actor: player, delta: -200, reason: 'vendor:buy' });
    await settle();
    ({ rows: st } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TYPES_QUEST]));
    check('spend completes once the credit target is crossed', st[0]?.status === 'completed', JSON.stringify(st[0]));

    // survive — the two-moment one. Sitting the peak out indoors must earn nothing,
    // which is the entire point of the objective.
    const savedZone2 = player.current_zone;
    const OUT = 'zone_regress_open', IN = 'zone_regress_shelter';
    world.zones.set(OUT, { id: OUT, name: OUT, exits: [], npcs: new Set(), enemies: new Set(), players: new Set(), flags: {} });
    world.zones.set(IN, { id: IN, name: IN, exits: [], npcs: new Set(), enemies: new Set(), players: new Set(), flags: { is_interior: true } });
    try {
      await mkQuest([{ id: 'o0', type: 'survive', target: 'acid_rain', count: 1, desc: 'Ride it out' }]);
      player.current_zone = IN;
      emit('weather.event', { type: 'acid_rain', phase: 'peak' });
      await settle();
      player.current_zone = OUT;
      emit('weather.event', { type: null, phase: null });
      await settle();
      check('survive credits nobody who sheltered indoors at the peak', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));

      player.current_zone = OUT;
      emit('weather.event', { type: 'acid_rain', phase: 'peak' });
      await settle();
      emit('weather.event', { type: null, phase: null });
      await settle();
      check('survive credits a player who stood outdoors through it', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));
    } finally {
      player.current_zone = savedZone2;
      world.zones.delete(OUT);
      world.zones.delete(IN);
    }

    // ── The discipline objectives ────────────────────────────────────────────
    //
    // These are what let a faction quest name the thing the order actually turns
    // on. The shared risk across all four is a predicate that is too LOOSE — it
    // fires, the case goes green, and the objective quietly counts things it was
    // never meant to. So every one of them is tested in both directions.

    // install — the one new Event in the batch (plugins/augments/install.js).
    await mkQuest([{ id: 'o0', type: 'install', target: 'aug_regress_arm', count: 1, desc: 'Get fitted' }]);
    emit('augment.installed', { actor: player, augment_id: 'aug_regress_other' });
    await settle();
    check('install does not advance for a different augment', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('augment.installed', { actor: player, augment_id: 'aug_regress_arm' });
    await settle();
    check('install advances on augment.installed', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // …and blank means any fitting, which is the shape the Ascendant bridge quest
    // wants ("get chromed", not "get chromed with this specific piece").
    await mkQuest([{ id: 'o0', type: 'install', count: 1, desc: 'Any chrome' }]);
    emit('augment.installed', { actor: player, augment_id: 'aug_regress_whatever' });
    await settle();
    check('install with no target counts any fitting', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // mutate — ONE event covers every grant path (radiation, flask, authored
    // GRANT_MUTATION), so an objective can't be satisfied by one route and blind
    // to another. The payload carries `player`, not `actor`.
    //
    // ⚠ MUTATING IS AN INJURY, and this suite shares one fake player with every
    // other suite. `plugins/mutations/onset.js` hangs off this exact Event and
    // takes 90% of your stamina and a slice of HP the moment it fires — so
    // emitting it here and walking away turns the sneak and weightbench suites
    // red with "you haven't got the wind for it", which looks like anything
    // except a quest change. Snapshot and put it back. (docs/systems-mutations.md
    // warns about this in as many words; it is easier to re-learn than to read.)
    const savedHp = player.hp, savedStam = player.stamina;
    try {
      await mkQuest([{ id: 'o0', type: 'mutate', target: 'mut_regress_gills', count: 1, desc: 'Change' }]);
      emit('mutation.gained', { player, id: 'mut_regress_spurs', expression: 40, source: 'radiation' });
      await settle();
      check('mutate does not advance for a different mutation', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
      emit('mutation.gained', { player, id: 'mut_regress_gills', expression: 40, source: 'mutagen' });
      await settle();
      check('mutate advances on mutation.gained', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));
    } finally {
      player.hp = savedHp; player.stamina = savedStam;
      delete player._turning;
      clearEffect(player, 'turning');
      clearEffect(player, 'turning_deep');
    }

    // subdue — a person put down and left breathing. THE failure mode here is
    // crediting the body on the floor instead of the hand that swung, which would
    // pay a quest out to the victim; the payload's `player` is the attacker.
    await mkQuest([{ id: 'o0', type: 'subdue', target: 'npc_regress_mark', count: 1, desc: 'Cosh them' }]);
    emit('knockout.landed', { player: { id: 'player_regress_stranger' }, target: player, kind: 'player', zoneId: player.current_zone });
    await settle();
    check('subdue does not credit the player who was knocked out', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('knockout.landed', { player, target: { id: 'npc_regress_bystander', name: 'Someone Else' }, kind: 'npc', zoneId: player.current_zone });
    await settle();
    check('subdue does not fire for a different person', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('knockout.landed', { player, target: { id: 'npc_regress_mark', name: 'The Mark' }, kind: 'npc', zoneId: player.current_zone });
    await settle();
    check('subdue advances on knockout.landed by the player', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));

    // restore — a CLAIMED death, the only kind that was arranged for in advance
    // and the only kind that skips augment corruption. It shares one subscription
    // with the `died` fail condition precisely so the two can never disagree about
    // what `claimed` means, which is what these two cases pin down.
    await mkQuest([{ id: 'o0', type: 'restore', count: 1, desc: 'Die on a policy' }]);
    emit('player.death', { player, killer: null, cause: { type: 'regress', label: 'Regress Ordinary' }, deathZone: player.current_zone, claimed: false });
    await settle();
    check('restore does not advance on an ordinary death', (await progressOf())[0] === 0, JSON.stringify(await progressOf()));
    emit('player.death', { player, killer: null, cause: { type: 'regress', label: 'Regress Claimed' }, deathZone: player.current_zone, claimed: true });
    await settle();
    check('restore advances on a claimed death', (await settled(1))[0] === 1, JSON.stringify(await progressOf()));
    // The deaths plugin catalogues both of those; don't leave them on the sheet.
    await query('DELETE FROM player_deaths WHERE player_id=$1', [player.id]).catch(() => {});

    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, TYPES_QUEST]);
    await query('DELETE FROM quests WHERE id=$1', [TYPES_QUEST]);
  }

  // ── Failure ────────────────────────────────────────────────────────────────
  //
  // The load-bearing property is not "a quest can fail" but "a failed or expired
  // quest can never pay out". So every case below checks the PAYOUT gate, not just
  // the status flip — a fail that leaves TURN_IN reachable is worse than no fail.
  {
    const FAIL_QUEST_ID = 'quest_regress_fail';
    const mkFail = async (objectives, fail_on, meta = {}) => {
      await query(
        `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,fail_on,updated_at)
         VALUES ($1,'Regress Fail','',$2,$3,0,'standard',$4,$5,EXTRACT(EPOCH FROM NOW()))
         ON CONFLICT (id) DO UPDATE SET objectives=$2, rewards=$3, meta=$4, fail_on=$5`,
        [FAIL_QUEST_ID, JSON.stringify(objectives), JSON.stringify({ credits: 50 }),
         JSON.stringify(meta), JSON.stringify(fail_on)]
      );
      invalidateQuestCache(FAIL_QUEST_ID);
      await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, FAIL_QUEST_ID]);
      await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    };
    const statusOf = async () => {
      const { rows: s } = await query('SELECT status FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, FAIL_QUEST_ID]);
      return s[0]?.status;
    };
    // ⚠ `settle` IS ONLY EVER CORRECT FOR A NEGATIVE. It is a fixed 120ms guess at how long a
    // fire-and-forget subscriber takes to reach Postgres, so it is the right wait for asserting
    // that something did NOT happen (a poll for 'stays active' is just a sleep with extra steps)
    // and the WRONG one for asserting that something DID. A positive that waits a fixed 120ms is
    // green on a quiet box and red on a loaded CI runner, which is a red that moves between runs
    // and looks like anything except what it is.
    //
    // That is not hypothetical here twice over: the equip case cost a CI-only red on 2026-08-14,
    // and `meta.failPermanent blocks the retry` cost another on 2026-08-20 — the fail had simply
    // not landed yet, so the quest was still active, and START_QUEST on an ALREADY-ACTIVE quest
    // also answers `started: false`. Both halves of the assertion read as if the feature worked.
    //
    // So: asserting a status flip? Use `failed(...)`. Asserting a status DIDN'T flip? `settle()`.
    const settle = () => sleep(120);
    const failed = async (want, ms = 3000) => {
      const until = Date.now() + ms;
      for (;;) {
        const st = await statusOf();
        if (st === want || Date.now() > until) return st;
        await sleep(25);
      }
    };

    // A fail_on condition trips on the SAME event an objective would have used.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get there' }],
      [{ type: 'assassinate', target: 'npc_regress_witness', desc: 'The witness died.' }]
    );
    check('a quest with fail_on starts normally', (await statusOf()) === 'active', await statusOf());
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_other', name: 'Nobody' } });
    await settle();
    check('an unrelated event does not fail the quest', (await statusOf()) === 'active', await statusOf());
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_witness', name: 'The Witness' } });
    await settle();
    check('a fail_on condition fails the quest', (await failed('failed')) === 'failed', await statusOf());

    // A `kill` fail_on is a PROHIBITION — "do this job without shooting anyone".
    // It matches enemy names by SUBSTRING, which is the whole reason one clause
    // can cover a species; quest_lw_4 leans on `Supervisor` catching "Supervisor,
    // Halcyon Compliance". Worth pinning: if that ever tightened to an exact match
    // the clause would silently stop firing and the quest would look merely lenient.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get there' }],
      [{ type: 'kill', target: 'Supervisor', desc: 'You put one of them in the ground.' }]
    );
    emit('enemy.killed', { actor: player, enemy: { name: 'Gutter Hound' } });
    await settle();
    check('killing something else does not trip a kill prohibition', (await statusOf()) === 'active', await statusOf());
    emit('enemy.killed', { actor: player, enemy: { name: 'Supervisor, Halcyon Compliance' } });
    await settle();
    check('a kill fail_on matches the enemy name by substring', (await failed('failed')) === 'failed', await statusOf());

    // ── The constraint conditions ────────────────────────────────────────────
    //
    // Failure-only, like `timeout` and `escort_lost`. These are what let a quest
    // state a CONSTRAINT rather than a task — the objective says get the thing,
    // the condition says and nobody sees you — which is the half of an
    // infiltration job that makes it one.

    // spotted — the stealth roll went against you. Per observer, so the FIRST NPC
    // to clock you blows it.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get in' }],
      [{ type: 'spotted', desc: 'Somebody saw you.' }]
    );
    emit('stealth.noticed', { sneaker: { id: 'player_regress_stranger' }, observer: { id: 'npc_regress_guard' }, zoneId: player.current_zone });
    await settle();
    check('spotted does not fail on somebody ELSE being seen', (await statusOf()) === 'active', await statusOf());
    emit('stealth.noticed', { sneaker: player, observer: { id: 'npc_regress_guard' }, zoneId: player.current_zone });
    await settle();
    check('spotted fails the quest when the player is noticed', (await failed('failed')) === 'failed', await statusOf());

    // witnessed — the act reached a camera or a cop. ⚠ Its payload carries a
    // FLATTENED {id, handle}, not the live player, so the subscription has to
    // resolve it; a stub would read as a player with no quests and silently never
    // fail anything.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Do it quietly' }],
      [{ type: 'witnessed', target: 'burglary', desc: 'A camera got you.' }]
    );
    emit('crime.witnessed', { player: { id: player.id, handle: player.handle }, key: 'loitering', zoneId: player.current_zone, label: 'Loitering' });
    await settle();
    check('witnessed does not fail for a different crime key', (await statusOf()) === 'active', await statusOf());
    emit('crime.witnessed', { player: { id: player.id, handle: player.handle }, key: 'burglary', zoneId: player.current_zone, label: 'Burglary' });
    await settle();
    check('witnessed fails on the named crime, resolving the flattened payload', (await failed('failed')) === 'failed', await statusOf());

    // broke — gear destroyed under you. Deliberately untargeted: `item.broken`
    // carries an inventory row id rather than an item id, and "bring your tools
    // back whole" does not need to name the tool.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Do the work' }],
      [{ type: 'broke', desc: 'You broke it.' }]
    );
    emit('item.broken', { actor: player, invId: 'inv_regress_pipe', reason: 'combat' });
    await settle();
    check('broke fails the quest when gear is destroyed', (await failed('failed')) === 'failed', await statusOf());

    // died — the mirror of the `restore` objective, over the SAME subscription, so
    // an ordinary death blows the quest and a claimed one does not. Getting this
    // pair backwards would fail every Ascendant policy quest at the exact moment
    // it was meant to succeed.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Come back' }],
      [{ type: 'died', desc: 'You did not come back.' }]
    );
    emit('player.death', { player, killer: null, cause: { type: 'regress', label: 'Regress Claimed' }, deathZone: player.current_zone, claimed: true });
    await settle();
    check('died does not fail on a claimed death', (await statusOf()) === 'active', await statusOf());
    emit('player.death', { player, killer: null, cause: { type: 'regress', label: 'Regress Ordinary' }, deathZone: player.current_zone, claimed: false });
    await settle();
    check('died fails the quest on an ordinary death', (await failed('failed')) === 'failed', await statusOf());
    await query('DELETE FROM player_deaths WHERE player_id=$1', [player.id]).catch(() => {});

    // …and a failed quest is not turn-in-able, whatever its progress says.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get there' }],
      [{ type: 'assassinate', target: 'npc_regress_witness', desc: 'The witness died.' }]
    );
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_witness', name: 'The Witness' } });
    await failed('failed');
    let r = await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    check('a failed quest cannot be turned in', r?.type === 'error' && r?.turned_in !== true, JSON.stringify(r));
    check('…and it stays failed after the attempt', (await statusOf()) === 'failed', await statusOf());

    // Retry is the default — a permanent dead end has to be asked for.
    r = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    check('a failed quest can be taken again by default', r?.started === true && (await statusOf()) === 'active', JSON.stringify(r));

    // …unless the author locked it.
    await mkFail(
      [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get there' }],
      [{ type: 'assassinate', target: 'npc_regress_witness' }],
      { failPermanent: true }
    );
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_witness', name: 'The Witness' } });
    // ⚠ POLL, don't sleep. The retry has to be refused BECAUSE the quest is permanently failed —
    // if the fail has not landed the quest is merely still active, START_QUEST answers
    // `started: false` to that too, and the case passes for the wrong reason or fails for one.
    check('…and the fail lands before the retry is attempted', (await failed('failed')) === 'failed', await statusOf());
    r = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    check('meta.failPermanent blocks the retry', r?.started === false && (await statusOf()) === 'failed', JSON.stringify(r));

    // FAIL_QUEST — the authored route, for a failure no event can express.
    await mkFail([{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get there' }], []);
    r = await dispatchAction({ type: 'FAIL_QUEST', actor: player, params: { quest_id: FAIL_QUEST_ID, reason: 'You told them.' } });
    check('FAIL_QUEST fails a live quest', r?.failed === true && (await statusOf()) === 'failed', JSON.stringify(r));
    r = await dispatchAction({ type: 'FAIL_QUEST', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    check('FAIL_QUEST on an already-failed quest errors rather than re-failing it', r?.type === 'error', JSON.stringify(r));

    // ── The clock ────────────────────────────────────────────────────────────
    // Deliberately lazy (derived from started_at, never a stored timer, so a
    // restart can't hand out an extension). The guarantee that makes lazy safe is
    // that every path which could advance or hand in a quest checks it FIRST —
    // so backdate started_at and prove each of those paths refuses.
    const backdate = () => query(
      'UPDATE player_quests SET started_at = EXTRACT(EPOCH FROM NOW()) - 9999 WHERE player_id=$1 AND quest_id=$2',
      [player.id, FAIL_QUEST_ID]
    );

    // The objective is met on purpose, so the ONLY thing standing between the
    // player and a payout is the clock.
    await mkFail([{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get there' }],
      [{ type: 'timeout', count: 60 }]);
    check('a timed quest is active while the clock runs', (await statusOf()) === 'active', await statusOf());
    await backdate();
    r = await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    check('ADVANCE refuses an expired quest', r?.type === 'error', JSON.stringify(r));
    check('…and expiring it flips the status to failed', (await statusOf()) === 'failed', await statusOf());

    // The turn-in counter checks the clock too — the deadline can pass while the
    // player walks back, and a completed-but-late quest must not pay out.
    await mkFail([{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'Get there' }],
      [{ type: 'timeout', count: 60 }]);
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    check('the timed quest completes normally inside the window', (await statusOf()) === 'completed', await statusOf());
    await backdate();
    const creditsBefore = Number(player.credits) || 0;
    r = await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: FAIL_QUEST_ID } });
    check('a completed quest that expired en route cannot be turned in', r?.turned_in !== true, JSON.stringify(r));
    check('…and it pays out nothing', (Number(player.credits) || 0) === creditsBefore, `${creditsBefore} → ${player.credits}`);
    check('…and it reads as failed, not completed', (await statusOf()) === 'failed', await statusOf());

    // trackEvent's own gate: an expired quest must not be advanced by the very
    // event that noticed the expiry.
    await mkFail([{ id: 'o0', type: 'buy', target: 'medkit', count: 1, desc: 'Buy one' }],
      [{ type: 'timeout', count: 60 }]);
    await backdate();
    emit('vendor.purchase', { player, itemId: 'medkit' });
    await failed('failed');   // positive — poll, see the ⚠ on `settle`
    const { rows: pr } = await query('SELECT status, progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, FAIL_QUEST_ID]);
    check('an event against an expired quest fails it instead of advancing it',
      pr[0]?.status === 'failed' && (pr[0]?.progress?.[0] || 0) === 0, JSON.stringify(pr[0]));

    // escort_lost — the failure the escort system exists to have.
    await mkFail([{ id: 'o0', type: 'escort', target: 'npc_regress_ward', zone: 'zone_regress_dest', count: 1, desc: 'Walk them' }],
      [{ type: 'escort_lost', target: 'npc_regress_ward' }]);
    emit('escort.lost', { actor: player, npc: { id: 'npc_regress_ward', name: 'Ward' }, reason: 'killed' });
    check('losing the escortee fails the escort quest', (await failed('failed')) === 'failed', await statusOf());

    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, FAIL_QUEST_ID]);
    await query('DELETE FROM quests WHERE id=$1', [FAIL_QUEST_ID]);
  }

  // ── The eight audit fixes ──────────────────────────────────────────────────
  {
    const AUDIT = 'quest_regress_audit';
    const mk = async (cols = {}) => {
      await query(
        `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,fail_on,penalties,updated_at)
         VALUES ($1,'Regress Audit','',$2,$3,1,'standard','{}',$4,$5,EXTRACT(EPOCH FROM NOW()))
         ON CONFLICT (id) DO UPDATE SET objectives=$2, rewards=$3, fail_on=$4, penalties=$5`,
        [AUDIT,
         JSON.stringify(cols.objectives || [{ id: 'o0', type: 'visit', zone: 'zone_regress_nowhere', taskSeconds: 0, count: 1, desc: 'A' }]),
         JSON.stringify(cols.rewards ?? { credits: 100 }),
         JSON.stringify(cols.fail_on || []),
         JSON.stringify(cols.penalties || {})]
      );
      invalidateQuestCache(AUDIT);
      await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, AUDIT]);
      await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: AUDIT } });
    };
    const rowOf = async () => {
      const { rows: rr } = await query('SELECT * FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, AUDIT]);
      return rr[0];
    };

    // ── #1 TURN_IN pays out exactly once ─────────────────────────────────────
    // The old order granted every reward and wrote the status LAST, so two hand-ins
    // racing both passed the status check and both paid. The claim is what stops it,
    // so the test is two CONCURRENT turn-ins, not two sequential ones.
    // The payout itself can't be asserted here — adjustCredits needs a real
    // `players` row and the harness player is in-memory only, so it no-ops. What IS
    // assertable is the claim that gates it: exactly one of the two racing hand-ins
    // may get past the status check, and that is precisely what was broken.
    await mk();
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: AUDIT } });
    let both = await Promise.all([
      dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: AUDIT } }),
      dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: AUDIT } }),
    ]);
    check('exactly one of two concurrent TURN_INs succeeds',
      both.filter(r => r?.turned_in === true).length === 1, JSON.stringify(both.map(r => r?.turned_in)));
    check('…and the loser is refused rather than silently paying out',
      both.filter(r => r?.type === 'error').length === 1, JSON.stringify(both.map(r => r?.type)));
    check('…and the quest ends up turned_in exactly once', (await rowOf())?.status === 'turned_in', (await rowOf())?.status);

    // ── #2 the hot-path gate ─────────────────────────────────────────────────
    // A player with no active quests must not touch the DB on a step. The gate is
    // the Set on the live player; prove the lifecycle maintains it in both
    // directions, since a stale-empty Set would silently stop tracking everything.
    await mk();
    check('starting a quest marks it active on the hot-path gate',
      player._activeQuests?.has(AUDIT) === true, JSON.stringify([...(player._activeQuests || [])]));
    await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: AUDIT } });
    check('ending a quest clears it from the gate',
      player._activeQuests?.has(AUDIT) === false, JSON.stringify([...(player._activeQuests || [])]));
    // An empty gate short-circuits — and must not be able to strand a player who
    // then takes a quest (the START_QUEST path re-marks it, tested above).
    const emptied = new Set();
    const saved = player._activeQuests;
    player._activeQuests = emptied;
    await trackEvent(player, () => true);
    check('an empty gate short-circuits without touching the DB', player._activeQuests === emptied);
    player._activeQuests = saved;

    // ── #3 the read-modify-write race ────────────────────────────────────────
    // Three kills fired in ONE tick, which before serialisation all read the same
    // progress and counted as one.
    await mk({ objectives: [{ id: 'o0', type: 'kill', target: 'regressrat', count: 3, desc: 'Three' }] });
    emit('enemy.killed', { actor: player, enemy: { name: 'regressrat' } });
    emit('enemy.killed', { actor: player, enemy: { name: 'regressrat' } });
    emit('enemy.killed', { actor: player, enemy: { name: 'regressrat' } });
    await sleep(400);
    let row = await rowOf();
    check('three matching events in one tick all count', (row?.progress?.[0] || 0) === 3, JSON.stringify(row?.progress));

    // ── #4 findTurnInNpc is memoised ─────────────────────────────────────────
    const t0 = Date.now(); await findTurnInNpc(AUDIT); const cold = Date.now() - t0;
    const t1 = Date.now(); await findTurnInNpc(AUDIT); const warm = Date.now() - t1;
    check('findTurnInNpc is cached on the second call', warm <= cold, `${cold}ms → ${warm}ms`);
    check('…and a quest edit busts it', (invalidateQuestCache(AUDIT), true));

    // ── #5 progress survives the quest being EDITED ──────────────────────────
    // Two objectives, the SECOND one done. Then delete the first — under index
    // alignment the survivor inherits the dead objective's zero and the player
    // silently loses the work they did.
    await mk({ objectives: [
      { id: 'first', type: 'kill', target: 'aaa', count: 1, desc: 'First' },
      { id: 'second', type: 'kill', target: 'bbb', count: 1, desc: 'Second' },
    ] });
    emit('enemy.killed', { actor: player, enemy: { name: 'bbb' } });
    await sleep(200);
    row = await rowOf();
    check('the second objective is the one that advanced', (row?.progress?.[1] || 0) === 1, JSON.stringify(row?.progress));
    await query('UPDATE quests SET objectives=$2 WHERE id=$1', [AUDIT,
      JSON.stringify([{ id: 'second', type: 'kill', target: 'bbb', count: 1, desc: 'Second' }])]);
    invalidateQuestCache(AUDIT);
    const pq2 = await loadPlayerQuest(player.id, AUDIT);
    check('deleting an objective re-keys progress by id rather than by position',
      (pq2?.progress?.[0] || 0) === 1, JSON.stringify(pq2?.progress));
    check('…and the surviving objective is complete, so the quest is finishable',
      pq2.progress.length === 1, JSON.stringify(pq2?.progress));

    // ── #6 auto-spawned quest items are cleaned up ───────────────────────────
    const SPAWN_ITEM = 'quest_regress_prop';
    const SPAWN_ZONE = 'zone_regress_litter';
    await query(
      `INSERT INTO items (id,name,description,value,weight,tags) VALUES ($1,'Regress Prop','',1,1,'{}')
       ON CONFLICT (id) DO NOTHING`, [SPAWN_ITEM]
    );
    const groundCount = async () => {
      const { rows: g } = await query(
        'SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2',
        [`_ground_${SPAWN_ZONE}`, SPAWN_ITEM]);
      return g[0]?.n || 0;
    };
    await query('DELETE FROM player_inventory WHERE player_id=$1', [`_ground_${SPAWN_ZONE}`]);
    await mk({ objectives: [{ id: 'o0', type: 'retrieve', item_id: SPAWN_ITEM, zone: SPAWN_ZONE, count: 1, desc: 'Fetch' }] });
    check('a retrieve objective spawns its item', (await groundCount()) === 1, String(await groundCount()));
    row = await rowOf();
    check('…and records the row it created', Array.isArray(row?.spawned) && row.spawned.length === 1, JSON.stringify(row?.spawned));
    await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: AUDIT } });
    check('abandoning takes the spawned item back out of the world', (await groundCount()) === 0, String(await groundCount()));

    // Found by the retake case below: START_QUEST only ever re-activated a
    // turned_in+repeatable row, so abandoning a quest BLACKLISTED it forever — the
    // NPC kept offering it and accepting quietly did nothing. Changing your mind is
    // not supposed to be a punishment.
    let re = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: AUDIT } });
    check('an abandoned quest can be taken again', re?.started === true, JSON.stringify(re));
    await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: AUDIT } });
    // Retaking must not stack a second copy on the floor.
    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: AUDIT } });
    await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: AUDIT } });
    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: AUDIT } });
    check('retaking a retrieve quest never stacks copies', (await groundCount()) === 1, String(await groundCount()));
    // An item somebody already PICKED UP is theirs and must never be reclaimed.
    await query('UPDATE player_inventory SET player_id=$1 WHERE player_id=$2', [player.id, `_ground_${SPAWN_ZONE}`]);
    await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: AUDIT } });
    const { rows: held } = await query(
      'SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, SPAWN_ITEM]);
    check('an item already picked up is never yanked back out of inventory', held[0]?.n === 1, JSON.stringify(held[0]));
    await query('DELETE FROM player_inventory WHERE item_id=$1', [SPAWN_ITEM]);

    // ── #7 penalties ─────────────────────────────────────────────────────────
    // Asserted through the FLAG penalty rather than the credit one, for the same
    // harness reason as the turn-in above: credits need a players row, flags don't.
    // The flag landing proves applyPenalties ran on the failure path at all.
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, 'regress_penalty_flag']);
    await mk({
      fail_on: [{ type: 'assassinate', target: 'npc_regress_mark' }],
      penalties: { flags: [{ scope: 'player', flag: 'regress_penalty_flag', value: 'true' }] },
    });
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_mark', name: 'Mark' } });
    await sleep(250);
    const { rows: pf } = await query(
      'SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, 'regress_penalty_flag']);
    check('failing a quest applies its penalties', pf[0]?.flag_value === 'true', JSON.stringify(pf[0]));
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, 'regress_penalty_flag']);

    // …but never into the red. A player who can't buy food because a quest blew is
    // a softlock, not a consequence.
    await mk({ fail_on: [{ type: 'assassinate', target: 'npc_regress_mark' }], penalties: { credits: 999999 } });
    emit('npc.killed', { actor: player, npc: { id: 'npc_regress_mark', name: 'Mark' } });
    await sleep(250);
    check('a penalty never pushes the player below zero', (Number(player.credits) || 0) >= 0, String(player.credits));

    // ── rewards.rep ──────────────────────────────────────────────────────────
    //
    // Until this existed the asymmetry was the whole problem with faction work:
    // `penalties.rep` could take standing off you and nothing could give any, so
    // `adjustReputation` had exactly two callers in the codebase and one of them
    // was a punishment. Standing decays on a 30-day half-life BY DESIGN — it is
    // meant to be kept up — and there was nothing in the game to keep it up with.
    const REP_ORDER = 'ideology_ascendants';
    const repOf = async (id = REP_ORDER) => {
      const { rows: rr } = await query(
        'SELECT reputation FROM player_ideology_rep WHERE player_id=$1 AND ideology_id=$2', [player.id, id]);
      return Number(rr[0]?.reputation) || 0;
    };
    await query('DELETE FROM player_ideology_rep WHERE player_id=$1', [player.id]);

    await mk({ rewards: { credits: 0, rep: [{ ideology: REP_ORDER, delta: 40 }] } });
    check('standing is untouched while the quest is merely active', (await repOf()) === 0, String(await repOf()));
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: AUDIT, index: 0 } });
    await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: AUDIT } });
    check('turning a quest in pays its rewards.rep', (await repOf()) === 40, String(await repOf()));

    // A negative delta is legal here too — an order can pay you in ill will for
    // work you did for somebody else, which is what a cross-faction quest is.
    await mk({ rewards: { credits: 0, rep: [{ ideology: REP_ORDER, delta: -15 }] } });
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: AUDIT, index: 0 } });
    await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: AUDIT } });
    check('a negative rewards.rep entry costs standing', (await repOf()) === 25, String(await repOf()));

    // A reward naming an order that no longer exists must not swallow the hand-in.
    // The objectives were met; the player is owed the rest of the payout and the
    // status flip regardless. This is the mirror of the same guard on penalties.
    await mk({ rewards: { credits: 0, xp: 3, rep: [{ ideology: null, delta: 10 }, { ideology: REP_ORDER, delta: 5 }] } });
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: AUDIT, index: 0 } });
    const repR = await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: AUDIT } });
    check('a malformed rewards.rep entry does not blow the turn-in', repR?.turned_in === true, JSON.stringify(repR)?.slice(0, 120));
    check('…and the well-formed entries beside it still pay', (await repOf()) === 30, String(await repOf()));

    await query('DELETE FROM player_ideology_rep WHERE player_id=$1', [player.id]);

    // ── #8 the quest flag key is the BARE quest id ───────────────────────────
    // The comment claimed a `quest_<id>` prefix the code never applied, so a
    // Condition authored from the comment could never match. Pin the real key.
    await mk();
    const { rows: fl } = await query(
      'SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, AUDIT]);
    check('the quest status flag is keyed by the bare quest id', fl[0]?.flag_value === 'active', JSON.stringify(fl[0]));

    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, AUDIT]);
    await query('DELETE FROM quests WHERE id=$1', [AUDIT]);
    await query('DELETE FROM items WHERE id=$1', [SPAWN_ITEM]);
  }

  // ── quest track / abandon ──────────────────────────────────────────────────
  // Both were tablet buttons only: the Quests app was the sole caller of
  // ABANDON_QUEST and the only writer of `players.tracked_quest_id` anywhere, so
  // a player who didn't use the tablet could take a quest and never drop it.
  {
    // Bare `quest` still means the log — the subcommands must not have stolen it.
    let r = await run('quest');
    check('bare quest is still the log, not a usage error', r?.type !== 'error', JSON.stringify(r)?.slice(0, 120));

    r = await run('quest track something that is not a quest');
    check('quest track on an unheld quest is refused by name',
      r?.type === 'error' || /no active quests/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 140));

    // The destructive one is TWO steps on purpose: the app puts a confirm dialog
    // in front of it, and a modal is the wrong answer for a typed verb (and for a
    // screen reader). The confirmation is a second command they can re-read.
    r = await run('quest abandon nonexistent quest name');
    check('quest abandon on an unheld quest never claims to have abandoned it',
      !/abandoned/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 140));

    // `drop` and `untrack` are aliases; `drop` in particular must not be routed
    // here as a top-level verb (it's the engine's inventory drop).
    r = await run('drop');
    check('the engine drop verb is untouched by quest abandon',
      !/abandon/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));
  }

  // ── Optional objectives ────────────────────────────────────────────────────
  //
  // The property that matters is the finish line: an optional objective is
  // tracked and paid, but a quest whose only outstanding work is optional must be
  // turn-in-able. Getting that backwards yields a quest nobody can hand in, which
  // in play reads as the quest system being broken rather than as a content bug.
  {
    const QID = 'quest_regress_optional';
    await query(
      `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
       VALUES ($1,'Regress Optional','',$2,$3,0,'standard','{}',EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (id) DO UPDATE SET objectives=$2, rewards=$3`,
      [QID, JSON.stringify([
        { id: 'main', type: 'visit', zone: 'zone_nowhere', count: 1, desc: 'The job' },
        { id: 'bonus', type: 'visit', zone: 'zone_nowhere_else', count: 1, desc: 'The favour', optional: true, rewards: { xp: 11 } },
      ]), JSON.stringify({ xp: 5 })]
    );
    invalidateQuestCache(QID);
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, QID]);

    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: QID } });
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: QID, index: 0 } });
    let pq = await loadPlayerQuest(player.id, QID);
    check('a quest completes with an optional objective outstanding',
      pq?.status === 'completed', JSON.stringify(pq?.status));

    // Paid in XP rather than credits on purpose: the harness player is in-memory
    // and has no players row, so adjustCredits legitimately writes nothing, while
    // the XP mirror on the live object moves. Same payment path either way.
    const before = Number(player.total_xp) || 0;
    const netBefore = Number(player.xp) || 0;
    let r = await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: QID } });
    check('TURN_IN pays out with the optional objective skipped', r?.turned_in === true, JSON.stringify(r));
    check('a SKIPPED optional objective pays no bonus',
      (Number(player.total_xp) || 0) - before === 5, `${before} → ${player.total_xp}`);

    // And the other way round: the bonus is paid when the optional work was done.
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, QID]);
    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: QID } });
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: QID, index: 1 } });
    pq = await loadPlayerQuest(player.id, QID);
    check('an optional objective alone does NOT complete the quest',
      pq?.status === 'active', JSON.stringify(pq?.status));
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: QID, index: 0 } });
    const before2 = Number(player.total_xp) || 0;
    await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: QID } });
    check('a MET optional objective pays its own bonus on top',
      (Number(player.total_xp) || 0) - before2 === 16, `${before2} → ${player.total_xp}`);
    // The XP mirror is shared state for the whole suite — put it back.
    player.total_xp = before; player.xp = netBefore;

    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, QID]);
    await query('DELETE FROM quests WHERE id=$1', [QID]);
    invalidateQuestCache(QID);
  }

  // ── on_fail / on_turn_in — a quest hands you the next one ──────────────────
  //
  // Both go through the ordinary START_QUEST action, so what is tested here is
  // the wiring and the loop guard, not the starting. The guard is the part that
  // matters: a pair of quests each naming the other would otherwise spin.
  {
    const A = 'quest_regress_chain_a';
    const B = 'quest_regress_chain_b';
    const mk = (id, name, objectives, extra = {}) => query(
      `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,fail_on,on_fail,on_turn_in,updated_at)
       VALUES ($1,$2,'',$3,'{}',0,'standard','{}',$4,$5,$6,EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (id) DO UPDATE SET objectives=$3, fail_on=$4, on_fail=$5, on_turn_in=$6`,
      [id, name, JSON.stringify(objectives), JSON.stringify(extra.fail_on || []),
       JSON.stringify(extra.on_fail || null), JSON.stringify(extra.on_turn_in || null)]
    );
    const obj = [{ id: 'go', type: 'visit', zone: 'zone_nowhere', count: 1, desc: 'Go' }];

    await mk(A, 'Regress Chain A', obj, { on_turn_in: { start_quest: B }, on_fail: { start_quest: B } });
    await mk(B, 'Regress Chain B', obj, { on_fail: { start_quest: A } });
    invalidateQuestCache(A); invalidateQuestCache(B);
    for (const id of [A, B]) await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, id]);

    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: A } });
    await dispatchAction({ type: 'ADVANCE', actor: player, params: { quest_id: A, index: 0 } });
    await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: A } });
    let pqB = await loadPlayerQuest(player.id, B);
    check('on_turn_in starts the follow-up quest', pqB?.status === 'active', JSON.stringify(pqB?.status));

    // B is live and names A on failure; A is turned_in and not repeatable, so the
    // follow-up must be refused rather than resurrecting a finished quest.
    await dispatchAction({ type: 'FAIL_QUEST', actor: player, params: { quest_id: B, reason: 'testing' } });
    const pqA = await loadPlayerQuest(player.id, A);
    check('a follow-up never re-opens a quest that is already finished',
      pqA?.status === 'turned_in', JSON.stringify(pqA?.status));

    // And the live-quest guard: failing A again would try to start B, which is
    // itself failed and therefore retryable — the guard only blocks LIVE ones, so
    // this asserts the shape rather than a blanket refusal.
    await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, A]);
    await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: A } });
    await dispatchAction({ type: 'FAIL_QUEST', actor: player, params: { quest_id: A, reason: 'testing' } });
    pqB = await loadPlayerQuest(player.id, B);
    check('on_fail restarts a follow-up that is not currently live',
      pqB?.status === 'active', JSON.stringify(pqB?.status));

    for (const id of [A, B]) {
      await query('DELETE FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, id]);
      await query('DELETE FROM quests WHERE id=$1', [id]);
      invalidateQuestCache(id);
    }
  }
}
