/**
 * Cannabis plugin — the behavioural layer of being stoned.
 *
 * The stat side of a joint (relaxation, cotton-mouth, dulled reflexes) is plain
 * content on the drug row. This plugin owns the four things that AREN'T stat
 * deltas, all gated on a drug row flagged `flags.cannabis`:
 *
 *   • echo-on-everything — on light-up the client is told to switch on a global
 *       master-bus echo (AudioEngine.setEcho). Music, SFX, ambience all shimmer.
 *       "The music is unbelievable." Switched off when the high ends.
 *   • the munchies — a self-scheduled tick slowly drains hunger while high and
 *       occasionally narrates a food craving. Deliberately the OPPOSITE of the
 *       cigarette appetite-suppression, which is why a joint is NOT flagged
 *       `smokeable` (that flag drives the smoking plugin's suppression).
 *   • the giggles — the same tick rolls an occasional fit of giggles, narrated
 *       to the stoner and the room.
 *   • red eyes — a `player.appearanceNotes` hook adds a bloodshot-eyes line when
 *       anyone examines a stoned player (mirrors the MIS appearance-notes hook).
 *
 * The high is in-memory (`player._cannabisHighUntil`, ms) and cleared on
 * death/logout, like the trip and intoxication runtime fields.
 */
import { query } from '../../server/models/db.js';
import { getAllLivePlayers } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';

// --- tunables ----------------------------------------------------------------
const DEFAULT_HIGH_SECONDS = 300;     // 5 min stoned per joint
const TICK_MS = 15000;                // munchies / giggle cadence
const MUNCH_DRAIN = 2;                // hunger lost per tick while high (~8/min)
const CRAVE_CHANCE = 0.35;            // per tick: a food-craving line
const GIGGLE_CHANCE = 0.25;           // per tick: a fit of giggles

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const CRAVINGS = [
  'Your stomach growls. You would commit crimes for something salty right now.',
  'A vivid, aching craving for junk food blooms in your skull. Crisps. So many crisps.',
  'You are suddenly, profoundly hungry. Anything greasy would be a religious experience.',
  'The munchies hit like a truck. You start seriously considering eating whatever is nearest.',
];
const SELF_GIGGLES = [
  'A giggle escapes you. Then another. You have no idea why and it does not matter.',
  'Something — nothing — sets you off, and you dissolve into helpless giggling.',
  'You snort, then start laughing quietly to yourself at absolutely nothing.',
];
const ROOM_GIGGLES = [
  'giggles to themselves for no discernible reason.',
  'dissolves into a quiet fit of giggles at nothing at all.',
  'snorts and starts laughing softly to themselves.',
];

// --- light-up ----------------------------------------------------------------

on('player.drugUsed', ({ player, drug }) => {
  if (!player || !drug?.flags?.cannabis) return;
  const secs = Number(drug.flags.high_seconds) || DEFAULT_HIGH_SECONDS;
  player._cannabisHighUntil = Date.now() + secs * 1000;
  // Switch the room's whole soundscape into a warm echo, client-side.
  sendToPlayer(player.id, { type: 'audio_echo', on: true, mix: 0.28, delay: 0.16, feedback: 0.32 });
});

function endHigh(player) {
  if (!player || !player._cannabisHighUntil) return;
  player._cannabisHighUntil = 0;
  sendToPlayer(player.id, { type: 'audio_echo', on: false });
}

on('player.death',  ({ player }) => endHigh(player));
on('player.logout', ({ id })     => endHigh(getAllLivePlayers().find(x => x.id === id)));

// --- red eyes on examine -----------------------------------------------------

export const hooks = {
  'player.appearanceNotes': ({ target, isSelf }) => {
    if (!target?._cannabisHighUntil || target._cannabisHighUntil <= Date.now()) return undefined;
    return isSelf
      ? '<span style="color:var(--red)">Your eyes are bloodshot and heavy-lidded, pupils wide and glassy.</span>'
      : '<span style="color:var(--red)">Their eyes are red and glassy, half-lidded and a thousand miles away.</span>';
  },
};

// --- tick: munchies + giggles ------------------------------------------------

let ticking = false;
function highTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const player of getAllLivePlayers()) {
      if (!player._cannabisHighUntil) continue;
      if (player._cannabisHighUntil <= now) { endHigh(player); continue; }
      if (player.offline_sleeping) continue;

      // The munchies: slowly drain hunger, occasionally narrate the craving.
      const newHunger = Math.max(0, (player.hunger ?? 100) - MUNCH_DRAIN);
      if (newHunger !== player.hunger) {
        player.hunger = newHunger;
        query('UPDATE players SET hunger=$1 WHERE id=$2', [newHunger, player.id]).catch(() => {});
        sendToPlayer(player.id, { type: 'player_update', hunger: newHunger });
      }
      if (Math.random() < CRAVE_CHANCE) {
        sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${pick(CRAVINGS)}</span>` });
      }

      // The giggles.
      if (Math.random() < GIGGLE_CHANCE) {
        sendToPlayer(player.id, { type: 'output', message: pick(SELF_GIGGLES) });
        sendToZone(player.current_zone, { type: 'zone_event', message: `${player.handle} ${pick(ROOM_GIGGLES)}` }, player.id);
      }
    }
  } finally {
    ticking = false;
  }
}

setInterval(() => { try { highTick(); } catch (e) { console.error('[cannabis] tick error:', e.message); } }, TICK_MS);

// Exposed for the regression suite.
export const _test = { DEFAULT_HIGH_SECONDS, MUNCH_DRAIN, redEyes: (target, isSelf) => hooks['player.appearanceNotes']({ target, isSelf }) };
