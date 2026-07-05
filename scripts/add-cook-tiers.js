// One-shot content: tier every drug for the cook system and price it by tier.
//   Run once:  node scripts/add-cook-tiers.js
//   Restart the server (or /world/reload) after — drug/item caches load at boot.
//
// Sets flags.cook_tier (1..5 intensity) on every drug — kept if already set,
// else derived from how nasty the drug is — and stamps the drug's ITEM value by
// tier (cheap easy → expensive hard). Editable afterward in the drug editor
// (Cook tier field) + item value. Idempotent. Tier drives the cook difficulty +
// how dangerous a botch is (see plugins/synthesis/index.js: cookTier/cookDiff).
import { query } from '../server/models/db.js';

const TIER_PRICE = [0, 15, 40, 90, 180, 350]; // value per tier 1..5

function deriveTier(effects, addiction) {
  const e = effects || {}; let s = 1;
  if (e.overdose?.lethal) s += 2;
  const mag = Object.values(e.instant || {}).reduce((a, v) => a + Math.abs(Number(v) || 0), 0);
  if (mag > 24) s += 1; if ((addiction || 0) >= 0.3) s += 1; if (e.hallucination) s += 1;
  return Math.max(1, Math.min(5, s));
}
const asObj = (v) => (v && typeof v === 'object') ? v : (() => { try { return JSON.parse(v || '{}'); } catch { return {}; } })();

async function main() {
  const { rows } = await query('SELECT id, item_id, effects, addiction_chance, flags FROM drugs');
  let n = 0;
  for (const d of rows) {
    const flags = { ...asObj(d.flags) }, effects = asObj(d.effects);
    const set = Number(flags.cook_tier);
    const tier = (set >= 1 && set <= 5) ? Math.round(set) : deriveTier(effects, d.addiction_chance);
    flags.cook_tier = tier;
    await query('UPDATE drugs SET flags=$1 WHERE id=$2', [JSON.stringify(flags), d.id]);
    if (d.item_id) await query('UPDATE items SET value=$1 WHERE id=$2', [TIER_PRICE[tier], d.item_id]);
    console.log(`  ${d.id}: tier ${tier} → ${TIER_PRICE[tier]}₵`);
    n++;
  }
  console.log(`✓ tiered ${n} drugs (value bucketed by tier). Restart the server so caches pick it up.`);
  console.log('Tune any drug in the dev panel: Cook tier field (1–5) + the item value.');
  process.exit(0);
}
main().catch((e) => { console.error('✗ add-cook-tiers failed:', e.message); process.exit(1); });
