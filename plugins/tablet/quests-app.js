// Tablet OS — Quests app. Wraps the existing quest plugin's data/lifecycle
// (plugins/quests/index.js) in the Tablet's two-pane list->detail shape; adds no
// new quest logic of its own. Registers itself with the tablet plugin at import
// time (imported once from plugins/tablet/index.js's module init).
//
// Categories: quests.category (new column) groups the list view. Falls back to a
// sensible default derived from quest_type for older/uncategorized rows so
// existing content (jobboard postings, flight contract templates) sorts sanely
// without an authoring pass:
//   quest_type='flight'          -> 'Pilot Contracts'
//   quest_type='flight_template' -> (never surfaced directly — archetypes only)
//   otherwise                    -> 'Quests' (jobboard postings included, since a
//                                    job IS just a quest row; Job Board itself is
//                                    reached as its own tile below, sourced from
//                                    the live board rather than the category list)
import { query } from '../../server/models/db.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { getZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { registerTabletApp, normScreen } from './registry.js';
import { findTurnInNpc } from '../quests/index.js';
import { renderDialogueNode } from '../../server/engine/dialogue.js';

function defaultCategory(quest) {
  if (quest.quest_type === 'flight') return 'Pilot Contracts';
  return 'Quests';
}

function isComplete(quest, progress) {
  return (quest.objectives || []).every((o, i) => (progress[i] || 0) >= (o.count || 1));
}

async function myQuestRows(playerId) {
  const { rows } = await query(
    `SELECT pq.*, q.name, q.description, q.objectives, q.rewards, q.category, q.quest_type, q.meta
     FROM player_quests pq JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status NOT IN ('turned_in','abandoned')
     ORDER BY pq.started_at`,
    [playerId]
  );
  return rows;
}

function objectivePayload(quest, progress) {
  const objectives = quest.objectives || [];
  return objectives.map((obj, i) => {
    const need = obj.count || 1;
    const have = Math.min(progress[i] || 0, need);
    return {
      desc: obj.desc || `${obj.type} ${obj.target || obj.item_id || obj.zone || ''}`.trim(),
      have, need, done: have >= need,
    };
  });
}

// ── Home tile: active quest count, grouped by category ──────────────────────
async function buildHome(player) {
  const rows = await myQuestRows(player.id);
  return { count: rows.length };
}

