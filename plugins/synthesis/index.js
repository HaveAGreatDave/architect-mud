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
const pendingSynth = new Map(); // playerId -> { recipeId, contextBonus, mode, ts }

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
    const inv = await playerInventory(player.id);
    const lines = recipes.map(r => {
      const res = resolveIngredients(r, inv);
      const ready = !res.missing;
      const need = (r.ingredients || []).map(ing => `${ing.quantity}x ${ing.item_id.replace(/^item_/, '').replace(/_/g, ' ')}`).join(', ');
      return `<span class="${ready ? 'safe' : 'system'}">${ready ? '✓' : '·'} ${r.name}</span> — ${need}`;
    });
    return { type: 'output', message: `<span class="msg-system">You can cook:</span>\n${lines.join('\n')}\n<span class="msg-system">Use "cook &lt;name&gt;" at a chem lab or with a cook kit.</span>` };
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

  pendingSynth.set(player.id, { recipeId: recipe.id, contextBonus: ws.contextBonus, mode: ws.mode, ts: Date.now() });
  return {
    type: 'synth_minigame',
    recipeId: recipe.id,
    recipeName: recipe.name,
    difficulty: recipe.base_difficulty ?? 5,
    workspace: ws.label,
  };
}

function qualityFor(margin) {
  if (margin >= 6) return 'pristine';
  if (margin >= 3) return 'refined';
  if (margin < 0) return 'scrap';
  return 'common';
}

