/**
 * Synthesis plugin — cook reagents into drugs.
 *
 * `cook`                → list chemistry recipes you can attempt (+ what you're missing)
 * `cook <recipe>`       → validate reagents/skill/station, then open the "stabilize
 *                         the reaction" minigame (server sends `synth_minigame`)
 * `synthresolve <id> <score>` → internal: the client reports its 0–100 minigame
 *                         score; the server rolls the authoritative 2d8−2d8
 *                         chemistry check, folds in the minigame score + station
 *                         bonus, and on success produces a POTENCY-scaled drug.
 *
 * Skill AND minigame both matter: the check is server-authoritative (guarded by a
 * pending+TTL entry so a stale/forged resolve is ignored), but a good cook adds
 * margin → higher potency (baked into the drug item's custom_data, read by
 * useDrug) and a botch can blow up in your face. Cook at a chem-lab station
 * (station quality adds a bonus) — raw→processed always needs a real lab, no
 * portable kit. Reuses the crafting recipe cache + the 2d8−2d8 skillCheck;
 * recipes/reagents/labs are content.
 */
import { query, withTransaction } from '../../server/models/db.js';
import { getRecipeCache, findRecipeByName } from '../../server/engine/crafting.js';
import { skillCheck, awardSkillUse, skillStatBonus, effectiveSkill } from '../../server/engine/skills.js';
import { getDrugCache } from '../../server/engine/drugs.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { getTunable } from '../../server/engine/tunables.js';
import { randomUUID } from 'crypto';

const SYNTH_SKILL = 'chemistry';
const PENDING_TTL_MS = 180000;
const pendingSynth = new Map(); // playerId -> { recipeId, contextBonus, mode, tier, family, difficulty, ts }

// Cook families: each material FORM maps to one of four single-stage minigames.
const COOK_FAMILY = { powder: 'solids', pill: 'solids', crystal: 'solids', liquid: 'wet', gel: 'wet', paste: 'wet', gas: 'gas', leaf: 'botanical', blotter: 'botanical' };
const TIER_PRICE = [0, 15, 40, 90, 180, 350]; // display estimate; real value is on the item (scripts/add-cook-tiers.js)
// The drug a recipe produces (match its base_output item to a drugs-row item_id).
function drugForOutput(recipe) { const outId = recipe.base_output?.item_id; if (!outId) return null; const cache = getDrugCache(); return Object.values(cache).find(d => d.item_id === outId) || null; }
// Intensity tier 1..5 — author-set (flags.cook_tier) or derived from how nasty the drug is.
function cookTier(drug) {
  const t = Number(drug?.flags?.cook_tier); if (t >= 1 && t <= 5) return Math.round(t);
  const e = drug?.effects || {}; let s = 1;
  if (e.overdose?.lethal) s += 2;
  const mag = Object.values(e.instant || {}).reduce((a, v) => a + Math.abs(Number(v) || 0), 0);
  if (mag > 24) s += 1; if ((drug?.addiction_chance || 0) >= 0.3) s += 1; if (e.hallucination) s += 1;
  return Math.max(1, Math.min(5, s));
}
function cookFamily(drug) { return COOK_FAMILY[drug?.flags?.form] || 'wet'; }
function cookDiff(tier) { return Math.max(1, Math.min(14, 2 + tier * 2)); } // tier1=4 … tier5=12

function synthRecipes() {
  // Cook = a chemistry recipe whose output is an actual drug. Non-drug chemistry
  // recipes (e.g. the compound stabilizer) are crafted via `craft`, not cooked.
  return Object.values(getRecipeCache()).filter(r => r.skill_id === SYNTH_SKILL && drugForOutput(r));
}

async function playerInventory(playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, pi.quantity, i.name FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id WHERE pi.player_id = $1 AND pi.is_equipped = 0`,
    [playerId]
  );
  return rows;
}

// Resolve reagents against inventory → { toConsume } or { missing }.
function resolveIngredients(recipe, inventory) {
  const toConsume = [];
  for (const ing of recipe.ingredients || []) {
    if (!ing.item_id || !ing.quantity) continue;
    const found = inventory.find(inv => inv.item_id === ing.item_id && inv.quantity >= ing.quantity);
    if (!found) return { missing: ing };
    toConsume.push({ invId: found.id, quantity: ing.quantity, currentQty: found.quantity });
  }
  return { toConsume };
}

// Chem-lab furniture in the zone, or nothing. Raw→processed cooks require a real
// chem lab — no portable cook kit (only rolling manipulates already-processed
// drugs without one).
async function findWorkspace(recipe, player) {
  const wantStation = recipe.requires_station || 'chem_lab';
  const { rows } = await query(
    `SELECT flags FROM furniture WHERE zone_id = $1 AND flags->>'crafting_station' = $2 LIMIT 1`,
    [player.current_zone, wantStation]
  );
  if (rows.length) {
    const q = rows[0].flags?.station_quality;
    const bonus = q === 'pristine' ? 4 : q === 'refined' ? 2 : 0;
    return { mode: 'lab', contextBonus: bonus, label: 'the lab' };
  }
  return null;
}

async function cmdCook(args, raw, player, broadcast) {
  const recipes = synthRecipes();
  if (!recipes.length) return { type: 'error', message: 'You know no way to cook anything.' };

  const name = args.join(' ').trim();
  if (!name) {
    // No arg → open the cook menu at the station (client renders it, click → `cook <name>`).
    const inv = await playerInventory(player.id);
    const items = recipes.map(r => {
      const res = resolveIngredients(r, inv); const drug = drugForOutput(r); const tier = cookTier(drug);
      const need = (r.ingredients || []).map(ing => `${ing.quantity}x ${ing.item_id.replace(/^item_/, '').replace(/_/g, ' ')}`);
      return { recipe: r.name, drug: drug?.name || r.name, form: drug?.flags?.form || null, family: cookFamily(drug), tier, difficulty: cookDiff(tier), ready: !res.missing, need, value: TIER_PRICE[tier] };
    });
    const hasLab = !!(await findWorkspace({ requires_station: 'chem_lab' }, player));
    return { type: 'cook_menu', items, hasLab };
  }

  const recipe = findRecipeByName(name);
  if (!recipe || recipe.skill_id !== SYNTH_SKILL) return { type: 'error', message: `You don't know how to cook "${name}".` };

  // Skill-rank gate (level + stat bonus), matching the crafting requirement style.
  const { rows: skillRows } = await query('SELECT skill_id, ip FROM player_skills WHERE player_id=$1', [player.id]);
  const levels = {};
  for (const r of skillRows) levels[r.skill_id] = Math.floor((r.ip || 0) / 100);
  for (const [sid, minRank] of Object.entries(recipe.skill_req || {})) {
    if ((levels[sid] || 0) + skillStatBonus(player, sid) < minRank) {
      return { type: 'error', message: `You need ${sid.replace(/_/g, ' ')} rank ${minRank} to attempt this cook.` };
    }
  }

  const inv = await playerInventory(player.id);
  const res = resolveIngredients(recipe, inv);
  if (res.missing) {
    const { rows } = await query('SELECT name FROM items WHERE id=$1', [res.missing.item_id]);
    return { type: 'error', message: `You need ${res.missing.quantity}x ${rows[0]?.name || res.missing.item_id}.` };
  }

  const ws = await findWorkspace(recipe, player);
  if (!ws) {
    const need = (recipe.requires_station || 'chem_lab').replace(/_/g, ' ');
    return { type: 'error', message: `You need a ${need} to attempt this.` };
  }

  const drug = drugForOutput(recipe); const tier = cookTier(drug); const family = cookFamily(drug); const difficulty = cookDiff(tier);
  const nonce = randomUUID().slice(0, 8); // one-shot token: the client echoes it on resolve, so a cook can't be resolved without being armed here
  pendingSynth.set(player.id, { recipeId: recipe.id, nonce, contextBonus: ws.contextBonus, mode: ws.mode, tier, family, difficulty, ts: Date.now() });
  return {
    type: 'synth_minigame',
    recipeId: recipe.id, nonce,
    recipeName: drug?.name || recipe.name,
    family, form: drug?.flags?.form || null, tier, difficulty,
    workspace: ws.label,
  };
}

