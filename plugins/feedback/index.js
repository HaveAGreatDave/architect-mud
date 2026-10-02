// Feedback: a player's report from the header button (the `feedback` WS message)
// or the `feedback` verb, stored with where they were and what they were doing.
//
// Everything about the player is read off the live object and the world Maps, so
// a report costs one INSERT and nothing else. Staff read the inbox in the dev
// panel tab (panel.js). If FEEDBACK_WEBHOOK_URL is set, a short copy also goes to
// Discord; the telemetry and the player id never leave the server.
import { query } from '../../server/models/db.js';
import { getLivePlayer, getZone, regionForZone } from '../../server/engine/world.js';
import { districtFor } from '../../server/engine/districts.js';
import { powerAnchorOf, getGameDateTime } from '../../server/engine/environment.js';
import { attackersOf } from '../../server/engine/combat.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';

export const CATEGORIES = ['bug', 'idea', 'typo', 'other'];
export const STATUSES = ['open', 'seen', 'fixed', 'wontfix'];
const MAX_TEXT = 2000;
const MAX_CLIENT_BYTES = 16000;
const COOLDOWN_MS = 60_000;
const STAFF = ['dev', 'admin', 'builder', 'designer'];

// Last accepted report per player. RAM only: a restart forgives a cooldown.
const lastSent = new Map();

// Checks a report and returns { error } or the cleaned fields. No side effects.
export function validate({ category, text, client }) {
  const cat = CATEGORIES.includes(category) ? category : 'other';
  const body = String(text ?? '').trim();
  if (!body) return { error: 'Write something first.' };
  if (body.length > MAX_TEXT) return { error: `That's too long. Keep it under ${MAX_TEXT} characters.` };
  let clientCtx = null;
  if (client && typeof client === 'object') {
    const json = JSON.stringify(client);
    clientCtx = json.length <= MAX_CLIENT_BYTES ? client : { truncated: true, bytes: json.length };
  }
  return { category: cat, body, clientCtx };
}

export function cooldownLeft(playerId, now = Date.now()) {
  const last = lastSent.get(playerId);
  return last ? Math.max(0, COOLDOWN_MS - (now - last)) : 0;
}

// Where the player is and what they're doing, from memory only.
export function serverContext(player) {
  const zone = getZone(player.current_zone);
  const anchor = powerAnchorOf(zone);
  const region = regionForZone(zone) || (anchor?.region ? { id: anchor.region } : null);
  // districtFor always answers, falling back to a default; off the world map
  // (the prologue, a dream) that answer is a guess, so leave it out.
  const district = anchor ? districtFor(zone) : null;
  let inCombat = false;
  try { inCombat = attackersOf(player).length > 0; } catch { /* no combat state */ }
  return {
    player: { id: player.id, handle: player.handle, role: player.role || null },
    zone: zone ? { id: zone.id, name: zone.name, map: zone.map_id, x: zone.grid_x, y: zone.grid_y, z: zone.grid_z } : { id: player.current_zone },
    anchor,
    region: region ? { id: region.id, name: region.name || null } : null,
    district: district?.key ? { key: district.key, name: district.name || null } : null,
    activity: {
      posture: player.posture || null,
      sittingOn: player.sittingOn || null,
      aircraftId: player.aircraftId || null,
      seat: player.seat || null,
      sleeping: !!player.sleeping,
      inCombat,
      displayRung: player.displayRung || null,
    },
    vitals: {
      hp: player.hp, hpMax: player.hp_max,
      statuses: Array.isArray(player.statuses) ? player.statuses.map(s => s?.id || s?.type || s).slice(0, 20) : [],
    },
    gameTime: getGameDateTime(),
    serverTime: new Date().toISOString(),
  };
}

function webhook(row, ctx) {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) return;
  const where = [ctx.zone?.name || ctx.zone?.id, ctx.district?.name, ctx.anchor ? `${ctx.anchor.x},${ctx.anchor.y}` : null]
    .filter(Boolean).join(' · ');
  const text = row.body.length > 300 ? row.body.slice(0, 300) + '…' : row.body;
  const content = `**#${row.id} ${row.category}** from **${row.handle}** (${where})\n${text}`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch(e => console.warn('[feedback] webhook failed:', e.message));
}

