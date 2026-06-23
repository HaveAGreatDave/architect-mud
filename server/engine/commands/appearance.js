/**
 * Cosmetic machine (MORPHEX 9000) interaction handler.
 * Free first change; 10₵ per attribute after. Genital size: 5₵/unit (MIS only).
 *
 * Usage:
 *   morphex                       — open BioSculpt panel
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
import { isMisActive } from '../mis.js';

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

function buildPanelData(player, toast = null) {
  return {
    type: 'morphex_panel',
    data: {
      biological_sex:      player.biological_sex || 'male',
      hair_style:          player.hair_style || 'short',
      hair_length:         player.hair_length || 'short',
      hair_color:          player.hair_color || 'brown',
      eye_color:           player.eye_color || 'brown',
      height_cm:           player.height_cm || 170,
      weight_kg:           player.weight_kg || 70,
      appearance_free_used:player.appearance_free_used || 0,
      credits:             player.credits || 0,
      mis_active:          isMisActive(player),
      appearance_data:     player.appearance_data || {},
      erect:               player.erect || 0,
      toast,
    },
    player_update: { credits: player.credits },
  };
}

function chargeCheck(player) {
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

async function cmdMorphex(args, raw, player) {
  // If args start with a machine name, strip it
  let remaining = args;
  if (remaining.length && MACHINE_NAMES.some(n => n === remaining.slice(0, n.split(' ').length).join(' '))) {
    remaining = remaining.slice(1);
  }

  if (!await getMachine(player.current_zone)) return null;

  const sub = remaining[0]?.toLowerCase();
  const rest = remaining.slice(1);

  // No sub-command → open panel
  if (!sub) return buildPanelData(player);

  // sex reassignment
  if (sub === 'sex') {
    const newSex = rest[0]?.toLowerCase();
    if (newSex !== 'male' && newSex !== 'female') {
      return buildPanelData(player, 'Usage: morphex sex male / morphex sex female');
    }
    if (player.biological_sex === newSex) {
      return buildPanelData(player, `Already ${newSex}.`);
    }
    const { ok, cost } = chargeCheck(player);
    if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required. You have ${player.credits || 0}₵.`);

    const newApp = randomAppearance(newSex);
    player.biological_sex = newSex;
    player.appearance_data = newApp.appearance_data;
    await applyCharge(player, cost);
    await query('UPDATE players SET biological_sex=$1, appearance_data=$2 WHERE id=$3',
      [newSex, JSON.stringify(newApp.appearance_data), player.id]);

    const costMsg = cost === 0 ? ' (complimentary)' : ` (-${cost}₵)`;
    return buildPanelData(player, `Reconfigured to ${newSex}.${costMsg}`);
  }

  // hair
  if (sub === 'hair') {
    const attr = rest[0]?.toLowerCase();
    const val  = rest.slice(1).join(' ').toLowerCase();
    if (!attr || !val) return buildPanelData(player, 'Usage: morphex hair color|length|style <value>');

    if (attr === 'color') {
      if (!HAIR_COLORS.includes(val)) return buildPanelData(player, `Unknown color: ${val}`);
      const { ok, cost } = chargeCheck(player);
      if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
      player.hair_color = val;
      await applyCharge(player, cost);
      await query('UPDATE players SET hair_color=$1 WHERE id=$2', [val, player.id]);
      return buildPanelData(player, `Hair color → ${val}.${cost ? ` (-${cost}₵)` : ' (free)'}`);
    }
    if (attr === 'length') {
      if (!HAIR_LENGTHS.includes(val)) return buildPanelData(player, `Unknown length: ${val}`);
      const { ok, cost } = chargeCheck(player);
      if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
      player.hair_length = val;
      await applyCharge(player, cost);
      await query('UPDATE players SET hair_length=$1 WHERE id=$2', [val, player.id]);
      return buildPanelData(player, `Hair length → ${val}.${cost ? ` (-${cost}₵)` : ' (free)'}`);
    }
    if (attr === 'style') {
      if (!HAIR_STYLES.includes(val)) return buildPanelData(player, `Unknown style: ${val}`);
      const { ok, cost } = chargeCheck(player);
      if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
      player.hair_style = val;
      await applyCharge(player, cost);
      await query('UPDATE players SET hair_style=$1 WHERE id=$2', [val, player.id]);
      return buildPanelData(player, `Hair style → ${val}.${cost ? ` (-${cost}₵)` : ' (free)'}`);
    }
    return buildPanelData(player, 'Usage: morphex hair color|length|style <value>');
  }

  // eye color
  if (sub === 'eye') {
    const val = (rest[0]?.toLowerCase() === 'color' ? rest.slice(1) : rest).join(' ').toLowerCase();
    if (!EYE_COLORS.includes(val)) return buildPanelData(player, `Unknown eye color: ${val}`);
    const { ok, cost } = chargeCheck(player);
    if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
    player.eye_color = val;
    await applyCharge(player, cost);
    await query('UPDATE players SET eye_color=$1 WHERE id=$2', [val, player.id]);
    return buildPanelData(player, `Eye color → ${val}.${cost ? ` (-${cost}₵)` : ' (free)'}`);
  }

  // height
  if (sub === 'height') {
    const cm = parseInt(rest[0]);
    if (isNaN(cm) || cm < 150 || cm > 210) return buildPanelData(player, 'Height must be 150–210cm.');
    const { ok, cost } = chargeCheck(player);
    if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
    player.height_cm = cm;
    await applyCharge(player, cost);
    await query('UPDATE players SET height_cm=$1 WHERE id=$2', [cm, player.id]);
    return buildPanelData(player, `Height → ${cm}cm.${cost ? ` (-${cost}₵)` : ' (free)'}`);
  }

  // weight
  if (sub === 'weight') {
    const kg = parseInt(rest[0]);
    if (isNaN(kg) || kg < 40 || kg > 150) return buildPanelData(player, 'Weight must be 40–150kg.');
    const { ok, cost } = chargeCheck(player);
    if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
    player.weight_kg = kg;
    await applyCharge(player, cost);
    await query('UPDATE players SET weight_kg=$1 WHERE id=$2', [kg, player.id]);
    return buildPanelData(player, `Weight → ${kg}kg.${cost ? ` (-${cost}₵)` : ' (free)'}`);
  }

  // penis — MIS only
  if (sub === 'penis') {
    if (!isMisActive(player)) return buildPanelData(player, `That option isn't available.`);
    if (player.biological_sex !== 'male') return buildPanelData(player, 'Not applicable.');
    const targetCm = parseInt(rest[0]);
    if (isNaN(targetCm) || targetCm < 5 || targetCm > 30) return buildPanelData(player, 'Enter a target length in cm (5–30).');
    const appData = player.appearance_data || {};
    const delta = Math.abs(targetCm - (appData.penis_length_cm || 12));
    const totalCost = Math.max(5, delta * 5);
    if ((player.credits || 0) < totalCost) return buildPanelData(player, `Costs 5₵/cm — ${totalCost}₵ total. You have ${player.credits || 0}₵.`);
    appData.penis_length_cm = targetCm;
    player.appearance_data = appData;
    player.credits = (player.credits || 0) - totalCost;
    await query('UPDATE players SET appearance_data=$1, credits=$2 WHERE id=$3', [JSON.stringify(appData), player.credits, player.id]);
    return buildPanelData(player, `Adjusted. (-${totalCost}₵)`);
  }

  // breast — MIS only
  if (sub === 'breast') {
    if (!isMisActive(player)) return buildPanelData(player, `That option isn't available.`);
    if (player.biological_sex !== 'female') return buildPanelData(player, 'Not applicable.');
    const targetSize = rest.join(' ').toLowerCase();
    if (BREAST_MAP[targetSize] === undefined) return buildPanelData(player, `Valid sizes: ${BREAST_SIZES.join(', ')}`);
    const appData = player.appearance_data || {};
    const delta = Math.abs(BREAST_MAP[targetSize] - (BREAST_MAP[appData.breast_size || 'medium'] ?? 2));
    const totalCost = Math.max(5, delta * 5);
    if ((player.credits || 0) < totalCost) return buildPanelData(player, `Costs 5₵/tier — ${totalCost}₵ total. You have ${player.credits || 0}₵.`);
    appData.breast_size = targetSize;
    player.appearance_data = appData;
    player.credits = (player.credits || 0) - totalCost;
    await query('UPDATE players SET appearance_data=$1, credits=$2 WHERE id=$3', [JSON.stringify(appData), player.credits, player.id]);
    return buildPanelData(player, `Adjusted. (-${totalCost}₵)`);
  }

  // Unknown sub-command — just open the panel
  return buildPanelData(player);
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
