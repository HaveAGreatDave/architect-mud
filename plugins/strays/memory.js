// plugins/strays/memory.js — what Cathode remembers about you, and what that
// turns into.
//
// TWO STORES, ON PURPOSE.
//
//   player_flags   stray_cat_pets / stray_cat_kills / stray_cat_pet_at
//   relations      player_npc_relations, via adjustRelation()
//
// Relations already model "how does this NPC feel about you" and give tiering,
// decay and the authored `{ relation: 'known' }` VINE condition for free, so the
// warmth of a greeting comes from there. But warmth is a SHARED substrate —
// buying things, being clean, standing near people all nudge it, and it decays.
// The fact that you killed this animal must not be something you can launder by
// being pleasant for a fortnight. So the kill lives in its own flag, it never
// decays, it is never cleared, and it outranks everything else in moodToward().
//
// The pet counter is a flag for the same reason in reverse: it is the durable
// record of a relationship, and it should survive whatever else happens to your
// warmth score.
//
// COST. Every read here is a Map hit on a hydrated player (flags.js hydrates at
// login; relations.js likewise) — moodToward is awaited but does not query. It is
// still never called from inside the behaviour loop: index.js resolves mood once
// per player per tick and hands the string down.

import { getFlag, setFlag } from '../../server/engine/flags.js';
import { getRelation, relationTier, adjustRelation, RELATION_TIERS } from '../../server/engine/relations.js';

export const PETS_FLAG    = 'stray_cat_pets';
export const KILLS_FLAG   = 'stray_cat_kills';
export const PET_AT_FLAG  = 'stray_cat_pet_at';

// Six real hours. Long enough that "a regular" means someone who has come back
// across several days rather than someone who stood still for a minute.
export const PET_COOLDOWN_MS = 6 * 60 * 60_000;

export const SEEK_PETS = 5;   // pets at which it starts coming to you
export const GIFT_PETS = 10;  // pets at which it starts bringing you things

export async function petsBy(player) {
  return Number(await getFlag('player', PETS_FLAG, player)) || 0;
}

export async function killsBy(player) {
  return Number(await getFlag('player', KILLS_FLAG, player)) || 0;
}

export async function lastPetAt(player) {
  return Number(await getFlag('player', PET_AT_FLAG, player)) || 0;
}

/**
 * The one function every reaction derives from.
 *
 * 'flee'    — you have killed it. It will not approach you and will not be found
 *             by you. There is no way back; that is the point of the feature.
 * 'seek'    — a regular. Comes to you, greets you, eventually brings you things.
 * 'neutral' — you've petted it at least once. It knows you. It doesn't fuss.
 * 'wary'    — a stranger. Watches from out of reach.
 */
export async function moodToward(player, npcId) {
  if (!player) return 'wary';
  if (await killsBy(player) > 0) return 'flee';

  const pets = await petsBy(player);
  const tier = relationTier(getRelation(player, npcId));
  const familiar = RELATION_TIERS.indexOf(tier) >= RELATION_TIERS.indexOf('familiar');
  if (pets >= SEEK_PETS || (pets >= 1 && familiar)) return 'seek';
  if (pets >= 1) return 'neutral';
  return 'wary';
}

// ---------------------------------------------------------------------------
// Writers

/**
 * Record a pet. Returns { paid, pets } — `paid` false means this one was inside
 * the cooldown, so it costs nothing and earns nothing.
 *
 * A pet inside the cooldown still SUCCEEDS and still reads warmly. Never punish
 * a player for petting a cat; just don't pay them twice for it.
 */
export async function recordPet(player, npcId) {
  const now = Date.now();
  const paid = now - (await lastPetAt(player)) >= PET_COOLDOWN_MS;
  const pets = await petsBy(player);

  // Familiarity is how well it knows you and accrues either way — you were here,
  // you put your hand out. Only the counter and the sanity are rate-limited.
  adjustRelation(player, npcId, { familiarity: 4, warmth: paid ? 6 : 1, reason: 'petted the stray' });

  if (!paid) return { paid: false, pets };

  await setFlag('player', PETS_FLAG, String(pets + 1), player);
  await setFlag('player', PET_AT_FLAG, String(now), player);
  return { paid: true, pets: pets + 1 };
}

export async function recordKill(player, npcId) {
  const kills = (await killsBy(player)) + 1;
  await setFlag('player', KILLS_FLAG, String(kills), player);
  adjustRelation(player, npcId, { warmth: -60, reason: 'killed the stray' });
  return kills;
}
