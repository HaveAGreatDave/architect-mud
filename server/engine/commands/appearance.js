/**
 * Cosmetic machine (MORPHEX 9000) interaction handler.
 * Triggered by: use morphex, use makeover, use biosculpt
 *
 * Free first session per player. 50₵ after. Genital size adjustments: 5₵/unit.
 * Multi-step: the server sends a structured prompt and the client responds.
 */
import { query } from '../../models/db.js';
import { randomAppearance } from '../appearance.js';
import { isMisServerEnabled } from '../mis.js';

const MACHINE_NAMES = ['morphex', 'biosculpt', 'makeover', 'morphex 9000'];

async function cmdUseCosmeticMachine(args, raw, player) {
  // Check if we're targeting the machine by name
  const target = args.join(' ').toLowerCase();
  if (target && !MACHINE_NAMES.some(n => target.includes(n))) return null; // not our target

  // Check if there's a cosmetic machine in this zone
  const { rows: machines } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='cosmetic_machine' LIMIT 1`,
    [player.current_zone]
  );
  if (!machines.length) return null; // no machine here, let other handlers try

  const isFree = !player.appearance_free_used;
  const cost = isFree ? 0 : 50;

  if (!isFree && (player.credits || 0) < cost) {
    return {
      type: 'output',
      message: `The MORPHEX 9000 flashes: <span style="color:var(--red)">INSUFFICIENT FUNDS — 50₵ REQUIRED.</span> You only have ${player.credits||0}₵.`,
    };
  }

  // Generate a new appearance preserving sex unless they'll change it
  const newAppearance = randomAppearance(player.biological_sex || 'male');

  // Apply
  player.hair_style   = newAppearance.hair_style;
  player.hair_length  = newAppearance.hair_length;
  player.hair_color   = newAppearance.hair_color;
  player.eye_color    = newAppearance.eye_color;
  player.height_cm    = newAppearance.height_cm;
  player.weight_kg    = newAppearance.weight_kg;
  player.appearance_free_used = 1;

  const updates = {
    hair_style:   newAppearance.hair_style,
    hair_length:  newAppearance.hair_length,
    hair_color:   newAppearance.hair_color,
    eye_color:    newAppearance.eye_color,
    height_cm:    newAppearance.height_cm,
    weight_kg:    newAppearance.weight_kg,
    appearance_free_used: 1,
  };

  if (!isFree) {
    player.credits = (player.credits || 0) - cost;
    updates.credits = player.credits;
  }

  const keys = Object.keys(updates);
  const sets = keys.map((k, i) => `${k}=$${i+1}`).join(',');
  const vals = [...keys.map(k => updates[k]), player.id];
  await query(`UPDATE players SET ${sets} WHERE id=$${vals.length}`, vals);

  const costMsg = isFree
    ? `<span style="color:var(--accent)">COMPLIMENTARY SESSION — first visit free.</span>`
    : `<span style="color:var(--text-dim)">50₵ charged. Balance: ${player.credits}₵.</span>`;

  const sexNote = isMisServerEnabled()
    ? `\n<span style="color:var(--text-dim)">Sex change and genital size adjustments are available — ask staff or use the terminal's advanced menu (if unlocked).</span>`
    : '';

  return {
    type: 'output',
    message: `The MORPHEX 9000 hums to life. You step into the scanner pod.\n\n` +
      `${costMsg}\n\n` +
      `The machine works quickly. When the pod hisses open you feel different — you ARE different.\n\n` +
      `<span style="color:var(--text-dim)">New appearance:</span>\n` +
      `${newAppearance.hair_style} ${newAppearance.hair_color} hair (${newAppearance.hair_length}), ` +
      `${newAppearance.eye_color} eyes, ${newAppearance.height_cm}cm, ${newAppearance.weight_kg}kg.` +
      sexNote,
    player_update: { credits: player.credits },
  };
}

