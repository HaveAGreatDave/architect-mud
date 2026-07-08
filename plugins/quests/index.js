/**
 * Quest plugin (Phase 5).
 *
 * A Quest is a goal with objectives, tracked per player. Objectives advance by
 * SUBSCRIBING to Events (enemy.killed, item.given, zone.entered) — the kill/give/
 * move code never references quests (ADR-0002, CONTEXT.md). Quest lifecycle is
 * driven through Actions (START_QUEST / ADVANCE / COMPLETE / TURN_IN), so dialogue
 * nodes and scripts start and turn in quests through the one canonical mutation
 * path like everything else (ADR-0001). Registering those Actions here is what
 * "un-stubs" the quest dialogue-actions — the dialogue handler already dispatches
 * whatever action a node names.
 *
 * Objective shape (quests.objectives JSONB array):
 *   { type:'kill',  target:'rat', count:3, desc:'Kill 3 rats' }
 *   { type:'give',  item_id:'pie', count:1, desc:'Hand over the pie' }
 *   { type:'visit', zone:'zone_sewers',     desc:'Reach the sewers' }
 * Any objective (any type) may also carry a `zone`. Whenever the current
 * objective changes — quest started, ADVANCE'd, or ticked forward by
 * trackEvent — the player's first incomplete zone-bearing objective is
 * auto-piped to the client as a gps_route (see routeToObjective below),
 * which the minimap/bigmap render as a route trace, same as the `gps` command.
 * Jobs (plugins/jobboard) are just quest rows started via START_QUEST/TURN_IN,
 * so they get this for free.
 * Reward shape (quests.rewards JSONB):
 *   { credits:50, items:[{item_id,quantity}], flags:[{scope,flag,value}] }
 */
import { query } from '../../server/models/db.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { on, emit } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { setFlag } from '../../server/engine/flags.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { getZone } from '../../server/engine/world.js';

// Mirror a quest's status into a player Flag (`quest_<id>` = active|completed|
// turned_in) so Dialogue/Script Conditions can gate options on quest state through
// the existing Flag mechanism — e.g. hide "Accept" once the flag is set, show
// "Turn in" only while it equals 'completed' (CONTEXT.md: Flags are the state
// Conditions read).
function setQuestFlag(actor, questId, status) {
  return setFlag('player', questId, status, actor);
}

// --- Store helpers ---------------------------------------------------------

async function loadQuest(questId) {
  const { rows } = await query('SELECT * FROM quests WHERE id=$1', [questId]);
  return rows[0] || null;
}

async function loadPlayerQuest(playerId, questId) {
  const { rows } = await query(
    'SELECT * FROM player_quests WHERE player_id=$1 AND quest_id=$2',
    [playerId, questId]
  );
  return rows[0] || null;
}

function freshProgress(quest) {
  return (quest.objectives || []).map(() => 0);
}

function isComplete(quest, progress) {
  return (quest.objectives || []).every((obj, i) => (progress[i] || 0) >= (obj.count || 1));
}

// Gating: an objective is unlocked only once every objective it `requires` (by id)
// is met. `requires` holds objective ids authored in VINE as prerequisite edges;
// an unknown/dangling id never blocks. `progress` is the snapshot to judge against.
function requiresMet(objectives, obj, progress) {
  if (!Array.isArray(obj.requires) || !obj.requires.length) return true;
  return obj.requires.every((rid) => {
    const ri = objectives.findIndex((o) => o.id === rid);
    if (ri === -1) return true;
    return (progress[ri] || 0) >= (objectives[ri].count || 1);
  });
}

function msg(playerId, text) {
  sendToPlayer(playerId, { type: 'output', message: text });
}

