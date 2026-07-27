// Tablet OS — Vitals app. The body, read back to you by a cheap medical suite.
//
// This owns NO health logic. Every number here is already true somewhere else —
// the live player object, condition.js, the sanity/intoxication plugins, the drug
// ledger — and this is a window onto them. The one thing it can *do* is spend an
// item you're already carrying, and it does that by calling the engine's own
// `cmdUse`, so a dose taken from the tablet is byte-identical to one typed at the
// prompt (timed consumption, tolerance, overdose death, all of it).
//
// Three screens:
//   VITALS      — the meters, plus everything currently dragging on you, plus a
//                 contextual quick-remedy strip (only what's actually wrong).
//   APOTHECARY  — the medical/chemical subset of your inventory, not all of it,
//                 with one-tap use. A stimpak is three taps from anywhere.
//   SUBSTANCES  — tolerance, dependency, withdrawal countdown and how close each
//                 drug's load is to its own overdose ceiling. This is the screen
//                 that stops an overdose being a thing you only learn about once.
import { query } from '../../server/models/db.js';
import { registerTabletApp, normScreen } from './registry.js';
import { cmdUse } from '../../server/engine/commands/inventory.js';
import { statusLabels } from '../../server/engine/effects.js';
import { conditionReport, fatigueOf, FATIGUE_TIRED, FATIGUE_EXHAUSTED, FATIGUE_RUINED } from '../../server/engine/condition.js';
import { getDrugStatus, visibleIntoxication } from '../../server/engine/drugs.js';
import { hygieneOf } from '../../server/engine/hygiene.js';
import { bandFor as sanityBandFor } from '../sanity/index.js';
import { intoxBand } from '../intoxication/index.js';
import { bodyReport } from '../injury/index.js';

const TABS = [
  { id: 'vitals', label: 'Vitals' },
  { id: 'apothecary', label: 'Apothecary' },
  { id: 'substances', label: 'Substances' },
];

// Tags that make a carried item worth showing on a medical screen. Anything with
// none of these is luggage as far as this app is concerned.
const REMEDY_TAGS = [
  'restore_hp', 'heal_over_time', 'restore_sanity', 'restore_radiation',
  'restore_hunger', 'restore_thirst', 'laced_drug',
];

const STAT_LABEL = {
  stat_brawn: 'Brawn', stat_reflexes: 'Reflexes', stat_brains: 'Brains',
  stat_cool: 'Cool', stat_endurance: 'Endurance', stat_senses: 'Senses',
};

const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0);
const stripTags = s => String(s || '').replace(/<[^>]*>/g, '').trim();

// Band a 0–100 reading where HIGH is healthy (hp, hunger, sanity…).
function bandHigh(p) { return p >= 66 ? 'good' : p >= 33 ? 'warn' : p >= 12 ? 'bad' : 'crit'; }
// …and one where high is the problem (radiation, fatigue, intoxication).
function bandLow(p) { return p < 25 ? 'good' : p < 50 ? 'warn' : p < 75 ? 'bad' : 'crit'; }

