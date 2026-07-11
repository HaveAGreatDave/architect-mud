// plugins/corps/ventures.js — Corporate Assets, Phase A.
//
// Corp-owned, enterable *operating businesses* (restaurant etc.) — the productive
// generalisation of the HQ. Phase A businesses are **self-running**: a corp claims
// a designer-flagged unit (`flags.claimable_asset`), and it earns a modest passive
// floor on the 24h tick plus a live cut of every sale at its storefront vendor,
// with no staff required. Owning one also projects a little influence into the
// zone_control territory grid. Staffing (a yield multiplier), blueprints/build, and
// the other building types are later phases — see docs/proposals/corporate-assets.md.
//
// Ownership/economics live in the `org_ventures` table (cached in world.orgVentures);
// the apartments substrate is NOT used here (a storefront is public, no lock/access
// gate needed). All verbs route under the `corp asset …` subcommand from index.js.
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import {
  getZone, getZoneNpcs, getOrg, getPlayerMembership,
  getVenture, getAllVentures, getOrgVentures, getVentureByVendor, reloadVenture, reloadOrg,
  getZoneControl, setZoneControlCache,
} from '../../server/engine/world.js';
import { PERM, hasPerm } from '../../server/engine/org-perms.js';

const CLAIM_FEE = 400; // credits (from treasury) to take over a claimable business

// Type registry — the "building framework". Only `restaurant` is built out in
// Phase A; the others are honest stubs (TODO effects) proving a new type is config,
// not architecture. Numbers are deliberately low-yield: a business runs on its own
// but real money comes from foot traffic (activeShare of vendor sales).
export const CORP_ASSET_TYPES = {
  restaurant: {
    label: 'Diner', passiveFloor: 30, activeShare: 0.20, upkeep: 10, influenceProjection: 2,
    blueprint: 'blueprint_restaurant',
    // Phase B adds staffing: staffRequired, wagePerStaff, staffedYield multiplier.
  },
  // ── STUBS (Phase D) — registered so the framework generalises; effects TODO. ──
  warehouse:       { label: 'Warehouse',       passiveFloor: 20, activeShare: 0,    upkeep: 8,  influenceProjection: 1, TODO: 'bulk corp storage / smuggling cut' },
  security_office: { label: 'Security Office', passiveFloor: 0,  activeShare: 0,    upkeep: 20, influenceProjection: 4, TODO: 'defense/heat reduction for nearby owned zones' },
  front_office:    { label: 'Front Office',    passiveFloor: 25, activeShare: 0,    upkeep: 12, influenceProjection: 2, TODO: 'recruitment desk / cheaper tier-ups' },
};

const err = (message) => ({ type: 'error', message });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Resolve the asset type a zone is claimable as: `flags.claimable_asset` may be a
// type key ('restaurant') or `true` (+ optional `flags.asset_type`, default diner).
function claimableType(zone) {
  const flag = zone?.flags?.claimable_asset;
  if (!flag) return null;
  const key = typeof flag === 'string' ? flag : (zone.flags.asset_type || 'restaurant');
  return CORP_ASSET_TYPES[key] ? key : null;
}

// ─── Verbs (routed as `corp asset …` from index.js) ─────────────────────────

export async function cmdVentureAsset(player, rest, broadcast, pushConsole) {
  const sub = (rest[0] || 'list').toLowerCase();
  switch (sub) {
    case '':
    case 'list':  return listAssets(player);
    case 'claim': return cmdClaimAsset(player, broadcast, pushConsole);
    case 'staff': return err('Hiring staff arrives with NPC-run businesses (a later phase). For now your businesses run on their own.');
    default:      return err('Usage: corp asset [list|claim]');
  }
}

async function listAssets(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const vs = getOrgVentures(m.org_id);
  if (!vs.length) return { type: 'corp_asset', message: 'Your corp owns no businesses. Stand in a claimable one and use "corp asset claim".' };
  let msg = `<span class="skills-header">${esc(getOrg(m.org_id).name)} — BUSINESSES</span>\n`;
  for (const v of vs) {
    const def = CORP_ASSET_TYPES[v.asset_type] || {};
    const state = v.dormant ? '<span class="dim">dormant</span>' : `+${(def.passiveFloor || 0) * v.level}/day`;
    msg += `  ${esc(def.label || v.asset_type)} @ ${esc(getZone(v.zone_id)?.name || v.zone_id)} — ${state}\n`;
  }
  return { type: 'corp_asset', message: msg.trimEnd() };
}

async function cmdClaimAsset(player, broadcast, pushConsole) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.MANAGE_HQ)) return err("You don't have permission to claim corp property.");
  const zone = getZone(player.current_zone);
  const type = claimableType(zone);
  if (!type) return err("There's no claimable business here.");
  if (getVenture(zone.id)) return err('This business is already owned.');
  const org = getOrg(m.org_id);
  if ((org.treasury || 0) < CLAIM_FEE) return err(`Taking over this business costs ${CLAIM_FEE}c from the treasury — it has ${org.treasury || 0}c.`);
  const vendor = getZoneNpcs(zone.id).find(n => n.vendor_inventory?.length) || null;
  const id = randomUUID();
  const res = await withTransaction(async (q) => {
    const dec = await q('UPDATE orgs SET treasury=treasury-$1 WHERE id=$2 AND treasury>=$1 RETURNING treasury', [CLAIM_FEE, org.id]);
    if (!dec.rowCount) return null;
    await q('INSERT INTO org_ventures (id, org_id, zone_id, asset_type, vendor_id) VALUES ($1,$2,$3,$4,$5)',
      [id, org.id, zone.id, type, vendor?.id || null]);
    return { treasury: dec.rows[0].treasury };
  });
  if (!res) return err(`The treasury doesn't have ${CLAIM_FEE}c.`);
  await reloadVenture(zone.id);
  await reloadOrg(org.id);
  emit('corp.asset.claimed', { orgId: org.id, zoneId: zone.id, type });
  if (pushConsole) await pushConsole(org.id, broadcast);
  const def = CORP_ASSET_TYPES[type];
  const cut = vendor ? `, plus a ${Math.round(def.activeShare * 100)}% cut of every sale at ${esc(vendor.name)}` : '';
  return {
    type: 'corp_asset',
    message: `<b>${esc(org.name)}</b> takes over the <b>${esc(def.label)}</b> here for ${CLAIM_FEE}c. It runs on its own — <b>+${def.passiveFloor}/day</b> to the treasury${cut}. Treasury: ${res.treasury}c.`,
  };
}

