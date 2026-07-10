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
 *   { type:'retrieve', item_id:'relic', zone:'zone_sewers', spawn:true, count:1, desc:'Recover the relic' }
 * A 'retrieve' objective advances when the player picks up its item_id (item.taken),
 * and — unless spawn===false — the engine drops `count` copies of that item onto the
 * `zone`'s ground the moment the quest starts, so it's always there to be found.
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
import { spawnOnGround } from '../../server/engine/inventory.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { on, emit } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
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

// Auto-spawn: drop a fresh copy of each 'retrieve' objective's item onto its zone's
// ground when the quest starts, unless the objective opts out (spawn===false, i.e.
// the item is already placed in the world). A bad item_id/zone is logged, never
// allowed to break quest start.
async function spawnRetrieveItems(quest) {
  for (const obj of (quest.objectives || [])) {
    if (obj.type !== 'retrieve' || obj.spawn === false || !obj.item_id || !obj.zone) continue;
    try {
      await spawnOnGround(obj.item_id, obj.zone, obj.count || 1);
    } catch (e) {
      console.error('[quests] retrieve auto-spawn failed:', obj.item_id, '→', obj.zone, e.message);
    }
  }
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
    // A quest phase advanced and re-plotted the route — if the player already had
    // auto-walk engaged for the previous leg, the client picks this new leg up
    // automatically (resumeAutoWalkIfArmed) instead of stranding them at the last
    // waypoint waiting for another Auto click.
    resumeAuto: true,
  });
}

// The bottom-pane "you're done, go here" line on quest completion — names the
// turn-in NPC (and their zone) when findTurnInNpc resolves one (any dialogue-
// authored TURN_IN, or a job-board posting's dispatcher), else the old generic
// nudge for quests turned in some other way (flight contracts land themselves).
async function turnInHint(questId) {
  const npc = await findTurnInNpc(questId);
  if (!npc) return 'Return to turn it in.';
  const zone = npc.zone && getZone(npc.zone);
  return `Bring it to ${npc.npcName}${zone ? ` at ${zone.name}` : ''} to turn it in.`;
}

// On completion, auto-plot a GPS route to wherever the quest is handed in (the
// turn-in NPC / job-board dispatcher), so the turn-in is tracked on the map the
// same way objectives are mid-quest (routeToObjective). No-op when the quest has
// no NPC tied to it (flight contracts land themselves), the hand-in is in this
// same zone, or no route can be plotted from here.
async function routeToTurnIn(actor, questId) {
  const npc = await findTurnInNpc(questId);
  if (!npc || !npc.zone || npc.zone === actor.current_zone) return;
  const destZone = getZone(npc.zone);
  if (!destZone) return;
  const path = findPath(actor.current_zone, npc.zone);
  if (!path || path.length < 2) return;
  const hops = path.length - 1;
  sendToPlayer(actor.id, {
    type: 'gps_route',
    message: `GPS locked: ${destZone.name} (${hops} stop${hops === 1 ? '' : 's'} away) — turn-in point plotted on the map.`,
    path,
    resumeAuto: true, // continue auto-walking to the hand-in if it was already on
  });
}

function objectiveLine(obj, done, locked) {
  // 'deliver' (flight pilot contracts, plugins/flight/contracts.js) is never
  // auto-tracked here — see the trackEvent comment below for why.
  const label = obj.desc || `${obj.type} ${obj.target || obj.item_id || obj.zone || ''}`.trim();
  const need = obj.count || 1;
  const have = Math.min(done, need);
  if (locked) return `  [-] ${label} (locked)`;
  return `  [${have >= need ? 'X' : ' '}] ${label}${need > 1 ? ` (${have}/${need})` : ''}`;
}

function objectiveDesc(obj) {
  return obj.desc || `${obj.type} ${obj.target || obj.item_id || obj.zone || ''}`.trim();
}

// A per-objective flavour line ("reads the meter", "hauls the load") authored on
// the objective itself (`obj.emotes`, an array — `{who}` token → the player's
// handle — or the older singular `obj.emote`) — shown to the whole zone
// (including the actor, same as a typed `emote`) every time that objective's
// counter ticks, not just when it finally completes. Purely cosmetic;
// objectives with none authored fire nothing.
function objectiveEmotes(obj) {
  if (Array.isArray(obj.emotes) && obj.emotes.length) return obj.emotes;
  if (obj.emote) return [obj.emote];
  return [];
}

// Last emote line shown per objective-instance (dedup key) — a job task fires one
// every ~2s, so without this the same random line repeats back-to-back and reads
// like a stuck record. With a key, we only ever show a line that differs from the
// one just shown ("only a new emote if it's unique"); a single-line pool that
// would just repeat is suppressed rather than spamming the zone. Cleared when the
// task ends (see scheduleTask/cancelTasksLeavingZone) so the map stays bounded.
const _lastEmote = new Map();

