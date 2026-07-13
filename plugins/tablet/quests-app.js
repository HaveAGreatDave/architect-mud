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
    // Did we drill in from the Job Board list? The origin arrives as the screen
    // token (data-open-item passes the current breadcrumb), and we echo it back in
    // the detail breadcrumb so a live-refresh keeps it. When true, the accept/turn-in
    // buttons use the board's own plain-language verbs ("Take Job"/"Hand In") instead
    // of the generic quest labels — the "it's not clear what I'm doing" fix.
    const fromBoard = normScreen(screenId) === 'job board';
    const row = rows.find(r => r.quest_id === questId);
    if (row) {
      const progress = Array.isArray(row.progress) ? row.progress : [];
      const complete = row.status === 'completed' || isComplete(row, progress);
      const actions = [];
      if (!complete) {
        const tracking = player.tracked_quest_id === row.quest_id;
        actions.push({ id: 'track', label: tracking ? 'Tracking' : 'Track' });
        // Once tracked, an Auto button lets the player auto-travel to the next stop
        // straight from here — no detour to the minimap. It re-plots + auto-walks
        // client-side (handled specially in tablet-os.js's action wiring).
        if (tracking) actions.push({ id: 'autowalk', label: 'Auto' });
      }
      if (complete) actions.push({ id: 'turnin', label: fromBoard ? 'Hand In Job' : 'Turn In' });
      actions.push({ id: 'abandon', label: fromBoard ? 'Drop Job' : 'Abandon' });
      return {
        view: 'detail',
        breadcrumb: [fromBoard ? 'Job Board' : (row.category || defaultCategory(row)), row.name],
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
      breadcrumb: [fromBoard ? 'Job Board' : (quest.category || defaultCategory(quest)), quest.name],
      quest: {
        id: quest.id, name: quest.name, description: quest.description || '',
        status: 'open',
        objectives: objectivePayload(quest, []),
        rewards: quest.rewards || {},
        tracked: false,
      },
      actions: [{ id: quest.quest_type === 'flight' ? 'accept_flight' : 'accept', label: fromBoard ? 'Take Job' : 'Accept' }],
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
      // Badge/sub say the VERB, not the internal state name — a player reading
      // "OPEN"/"READY" couldn't tell what tapping does. badgeLabel overrides the
      // badge text while `badge` still drives its colour class (renderList).
      items: jobs.map(({ quest, pq }) => {
        const state = jobState(quest, pq);
        let sub, badgeLabel;
        if (state === 'ready') { sub = 'Finished — tap to hand it in for pay'; badgeLabel = 'HAND IN'; }
        else if (state === 'active') { const { have, need } = progressTotals(quest, pq); sub = `In progress — ${have}/${need} done`; badgeLabel = 'IN PROGRESS'; }
        else { sub = `${creditsOf(quest)}₵ on completion — tap to take the job`; badgeLabel = 'TAKE'; }
        return { id: quest.id, label: quest.name, sub, badge: state, badgeLabel };
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
          sendToPlayer(player.id, { type: 'gps_route', message: `GPS locked: ${destZone.name}. Route plotted on the map.`, path, continueOnArrival: false });
        }
      }
    }
    return buildScreen(player, null, questId);
  }

  // Auto-travel: plot a fresh route to the tracked quest's next unmet zone
  // objective and tell the client to start auto-walking it (the walk itself is
  // client-side — client/game/js/panels/minimap.js — armed by the gps_route's
  // `autostart` flag). Re-derived here every click so the destination always
  // tracks the CURRENT next stop as earlier objectives complete. The tablet stays
  // open on this detail so its checkboxes tick as each stop is reached en route.
  if (actionId === 'autowalk') {
    const { rows } = await query('SELECT objectives FROM quests WHERE id=$1', [questId]);
    const quest = rows[0];
    const { rows: pqRows } = await query('SELECT progress FROM player_quests WHERE player_id=$1 AND quest_id=$2', [player.id, questId]);
    const progress = Array.isArray(pqRows[0]?.progress) ? pqRows[0].progress : [];
    const objectives = quest?.objectives || [];
    const next = objectives.find((obj, i) => obj.zone && (progress[i] || 0) < (obj.count || 1));
    const note = (m) => sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${m}</span>` });
    if (!next) note('Nothing left to travel to on this one.');
    else if (next.zone === player.current_zone) note("You're already at the next stop — do the work here.");
    else {
      const destZone = getZone(next.zone);
      const path = destZone ? findPath(player.current_zone, next.zone) : null;
      if (!path || path.length < 2) note("Can't plot a route there from here.");
      else sendToPlayer(player.id, { type: 'gps_route', message: `Auto-travel to ${destZone.name}. Setting off…`, path, autostart: true, continueOnArrival: true });
    }
    return buildScreen(player, null, questId);
  }

  if (actionId === 'turnin') {
    // Turn-in is an IN-PERSON hand-in: you must physically bring the finished job
    // back to the NPC it's handed to (findTurnInNpc) — the giver for an authored
    // quest, or Marta the dispatcher for a job-board gig. If the player isn't
    // standing in that NPC's zone, refuse the hand-in and plot a GPS route to them
    // instead of completing it remotely (the tablet stays open on this quest).
    const npcInfo = await findTurnInNpc(questId);
    if (npcInfo && npcInfo.zone && npcInfo.zone !== player.current_zone) {
      const destZone = getZone(npcInfo.zone);
      const path = destZone ? findPath(player.current_zone, npcInfo.zone) : null;
      if (path && path.length >= 2) {
        const hops = path.length - 1;
        sendToPlayer(player.id, {
          type: 'gps_route',
          message: `Bring it to ${npcInfo.npcName} in person — ${destZone.name} (${hops} stop${hops === 1 ? '' : 's'} away). Route plotted.`,
          path, resumeAuto: true, continueOnArrival: true,
        });
      } else {
        sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">Take it to ${npcInfo.npcName} to hand it in.</span>` });
      }
      return buildScreen(player, null, questId);
    }
    if (npcInfo) {
      const { rows: npcRows } = await query('SELECT * FROM npcs WHERE id=$1', [npcInfo.npcId]);
      const npc = npcRows[0];
      // A dispatcher (job board) hands in at a dedicated `job_turnin` node whose
      // context-driven TURN_IN action pays out the moment it renders; a per-quest
      // giver has no such node, so land on `root` and let the player click through
      // its (completion-gated) "report back" option to complete the hand-in.
      const node = npcInfo.node || 'root';
      const { rows: qn } = await query('SELECT name FROM quests WHERE id=$1', [questId]);
      const rendered = npc && await renderDialogueNode(npc, node, player, { broadcast: null, npc, quest_id: questId, quest_name: qn[0]?.name || 'the job' });
      if (rendered) {
        // If we landed on a dedicated hand-in node, TURN_IN already fired and paid
        // out during render — clear tracking to match. (The `root` path defers the
        // turn-in to the player's click, so it must NOT clear here.)
        if (node !== 'root' && player.tracked_quest_id === questId) {
          player.tracked_quest_id = null;
          await query('UPDATE players SET tracked_quest_id=NULL WHERE id=$1', [player.id]);
        }
        // Known limitation: this bypasses server/index.js's WS dialogue session
        // (it has no cross-module accessor), so the player's *first* click here
        // won't resolve option-level actions (only node-level ones — which is
        // what TURN_IN is authored as on every quest-giving NPC today). The
        // session self-heals on that first click regardless.
        sendToPlayer(player.id, { type: 'dialogue', npcId: npc.id, npcName: npc.name, node, text: rendered.text, options: rendered.options });
        return { type: 'tablet_close' };
      }
      // Fall through to the direct grant if the NPC/node has since vanished — a
      // finished quest must never be un-turn-in-able (anti-stuck guarantee).
    }

    // No NPC tied to this quest (e.g. a flight contract) or its dialogue vanished:
    // grant directly so the hand-in always resolves.
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