async function cmdSynthResolve(args, raw, player, broadcast) {
  const recipeId = args[0];
  const score = Math.max(0, Math.min(100, parseInt(args[1], 10) || 0));
  const pending = pendingSynth.get(player.id);
  pendingSynth.delete(player.id);
  if (!pending || pending.recipeId !== recipeId || Date.now() - pending.ts > PENDING_TTL_MS) return { type: 'noop' };

  const recipe = getRecipeCache()[recipeId];
  if (!recipe) return { type: 'error', message: 'The recipe slips out of your head.' };

  const inv = await playerInventory(player.id);
  const res = resolveIngredients(recipe, inv);
  if (res.missing) return { type: 'error', message: "You're missing something now — the cook falls apart." };
  const toConsume = res.toConsume;

  const skillResult = await skillCheck(player, SYNTH_SKILL, recipe.base_difficulty ?? 5);
  const minigameBonus = Math.round((score / 100 - 0.5) * 8); // -4..+4
  const finalMargin = skillResult.margin + minigameBonus + pending.contextBonus;
  const success = finalMargin >= 0;
  const catastrophic = finalMargin < -5;

  const consume = async (q) => {
    for (const c of toConsume) {
      if (c.currentQty <= c.quantity) await q('DELETE FROM player_inventory WHERE id=$1', [c.invId]);
      else await q('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [c.quantity, c.invId]);
    }
  };

  if (catastrophic) {
    await withTransaction(consume);
    // Toxic byproduct — a flash of heat and acrid smoke.
    const hp = Math.max(0, (player.hp || 0) - 20);
    const sanity = Math.max(0, (player.sanity || 0) - 10);
    player.hp = hp; player.sanity = sanity;
    query('UPDATE players SET hp=$1, sanity=$2 WHERE id=$3', [hp, sanity, player.id]).catch(() => {});
    if (hp <= 0) {
      broadcast(null, { type: 'output', message: `<span class="overdose-warning">The mixture detonates in your hands. The last thing you smell is burning.</span>`, player_update: { hp, sanity } }, null, player.id);
      const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
      await handlePlayerDeath(player, null);
      return { type: 'noop' };
    }
    return { type: 'output', message: `<span class="overdose-warning">The reaction runs away from you — a flash of heat, a gout of acrid smoke. The batch is ruined and you're burned.</span>`, player_update: { hp, sanity } };
  }

  if (!success) {
    return { type: 'error', message: `The cook doesn't take. The mixture goes inert and cloudy — a wasted run, but your reagents survive. (margin ${finalMargin})` };
  }

  // Potency baked into the produced drug item — a great cook makes stronger product.
  const potency = Math.max(0.5, Math.min(1.8, Math.round((0.6 + finalMargin * 0.09) * 100) / 100));
  const quality = qualityFor(finalMargin);
  const customData = { potency, quality, synthesized: true };
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
    message: `<span class="ip-gain">The reaction settles clean.</span> You cook ${outQty}x <span class="item">${outName}</span> — <b>${pct}% potency</b> [${quality}].`,
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
const BLOCKS = ['instant', 'phases', 'hallucination'];
const STRUCT = ['instant', 'phases', 'hallucination', 'tolerance', 'withdrawal', 'overdose'];
const pendingSplice = new Map();

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
function sumSigned(a, b) {
  const obj = { ...a }; let conflicts = 0;
  for (const k in b) {
    const bv = Number(b[k]) || 0; if (!bv) continue;
    const av = Number(obj[k]) || 0;
    if (av && Math.sign(av) !== Math.sign(bv)) conflicts++;
    obj[k] = av + bv;
  }
  return { obj, conflicts };
}
function absSum(o) { let s = 0; for (const k in (o || {})) s += Math.abs(Number(o[k]) || 0); return s; }
const summariseInstant = (i) => Object.entries(i).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ');
const summarisePhases = (p) => `${p.peak_seconds || 0}s peak: ${Object.entries(p.peak_mods || {}).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.replace(/_/g, ' ')}`).join(', ') || '—'}`;
const summariseHall = (h) => `${h.mode || 'overlay'} trip (${h.palette || 'green'}, ${Math.round((h.intensity || 0.5) * 100)}%)`;

// Compose a base drug's effects with grafted blocks from other drugs; compute
// difficulty / instability / overload from the mix.
function composeSplice(baseEff, grafts, srcEffById, name) {
  const base = normEff(baseEff);
  const composed = {
    instant: { ...base.instant }, phases: base.phases ? clone(base.phases) : null,
    hallucination: base.hallucination ? clone(base.hallucination) : null,
    tolerance: base.tolerance, withdrawal: base.withdrawal, overdose: base.overdose,
  };
  let antagonism = 0;
  for (const g of grafts) {
    const src = normEff(srcEffById[g.drug]);
    if (g.block === 'instant') {
      const r = sumSigned(composed.instant, src.instant); composed.instant = r.obj; antagonism += r.conflicts;
    } else if (g.block === 'phases' && src.phases) {
      if (!composed.phases) composed.phases = clone(src.phases);
      else {
        const r = sumSigned(composed.phases.peak_mods || {}, src.phases.peak_mods || {});
        composed.phases.peak_mods = r.obj; antagonism += r.conflicts;
        for (const key of ['comeup_seconds', 'peak_seconds', 'comedown_seconds'])
          composed.phases[key] = Math.max(composed.phases[key] || 0, src.phases[key] || 0);
      }
    } else if (g.block === 'hallucination' && src.hallucination) {
      if (!composed.hallucination) composed.hallucination = clone(src.hallucination);
      else {
        composed.hallucination.intensity = Math.max(composed.hallucination.intensity || 0.5, src.hallucination.intensity || 0.5);
        composed.hallucination.events = [...(composed.hallucination.events || []), ...(src.hallucination.events || [])].slice(0, 12);
        if (src.hallucination.mode === 'dreamzone') { composed.hallucination.mode = 'dreamzone'; composed.hallucination.dreamzone_id = composed.hallucination.dreamzone_id || src.hallucination.dreamzone_id; }
      }
    }
  }
  const graftCount = grafts.length;
  const totalAbs = absSum(composed.phases?.peak_mods) + absSum(composed.instant);
  const hallCount = composed.hallucination ? 1 : 0;
  const difficulty = Math.round(SPLICE_BASE_DIFF + 1.5 * graftCount + 1.5 * antagonism + totalAbs / 12);
  const instability = Math.min(1, 0.12 * graftCount + 0.18 * antagonism + 0.12 * hallCount + totalAbs / 120);
  const doseWeight = 1 + graftCount;
  const odThreshold = Math.max(2, 3 - Math.max(0, graftCount - 1));
  const warnings = [];
  if (antagonism > 0) warnings.push('Antagonistic effects fight each other — volatile.');
  if (graftCount >= 3) warnings.push('Overloaded — this will overdose fast.');
  if (instability > 0.6) warnings.push('Highly unstable — real risk of a bad batch, or worse.');
  return { effects: composed, difficulty, instability: Math.round(instability * 100) / 100, doseWeight, odThreshold, warnings, graftCount, antagonism };
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

async function hasStabilizer(pid) {
  const { rows } = await query('SELECT 1 FROM player_inventory pi WHERE pi.player_id=$1 AND pi.item_id=$2 AND pi.quantity>=1 LIMIT 1', [pid, STABILIZER_ITEM]);
  return rows.length > 0;
}

async function cmdSplice(args, raw, player, broadcast) {
  const eff = await effectiveSkill(player, SYNTH_SKILL);
  if (eff < SPLICE_MIN_SKILL) return { type: 'error', message: `Splicing is master's work — you need Chemistry ${SPLICE_MIN_SKILL}+ (you're at ${eff}).` };
  const ws = await findWorkspace({ requires_station: 'chem_lab' }, player);
  if (!ws || ws.mode !== 'lab') return { type: 'error', message: "Splicing needs a real chem lab — a cook kit can't hold the reaction." };

  const cache = getDrugCache();
  const { rows } = await query(
    `SELECT DISTINCT d.id as drug_id, i.name FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id = $1 AND pi.is_equipped = 0`,
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
    if (Object.keys(blocks).length) drugs.push({ drug: r.drug_id, name: r.name, blocks });
  }
  if (drugs.length < 2) return { type: 'error', message: 'You need at least two different drugs on hand to splice.' };

  return { type: 'splice_designer', drugs, minSkill: SPLICE_MIN_SKILL, baseDifficulty: SPLICE_BASE_DIFF, hasStabilizer: await hasStabilizer(player.id) };
}

function summariseComposed(e) {
  const lines = [];
  if (e.instant && Object.keys(e.instant).length) lines.push('Instant: ' + summariseInstant(e.instant));
  if (e.phases) lines.push('Phased: ' + summarisePhases(e.phases));
  if (e.hallucination) lines.push('Trip: ' + summariseHall(e.hallucination));
  return lines.join('\n') || 'No effects selected.';
}

// Live preview as the player designs (reuses composeSplice — authoritative math).
async function cmdSplicePreview(args, raw, player) {
  let payload; try { payload = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf8')); } catch { return { type: 'noop' }; }
  const cache = getDrugCache();
  const baseDrug = cache[payload.base];
  if (!baseDrug) return { type: 'splice_preview', ok: false };
  const grafts = Array.isArray(payload.grafts) ? payload.grafts.filter(g => g && g.drug && BLOCKS.includes(g.block)) : [];
  const srcEffById = {}; for (const g of grafts) srcEffById[g.drug] = cache[g.drug]?.effects;
  const comp = composeSplice(baseDrug.effects, grafts, srcEffById, null);
  return { type: 'splice_preview', ok: true, difficulty: comp.difficulty, instability: comp.instability, doseWeight: comp.doseWeight, odThreshold: comp.odThreshold, warnings: comp.warnings, summary: summariseComposed(comp.effects) };
}

async function cmdSpliceBegin(args, raw, player, broadcast) {
  let payload;
  try { payload = JSON.parse(Buffer.from(args[0] || '', 'base64').toString('utf8')); } catch { return { type: 'error', message: 'Malformed splice payload.' }; }
  const baseId = payload.base;
  const grafts = Array.isArray(payload.grafts) ? payload.grafts.filter(g => g && g.drug && BLOCKS.includes(g.block)) : [];
  const name = String(payload.name || '').slice(0, 40).trim() || null;

  const cache = getDrugCache();
  const baseDrug = cache[baseId];
  if (!baseDrug) return { type: 'error', message: 'Unknown base drug.' };
  const eff = await effectiveSkill(player, SYNTH_SKILL);
  if (eff < SPLICE_MIN_SKILL) return { type: 'error', message: `You need Chemistry ${SPLICE_MIN_SKILL}+ to splice.` };
  const ws = await findWorkspace({ requires_station: 'chem_lab' }, player);
  if (!ws || ws.mode !== 'lab') return { type: 'error', message: 'You need a chem lab to splice.' };

  const drugIds = [...new Set([baseId, ...grafts.map(g => g.drug)])];
  const inv = await playerInventory(player.id);
  const itemIds = [];
  for (const did of drugIds) {
    const itemId = cache[did]?.item_id;
    if (!itemId) return { type: 'error', message: 'A source drug is missing its item.' };
    if (!inv.find(v => v.item_id === itemId && v.quantity >= 1)) return { type: 'error', message: `You need a dose of ${cache[did].name} to break down.` };
    itemIds.push(itemId);
  }
  if (!inv.find(v => v.item_id === STABILIZER_ITEM && v.quantity >= 1)) return { type: 'error', message: 'You need a Stabilizer to hold the splice together.' };
  itemIds.push(STABILIZER_ITEM);

  const srcEffById = {};
  for (const did of drugIds) srcEffById[did] = cache[did]?.effects;
  const comp = composeSplice(baseDrug.effects, grafts, srcEffById, name);
  const token = randomUUID().slice(0, 8);
  pendingSplice.set(player.id, { token, comp, name: name || `${baseDrug.name} splice`, itemIds, ts: Date.now() });

  return {
    type: 'synth_minigame', kind: 'splice', token,
    recipeName: name || `${baseDrug.name} splice`,
    difficulty: comp.difficulty, hard: true, instability: comp.instability, workspace: ws.label,
  };
}

async function cmdSpliceResolve(args, raw, player, broadcast) {
  const token = args[0];
  const score = Math.max(0, Math.min(100, parseInt(args[1], 10) || 0));
  const p = pendingSplice.get(player.id);
  pendingSplice.delete(player.id);
  if (!p || p.token !== token || Date.now() - p.ts > PENDING_TTL_MS) return { type: 'noop' };

  const inv = await playerInventory(player.id);
  const toConsume = [];
  for (const itemId of p.itemIds) {
    const found = inv.find(v => v.item_id === itemId && v.quantity >= 1 && !toConsume.some(c => c.invId === v.id));
    if (!found) return { type: 'error', message: 'Something you needed is gone — the splice collapses.' };
    toConsume.push({ invId: found.id, quantity: 1, currentQty: found.quantity });
  }
  const consume = async (q) => {
    for (const c of toConsume) {
      if (c.currentQty <= c.quantity) await q('DELETE FROM player_inventory WHERE id=$1', [c.invId]);
      else await q('UPDATE player_inventory SET quantity=quantity-$1 WHERE id=$2', [c.quantity, c.invId]);
    }
  };

  const skillResult = await skillCheck(player, SYNTH_SKILL, p.comp.difficulty);
  const minigameBonus = Math.round((score / 100 - 0.5) * 8);
  const raw2 = skillResult.margin + minigameBonus + 2; // +2 real-lab bonus
  const effectiveMargin = raw2 - Math.round(p.comp.instability * 3); // instability makes it harder to land
  const success = effectiveMargin >= 0;
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
      await handlePlayerDeath(player, null);
      return { type: 'noop' };
    }
    return { type: 'output', message: `<span class="overdose-warning">The reaction blows back in your face — the compound is destroyed and you're badly burned (−${dmg} HP).</span>`, player_update: { hp, sanity } };
  }

  const insertCompound = async (q, customData, qty = 1) =>
    q('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data) VALUES ($1,$2,$3,$4,1.0,$5)',
      [randomUUID(), player.id, COMPOUND_ITEM, qty, JSON.stringify(customData)]);

  // Bad batch — you still bottle something, but it's degraded and nasty.
  if (!success) {
    const cd = { synthesized: true, spliced: true, potency: 0.4, quality: 'scrap', name: `unstable ${p.name}`, effects: badBatch(p.comp.effects), overdose_threshold: Math.max(2, p.comp.odThreshold - 1), dose_weight: p.comp.doseWeight + 1, duration_seconds: 300 };
    await withTransaction(async (q) => { await consume(q); await insertCompound(q, cd); });
    return { type: 'output', message: `<span class="msg-system">The splice curdles into something wrong — cloudy, and it smells of solvent and regret. You bottle the <span class="item">unstable ${p.name}</span> anyway. (margin ${effectiveMargin})</span>` };
  }

  // Success — potency capped by instability (overload caps power).
  const potencyCap = Math.max(0.6, 1.7 - p.comp.instability * 0.5);
  const potency = Math.max(0.5, Math.min(potencyCap, Math.round((0.6 + effectiveMargin * 0.08) * 100) / 100));
  const quality = qualityFor(effectiveMargin);
  const cd = { synthesized: true, spliced: true, potency, quality, name: p.name, effects: p.comp.effects, overdose_threshold: p.comp.odThreshold, dose_weight: p.comp.doseWeight, duration_seconds: 300 };
  await withTransaction(async (q) => { await consume(q); await insertCompound(q, cd); });
  await awardSkillUse(player.id, SYNTH_SKILL, skillResult.margin);

  const pct = Math.round(potency * 100);
  const riskNote = p.comp.doseWeight > 1 ? ` <span class="msg-system">(counts as ${p.comp.doseWeight} doses — go easy)</span>` : '';
  return { type: 'output', message: `<span class="ip-gain">It holds.</span> You splice <span class="item">${p.name}</span> — <b>${pct}% potency</b> [${quality}].${riskNote}` };
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
    if (Object.keys(blocks).length) drugs.push({ drug: d.id, name: d.name, blocks });
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
  '.cooktest': cmdCookTest,
  '.splicetest': cmdSpliceTest,
};
