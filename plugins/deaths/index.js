/**
 * Deaths plugin.
 *
 * A pure listener + reporter. It never inspects HP, hunger, weather, or combat —
 * every death it knows about arrives on the `player.death` broadcast, which the
 * killing systems enrich with a `cause` ({ type, label }) and the `deathZone`
 * (captured before respawn teleports the player away). We append one row per
 * death to `player_deaths`; the `deaths` command reads them back.
 *
 * The authoritative total-reclone count stays on `players.deaths` (incremented
 * by the engine death handler) — this table is the timestamped detail log.
 */
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import { getZone } from '../../server/engine/world.js';

// Catalogue every death the systems broadcast. Fire-and-forget: a logging
// failure must never break the respawn path, so we swallow errors.
on('player.death', ({ player, cause, deathZone }) => {
  if (!player?.id) return;
  const { date, time } = getGameDateTime();
  const c = cause || { type: 'unknown', label: 'Unknown causes' };
  return query(
    `INSERT INTO player_deaths (player_id, real_ts, game_date, game_time, zone_id, cause_type, cause_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [player.id, Math.floor(Date.now() / 1000), date, time, deathZone || player.current_zone || null, c.type, c.label],
  ).catch(() => {});
});

const HISTORY_LIMIT = 25;

async function cmdDeaths(args, raw, player) {
  const { rows } = await query(
    `SELECT game_date, game_time, zone_id, cause_label
       FROM player_deaths
      WHERE player_id = $1
      ORDER BY real_ts DESC
      LIMIT $2`,
    [player.id, HISTORY_LIMIT],
  );

  const total = player.deaths || 0;

  if (!rows.length) {
    return { type: 'output', message: 'No deaths on record. Yet.' };
  }

  const lines = rows.map((r) => {
    const where = getZone(r.zone_id)?.name || r.zone_id || 'somewhere';
    const when = [r.game_date, r.game_time].filter(Boolean).join(' ') || 'some time ago';
    return `<span class="text-dim">${when}</span> — ${where} — ${r.cause_label || 'Unknown causes'}`;
  });

  const header = `<span class="zone-name">Death Log</span>  <span class="text-dim">(${total} reclone${total === 1 ? '' : 's'} total)</span>`;
  const footer = total > rows.length
    ? `\n<span class="text-dim">…showing your last ${rows.length} deaths.</span>`
    : '';

  return { type: 'output', message: `${header}\n${lines.join('\n')}${footer}` };
}

export const commands = { deaths: cmdDeaths };
