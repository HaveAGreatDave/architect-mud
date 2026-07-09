/**
 * Job board plugin.
 *
 * Surfaces a devpanel-authored pool of repeatable "gig" quests as legal, low-pay
 * early-money work posted in a zone. The board owns no quest logic — it is a
 * discovery + rotation layer over the quests plugin: `gigs` lists the currently-
 * rotated postings, `gigs take N` dispatches START_QUEST, `gigs claim N` dispatches
 * TURN_IN. Each job is an ordinary row in the `quests` table (authored in the quest
 * editor); which jobs a board offers, how many rotate, and how often is per-board
 * config set in the Job Boards dev panel.
 *
 * Rotation: the board row is pure config. The live selection is a snapshot cached in
 * a world_flag (jobboard_rot_<id> = {jobs:[quest_id...], at:epoch}) and re-rolled
 * lazily on read once `rotation_period` seconds have elapsed — so no boot-time tick
 * is needed (CLAUDE.md: boot stays deliberate).
 *
 * Verbs are `gigs`/`postings`/`jobboard` (NOT `jobs`/`board`/`take`/`claim`, which
 * are already owned by flight/gametable/posters/corps).
 */
import { query } from '../../server/models/db.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { getFlag, setFlag, clearFlag } from '../../server/engine/flags.js';
import { sendToZone } from '../../server/engine/messaging.js';

const DEFAULT_PERIOD = 21600; // 6h

export async function boardInZone(zoneId) {
  if (!zoneId) return null;
  const { rows } = await query('SELECT * FROM job_boards WHERE zone_id=$1 ORDER BY id LIMIT 1', [zoneId]);
  return rows[0] || null;
}

// Which NPC hands a job-board quest in — the dispatcher standing at that board's
// zone, marked with flags.job_board_dispatcher (Marta Kell at the Franchise
// Strip). A content flag rather than a dialogue-authored signal (an earlier
// version scanned for an OPEN_JOBBOARD dialogue action) because her dialogue no
// longer narrates the board inline — "What's on the board?" jumps straight to
// Tablet OS now, so nothing in her tree references the board by name anymore.
// This mirrors the quests plugin's findTurnInNpc (a dialogue-authored TURN_IN
// action) without requiring the board's rotating quest_pool to be hand-authored
// onto her tree one quest at a time — any board's dispatcher is discovered
// automatically from the flag. Called from plugins/quests/index.js via a dynamic
// import (same cross-plugin pattern jobboard itself uses for tablet), so quests
// stays jobboard-agnostic.
export async function turnInNpcForQuest(questId) {
  const { rows: boards } = await query('SELECT id, zone_id, quest_pool FROM job_boards');
  const board = boards.find((b) => Array.isArray(b.quest_pool) && b.quest_pool.includes(questId));
  if (!board) return null;
  // The dispatcher is usually the board zone's greeter (Marta Kell), who is placed
  // dynamically and so carries a null npcs.zone_id — resolve her through the zone's
  // greeter link first, then fall back to a statically-placed flagged NPC in the zone.
  const { rows: npcs } = await query(
    `SELECT n.id, n.name, n.zone_id
       FROM npcs n
       JOIN zones z ON z.id = $1
      WHERE (n.id = z.flags->'greeter'->>'npc_id' OR n.zone_id = $1)
        AND n.flags->>'job_board_dispatcher' = 'true'
      ORDER BY (n.id = z.flags->'greeter'->>'npc_id') DESC
      LIMIT 1`,
    [board.zone_id]
  );
  const npc = npcs[0];
  return npc ? { npcId: npc.id, npcName: npc.name, zone: board.zone_id } : null;
}

function nowSec() { return Math.floor(Date.now() / 1000); }

function isComplete(quest, progress) {
  return (quest.objectives || []).every((o, i) => (progress[i] || 0) >= (o.count || 1));
}

// Shuffle a copy (Fisher–Yates) and take up to n — the rotation's random subset.
function sample(pool, n) {
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, n));
}