// ─── Live income: a cut of every sale at an owned business's vendor ──────────
// Wired in index.js via on('vendor.purchase', …). Fires on the buy hot path, so
// it stays cheap: a cache lookup + at most one guarded UPDATE.
export async function handleVenturePurchase({ npcId, price }) {
  if (!npcId || !price) return;
  const v = getVentureByVendor(npcId);
  if (!v || v.dormant) return;
  const share = CORP_ASSET_TYPES[v.asset_type]?.activeShare || 0;
  const cut = Math.floor(price * share);
  if (cut <= 0) return;
  await query('UPDATE orgs SET treasury = treasury + $1 WHERE id=$2', [cut, v.org_id]);
  await reloadOrg(v.org_id);
}

// ─── 24h tick: settle floor − upkeep, dormancy, and influence projection ────
// Sibling to runTerritoryTick; scheduled in index.js. Each venture pays its own
// upkeep from the treasury: if the treasury can't cover it, the business goes
// dormant (stops earning + projecting) until the treasury recovers, then revives.
export async function runVentureTick() {
  const ventures = getAllVentures();
  let settled = 0;
  for (const v of ventures) {
    const def = CORP_ASSET_TYPES[v.asset_type];
    if (!def) continue;
    const upkeep = def.upkeep || 0;
    const earn = (def.passiveFloor || 0) * v.level;
    // Pay upkeep from the treasury or go dormant — one guarded transaction per
    // venture (N is tiny). A dormant business revives the moment upkeep is affordable.
    const active = await withTransaction(async (q) => {
      const org = await q('SELECT treasury FROM orgs WHERE id=$1 FOR UPDATE', [v.org_id]);
      if (!org.rows.length) return false;
      if (org.rows[0].treasury < upkeep) {
        if (!v.dormant) await q('UPDATE org_ventures SET dormant=1 WHERE id=$1', [v.id]);
        return false;
      }
      await q('UPDATE orgs SET treasury = treasury + $1 WHERE id=$2', [earn - upkeep, v.org_id]);
      if (v.dormant) await q('UPDATE org_ventures SET dormant=0 WHERE id=$1', [v.id]);
      return true;
    });
    await reloadVenture(v.zone_id);
    await reloadOrg(v.org_id);
    if (active) {
      await projectInfluence(v.zone_id, v.org_id, (def.influenceProjection || 0) * v.level);
      settled++;
    }
  }
  if (ventures.length) console.log(`[corps] Venture tick: ${ventures.length} business(es), ${settled} active.`);
}

// Project a little influence for `orgId` into a zone's zone_control grid. Seeds an
// unowned zone at a low grip (economic soft-claim) or nudges a zone the org already
// holds; never touches a rival-held zone in Phase A. Seeded rows carry zero
// base_income/upkeep so a business zone can't leak territory income into the
// territory tick.
async function projectInfluence(zoneId, orgId, proj) {
  if (proj <= 0) return;
  const zc = getZoneControl(zoneId);
  const now = Math.floor(Date.now() / 1000);
  if (!zc || !zc.org_id) {
    const { rows } = await query(
      `INSERT INTO zone_control (zone_id, org_id, influence, challenger_org_id, base_income, base_upkeep, captured_at)
         VALUES ($1,$2,$3,NULL,0,0,$4)
       ON CONFLICT (zone_id) DO UPDATE
         SET org_id    = COALESCE(zone_control.org_id, EXCLUDED.org_id),
             influence = CASE WHEN zone_control.org_id IS NULL
                              THEN LEAST(100, zone_control.influence + $3) ELSE zone_control.influence END
       RETURNING *`,
      [zoneId, orgId, Math.min(100, proj), now]);
    setZoneControlCache(zoneId, rows[0]);
  } else if (zc.org_id === orgId) {
    const { rows } = await query('UPDATE zone_control SET influence = LEAST(100, influence + $1) WHERE zone_id=$2 RETURNING *', [proj, zoneId]);
    setZoneControlCache(zoneId, rows[0]);
  }
}

// ─── Console payload helpers (consumed by index.js buildConsolePayload) ─────
export function ventureConsoleBlock(orgId) {
  return getOrgVentures(orgId).map(v => {
    const def = CORP_ASSET_TYPES[v.asset_type] || {};
    return {
      type: v.asset_type,
      label: def.label || v.asset_type,
      zone: getZone(v.zone_id)?.name || v.zone_id,
      dormant: !!v.dormant,
      floor: (def.passiveFloor || 0) * v.level,
      upkeep: def.upkeep || 0,
      share: Math.round((def.activeShare || 0) * 100),
    };
  });
}
export const ventureCount = (orgId) => getOrgVentures(orgId).length;

export { CLAIM_FEE, projectInfluence };