function fmtDuration(secs) {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `${h}h ${Math.round((s % 3600) / 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

// ── The meters ───────────────────────────────────────────────────────────────

function buildMeters(player) {
  const hpMax = player.hp_max || 100;
  const sanMax = player.sanity_max || 100;
  const stamMax = player.stamina_max || 100;
  const rad = Math.max(0, Math.min(100, player.radiation || 0));
  const temp = Number(player.body_temp_c ?? 37);
  const tired = Math.round(fatigueOf(player));
  const sanBand = sanityBandFor(player);

  // Temperature reads outward from 37°C in both directions — the meter shows how
  // far off core you are, not a raw 25–45 sweep nobody can parse at a glance.
  const tempOff = Math.abs(temp - 37);
  const tempBand = tempOff < 1 ? 'good' : tempOff < 3 ? 'warn' : tempOff < 5 ? 'bad' : 'crit';
  const tempNote = temp < 30 ? 'freezing' : temp < 34 ? 'cold' : temp < 36 ? 'chilled'
    : temp > 42 ? 'overheating' : temp > 40 ? 'hot' : temp > 38 ? 'warm' : 'core normal';

  const meters = [
    { key: 'hp', label: 'Vitality', value: player.hp ?? 0, max: hpMax,
      pct: pct(player.hp ?? 0, hpMax), band: bandHigh(pct(player.hp ?? 0, hpMax)),
      note: `${player.hp ?? 0} / ${hpMax} HP` },
    { key: 'sanity', label: 'Sanity', value: player.sanity ?? 0, max: sanMax,
      pct: pct(player.sanity ?? 0, sanMax), band: player.insane ? 'crit' : bandHigh(pct(player.sanity ?? 0, sanMax)),
      note: { clear: 'lucid', creep: 'unsettled', halluc: 'seeing things', insane: 'gone' }[sanBand] || sanBand },
    { key: 'stamina', label: 'Stamina', value: Math.round(player.stamina ?? stamMax), max: stamMax,
      pct: pct(player.stamina ?? stamMax, stamMax), band: bandHigh(pct(player.stamina ?? stamMax, stamMax)),
      note: `${Math.round(player.stamina ?? stamMax)} / ${stamMax}` },
    { key: 'hunger', label: 'Nourishment', value: player.hunger ?? 0, max: 100,
      pct: player.hunger ?? 0, band: bandHigh(player.hunger ?? 0),
      note: (player.hunger ?? 100) <= 0 ? 'starving — losing HP' : (player.hunger ?? 100) <= 20 ? 'very hungry' : 'fed' },
    { key: 'thirst', label: 'Hydration', value: player.thirst ?? 0, max: 100,
      pct: player.thirst ?? 0, band: bandHigh(player.thirst ?? 0),
      note: (player.thirst ?? 100) <= 0 ? 'dehydrated — losing HP fast' : (player.thirst ?? 100) <= 20 ? 'very thirsty' : 'watered' },
    { key: 'radiation', label: 'Radiation', value: rad, max: 100, pct: rad, band: bandLow(rad), invert: true,
      note: rad >= 40 ? 'mutagenic dose' : rad >= 25 ? 'hot' : rad > 0 ? 'traces' : 'clean' },
    { key: 'temp', label: 'Core temp', value: temp, max: 100,
      pct: Math.max(4, Math.min(100, Math.round((tempOff / 8) * 100))), band: tempBand, invert: true,
      note: `${temp.toFixed(1)}°C — ${tempNote}` },
    { key: 'fatigue', label: 'Fatigue', value: tired, max: 100, pct: tired, band: bandLow(tired), invert: true,
      note: tired >= FATIGUE_RUINED ? 'wrecked — sleep now' : tired >= FATIGUE_EXHAUSTED ? 'exhausted'
        : tired >= FATIGUE_TIRED ? 'tired' : 'rested' },
  ];

  const intox = Math.round(player.intoxication || 0);
  if (intox > 0) {
    meters.push({
      key: 'intox', label: 'Intoxication', value: intox, max: 100, pct: intox,
      band: bandLow(intox), invert: true, note: intoxBand(intox),
    });
  }
  return meters;
}

// ── What is currently dragging on you ────────────────────────────────────────

function buildAfflictions(player, drugStatus) {
  const out = [];
  const add = (label, detail, tone = 'warn') => out.push({ label, detail, tone });

  if (player.sleeping) add('Asleep', 'Recovering.', 'good');
  if (player.healOverTime?.length) {
    const hp = player.healOverTime.reduce((s, h) => s + h.perTick * h.ticksRemaining, 0);
    const mins = Math.max(...player.healOverTime.map(h => h.ticksRemaining));
    add('Healing', `${hp} HP over the next ${mins} minute${mins === 1 ? '' : 's'}.`, 'good');
  }
  if (player.wellFedUntil && Date.now() < player.wellFedUntil) {
    add('Well-fed', `Faster HP regen for ${fmtDuration((player.wellFedUntil - Date.now()) / 1000)}.`, 'good');
  }
  if (player.hydratedUntil && Date.now() < player.hydratedUntil) {
    add('Hydrated', `Radiation clears at double rate for ${fmtDuration((player.hydratedUntil - Date.now()) / 1000)}.`, 'good');
  }

  // Registered status effects (poisoned, bleeding, food poisoning, …).
  for (const label of statusLabels(player)) add(label, 'Active status effect.', 'bad');

  // Anything the body's condition is taking off the stats you act with.
  for (const c of conditionReport(player)) {
    // Non-stat impairments (a refused run, slowed recovery) carry a label and no
    // number — rendering them as "null −0" is how the first draft of this read.
    if (!c.stat) { add(c.label, c.why, 'bad'); continue; }
    add(`${STAT_LABEL[c.stat] || c.stat} −${c.penalty}`, `Cause: ${c.why}.`, 'bad');
  }

  // Live phased drugs — what's in you right now and how far through it you are.
  for (const a of player.activeDrugs || []) {
    const total = (a.comeupMs || 0) + (a.peakMs || 0) + (a.comedownMs || 0);
    const left = Math.max(0, total - (Date.now() - a.startedAt));
    add(a.name || 'Unknown compound', `${a.phase || 'active'} · ${fmtDuration(left / 1000)} left`, 'drug');
  }
  const vis = visibleIntoxication(player);
  if (vis) add('Visibly off your head', 'Anyone looking at you can tell. So can a checkpoint.', 'drug');

  // Withdrawal is the one that will kill you slowly while you ignore it.
  for (const d of drugStatus) {
    if (d.withdrawalSeverity > 0) {
      add(`${d.name} withdrawal`, d.substituted
        ? `Biting at ${Math.round(d.withdrawalSeverity * 100)}% — something similar is taking the edge off.`
        : `Biting at ${Math.round(d.withdrawalSeverity * 100)}%. It will not improve on its own.`, 'bad');
    } else if (d.withdrawalIn > 0) {
      add(`${d.name} dependency`, `Starts asking in about ${fmtDuration(d.withdrawalIn)}.`, 'warn');
    }
  }

  if (player.covered_in_blood) add('Covered in blood', "Not necessarily yours. People notice.", 'warn');
  // Only flag what's actually a problem. `clean` and `immaculate` are both good
  // states — comparing against the band STRING missed immaculate and told a
  // freshly washed player they needed a wash.
  const hyg = hygieneOf(player);
  if (hyg.score < 65) {
    add(`Hygiene: ${hyg.band}`, hyg.score <= 25 ? 'You can be smelled from across the room.' : 'You could do with a wash.', 'warn');
  } else if (hyg.score >= 85) {
    add(`Hygiene: ${hyg.band}`, 'Washed, laundered, and nothing on you.', 'good');
  }

  return out;
}

// ── The apothecary (a filtered inventory, not all of it) ─────────────────────

function describeRemedy(tags, drug) {
  const t = tags || {};
  const bits = [];
  if (t.restore_hp) bits.push(`+${t.restore_hp} HP`);
  if (t.heal_over_time?.amount) {
    bits.push(`+${t.heal_over_time.amount} HP over ${Math.round((t.heal_over_time.duration_seconds || 60) / 60)}m`);
  }
  if (t.restore_sanity) bits.push(`${t.restore_sanity > 0 ? '+' : ''}${t.restore_sanity} sanity`);
  if (t.restore_radiation) bits.push(`${t.restore_radiation > 0 ? '+' : ''}${t.restore_radiation} rad`);
  if (t.restore_hunger) bits.push(`+${t.restore_hunger} food`);
  if (t.restore_thirst) bits.push(`+${t.restore_thirst} water`);
  if (t.well_fed) bits.push('well-fed');
  if (t.hydrating) bits.push('hydrating');

  const eff = drug?.effects || {};
  const inst = eff.instant || (eff.hp || eff.sanity || eff.hunger || eff.thirst ? eff : null);
  if (inst) {
    if (inst.hp) bits.push(`${inst.hp > 0 ? '+' : ''}${inst.hp} HP`);
    if (inst.sanity) bits.push(`${inst.sanity > 0 ? '+' : ''}${inst.sanity} sanity`);
    if (inst.radiation) bits.push(`${inst.radiation > 0 ? '+' : ''}${inst.radiation} rad`);
  }
  if (eff.phases?.peak_mods) {
    const mods = Object.entries(eff.phases.peak_mods)
      .filter(([k]) => k.startsWith('stat_'))
      .map(([k, v]) => `${STAT_LABEL[k] || k} ${v > 0 ? '+' : ''}${v}`);
    if (mods.length) bits.push(mods.join(', '));
  }
  return bits.join(' · ') || 'Effect not documented.';
}

// One query. Every carried item that is a drug OR carries a restorative tag,
// collapsed to one row per item TYPE (stacks and duplicate rows summed) because
// `use` targets a type, not a particular row.
async function carriedRemedies(playerId) {
  const { rows } = await query(
    `SELECT i.id AS type_id, i.name, i.tags,
            SUM(pi.quantity)::int AS qty,
            d.id AS drug_id, d.name AS drug_name, d.effects AS drug_effects,
            d.flags AS drug_flags, d.overdose_threshold
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       LEFT JOIN drugs d ON d.item_id = i.id
      WHERE pi.player_id = $1
        AND (d.id IS NOT NULL OR jsonb_exists_any(i.tags, $2::text[]))
      GROUP BY i.id, i.name, i.tags, d.id, d.name, d.effects, d.flags, d.overdose_threshold
      ORDER BY i.name`,
    [playerId, REMEDY_TAGS]
  );

  return rows.map(r => {
    const t = r.tags || {};
    const drug = r.drug_id ? { effects: r.drug_effects || {}, flags: r.drug_flags || {} } : null;
    const healing = (t.restore_hp || 0) + (t.heal_over_time?.amount || 0) + Math.max(0, drug?.effects?.instant?.hp || 0);
    return {
      id: r.type_id,
      name: r.name,
      qty: r.qty || 1,
      kind: r.drug_id ? 'compound' : (healing ? 'medical' : 'sustenance'),
      drugId: r.drug_id || null,
      addictive: !!(r.drug_id && ((r.drug_effects?.withdrawal?.addiction_per_dose ?? 0) > 0 || (r.drug_flags?.drug_class))),
      drugClass: r.drug_flags?.drug_class || null,
      effect: describeRemedy(t, drug),
      // Sort/selection weights for the quick strip.
      _hp: healing,
      _hunger: t.restore_hunger || 0,
      _thirst: t.restore_thirst || 0,
      _rad: -(t.restore_radiation || 0) - Math.max(0, -(drug?.effects?.instant?.radiation || 0)),
      _sanity: (t.restore_sanity || 0) + Math.max(0, drug?.effects?.instant?.sanity || 0),
    };
  });
}

// Only what's actually wrong, and only if you're carrying the answer. An empty
// strip is the correct read-out for a healthy player — don't pad it.
function buildQuick(player, remedies) {
  const out = [];
  const best = (key) => remedies.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key])[0];
  const push = (item, label) => { if (item) out.push({ id: item.id, label, name: item.name, qty: item.qty }); };

  if ((player.hp ?? 0) < (player.hp_max || 100)) push(best('_hp'), 'Patch up');
  if ((player.hunger ?? 100) <= 40) push(best('_hunger'), 'Eat');
  if ((player.thirst ?? 100) <= 40) push(best('_thirst'), 'Drink');
  if ((player.radiation || 0) >= 15) push(best('_rad'), 'Flush rads');
  if (pct(player.sanity ?? 100, player.sanity_max || 100) < 60) push(best('_sanity'), 'Steady up');

  // Same item can answer two problems; show it once.
  const seen = new Set();
  return out.filter(q => !seen.has(q.id) && seen.add(q.id));
}

// ── Screens ──────────────────────────────────────────────────────────────────

async function buildScreen(player, screenId, params, notice = null) {
  const tab = TABS.some(t => t.id === normScreen(screenId)) ? normScreen(screenId) : 'vitals';
  const base = { view: 'health', tab, tabs: TABS, activeTab: tab, breadcrumb: ['Vitals'], notice };

  if (tab === 'apothecary') {
    const remedies = await carriedRemedies(player.id);
    return { ...base, remedies };
  }

  if (tab === 'substances') {
    const status = await getDrugStatus(player);
    return {
      ...base,
      substances: status.map(d => ({
        name: d.name,
        timesUsed: d.timesUsed,
        tolerancePct: Math.round(d.tolerance * 100),
        addicted: d.addicted,
        withdrawalPct: Math.round(d.withdrawalSeverity * 100),
        withdrawalIn: d.withdrawalIn ? fmtDuration(d.withdrawalIn) : null,
        substituted: d.substituted,
        doses: d.dosesInSystem,
        ceiling: d.odCeiling,
        loadPct: Math.round(Math.min(1, d.dosesInSystem / Math.max(1, d.odCeiling)) * 100),
        lastUse: d.timesUsed ? fmtDuration(d.sinceLastUse) : null,
      })),
    };
  }

  // VITALS
  const [remedies, status] = await Promise.all([carriedRemedies(player.id), getDrugStatus(player)]);
  // The paper doll. All seven parts every time, injured or not, so the client
  // renders a whole body rather than a scatter of marks — and `band` comes from
  // the server like every other colour on this screen. Omitted entirely when
  // nothing is wrong, so an uninjured player gets the screen they had before.
  const body = bodyReport(player);
  return {
    ...base,
    meters: buildMeters(player),
    afflictions: buildAfflictions(player, status),
    quick: buildQuick(player, remedies),
    body: body.some(p => p.severity > 0) ? body : null,
    // Which silhouette sits behind the injury schematic. Same field, read the
    // same way, as the Gear doll and the wardrobe doll — one character should
    // be one shape everywhere the game draws them, and three screens quietly
    // disagreeing about your body is the kind of thing nobody reports and
    // everybody notices.
    sex: player.biological_sex === 'female' ? 'female' : 'male',
  };
}

// ── Actions ──────────────────────────────────────────────────────────────────
//
// One action: spend an item. It routes through the engine's own `cmdUse`, so the
// consume plugin's timed drinking, tolerance, addiction and lethal overdose all
// behave exactly as they do from the prompt. cmdUse owns the death path, so this
// never has to know about it — it just relays whatever came back.
async function handleAction(player, actionId, params, broadcast) {
  const [tab, ...rest] = String(params || '').trim().split(/\s+/);
  const itemId = rest.join(' ');
  if (actionId !== 'use' || !itemId) return buildScreen(player, tab, '');

  const res = await cmdUse(itemId, player, broadcast);
  const text = stripTags(res?.message || '');

  // Relay the real command output to the game log (the tablet is covering it) and
  // push any vitals the dose moved, so the sidebar bars don't lag the screen.
  if (res?.message) broadcast(null, { type: 'output', message: res.message }, null, player.id);
  if (res?.player_update) broadcast(null, { type: 'player_update', ...res.player_update }, null, player.id);

  return buildScreen(player, tab, '', text || null);
}

registerTabletApp({
  id: 'health', name: 'Vitals', icon: '🩺', category: 'General',
  buildScreen, handleAction,
});