// The board's currently-posted quest ids, re-rolling into a world_flag snapshot
// when the rotation period has elapsed (or the snapshot is missing/stale).
export async function activeJobIds(board) {
  const pool = Array.isArray(board.quest_pool) ? board.quest_pool : [];
  const size = board.rotation_size || 3;
  const period = Number(board.rotation_period) || DEFAULT_PERIOD;
  const key = `jobboard_rot_${board.id}`;
  let snap = null;
  try { snap = JSON.parse((await getFlag('world', key)) || 'null'); } catch { snap = null; }

  if (snap && Array.isArray(snap.jobs) && (nowSec() - (snap.at || 0)) < period) {
    // Drop ids that have since left the pool / been deleted from `quests`.
    const stillOffered = snap.jobs.filter((id) => pool.includes(id));
    if (stillOffered.length) return stillOffered;
  }
  const rolled = sample(pool, size);
  await setFlag('world', key, JSON.stringify({ jobs: rolled, at: nowSec() }));
  return rolled;
}

// Join the active ids to their quest rows + the player's per-quest state, preserving
// rotation order and skipping ids whose quest row has vanished.
export async function loadJobs(ids, playerId) {
  if (!ids.length) return [];
  const { rows: quests } = await query('SELECT * FROM quests WHERE id = ANY($1)', [ids]);
  const byId = new Map(quests.map((q) => [q.id, q]));
  const { rows: pqs } = await query(
    'SELECT quest_id, status, progress FROM player_quests WHERE player_id=$1 AND quest_id = ANY($2)',
    [playerId, ids]
  );
  const pqById = new Map(pqs.map((p) => [p.quest_id, p]));
  return ids.map((id) => byId.get(id)).filter(Boolean)
    .map((q) => ({ quest: q, pq: pqById.get(q.id) || null }));
}

export function creditsOf(quest) { return (quest.rewards && quest.rewards.credits) || 0; }

// A clickable command link the game client understands (main.js handleActionLinkClick
// → sendCmd(dataset.rawCmd)). Clicking [Take] submits `gigs take <n>`, etc.
function cmdLink(cmd, label) {
  return `<span class="action-link" data-raw-cmd="${cmd}" data-label="${label}">[${label}]</span>`;
}

export function jobState(quest, pq) {
  const prog = Array.isArray(pq?.progress) ? pq.progress : [];
  if (!pq || pq.status === 'turned_in') return 'open';
  if (pq.status === 'completed' || isComplete(quest, prog)) return 'ready';
  return 'active';
}

// Aggregate progress across all objectives → {have, need} for the "in progress" tag.
export function progressTotals(quest, pq) {
  const prog = Array.isArray(pq?.progress) ? pq.progress : [];
  const objs = quest.objectives || [];
  const need = objs.reduce((s, o) => s + (o.count || 1), 0);
  const have = objs.reduce((s, o, i) => s + Math.min(prog[i] || 0, o.count || 1), 0);
  return { have, need };
}

// The board's live postings as a message string, with a clickable [Take]/[Hand in]
// on each line. Shared by `gigs`, `read <board>`, and Marta's OPEN_JOBBOARD.
async function renderBoardText(board, player) {
  const jobs = await loadJobs(await activeJobIds(board), player.id);
  const lines = [`<span class="msg-system">${board.name}</span>`];
  if (board.description) lines.push(board.description);
  if (!jobs.length) {
    lines.push('The board is bare. Come back when someone needs something done.');
    return lines.join('\n');
  }
  jobs.forEach(({ quest, pq }, idx) => {
    const i = idx + 1;
    const state = jobState(quest, pq);
    let right;
    if (state === 'ready') right = cmdLink(`gigs claim ${i}`, 'Hand in');
    else if (state === 'active') { const { have, need } = progressTotals(quest, pq); right = `<span class="text-dim">in progress (${have}/${need})</span>`; }
    else right = cmdLink(`gigs take ${i}`, 'Take');
    lines.push(`  <span class="msg-system">${i})</span> ${quest.name} — ${creditsOf(quest)}₵ &nbsp;${right}`);
    if (quest.description) lines.push(`     <span class="text-dim">${quest.description}</span>`);
  });
  lines.push('<span class="text-dim">Click a job, or type</span> <span class="msg-system">gigs take &lt;n&gt;</span> <span class="text-dim">/</span> <span class="msg-system">gigs claim &lt;n&gt;</span>.');
  return lines.join('\n');
}