async function cmdSynthResolve(args, raw, player, broadcast) {
  const recipeId = args[0];
  const score = Math.max(0, Math.min(100, parseInt(args[1], 10) || 0));
  const nonce = args[2];
  const pending = pendingSynth.get(player.id);
  pendingSynth.delete(player.id);
  if (!pending || pending.recipeId !== recipeId || pending.nonce !== nonce || Date.now() - pending.ts > PENDING_TTL_MS) return { type: 'noop' };

  const recipe = getRecipeCache()[recipeId];
  if (!recipe) return { type: 'error', message: 'The recipe slips out of your head.' };

  const inv = await playerInventory(player.id);
  const res = resolveIngredients(recipe, inv);
  if (res.missing) return { type: 'error', message: "You're missing something now — the cook falls apart." };
  const toConsume = res.toConsume;

  const tier = pending.tier || 1;
  const skillResult = await skillCheck(player, SYNTH_SKILL, pending.difficulty ?? (recipe.base_difficulty ?? 5));
  const minigameBonus = Math.round((score / 100 - 0.5) * 4); // -2..+2 (bounded so skipping the minigame to claim max barely helps)
  const finalMargin = skillResult.margin + minigameBonus + pending.contextBonus;
  const success = finalMargin >= 0;
  const catastrophic = finalMargin < -5 && tier >= 3; // tier 1–2 drugs are cheap + safe to botch

  const consume = async (q) => {
    for (const c of toConsume) {
      if (c.currentQty <= c.quantity) await q('DELETE FROM player_inventory WHERE id=$1', [c.invId]);
      else await q('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [c.quantity, c.invId]);
    }
  };

  if (catastrophic) {
    await withTransaction(consume);
    // Toxic byproduct — a flash of heat and acrid smoke. Nastier for higher-tier drugs.
    const dmg = 6 + tier * 4; // tier3=18 … tier5=26
    const hp = Math.max(0, (player.hp || 0) - dmg);
    const sanity = Math.max(0, (player.sanity || 0) - (3 + tier * 2));
    player.hp = hp; player.sanity = sanity;
    query('UPDATE players SET hp=$1, sanity=$2 WHERE id=$3', [hp, sanity, player.id]).catch(() => {});
    if (hp <= 0) {
      broadcast(null, { type: 'output', message: `<span class="overdose-warning">The mixture detonates in your hands. The last thing you smell is burning.</span>`, player_update: { hp, sanity } }, null, player.id);
      const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
      await handlePlayerDeath(player, null, { type: 'drug', label: 'Killed by a botched cook' });
      return { type: 'noop' };
    }
    return { type: 'output', message: `<span class="overdose-warning">The reaction runs away from you — a flash of heat, a gout of acrid smoke. The batch is ruined and you're burned (−${dmg} HP).</span>`, player_update: { hp, sanity } };
  }

  if (!success) {
    await withTransaction(consume); // a failed cook still burns the materials — no free infinite retries
    return { type: 'error', message: `The cook doesn't take. The mixture goes inert and cloudy — a wasted run, and the materials are spent. (margin ${finalMargin})` };
  }

  // Potency baked into the produced drug item — a great cook makes stronger product.
  const potency = Math.max(0.5, Math.min(1.8, Math.round((0.6 + finalMargin * 0.09) * 100) / 100));
  const customData = { potency, synthesized: true };
  const outQty = recipe.base_output?.quantity || 1;
  const outId = recipe.base_output?.item_id;
  const { rows: itemRows } = await query('SELECT name FROM items WHERE id=$1', [outId]);
  const outName = itemRows[0]?.name || recipe.name;

  await withTransaction(async (q) => {
    await consume(q);
    // Non-stacking: each batch's potency is distinct, so always a fresh row.
    await q(
      'INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1,$2,$3,$4,1.0,$5)',
      [randomUUID(), player.id, outId, outQty, JSON.stringify(customData)]
    );
  });

  await awardSkillUse(player.id, SYNTH_SKILL, skillResult.margin);

  const pct = Math.round(potency * 100);
  return {
    type: 'output',
    message: `<span class="ip-gain">The reaction settles clean.</span> You cook ${outQty}x <span class="item">${outName}</span> — <b>${pct}% potency</b>.`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SPLICING — the master tier. Break down drugs and graft their effect-blocks
// onto a base drug to make a bespoke compound. Gated on high chemistry + a real
// lab. Consumes one dose of each source drug + a single Stabilizer (a fixed
// per-run overhead, whatever the batch size). The composed
// effects blob rides on the produced item's custom_data (an "inline drug" that
// useDrug reads directly — no DB drug row per splice). Four risks: instability →
// bad batch, antagonistic clash → harder, overload → OD-prone, lethal blowback.
// ════════════════════════════════════════════════════════════════════════════
const SPLICE_MIN_SKILL = 6;     // effectiveSkill(chemistry) required
const SPLICE_BASE_DIFF = 8;
const STABILIZER_ITEM = 'item_stabilizer';
const COMPOUND_ITEM = 'item_compound';
const COMPOUND_DRUG = 'drug_compound';
const STRUCT = ['instant', 'phases', 'hallucination', 'tolerance', 'withdrawal', 'overdose'];
const pendingSplice = new Map();

// Visual metadata for the drag-drop SELECT screen. FORM/COLOUR are content
// (drug flags.form / flags.color / flags.sub / flags.volatility) with generic,
// stable-per-drug fallbacks — so packages render distinctly even before any
// content is backfilled, and content can override later without a code change.
const SPLICE_FORMS = ['liquid', 'powder', 'gel', 'pill', 'gas', 'crystal', 'blotter', 'paste', 'leaf'];
const SPLICE_SUBS = { liquid: 'thin', powder: 'fine', gel: 'viscous', pill: 'tablet', gas: 'pressurized', crystal: 'shard', blotter: 'sheet', paste: 'tar', leaf: 'dried' };
const FORM_FALLBACK = ['liquid', 'powder', 'gel', 'pill']; // auto-derive only assigns the common four; the rest are opt-in via flags.form
const PALETTE_HEX = { green: '#4fe08a', purple: '#9a5ce0', red: '#e0644f', gold: '#e0b64f', cyan: '#5fd0e0', magenta: '#e05cc0', blue: '#4f9ae0' };
const FALLBACK_HEX = ['#4fe08a', '#e0644f', '#4f9ae0', '#e0b64f', '#9a5ce0', '#5fd0e0', '#7de07a', '#e05cc0', '#d6a0e0', '#c9c9d6'];
function hashStr(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0; return h; }
function drugVisual(id, drug) {
  const flags = drug?.flags || {}, e = drug?.effects || {}, h = hashStr(id);
  const form = SPLICE_FORMS.includes(flags.form) ? flags.form : FORM_FALLBACK[h % FORM_FALLBACK.length];
  const sub = flags.sub || SPLICE_SUBS[form] || 'thin';
  const color = flags.color || PALETTE_HEX[e.hallucination?.palette] || FALLBACK_HEX[h % FALLBACK_HEX.length];
  let vol = flags.volatility;
  if (vol == null) vol = Math.min(1, (e.overdose?.lethal ? 0.5 : 0.25) + (e.hallucination?.intensity || 0) * 0.3 + (e.phases ? 0.1 : 0));
  return { form, sub, color, vol: Math.round(vol * 100) / 100 };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
function normEff(e) {
  e = e || {};
  const structured = STRUCT.some(k => k in e);
  return {
    instant: { ...(structured ? (e.instant || {}) : e) },
    phases: e.phases ? clone(e.phases) : null,
    hallucination: e.hallucination ? clone(e.hallucination) : null,
    tolerance: e.tolerance, withdrawal: e.withdrawal, overdose: e.overdose,
  };
}
function absSum(o) { let s = 0; for (const k in (o || {})) s += Math.abs(Number(o[k]) || 0); return s; }
const summariseInstant = (i) => Object.entries(i).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ');
const summarisePhases = (p) => `${p.peak_seconds || 0}s peak: ${Object.entries(p.peak_mods || {}).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.replace(/_/g, ' ')}`).join(', ') || '—'}`;
const summariseHall = (h) => `${h.mode || 'overlay'} trip (${h.palette || 'green'}, ${Math.round((h.intensity || 0.5) * 100)}%)`;

const MAX_BATCH = 10;   // hard cap on a single splice's output doses
const clampQty = (q) => Math.max(1, Math.min(MAX_BATCH, parseInt(q, 10) || 1));

const THREE_WAY_CHEM = 10;      // near-max Chemistry to unlock the 3rd (splice-2) slot
const THREE_WAY_SPLICES = 15;   // …and this many clean splices logged (the `splice_count` flag)

// Weighted blend of N effect-mod maps (weights sum to 1). Opposite signs on a
// shared stat across the inputs = antagonism (volatility). Empty result rounds
// don't drop a real effect entirely.
function blendManyMods(maps, weights) {
  const keys = new Set(); maps.forEach(m => { for (const k in (m || {})) keys.add(k); });
  const obj = {}; let conflicts = 0;
  for (const k of keys) {
    let sum = 0; const signs = new Set();
    maps.forEach((m, i) => { const v = Number(m?.[k]) || 0; sum += v * weights[i]; if (v) signs.add(Math.sign(v)); });
    if (signs.size > 1) conflicts++;
    const v = Math.round(sum);
    if (v !== 0) obj[k] = v; else if (signs.size) obj[k] = sum >= 0 ? 1 : -1;
  }
  return { obj, conflicts };
}

// Weighted blend of N hex colours (up to 3 in a splice). "Re-splice inherits 1":
// each input already carries one blended colour, so this yields one colour out.
function hexBlendMany(colors, weights) {
  const parse = (h) => { h = String(h || '#888888').replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
  let r = 0, g = 0, b = 0;
  colors.forEach((c, i) => { const [cr, cg, cb] = parse(c); r += cr * weights[i]; g += cg * weights[i]; b += cb * weights[i]; });
  const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

// Compose 2–3 drugs (each { eff, form, color, qty }) into one compound. All effect
// layers merge (no per-block picking); each input is weighted by quantity²
// (exponential), so the ratio sets the proportion. Output quantity = the highest
// input; output form = the single highest-quantity input's (tie → base); output
// colour = the weighted blend (up to 3). Difficulty/instability climb with the
// input count and the batch size.
function composeSplice(inputs) {
  const norm = inputs.map(i => ({ eff: normEff(i.eff), form: i.form, color: i.color, qty: Math.max(1, i.qty || 1) }));
  const wRaw = norm.map(i => i.qty * i.qty); const tot = wRaw.reduce((a, b) => a + b, 0) || 1;
  const w = wRaw.map(x => x / tot);
  let antagonism = 0;

  const ri = blendManyMods(norm.map(i => i.eff.instant), w); antagonism += ri.conflicts;
  const composed = {
    instant: ri.obj, phases: null, hallucination: null,
    tolerance: norm.find(i => i.eff.tolerance != null)?.eff.tolerance,
    withdrawal: norm.find(i => i.eff.withdrawal != null)?.eff.withdrawal,
    overdose: norm.find(i => i.eff.overdose != null)?.eff.overdose,
  };

  const withP = norm.filter(i => i.eff.phases);
  if (withP.length) {
    const pw = withP.map(i => i.qty * i.qty); const pt = pw.reduce((a, b) => a + b, 0) || 1;
    const rp = blendManyMods(withP.map(i => i.eff.phases.peak_mods || {}), pw.map(x => x / pt)); antagonism += rp.conflicts;
    const ph = clone(withP[0].eff.phases); ph.peak_mods = rp.obj;
    for (const key of ['comeup_seconds', 'peak_seconds', 'comedown_seconds']) ph[key] = Math.max(...withP.map(i => i.eff.phases[key] || 0));
    composed.phases = ph;
  }

  const withH = norm.filter(i => i.eff.hallucination);
  if (withH.length) {
    const hw = withH.map(i => i.qty * i.qty); const ht = hw.reduce((a, b) => a + b, 0) || 1;
    const h = clone(withH[0].eff.hallucination);
    h.intensity = Math.min(1, withH.reduce((s, i, idx) => s + (i.eff.hallucination.intensity || 0.5) * (hw[idx] / ht), 0));
    h.events = withH.flatMap(i => i.eff.hallucination.events || []).slice(0, 12);
    const dz = withH.find(i => i.eff.hallucination.mode === 'dreamzone');
    if (dz) { h.mode = 'dreamzone'; h.dreamzone_id = h.dreamzone_id || dz.eff.hallucination.dreamzone_id; }
    composed.hallucination = h;
  }

  const outputQty = Math.max(...norm.map(i => i.qty));
  let fi = 0; for (let i = 1; i < norm.length; i++) if (norm[i].qty > norm[fi].qty) fi = i;
  const form = norm[fi].form;
  const color = hexBlendMany(norm.map(i => i.color), w);
  const totalAbs = absSum(composed.phases?.peak_mods) + absSum(composed.instant);
  const hallCount = composed.hallucination ? 1 : 0;
  const n = norm.length;
  const difficulty = Math.round(SPLICE_BASE_DIFF + 1.5 * (n - 2) + 1.2 * (outputQty - 1) + 1.5 * antagonism + totalAbs / 12);
  const instability = Math.min(1, 0.10 * (outputQty - 1) + 0.10 * (n - 2) + 0.18 * antagonism + 0.12 * hallCount + totalAbs / 120);
  const doseWeight = n;                  // one dose-weight per distinct drug in the blend
  const odThreshold = doseWeight + 2;    // first dose usable; stacking doses ODs faster than a plain drug
  const warnings = [];
  if (antagonism > 0) warnings.push('Antagonistic effects fight each other — volatile.');
  if (n >= 3) warnings.push('Three-way blend — overloaded, ODs fast.');
  if (outputQty >= 4) warnings.push('Big batch — harder to hold steady.');
  if (instability > 0.6) warnings.push('Highly unstable — real risk of a bad batch, or worse.');
  return { effects: composed, difficulty, instability: Math.round(instability * 100) / 100, doseWeight, odThreshold, outputQty, form, color, warnings, antagonism };
}

function badBatch(effects) {
  const c = clone(effects);
  c.instant = c.instant || {};
  c.instant.hp = (c.instant.hp || 0) - 10;
  c.instant.sanity = (c.instant.sanity || 0) - 12;
  if (c.phases?.peak_mods) for (const k in c.phases.peak_mods) c.phases.peak_mods[k] = Math.round(c.phases.peak_mods[k] * 0.4);
  if (c.hallucination) { c.hallucination.palette = 'red'; c.hallucination.intensity = Math.min(1, (c.hallucination.intensity || 0.5) + 0.2); }
  return c;
}


async function cmdSplice(args, raw, player, broadcast) {
  const eff = await effectiveSkill(player, SYNTH_SKILL);
  if (eff < SPLICE_MIN_SKILL) return { type: 'error', message: `Splicing is master's work — you need Chemistry ${SPLICE_MIN_SKILL}+ (you're at ${eff}).` };
  const ws = await findWorkspace({ requires_station: 'chem_lab' }, player);
  if (!ws || ws.mode !== 'lab') return { type: 'error', message: "Splicing needs a real chem lab — a cook kit can't hold the reaction." };

  const cache = getDrugCache();
  const { rows } = await query(
    `SELECT d.id as drug_id, i.name, SUM(pi.quantity)::int AS qty FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id = $1 AND pi.is_equipped = 0
     GROUP BY d.id, i.name`,
    [player.id]
  );
  const drugs = [];
  for (const r of rows) {
    if (r.drug_id === COMPOUND_DRUG) continue; // can't splice compounds
    const e = normEff(cache[r.drug_id]?.effects);
    const blocks = {};
    if (Object.keys(e.instant).length) blocks.instant = summariseInstant(e.instant);
    if (e.phases) blocks.phases = summarisePhases(e.phases);
    if (e.hallucination) blocks.hallucination = summariseHall(e.hallucination);
    if (Object.keys(blocks).length) drugs.push({ drug: r.drug_id, name: r.name, blocks, count: r.qty || 1, ...drugVisual(r.drug_id, cache[r.drug_id]) });
  }
  if (drugs.length < 2) return { type: 'error', message: 'You need at least two different drugs on hand to splice.' };
  const stab = await query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, STABILIZER_ITEM]);
  const stabilizerCount = stab.rows[0]?.n || 0;

  // familiarity: a drug's effects reveal with repeated use (learned-by-use)
  const { rows: kn } = await query('SELECT drug_id, times_used FROM player_drug_state WHERE player_id=$1 AND drug_id = ANY($2)', [player.id, drugs.map(d => d.drug)]);
  const usedBy = {}; for (const k of kn) usedBy[k.drug_id] = k.times_used || 0;
  for (const d of drugs) d.known = Math.max(0.2, Math.min(1, 0.35 + (usedBy[d.drug] || 0) * 0.09));

  return { type: 'splice_designer', drugs, minSkill: SPLICE_MIN_SKILL, baseDifficulty: SPLICE_BASE_DIFF, hasStabilizer: stabilizerCount > 0, stabilizerCount, allow3way: await allow3way(player) };
}

function summariseComposed(e) {
  const lines = [];
  if (e.instant && Object.keys(e.instant).length) lines.push('Instant: ' + summariseInstant(e.instant));
  if (e.phases) lines.push('Phased: ' + summarisePhases(e.phases));
  if (e.hallucination) lines.push('Trip: ' + summariseHall(e.hallucination));
  return lines.join('\n') || 'No effects selected.';
}

// Build the { eff, form, color } shape composeSplice wants from a cached drug.
function spliceInput(drugId, cache) {
  const d = cache[drugId];
  if (!d) return null;
  return { eff: d.effects, ...drugVisual(drugId, d) };
}

// Assemble the ordered input list (base, splice, optional splice-2) from a payload
// of { drug, qty } slots. Returns null if any slot names an unknown drug.
function buildInputs(payload, cache) {
  const slots = [payload.base, payload.splice, payload.splice2].filter(s => s && s.drug);
  const inputs = [];
  for (const s of slots) {
    const si = spliceInput(s.drug, cache);
    if (!si) return null;
    inputs.push({ ...si, qty: clampQty(s.qty), drug: s.drug, itemId: cache[s.drug]?.item_id, name: cache[s.drug]?.name });
  }
  return inputs;
}

// The 3rd (splice-2) slot unlocks at near-max Chemistry AND a body of splicing
// experience — or whenever the `splice_3way_test` dev tunable is flipped on.
async function allow3way(player) {
  if (getTunable('splice_3way_test', false)) return true;
  if (await effectiveSkill(player, SYNTH_SKILL) < THREE_WAY_CHEM) return false;
  return (parseInt(await getFlag('player', 'splice_count', player), 10) || 0) >= THREE_WAY_SPLICES;
}

// Splice minigame stage keys (internal; 'charge' is the player-facing "Decant").
const SPLICE_STAGES = ['charge', 'mix', 'pour', 'stir', 'heat', 'rhythm'];
// Which stages a player has an automation rig for (carried item tagged `automates:<stage>`).
// The `splice_auto_test` dev tunable force-automates every stage. An automated stage
// passes at a Chemistry-scaled score instead of being played by hand.
async function automatedStages(player) {
  if (getTunable('splice_auto_test', false)) return SPLICE_STAGES.slice();
  const { rows } = await query(
    `SELECT DISTINCT i.tags->>'automates' AS stage FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'automates')`, [player.id]).catch(() => ({ rows: [] }));
  return rows.map(r => r.stage).filter(s => SPLICE_STAGES.includes(s));
}

// Live preview as the player designs (reuses composeSplice — authoritative math).
async function cmdSplicePreview(args, raw, player) {
  let payload; try { payload = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf8')); } catch { return { type: 'noop' }; }
  const inputs = buildInputs(payload, getDrugCache());
  if (!inputs || inputs.length < 2) return { type: 'splice_preview', ok: false };
  const comp = composeSplice(inputs);
  return { type: 'splice_preview', ok: true, difficulty: comp.difficulty, instability: comp.instability, doseWeight: comp.doseWeight, odThreshold: comp.odThreshold, outputQty: comp.outputQty, warnings: comp.warnings, summary: summariseComposed(comp.effects) };
}

async function cmdSpliceBegin(args, raw, player, broadcast) {
  let payload;
  try { payload = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf8')); } catch { return { type: 'error', message: 'Malformed splice payload.' }; }
  const name = String(payload.name || '').slice(0, 40).trim() || null;
  const cache = getDrugCache();
  const inputs = buildInputs(payload, cache);
  if (!inputs || inputs.length < 2) return { type: 'error', message: 'Pick a base drug and a splice drug.' };
  if (inputs.length > 3) inputs.length = 3;
  if (new Set(inputs.map(i => i.drug)).size !== inputs.length) return { type: 'error', message: 'Each slot needs a different drug.' };
  if (inputs.length === 3 && !(await allow3way(player))) return { type: 'error', message: "Three-way splicing is master's work — Chemistry 10 and a lot of splices logged." };
  if (inputs.some(i => !i.itemId)) return { type: 'error', message: 'A source drug is missing its item.' };

  const eff = await effectiveSkill(player, SYNTH_SKILL);
  if (eff < SPLICE_MIN_SKILL) return { type: 'error', message: `You need Chemistry ${SPLICE_MIN_SKILL}+ to splice.` };
  const ws = await findWorkspace({ requires_station: 'chem_lab' }, player);
  if (!ws || ws.mode !== 'lab') return { type: 'error', message: 'You need a chem lab to splice.' };

  const comp = composeSplice(inputs);
  const outputQty = comp.outputQty;

  // Source drugs scale with the batch (each slot's quantity), but the Stabilizer
  // is a fixed per-run overhead — one stabilizes the whole reaction, not each
  // dose. So bulk runs amortize their (rare, costly) stabilizer across the batch,
  // trading the quality/instability penalty of a big batch for a lower per-dose
  // cost. Require enough across the player's stacks.
  const need = inputs.map(i => ({ itemId: i.itemId, qty: i.qty, label: i.name }));
  need.push({ itemId: STABILIZER_ITEM, qty: 1, label: 'Stabilizer' });
  const inv = await playerInventory(player.id);
  for (const n of need) {
    const have = inv.filter(v => v.item_id === n.itemId).reduce((s, v) => s + v.quantity, 0);
    if (have < n.qty) return { type: 'error', message: `You need ${n.qty}× ${n.label} for this batch — you have ${have}.` };
  }

  const token = randomUUID().slice(0, 8);
  const sources = inputs.map(i => ({ drug: i.drug, qty: i.qty }));   // for reclaim (break back to source drugs)
  pendingSplice.set(player.id, { token, comp, name: name || `${inputs[0].name} splice`, need, outputQty, sources, ts: Date.now() });

  // Automation rigs auto-clear their stages at a Chemistry-scaled score (50→95%).
  const automated = await automatedStages(player);
  const autoScore = Math.round(50 + Math.max(0, Math.min(10, eff)) / 10 * 45);

  return {
    type: 'synth_minigame', kind: 'splice', token,
    recipeName: name || `${inputs[0].name} splice`,
    difficulty: comp.difficulty, hard: true, instability: comp.instability, workspace: ws.label,
    automated, autoScore,
  };
}

// Report card: the blended minigame+skill margin as a letter grade → potency.
// A marginal-but-successful splice is a D; below that is an F (a bad batch); a
// catastrophe (margin < −4) is off the bottom of the scale entirely.
const SPLICE_GRADES = [
  { min: 8, letter: 'A+', potency: 1.70 },
  { min: 6, letter: 'A',  potency: 1.45 },
  { min: 4, letter: 'B',  potency: 1.20 },
  { min: 2, letter: 'C',  potency: 1.00 },
  { min: 0, letter: 'D',  potency: 0.80 },
];
const spliceGrade = (margin) => SPLICE_GRADES.find(g => margin >= g.min) || null;

async function cmdSpliceResolve(args, raw, player, broadcast) {
  const token = args[0];
  const score = Math.max(0, Math.min(100, parseInt(args[1], 10) || 0));
  const p = pendingSplice.get(player.id);
  pendingSplice.delete(player.id);
  if (!p || p.token !== token || Date.now() - p.ts > PENDING_TTL_MS) return { type: 'noop' };

  const inv = await playerInventory(player.id);
  const plan = [];
  for (const n of p.need) {
    const stacks = inv.filter(v => v.item_id === n.itemId).sort((a, b) => a.quantity - b.quantity);
    const have = stacks.reduce((s, v) => s + v.quantity, 0);
    if (have < n.qty) return { type: 'error', message: 'Something you needed is gone — the splice collapses.' };
    let remaining = n.qty;
    for (const st of stacks) { if (remaining <= 0) break; const take = Math.min(remaining, st.quantity); plan.push({ invId: st.id, take, currentQty: st.quantity }); remaining -= take; }
  }
  const consume = async (q) => {
    for (const c of plan) {
      if (c.take >= c.currentQty) await q('DELETE FROM player_inventory WHERE id=$1', [c.invId]);
      else await q('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [c.take, c.invId]);
    }
  };

  const skillResult = await skillCheck(player, SYNTH_SKILL, p.comp.difficulty);
  const minigameBonus = Math.round((score / 100 - 0.5) * 4); // -2..+2 (bounded, see cook)
  const raw2 = skillResult.margin + minigameBonus + 2; // +2 real-lab bonus
  const effectiveMargin = raw2 - Math.round(p.comp.instability * 3); // instability makes it harder to land
  const catastrophic = effectiveMargin < -4;

  // Lethal blowback — bigger than a normal cook botch, scales with instability.
  if (catastrophic) {
    await withTransaction(consume);
    const dmg = 25 + Math.round(p.comp.instability * 30);
    const hp = Math.max(0, (player.hp || 0) - dmg);
    const sanity = Math.max(0, (player.sanity || 0) - 15);
    player.hp = hp; player.sanity = sanity;
    query('UPDATE players SET hp=$1, sanity=$2 WHERE id=$3', [hp, sanity, player.id]).catch(() => {});
    if (hp <= 0) {
      broadcast(null, { type: 'output', message: `<span class="overdose-warning">The splice goes critical — a white flash, a wall of heat. It takes you with it.</span>`, player_update: { hp, sanity } }, null, player.id);
      const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
      await handlePlayerDeath(player, null, { type: 'drug', label: 'Killed by a splice gone critical' });
      return { type: 'noop' };
    }
    return { type: 'output', message: `<span class="overdose-warning">The reaction blows back in your face — the compound is destroyed and you're badly burned (−${dmg} HP).</span>`, player_update: { hp, sanity } };
  }

  const insertCompound = async (q, customData, qty = 1) =>
    q('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1,$2,$3,$4,1.0,$5)',
      [randomUUID(), player.id, COMPOUND_ITEM, qty, JSON.stringify(customData)]);

  const grade = spliceGrade(effectiveMargin);   // null when margin < 0 → F, a bad batch

  const batch = p.outputQty || 1;

  // Bad batch (grade F) — you still bottle the batch, but it's degraded and nasty.
  if (!grade) {
    const cd = { synthesized: true, spliced: true, potency: 0.4, name: `unstable ${p.name}`, effects: badBatch(p.comp.effects), overdose_threshold: Math.max(2, p.comp.odThreshold - 1), dose_weight: p.comp.doseWeight, duration_seconds: 300, form: p.comp.form, color: p.comp.color, packaged: true, grade: 'F', sources: p.sources };
    await withTransaction(async (q) => { await consume(q); await insertCompound(q, cd, batch); });
    broadcast?.(null, { type: 'output', message: `<span class="msg-system">The splice curdles into something wrong — cloudy, and it smells of solvent and regret. The lab seals ${batch > 1 ? `${batch}× ` : ''}<span class="item">unstable ${p.name}</span> into a climate crate anyway. <span class="text-dim">(unseal to use)</span></span>` }, null, player.id);
    return { type: 'splice_report', grade: 'F', outcome: 'badbatch', name: p.name, potency: 40, doses: p.comp.doseWeight, batch, sealed: true, note: 'Curdled — degraded effects, and it bites back.' };
  }

  // Success — grade sets the potency, capped by the recipe's instability (overload caps power).
  const potencyCap = Math.max(0.6, 1.7 - p.comp.instability * 0.5);
  const potency = Math.max(0.5, Math.min(grade.potency, potencyCap));
  const capped = potency < grade.potency - 0.001;
  const cd = { synthesized: true, spliced: true, potency, name: p.name, effects: p.comp.effects, overdose_threshold: p.comp.odThreshold, dose_weight: p.comp.doseWeight, duration_seconds: 300, form: p.comp.form, color: p.comp.color, packaged: true, grade: grade.letter, sources: p.sources };
  await withTransaction(async (q) => { await consume(q); await insertCompound(q, cd, batch); });
  await awardSkillUse(player.id, SYNTH_SKILL, skillResult.margin);
  // A clean splice logs toward the 3-way (splice-2 slot) unlock.
  await setFlag('player', 'splice_count', (parseInt(await getFlag('player', 'splice_count', player), 10) || 0) + 1, player);

  const pct = Math.round(potency * 100);
  broadcast?.(null, { type: 'output', message: `<span class="ip-gain">It holds.</span> You splice ${batch > 1 ? `${batch}× ` : ''}<span class="item">${p.name}</span> — grade <b>${grade.letter}</b>, <b>${pct}%</b> potency. <span class="text-dim">Sealed in a climate crate (unseal to use).</span>` }, null, player.id);
  return {
    type: 'splice_report', grade: grade.letter, outcome: 'success', name: p.name, potency: pct, doses: p.comp.doseWeight, batch, sealed: true,
    note: capped ? 'Instability capped the yield — a cleaner recipe would hit harder.'
      : (p.comp.doseWeight > 1 ? `Heavy blend — counts as ${p.comp.doseWeight} doses, go easy.` : ''),
  };
}

