/**
 * checkpoint — a content-driven security-checkpoint law (one gate to rule them all).
 *
 * Replaces the two bespoke checkpoint plugins (govgate + perimeter) with a single
 * `registerMoveGate` law configured entirely by a `flags.checkpoint_cfg` object on the
 * gate tile. Walking ONTO a checkpoint tile runs its configured checks; the first one
 * that blocks wins. Everything is data — no per-gate code. This is the ONLY
 * checkpoint move-gate in the codebase; the smuggle plugin no longer registers its
 * own — its raw scan is exposed as the SMUGGLE_RAW_SCAN action and consumed here.
 *
 * Tile config (`zones.flags.checkpoint_cfg`), all fields optional except `checks`:
 *   {
 *     "guards": "the gate guards",     // plural phrase used in prose + the arrest line
 *     "checks": ["wanted", "smuggle"],      // which checks to run, in order
 *     "wantedMode": "bluff" | "hard",  // how a wanted hit resolves (default "hard")
 *     // --- entry predicate: which side triggers the check (pick at most one) ---
 *     "insideFlag": "gov_enclave",     // skip when arriving from a tile with this flag
 *     "fromFlag":   "glacis",          // ONLY check when arriving from a tile with this flag
 *     "fromDistrict": "wilds"          // ONLY check when arriving from a district:<x> tile
 *   }
 * With no entry predicate, every entry onto the tile is checked.
 *
 * Checks:
 *   • wanted — reads the `wanted` star flag.
 *       "hard"  → any star is a flat turn-away (no bluffing a rap sheet; govgate's rule).
 *       "bluff" → a Deception check whose difficulty climbs per star; pass talks you
 *                 through, fail is a bust (APPREHEND). At/above HARD_STARS it's an
 *                 all-points face — unbluffable, straight to detain.
 *   • smuggle — routes raw-drug through the SMUGGLE economy (cook_tier-scaled Deception,
 *       bm_trust reward on a clean run, manufacturing bust on fail, bags-see-through)
 *       via the smuggle plugin's SMUGGLE_RAW_SCAN action. Clean of raw → falls through.
 *   • contraband — the generic scan: raw-drug / `contraband`-tagged inventory runs a
 *       Deception check; fail charges `contraband_possession` + APPREHEND. (Kept for the
 *       gov recipe; the `smuggle` check is the richer raw-drug path.)
 *
 * The two shipped recipes:
 *   • South Gate (perimeter): { guards:"the gate guards", fromDistrict:"wilds",
 *       checks:["wanted","smuggle"], wantedMode:"bluff" } — catches fugitives coming
 *       back cityward, and forces raw drug to be smuggled past on the way in.
 *   • Gov quarter (dormant, for the North City rebuild): { guards:"the checkpoint guards",
 *       insideFlag:"gov_enclave", checks:["wanted","contraband"], wantedMode:"hard" }.
 */
import { query } from '../../server/models/db.js';
import { skillCheck } from '../../server/engine/skills.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getFlag } from '../../server/engine/flags.js';

const SCAN_DIFF = 7;       // contraband scan — security is tighter than a bluffed warrant
const BASE_DIFF = 5;       // wanted-bluff floor; a border guard is less networked than a scanner
const PER_STAR = 3;        // …but every wanted star makes the story harder to sell
const HARD_STARS = 4;      // at/above this you're an all-points face — no talking past it
const HEAT_MS = 45_000;    // a flagged pass keeps the guards on you this long

const heat = new Map();    // `${tileId}:${playerId}` → epoch ms the checkpoint stays hot

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const hot = (key) => Date.now() < (heat.get(key) || 0);
const stoke = (key) => heat.set(key, Date.now() + HEAT_MS);
const apprehend = (player, guards) => dispatchAction({ type: 'APPREHEND', actor: player, params: { officer: guards } });

