/**
 * Cosmetic machine (MORPHEX 9000) interaction handler.
 * Free first change ever; 10₵ per attribute after. Genital size: 5₵/unit (MIS only).
 *
 * Usage:
 *   morphex                       — show menu
 *   morphex sex <male|female>     — sex reassignment
 *   morphex hair color <color>    — change hair color
 *   morphex hair length <length>  — change hair length
 *   morphex hair style <style>    — change hair style
 *   morphex eye color <color>     — change eye color
 *   morphex height <cm>           — change height (150–210)
 *   morphex weight <kg>           — change weight (40–150)
 *   morphex penis <cm>            — set penis length (MIS only, 5₵/cm delta)
 *   morphex breast <size>         — set breast size (MIS only, 5₵/tier delta)
 */
import { query } from '../../models/db.js';
import { randomAppearance } from '../appearance.js';
import { isMisServerEnabled, isMisActive } from '../mis.js';
import { randomUUID } from 'crypto';

const HAIR_COLORS  = ['black','dark brown','brown','auburn','dirty blonde','blonde','red','grey','white','silver','dyed blue','dyed green','dyed purple','dyed red'];
const HAIR_LENGTHS = ['shaved','short','medium','long','very_long'];
const HAIR_STYLES  = ['short','long','mohawk','shaved','dreadlocks','braided','messy','slicked-back','curly','wavy'];
const EYE_COLORS   = ['brown','dark brown','blue','light blue','green','hazel','grey','amber'];
const BREAST_SIZES = ['flat','small','medium','large','very large'];
const BREAST_MAP   = { flat:0, small:1, medium:2, large:3, 'very large':4 };

const MACHINE_NAMES = ['morphex', 'biosculpt', 'makeover', 'morphex 9000'];