// Dev-only: feel a cook FAMILY minigame (the current work-phase + QUENCH beat)
// straight away — no recipe, reagents, skill, or lab. Verdict on-screen; the
// resolve is a harmless no-op. Pick any of the four families to exercise each.
//   .cooktest              → wet family, difficulty 6
//   .cooktest solids       → the press minigame
//   .cooktest gas 9        → gas (pressure-vent) at difficulty 9
//   families: wet · solids · gas · botanical
const DEV_ROLES = ['admin', 'dev', 'builder', 'designer'];
const COOK_FAMILIES = ['wet', 'solids', 'gas', 'botanical'];
function cmdCookTest(args, raw, player) {
  if (!DEV_ROLES.includes(player.role)) return { type: 'error', message: 'Dev command.' };
  let family = 'wet', difficulty = null;
  for (const t of args.filter(Boolean)) {
    if (/^\d+$/.test(t)) difficulty = parseInt(t, 10);
    else if (COOK_FAMILIES.includes(t.toLowerCase())) family = t.toLowerCase();
  }
  const diff = Math.max(1, Math.min(10, difficulty || 6));
  return { type: 'synth_minigame', kind: 'test', family, difficulty: diff, recipeName: `TEST COOK · ${family.toUpperCase()}`, workspace: 'test bench' };
}