export async function takeJob(board, player, n) {
  const jobs = await loadJobs(await activeJobIds(board), player.id);
  const job = jobs[(n || 0) - 1];
  if (!job) return { type: 'error', message: 'No posting by that number. Type `gigs` to read the board.' };
  const { quest, pq } = job;
  if (pq && pq.status !== 'turned_in') {
    if (pq.status === 'completed') return { type: 'output', message: `You've already finished "${quest.name}". Hand it back: gigs claim ${n}.` };
    return { type: 'output', message: `You're already on "${quest.name}".` };
  }
  const res = await dispatchAction({ type: 'START_QUEST', actor: player, params: { quest_id: quest.id } });
  if (res?.type === 'error') return { type: 'error', message: res.message };
  if (res?.started === false) return { type: 'output', message: `You can't take "${quest.name}" again just now.` };
  return { type: 'output', message: `You tear the tab off the board. Work taken: ${quest.name}.` };
}

export async function claimJob(board, player, n) {
  const jobs = await loadJobs(await activeJobIds(board), player.id);
  const job = jobs[(n || 0) - 1];
  if (!job) return { type: 'error', message: 'No posting by that number. Type `gigs` to read the board.' };
  const { quest, pq } = job;
  const prog = Array.isArray(pq?.progress) ? pq.progress : [];
  if (!pq || pq.status === 'turned_in') return { type: 'output', message: `You haven't taken "${quest.name}" yet.` };
  if (pq.status !== 'completed' && !isComplete(quest, prog)) return { type: 'output', message: `"${quest.name}" isn't done yet.` };
  // TURN_IN pays out and messages the player itself (the +credits line).
  await dispatchAction({ type: 'TURN_IN', actor: player, params: { quest_id: quest.id } });
  return { type: 'output', message: 'You hand it back. The credits change hands without ceremony.' };
}

// Bare `gigs`/`postings`/`jobboard` opens Tablet OS pre-navigated to Quests → Job
// Board (the "no duplicate UI" ask) instead of text-rendering the board. `take`/
// `claim` subcommands still work as chat shortcuts (dispatch straight to the
// quest actions) so a player who already knows the numbers doesn't need the panel.
async function gigs(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };

  // args arrives as an array (server/engine/plugins.js dispatch contract) — a prior
  // String(args) here joined it with commas ("take,1"), so `gigs take 1` never matched.
  const tokens = (args || []).filter(Boolean);
  const sub = (tokens[0] || '').toLowerCase();
  const n = parseInt(tokens[1], 10);
  const needsBoard = ['take', 'accept', 'apply', 'claim', 'handin', 'hand', 'collect', 'deliver', 'done'].includes(sub);

  // Bare `gigs` opens Tablet OS at Quests → Job Board regardless of whether a
  // physical board is in this zone — the app aggregates postings itself.
  if (!needsBoard) {
    const { commands: tabletCommands } = await import('../tablet/index.js');
    return tabletCommands.tabletnav(['quests', 'Job Board'], raw, player);
  }

  const board = await boardInZone(player.current_zone);
  if (!board) return { type: 'output', message: "There's no work posted here." };
  if (['take', 'accept', 'apply'].includes(sub)) return takeJob(board, player, n);
  return claimJob(board, player, n);
}

export const commands = {
  gigs,
  postings: gigs,
  jobboard: gigs,
};

// --- Actionable board object: `read <board>` (surfaces on the board's smart bar) ---
// Gated on the `job_board` furniture tag — the board itself becomes a clickable
// notice board that lists the live rotating postings (same as `gigs`).
async function readBoard(args, raw, player) {
  const board = await boardInZone(player.current_zone);
  if (!board) return { type: 'error', message: "There's nothing worth reading here." };
  const { commands: tabletCommands } = await import('../tablet/index.js');
  return tabletCommands.tabletnav(['quests', 'Job Board'], raw, player);
}

export const specializedActions = [
  { verb: 'read', requiredTag: 'job_board', handler: readBoard },
];