async function getMachine(zoneId) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='cosmetic_machine' LIMIT 1`,
    [zoneId]
  );
  return rows[0] || null;
}

function chargeCheck(player) {
  // Returns { ok, cost } — free if first ever change, else 10₵.
  if (!player.appearance_free_used) return { ok: true, cost: 0 };
  const cost = 10;
  if ((player.credits || 0) < cost) return { ok: false, cost };
  return { ok: true, cost };
}

async function applyCharge(player, cost) {
  player.appearance_free_used = 1;
  player.credits = (player.credits || 0) - cost;
  await query('UPDATE players SET appearance_free_used=1, credits=$1 WHERE id=$2', [player.credits, player.id]);
}

function morphexMenu(player) {
  const isMis = isMisActive(player);
  const p = player;
  const current = [
    `sex: ${p.biological_sex || 'unknown'}`,
    `hair: ${p.hair_style || '?'} ${p.hair_color || '?'} (${p.hair_length || '?'})`,
    `eyes: ${p.eye_color || '?'}`,
    `height: ${p.height_cm || '?'}cm`,
    `weight: ${p.weight_kg || '?'}kg`,
  ].join(' | ');

  const freeNote = p.appearance_free_used
    ? `<span style="color:var(--text-dim)">10₵ per modification.</span>`
    : `<span style="color:var(--accent)">First modification: FREE.</span>`;

  let menu = `<span style="color:var(--accent)">MORPHEX 9000 BioSculpt Terminal</span>\n` +
    `<span style="color:var(--text-dim)">${current}</span>\n\n` +
    `${freeNote}\n\n` +
    `<span style="color:var(--text-dim)">morphex sex &lt;male|female&gt;</span>     — sex reassignment\n` +
    `<span style="color:var(--text-dim)">morphex hair color &lt;color&gt;</span>    — change hair color\n` +
    `<span style="color:var(--text-dim)">morphex hair length &lt;length&gt;</span>  — change hair length\n` +
    `<span style="color:var(--text-dim)">morphex hair style &lt;style&gt;</span>    — change hair style\n` +
    `<span style="color:var(--text-dim)">morphex eye color &lt;color&gt;</span>     — change eye color\n` +
    `<span style="color:var(--text-dim)">morphex height &lt;cm&gt;</span>           — height (150–210)\n` +
    `<span style="color:var(--text-dim)">morphex weight &lt;kg&gt;</span>           — weight (40–150)\n`;

  if (isMis) {
    menu += `\n<span style="color:var(--text-dim)">morphex penis &lt;cm&gt;</span>            — penis length (5₵/cm)\n` +
      `<span style="color:var(--text-dim)">morphex breast &lt;size&gt;</span>          — breast size (5₵/tier)\n`;
  }

  menu += `\nHair colors: ${HAIR_COLORS.join(', ')}\n` +
    `Hair styles: ${HAIR_STYLES.join(', ')}\n` +
    `Hair lengths: ${HAIR_LENGTHS.join(', ')}\n` +
    `Eye colors: ${EYE_COLORS.join(', ')}`;

  if (isMis) {
    menu += `\nBreast sizes: ${BREAST_SIZES.join(', ')}`;
  }

  return { type: 'output', message: menu };
}

async function cmdMorphex(args, raw, player) {
  // Check targeting by name if args provided
  if (args.length && !MACHINE_NAMES.some(n => [args[0], args.slice(0,2).join(' ')].includes(n))) {
    // Not targeting the machine by name — check if first arg is a sub-command
    const sub = args[0]?.toLowerCase();
    const validSubs = ['sex','hair','eye','height','weight','penis','breast'];
    if (!validSubs.includes(sub)) return null; // not our command
  }

  if (!await getMachine(player.current_zone)) return null;

  // No sub-command → show menu
  if (!args.length || MACHINE_NAMES.some(n => args.join(' ').toLowerCase() === n)) {
    return morphexMenu(player);
  }

  const sub = args[0].toLowerCase();
  const rest = args.slice(1);

  // sex reassignment
  if (sub === 'sex') {
    const newSex = rest[0]?.toLowerCase();
    if (newSex !== 'male' && newSex !== 'female') {
      return { type: 'error', message: `Usage: morphex sex <male|female>` };
    }
    if (player.biological_sex === newSex) {
      return { type: 'output', message: `The machine scans you and reports: you're already ${newSex}.` };
    }
    const { ok, cost } = chargeCheck(player);
    if (!ok) return { type: 'error', message: `Insufficient funds — 10₵ required. You have ${player.credits||0}₵.` };

    const newApp = randomAppearance(newSex);
    player.biological_sex = newSex;
    player.appearance_data = newApp.appearance_data;
    await applyCharge(player, cost);
    await query('UPDATE players SET biological_sex=$1, appearance_data=$2 WHERE id=$3',
      [newSex, JSON.stringify(newApp.appearance_data), player.id]);

    const costMsg = cost === 0 ? `(complimentary first session)` : `(-${cost}₵)`;
    return {
      type: 'output',
      message: `The MORPHEX 9000 reconfigures. You step out biologically ${newSex}. ${costMsg}`,
      player_update: { credits: player.credits },
    };
  }

  // hair color / hair length / hair style
  if (sub === 'hair') {
    const attr = rest[0]?.toLowerCase();
    const val  = rest.slice(1).join(' ').toLowerCase();
    if (!attr || !val) return { type: 'error', message: `Usage: morphex hair color|length|style <value>` };

    if (attr === 'color') {
      if (!HAIR_COLORS.includes(val)) return { type: 'error', message: `Unknown hair color. Options: ${HAIR_COLORS.join(', ')}` };
      const { ok, cost } = chargeCheck(player);
      if (!ok) return { type: 'error', message: `Insufficient funds — 10₵ required.` };
      player.hair_color = val;
      await applyCharge(player, cost);
      await query('UPDATE players SET hair_color=$1 WHERE id=$2', [val, player.id]);
      return { type: 'output', message: `Done. Your hair is now ${val}. ${cost ? `(-${cost}₵)` : '(free)'}`, player_update: { credits: player.credits } };
    }
    if (attr === 'length') {
      if (!HAIR_LENGTHS.includes(val)) return { type: 'error', message: `Unknown length. Options: ${HAIR_LENGTHS.join(', ')}` };
      const { ok, cost } = chargeCheck(player);
      if (!ok) return { type: 'error', message: `Insufficient funds — 10₵ required.` };
      player.hair_length = val;
      await applyCharge(player, cost);
      await query('UPDATE players SET hair_length=$1 WHERE id=$2', [val, player.id]);
      return { type: 'output', message: `Done. Hair length adjusted to ${val}. ${cost ? `(-${cost}₵)` : '(free)'}`, player_update: { credits: player.credits } };
    }
    if (attr === 'style') {
      if (!HAIR_STYLES.includes(val)) return { type: 'error', message: `Unknown style. Options: ${HAIR_STYLES.join(', ')}` };
      const { ok, cost } = chargeCheck(player);
      if (!ok) return { type: 'error', message: `Insufficient funds — 10₵ required.` };
      player.hair_style = val;
      await applyCharge(player, cost);
      await query('UPDATE players SET hair_style=$1 WHERE id=$2', [val, player.id]);
      return { type: 'output', message: `Done. Hair styled to ${val}. ${cost ? `(-${cost}₵)` : '(free)'}`, player_update: { credits: player.credits } };
    }
    return { type: 'error', message: `Usage: morphex hair color|length|style <value>` };
  }

  // eye color
  if (sub === 'eye') {
    const val = (rest[0]?.toLowerCase() === 'color' ? rest.slice(1) : rest).join(' ').toLowerCase();
    if (!EYE_COLORS.includes(val)) return { type: 'error', message: `Unknown eye color. Options: ${EYE_COLORS.join(', ')}` };
    const { ok, cost } = chargeCheck(player);
    if (!ok) return { type: 'error', message: `Insufficient funds — 10₵ required.` };
    player.eye_color = val;
    await applyCharge(player, cost);
    await query('UPDATE players SET eye_color=$1 WHERE id=$2', [val, player.id]);
    return { type: 'output', message: `Done. Your eyes are now ${val}. ${cost ? `(-${cost}₵)` : '(free)'}`, player_update: { credits: player.credits } };
  }

  // height
  if (sub === 'height') {
    const cm = parseInt(rest[0]);
    if (isNaN(cm) || cm < 150 || cm > 210) return { type: 'error', message: `Height must be 150–210cm.` };
    const { ok, cost } = chargeCheck(player);
    if (!ok) return { type: 'error', message: `Insufficient funds — 10₵ required.` };
    player.height_cm = cm;
    await applyCharge(player, cost);
    await query('UPDATE players SET height_cm=$1 WHERE id=$2', [cm, player.id]);
    return { type: 'output', message: `Done. Height adjusted to ${cm}cm. ${cost ? `(-${cost}₵)` : '(free)'}`, player_update: { credits: player.credits } };
  }

  // weight
  if (sub === 'weight') {
    const kg = parseInt(rest[0]);
    if (isNaN(kg) || kg < 40 || kg > 150) return { type: 'error', message: `Weight must be 40–150kg.` };
    const { ok, cost } = chargeCheck(player);
    if (!ok) return { type: 'error', message: `Insufficient funds — 10₵ required.` };
    player.weight_kg = kg;
    await applyCharge(player, cost);
    await query('UPDATE players SET weight_kg=$1 WHERE id=$2', [kg, player.id]);
    return { type: 'output', message: `Done. Weight adjusted to ${kg}kg. ${cost ? `(-${cost}₵)` : '(free)'}`, player_update: { credits: player.credits } };
  }

  // penis — MIS only
  if (sub === 'penis') {
    if (!isMisActive(player)) return { type: 'error', message: `That option isn't available.` };
    if (player.biological_sex !== 'male') return { type: 'error', message: `Not applicable.` };
    const targetCm = parseInt(rest[0]);
    if (isNaN(targetCm) || targetCm < 5 || targetCm > 30) return { type: 'error', message: `Enter a target length in cm (5–30).` };
    const appData = player.appearance_data || {};
    const current = appData.penis_length_cm || 12;
    const delta = Math.abs(targetCm - current);
    const totalCost = Math.max(5, delta * 5);
    if ((player.credits || 0) < totalCost) return { type: 'error', message: `Costs 5₵/cm — ${totalCost}₵ total. You have ${player.credits||0}₵.` };
    appData.penis_length_cm = targetCm;
    player.appearance_data = appData;
    player.credits = (player.credits || 0) - totalCost;
    await query('UPDATE players SET appearance_data=$1, credits=$2 WHERE id=$3', [JSON.stringify(appData), player.credits, player.id]);
    return { type: 'output', message: `Done. (-${totalCost}₵)`, player_update: { credits: player.credits } };
  }

  // breast — MIS only
  if (sub === 'breast') {
    if (!isMisActive(player)) return { type: 'error', message: `That option isn't available.` };
    if (player.biological_sex !== 'female') return { type: 'error', message: `Not applicable.` };
    const targetSize = rest.join(' ').toLowerCase();
    if (BREAST_MAP[targetSize] === undefined) return { type: 'error', message: `Valid sizes: ${BREAST_SIZES.join(', ')}` };
    const appData = player.appearance_data || {};
    const current = BREAST_MAP[appData.breast_size || 'medium'] ?? 2;
    const delta = Math.abs(BREAST_MAP[targetSize] - current);
    const totalCost = Math.max(5, delta * 5);
    if ((player.credits || 0) < totalCost) return { type: 'error', message: `Costs 5₵/tier — ${totalCost}₵ total. You have ${player.credits||0}₵.` };
    appData.breast_size = targetSize;
    player.appearance_data = appData;
    player.credits = (player.credits || 0) - totalCost;
    await query('UPDATE players SET appearance_data=$1, credits=$2 WHERE id=$3', [JSON.stringify(appData), player.credits, player.id]);
    return { type: 'output', message: `Done. (-${totalCost}₵)`, player_update: { credits: player.credits } };
  }

  return morphexMenu(player);
}

export const handlers = {
  use: async (args, raw, player) => {
    const target = args.join(' ').toLowerCase();
    if (!MACHINE_NAMES.some(n => target.includes(n))) return null;
    return cmdMorphex([], raw, player);
  },
  morphex:  (args, raw, player) => cmdMorphex(args, raw, player),
  makeover: (args, raw, player) => cmdMorphex(args, raw, player),
  biosculpt:(args, raw, player) => cmdMorphex(args, raw, player),
};
