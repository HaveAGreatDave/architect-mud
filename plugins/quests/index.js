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
 *   { type:'assassinate', target:'npc_vale', desc:'Put Vale in the ground' }
 *   { type:'escort', target:'npc_vale', zone:'zone_clinic', desc:'Walk Vale to the clinic' }
 *   { type:'talk',   target:'npc_grady',  desc:'Hear Grady out' }
 *   { type:'buy',    target:'medkit', count:3, desc:'Buy three medkits' }
 *   { type:'sell',   target:'scrap',  count:10, desc:'Offload ten scrap' }
 *   { type:'craft',  target:'shiv',   desc:'Make yourself a shiv' }
 *   { type:'hack',   zone:'zone_bodega', desc:'Crack the bodega till' }
 *   { type:'equip',  item_id:'dinner_jacket', desc:'Turn up dressed for it' }
 *   { type:'spend',  count:5000,      desc:'Blow ₵5000 in the Marquee District' }
 *   { type:'survive', target:'acid_rain', desc:'Ride out an acid storm outdoors' }
 *   { type:'demolish', target:'furniture_asc_vat_colonnade', desc:'Bring it down' }
 * 'assassinate' names a PERSON (npc.killed, exact npc id or a name substring) where
 * 'kill' names a species (enemy.killed, any three rats will do). 'escort' is met when
 * plugins/escort reports that NPC arriving at `zone` with the player — the walking
 * mechanic lives there and quests never references it, same as every other type.
 * 'spend' is counted in CREDITS rather than repetitions — see the numeric-predicate
 * note in trackEvent, which is what makes an amount-shaped objective expressible.
 * 'survive' is the one type that isn't a single event (weather is global and carries
 * no actor); it's a claim about where you stood across a storm — see its subscriber.
 * Most types treat a missing `target` as "anything counts" (buy/sell/craft/hack/
 * survive); kill/talk/assassinate/escort require one, because they name a thing.
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
 *
 * Failure (quests.fail_on JSONB) is the MIRROR of objectives: the same condition
 * shapes, judged by the same predicates against the same events, but each one blows
 * the quest instead of advancing it —
 *   fail_on: [{ type:'assassinate', target:'npc_witness', desc:'The witness died.' },
 *             { type:'timeout', count:600 }]
 * As an objective "assassinate npc_vale" means kill him; as a fail condition it
 * means he must not die. That symmetry is why failure cost no new per-event code:
 * every objective type was usable as a failure trigger the moment it existed.
 * `timeout`, `escort_lost`, `spotted`, `witnessed`, `broke` and `died` are
 * failure-only (no advancing counterpart). A failed quest is retryable unless
 * `meta.failPermanent`. See the Failure section below.
 *
 * Reward shape (quests.rewards JSONB):
 *   { credits:50, xp:10, items:[{item_id,quantity}], flags:[{scope,flag,value}],
 *     rep:[{ideology,delta}] }
 *
 * `rep` is the mirror of `penalties.rep`, and until it existed the asymmetry was
 * the whole problem with faction work: failing a quest could cost you standing
 * and finishing one could not pay you any, so no questline could be a ladder.
 * `docs/systems-ideologies.md` decays standing on a 30-day half-life precisely
 * because it is meant to be MAINTAINED — this is what maintains it.
 */
import { query } from '../../server/models/db.js';
import { spawnOnGround } from '../../server/engine/inventory.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { on, emit } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { grantXp } from '../../server/engine/ip.js';
import { adjustReputation } from '../../server/engine/ideologies.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { world } from '../../server/engine/world.js';
import { getZone, getAllLivePlayers, getLivePlayer } from '../../server/engine/world.js';
import { isIndoorZone } from '../../server/engine/environment.js';

// Mirror a quest's status into a player Flag so Dialogue/Script Conditions can gate
// options on quest state through the existing Flag mechanism — e.g. hide "Accept"
// once the flag is set, show "Turn in" only while it equals 'completed'
// (CONTEXT.md: Flags are the state Conditions read).
//
// ⚠ THE FLAG KEY IS THE BARE QUEST ID — `quest_pest_control`, not `quest_quest_pest_control`.
// This comment used to claim a `quest_<id>` prefix that the code has never applied,
// which is worse than the missing namespace itself: an author reading it writes a
// Condition against a key that can never match. Author Conditions against the quest
// id exactly as it appears in the quest editor. The consequence to know is that
// quest state shares the flat `player_flags` namespace with every other player
// flag, so a quest id must not collide with an existing flag name.
//
// Also the single choke point for the hot-path gate: routing the Set through here
// rather than through eight call sites is what makes it impossible for a new
// lifecycle transition to update the status and forget the gate.
function setQuestFlag(actor, questId, status) {
  if (status === 'active') markQuestActive(actor, questId);
  else markQuestInactive(actor, questId);
  return setFlag('player', questId, status, actor);
}

// --- Store helpers ---------------------------------------------------------

// Quest definitions are authored content — effectively static at runtime — yet
// trackEvent re-loaded each active quest from the DB on every tracked event
// (zone.entered fires on every player step). Cache rows in memory: the dev CRUD
// below busts on edit, and the TTL bounds staleness from out-of-plugin writers
// (flight's rotating contracts rewrite `rewards`/`meta` directly). Misses are
// never cached, so a freshly-inserted quest is always found.
const QUEST_CACHE_TTL_MS = 30_000;
const questCache = new Map(); // quest_id -> { quest, at }

// Exported for regress.js, which writes `quests` rows directly around the cache.
export function invalidateQuestCache(questId) {
  if (questId) questCache.delete(questId);
  else questCache.clear();
  // The turn-in NPC is derived from dialogue, not from the quest row — but a quest
  // being edited is the moment its wiring is most likely to have moved, and this
  // cache is small. Cheaper to drop it than to reason about when it's still valid.
  invalidateTurnInCache(questId);
}

async function loadQuest(questId) {
  const cached = questCache.get(questId);
  if (cached && Date.now() - cached.at < QUEST_CACHE_TTL_MS) return cached.quest;
  const { rows } = await query('SELECT * FROM quests WHERE id=$1', [questId]);
  const quest = rows[0] || null;
  if (quest) questCache.set(questId, { quest, at: Date.now() });
  else questCache.delete(questId);
  return quest;
}

// Re-keys progress against the quest's current objectives before handing the row
// back, so no caller has to know the alignment problem exists. The quest row is
// cached in memory, so this costs no extra round trip in the common case.
export async function loadPlayerQuest(playerId, questId) {
  const { rows } = await query(
    'SELECT * FROM player_quests WHERE player_id=$1 AND quest_id=$2',
    [playerId, questId]
  );
  const pq = rows[0] || null;
  if (!pq) return null;
  return realign(await loadQuest(questId), pq);
}

// The dispatcher's generic hand-in node (Marta Kell's `job_turnin`) fires a
// quest_id-less TURN_IN — the board's rotating pool is never authored onto her tree
// one quest at a time. Tablet OS supplies the quest via dialogue context, but a
// plain-conversation hand-in has none, so resolve the actor's oldest finished-but-
// unhanded job-board gig instead. jobboard is reached by dynamic import so quests
// stays jobboard-agnostic (same pattern as findTurnInNpc's fallback below).
async function completedJobBoardQuest(actorId) {
  let isJobBoardQuest;
  try { ({ isJobBoardQuest } = await import('../jobboard/index.js')); }
  catch { return null; } // jobboard plugin absent
  const { rows } = await query(
    "SELECT quest_id FROM player_quests WHERE player_id=$1 AND status='completed' ORDER BY updated_at ASC",
    [actorId]
  );
  for (const r of rows) if (await isJobBoardQuest(r.quest_id)) return r.quest_id;
  return null;
}

// `gig_ready` is a player Flag that a Dialogue Condition can read to show Marta's
// "I've got a finished job." option only when the player actually has a completed
// gig to hand back (Flags are the state Conditions read). Recomputed after every
// completion/turn-in so it clears once the last gig is handed in — covers both the
// conversational and Tablet OS hand-in paths (both go through the TURN_IN action).
async function refreshGigReadyFlag(actor) {
  if (await completedJobBoardQuest(actor.id)) await setFlag('player', 'gig_ready', 'true', actor);
  else await clearFlag('player', 'gig_ready', actor);
}

// --- The hot-path gate -----------------------------------------------------
//
// `player._activeQuests` is a live-object Set of quest ids the player currently
// has ACTIVE. Its only job is to let trackEvent answer "nothing to do" without a
// round trip on a path that runs on every footstep. It is a cache of a cheap fact,
// not a source of truth — trackEvent re-derives it from the DB whenever it does
// query, so drift converges rather than persisting.
//
// Every lifecycle transition maintains it through these two helpers rather than
// touching the Set inline, so a new transition can't half-maintain it.
function markQuestActive(actor, questId) {
  if (!actor) return;
  (actor._activeQuests ||= new Set()).add(questId);
}
function markQuestInactive(actor, questId) {
  actor?._activeQuests?.delete(questId);
}