// Auto-GPS: point the player's minimap/bigmap at whatever zone their next
// incomplete objective needs them at (any objective type carrying a `zone`,
// not just 'visit' — e.g. a 'kill' objective authored with a hunting-ground
// zone). Reuses the same gps_route message plugins/gps/index.js sends, which
// the client already renders as a route trace (client/game/js/panels/minimap.js).
function routeToObjective(actor, quest, progress) {
  const objectives = quest.objectives || [];
  const next = objectives.find((obj, i) => obj.zone && (progress[i] || 0) < (obj.count || 1));
  if (!next) return;
  if (next.zone === actor.current_zone) return;
  const destZone = getZone(next.zone);
  if (!destZone) return;
  const path = findPath(actor.current_zone, next.zone);
  if (!path || path.length < 2) return;
  const hops = path.length - 1;
  sendToPlayer(actor.id, {
    type: 'gps_route',
    message: `GPS locked: ${destZone.name} (${hops} stop${hops === 1 ? '' : 's'} away). Route plotted on the map.`,
    path,
  });
}

function objectiveLine(obj, done, locked) {
  const label = obj.desc || `${obj.type} ${obj.target || obj.item_id || obj.zone || ''}`.trim();
  const need = obj.count || 1;
  const have = Math.min(done, need);
  if (locked) return `  [-] ${label} (locked)`;
  return `  [${have >= need ? 'X' : ' '}] ${label}${need > 1 ? ` (${have}/${need})` : ''}`;
}

// --- Objective tracking (event subscribers) --------------------------------
//
// trackEvent walks a player's active quests and bumps any objective the predicate
// matches. When all objectives are met the quest flips to 'completed' (ready to
// turn in). One UPDATE per affected quest; no-op when nothing matches.
async function trackEvent(actor, predicate) {
  if (!actor?.id) return;
  const { rows } = await query(
    "SELECT * FROM player_quests WHERE player_id=$1 AND status='active'",
    [actor.id]
  );
  for (const pq of rows) {
    const quest = await loadQuest(pq.quest_id);
    if (!quest) continue;
    const objectives = quest.objectives || [];
    const progress = Array.isArray(pq.progress) ? pq.progress.slice() : [];
    while (progress.length < objectives.length) progress.push(0);

    let changed = false;
    const before = progress.slice(); // judge gating against pre-tick state
    objectives.forEach((obj, i) => {
      const need = obj.count || 1;
      if ((progress[i] || 0) >= need) return;
      if (!requiresMet(objectives, obj, before)) return; // locked until prerequisites done
      if (predicate(obj)) { progress[i] = (progress[i] || 0) + 1; changed = true; }
    });
    if (!changed) continue;

    const done = isComplete(quest, progress);
    await query(
      `UPDATE player_quests SET progress=$1, status=$2, updated_at=EXTRACT(EPOCH FROM NOW())
       WHERE player_id=$3 AND quest_id=$4`,
      [JSON.stringify(progress), done ? 'completed' : 'active', actor.id, quest.id]
    );
    emit('quest.advanced', { actor, quest_id: quest.id, progress });
    if (done) {
      await setQuestFlag(actor, quest.id, 'completed');
      msg(actor.id, `<span class="msg-system">Quest complete: ${quest.name}. Return to turn it in.</span>`);
      emit('quest.completed', { actor, quest_id: quest.id });
    } else {
      msg(actor.id, `<span class="msg-system">Quest updated: ${quest.name}.</span>`);
      routeToObjective(actor, quest, progress);
    }
  }
}

on('enemy.killed', ({ actor, enemy }) => {
  const name = (enemy?.name || '').toLowerCase();
  return trackEvent(actor, (obj) =>
    obj.type === 'kill' && obj.target && name.includes(String(obj.target).toLowerCase()));
});

on('item.given', ({ recipient, item }) => {
  // The GIVE Action's payload: actor gave `item` (an inventory row) to `recipient`.
  // A 'give' objective belongs to the receiving player.
  return trackEvent(recipient, (obj) =>
    obj.type === 'give' && obj.item_id && item?.item_id === obj.item_id);
});

on('zone.entered', ({ actor, zone }) => {
  return trackEvent(actor, (obj) => obj.type === 'visit' && obj.zone === zone);
});

// --- Lifecycle Actions -----------------------------------------------------