// ── Screens ───────────────────────────────────────────────────────────────
// screenId null/'' -> category list. screenId = category name -> quest list.
// params = quest_id -> quest detail.
async function buildScreen(player, screenId, params) {
  const rows = await myQuestRows(player.id);
  const questId = (params || '').trim();

  // Detail view: a specific quest. Covers both an already-taken quest (row from
  // player_quests) and an open Job Board posting the player hasn't accepted yet
  // (no player_quests row — read straight from `quests`).
  if (questId) {
    const row = rows.find(r => r.quest_id === questId);
    if (row) {
      const progress = Array.isArray(row.progress) ? row.progress : [];
      const complete = row.status === 'completed' || isComplete(row, progress);
      const actions = [];
      if (!complete) actions.push({ id: 'track', label: player.tracked_quest_id === row.quest_id ? 'Tracking' : 'Track' });
      if (complete) actions.push({ id: 'turnin', label: 'Turn In' });
      actions.push({ id: 'abandon', label: 'Abandon' });
      return {
        view: 'detail',
        breadcrumb: [row.category || defaultCategory(row), row.name],
        quest: {
          id: row.quest_id, name: row.name, description: row.description || '',
          status: complete ? 'ready' : 'active',
          objectives: objectivePayload(row, progress),
          rewards: row.rewards || {},
          tracked: player.tracked_quest_id === row.quest_id,
        },
        actions,
      };
    }
    // Not yet taken — an open posting (Job Board / Pilot Contracts board).
    const { rows: qRows } = await query('SELECT * FROM quests WHERE id=$1', [questId]);
    const quest = qRows[0];
    if (!quest) return { view: 'error', message: 'Quest not found or no longer active.' };
    return {
      view: 'detail',
      breadcrumb: [quest.category || defaultCategory(quest), quest.name],
      quest: {
        id: quest.id, name: quest.name, description: quest.description || '',
        status: 'open',
        objectives: objectivePayload(quest, []),
        rewards: quest.rewards || {},
        tracked: false,
      },
      actions: [{ id: quest.quest_type === 'flight' ? 'accept_flight' : 'accept', label: 'Accept' }],
    };
  }

  // Pilot Contracts — sourced live from the flight plugin's per-field board (same
  // data `contracts`/`jobs` used to text-render). Reuses flight's own topUp/
  // boardRows so the rotation and qualification math stay in one place.
  const screenNorm = normScreen(screenId);
  if (screenNorm === 'pilot contracts') {
    const flight = await import('../flight/contracts.js');
    const { fieldFor } = await import('../flight/state.js');
    const field = fieldFor(player);
    if (!field) return { view: 'error', message: 'The contract board is at the airfields.' };
    const fields = await flight.airfields();
    await flight.topUp(field, fields);
    const { rows: board } = await flight.boardRows(field.id);
    const nameOf = (id) => fields.find(f => f.id === id)?.name || id;
    return {
      view: 'list',
      breadcrumb: ['Pilot Contracts'],
      boardName: field.flags?.airfield_name || field.name,
      items: board.map((q, i) => {
        const m = q.meta || {};
        return {
          id: q.id, label: q.name,
          sub: `${m.cargoName} → ${nameOf(m.destZone)} · ${m.weight}kg · risk ${m.risk}/5 · ${q.rewards?.credits || 0}c${m.contraband ? ' · ILLEGAL' : ''}`,
          badge: m.contraband ? 'illegal' : 'open',
          // Board position is what flight's own `accept <n>` expects — stash it
          // so the detail screen's Accept action can call the real qualification-
          // checked handler instead of dispatching START_QUEST directly.
          boardIndex: i + 1,
        };
      }),
    };
  }

  // Job Board — sourced live from the jobboard plugin's rotation (same data
  // `gigs`/`read <board>` used to text-render), not the player's own quest log,
  // since a posting the player hasn't taken yet still needs to show up here.
  if (screenNorm === 'job board') {
    const { boardInZone, activeJobIds, loadJobs, jobState, progressTotals, creditsOf } = await import('../jobboard/index.js');
    const board = await boardInZone(player.current_zone);
    if (!board) return { view: 'error', message: "There's no job board here." };
    const jobs = await loadJobs(await activeJobIds(board), player.id);
    return {
      view: 'list',
      breadcrumb: ['Job Board'],
      boardName: board.name,
      items: jobs.map(({ quest, pq }) => {
        const state = jobState(quest, pq);
        const sub = state === 'ready' ? 'Ready to turn in'
          : state === 'active' ? (() => { const { have, need } = progressTotals(quest, pq); return `In progress (${have}/${need})`; })()
          : `${creditsOf(quest)}c — open`;
        return { id: quest.id, label: quest.name, sub, badge: state };
      }),
    };
  }

  // List view: quests within one category.
  if (screenId) {
    const inCat = rows.filter(r => normScreen(r.category || defaultCategory(r)) === screenNorm);
    const catLabel = inCat[0] ? (inCat[0].category || defaultCategory(inCat[0])) : screenId;
    return {
      view: 'list',
      breadcrumb: [catLabel],
      items: inCat.map(r => {
        const progress = Array.isArray(r.progress) ? r.progress : [];
        const complete = r.status === 'completed' || isComplete(r, progress);
        return {
          id: r.quest_id, label: r.name,
          sub: complete ? 'Ready to turn in' : `${objectivePayload(r, progress).filter(o => o.done).length}/${(r.objectives || []).length} objectives`,
          badge: complete ? 'ready' : 'active',
        };
      }),
    };
  }

  // Root: category list.
  const byCat = new Map();
  for (const r of rows) {
    const cat = r.category || defaultCategory(r);
    byCat.set(cat, (byCat.get(cat) || 0) + 1);
  }
  return {
    view: 'categories',
    breadcrumb: [],
    items: [...byCat.entries()].map(([cat, count]) => ({ id: cat, label: cat, sub: `${count} active` })),
  };
}