function fireObjectiveEmote(actor, obj, key) {
  const pool = objectiveEmotes(obj);
  if (!pool.length) return;
  let line;
  if (key) {
    const last = _lastEmote.get(key);
    const fresh = pool.filter((l) => l !== last);
    if (!fresh.length) return;                 // nothing new to show → stay silent
    line = fresh[Math.floor(Math.random() * fresh.length)];
    _lastEmote.set(key, line);
  } else {
    line = pool[Math.floor(Math.random() * pool.length)];
  }
  sendToZone(actor.current_zone, { type: 'zone_event', message: line.replace(/\{who\}/g, actor.handle) });
}

// --- Timed tasks (job board "the work takes a few seconds") ----------------
// A 'visit' objective normally completes the instant the player steps into the
// zone. An objective can opt into a delay instead via its own `taskSeconds` — set
// per-objective in the quest editor (the 6 Franchise Strip jobs use 5s) — so it
// reads as actually DOING something there: a random line from the objective's
// `emotes` fires every couple of seconds while the countdown runs, and the
// objective only really advances once it elapses. Leaving the zone before then
// cancels the task outright — no partial credit for wandering off mid-task.
const pendingTasks = new Map(); // key -> { playerId, zone, emoteTimer, doneTimer }
const taskKey = (playerId, questId, objIndex) => `${playerId}:${questId}:${objIndex}`;

// How long a 'visit' objective's task takes: the objective's own `taskSeconds`,
// else the legacy quest-level `meta.taskSeconds` fallback (pre per-objective
// authoring), else DEFAULT_VISIT_SECONDS — so a bare 'visit' still lands on the
// tile, holds a beat "doing the work", and only then advances, instead of
// completing the instant the player (or an auto-walk) arrives. Author 0 explicitly
// to opt a specific objective back into instant completion.
const DEFAULT_VISIT_SECONDS = 3;
function taskSecondsFor(quest, obj) {
  if (obj && obj.taskSeconds != null) return Math.max(0, Number(obj.taskSeconds) || 0);
  const m = Number(quest?.meta?.taskSeconds);
  if (m > 0) return m;
  return DEFAULT_VISIT_SECONDS;
}

// Exported alongside trackEvent for regress.js only — same reasoning (nothing
// outside the on('zone.entered', ...) subscriber below calls it in production).
export function cancelTasksLeavingZone(playerId, zoneId) {
  for (const [key, t] of pendingTasks) {
    if (t.playerId === playerId && t.zone === zoneId) {
      clearTimeout(t.emoteTimer);
      clearTimeout(t.doneTimer);
      pendingTasks.delete(key);
      _lastEmote.delete(key);
    }
  }
}

function scheduleTask(actor, quest, objIndex, obj, seconds) {
  const key = taskKey(actor.id, quest.id, objIndex);
  if (pendingTasks.has(key)) return; // already working it
  const entry = { playerId: actor.id, zone: obj.zone, emoteTimer: null, doneTimer: null };
  pendingTasks.set(key, entry);

  const tickEmote = () => {
    fireObjectiveEmote(actor, obj, key); // keyed → never repeats the previous line
    entry.emoteTimer = setTimeout(tickEmote, 1500 + Math.random() * 1000); // "randomly every few seconds"
  };
  tickEmote();

  entry.doneTimer = setTimeout(() => {
    clearTimeout(entry.emoteTimer);
    pendingTasks.delete(key);
    _lastEmote.delete(key);
    finishObjectiveTick(actor, quest, objIndex).catch((e) => console.error('[quests] finishObjectiveTick error:', e.message));
  }, seconds * 1000);
}

// Advances exactly ONE objective and runs the completion messaging — reloads
// player_quests fresh so a task finishing seconds later never clobbers progress
// made elsewhere meanwhile (or fires against a quest since abandoned/turned in).
async function finishObjectiveTick(actor, quest, objIndex) {
  const pq = await loadPlayerQuest(actor.id, quest.id);
  if (!pq || pq.status !== 'active') return;
  const objectives = quest.objectives || [];
  const obj = objectives[objIndex];
  if (!obj) return;
  const progress = Array.isArray(pq.progress) ? pq.progress.slice() : [];
  while (progress.length < objectives.length) progress.push(0);
  const need = obj.count || 1;
  if ((progress[objIndex] || 0) >= need) return;
  progress[objIndex] += 1;

  const done = isComplete(quest, progress);
  await query(
    `UPDATE player_quests SET progress=$1, status=$2, updated_at=EXTRACT(EPOCH FROM NOW())
     WHERE player_id=$3 AND quest_id=$4`,
    [JSON.stringify(progress), done ? 'completed' : 'active', actor.id, quest.id]
  );
  emit('quest.advanced', { actor, quest_id: quest.id, progress });
  if (done) {
    await setQuestFlag(actor, quest.id, 'completed');
    msg(actor.id, `<span class="msg-system">Quest complete: ${quest.name}. ${await turnInHint(quest.id)}</span>`);
    await routeToTurnIn(actor, quest.id);
    emit('quest.completed', { actor, quest_id: quest.id });
  } else {
    const next = objectives.find((o, i) => (progress[i] || 0) < (o.count || 1) && requiresMet(objectives, o, progress));
    const parts = [`Done: ${objectiveDesc(obj)}.`, next ? `Next: ${objectiveDesc(next)}.` : `Quest updated: ${quest.name}.`];
    msg(actor.id, `<span class="msg-system">${parts.join(' ')}</span>`);
    routeToObjective(actor, quest, progress);
  }
}

