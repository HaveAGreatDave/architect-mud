// Snapshot data source for custom sidebar panels. Answers a client `panel_data`
// request by resolving the requested field keys (things not already in the live
// player state the client caches) and replying with a { key: value } map.
// Player-source fields (vitals/stats/credits) are NOT handled here — the client
// reads those straight from its own player cache.
import { query } from '../models/db.js';
import { sendToPlayer } from './messaging.js';
import { SKILLS, getPlayerSkills } from './skills.js';
import { getPlayerFactionRep } from './factions.js';
import { getPlayerMembership, getOrg, getOrgZones } from './world.js';

const SKILL_CATS = ['combat', 'survival', 'tech', 'social', 'arcane'];

async function resolveSkills(playerId) {
  const { rows } = await query('SELECT * FROM players WHERE id=$1', [playerId]);
  const p = rows[0];
  if (!p) return null;
  const ps = await getPlayerSkills(playerId);
  return {
    groups: SKILL_CATS.map(cat => ({
      category: cat,
      skills: Object.values(SKILLS).filter(s => s.category === cat).map(s => {
        const ip = ps[s.id]?.ip || 0;
        const statBonus = Math.floor(s.stats.reduce((sum, c) => sum + (p[c] || 0), 0) / s.stats.length);
        return { id: s.id, name: s.name, final: Math.floor(ip / 100) + statBonus };
      }),
    })),
  };
}

async function resolveFactions(playerId) {
  const reps = await getPlayerFactionRep(playerId);
  return reps.map(f => ({ label: f.name, value: f.tier_label, color: f.tier_color }));
}

async function resolveInvCount(playerId) {
  const { rows } = await query('SELECT COALESCE(SUM(quantity),0) AS n FROM player_inventory WHERE player_id=$1', [playerId]);
  return Number(rows[0]?.n || 0);
}

// Corp status — live sidebar fields (treasury/zones/heat from the org cache).
// Architect heat is 0 until the Phase-1 territory engine drives it.
const corpOrg = (playerId) => { const m = getPlayerMembership(playerId); return m ? getOrg(m.org_id) : null; };
const resolveCorpName = async (pid) => corpOrg(pid)?.name || '—';
const resolveCorpTreasury = async (pid) => corpOrg(pid)?.treasury || 0;
const resolveCorpZones = async (pid) => { const m = getPlayerMembership(pid); return m ? getOrgZones(m.org_id).length : 0; };
const resolveCorpHeat = async (pid) => {
  const m = getPlayerMembership(pid);
  if (!m) return { val: 0, max: 100 };
  const zones = getOrgZones(m.org_id).length;
  const heat = Math.max(0, Math.min(100, zones * 12 + Math.floor((getOrg(m.org_id)?.treasury || 0) / 5000) * 5));
  return { val: heat, max: 100 };
};

const RESOLVERS = {
  skills: resolveSkills, factions: resolveFactions, inv_count: resolveInvCount,
  corp_name: resolveCorpName, corp_treasury: resolveCorpTreasury,
  corp_zones: resolveCorpZones, corp_heat: resolveCorpHeat,
};

// The builder's Skills sub-picker needs the skill list up front (before any
// panel_data fetch). Cameras are added by the surveillance plugin's own
// panel.catalog consumer — the client merges the two pushes.
export function sendPanelCatalog(session) {
  if (!session?.playerId) return;
  const skills = Object.values(SKILLS).map(s => ({ id: s.id, name: s.name, category: s.category }));
  sendToPlayer(session.playerId, { type: 'panel_catalog', skills });
}

export async function handlePanelData(session, msg) {
  const playerId = session?.playerId;
  if (!playerId) return;
  const values = {};
  for (const key of Array.isArray(msg.fields) ? msg.fields : []) {
    if (RESOLVERS[key]) values[key] = await RESOLVERS[key](playerId);
  }
  sendToPlayer(playerId, { type: 'panel_data', values });
}
