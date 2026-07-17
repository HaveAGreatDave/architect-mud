// Tablet OS — Ideology app. A read-only reshape of the same data the
// `ideologies`/`rep` command computes (server/engine/ideologies.js): your
// standing per order, your stance + path affinities, and the order you lean
// toward. Renders natively client-side (view: 'ideology', paged Overview /
// one page per order / the Field) — no ideology math lives here.
//
// Everything rides in one payload; the client pages through it (like the corp
// dashboard), so opening the app is a single fetch, not a round trip per page.
import { getPlayerIdeologyRep, classifyLean, PATHS, REP_TIERS } from '../../server/engine/ideologies.js';
import { getFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';
import { registerTabletApp } from './registry.js';

const STANCE_FLAG = 'stance_axis';               // -100 renounce .. +100 redeem
const pathFlag = (p) => `path_${p}`;

// Tier → perk label, mirroring getIdeologyDiscount()'s discount table so the
// standing ladder tells the player what each rung actually buys.
const TIER_PERK = {
  hostile: '−20% prices · may turn on you',
  unknown: 'no favor', neutral: 'no favor',
  known: '+5% vendor favor', trusted: '+15% vendor favor',
  inner_circle: '+25% vendor favor',
};

async function buildScreen(player) {
  const reps = await getPlayerIdeologyRep(player.id);
  const ids = reps.map(r => r.id);

  // Player position: signed stance + per-path affinity (same flags the
  // ideologies command reads).
  const stance = Number(await getFlag('player', STANCE_FLAG, player)) || 0;
  const paths = {};
  for (const p of PATHS) paths[p] = Number(await getFlag('player', pathFlag(p), player)) || 0;
  const lean = classifyLean(stance, paths, reps);

  // Reader copy (motto/pull/tenets/path_text/relnote) + relations + the agents
  // you meet in the world — all in set-based queries (no per-row loop), fetched
  // together since they're independent.
  const [flagRows, relRows, npcRows] = await Promise.all([
    query('SELECT id, flags FROM orgs WHERE id = ANY($1)', [ids]),
    query(`SELECT rel.org_id, o.name AS other_name, rel.stance
             FROM org_relations rel JOIN orgs o ON o.id = rel.other_org_id
            WHERE rel.org_id = ANY($1)`, [ids]),
    query('SELECT name, faction FROM npcs WHERE faction = ANY($1) ORDER BY name', [ids]),
  ]);

  const readerById = new Map(flagRows.rows.map(r => [r.id, r.flags?.reader || {}]));
  const nameById = new Map(reps.map(r => [r.id, r.name]));

  // opposed = hostile relations; "no quarrel" = the other orders neither self
  // nor opposed (relations are directional; we read this order's own row).
  const opposedById = {};
  for (const r of relRows.rows) {
    if (r.stance === 'hostile') (opposedById[r.org_id] ||= []).push(r.other_name);
  }
  const npcsById = {};
  for (const n of npcRows.rows) (npcsById[n.faction] ||= []).push(n.name);

  const orders = reps.map(f => {
    const reader = readerById.get(f.id) || {};
    const idx = REP_TIERS.findIndex(t => t.id === f.tier);
    const next = REP_TIERS[idx + 1];
    const opposed = opposedById[f.id] || [];
    const opposedSet = new Set(opposed);
    const neutral = reps
      .filter(o => o.id !== f.id && !opposedSet.has(o.name))
      .map(o => o.name);
    return {
      id: f.id, name: f.name, color: f.color, expansion: f.expansion,
      stance: f.profile?.stance || null, path: f.profile?.path || null,
      lore: f.description || '',
      experience: reader.experience || null,
      motto: reader.motto || null, pull: reader.pull || null,
      tenets: reader.tenets || [], pathText: reader.path_text || null,
      relnote: reader.relnote || null,
      rep: f.reputation, tier: f.tier_label, tierPerk: TIER_PERK[f.tier] || '',
      nextTier: next ? next.label : null,
      nextAt: next ? next.min - f.reputation : null,
      opposed, neutral, npcs: npcsById[f.id] || [],
    };
  });

  return {
    view: 'ideology',
    breadcrumb: [],
    overview: {
      stance, paths,
      leanId: lean?.id || null, leanName: lean?.name || null, leanColor: lean?.color || null,
    },
    tiers: REP_TIERS.map(t => ({ id: t.id, label: t.label, perk: TIER_PERK[t.id] || '' })),
    orders,
  };
}

registerTabletApp({
  id: 'ideology', name: 'Ideology', icon: '◆', category: 'Progression',
  buildScreen,
});