// Hydrate the gate at login, so a returning player's first step doesn't have to
// pay for a query to discover they have no quests. One query per login, on a path
// that is already doing several.
on('player.login', async ({ id }) => {
  const actor = getLivePlayer(id);
  if (!actor) return;
  try {
    const { rows } = await query(
      "SELECT quest_id FROM player_quests WHERE player_id=$1 AND status='active'", [id]
    );
    actor._activeQuests = new Set(rows.map((r) => r.quest_id));
  } catch (e) {
    // Leave it unhydrated (nullish) rather than empty — an empty set would wrongly
    // gate every event off for the whole session.
    console.error('[quests] active-quest hydration failed:', e.message);
  }
});

// --- Progress re-keying ----------------------------------------------------
//
// `progress` is an integer array index-aligned to `objectives`, and that alignment
// is a lie the moment a live quest is edited. Reorder two objectives in the devpanel
// — or delete one — and every player holding it now has counters pointing at the
// wrong objectives: no migration, no detection, no error, just a quest log that
// quietly reads wrong and a "kill 3 rats" that thinks it's a "visit the sewers".
//
// The objectives already carry stable ids (it's what `requires` gates on); the
// progress array simply never used them. `progress_keys` records the id list the
// array was built against, and everything re-keys on read. Objectives with no
// authored id fall back to their index, which is exactly the old behaviour — so a
// hand-written quest that never edits its objectives is unaffected.
function objectiveKeys(quest) {
  return (quest?.objectives || []).map((o, i) => o?.id || `#${i}`);
}

/**
 * The progress array as it applies to the quest's CURRENT objectives.
 * `changed` is true when re-keying actually moved something, which is the caller's
 * cue to write the corrected array back.
 */
function alignProgress(quest, pq) {
  const keys = objectiveKeys(quest);
  const raw = Array.isArray(pq?.progress) ? pq.progress : [];
  const old = Array.isArray(pq?.progress_keys) ? pq.progress_keys : null;
  // A row predating progress_keys: trust its positions (that's all it ever had)
  // and adopt today's keys, so the NEXT edit is handled properly.
  if (!old) {
    return { progress: keys.map((_, i) => Number(raw[i]) || 0), keys, changed: true };
  }
  if (old.length === keys.length && old.every((k, i) => k === keys[i])) {
    return { progress: keys.map((_, i) => Number(raw[i]) || 0), keys, changed: false };
  }
  // Re-key. An objective added since the quest was taken starts at 0; one that was
  // deleted takes its counter with it.
  const byKey = new Map(old.map((k, i) => [k, Number(raw[i]) || 0]));
  return { progress: keys.map((k) => byKey.get(k) || 0), keys, changed: true };
}

async function persistAlignment(playerId, questId, progress, keys) {
  await query(
    'UPDATE player_quests SET progress=$1, progress_keys=$2 WHERE player_id=$3 AND quest_id=$4',
    [JSON.stringify(progress), JSON.stringify(keys), playerId, questId]
  );
}

// Re-key in place and write back if it moved. Returns the row, so callers can keep
// reading `pq.progress` exactly as before and never see the misalignment.
async function realign(quest, pq) {
  if (!quest || !pq) return pq;
  const { progress, keys, changed } = alignProgress(quest, pq);
  pq.progress = progress;
  pq.progress_keys = keys;
  if (changed) await persistAlignment(pq.player_id, pq.quest_id, progress, keys);
  return pq;
}

function freshProgress(quest) {
  return (quest.objectives || []).map(() => 0);
}

// Auto-spawn: drop a fresh copy of each 'retrieve' objective's item onto its zone's
// ground when the quest starts, unless the objective opts out (spawn===false, i.e.
// the item is already placed in the world). A bad item_id/zone is logged, never
// allowed to break quest start.
async function spawnRetrieveItems(actor, quest) {
  const ids = [];
  for (const obj of (quest.objectives || [])) {
    if (obj.type !== 'retrieve' || obj.spawn === false || !obj.item_id || !obj.zone) continue;
    try {
      const id = await spawnOnGround(obj.item_id, obj.zone, obj.count || 1);
      if (id) ids.push(id);
    } catch (e) {
      console.error('[quests] retrieve auto-spawn failed:', obj.item_id, '→', obj.zone, e.message);
    }
  }
  // Remember exactly which rows we created, so ending the quest can take back the
  // ones nobody picked up. Recorded by ROW ID, never by (item_id, zone) — the
  // latter would also match an authored world item or another player's copy.
  if (ids.length) {
    await query('UPDATE player_quests SET spawned=$1 WHERE player_id=$2 AND quest_id=$3',
      [JSON.stringify(ids), actor.id, quest.id]);
  }
}

/**
 * Take back whatever a quest's auto-spawn left in the world, on abandon, failure or
 * a retake. Only rows STILL ON THE GROUND are removed: `player_id LIKE '\_ground\_%'`
 * means an item somebody already picked up is theirs and stays theirs — vanishing
 * loot out of an inventory would be a far worse bug than a stray item on a floor.
 *
 * Without this, taking and dropping a retrieve quest repeatedly littered the zone
 * permanently, one copy per attempt, with nothing anywhere that could clean it up.
 */
async function despawnQuestItems(playerId, questId) {
  const { rows } = await query(
    'SELECT spawned FROM player_quests WHERE player_id=$1 AND quest_id=$2', [playerId, questId]
  );
  const ids = Array.isArray(rows[0]?.spawned) ? rows[0].spawned : [];
  if (!ids.length) return 0;
  const del = await query(
    "DELETE FROM player_inventory WHERE id = ANY($1) AND player_id LIKE '\\_ground\\_%'", [ids]
  );
  await query("UPDATE player_quests SET spawned='[]' WHERE player_id=$1 AND quest_id=$2", [playerId, questId]);
  return del.rowCount || 0;
}

// An objective marked `optional: true` is tracked, shown and paid like any other,
// but it is not part of the finish line — which is what lets a quest distinguish
// "done" from "done well" instead of being binary. Everything else about it is
// unchanged, `requires` included.
//
// ⚠ An optional objective must never be named in a MANDATORY objective's
// `requires`, or the quest cannot be finished by a player who skipped it.
// content:lint refuses that shape rather than leaving it to be found live.
function isOptional(obj) { return obj?.optional === true; }

function objectiveMet(obj, have) { return (have || 0) >= (obj.count || 1); }

function isComplete(quest, progress) {
  return (quest.objectives || []).every((obj, i) => isOptional(obj) || objectiveMet(obj, progress[i]));
}

// The objective to point the player at next. Mandatory work is offered before
// optional work — a bonus objective suggested ahead of the thing that actually
// finishes the quest reads as the game misdirecting you.
function nextObjective(objectives, progress) {
  const open = (obj, i) => !objectiveMet(obj, progress[i]) && requiresMet(objectives, obj, progress);
  return objectives.find((o, i) => open(o, i) && !isOptional(o))
      || objectives.find((o, i) => open(o, i));
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

// A timed-task state line (begin / finished / interrupted). Its own message type so
// the client can make it stand out in the bottom pane (dispatch.js `quest_task` →
// .msg-quest-task) instead of blending into ordinary output.
function taskMsg(playerId, text) {
  sendToPlayer(playerId, { type: 'quest_task', message: text });
}

// A structured line for the Tablet's per-quest action log (client-only, keyed by
// quest_id in tablet-os.js). `kind` drives how the client renders it: start /
// objective / complete become bold headers, arrive / emote are plain narrative
// lines mirroring what scrolls past in the bottom pane — so the player can read a
// quest's whole story from its tablet screen instead of watching the output pane.
function questLogLine(actor, questId, kind, text) {
  if (!actor?.id || !questId || !text) return;
  sendToPlayer(actor.id, { type: 'quest_log', quest_id: questId, kind, text });
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
    continueOnArrival: true, // a quest leg — stay armed at the waypoint for the next one
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
    continueOnArrival: true,
  });
}