// --- OPEN_JOBBOARD dialogue Action — lets an NPC (Marta) read you the postings ----
// A static dialogue tree can't enumerate the rotating set, so her dialogue dispatches
// this; the {dialogue_line} result is appended to her spoken reply (server/index.js).
registerAction({
  type: 'OPEN_JOBBOARD',
  handler: async ({ actor }) => {
    const board = await boardInZone(actor.current_zone);
    if (!board) return { type: 'dialogue_line', text: "The board's bare today. Nothing worth your legs." };
    return { type: 'dialogue_line', text: await renderBoardText(board, actor) };
  },
});

// --- Greeter move gate: a first-time NPC stops you leaving, once --------------------
// Driven by a zone flag (`flags.greeter = { npc_id, npc_name, met_flag, lines[] }`) set
// in content — the hardcoded ids/lines stay out of the engine (the govgate principle).
// When a player who hasn't met the greeter tries to LEAVE the zone, the greeter (if
// present) hollers one of the lines and the move is blocked once; the met flag is set so
// the next step is free and talking to them later still works. Writing on the block path
// mirrors the govgate checkpoint precedent (a gate that has to react, not just veto).
registerMoveGate(async ({ player, from }) => {
  const g = from?.flags?.greeter;
  if (!g || !g.npc_id) return;
  const metFlag = g.met_flag || `met_${g.npc_id}`;
  if (await getFlag('player', metFlag, player)) return;          // already met → free to go
  if (!from.npcs || !from.npcs.has(g.npc_id)) return;            // greeter not here → no stop
  const lines = Array.isArray(g.lines) ? g.lines.filter(Boolean) : [];
  if (!lines.length) return;
  const who = g.npc_name || 'Someone';
  const line = lines[Math.floor(Math.random() * lines.length)];
  await setFlag('player', metFlag, 'true', player);
  sendToZone(from.id, { type: 'zone_event', message: `${who} throws up a hand and hollers at ${player.handle}.` }, player.id);
  return { block: true, message: `${who} steps into your path, one hand up. <span class="ambient">"${line}"</span>` };
}, 'jobboard:greeter');

// --- Dev CRUD (devpanel Job Boards authoring) ------------------------------

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/job-boards')) return null;
  if (!devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  const id = path.split('/')[2];
  try {
    if (path === '/job-boards' && method === 'GET') {
      const { rows } = await query('SELECT * FROM job_boards ORDER BY name');
      return { status: 200, body: rows };
    }
    if (path === '/job-boards' && method === 'POST') {
      const bid = body.id || `board_${Date.now()}`;
      await query(
        `INSERT INTO job_boards (id,zone_id,name,description,quest_pool,rotation_size,rotation_period,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,EXTRACT(EPOCH FROM NOW()))`,
        [bid, body.zone_id || '', body.name || 'Job Board', body.description || '',
         JSON.stringify(body.quest_pool || []), body.rotation_size || 3, body.rotation_period || DEFAULT_PERIOD]
      );
      return { status: 201, body: { id: bid } };
    }
    if (id && method === 'PUT') {
      await query(
        `UPDATE job_boards SET zone_id=$1,name=$2,description=$3,quest_pool=$4,rotation_size=$5,rotation_period=$6,
         updated_at=EXTRACT(EPOCH FROM NOW()) WHERE id=$7`,
        [body.zone_id || '', body.name || 'Job Board', body.description || '',
         JSON.stringify(body.quest_pool || []), body.rotation_size || 3, body.rotation_period || DEFAULT_PERIOD, id]
      );
      // Clear the rotation snapshot so an edited pool/size shows on the next read.
      await clearFlag('world', `jobboard_rot_${id}`);
      return { status: 200, body: { id } };
    }
    if (id && method === 'DELETE') {
      if (auth.role !== 'admin') return { status: 403, body: { error: 'Admin access required' } };
      await query('DELETE FROM job_boards WHERE id=$1', [id]);
      await clearFlag('world', `jobboard_rot_${id}`);
      return { status: 200, body: { message: 'Deleted' } };
    }
  } catch (e) {
    return { status: 400, body: { error: e.message } };
  }
  return null;
};