// ── Actions ───────────────────────────────────────────────────────────────
async function handleAction(player, actionId, params) {
  const questId = (params || '').trim();
  if (!questId) return buildScreen(player, null, '');

  if (actionId === 'accept') {
    const res = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: questId } });
    if (res?.type === 'error') return { view: 'error', message: res.message };
    return buildScreen(player, null, questId);
  }

  // Pilot Contracts accept — the flight plugin's own `accept <n>` (board
  // position, not quest_id) runs the real aircraft qualification/weight-&-
  // balance checks (plugins/flight/contracts.js cmdAccept). Re-derive the
  // board position for this quest_id rather than dispatching START_QUEST
  // ourselves, so that logic isn't duplicated here.
  if (actionId === 'accept_flight') {
    const flightMod = await import('../flight/contracts.js');
    const { rows: qRows } = await query('SELECT meta FROM quests WHERE id=$1', [questId]);
    const originZone = qRows[0]?.meta?.originZone;
    if (!originZone) return { view: 'error', message: 'That posting is no longer on the board.' };
    const { rows: board } = await flightMod.boardRows(originZone);
    const idx = board.findIndex(q => q.id === questId);
    if (idx === -1) return { view: 'error', message: 'That posting is no longer on the board.' };
    const res = await flightMod.commands.accept([String(idx + 1)], `accept ${idx + 1}`, player);
    if (res?.type === 'error' || res?.type === 'emote') return { view: 'error', message: res.message };
    return buildScreen(player, 'Pilot Contracts', '');
  }

  if (actionId === 'track') {
    const { rows } = await query('SELECT * FROM quests WHERE id=$1', [questId]);
    const quest = rows[0];
    const already = player.tracked_quest_id === questId;
    player.tracked_quest_id = already ? null : questId;
    await query('UPDATE players SET tracked_quest_id=$1 WHERE id=$2', [player.tracked_quest_id, player.id]);

    if (player.tracked_quest_id && quest) {
      const { rows: pqRows } = await query('SELECT progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, questId]);
      const progress = Array.isArray(pqRows[0]?.progress) ? pqRows[0].progress : [];
      const objectives = quest.objectives || [];
      const next = objectives.find((obj, i) => obj.zone && (progress[i] || 0) < (obj.count || 1));
      if (next && next.zone !== player.current_zone) {
        const destZone = getZone(next.zone);
        const path = destZone ? findPath(player.current_zone, next.zone) : null;
        if (path && path.length >= 2) {
          sendToPlayer(player.id, { type: 'gps_route', message: `GPS locked: ${destZone.name}. Route plotted on the map.`, path });
        }
      }
    }
    return buildScreen(player, null, questId);
  }

  if (actionId === 'turnin') {
    // A quest turned in through an NPC's dialogue (as opposed to a physical
    // job board or a flight contract's landing check) has to actually be
    // handed to that NPC — respect that instead of instant-granting from the
    // tablet: route the player there if they're elsewhere, or hand off into
    // the NPC's real dialogue (which now hides "report back" until the quest
    // Flag says 'completed' — see engine/dialogue.js) if they're already here.
    const npcInfo = await findTurnInNpc(questId);
    if (npcInfo) {
      if (player.current_zone !== npcInfo.zone) {
        const destZone = getZone(npcInfo.zone);
        const path = destZone ? findPath(player.current_zone, npcInfo.zone) : null;
        if (path && path.length >= 2) {
          sendToPlayer(player.id, { type: 'gps_route', message: `GPS locked: ${destZone.name}. Route plotted on the map.`, path });
        }
        return { view: 'error', message: `${npcInfo.npcName} is the one who needs this — head to ${destZone?.name || npcInfo.zone} to turn it in.` };
      }
      const { rows: npcRows } = await query('SELECT * FROM npcs WHERE id=$1', [npcInfo.npcId]);
      const npc = npcRows[0];
      const rendered = npc && await renderDialogueNode(npc, 'root', player, { broadcast: null, npc });
      if (rendered) {
        // Known limitation: this bypasses server/index.js's WS dialogue session
        // (it has no cross-module accessor), so the player's *first* click here
        // won't resolve option-level actions (only node-level ones — which is
        // what TURN_IN is authored as on every quest-giving NPC today). The
        // session self-heals on that first click regardless.
        sendToPlayer(player.id, { type: 'dialogue', npcId: npc.id, npcName: npc.name, node: 'root', text: rendered.text, options: rendered.options });
        return { type: 'tablet_close' };
      }
      // Fall through to the direct grant if the NPC/root node has since vanished.
    }

    const res = await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: questId } });
    if (res?.type === 'error') return { view: 'error', message: res.message };
    if (player.tracked_quest_id === questId) {
      player.tracked_quest_id = null;
      await query('UPDATE players SET tracked_quest_id=NULL WHERE id=$1', [player.id]);
    }
    return buildScreen(player, null, '');
  }

  if (actionId === 'abandon') {
    await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: questId } });
    if (player.tracked_quest_id === questId) {
      player.tracked_quest_id = null;
      await query('UPDATE players SET tracked_quest_id=NULL WHERE id=$1', [player.id]);
    }
    return buildScreen(player, null, '');
  }

  return buildScreen(player, null, questId);
}

registerTabletApp({
  id: 'quests', name: 'Quests', icon: '📋', category: 'Progression',
  buildHome, buildScreen, handleAction,
});