// Dev-only: open the FULL splice designer seeded from real drugs (live preview
// computes for real) in test mode — the whole current experience: base+splice(+2)
// picker panels, per-slot quantity/batching (test drugs are stackable), the full
// DECANT→MIX→POUR→STIR→HEAT→SET orchestra, and the A+…F report-card verdict at the
// end. Runs client-side with no inventory / Stabilizer / lab, and produces nothing.
// Requires ≥2 drugs with effects in the cache (seed-drugs).
function cmdSpliceTest(args, raw, player) {
  if (!DEV_ROLES.includes(player.role)) return { type: 'error', message: 'Dev command.' };
  const cache = getDrugCache();
  const drugs = [];
  for (const d of Object.values(cache)) {
    if (d.id === COMPOUND_DRUG) continue;
    const e = normEff(d.effects);
    const blocks = {};
    if (Object.keys(e.instant).length) blocks.instant = summariseInstant(e.instant);
    if (e.phases) blocks.phases = summarisePhases(e.phases);
    if (e.hallucination) blocks.hallucination = summariseHall(e.hallucination);
    if (Object.keys(blocks).length) drugs.push({ drug: d.id, name: d.name, blocks, ...drugVisual(d.id, d), known: 0.85, count: 20 });
    if (drugs.length >= 6) break;
  }
  if (drugs.length < 2) return { type: 'error', message: 'Need ≥2 drugs with effects in the cache — run seed-drugs.js first.' };
  return { type: 'splice_designer', drugs, minSkill: SPLICE_MIN_SKILL, baseDifficulty: SPLICE_BASE_DIFF, hasStabilizer: true, test: true, allow3way: true };
}