function objectiveLine(obj, done, locked) {
  // 'deliver' (flight pilot contracts, plugins/flight/contracts.js) is never
  // auto-tracked here — see the trackEvent comment below for why.
  const label = obj.desc || `${obj.type} ${obj.target || obj.item_id || obj.zone || ''}`.trim();
  const need = obj.count || 1;
  const have = Math.min(done, need);
  const bonus = isOptional(obj) ? ' <span class="text-dim">(optional)</span>' : '';
  if (locked) return `  [-] ${label}${bonus} (locked)`;
  return `  [${have >= need ? 'X' : ' '}] ${label}${need > 1 ? ` (${have}/${need})` : ''}${bonus}`;
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

function fireObjectiveEmote(actor, obj, key, questId) {
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
  const shown = line.replace(/\{who\}/g, actor.handle);
  sendToZone(actor.current_zone, { type: 'zone_event', message: shown });
  // Mirror the same flavour line into this quest's tablet action log.
  questLogLine(actor, questId, 'emote', shown);
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
// Job-board gigs read as real work — their tile actions hold ~15s by default
// (per-objective `taskSeconds` still overrides). Passed in as `fallback` from
// trackEvent, which knows whether the quest is board-posted (isJobBoardQuest).
const JOBBOARD_VISIT_SECONDS = 15;
function taskSecondsFor(quest, obj, fallback = DEFAULT_VISIT_SECONDS) {
  if (obj && obj.taskSeconds != null) return Math.max(0, Number(obj.taskSeconds) || 0);
  const m = Number(quest?.meta?.taskSeconds);
  if (m > 0) return m;
  return fallback;
}

// Tear a task down and tell the player it was interrupted. Shared by the two
// interrupt paths — leaving the zone, and doing any other action mid-task. Safe to
// delete the current entry while iterating a Map elsewhere (JS allows it).
function cancelTask(key, entry) {
  clearTimeout(entry.emoteTimer);
  clearTimeout(entry.doneTimer);
  pendingTasks.delete(key);
  _lastEmote.delete(key);
  taskMsg(entry.playerId, `✖ Task interrupted: ${entry.desc}. You'll have to come back and start it over.`);
}

// Exported alongside trackEvent for regress.js only — same reasoning (nothing
// outside the on('zone.entered', ...) subscriber below calls it in production).
export function cancelTasksLeavingZone(playerId, zoneId) {
  for (const [key, t] of pendingTasks) {
    if (t.playerId === playerId && t.zone === zoneId) cancelTask(key, t);
  }
}

// Cancel every pending task a player has (they can only ever be working one zone
// at a time). Fired when the player does something other than wait it out.
function cancelPlayerTasks(playerId) {
  for (const [key, t] of pendingTasks) {
    if (t.playerId === playerId) cancelTask(key, t);
  }
}

function scheduleTask(actor, quest, objIndex, obj, seconds) {
  const key = taskKey(actor.id, quest.id, objIndex);
  if (pendingTasks.has(key)) return; // already working it
  const entry = { playerId: actor.id, zone: obj.zone, desc: objectiveDesc(obj), emoteTimer: null, doneTimer: null };
  pendingTasks.set(key, entry);
  // Clear start marker so the player knows the window opened and to hold still.
  taskMsg(actor.id, `▶ Starting task: ${entry.desc} — stay here (${seconds}s). Moving or acting cancels it.`);

  const tickEmote = () => {
    fireObjectiveEmote(actor, obj, key, quest.id); // keyed → never repeats the previous line
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

// --- Failure ---------------------------------------------------------------
//
// `quests.fail_on` is the mirror of `quests.objectives`: the SAME condition shapes,
// evaluated by the SAME predicates against the same events — but each one blows the
// quest instead of advancing it. That's the whole design, and it's why adding
// failure cost no new per-event code: every one of the fifteen objective types is
// usable as a failure trigger the day it exists ("fails if you kill the witness",
// "fails if you sell the package", "fails if you're seen").
//
// Two shapes are failure-only, because they have no advancing counterpart:
//   { type:'timeout', count:<seconds> }   — measured from player_quests.started_at
//   { type:'escort_lost', target:<npc> }  — the escortee died or was abandoned
//
// A failed quest is RETRYABLE by default (START_QUEST re-activates it), because a
// permanent dead end in a living world should be something an author asks for, not
// something they get by accident. `meta.failPermanent: true` opts into the lock.

function failConditions(quest) {
  return Array.isArray(quest?.fail_on) ? quest.fail_on : [];
}

// Seconds this quest allows, or 0 for untimed.
function timeLimitOf(quest) {
  const t = failConditions(quest).find((c) => c?.type === 'timeout');
  return t ? Math.max(0, Number(t.count) || 0) : 0;
}

function failReasonLine(quest, cond) {
  if (cond?.desc) return cond.desc;
  if (cond?.type === 'timeout') return 'You ran out of time.';
  if (cond?.type === 'escort_lost') return 'You lost the person you were escorting.';
  return `${cond?.type || 'Something'} ${cond?.target || cond?.item_id || cond?.zone || ''}`.trim();
}

/**
 * `quests.penalties` is to failure what `rewards` is to turn-in — the same shape
 * minus items, applied through the same canonical service paths. Without it,
 * failing cost you nothing you had, which made every failure condition purely
 * cosmetic: you simply took the quest again.
 *
 * Credits are authored POSITIVE and taken. Floored at the player's balance rather
 * than pushed negative — the debt systems that would give a negative balance
 * meaning don't exist, and a player who can't buy food because a quest blew is a
 * softlock, not a consequence.
 *
 * Returns a short " (−200₵, Ascendants −5)" tail for the failure line, because a
 * penalty the player isn't told about is indistinguishable from a bug.
 */
async function applyPenalties(actor, quest) {
  const pen = (quest?.penalties && typeof quest.penalties === 'object') ? quest.penalties : {};
  const told = [];

  const asked = Math.max(0, Number(pen.credits) || 0);
  if (asked > 0) {
    const taken = Math.min(asked, Math.max(0, Number(actor.credits) || 0));
    if (taken > 0) {
      await adjustCredits(actor, -taken, undefined, 'quest:penalty');
      told.push(`−${taken}₵`);
    }
  }

  for (const r of (Array.isArray(pen.rep) ? pen.rep : [])) {
    const delta = Number(r?.delta) || 0;
    if (!r?.ideology || !delta) continue;
    try {
      await adjustReputation(actor.id, r.ideology, delta, 'quest:penalty');
      told.push(`${r.ideology} ${delta > 0 ? '+' : ''}${delta}`);
    } catch (e) {
      // A penalty naming an ideology that no longer exists must not swallow the
      // failure itself — the quest is already failed by this point.
      console.error('[quests] penalty rep adjust failed:', r.ideology, e.message);
    }
  }

  for (const f of (Array.isArray(pen.flags) ? pen.flags : [])) {
    if (!f?.flag) continue;
    await dispatchAction({
      type: 'SET_FLAG',
      actor,
      params: { scope: f.scope || 'player', flag: f.flag, value: f.value },
    });
  }

  return told.length ? ` (${told.join(', ')})` : '';
}

/**
 * Grant one reward bundle through the canonical Action/service paths, and return
 * the short strings the caller shows the player (" (+200₵, +5 XP)").
 *
 * The mirror of applyPenalties, and extracted from TURN_IN's body because it is no
 * longer paid in one place: an OPTIONAL objective may carry `rewards` of its own,
 * and each met one is paid alongside the quest's at hand-in. Two copies of the
 * grant order would be two chances for a bonus to pay XP the wrong way.
 *
 * `reason` reaches the credit ledger, so a bonus is distinguishable from the fee.
 */
async function grantRewards(actor, rewards, context, reason = 'quest:reward') {
  const r = (rewards && typeof rewards === 'object') ? rewards : {};
  const gains = [];

  if (r.credits) {
    await adjustCredits(actor, r.credits, undefined, reason);
    gains.push(`+${r.credits}₵`);
  }
  // XP. Until 2026-07-21 quests awarded none at all — `grantXp` existed with zero
  // callers, so lifetime XP came only from probabilistic per-use skill rolls and
  // the entire quest economy fed no progression whatsoever. A stat point is a flat
  // 100 XP (statCost), so these numbers are deliberately small.
  if (r.xp) {
    await grantXp(actor.id, r.xp);
    // total_xp/xp aren't columns — they're computed (skill_ip + bonus_xp) and
    // mirrored onto the live player at login only (server/index.js). Bump the
    // mirror so anything reading them mid-session sees the grant.
    actor.total_xp = (Number(actor.total_xp) || 0) + r.xp;
    actor.xp = (Number(actor.xp) || 0) + r.xp;
    gains.push(`+${r.xp} XP`);
  }
  for (const it of (r.items || [])) {
    await dispatchAction({
      type: 'GRANT_ITEM',
      actor,
      params: { item_id: it.item_id, quantity: it.quantity || 1, once: false },
      context,
    });
  }
  for (const f of (r.flags || [])) {
    await dispatchAction({
      type: 'SET_FLAG',
      actor,
      params: { scope: f.scope || 'player', flag: f.flag, value: f.value },
    });
  }

  // Standing. The exact mirror of `penalties.rep`, down to the guard and the
  // swallowed failure, and deliberately a DIRECT call rather than a dispatched
  // ADJUST_REPUTATION: the "canonical Action paths" rule is about not
  // re-implementing a service, and this is the same service the ideologies
  // plugin's Action calls. Dispatching would make the quests plugin refuse to pay
  // standing whenever that plugin is absent, for no behaviour the direct call does
  // not already have.
  for (const rep of (Array.isArray(r.rep) ? r.rep : [])) {
    const delta = Number(rep?.delta) || 0;
    if (!rep?.ideology || !delta) continue;
    try {
      const res = await adjustReputation(actor.id, rep.ideology, delta, reason);
      // A CROSSING is worth saying; a number is not. Raw standing is shown by
      // `rep`/`ideologies` and deliberately nowhere else, so a reward that moves
      // you within a tier passes without comment — which is also what keeps a
      // repeatable from printing a line every single hand-in.
      if (res?.tiered_up) gains.push(res.new_tier_label);
    } catch (e) {
      // A reward naming an ideology that no longer exists must not swallow the
      // turn-in — the objectives were met and the player is owed the rest.
      console.error('[quests] reward rep adjust failed:', rep.ideology, e.message);
    }
  }
  return gains;
}

/**
 * A quest ending may hand the player the next one. `on_fail.start_quest` and
 * `on_turn_in.start_quest` are both dispatched through the ordinary START_QUEST
 * action, which is why this is ten lines rather than a mechanism: the interesting
 * answer to a failure is rarely a fine, it is the cleanup job — and stating that
 * as a field retires the hand-written flag chains that used to link a quest to its
 * sequel.
 *
 * ⚠ The follow-up is refused when it is already live on this player. A quest whose
 * on_fail starts a quest whose on_fail starts the first is an authoring mistake,
 * and without this guard it costs a loop at runtime rather than a red in review.
 */
async function startFollowUp(actor, quest, spec) {
  const nextId = spec?.start_quest;
  if (!nextId || nextId === quest.id) return false;
  const live = await loadPlayerQuest(actor.id, nextId);
  if (live && ['active', 'completed'].includes(live.status)) return false;
  const res = await dispatchAction({ type: 'START_QUEST', actor, params: { quest_id: nextId } });
  return res?.started === true;
}

/**
 * Flip an active quest to 'failed'. Single writer for the status, the flag, the
 * message and the event — every failure path (predicate match, timeout sweep, the
 * FAIL_QUEST action) comes through here so none of them can half-fail a quest.
 * Returns true if it actually failed something.
 */
async function failQuest(actor, quest, cond) {
  const { rowCount } = await query(
    `UPDATE player_quests SET status='failed', updated_at=EXTRACT(EPOCH FROM NOW())
     WHERE player_id=$1 AND quest_id=$2 AND status IN ('active','completed')`,
    [actor.id, quest.id]
  );
  // Guarded on the UPDATE actually hitting a row: two events in the same tick can
  // both decide to fail the same quest, and the player should be told once. It's
  // also the claim that keeps penalties from being applied twice — same reasoning
  // as TURN_IN's claim-before-paying.
  if (!rowCount) return false;
  await setQuestFlag(actor, quest.id, 'failed');
  await despawnQuestItems(actor.id, quest.id);   // don't leave its props on the floor
  const cost = await applyPenalties(actor, quest);
  const why = failReasonLine(quest, cond);
  msg(actor.id, `<span class="msg-system">Quest failed: ${quest.name}. ${why}${cost}</span>`);
  questLogLine(actor, quest.id, 'failed', `${quest.name} — ${why}`);
  emit('quest.failed', { actor, quest_id: quest.id, reason: cond?.type || 'unknown' });
  // "You told them, didn't you" is more interesting as the next job than as a fine.
  await startFollowUp(actor, quest, quest.on_fail);
  return true;
}

/**
 * Has this quest's clock run out? Checked LAZILY rather than on a timer, and that
 * is deliberate: a stored timer dies with the process, so a restart would hand
 * every timed quest an extension. Derived from started_at instead, it survives
 * anything.
 *
 * The reason lazy is not merely "good enough" but airtight: every path that could
 * ADVANCE or TURN IN a quest runs this check first (trackEvent, finishObjectiveTick,
 * ADVANCE, COMPLETE, TURN_IN). So an expired quest can be *noticed* late, but it can
 * never be progressed or handed in late — there is no window in which the timeout
 * has passed and the quest still pays out.
 */
async function expireIfTimedOut(actor, quest, pq) {
  const limit = timeLimitOf(quest);
  if (!limit) return false;
  const started = Number(pq?.started_at) || 0;
  if (!started || (Date.now() / 1000) - started < limit) return false;
  return failQuest(actor, quest, failConditions(quest).find((c) => c.type === 'timeout'));
}

// Advances exactly ONE objective and runs the completion messaging — reloads
// player_quests fresh so a task finishing seconds later never clobbers progress
// made elsewhere meanwhile (or fires against a quest since abandoned/turned in).
async function finishObjectiveTick(actor, quest, objIndex) {
  const pq = await loadPlayerQuest(actor.id, quest.id);
  if (!pq || pq.status !== 'active') return;
  // A timed task can outlive the quest's own clock — the 15s of tile work you
  // started with 5s left must not land.
  if (await expireIfTimedOut(actor, quest, pq)) return;
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
  // Bold "Objective complete" header in the tablet action log the moment this
  // objective's counter is fully met (a timed task advances one at a time).
  if (progress[objIndex] >= need) questLogLine(actor, quest.id, 'objective', objectiveDesc(obj));
  if (done) {
    await setQuestFlag(actor, quest.id, 'completed');
    // Standout finish marker; keeps "Quest complete: <name>." verbatim so the
    // client activity-log parser still records the completion.
    taskMsg(actor.id, `✔ Finished: ${objectiveDesc(obj)}. Quest complete: ${quest.name}. ${await turnInHint(quest.id)}`);
    questLogLine(actor, quest.id, 'complete', quest.name);
    await routeToTurnIn(actor, quest.id);
    emit('quest.completed', { actor, quest_id: quest.id });
  } else {
    const next = nextObjective(objectives, progress);
    taskMsg(actor.id, `✔ Finished: ${objectiveDesc(obj)}.${next ? ` Next: ${objectiveDesc(next)}.` : ` Quest updated: ${quest.name}.`}`);
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
// Per-player serialisation queue for trackEvent. `emit()` does not await its
// subscribers, so two matching events in the same tick both READ the same progress,
// both increment from it, and the second write silently discards the first — kill
// three rats with one grenade and you get credit for one. The whole function is a
// read-modify-write over player_quests, and there's no row lock to take without
// dragging a transaction through the event bus.
//
// Chaining per player is the cheap fix and the right shape: quest events for ONE
// player are inherently ordered anyway (they're that player's actions), while
// different players never contend. A rejected link is swallowed so one player's
// failure can't break the chain for their next event.
const _trackQueue = new Map(); // playerId -> promise tail
export async function trackEvent(actor, predicate) {
  if (!actor?.id) return;
  const prev = _trackQueue.get(actor.id) || Promise.resolve();
  const next = prev.then(() => trackEventLocked(actor, predicate)).catch((e) => {
    console.error('[quests] trackEvent failed:', e.message);
  });
  // Only clear the tail if nothing else queued behind us, or a burst would leak.
  _trackQueue.set(actor.id, next);
  next.finally(() => { if (_trackQueue.get(actor.id) === next) _trackQueue.delete(actor.id); });
  return next;
}

async function trackEventLocked(actor, predicate) {
  // HOT PATH GATE. trackEvent is subscribed to zone.entered, so this function runs
  // on every step every player takes — and it used to open with an awaited SELECT
  // regardless of whether that player held a single quest. Prod Postgres is remote;
  // latency lives in round-trip COUNT (docs/architecture.md), and quest DEFINITIONS
  // were carefully cached for exactly this reason while the per-player rows were
  // not. `_activeQuests` is a live-player-object Set maintained by every lifecycle
  // transition below and hydrated at login, so the overwhelmingly common case — a
  // player walking around with no active quest — now costs zero queries instead of
  // one per tile. A nullish set means "not hydrated yet", which falls through to
  // the query rather than wrongly reporting no quests.
  if (actor._activeQuests?.size === 0) return;
  const { rows } = await query(
    "SELECT * FROM player_quests WHERE player_id=$1 AND status='active'",
    [actor.id]
  );
  // Self-heal the gate from the authoritative answer, so a set that drifted (a
  // direct DB write, a plugin bypassing the Actions) converges on the next event.
  actor._activeQuests = new Set(rows.map((r) => r.quest_id));
  for (const pq of rows) {
    const quest = await loadQuest(pq.quest_id);
    if (!quest) continue;

    // Failure is judged BEFORE progress, both ways round, and the order matters.
    // The clock first: an expired quest must not be advanced by the very event
    // that noticed it had expired. Then the fail_on conditions, against the same
    // predicate the objectives are about to be judged by — one event cannot both
    // blow a quest and advance it.
    if (await expireIfTimedOut(actor, quest, pq)) continue;
    const tripped = failConditions(quest).find((c) => c && c.type !== 'timeout' && predicate(c));
    if (tripped) { await failQuest(actor, quest, tripped); continue; }

    await realign(quest, pq);   // the quest may have been edited since it was taken
    const objectives = quest.objectives || [];
    const progress = Array.isArray(pq.progress) ? pq.progress.slice() : [];
    while (progress.length < objectives.length) progress.push(0);

    let changed = false;
    const before = progress.slice(); // judge gating against pre-tick state
    const justFinished = []; // objectives whose count was reached this tick (instant path only)
    // Job-board gigs get the longer default tile-work window; look it up once per
    // quest (only when it actually has a timed-eligible 'visit' objective).
    let visitFallback = DEFAULT_VISIT_SECONDS;
    if (objectives.some((o) => o.type === 'visit')) {
      try {
        const { isJobBoardQuest } = await import('../jobboard/index.js');
        if (await isJobBoardQuest(quest.id)) visitFallback = JOBBOARD_VISIT_SECONDS;
      } catch { /* jobboard plugin absent — keep the default */ }
    }
    objectives.forEach((obj, i) => {
      const need = obj.count || 1;
      if ((progress[i] || 0) >= need) return;
      if (!requiresMet(objectives, obj, before)) return; // locked until prerequisites done
      // A predicate normally answers yes/no and the counter ticks by one. It may
      // instead return a NUMBER, which is the amount to add — that's what makes
      // an objective measured in credits ('spend 5000') expressible at all, rather
      // than only ones measured in repetitions ('buy 3 things').
      const hit = predicate(obj);
      if (!hit) return;
      const step = typeof hit === 'number' ? hit : 1;

      // Reaching a visit objective's zone is a narrative beat in its own right —
      // log "<who> reached <zone>" whether the work is instant or a timed task.
      if (obj.type === 'visit') {
        const zn = getZone(obj.zone)?.name || obj.zone;
        questLogLine(actor, quest.id, 'arrive', `${actor.handle} reached ${zn}`);
      }
      const secs = obj.type === 'visit' ? taskSecondsFor(quest, obj, visitFallback) : 0;
      if (secs > 0) {
        scheduleTask(actor, quest, i, obj, secs); // completes later, on its own timer
        return;
      }
      progress[i] = (progress[i] || 0) + step;
      changed = true;
      fireObjectiveEmote(actor, obj, taskKey(actor.id, quest.id, i), quest.id); // keyed → no back-to-back repeats
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
    // Bold "Objective complete" header in the tablet action log for each objective
    // whose counter was fully met this tick.
    for (const o of justFinished) questLogLine(actor, quest.id, 'objective', objectiveDesc(o));
    if (done) {
      await setQuestFlag(actor, quest.id, 'completed');
      msg(actor.id, `<span class="msg-system">Quest complete: ${quest.name}. ${await turnInHint(quest.id)}</span>`);
      questLogLine(actor, quest.id, 'complete', quest.name);
      await routeToTurnIn(actor, quest.id);
      emit('quest.completed', { actor, quest_id: quest.id });
    } else {
      // Names the objective(s) that just finished and reads out whatever's next,
      // instead of a bare "quest updated" — the bottom-pane progress line the
      // player actually wants mid-quest.
      const next = nextObjective(objectives, progress);
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

// An 'assassinate' objective names a PERSON, not a species — so unlike 'kill'
// (which substring-matches an enemy type: any three rats will do) this is wired to
// npc.killed and matches an exact npc id first, falling back to a name substring so
// a quest can be authored against "Marta Kell" without looking the id up. Killing
// an NPC was previously untracked by quests entirely.
on('npc.killed', ({ actor, npc }) => {
  // gameLoop emits npc.killed for NPC-on-NPC kills with no player actor at all —
  // a bystander caught in a fight must never tick somebody's contract.
  if (!actor?.id || !npc) return;
  const id = String(npc.id || '');
  const name = (npc.name || '').toLowerCase();
  return trackEvent(actor, (obj) =>
    obj.type === 'assassinate' && obj.target &&
    (id === String(obj.target) || name.includes(String(obj.target).toLowerCase())));
});

// An 'escort' objective is met when the escorted NPC ARRIVES somewhere with the
// player — the walking itself is plugins/escort's business (it emits this the
// moment the escortee lands in the player's new zone), so quests stays ignorant of
// the mechanic exactly as it is of kills and pickups. Matching on both npc and
// zone is what makes it a destination and not just "took someone for a walk".
on('escort.arrived', ({ actor, npc, zone }) => {
  if (!actor?.id || !npc) return;
  const id = String(npc.id || '');
  const name = (npc.name || '').toLowerCase();
  return trackEvent(actor, (obj) =>
    obj.type === 'escort' && obj.target && obj.zone === zone &&
    (id === String(obj.target) || name.includes(String(obj.target).toLowerCase())));
});

// escort_lost — failure-only, and the reason the escort system is worth having a
// failure state for at all: the escortee is a live body, and losing it has to mean
// something. Routed through trackEvent like everything else, so a quest with no
// `fail_on` entry for it simply doesn't care.
on('escort.lost', ({ actor, npc }) => {
  if (!actor?.id || !npc) return;
  const id = String(npc.id || '');
  const name = (npc.name || '').toLowerCase();
  return trackEvent(actor, (c) =>
    c.type === 'escort_lost' &&
    (!c.target || id === String(c.target) || name.includes(String(c.target).toLowerCase())));
});

// --- The commerce / craft / act objectives ---------------------------------
//
// Each of these is the same three lines: subscribe to an Event that already fired
// somewhere in the world, and bump any objective that matches it. None of the
// systems below know quests exist, and none of them changed to support this —
// except the three Events that had to be ADDED because the act was never announced
// at all (item.crafted in engine/crafting.js, vendor.sale in engine/vendor.js,
// npc.talked in engine/dialogue.js). Everything else was already on the bus.

// talk — go and speak to someone. Fires once per conversation (dialogue emits on
// the ROOT node only), so re-clicking options inside one chat can't farm it.
on('npc.talked', ({ actor, npc }) => {
  if (!actor?.id || !npc) return;
  const id = String(npc.id || '');
  const name = (npc.name || '').toLowerCase();
  return trackEvent(actor, (obj) =>
    obj.type === 'talk' && obj.target &&
    (id === String(obj.target) || name.includes(String(obj.target).toLowerCase())));
});

// buy / sell — a counter changing hands either way. `target` is an item id; an
// objective with no target counts ANY transaction ("spend a day at the market"),
// which is why the target check is optional here unlike kill/talk.
on('vendor.purchase', ({ player, itemId }) => {
  if (!player?.id) return;
  return trackEvent(player, (obj) =>
    obj.type === 'buy' && (!obj.target || String(obj.target) === String(itemId)));
});

on('vendor.sale', ({ player, itemId }) => {
  if (!player?.id) return;
  return trackEvent(player, (obj) =>
    obj.type === 'sell' && (!obj.target || String(obj.target) === String(itemId)));
});

// craft — made with your own hands. Matches the OUTPUT item id (what the player
// set out to make), not the recipe id, so an objective reads the way it's spoken.
// Counts the stack: a critical craft that yields two satisfies "craft 2".
on('item.crafted', ({ actor, item_id, quantity }) => {
  if (!actor?.id) return;
  return trackEvent(actor, (obj) =>
    obj.type === 'craft' && (!obj.target || String(obj.target) === String(item_id))
      ? Math.max(1, Number(quantity) || 1) : false);
});

// hack — any successful hack (storefront till, surveillance node, vendor safe).
// `zone` narrows it to a specific target site; without one, any hack counts.
on('hack.success', ({ player, zoneId }) => {
  if (!player?.id) return;
  return trackEvent(player, (obj) =>
    obj.type === 'hack' && (!obj.zone || obj.zone === zoneId));
});

// equip — turn up wearing the right thing. `item.equipped` carries the inventory
// row, so match its item_id like give/retrieve do.
on('item.equipped', ({ actor, item }) => {
  if (!actor?.id) return;
  return trackEvent(actor, (obj) =>
    obj.type === 'equip' && obj.item_id && item?.item_id === obj.item_id);
});

// spend — measured in CREDITS, not in transactions, which is what the numeric
// predicate return above exists for: `count: 5000` means five thousand credits.
// Only outgoing money counts, and only money that left your hands for something —
// a bank transfer isn't spending, so reasons starting `bank:` are excluded.
on('credits.changed', ({ actor, delta, reason }) => {
  if (!actor?.id || !(delta < 0)) return;
  if (String(reason || '').startsWith('bank:')) return;
  return trackEvent(actor, (obj) =>
    obj.type === 'spend' && (!obj.target || String(reason || '').includes(String(obj.target)))
      ? Math.abs(delta) : false);
});

// --- survive ---------------------------------------------------------------
//
// The one objective here that isn't a single event. Weather is GLOBAL — `weather.event`
// carries no actor at all — so surviving one can't be a predicate over a payload; it
// has to be a claim about where a player was over TIME. Two moments make it:
// at `peak` we snapshot who was standing outdoors, and when the event clears we credit
// whoever from that set is still live and still outdoors.
//
// Sitting the storm out indoors is the failure case the whole objective exists to
// exclude, so the outdoor test is taken at BOTH ends — ducking inside at the peak and
// stepping back out for the all-clear earns nothing. isIndoorZone is the engine's own
// shelter predicate (open_sky decks read as outdoors), not a second opinion.
// The storm TYPE is carried over from the peak too — the clearing event reports
// `{type:null}` by construction (it's the absence of a storm), so an objective
// authored as "survive an acid storm" has nothing to match against at that end.
let _stormWitnesses = null; // { type, ids:Set<playerId> } caught outdoors at the peak
on('weather.event', ({ type, phase }) => {
  const outdoors = (p) => p?.current_zone && !isIndoorZone(getZone(p.current_zone));
  if (phase === 'peak') {
    _stormWitnesses = { type, ids: new Set(getAllLivePlayers().filter(outdoors).map((p) => p.id)) };
    return;
  }
  if (type) return;              // approach / passing — not over yet
  const storm = _stormWitnesses;
  _stormWitnesses = null;
  if (!storm?.ids.size) return;
  const survivors = getAllLivePlayers().filter((p) => storm.ids.has(p.id) && outdoors(p));
  return Promise.all(survivors.map((p) => trackEvent(p, (obj) =>
    obj.type === 'survive' &&
    (!obj.target || String(obj.target) === String(storm.type)) &&
    (!obj.zone || obj.zone === p.current_zone))));
});

// --- The discipline objectives ---------------------------------------------
//
// The faction arcs could only ever say "go there": twelve of the sixteen of them
// are `visit`, not because anybody wanted an errand but because `visit` was
// nearly all this file could express. The types below are the ones the orders
// actually turn on — fitting chrome, being changed, putting somebody down — and
// every one of them but `install` rides an Event that was ALREADY on the bus.
// Nothing below asked another system to change.

// install — chrome fitted, in a theatre, by somebody who knows how. `target` is
// an augment id; blank counts any fitting ("get chromed", which is the Ascendant
// bridge). The one new Event in this batch (plugins/augments/install.js), because
// a fitting was the single thing the augments plugin never announced.
on('augment.installed', ({ actor, augment_id }) => {
  if (!actor?.id) return;
  return trackEvent(actor, (obj) =>
    obj.type === 'install' && (!obj.target || String(obj.target) === String(augment_id)));
});

// demolish — something got blown up. `target` is a furniture id; blank counts any
// detonation ("set one off, anywhere", which is how you'd author a first lesson).
// One more Event on the bus and nothing in plugins/demolition knows quests exist,
// which is the same shape as `install` above.
on('demolition.detonated', ({ actor, target_id }) => {
  if (!actor?.id) return;
  return trackEvent(actor, (obj) =>
    obj.type === 'demolish' && (!obj.target || String(obj.target) === String(target_id)));
});

// mutate — the body changed. One Event covers every grant path (the radiation
// roll, the flask, an authored GRANT_MUTATION), so an objective cannot be
// satisfied by one route and blind to another. `target` is a mutation id.
on('mutation.gained', ({ player, id }) => {
  if (!player?.id) return;
  return trackEvent(player, (obj) =>
    obj.type === 'mutate' && (!obj.target || String(obj.target) === String(id)));
});

// subdue — somebody put down and left breathing, which is a different act from
// killing them and has to count differently. Matches a person like `assassinate`
// does (exact id, then name substring), NOT a species: a cosh is aimed.
//
// ⚠ The payload's `player` is the one who SWUNG. Crediting the target would be
// the easy mistake here and would pay a quest out to the body on the floor.
on('knockout.landed', ({ player, target }) => {
  if (!player?.id || !target) return;
  const id = String(target.id || target.instanceId || '');
  const name = (target.name || target.handle || '').toLowerCase();
  return trackEvent(player, (obj) =>
    obj.type === 'subdue' && obj.target &&
    (id === String(obj.target) || (name && name.includes(String(obj.target).toLowerCase()))));
});

// --- Failure-only conditions ------------------------------------------------
//
// `escort_lost` set the precedent: a condition with no advancing counterpart,
// routed through trackEvent like everything else, so a quest carrying no
// `fail_on` entry for it simply never notices. These four are what let a quest
// state a CONSTRAINT rather than a task, which is the half of an infiltration
// job that makes it one — the objective says get the thing, the condition says
// and nobody sees you.

// spotted — the stealth roll went against you. Per observer, so the first NPC to
// clock you blows it; that is the point.
on('stealth.noticed', ({ sneaker }) => {
  if (!sneaker?.id) return;
  return trackEvent(sneaker, (c) => c.type === 'spotted');
});

// witnessed — the act reached a camera or a cop. `target` narrows it to one
// crime key, so "steal it, and not on camera" and "you may be seen doing
// anything but THIS" are both authorable.
//
// ⚠ This payload's `player` is a flattened {id, handle}, not the live object, so
// resolve it — trackEvent reads `_activeQuests` off the live player to skip a
// query, and a stub would cost a round trip on every witnessed crime in the game.
on('crime.witnessed', ({ player, key }) => {
  const actor = player?.id ? getLivePlayer(player.id) : null;
  if (!actor) return;
  return trackEvent(actor, (c) =>
    c.type === 'witnessed' && (!c.target || String(c.target) === String(key)));
});

// broke — gear destroyed under you. `item.broken` carries the inventory row id
// rather than an item id, so this is deliberately untargeted: it means "bring
// your tools back whole", which is the Long Watch's whole argument and does not
// need to name the tool.
on('item.broken', ({ actor }) => {
  if (!actor?.id) return;
  return trackEvent(actor, (c) => c.type === 'broke');
});

// restore / died — ONE subscription over ONE Event, because they are the same
// question asked in opposite directions and two subscriptions could drift on
// what `claimed` means. A claimed death is one somebody had arranged for in
// advance (a cortical backup, custody) and is the ONLY kind that skips the
// corruption pass; an unclaimed one is just dying.
//
// So `restore` is an objective — go and die on a policy, and get up again — and
// `died` is a condition: and you come back.
on('player.death', ({ player, claimed }) => {
  if (!player?.id) return;
  return trackEvent(player, (o) =>
    (claimed ? o.type === 'restore' : o.type === 'died'));
});

// Doing anything other than waiting cancels an in-progress tile task. Fired for
// every command (server/engine/commands/index.js) BEFORE it runs, so the move/act
// that arrives on the tile never cancels the task it's about to start. A short
// allowlist of passive info/comms/UI verbs is exempt — glancing at your tablet or
// the room shouldn't blow the window. Movement isn't listed (it cancels), and
// zone.entered above catches it too; the entry is gone by then, so one message.
const NON_CANCELLING_CMDS = new Set([
  'look', 'l', 'glance', 'exits', 'ex', 'quests', 'gigs', 'postings', 'jobboard',
  'score', 'sc', 'stats', 'stat', 'skills', 'sk', 'inventory', 'inv', 'i',
  'who', 'help', 'say', 'chat', 'ooc', 'whisper', 'tell', 'emote', 'time',
  'weather', 'tablet', 'tabletnav', 'map', 'gps',
]);
on('player.command', ({ player, cmd }) => {
  if (!player?.id || !cmd || NON_CANCELLING_CMDS.has(cmd)) return;
  cancelPlayerTasks(player.id);
});

// Live-refresh any open client quest UI (Tablet OS Quests app) the moment a quest
// changes state, so its objective checkboxes tick without the player reopening the
// app. Purely a client hint — the client no-ops it when the tablet is closed or not
// on the Quests app (client/game/js/dispatch.js -> tablet-os.js tabletQuestUpdate).
// Fired for every lifecycle transition in one place rather than threading a send
// through each mutation path above.
for (const ev of ['quest.started', 'quest.advanced', 'quest.completed', 'quest.turned_in', 'quest.abandoned', 'quest.failed']) {
  on(ev, ({ actor }) => { if (actor?.id) sendToPlayer(actor.id, { type: 'quest_update' }); });
}

// Raise the `gig_ready` player Flag when a job-board gig is completed, so Marta
// Kell's dialogue can offer the in-person hand-in (refreshGigReadyFlag clears it
// again once the last completed gig is turned back in).
on('quest.completed', ({ actor }) => { if (actor?.id) refreshGigReadyFlag(actor); });

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
      // A failed or ABANDONED quest can be taken again, and the counters (and the
      // clock, via a fresh started_at) start over.
      //
      // Failed is retryable by default because a permanent dead end in a living
      // world should be something an author ASKS for rather than something they get
      // by accident — `meta.failPermanent` opts into the lock.
      //
      // Abandoned was a plain bug, found by the retake test below: `quest abandon`
      // exists as a player verb and the tablet has a button for it, but START_QUEST
      // only ever re-activated a turned_in+repeatable row — so bailing on a quest
      // silently BLACKLISTED it forever. The NPC would still offer it and the accept
      // would quietly do nothing. Changing your mind is not a punishment.
      const retryable = (existing.status === 'failed' && !quest.meta?.failPermanent)
        || existing.status === 'abandoned';
      if (retryable || (existing.status === 'turned_in' && quest.repeatable)) {
        // Retaking clears whatever the last attempt left lying around before the
        // new attempt spawns its own — otherwise every retry of a retrieve quest
        // adds another copy to the floor.
        await despawnQuestItems(actor.id, quest_id);
        await query(
          `UPDATE player_quests SET status='active', progress=$1, progress_keys=$2, spawned='[]',
           started_at=EXTRACT(EPOCH FROM NOW()), updated_at=EXTRACT(EPOCH FROM NOW())
           WHERE player_id=$3 AND quest_id=$4`,
          [JSON.stringify(freshProgress(quest)), JSON.stringify(objectiveKeys(quest)), actor.id, quest_id]
        );
      } else {
        return { type: 'quest', quest_id, started: false };
      }
    } else {
      await query(
        'INSERT INTO player_quests (player_id,quest_id,status,progress,progress_keys) VALUES ($1,$2,$3,$4,$5)',
        [actor.id, quest_id, 'active', JSON.stringify(freshProgress(quest)), JSON.stringify(objectiveKeys(quest))]
      );
    }
    await setQuestFlag(actor, quest_id, 'active');
    await spawnRetrieveItems(actor, quest);
    msg(actor.id, `<span class="msg-system">New quest: ${quest.name}.</span>\n${quest.description || ''}`);
    questLogLine(actor, quest_id, 'start', quest.name);
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
    if (await expireIfTimedOut(actor, quest, pq)) return { type: 'error', message: 'That quest has run out of time.' };

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
    if (pq.status === 'failed') return { type: 'error', message: 'That quest was failed.' };
    if (await expireIfTimedOut(actor, quest, pq)) return { type: 'error', message: 'That quest has run out of time.' };
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
    const quest_id = params.quest_id || context?.quest_id || await completedJobBoardQuest(actor.id);
    if (!quest_id) return { type: 'error', message: 'TURN_IN requires quest_id.' };
    const quest = await loadQuest(quest_id);
    const pq = quest && await loadPlayerQuest(actor.id, quest_id);
    if (!pq) return { type: 'error', message: 'You have not started that quest.' };
    if (pq.status === 'turned_in') {
      msg(actor.id, `<span class="msg-system">You have already turned in ${quest.name}.</span>`);
      return { type: 'error', message: 'Already turned in.' };
    }
    if (pq.status === 'failed') {
      msg(actor.id, `<span class="msg-system">You failed ${quest.name}. There is nothing to hand in.</span>`);
      return { type: 'error', message: 'That quest was failed.' };
    }
    // The clock is checked at the counter too, not only in the field: a quest whose
    // deadline passed while you walked back to the turn-in must not pay out.
    if (await expireIfTimedOut(actor, quest, pq)) {
      return { type: 'error', message: 'That quest has run out of time.' };
    }
    if (pq.status !== 'completed' && !isComplete(quest, pq.progress || [])) {
      msg(actor.id, `<span class="msg-system">You have not finished ${quest.name} yet.</span>`);
      return { type: 'error', message: 'You have not finished that quest yet.' };
    }

    // CLAIM THE ROW BEFORE PAYING OUT. This used to be the other way round — every
    // reward was granted and the status written last, ~40 lines and a dozen awaits
    // after the status was READ. Two hand-ins racing (the Tablet button and a
    // dialogue node, or one impatient double-click) both passed the check above and
    // both paid; and a throw anywhere in the grants left the quest 'completed', so
    // it could simply be handed in again for a second full reward. On the only
    // thing quests give you, that's a duplication exploit.
    //
    // One conditional UPDATE decides it: whoever flips the row wins, everyone else
    // gets zero rows and stops. The deliberate trade is that a grant failing AFTER
    // the claim loses the reward rather than duplicating it — a player short one
    // payout is a support ticket, a player with infinite payouts is an economy.
    const claim = await query(
      `UPDATE player_quests SET status='turned_in', updated_at=EXTRACT(EPOCH FROM NOW())
       WHERE player_id=$1 AND quest_id=$2 AND status IN ('active','completed')`,
      [actor.id, quest_id]
    );
    if (!claim.rowCount) {
      msg(actor.id, `<span class="msg-system">You have already turned in ${quest.name}.</span>`);
      return { type: 'error', message: 'Already turned in.' };
    }

    // Rewards, plus a bonus for each OPTIONAL objective actually met — the whole
    // point of an optional objective being that finishing one is worth something.
    // Both go through the same grantRewards path, in that order, so a bonus can
    // never pay by a route the quest's own reward does not.
    const gains = await grantRewards(actor, quest.rewards, context);
    const finalProgress = Array.isArray(pq.progress) ? pq.progress : [];
    for (const [i, obj] of (quest.objectives || []).entries()) {
      if (!isOptional(obj) || !objectiveMet(obj, finalProgress[i]) || !obj.rewards) continue;
      gains.push(...await grantRewards(actor, obj.rewards, context, 'quest:bonus'));
    }
    await setQuestFlag(actor, quest_id, 'turned_in');   // status itself was claimed above
    // Any spare copies the auto-spawn left unclaimed go with it — the quest is over,
    // and a second relic on the sewer floor helps nobody.
    await despawnQuestItems(actor.id, quest_id);
    const creditLine = gains.length ? ` (${gains.join(', ')})` : '';
    msg(actor.id, `<span class="msg-system">Quest turned in: ${quest.name}.${creditLine}</span>`);
    emit('quest.turned_in', { actor, quest_id });
    // The sequel, if this quest names one. After the event, so anything listening
    // for the hand-in has already seen it happen.
    await startFollowUp(actor, quest, quest.on_turn_in);
    // Clear/keep the "finished gig ready" flag now this one's handed back, so Marta's
    // conversational hand-in option disappears once the last completed gig is gone.
    await refreshGigReadyFlag(actor);
    // quest_name lets a generic hand-in node fill `{quest}` in its text even when no
    // Tablet OS context named the quest (renderDialogueNode falls back to this).
    return { type: 'quest', quest_id, quest_name: quest.name, turned_in: true };
  },
});

// Player bailed on an active quest (e.g. jettisoned a flight contract's cargo
// mid-flight). Distinct from 'turned_in' so it never pays out and drops off the
// quest log, but the row (and its history) stays for reference.
// Fail a quest outright from dialogue or a script — "you told them, didn't you."
// The authored route for a failure that no event can express, sitting alongside the
// declarative `fail_on` conditions rather than replacing them.
registerAction({
  type: 'FAIL_QUEST',
  handler: async ({ actor, params }) => {
    const { quest_id, reason } = params;
    if (!quest_id) return { type: 'error', message: 'FAIL_QUEST requires quest_id.' };
    const quest = await loadQuest(quest_id);
    const pq = quest && await loadPlayerQuest(actor.id, quest_id);
    if (!pq || !['active', 'completed'].includes(pq.status)) {
      return { type: 'error', message: 'No live quest to fail.' };
    }
    const failed = await failQuest(actor, quest, { type: 'scripted', desc: reason });
    return { type: 'quest', quest_id, failed };
  },
});

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
    await despawnQuestItems(actor.id, quest_id);
    emit('quest.abandoned', { actor, quest_id });
    return { type: 'quest', quest_id, abandoned: true };
  },
});

// Every UNMET zone objective on this player's live quests, as
// `[{ zone, desc, questId, questName }]`.
//
// Why this exists: Coldwater's street names are shared by design — there are 19
// tiles called "Kessler Street", 10 called "Ironside Street", 366 "Grasslands".
// A quest objective's `desc` is therefore NOT a routable name, and `gps <desc>`
// resolves to the NEAREST same-named tile, which is almost never the one the
// objective wants. The player then walks somewhere plausible and the quest sits
// still, with nothing anywhere saying why.
//
// The objective's zone id IS unambiguous, so GPS asks for it (plugins/gps) rather
// than guessing from a name. Exposed as an Action rather than an import because
// gps must not depend on quests — see docs/proposals/engine-plugin-boundary.md.
registerAction({
  type: 'QUEST_OBJECTIVE_ZONES',
  handler: async ({ actor }) => {
    const { rows } = await query(
      `SELECT q.id, q.name, q.objectives, pq.progress
         FROM player_quests pq JOIN quests q ON q.id = pq.quest_id
        WHERE pq.player_id=$1 AND pq.status NOT IN ('turned_in','abandoned')`,
      [actor.id]
    );
    const out = [];
    for (const r of rows) {
      const objectives = Array.isArray(r.objectives) ? r.objectives : [];
      const progress = Array.isArray(r.progress) ? r.progress : [];
      objectives.forEach((o, i) => {
        if (!o?.zone) return;
        if ((progress[i] || 0) >= (o.count || 1)) return;   // already done
        out.push({ zone: o.zone, desc: o.desc || '', questId: r.id, questName: r.name });
      });
    }
    return { type: 'objective_zones', zones: out };
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
// Memoised per quest. The scan below is an UNINDEXED full-table cast-and-LIKE over
// every NPC's dialogue tree, and it ran TWICE on every quest completion (turnInHint
// and routeToTurnIn each call it) — at precisely the moment the player is waiting on
// a "quest complete" line. Dialogue trees are authored content, effectively static
// at runtime, so the same TTL treatment the quest rows already get applies cleanly.
// Misses are cached too (as null): a quest with no turn-in NPC at all — every flight
// contract — is the case that would otherwise re-scan forever, having nothing to find.
const TURNIN_CACHE_TTL_MS = 60_000;
const turnInCache = new Map(); // quest_id -> { npc, at }

export function invalidateTurnInCache(questId) {
  if (questId) turnInCache.delete(questId);
  else turnInCache.clear();
}

export async function findTurnInNpc(questId) {
  const hit = turnInCache.get(questId);
  if (hit && Date.now() - hit.at < TURNIN_CACHE_TTL_MS) return hit.npc;
  const npc = await findTurnInNpcUncached(questId);
  turnInCache.set(questId, { npc, at: Date.now() });
  return npc;
}

async function findTurnInNpcUncached(questId) {
  const { rows } = await query(
    "SELECT id, name, home_zone, work_zone_id, dialogue_tree FROM npcs WHERE dialogue_tree::text LIKE '%TURN_IN%'"
  );
  for (const npc of rows) {
    const tree = npc.dialogue_tree || {};
    const hasTurnIn = (acts) => (acts || []).some((a) => a?.action === 'TURN_IN' && a.quest_id === questId);
    const found = Object.values(tree).some((node) => hasTurnIn(node.actions) || (node.options || []).some((o) => hasTurnIn(o.actions)));
    // home_zone comes off the LIVE npc, not this row: a play-time relocation
    // (npc_home_overrides) is merged into the live copy at load and never written
    // back to the npcs table, so trusting the row here would point the quest log
    // at the home an NPC was authored with rather than the one they moved to.
    if (found) {
      const live = world.npcs.get(npc.id);
      return { npcId: npc.id, npcName: npc.name, zone: npc.work_zone_id || live?.home_zone || npc.home_zone };
    }
  }
  try {
    const { turnInNpcForQuest } = await import('../jobboard/index.js');
    return await turnInNpcForQuest(questId);
  } catch { return null; }
}

// --- Player command: quest log ---------------------------------------------

// "(4m left)" on a timed quest. A deadline the player can't see isn't a deadline,
// it's an ambush — so the log states it plainly, and states it in the units it's
// actually felt in. Empty for every untimed quest, which is nearly all of them.
function timeLeftTag(pq) {
  const limit = timeLimitOf({ fail_on: pq.fail_on });
  if (!limit) return '';
  const left = Math.max(0, Math.ceil((Number(pq.started_at) + limit) - Date.now() / 1000));
  const txt = left >= 90 ? `${Math.ceil(left / 60)}m` : `${left}s`;
  return ` <span class="text-yellow">(${txt} left)</span>`;
}

async function questLog(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const { rows } = await query(
    `SELECT pq.*, q.name, q.objectives, q.fail_on FROM player_quests pq
     JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status NOT IN ('turned_in', 'abandoned')
     ORDER BY pq.started_at`,
    [player.id]
  );
  // Opening the log is a moment to settle any quest whose clock ran out — the
  // lazy timeout is checked wherever a quest is looked at, not only where one is
  // advanced, so a player who stopped to read their log isn't told a dead quest
  // is still live. Failures drop out of the listing below.
  for (const pq of rows) {
    if (pq.status !== 'active') continue;
    if (await expireIfTimedOut(player, { id: pq.quest_id, name: pq.name, fail_on: pq.fail_on }, pq)) pq.status = 'failed';
  }
  const live = rows.filter((pq) => pq.status !== 'failed');
  if (!live.length) return { type: 'output', message: 'You have no active quests.' };

  const lines = ['<span class="msg-system">— Quests —</span>'];
  for (const pq of live) {
    const objectives = pq.objectives || [];
    const progress = Array.isArray(pq.progress) ? pq.progress : [];
    const tag = pq.status === 'completed' ? ' (ready to turn in)' : timeLeftTag(pq);
    // The tracked one is called out here because this log is the only place a
    // non-tablet player would ever see that tracking is a thing you can do.
    const mark = player.tracked_quest_id === pq.quest_id ? '<span class="text-cyan">▸</span> ' : '';
    lines.push(`${mark}<span class="msg-system">${pq.name}${tag}</span>`);
    objectives.forEach((obj, i) => lines.push(objectiveLine(obj, progress[i] || 0, !requiresMet(objectives, obj, progress))));
  }
  lines.push('<span class="text-dim">quest track &lt;name&gt; · quest abandon &lt;name&gt;</span>');
  return { type: 'output', message: lines.join('\n') };
}

// ── quest track / abandon ────────────────────────────────────────────────────
// Both of these existed only as buttons in the tablet's Quests app: it was the
// sole caller of ABANDON_QUEST and the only writer of `players.tracked_quest_id`
// anywhere in the codebase. A player who didn't use the tablet could take a quest
// and then never drop it or track it. Same operations, reached by typing.

// Match what somebody typed against their OWN open quests. Exact name first, then
// a prefix, then a contained fragment — and an ambiguous fragment is refused by
// name rather than guessed at, because the destructive one of these two is not a
// thing to be clever about.
function matchQuest(rows, raw) {
  const q = String(raw || '').trim().toLowerCase();
  if (!q) return { error: 'Which quest? Try "quest" to list them.' };
  const norm = r => String(r.name || '').toLowerCase();
  const exact = rows.find(r => norm(r) === q) || rows.find(r => r.quest_id.toLowerCase() === q);
  if (exact) return { row: exact };
  const hits = rows.filter(r => norm(r).startsWith(q));
  const wide = hits.length ? hits : rows.filter(r => norm(r).includes(q));
  if (!wide.length) return { error: `You have no open quest matching "${raw}".` };
  if (wide.length > 1) {
    return { error: `That could be: ${wide.map(r => `<b>${r.name}</b>`).join(', ')}. Be more specific.` };
  }
  return { row: wide[0] };
}

async function openQuests(playerId) {
  const { rows } = await query(
    `SELECT pq.quest_id, pq.status, pq.progress, q.name, q.objectives FROM player_quests pq
     JOIN quests q ON q.id = pq.quest_id
     WHERE pq.player_id=$1 AND pq.status NOT IN ('turned_in', 'abandoned', 'failed')
     ORDER BY pq.started_at`,
    [playerId]
  );
  return rows;
}

// `quest track <name>` — toggles, exactly as the app's button does, and plots the
// same GPS route to the next objective so the two paths behave identically.
async function questTrack(rest, player) {
  const rows = await openQuests(player.id);
  if (!rows.length) return { type: 'output', message: 'You have no active quests.' };

  if (!rest) {
    if (!player.tracked_quest_id) return { type: 'output', message: 'You are not tracking a quest.' };
    const cur = rows.find(r => r.quest_id === player.tracked_quest_id);
    return { type: 'output', message: `Tracking <b>${cur?.name || player.tracked_quest_id}</b>.` };
  }

  const m = matchQuest(rows, rest);
  if (m.error) return { type: 'error', message: m.error };

  const already = player.tracked_quest_id === m.row.quest_id;
  player.tracked_quest_id = already ? null : m.row.quest_id;
  await query('UPDATE players SET tracked_quest_id=$1 WHERE id=$2', [player.tracked_quest_id, player.id]);
  if (already) return { type: 'output', message: `No longer tracking <b>${m.row.name}</b>.` };

  // Plot the route to the next unmet objective with a zone, same as the app.
  const progress = Array.isArray(m.row.progress) ? m.row.progress : [];
  const next = (m.row.objectives || []).find((obj, i) => obj.zone && (progress[i] || 0) < (obj.count || 1));
  if (next && next.zone !== player.current_zone) {
    const destZone = getZone(next.zone);
    const path = destZone ? findPath(player.current_zone, next.zone) : null;
    if (path && path.length >= 2) {
      sendToPlayer(player.id, { type: 'gps_route', message: `GPS locked: ${destZone.name}. Route plotted on the map.`, path, continueOnArrival: false });
    }
  }
  return { type: 'output', message: `Tracking <b>${m.row.name}</b>.` };
}

// `quest abandon <name>` — two-step, because it can't be undone. The app puts a
// confirm dialog in front of the same action; a modal is the wrong answer for a
// typed verb (and for a screen reader), so the confirmation is a second command
// the player can see and re-read rather than a box that steals focus.
async function questAbandon(rest, player) {
  const rows = await openQuests(player.id);
  if (!rows.length) return { type: 'output', message: 'You have no active quests.' };

  const confirmed = /\s+(confirm|yes)$/i.test(rest);
  const nameArg = rest.replace(/\s+(confirm|yes)$/i, '').trim();
  const m = matchQuest(rows, nameArg);
  if (m.error) return { type: 'error', message: m.error };

  if (!confirmed) {
    return {
      type: 'output',
      message: `Abandon <b>${m.row.name}</b>? Progress is lost and it can't be undone.\n`
        + `<span class="action-link" data-action="cmd" data-cmd="quest abandon ${m.row.name} confirm">quest abandon ${m.row.name} confirm</span>`,
    };
  }

  const res = await dispatchAction({ type: 'ABANDON_QUEST', actor: player, params: { quest_id: m.row.quest_id } });
  if (res?.type === 'error') return res;
  if (player.tracked_quest_id === m.row.quest_id) {
    player.tracked_quest_id = null;
    await query('UPDATE players SET tracked_quest_id=NULL WHERE id=$1', [player.id]);
  }
  return { type: 'output', message: `<span class="msg-system">Abandoned <b>${m.row.name}</b>.</span>` };
}

// One verb with subcommands rather than three top-level ones: `abandon` and
// `track` are both far too generic to own outright, and `quest abandon` reads the
// way a player would say it.
async function questCommand(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();
  if (sub === 'track' || sub === 'untrack') return questTrack(rest, player);
  if (sub === 'abandon' || sub === 'drop') return questAbandon(rest, player);
  return questLog(args, raw, player);
}

export const commands = {
  quests: questCommand,
  quest: questCommand,
  ql: questCommand,
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
        `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,fail_on,penalties,on_fail,on_turn_in,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,EXTRACT(EPOCH FROM NOW()))`,
        [qid, body.name || 'Untitled Quest', body.description || '',
         JSON.stringify(body.objectives || []), JSON.stringify(body.rewards || {}), body.repeatable ? 1 : 0,
         body.quest_type || 'standard', JSON.stringify(body.meta || {}), JSON.stringify(body.fail_on || []),
         JSON.stringify(body.penalties || {}),
         body.on_fail ? JSON.stringify(body.on_fail) : null,
         body.on_turn_in ? JSON.stringify(body.on_turn_in) : null]
      );
      invalidateQuestCache(qid);
      return { status: 201, body: { id: qid } };
    }
    if (id && method === 'PUT') {
      await query(
        `UPDATE quests SET name=$1,description=$2,objectives=$3,rewards=$4,repeatable=$5,quest_type=$6,meta=$7,
         fail_on=$8, penalties=$9, on_fail=$10, on_turn_in=$11, updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$12`,
        [body.name || 'Untitled Quest', body.description || '',
         JSON.stringify(body.objectives || []), JSON.stringify(body.rewards || {}), body.repeatable ? 1 : 0,
         body.quest_type || 'standard', JSON.stringify(body.meta || {}), JSON.stringify(body.fail_on || []),
         JSON.stringify(body.penalties || {}),
         body.on_fail ? JSON.stringify(body.on_fail) : null,
         body.on_turn_in ? JSON.stringify(body.on_turn_in) : null, id]
      );
      invalidateQuestCache(id);
      return { status: 200, body: { id } };
    }
    if (id && method === 'DELETE') {
      if (auth.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
      await query('DELETE FROM quests WHERE id=$1', [id]);
      invalidateQuestCache(id);
      return { status: 200, body: { message: 'Deleted' } };
    }
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
  return null;
};