// The one write path, shared by the WS route and the verb. Returns { ok, id } or { error }.
export async function submit(player, input) {
  if (!player) return { error: 'Not signed in.' };
  const left = cooldownLeft(player.id);
  if (left) return { error: `You've just sent one. Try again in ${Math.ceil(left / 1000)}s.` };
  const v = validate(input);
  if (v.error) return v;
  const ctx = serverContext(player);
  lastSent.set(player.id, Date.now());
  try {
    const { rows } = await query(
      `INSERT INTO player_feedback (player_id, handle, category, body, zone_id, server_ctx, client_ctx)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [player.id, player.handle, v.category, v.body, player.current_zone || null, ctx, v.clientCtx]);
    const id = rows[0].id;
    webhook({ id, handle: player.handle, category: v.category, body: v.body }, ctx);
    return { ok: true, id };
  } catch (e) {
    lastSent.delete(player.id);
    console.warn('[feedback] insert failed:', e.message);
    return { error: "It didn't go through. Try again in a moment." };
  }
}

on('feedback.submit', async ({ playerId, category, text, client }) => {
  const player = getLivePlayer(playerId);
  if (!player) return;
  const res = await submit(player, { category, text, client });
  sendToPlayer(playerId, res.ok ? { type: 'feedback_ok', id: res.id } : { type: 'feedback_err', message: res.error });
});

// `feedback <text>` for log-mode and keyboard players. A leading category word
// (bug, idea, typo) is taken as the category.
async function cmdFeedback(args, raw, player) {
  const words = (args || []).map(String);
  if (!words.length) return { type: 'output', message: 'Usage: feedback [bug|idea|typo] <what you want to tell us>. The ⚑ button at the top right does the same.' };
  const category = CATEGORIES.includes(words[0].toLowerCase()) ? words.shift().toLowerCase() : 'other';
  const res = await submit(player, { category, text: words.join(' '), client: null });
  return res.ok
    ? { type: 'output', message: `<span class="msg-system">Thanks. Your ${category === 'other' ? 'feedback' : category} report is #${res.id}.</span>` }
    : { type: 'error', message: res.error };
}

export const commands = { feedback: cmdFeedback };

// ── Staff inbox ─────────────────────────────────────────────────────────────
export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/feedback')) return null;
  if (!auth || !STAFF.includes(auth.role)) return { status: 403, body: { error: 'Staff access required' } };

  // /feedback/list[/<status|all>[/<offset>]]. Path segments, because routes.js
  // strips the query string before a plugin sees the path.
  const list = path.match(/^\/feedback\/list(?:\/(\w+))?(?:\/(\d+))?$/);
  if (list && method === 'GET') {
    const status = list[1];
    const offset = parseInt(list[2], 10) || 0;
    const where = STATUSES.includes(status) ? 'WHERE status = $1' : '';
    const params = where ? [status, offset] : [offset];
    const off = where ? '$2' : '$1';
    const [{ rows }, counts] = await Promise.all([
      query(`SELECT id, handle, category, LEFT(body, 160) AS preview, zone_id, status, created_at
             FROM player_feedback ${where} ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ${off}`, params),
      query(`SELECT status, COUNT(*)::int AS n FROM player_feedback GROUP BY status`),
    ]);
    return { status: 200, body: { rows, counts: Object.fromEntries(counts.rows.map(r => [r.status, r.n])) } };
  }

  const m = path.match(/^\/feedback\/(\d+)$/);
  if (m && method === 'GET') {
    const { rows } = await query(`SELECT * FROM player_feedback WHERE id = $1`, [m[1]]);
    return rows[0] ? { status: 200, body: rows[0] } : { status: 404, body: { error: 'No such report' } };
  }
  if (m && (method === 'PATCH' || method === 'POST')) {
    const status = STATUSES.includes(body?.status) ? body.status : null;
    const note = typeof body?.staff_note === 'string' ? body.staff_note.slice(0, 2000) : null;
    const { rows } = await query(
      `UPDATE player_feedback SET status = COALESCE($2, status), staff_note = COALESCE($3, staff_note)
       WHERE id = $1 RETURNING id, status, staff_note`, [m[1], status, note]);
    return rows[0] ? { status: 200, body: rows[0] } : { status: 404, body: { error: 'No such report' } };
  }
  return null;
};

export const _test = { lastSent, COOLDOWN_MS, MAX_TEXT };
