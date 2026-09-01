// ── Dead drops — a cache a stranger can find ─────────────────────────────────
//
// A dead drop is a container in a public room that one player stocks and another
// player empties, without the two of them ever being in the same place. The engine
// has had the PLACING half for a long time — `flags.container` is a hole you can put
// things in, `flags.concealed` is a thing the room description refuses to mention.
// This plugin is the FINDING half, and it is deliberately almost nothing: one
// `search.provider` contributor and a per-cache-per-player memory of who has already
// had their look.
//
// ⚠ THE CENSUS THAT DECIDES THE WHOLE SHAPE (2026-08-30). The obvious simplification
// is to skip `flags.dead_drop` and let the roll key on `flags.concealed`, which is
// already deployed and already means "hidden". Do not. Of the 58 concealed furniture
// rows in the world, **53 are planted security devices** — SPECTER's spy cameras.
// Keying on `concealed` would turn `search` into a generic counter-surveillance
// sweep, and beating a planted camera is supposed to require knowing where to look,
// not typing one verb in the room. So being findable AS A CACHE is its own authored
// opt-in, and the 58 already-concealed things stay exactly as unfindable as they are.
//
// The same census is why this plugin needed writing at all: 57 furniture rows are
// containers, 58 are concealed, and NOT ONE ROW IS BOTH. The two halves have never
// met. A dead drop is that intersection.
//
// ⚠ `object_type: 'container'` IS NOT `flags.container`. Two rows in the world carry
// the object type and not the flag, and `plugins/container` gates its `open` action
// on the flag. A cache authored by setting the object type is found and then cannot
// be opened, which reads as a bug in `search` rather than as a mis-authored row.
// `isCache` below demands the flag for exactly this reason.

import { getZoneFurniture, getFurnitureById, updateFurniture } from '../../server/engine/world.js';
import { getFlagById, setFlagById } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { emit } from '../../server/engine/events.js';

// The bar a STRANGER's roll has to clear, as a margin over `scavenging` difficulty 4
// (the one roll `search` makes for every provider). Compare concealment's 6, which
// guards a bad feeling, and strays's 6, which guards a cat that wants finding
// eventually. This one takes somebody's property.
//
// ⚠ It is a WALL, not a delay. The tuning target is the sentence "a character with
// poor Brains/Reflexes and no scavenging cannot sweep a district productively at
// all", never a hit percentage — if this is ever lowered to make sweeping feel
// better, the feature becomes a tax on the dropper rather than a risk to them.
const STRANGER_BAR = 12;

// How long a cache refuses to be reconsidered by one player after they have had
// their look — hit or miss.
const SWEPT_MS = 6 * 60 * 60 * 1000;

// ── The swept memory ─────────────────────────────────────────────────────────
// RAM-authoritative, keyed `${playerId}:${cacheId}`, per the persistence tiers: a
// restart costs a re-roll, which is the same trade `search`'s own per-zone cooldown
// already makes. It is NOT per zone, and that is the point — `search`'s cooldown is
// per zone, so on a district grid a failed roll can be re-rolled by stepping one tile
// out and back, which converts STRANGER_BAR from a wall into a wait.
const swept = new Map();

const sweptKey = (playerId, cacheId) => `${playerId}:${cacheId}`;

function isSwept(playerId, cacheId) {
  const at = swept.get(sweptKey(playerId, cacheId));
  return !!at && Date.now() - at < SWEPT_MS;
}

function markSwept(playerId, cacheId) {
  swept.set(sweptKey(playerId, cacheId), Date.now());
}

// ── What counts as a cache ───────────────────────────────────────────────────
// All three flags, every time. `dead_drop` is the opt-in (see the census above),
// `container` is what makes it openable at all, and `concealed` is what makes it
// worth finding — an unconcealed container is already in the room description, so
// reporting it through `search` would be telling the player something they can read.
function isCache(f) {
  return !!(f?.flags?.dead_drop && f.flags.container && f.flags.concealed);
}

function cachesIn(zoneId) {
  return getZoneFurniture(zoneId).filter(isCache);
}

// ── The knower ───────────────────────────────────────────────────────────────
// Being told where a drop is has to survive a logout — that is the entire value of
// being told — so this half is a player flag rather than RAM. It is the one piece of
// durable state the feature adds.
const knownKey = (cacheId) => `deaddrop_known_${cacheId}`;

async function knowsCache(playerId, cacheId) {
  return !!(await getFlagById(playerId, knownKey(cacheId)).catch(() => null));
}

// Called by whatever tells a player about a drop — a quest turn-in, an NPC, a note.
// Exported rather than wired to a verb: knowing is something the FICTION grants, and
// there is deliberately no command a player can type to learn a cache exists.
export async function tellPlayerAboutCache(playerId, cacheId) {
  await setFlagById(playerId, knownKey(cacheId), '1');
}