// Sex change — separate command, costs 50₵ (or free if first use still available)
async function cmdChangeSex(args, raw, player) {
  const { rows: machines } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='cosmetic_machine' LIMIT 1`,
    [player.current_zone]
  );
  if (!machines.length) return { type:'error', message:`There's no cosmetic terminal here.` };

  const newSex = args[0]?.toLowerCase();
  if (newSex !== 'male' && newSex !== 'female') {
    return { type:'error', message:`Usage: changesex male / changesex female` };
  }
  if (player.biological_sex === newSex) {
    return { type:'output', message:`You're already ${newSex}. The machine shrugs.` };
  }

  const isFree = !player.appearance_free_used;
  const cost = isFree ? 0 : 50;
  if (!isFree && (player.credits || 0) < cost) {
    return { type:'error', message:`Not enough credits. Sex reassignment costs 50₵. You have ${player.credits||0}₵.` };
  }

  // Generate new genital appearance
  const newApp = randomAppearance(newSex);
  player.biological_sex = newSex;
  player.appearance_data = newApp.appearance_data;
  player.appearance_free_used = 1;
  if (!isFree) player.credits = (player.credits || 0) - cost;

  await query(
    'UPDATE players SET biological_sex=$1, appearance_data=$2, appearance_free_used=1, credits=$3 WHERE id=$4',
    [newSex, JSON.stringify(newApp.appearance_data), player.credits, player.id]
  );

  return {
    type: 'output',
    message: `The MORPHEX 9000 goes quiet for a long moment, then: <span style="color:var(--accent)">RECONFIGURATION COMPLETE.</span>\n` +
      `You step out different. You're now biologically ${newSex}.`,
    player_update: { credits: player.credits },
  };
}

// Genital size adjustment — 5₵ per unit
async function cmdAdjustSize(args, raw, player) {
  if (!isMisServerEnabled()) return { type:'error', message:`That feature isn't available.` };
  const { rows: machines } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='cosmetic_machine' LIMIT 1`,
    [player.current_zone]
  );
  if (!machines.length) return { type:'error', message:`There's no cosmetic terminal here.` };

  // args: "size penis 2" or "size breast large"
  if (args.length < 2) return { type:'error', message:`Usage: adjustsize <attribute> <amount>` };
  const attr = args[0].toLowerCase();
  const val = args[1];

  const appData = player.appearance_data || {};

  let costUnits = 1;
  let changed = false;

  if (attr === 'penis' && player.biological_sex === 'male') {
    const delta = parseInt(val);
    if (isNaN(delta) || delta < 1 || delta > 10) return { type:'error', message:`Enter a size increase of 1–10 cm.` };
    costUnits = delta;
    const totalCost = costUnits * 5;
    if ((player.credits || 0) < totalCost) return { type:'error', message:`Costs 5₵/cm. That's ${totalCost}₵ — you have ${player.credits||0}₵.` };
    appData.penis_length_cm = (appData.penis_length_cm || 12) + delta;
    player.credits -= totalCost;
    changed = true;
    await query('UPDATE players SET appearance_data=$1, credits=$2 WHERE id=$3', [JSON.stringify(appData), player.credits, player.id]);
    return { type:'output', message:`Done. The machine hums approvingly. (-${totalCost}₵)`, player_update: { credits: player.credits } };
  }

  if (attr === 'breast' && player.biological_sex === 'female') {
    const sizeMap = { flat:0, small:1, medium:2, large:3, 'very large':4 };
    const current = sizeMap[appData.breast_size || 'medium'] || 2;
    const targetKey = val.toLowerCase();
    const targetVal = sizeMap[targetKey];
    if (targetVal === undefined) return { type:'error', message:`Valid sizes: flat, small, medium, large, "very large"` };
    const delta = Math.max(0, targetVal - current);
    const totalCost = Math.max(5, delta * 5);
    if ((player.credits || 0) < totalCost) return { type:'error', message:`Costs 5₵/size. That's ${totalCost}₵ — you have ${player.credits||0}₵.` };
    appData.breast_size = targetKey;
    player.credits -= totalCost;
    await query('UPDATE players SET appearance_data=$1, credits=$2 WHERE id=$3', [JSON.stringify(appData), player.credits, player.id]);
    return { type:'output', message:`Done. The machine does something you'd rather not think about. (-${totalCost}₵)`, player_update: { credits: player.credits } };
  }

  return { type:'error', message:`Can't adjust that, or wrong sex for that attribute.` };
}

export const handlers = {
  use: async (args, raw, player, broadcast) => {
    const result = await cmdUseCosmeticMachine(args, raw, player);
    return result; // null means not our target — index.js will try other handlers
  },
  morphex:    (args, raw, player) => cmdUseCosmeticMachine([], raw, player),
  makeover:   (args, raw, player) => cmdUseCosmeticMachine([], raw, player),
  changesex:  (args, raw, player) => cmdChangeSex(args, raw, player),
  adjustsize: (args, raw, player) => cmdAdjustSize(args, raw, player),
};
