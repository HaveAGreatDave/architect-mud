/**
 * Vendor-safe furniture builder — the single source of truth for the strongbox
 * that physically holds a vendor's accumulated `vendor_credits` and is the target
 * of the vendor-safe plugin's `hack safe` → VAULT CRACK breach.
 *
 * The safe is a normal `furniture` row flagged `vendor_safe:true` + `vendor_npc_id`.
 * Sales pay into `npc.vendor_credits` (the safe's contents); the end-of-shift AI
 * loop (VENDOR_COLLECT_SAFE → VENDOR_GO_TO_ATM → VENDOR_DEPOSIT in ai-behaviour.js)
 * skims it to the ATM and tallies `npc.vendor_bank_credits`. Lifetime earnings are
 * conserved as `vendor_credits + vendor_bank_credits` (see economy-ledger snapshot).
 *
 * Used by apiCreateNpc/apiUpdateNpc (auto-injection for every new/edited vendor)
 * and scripts/backfill-vendor-safes.mjs (one-shot coverage for existing vendors).
 */
import { query } from '../models/db.js';

// Setting-flavoured strongbox copy, chosen by keyword in the vendor's shop name /
// display name. Keeps auto-placed safes from all reading identically without
// hand-authoring one per vendor. `noun` names the safe; `desc` describes it.
// Short ambiguous tokens (bar/pub/club/gun/arms) carry a trailing \b so they don't
// fire on surnames or zone slugs — otherwise "Sten Barlow" reads as a bar.
const FLAVOURS = [
  { re: /\b(bar\b|tavern|pub\b|lounge|club\b|saloon|barkeep|bartend|nightclub|voltage)/i, noun: 'till-safe',
    desc: 'A battered floor safe wedged into the cabinet under the bar, half-hidden behind a crate of empties. The dial is worn smooth from the same fingers, year after year.' },
  { re: /\b(clinic|medic|doctor|pharma|drug|dispensar|chem)/i, noun: 'lockbox',
    desc: 'A compact cash-and-controlled-substances lockbox with a caged dial, bolted below the counter where the light is bad and the reach is short.' },
  { re: /\b(gunshop|gunsmith|gun\b|weapon|muniti|arms\b|ordnance|quartermaster)/i, noun: 'munitions safe',
    desc: 'A slab-sided strongbox chained to the deck behind the counter, olive drab under the rust, the combination wheel caged behind a fold-down armoured shroud.' },
  { re: /\b(fence|pawn|hock|salvage|scrap|broker|consign)/i, noun: 'strongbox',
    desc: 'A scarred strongbox stitched from a dozen mismatched welds, tucked into the shadow where the counter meets the wall. It has clearly been opened the hard way before.' },
  { re: /\b(diner|cook|kitchen|food|grocer|butcher|fish|ration|cafe|café|stim|barista)/i, noun: 'cashbox',
    desc: 'A grease-filmed cashbox wedged behind the register, its dial worn to a shine and one corner dented inward from an argument nobody won.' },
  { re: /\b(dock|yard|freight|turbine|plant|gantry|ship|harbor|harbour|teamster|foundry|forge)/i, noun: 'lockbox',
    desc: 'A dented industrial lockbox riveted to a steel upright, painted over more times than anyone can count, the dial stiff with grime.' },
];

const DEFAULT_FLAVOUR = { noun: 'floor safe',
  desc: 'A squat floor safe tucked behind the counter, bolted down and unremarkable, its dial worn from years of the same fingers spinning the same combination.' };

// Flavour keys off the shop name, the vendor's name, and the placement zone id
// (zone slugs like zone_gunshop_interior / zone_stimcafe carry the trade when the
// name doesn't). Zone slug underscores are treated as word breaks so \b tokens hit.
//
// The zone is consulted LAST and only as a tiebreak, because it is the weakest
// signal and actively wrong when several vendors share a room: eight Yards
// traders parked in zone_coldwater_turbine_hall all matched /turbine|plant/ and
// were issued the same industrial lockbox — a fence, a soup cook and a
// shipwright with byte-identical strongboxes. The trade beats the address.
function flavourFor(npc, zoneId) {
  const own = `${npc.vendor_shop_name || ''} ${npc.name || ''}`;
  return (
    FLAVOURS.find(f => f.re.test(own)) ||
    FLAVOURS.find(f => f.re.test((zoneId || '').replace(/_/g, ' '))) ||
    DEFAULT_FLAVOUR
  );
}

// Deterministic id so re-runs and ON CONFLICT dedupe cleanly. Note: hand-authored
// bespoke safes (e.g. furn_safe_sully) use their own ids — callers must dedupe by
// vendor_npc_id (vendorHasSafe) so those vendors are never double-safed.
export function vendorSafeId(npcId) { return `furn_safe_${npcId}`; }

// The furniture column map for a vendor's safe, ready for insertFurniture / INSERT.
// `flags` is a JSON string to match the existing insert paths (JSONB column).
export function vendorSafeRow(npc, zoneId) {
  const { noun, desc } = flavourFor(npc, zoneId);
  return {
    id: vendorSafeId(npc.id),
    zone_id: zoneId,
    name: `${npc.name}'s ${noun}`,
    description: desc,
    object_type: 'fixture',
    price: 600,
    flags: JSON.stringify({ vendor_safe: true, vendor_npc_id: npc.id, hack_difficulty: 5 }),
  };
}

// True if this vendor already has ANY vendor-safe furniture linked to it (by
// vendor_npc_id, so bespoke safes with non-default ids are respected).
export async function vendorHasSafe(npcId) {
  const { rows } = await query(
    `SELECT 1 FROM furniture WHERE flags @> $1::jsonb LIMIT 1`,
    [JSON.stringify({ vendor_safe: true, vendor_npc_id: npcId })]
  );
  return rows.length > 0;
}