// ── reclaim: reverse-engineer a drug back to materials ────────────────────────
// A spliced compound breaks back into the source DRUGS it was made from (recovery
// scaled by its stored grade); a plain cooked drug breaks back into its RAW stock
// (recovery scaled by potency). Both need a chem lab; a good Chemistry roll pulls
// a little more back. Loss scales inverse to quality — an F batch is nearly a wash.
const RECLAIM_DIFF = 5;
const GRADE_RECOVERY = { 'A+': 0.90, 'A': 0.80, 'B': 0.65, 'C': 0.50, 'D': 0.35, 'F': 0.15 };
const rawItemFor = (drugId) => 'item_raw_' + String(drugId || '').replace(/^drug_/, '');

// Add qty of a plain (non-instanced) item to the player, stacking where possible.
async function stackAdd(q, playerId, itemId, qty) {
  const { rows } = await q(`SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL AND (custom_data IS NULL OR custom_data='{}'::jsonb) LIMIT 1`, [playerId, itemId]);
  if (rows.length) await q('UPDATE player_inventory SET quantity=quantity+$1 WHERE id=$2', [qty, rows[0].id]);
  else await q('INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)', [randomUUID(), playerId, itemId, qty]);
}

// reclaim [name] — break a drug you're carrying back down over the lab bench.
async function cmdReclaim(args, raw, player) {
  const ws = await findWorkspace({ requires_station: 'chem_lab' }, player);
  if (!ws || ws.mode !== 'lab') return { type: 'error', message: 'Reverse-engineering a batch needs a real chem lab.' };
  const hint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT pi.id AS inv_id, pi.quantity, pi.custom_data, i.name, d.id AS drug_id
               FROM player_inventory pi JOIN items i ON i.id = pi.item_id JOIN drugs d ON d.item_id = i.id
              WHERE pi.player_id = $1`;
  if (hint) { sql += ` AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2)`; params.push(`%${hint}%`); }
  sql += ` ORDER BY i.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const row = rows[0];
  if (!row) return { type: 'error', message: hint ? `You're not carrying a "${hint}" to break down.` : "Reclaim what? Name a drug you're carrying." };
  const cd = row.custom_data || {};
  if (cd.packaged) return { type: 'error', message: "It's sealed in a crate — unseal it first." };

  const chk = await skillCheck(player, SYNTH_SKILL, RECLAIM_DIFF);
  await awardSkillUse(player.id, SYNTH_SKILL, chk.margin);
  const skillMul = Math.max(0.6, Math.min(1.15, 0.85 + chk.margin * 0.02));
  const cache = getDrugCache();
  const qtyN = row.quantity || 1;

  // Spliced compound → the source drugs, scaled by grade.
  if (cd.spliced) {
    if (!Array.isArray(cd.sources) || !cd.sources.length) return { type: 'error', message: "The lab can't read what went into this batch (too old, or corrupted)." };
    const quality = GRADE_RECOVERY[cd.grade] ?? 0.4;
    const gives = [];
    for (const s of cd.sources) {
      const itemId = cache[s.drug]?.item_id; if (!itemId) continue;
      const amt = Math.max(0, Math.round((s.qty || 1) * quality * skillMul));
      if (amt > 0) gives.push({ itemId, amt, name: cache[s.drug]?.name || s.drug });
    }
    if (!gives.length) return { type: 'error', message: `A grade-${cd.grade || '?'} batch is too degraded — nothing usable comes back.` };
    await withTransaction(async (q) => {
      await q('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);
      for (const g of gives) await stackAdd(q, player.id, g.itemId, g.amt);
    });
    return { type: 'output', message: `<span class="ambient">You crack the compound back down over the bench — grade <b>${cd.grade}</b>, so you pull ${gives.map(g => `${g.amt}× ${g.name}`).join(', ')} out of it.</span>` };
  }

  // Cooked / plain drug → its raw stock, scaled by potency.
  const rawId = rawItemFor(row.drug_id);
  const rawEx = (await query('SELECT name FROM items WHERE id=$1', [rawId])).rows[0];
  if (!rawEx) return { type: 'error', message: `There's no raw form to break ${row.name} down into.` };
  const potNorm = Math.max(0.2, Math.min(1.2, Number(cd.potency) || 1));
  const amt = Math.max(0, Math.round(qtyN * potNorm * skillMul));
  if (!amt) return { type: 'error', message: 'Too little to reclaim — the process would waste it all.' };
  await withTransaction(async (q) => {
    await q('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);
    await stackAdd(q, player.id, rawId, amt);
  });
  return { type: 'output', message: `<span class="ambient">You cook ${row.name} back down to base stock — ${amt}× ${rawEx.name} reclaimed.</span>` };
}

// unseal [name] — pop a climate-crate seal off a packaged batch so it can be
// used again (until then it's frozen and search-proof — "secure until you move it").
async function cmdUnseal(args, raw, player) {
  const hint = args.join(' ').trim();
  const params = [player.id];
  let sql = `SELECT pi.id AS inv_id, pi.custom_data, i.name FROM player_inventory pi JOIN items i ON i.id = pi.item_id
             WHERE pi.player_id = $1 AND (pi.custom_data->>'packaged') = 'true'`;
  if (hint) { sql += ` AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2)`; params.push(`%${hint}%`); }
  sql += ` ORDER BY i.name LIMIT 1`;
  const { rows } = await query(sql, params);
  const row = rows[0];
  if (!row) return { type: 'error', message: hint ? `You've nothing sealed matching "${hint}".` : "You've nothing sealed in a climate crate." };
  await query(`UPDATE player_inventory SET custom_data = custom_data - 'packaged' WHERE id = $1`, [row.inv_id]);
  const nm = row.custom_data?.name || row.name;
  return { type: 'output', message: `<span class="ambient">You break the climate crate's seal — the ${nm} is loose and live now. Watch who's looking.</span>` };
}

export const commands = {
  cook: cmdCook,
  synthesize: cmdCook,
  synthresolve: cmdSynthResolve,
  splice: cmdSplice,
  splicepreview: cmdSplicePreview,
  splicebegin: cmdSpliceBegin,
  spliceresolve: cmdSpliceResolve,
  unseal: cmdUnseal,
  reclaim: cmdReclaim,
  cooktest: cmdCookTest,
  splicetest: cmdSpliceTest,
};
