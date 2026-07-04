/**
 * AMP plugin — the cassette economy behind the Architect Music Player.
 *
 * The AMP's library ships hidden. A player only sees a server track once they've
 * fed the deck the physical cassette for it. Cassettes are ordinary tradeable
 * items (tag `amp_cassette`, `tags.song_id` naming the audio_songs row) — they
 * can be sold to vendors, handed to other players, looted — right up until they
 * go into the deck, at which point the tape is destroyed and the track is
 * unlocked for that player forever.
 *
 * Two seams:
 *   • the `insert <cassette>` verb — consume the tape, add its song id to the
 *       player's persistent `amp_unlocks` flag (a JSON array), and push the
 *       unlock to the open AMP panel live.
 *   • the `npc.gift` event (fired by the give command when the target is an NPC)
 *       — an NPC carrying a generic `flags.gift_trade` contract hands over a
 *       reward cassette in exchange for a specific item. Nothing here is
 *       hardcoded to Nyra or cigarettes: the trade lives on the NPC as content.
 *
 * The unlock set is delivered to the client at login (`player.login` → the AMP
 * caches it) and incrementally on each insert; the client filters its library to
 * the unlocked set. See client/game/js/panels/musicplayer.js.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';

const UNLOCK_FLAG = 'amp_unlocks';

// Read the player's unlocked-song ids (persisted as a JSON array in a flag).
async function readUnlocks(player) {
  const raw = await getFlag('player', UNLOCK_FLAG, player);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

// ── insert <cassette> ─────────────────────────────────────────────────────────

async function cmdInsert(args, raw, player, broadcast) {
  const targetStr = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();
  if (!targetStr) return { type: 'error', message: 'Insert what? (Feed a cassette to the AMP.)' };

  const { rows } = await query(
    `SELECT pi.*, i.name, i.tags FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND pi.container_id IS NULL AND pi.is_equipped = 0
       AND i.name ILIKE $2 AND jsonb_exists(i.tags, 'amp_cassette') LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  if (!rows.length) return { type: 'error', message: `You have no cassette like "${targetStr}" to insert.` };

  const cass = rows[0];
  const songId = cass.tags?.song_id;
  if (!songId) return { type: 'error', message: `${cass.name} is blank — the AMP whirrs, finds nothing, and spits it back out.` };

  const unlocks = await readUnlocks(player);
  // Already known — don't burn a tape that still has resale value.
  if (unlocks.includes(songId)) {
    return { type: 'system', message: `Your AMP already holds that track. You keep ${cass.name} — no sense feeding it a duplicate.` };
  }

  // Destroy the tape (one copy) and unlock the track.
  if (cass.quantity > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = $1', [cass.id]);
  else await query('DELETE FROM player_inventory WHERE id = $1', [cass.id]);

  unlocks.push(songId);
  await setFlag('player', UNLOCK_FLAG, JSON.stringify(unlocks), player);

  const { rows: sr } = await query('SELECT name FROM audio_songs WHERE id = $1', [songId]);
  const songName = sr[0]?.name ? sr[0].name.replace(/_/g, ' ').toUpperCase() : 'A NEW TRACK';

  sendToPlayer(player.id, { type: 'amp_unlock', songId, songName });
  emit('inventory.changed', { actor: player });
  emit('amp.unlocked', { player, songId });

  return {
    type: 'system',
    message: `You push ${cass.name} into the AMP. It clunks home, the reels bite, and <span class="msg-system">${songName}</span> is yours to play now. The tape is spent.`,
  };
}

// Tag-gated so examining a cassette (tag `amp_cassette`) advertises `insert`
// via availableActions — the verb needs the cassette to do anything, so the
// object that unlocks it is exactly where it should be discoverable.
export const specializedActions = [
  { verb: 'insert', requiredTag: 'amp_cassette', handler: cmdInsert },
];

// ── npc.gift — generic cassette-for-item trade on an NPC ──────────────────────
//
// Contract (content, lives on npcs.flags.gift_trade):
//   { give_item, reward_item, once?, accept_message?, already_message? }
on('npc.gift', async ({ actor, npc, item }) => {
  const trade = npc?.flags?.gift_trade;
  if (!trade || !trade.give_item || !trade.reward_item) return;   // this NPC has no trade
  if (item.item_id !== trade.give_item) return;                   // not the item they want

  const onceKey = `amp_gift_${npc.id}`;
  if (trade.once && await getFlag('player', onceKey, actor)) {
    sendToPlayer(actor.id, {
      type: 'output',
      message: trade.already_message || `${npc.name} waves you off — you've already had what they were offering.`,
    });
    return;
  }

  // Verify the reward exists before consuming the offering (don't eat the item on a broken trade).
  const { rows: ri } = await query('SELECT id FROM items WHERE id = $1', [trade.reward_item]);
  if (!ri.length) { console.error(`[amp] gift_trade on ${npc.id} names missing reward_item ${trade.reward_item}`); return; }

  if (item.quantity > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = $1', [item.id]);
  else await query('DELETE FROM player_inventory WHERE id = $1', [item.id]);

  await query(
    'INSERT INTO player_inventory (id, player_id, item_id, quantity, is_equipped) VALUES ($1, $2, $3, 1, 0)',
    [randomUUID(), actor.id, trade.reward_item]
  );
  if (trade.once) await setFlag('player', onceKey, 'true', actor);

  sendToPlayer(actor.id, {
    type: 'output',
    message: trade.accept_message || `${npc.name} takes ${item.name} and, after a moment, presses something into your hand.`,
  });
  emit('inventory.changed', { actor });
});

// ── initial unlock sync at login ──────────────────────────────────────────────
on('player.login', async ({ id }) => {
  const unlocks = await readUnlocks({ id });
  sendToPlayer(id, { type: 'amp_unlocks', songIds: unlocks });
});

// Exposed for the regression suite.
export const _test = { UNLOCK_FLAG, readUnlocks };