// Does arriving from `from` trip this checkpoint? (pick at most one predicate)
function triggers(cfg, from) {
  if (cfg.insideFlag) return !from?.flags?.[cfg.insideFlag]; // moving around inside → skip
  if (cfg.fromFlag) return !!from?.flags?.[cfg.fromFlag];
  if (cfg.fromDistrict) return from?.flags?.district === cfg.fromDistrict;
  return true; // no predicate → every entry is checked
}

const CHECKS = {
  async wanted(player, cfg, guards, key) {
    const stars = Number(await getFlag('player', 'wanted', player)) || 0;
    if (stars <= 0) return;

    if ((cfg.wantedMode || 'hard') === 'hard') {
      return { block: true, message: `${cap(guards)} scan your record and it lights up red. "No entry — clear your warrants first." You're waved back the way you came.` };
    }

    // bluff
    if (hot(key)) return { block: true, message: `${cap(guards)} are still watching you from your last try. Give it a minute before you push your luck.` };
    if (stars >= HARD_STARS) {
      stoke(key); await apprehend(player, guards);
      return { block: true, message: `${cap(guards)} don't even reach for a slate — they already know your face. "That's far enough." <span class="text-dim">(Too wanted to bluff this checkpoint — they move to take you in.)</span>` };
    }
    const chk = await skillCheck(player, 'deception', BASE_DIFF + stars * PER_STAR);
    if (chk.success) {
      sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">You keep your eyes forward and your story simple. ${cap(guards)} wave you through.</span>` });
      return; // pass (no XP award — a gate, not a training ground)
    }
    stoke(key); await apprehend(player, guards);
    return { block: true, message: `${cap(guards)} run your face and the story falls apart. "Nice try." <span class="text-dim">(Your bluff failed — they move to detain you.)</span>` };
  },

  // Route the raw-drug scan through the smuggle economy (cook_tier diff, bm_trust
  // reward, bags-see-through) via its SMUGGLE_RAW_SCAN action — one source of truth
  // for the scan, gated by this checkpoint's own entry predicate.
  async smuggle(player, cfg, guards) {
    const r = await dispatchAction({ type: 'SMUGGLE_RAW_SCAN', actor: player, params: { guards } });
    if (!r || r.type === 'error' || !r.handled) return; // smuggle not loaded / no raw → fall through
    return r.block ? { block: true, message: r.message } : undefined; // pass message already sent by smuggle
  },

  async contraband(player, cfg, guards, key) {
    const { rows } = await query(
      `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
        WHERE pi.player_id=$1 AND (jsonb_exists(i.tags,'raw_drug') OR jsonb_exists(i.tags,'contraband')) LIMIT 1`,
      [player.id]).catch(() => ({ rows: [] }));
    if (!rows.length) return; // clean → walk through

    if (hot(key)) return { block: true, message: `${cap(guards)} are still watching you from the last pass — hang back, or slip in another way.` };
    const chk = await skillCheck(player, 'deception', SCAN_DIFF);
    if (chk.success) {
      sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">You keep your coat closed and your story straight. The scanner blinks green; ${guards} nod you through.</span>` });
      return; // pass
    }
    stoke(key);
    await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'contraband_possession' } });
    await apprehend(player, guards);
    return { block: true, message: `The scanner shrills — <b>contraband</b>. ${cap(guards)} close on you — no bolting out of this one.` };
  },
};

registerMoveGate(async ({ player, from, to }) => {
  const cfg = to?.flags?.checkpoint_cfg;
  if (!cfg || !Array.isArray(cfg.checks)) return; // cheap: only a configured gate tile pays
  if (!triggers(cfg, from)) return;               // wrong side (moving around inside / leaving) → free

  const guards = cfg.guards || 'the checkpoint guards';
  const key = `${to.id}:${player.id}`;
  for (const name of cfg.checks) {
    const fn = CHECKS[name];
    if (!fn) continue;
    const r = await fn(player, cfg, guards, key);
    if (r?.block) return r; // first blocking check wins; a pass returns undefined and falls through
  }
}, 'checkpoint');

export const _test = { CHECKS, triggers };

console.log('[checkpoint] Plugin loaded.');