registerAction({
  type: 'START_QUEST',
  handler: async ({ actor, params }) => {
    const { quest_id } = params;
    if (!quest_id) return { type: 'error', message: 'START_QUEST requires quest_id.' };
    const quest = await loadQuest(quest_id);
    if (!quest) return { type: 'error', message: `Unknown quest: ${quest_id}` };

    const existing = await loadPlayerQuest(actor.id, quest_id);
    if (existing) {
      if (existing.status === 'turned_in' && quest.repeatable) {
        await query(
          `UPDATE player_quests SET status='active', progress=$1, started_at=EXTRACT(EPOCH FROM NOW()),
           updated_at=EXTRACT(EPOCH FROM NOW()) WHERE player_id=$2 AND quest_id=$3`,
          [JSON.stringify(freshProgress(quest)), actor.id, quest_id]
        );
      } else {
        return { type: 'quest', quest_id, started: false };
      }
    } else {
      await query(
        'INSERT INTO player_quests (player_id,quest_id,status,progress) VALUES ($1,$2,$3,$4)',
        [actor.id, quest_id, 'active', JSON.stringify(freshProgress(quest))]
      );
    }
    await setQuestFlag(actor, quest_id, 'active');
    msg(actor.id, `<span class="msg-system">New quest: ${quest.name}.</span>\n${quest.description || ''}`);
    emit('quest.started', { actor, quest_id });
    routeToObjective(actor, quest, freshProgress(quest));
    return { type: 'quest', quest_id, started: true, name: quest.name };
  },
});

// Manual objective bump (dialogue/script "advance quest"). Defaults to objective 0.
registerAction({
  type: 'ADVANCE',
  handler: async ({ actor, params }) => {
    const { quest_id, index = 0, amount = 1 } = params;
    if (!quest_id) return { type: 'error', message: 'ADVANCE requires quest_id.' };
    const quest = await loadQuest(quest_id);
    const pq = quest && await loadPlayerQuest(actor.id, quest_id);
    if (!pq || pq.status !== 'active') return { type: 'error', message: 'No active quest to advance.' };

    const objectives = quest.objectives || [];
    const progress = Array.isArray(pq.progress) ? pq.progress.slice() : [];
    while (progress.length < objectives.length) progress.push(0);
    const need = objectives[index]?.count || 1;
    progress[index] = Math.min(need, (progress[index] || 0) + amount);

    const done = isComplete(quest, progress);
    await query(
      `UPDATE player_quests SET progress=$1, status=$2, updated_at=EXTRACT(EPOCH FROM NOW())
       WHERE player_id=$3 AND quest_id=$4`,
      [JSON.stringify(progress), done ? 'completed' : 'active', actor.id, quest_id]
    );
    emit('quest.advanced', { actor, quest_id, progress });
    if (done) { await setQuestFlag(actor, quest_id, 'completed'); emit('quest.completed', { actor, quest_id }); }
    else routeToObjective(actor, quest, progress);
    return { type: 'quest', quest_id, progress, completed: done };
  },
});

// Force a quest to 'completed' if its objectives are met (rarely needed — tracking
// flips status automatically — but available to dialogue/scripts).
registerAction({
  type: 'COMPLETE',
  handler: async ({ actor, params }) => {
    const { quest_id } = params;
    if (!quest_id) return { type: 'error', message: 'COMPLETE requires quest_id.' };
    const quest = await loadQuest(quest_id);
    const pq = quest && await loadPlayerQuest(actor.id, quest_id);
    if (!pq) return { type: 'error', message: 'Quest not started.' };
    if (!isComplete(quest, pq.progress || [])) return { type: 'error', message: 'Objectives not yet met.' };
    await query(
      "UPDATE player_quests SET status='completed', updated_at=EXTRACT(EPOCH FROM NOW()) WHERE player_id=$1 AND quest_id=$2",
      [actor.id, quest_id]
    );
    await setQuestFlag(actor, quest_id, 'completed');
    emit('quest.completed', { actor, quest_id });
    return { type: 'quest', quest_id, completed: true };
  },
});