// --- Objective tracking (event subscribers) --------------------------------
//
// trackEvent walks a player's active quests and bumps any objective the predicate
// matches. When all objectives are met the quest flips to 'completed' (ready to
// turn in). One UPDATE per affected quest; no-op when nothing matches. A 'visit'
// objective on a quest with meta.taskSeconds set is deferred to scheduleTask
// instead of completing in this same tick — see above.
// Exported only so regress.js can await a deterministic tick instead of racing
// the fire-and-forget event bus (emit() doesn't await subscribers) — never called
// directly outside the on(...) subscribers below in production.
export async function trackEvent(actor, predicate) {
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
    const justFinished = []; // objectives whose count was reached this tick (instant path only)
    objectives.forEach((obj, i) => {
      const need = obj.count || 1;
      if ((progress[i] || 0) >= need) return;
      if (!requiresMet(objectives, obj, before)) return; // locked until prerequisites done
      if (!predicate(obj)) return;

      const secs = obj.type === 'visit' ? taskSecondsFor(quest, obj) : 0;
      if (secs > 0) {
        scheduleTask(actor, quest, i, obj, secs); // completes later, on its own timer
        return;
      }
      progress[i] = (progress[i] || 0) + 1;
      changed = true;
      fireObjectiveEmote(actor, obj, taskKey(actor.id, quest.id, i)); // keyed → no back-to-back repeats
      if (progress[i] >= need) justFinished.push(obj);
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
      msg(actor.id, `<span class="msg-system">Quest complete: ${quest.name}. ${await turnInHint(quest.id)}</span>`);
      await routeToTurnIn(actor, quest.id);
      emit('quest.completed', { actor, quest_id: quest.id });
    } else {
      // Names the objective(s) that just finished and reads out whatever's next,
      // instead of a bare "quest updated" — the bottom-pane progress line the
      // player actually wants mid-quest.
      const next = objectives.find((obj, i) => (progress[i] || 0) < (obj.count || 1) && requiresMet(objectives, obj, progress));
      const parts = [];
      if (justFinished.length) parts.push(`Done: ${justFinished.map(objectiveDesc).join(', ')}.`);
      parts.push(next ? `Next: ${objectiveDesc(next)}.` : `Quest updated: ${quest.name}.`);
      msg(actor.id, `<span class="msg-system">${parts.join(' ')}</span>`);
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

on('zone.entered', ({ actor, zone, from }) => {
  if (from) cancelTasksLeavingZone(actor.id, from);
  return trackEvent(actor, (obj) => obj.type === 'visit' && obj.zone === zone);
});

on('item.taken', ({ actor, item }) => {
  // A 'retrieve' objective completes when the player picks the item up. Matches on
  // item_id like 'give' — any copy counts (the auto-spawned one, or a pre-placed one).
  return trackEvent(actor, (obj) =>
    obj.type === 'retrieve' && obj.item_id && item?.item_id === obj.item_id);
});

// Live-refresh any open client quest UI (Tablet OS Quests app) the moment a quest
// changes state, so its objective checkboxes tick without the player reopening the
// app. Purely a client hint — the client no-ops it when the tablet is closed or not
// on the Quests app (client/game/js/dispatch.js -> tablet-os.js tabletQuestUpdate).
// Fired for every lifecycle transition in one place rather than threading a send
// through each mutation path above.
for (const ev of ['quest.started', 'quest.advanced', 'quest.completed', 'quest.turned_in', 'quest.abandoned']) {
  on(ev, ({ actor }) => { if (actor?.id) sendToPlayer(actor.id, { type: 'quest_update' }); });
}

// Note: 'deliver' objectives (flight pilot contracts) are deliberately NOT wired to
// zone.entered — a delivery has to be verified as an actual landing with the right
// cargo aboard (plugins/flight/contracts.js checkContractDelivery), not just the
// player entering the zone on foot. That plugin advances/turns in those quests by
// dispatching ADVANCE/TURN_IN directly once it has confirmed the landing.

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
    await spawnRetrieveItems(quest);
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
    if (done) { await setQuestFlag(actor, quest_id, 'completed'); await routeToTurnIn(actor, quest_id); emit('quest.completed', { actor, quest_id }); }
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
    // A generic hand-in dialogue node (Marta's job_turnin) authors no quest_id —
    // the quest being turned in rides in on the dialogue context instead (set by
    // Tablet OS's turn-in routing). Per-quest TURN_IN nodes still pass it in params.
    const quest_id = params.quest_id || context?.quest_id;
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
    if (rewards.credits) await adjustCredits(actor, rewards.credits, undefined, 'quest:reward');
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

// Player bailed on an active quest (e.g. jettisoned a flight contract's cargo
// mid-flight). Distinct from 'turned_in' so it never pays out and drops off the
// quest log, but the row (and its history) stays for reference.
registerAction({
  type: 'ABANDON_QUEST',
  handler: async ({ actor, params }) => {
    const { quest_id } = params;
    if (!quest_id) return { type: 'error', message: 'ABANDON_QUEST requires quest_id.' };
    const pq = await loadPlayerQuest(actor.id, quest_id);
    if (!pq || pq.status === 'turned_in' || pq.status === 'abandoned') return { type: 'error', message: 'No active quest to abandon.' };
    await query(
      "UPDATE player_quests SET status='abandoned', updated_at=EXTRACT(EPOCH FROM NOW()) WHERE player_id=$1 AND quest_id=$2",
      [actor.id, quest_id]
    );
    await setQuestFlag(actor, quest_id, 'abandoned');
    emit('quest.abandoned', { actor, quest_id });
    return { type: 'quest', quest_id, abandoned: true };
  },
});

// Reverse-scan: which NPC's dialogue actually turns this quest in? Mirrors the
// devpanel VINE quest editor's "Offered by" reverse-link (client/devpanel/js/
// vine/vine-schema-quest.js _questReferencedIn) but narrowed to TURN_IN
// specifically (an NPC can offer a quest without being the one it's handed back
// to) and used at runtime by Tablet OS to route/hand off the player instead of
// just authoring-time discovery. A TURN_IN action can be authored either on a
// dialogue option itself or on the node it leads to (see engine/dialogue.js's
// turnInQuestId for why both are checked). Falls back to jobboard's own dispatcher
// lookup (dynamic import — quests stays jobboard-agnostic, same cross-plugin
// pattern jobboard uses to reach tablet) for postings with no dialogue-authored
// TURN_IN of their own, so job-board jobs route/announce through their board's
// dispatcher NPC (Marta at the Franchise Strip) exactly like any other quest.
// Still returns null for quests with no NPC at all tied to them (flight
// contracts) — callers fall back to the direct grant for those.
export async function findTurnInNpc(questId) {
  const { rows } = await query(
    "SELECT id, name, home_zone, work_zone_id, dialogue_tree FROM npcs WHERE dialogue_tree::text LIKE '%TURN_IN%'"
  );
  for (const npc of rows) {
    const tree = npc.dialogue_tree || {};
    const hasTurnIn = (acts) => (acts || []).some((a) => a?.action === 'TURN_IN' && a.quest_id === questId);
    const found = Object.values(tree).some((node) => hasTurnIn(node.actions) || (node.options || []).some((o) => hasTurnIn(o.actions)));
    if (found) return { npcId: npc.id, npcName: npc.name, zone: npc.work_zone_id || npc.home_zone };
  }
  try {
    const { turnInNpcForQuest } = await import('../jobboard/index.js');
    return await turnInNpcForQuest(questId);
  } catch { return null; }
}

// --- Player command: quest log ---------------------------------------------

async function questLog(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const { rows } = await query(
    `SELECT pq.*, q.name, q.objectives FROM player_quests pq
     JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status NOT IN ('turned_in', 'abandoned')
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
        `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,EXTRACT(EPOCH FROM NOW()))`,
        [qid, body.name || 'Untitled Quest', body.description || '',
         JSON.stringify(body.objectives || []), JSON.stringify(body.rewards || {}), body.repeatable ? 1 : 0,
         body.quest_type || 'standard', JSON.stringify(body.meta || {})]
      );
      return { status: 201, body: { id: qid } };
    }
    if (id && method === 'PUT') {
      await query(
        `UPDATE quests SET name=$1,description=$2,objectives=$3,rewards=$4,repeatable=$5,quest_type=$6,meta=$7,
         updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$8`,
        [body.name || 'Untitled Quest', body.description || '',
         JSON.stringify(body.objectives || []), JSON.stringify(body.rewards || {}), body.repeatable ? 1 : 0,
         body.quest_type || 'standard', JSON.stringify(body.meta || {}), id]
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
