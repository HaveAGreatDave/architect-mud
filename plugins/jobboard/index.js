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
import { dispatchAction } from '../../server/engine/actions.js';
import { getFlag, setFlag, clearFlag } from '../../server/engine/flags.js';

const DEFAULT_PERIOD = 21600; // 6h

async function boardInZone(zoneId) {
  if (!zoneId) return null;
  const { rows } = await query('SELECT * FROM job_boards WHERE zone_id=$1 ORDER BY id LIMIT 1', [zoneId]);
  return rows[0] || null;
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
async function activeJobIds(board) {
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
async function loadJobs(ids, playerId) {
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

function creditsOf(quest) { return (quest.rewards && quest.rewards.credits) || 0; }

async function listBoard(board, player) {
  const jobs = await loadJobs(await activeJobIds(board), player.id);
  const lines = [`<span class="msg-system">${board.name}</span>`];
  if (board.description) lines.push(board.description);
  if (!jobs.length) {
    lines.push('The board is bare. Come back when someone needs something done.');
    return { type: 'output', message: lines.join('\n') };
  }
  jobs.forEach(({ quest, pq }, i) => {
    const prog = Array.isArray(pq?.progress) ? pq.progress : [];
    let tag;
    if (!pq || pq.status === 'turned_in') tag = 'open';
    else if (pq.status === 'completed' || isComplete(quest, prog)) tag = `READY — gigs claim ${i + 1}`;
    else tag = 'taken';
    lines.push(`  <span class="msg-system">${i + 1})</span> ${quest.name} — ${creditsOf(quest)}₵ [${tag}]`);
    if (quest.description) lines.push(`     ${quest.description}`);
  });
  lines.push('Take one with <span class="msg-system">gigs take &lt;n&gt;</span>, hand it back with <span class="msg-system">gigs claim &lt;n&gt;</span>.');
  return { type: 'output', message: lines.join('\n') };
}

async function takeJob(board, player, n) {
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

async function claimJob(board, player, n) {
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

async function gigs(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const board = await boardInZone(player.current_zone);
  if (!board) return { type: 'output', message: "There's no work posted here." };

  const tokens = String(args || '').trim().split(/\s+/).filter(Boolean);
  const sub = (tokens[0] || '').toLowerCase();
  const n = parseInt(tokens[1], 10);
  if (['take', 'accept', 'apply'].includes(sub)) return takeJob(board, player, n);
  if (['claim', 'handin', 'hand', 'collect', 'deliver', 'done'].includes(sub)) return claimJob(board, player, n);
  return listBoard(board, player);
}

export const commands = {
  gigs,
  postings: gigs,
  jobboard: gigs,
};

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