registerAction({
  type: 'TURN_IN',
  handler: async ({ actor, params, context }) => {
    const { quest_id } = params;
    if (!quest_id) return { type: 'error', message: 'TURN_IN requires quest_id.' };
    const quest = await loadQuest(quest_id);
    const pq = quest && await loadPlayerQuest(actor.id, quest_id);
    if (!pq) return { type: 'error', message: 'You have not started that quest.' };
    if (pq.status === 'turned_in') {
      msg(actor.id, `<span class="msg-system">You have already turned in ${quest.name}.</span>`);
      return { type: 'error', message: 'Already turned in.' };
    }
    if (pq.status !== 'completed' && !isComplete(quest, pq.progress || [])) {
      msg(actor.id, `<span class="msg-system">You have not finished ${quest.name} yet.</span>`);
      return { type: 'error', message: 'You have not finished that quest yet.' };
    }

    // Grant rewards through the canonical Action/service paths.
    const rewards = quest.rewards || {};
    if (rewards.credits) await adjustCredits(actor, rewards.credits);
    for (const it of (rewards.items || [])) {
      await dispatchAction({
        type: 'GRANT_ITEM',
        actor,
        params: { item_id: it.item_id, quantity: it.quantity || 1, once: false },
        context,
      });
    }
    for (const f of (rewards.flags || [])) {
      await dispatchAction({
        type: 'SET_FLAG',
        actor,
        params: { scope: f.scope || 'player', flag: f.flag, value: f.value },
      });
    }

    await query(
      "UPDATE player_quests SET status='turned_in', updated_at=EXTRACT(EPOCH FROM NOW()) WHERE player_id=$1 AND quest_id=$2",
      [actor.id, quest_id]
    );
    await setQuestFlag(actor, quest_id, 'turned_in');
    const creditLine = rewards.credits ? ` (+${rewards.credits}₵)` : '';
    msg(actor.id, `<span class="msg-system">Quest turned in: ${quest.name}.${creditLine}</span>`);
    emit('quest.turned_in', { actor, quest_id });
    return { type: 'quest', quest_id, turned_in: true };
  },
});

// --- Player command: quest log ---------------------------------------------

async function questLog(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const { rows } = await query(
    `SELECT pq.*, q.name, q.objectives FROM player_quests pq
     JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status <> 'turned_in'
     ORDER BY pq.started_at`,
    [player.id]
  );
  if (!rows.length) return { type: 'output', message: 'You have no active quests.' };

  const lines = ['<span class="msg-system">— Quests —</span>'];
  for (const pq of rows) {
    const objectives = pq.objectives || [];
    const progress = Array.isArray(pq.progress) ? pq.progress : [];
    const tag = pq.status === 'completed' ? ' (ready to turn in)' : '';
    lines.push(`<span class="msg-system">${pq.name}${tag}</span>`);
    objectives.forEach((obj, i) => lines.push(objectiveLine(obj, progress[i] || 0, !requiresMet(objectives, obj, progress))));
  }
  return { type: 'output', message: lines.join('\n') };
}

export const commands = {
  quests: questLog,
  quest: questLog,
  ql: questLog,
};

// --- Dev CRUD (devpanel quest authoring) -----------------------------------

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/quests')) return null;
  if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  const id = path.split('/')[2];
  try {
    if (path === '/quests' && method === 'GET') {
      const { rows } = await query('SELECT * FROM quests ORDER BY name');
      return { status: 200, body: rows };
    }
    if (path === '/quests' && method === 'POST') {
      const qid = body.id || `quest_${Date.now()}`;
      await query(
        `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,EXTRACT(EPOCH FROM NOW()))`,
        [qid, body.name || 'Untitled Quest', body.description || '',
         JSON.stringify(body.objectives || []), JSON.stringify(body.rewards || {}), body.repeatable ? 1 : 0]
      );
      return { status: 201, body: { id: qid } };
    }
    if (id && method === 'PUT') {
      await query(
        `UPDATE quests SET name=$1,description=$2,objectives=$3,rewards=$4,repeatable=$5,
         updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$6`,
        [body.name || 'Untitled Quest', body.description || '',
         JSON.stringify(body.objectives || []), JSON.stringify(body.rewards || {}), body.repeatable ? 1 : 0, id]
      );
      return { status: 200, body: { id } };
    }
    if (id && method === 'DELETE') {
      if (auth.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
      await query('DELETE FROM quests WHERE id=$1', [id]);
      return { status: 200, body: { message: 'Deleted' } };
    }
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
  return null;
};
