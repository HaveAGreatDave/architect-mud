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
 * (quality bonus) or with a cook kit anywhere (penalty). Reuses the crafting
 * recipe cache + the 2d8−2d8 skillCheck; recipes/reagents/labs are content.
 */
import { query, withTransaction } from '../../server/models/db.js';
import { getRecipeCache, findRecipeByName } from '../../server/engine/crafting.js';
import { skillCheck, awardSkillUse, skillStatBonus, effectiveSkill } from '../../server/engine/skills.js';
import { getDrugCache } from '../../server/engine/drugs.js';
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
  return Object.values(getRecipeCache()).filter(r => r.skill_id === SYNTH_SKILL);
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

// Chem-lab furniture in the zone, or a carried cook kit, or nothing.
async function findWorkspace(recipe, player) {
  const wantStation = recipe.requires_station || null;
  if (wantStation) {
    const { rows } = await query(
      `SELECT flags FROM furniture WHERE zone_id = $1 AND flags->>'crafting_station' = $2 LIMIT 1`,
      [player.current_zone, wantStation]
    );
    if (rows.length) {
      const q = rows[0].flags?.station_quality;
      const bonus = q === 'pristine' ? 4 : q === 'refined' ? 2 : 0;
      return { mode: 'lab', contextBonus: bonus, label: 'the lab' };
    }
  }
  const { rows: kit } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'cook_kit') LIMIT 1`,
    [player.id]
  );
  if (kit.length) return { mode: 'kit', contextBonus: -3, label: 'your cook kit' };
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
    return { type: 'error', message: `You need a ${need} or a cook kit to attempt this.` };
  }

  const drug = drugForOutput(recipe); const tier = cookTier(drug); const family = cookFamily(drug); const difficulty = cookDiff(tier);
  const nonce = randomUUID().slice(0, 8); // one-shot token: the client echoes it on resolve, so a cook can't be resolved without being armed here
  pendingSynth.set(player.id, { recipeId: recipe.id, nonce, contextBonus: ws.contextBonus, mode: ws.mode, tier, family, difficulty, ts: Date.now() });
  return {
    type: 'synth_minigame',
    recipeId: recipe.id, nonce,
    recipeName: drug?.name || recipe.name,
    family, tier, difficulty,
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
// lab. Consumes one dose of each source drug + a Stabilizer. The composed
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

// Quantity-weighted blend of two effect-mod maps. Weights are exponential in the
// input quantities (see composeSplice), so the majority side dominates more than
// its raw share — the "proportion of side-effects" the ratio controls. Opposite
// signs on a shared stat count as antagonism (volatility).
function blendMods(a, b, wa, wb) {
  const obj = {}; let conflicts = 0;
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const av = Number(a?.[k]) || 0, bv = Number(b?.[k]) || 0;
    if (av && bv && Math.sign(av) !== Math.sign(bv)) conflicts++;
    const v = Math.round(av * wa + bv * wb);
    if (v !== 0) obj[k] = v;
    else if (av || bv) obj[k] = (av * wa + bv * wb) >= 0 ? 1 : -1;   // don't let a real effect round away to nothing
  }
  return { obj, conflicts };
}

// Weighted blend of two hex colours (w1 = base's share). Stored on the compound
// so it reads as a genuine mix; a future re-splice would inherit this one colour.
function hexBlend(c1, c2, w1) {
  const parse = (h) => { h = String(h || '#888888').replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
  const [r1, g1, b1] = parse(c1), [r2, g2, b2] = parse(c2), w2 = 1 - w1;
  const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + to(r1 * w1 + r2 * w2) + to(g1 * w1 + g2 * w2) + to(b1 * w1 + b2 * w2);
}

// Compose a BASE drug with a SPLICE drug at chosen quantities. All effect layers
// merge (no per-block picking); each side's magnitude is weighted by quantity²
// (exponential), so the ratio you use sets the proportion. Output quantity is the
// higher of the two; output form is the majority-quantity input's (tie → base);
// output colour is the weighted blend. Difficulty/instability rise with batch size.
// `base`/`splice` are { eff, form, color }.
function composeSplice(base, splice, baseQty, spliceQty) {
  const b = normEff(base.eff), s = normEff(splice.eff);
  const wbRaw = baseQty * baseQty, wsRaw = spliceQty * spliceQty, tot = (wbRaw + wsRaw) || 1;
  const wBase = wbRaw / tot, wSplice = wsRaw / tot;
  let antagonism = 0;

  const ri = blendMods(b.instant, s.instant, wBase, wSplice); antagonism += ri.conflicts;
  const composed = {
    instant: ri.obj, phases: null, hallucination: null,
    tolerance: b.tolerance ?? s.tolerance, withdrawal: b.withdrawal ?? s.withdrawal, overdose: b.overdose ?? s.overdose,
  };
  if (b.phases || s.phases) {
    if (b.phases && s.phases) {
      const rp = blendMods(b.phases.peak_mods || {}, s.phases.peak_mods || {}, wBase, wSplice); antagonism += rp.conflicts;
      composed.phases = { ...b.phases, peak_mods: rp.obj };
      for (const key of ['comeup_seconds', 'peak_seconds', 'comedown_seconds']) composed.phases[key] = Math.max(b.phases[key] || 0, s.phases[key] || 0);
    } else composed.phases = clone(b.phases || s.phases);
  }
  if (b.hallucination || s.hallucination) {
    if (b.hallucination && s.hallucination) {
      composed.hallucination = clone(b.hallucination);
      composed.hallucination.intensity = Math.min(1, (b.hallucination.intensity || 0.5) * wBase + (s.hallucination.intensity || 0.5) * wSplice);
      composed.hallucination.events = [...(b.hallucination.events || []), ...(s.hallucination.events || [])].slice(0, 12);
      if (s.hallucination.mode === 'dreamzone') { composed.hallucination.mode = 'dreamzone'; composed.hallucination.dreamzone_id = composed.hallucination.dreamzone_id || s.hallucination.dreamzone_id; }
    } else composed.hallucination = clone(b.hallucination || s.hallucination);
  }

  const outputQty = Math.max(baseQty, spliceQty);
  const form = baseQty >= spliceQty ? base.form : splice.form;   // higher quantity wins, deterministic
  const color = hexBlend(base.color, splice.color, wBase);
  const totalAbs = absSum(composed.phases?.peak_mods) + absSum(composed.instant);
  const hallCount = composed.hallucination ? 1 : 0;
  const difficulty = Math.round(SPLICE_BASE_DIFF + 1.2 * (outputQty - 1) + 1.5 * antagonism + totalAbs / 12);
  const instability = Math.min(1, 0.10 * (outputQty - 1) + 0.18 * antagonism + 0.12 * hallCount + totalAbs / 120);
  const doseWeight = 2;                  // a base+splice blend counts as two doses
  const odThreshold = doseWeight + 2;    // first dose usable; stacking doses ODs faster than a plain drug
  const warnings = [];
  if (antagonism > 0) warnings.push('Antagonistic effects fight each other — volatile.');
  if (outputQty >= 4) warnings.push('Big batch — harder to hold steady, and it ODs fast.');
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

  return { type: 'splice_designer', drugs, minSkill: SPLICE_MIN_SKILL, baseDifficulty: SPLICE_BASE_DIFF, hasStabilizer: stabilizerCount > 0, stabilizerCount };
}

function summariseComposed(e) {
  const lines = [];
  if (e.instant && Object.keys(e.instant).length) lines.push('Instant: ' + summariseInstant(e.instant));
  if (e.phases) lines.push('Phased: ' + summarisePhases(e.phases));
  if (e.hallucination) lines.push('Trip: ' + summariseHall(e.hallucination));
  return lines.join('\n') || 'No effects selected.';
}

// Build the {eff, form, color} shape composeSplice wants from a cached drug.
function spliceInput(drugId, cache) {
  const d = cache[drugId];
  if (!d) return null;
  return { eff: d.effects, ...drugVisual(drugId, d) };
}

// Live preview as the player designs (reuses composeSplice — authoritative math).
async function cmdSplicePreview(args, raw, player) {
  let payload; try { payload = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf8')); } catch { return { type: 'noop' }; }
  const cache = getDrugCache();
  const base = spliceInput(payload.base?.drug, cache), splice = spliceInput(payload.splice?.drug, cache);
  if (!base || !splice) return { type: 'splice_preview', ok: false };
  const comp = composeSplice(base, splice, clampQty(payload.base?.qty), clampQty(payload.splice?.qty));
  return { type: 'splice_preview', ok: true, difficulty: comp.difficulty, instability: comp.instability, doseWeight: comp.doseWeight, odThreshold: comp.odThreshold, outputQty: comp.outputQty, warnings: comp.warnings, summary: summariseComposed(comp.effects) };
}

async function cmdSpliceBegin(args, raw, player, broadcast) {
  let payload;
  try { payload = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf8')); } catch { return { type: 'error', message: 'Malformed splice payload.' }; }
  const baseId = payload.base?.drug, spliceId = payload.splice?.drug;
  const name = String(payload.name || '').slice(0, 40).trim() || null;

  const cache = getDrugCache();
  const bd = cache[baseId], sd = cache[spliceId];
  if (!bd || !sd) return { type: 'error', message: 'Pick a base drug and a splice drug.' };
  if (baseId === spliceId) return { type: 'error', message: "You can't splice a drug with itself." };
  const eff = await effectiveSkill(player, SYNTH_SKILL);
  if (eff < SPLICE_MIN_SKILL) return { type: 'error', message: `You need Chemistry ${SPLICE_MIN_SKILL}+ to splice.` };
  const ws = await findWorkspace({ requires_station: 'chem_lab' }, player);
  if (!ws || ws.mode !== 'lab') return { type: 'error', message: 'You need a chem lab to splice.' };

  const baseQty = clampQty(payload.base?.qty), spliceQty = clampQty(payload.splice?.qty);
  const comp = composeSplice(spliceInput(baseId, cache), spliceInput(spliceId, cache), baseQty, spliceQty);
  const outputQty = comp.outputQty;

  // Inputs scale with the batch: baseQty of the base, spliceQty of the splice, and
  // one stabilizer per finished dose. Require enough across the player's stacks.
  if (!bd.item_id || !sd.item_id) return { type: 'error', message: 'A source drug is missing its item.' };
  const need = [
    { itemId: bd.item_id, qty: baseQty, label: bd.name },
    { itemId: sd.item_id, qty: spliceQty, label: sd.name },
    { itemId: STABILIZER_ITEM, qty: outputQty, label: 'Stabilizer' },
  ];
  const inv = await playerInventory(player.id);
  for (const n of need) {
    const have = inv.filter(v => v.item_id === n.itemId).reduce((s, v) => s + v.quantity, 0);
    if (have < n.qty) return { type: 'error', message: `You need ${n.qty}× ${n.label} for this batch — you have ${have}.` };
  }

  const token = randomUUID().slice(0, 8);
  pendingSplice.set(player.id, { token, comp, name: name || `${bd.name} splice`, need, outputQty, ts: Date.now() });

  return {
    type: 'synth_minigame', kind: 'splice', token,
    recipeName: name || `${bd.name} splice`,
    difficulty: comp.difficulty, hard: true, instability: comp.instability, workspace: ws.label,
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
    const cd = { synthesized: true, spliced: true, potency: 0.4, name: `unstable ${p.name}`, effects: badBatch(p.comp.effects), overdose_threshold: Math.max(2, p.comp.odThreshold - 1), dose_weight: p.comp.doseWeight, duration_seconds: 300, form: p.comp.form, color: p.comp.color };
    await withTransaction(async (q) => { await consume(q); await insertCompound(q, cd, batch); });
    broadcast?.(null, { type: 'output', message: `<span class="msg-system">The splice curdles into something wrong — cloudy, and it smells of solvent and regret. You bottle ${batch > 1 ? `${batch}× ` : ''}<span class="item">unstable ${p.name}</span> anyway.</span>` }, null, player.id);
    return { type: 'splice_report', grade: 'F', outcome: 'badbatch', name: p.name, potency: 40, doses: p.comp.doseWeight, batch, note: 'Curdled — degraded effects, and it bites back.' };
  }

  // Success — grade sets the potency, capped by the recipe's instability (overload caps power).
  const potencyCap = Math.max(0.6, 1.7 - p.comp.instability * 0.5);
  const potency = Math.max(0.5, Math.min(grade.potency, potencyCap));
  const capped = potency < grade.potency - 0.001;
  const cd = { synthesized: true, spliced: true, potency, name: p.name, effects: p.comp.effects, overdose_threshold: p.comp.odThreshold, dose_weight: p.comp.doseWeight, duration_seconds: 300, form: p.comp.form, color: p.comp.color };
  await withTransaction(async (q) => { await consume(q); await insertCompound(q, cd, batch); });
  await awardSkillUse(player.id, SYNTH_SKILL, skillResult.margin);

  const pct = Math.round(potency * 100);
  broadcast?.(null, { type: 'output', message: `<span class="ip-gain">It holds.</span> You splice ${batch > 1 ? `${batch}× ` : ''}<span class="item">${p.name}</span> — grade <b>${grade.letter}</b>, <b>${pct}%</b> potency.` }, null, player.id);
  return {
    type: 'splice_report', grade: grade.letter, outcome: 'success', name: p.name, potency: pct, doses: p.comp.doseWeight, batch,
    note: capped ? 'Instability capped the yield — a cleaner recipe would hit harder.'
      : (p.comp.doseWeight > 1 ? `Heavy blend — counts as ${p.comp.doseWeight} doses, go easy.` : ''),
  };
}

// Dev-only: launch the cook/splice minigame straight away with no recipe,
// reagents, skill, or lab — just to see/feel it. The on-screen verdict shows
// your score; the resolve is a harmless no-op (no pending entry).
//   .cooktest            → normal cook minigame, difficulty 6
//   .cooktest 12         → difficulty 12
//   .cooktest 14 hard    → the harder splice-style minigame
const DEV_ROLES = ['admin', 'dev', 'builder', 'designer'];
function cmdCookTest(args, raw, player) {
  if (!DEV_ROLES.includes(player.role)) return { type: 'error', message: 'Dev command.' };
  const hard = /\b(hard|splice)\b/i.test(raw);
  const difficulty = Math.max(1, Math.min(hard ? 16 : 10, parseInt(args[0], 10) || (hard ? 12 : 6)));
  return {
    type: 'synth_minigame', kind: 'test', recipeId: '__test__',
    difficulty, hard, recipeName: hard ? 'TEST SPLICE' : 'TEST COOK', workspace: 'test bench',
  };
}

// Dev-only: open the SPLICE designer seeded from real drugs (so the live
// preview computes for real), in test mode — "Synthesize" launches the hard
// minigame client-side without needing inventory / a Stabilizer / a lab, and
// produces nothing. Requires ≥2 drugs with effects in the cache (seed-drugs).
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
    if (Object.keys(blocks).length) drugs.push({ drug: d.id, name: d.name, blocks, ...drugVisual(d.id, d), known: 0.85 });
    if (drugs.length >= 6) break;
  }
  if (drugs.length < 2) return { type: 'error', message: 'Need ≥2 drugs with effects in the cache — run seed-drugs.js first.' };
  return { type: 'splice_designer', drugs, minSkill: SPLICE_MIN_SKILL, baseDifficulty: SPLICE_BASE_DIFF, hasStabilizer: true, test: true };
}

export const commands = {
  cook: cmdCook,
  synthesize: cmdCook,
  synthresolve: cmdSynthResolve,
  splice: cmdSplice,
  splicepreview: cmdSplicePreview,
  splicebegin: cmdSpliceBegin,
  spliceresolve: cmdSpliceResolve,
  cooktest: cmdCookTest,
  splicetest: cmdSpliceTest,
};