// ── The finding roll ─────────────────────────────────────────────────────────
//
// ⚠ THIS PROVIDER MUST NEVER CREATE A CACHE. A cache that springs into existence
// because somebody rolled well is a faucet whose only limit is walking pace, and it
// is the specific failure this whole plugin is built to refuse. It reports a row that
// an author or a player already placed, and nothing else. Same relationship `strays`
// has to Cathode, and the same `search`-never-pays-out rule.
//
// It also reveals the CACHE and never the contents: the item comes out through
// `open`, because it is a thing somebody paid for and put there, not a generated one.
async function searchForCaches({ player, zoneId, margin }) {
  const caches = cachesIn(zoneId);
  if (!caches.length) return null;

  // Your own drop, or one you were told about, is what you are looking for when you
  // deliberately search the room you hid it in. Priority 40 beats strays (50) because
  // in that moment the cat is not what you came for.
  for (const cache of caches) {
    if (await knowsCache(player.id, cache.id)) {
      // ⚠ This line used to end "has not been touched", which phase 2 can make a
      // lie: a stranger who opened it leaves `dead_drop_disturbed` on the row. The
      // search only ever says the cache is THERE; whether the lid has moved is the
      // same one fact `open` reports, told in one place rather than two that can
      // disagree.
      return {
        found: true,
        priority: 40,
        message: cache.flags?.dead_drop_disturbed
          ? `You know what you are looking for, and it is where you left it. ${cache.name} is not sitting quite as you left it.`
          : `You know what you are looking for, and it is where you left it. ${cache.name} looks untouched.`,
      };
    }
  }

  // ⚠ THE KNOWER IGNORES THE MARGIN ENTIRELY, and the stranger's bar is never lowered
  // to compensate. The provider only sees `margin`, so it cannot tell "was told" from
  // "got lucky" — reliability has to come from the player's own state. Lowering the
  // bar instead would lower it for the stranger standing next to them.
  const cache = caches.find((c) => !isSwept(player.id, c.id));
  if (!cache) return null;

  // Stamped whether it succeeded or failed. A miss has to cost the look, or the
  // per-zone re-roll above defeats the bar.
  markSwept(player.id, cache.id);
  if (margin < STRANGER_BAR) return null;

  emit('deaddrop.found', { actor: player, cacheId: cache.id, zoneId });
  return {
    found: true,
    priority: 60,
    message: `Something about the ${cache.name} is wrong — it sits a little proud of the wall, and it is not fixed to anything. There is a cavity behind it.`,
  };
}

// ── SOMEBODY HAS BEEN IN IT ──────────────────────────────────────────────────
//
// Finding a cache is only half a story. The other half is the person who stocked
// it opening it later and knowing, and that costs one flag on a row that already
// exists — no log, no table, no tick.
//
// ⚠ IT RECORDS THAT IT HAPPENED, NEVER WHO. An owner handed a name has been handed
// a kill order by the user interface, and "who" is a question SPECTER exists to
// answer — go and ask a camera. This is the cache saying only that the lid moved.
//
// Rides `container.view`, the gather hook `open` already fires (cooking and
// wardrobe decorate through the same one), so nothing new is wired into the open
// path. The write goes through `updateFurniture`, the funnel `concealment` already
// writes `concealed` through, so the world cache and the room description agree
// with no new seam.
async function noteDisturbance({ container, player }) {
  if (!player || container?.kind !== 'furniture' || !container.tags?.dead_drop) return;
  const knows = await knowsCache(player.id, container.id);

  // A stranger with the lid up. Stamp it once and stay quiet — telling them the
  // cache is somebody's would be telling them it is worth coming back to.
  if (!knows) {
    if (container.tags.dead_drop_disturbed) return;
    const row = getFurnitureById(container.id);
    if (!row) return;
    const flags = { ...(row.flags || {}), dead_drop_disturbed: true };
    await updateFurniture(container.id, { flags: JSON.stringify(flags) }).catch(() => {});
    return;
  }

  // The knower, on their next look. Clearing it as they read it is what makes the
  // notice mean "since you were last here" rather than "at some point, forever" —
  // and re-arms the cache for the next stranger.
  if (!container.tags.dead_drop_disturbed) return;
  const row = getFurnitureById(container.id);
  if (row) {
    const flags = { ...(row.flags || {}) };
    delete flags.dead_drop_disturbed;
    await updateFurniture(container.id, { flags: JSON.stringify(flags) }).catch(() => {});
  }
  sendToPlayer(player.id, { type: 'output', message:
    `<span class="msg-system">Somebody has had this open since you were last here. Whoever it was put it back almost right.</span>` });
}

export const hooks = {
  'search.provider': searchForCaches,
  'container.view': noteDisturbance,
};

export const _test = {
  STRANGER_BAR, SWEPT_MS, swept,
  isCache, cachesIn, isSwept, markSwept, knownKey, searchForCaches, noteDisturbance,
};

console.log('[deaddrop] Plugin loaded.');
