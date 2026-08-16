/**
 * Cosmetic machine (MORPHEX 9000) plugin. Extracted from
 * server/engine/commands/appearance.js (Phase 2) — this also removed the
 * hardcoded `use` pre-intercept from the dispatch pipeline: `use morphex` now
 * routes through a specialized action that self-gates on the machine names and
 * falls through (undefined) otherwise. The engine furniture router reaches the
 * panel via the `cosmetic.open` Action (no imports in either direction).
 *
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
 *   morphex testicle <size>       — set testicle size (MIS only)
 *   morphex ass <size>            — set ass size (MIS only, both sexes)
 *   morphex breast <size>         — set breast size (MIS only, 5₵/tier delta)
 */
import { query } from '../../server/models/db.js';
import { randomAppearance } from '../../server/engine/appearance.js';
import { isMisActive, SEXUALITIES } from '../../server/engine/mis.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { registerAction } from '../../server/engine/actions.js';
import { emit } from '../../server/engine/events.js';
import { loggedPanelsSync } from '../../server/engine/presentation.js';

const HAIR_COLORS  = ['black','dark brown','brown','auburn','dirty blonde','blonde','red','grey','white','silver','dyed blue','dyed green','dyed purple','dyed red'];
const HAIR_LENGTHS = ['shaved','short','medium','long','very_long'];
const HAIR_STYLES  = ['mohawk','shaved','dreadlocks','braided','messy','slicked-back','curly','wavy','undercut','fade','afro','cornrows','pompadour','pixie'];
const EYE_COLORS   = ['brown','dark brown','blue','light blue','green','hazel','grey','amber'];
const BREAST_SIZES = ['flat','small','medium','large','very large'];
const BREAST_MAP   = { flat:0, small:1, medium:2, large:3, 'very large':4 };
const TESTICLE_SIZES = ['small','average','large','very large'];
const MALE_ASS_SIZES   = ['flat','small','average','round','large'];
const FEMALE_ASS_SIZES = ['flat','small','average','round','large','enormous'];

// 0.25in and 15in in centimetres — the authored bounds of the species.
export const MIN_PENIS_CM = 0.6;
export const MAX_PENIS_CM = 38.1;

const MACHINE_NAMES = ['morphex', 'biosculpt', 'makeover', 'morphex 9000'];

async function getMachine(zoneId) {
  const { rows } = await query(
    `SELECT id, flags FROM furniture WHERE zone_id=$1 AND (object_type='cosmetic_machine' OR jsonb_exists(flags,'cosmetic_machine')) LIMIT 1`,
    [zoneId]
  );
  return rows[0] || null;
}

// A chargen terminal (flags.chargen) opens the panel in a stripped-down mode:
// no current-appearance sheet, no balance/cost — the player is being made, has
// no credits, and the first change is free. Cached on the live player so every
// buildPanelData in a session carries it without threading a param everywhere.
async function markChargenMode(player) {
  const machine = await getMachine(player.current_zone);
  player._morphexChargen = !!(machine && machine.flags?.chargen);
  return machine;
}

// ── The BioSculpt sheet, written out ─────────────────────────────────────────
// The panel is a BLOCKING surface by docs/systems-display-mode.md's own test:
// delete it and a brand-new player cannot leave The Inbetween, because the
// prologue's first move gate wants `appearance.changed` and only this machine
// emits it. Every sub-command was already a typed verb — the hole was that the
// only thing that ever NAMED them was a modal, and a player on the bottom rung
// got the modal and no log line at all, not even the toast saying what changed.
//
// So at the `log` rung the same data the panel is built from is written out,
// with the exact commands underneath it. One builder, two presentations (the
// "re-render" shape, not "suppress" — a look shows you a room, not your own
// hair). `loggedPanelsSync` reads the login-hydrated latch, so this stays sync
// and costs no round trip on a `use` path.
const CHOICES = (list) => list.join(', ');

function renderMorphexText(player, toast) {
  const app = player.appearance_data || {};
  const mis = isMisActive(player);
  const chargen = !!player._morphexChargen;
  const L = [];
  const sexLine = `Sex: <b>${player.biological_sex || 'male'}</b> · Height: <b>${player.height_cm || 170}cm</b> · Weight: <b>${player.weight_kg || 70}kg</b>`;
  const hairLine = `Hair: <b>${player.hair_color || 'brown'}</b>, <b>${player.hair_length || 'short'}</b>, <b>${player.hair_style || 'short'}</b> · Eyes: <b>${player.eye_color || 'brown'}</b>`;

  // A CHANGE is not a request to read the terminal again. This whole sheet — the
  // full option catalogue, every value, every price — was the return value of
  // every sub-command, so setting five things printed it five times and buried
  // whatever else the player needed to hear. Same rule as `doneLine` on the
  // container view (server/engine/commands/inventory.js): opening it prints in
  // full, acting on it says what happened. The closing line already tells the
  // player `morphex` reads it back, so nothing is lost.
  //
  // Chargen is exempt: there the menu IS the interface, a first-time player has
  // nothing memorised, and there is no surrounding log to bury.
  if (toast && !chargen) {
    return {
      type: 'system',
      message: [`<span class="msg-system">${toast}</span>`, sexLine, hairLine,
        `<span class="hint">Type <b>morphex</b> for the full list of what you can change.</span>`].join('<br>'),
      player_update: { credits: player.credits },
    };
  }

  L.push(`<b>MORPHEX 9000 — BioSculpt</b>`);
  if (toast) L.push(`<span class="msg-system">${toast}</span>`);
  L.push(sexLine);
  L.push(hairLine);
  if (mis) {
    if ((player.biological_sex || 'male') === 'female') L.push(`Breasts: <b>${app.breast_size || 'medium'}</b> · Ass: <b>${app.ass_size || 'average'}</b>`);
    else L.push(`Penis: <b>${app.penis_length_cm || 12}cm</b> · Testicles: <b>${app.testicle_size || 'average'}</b> · Ass: <b>${app.ass_size || 'average'}</b>`);
    L.push(`Sexuality: <b>${player.sexuality || 'Male'}</b>`);
  }
  // Chargen is free and has no balance to report; a real terminal has both.
  L.push(chargen
    ? `<span class="hint">This one is calibrating you for the first time. Everything here is free.</span>`
    : `<span class="hint">First change free, then 10₵ each. You have ₵${player.credits || 0}.</span>`);
  L.push(`Change anything by typing it:`);
  L.push(`  <b>morphex sex</b> male|female`);
  L.push(`  <b>morphex hair color</b> ${CHOICES(HAIR_COLORS)}`);
  L.push(`  <b>morphex hair length</b> ${CHOICES(HAIR_LENGTHS)}`);
  L.push(`  <b>morphex hair style</b> ${CHOICES(HAIR_STYLES)}`);
  L.push(`  <b>morphex eye color</b> ${CHOICES(EYE_COLORS)}`);
  L.push(`  <b>morphex height</b> 150-210 · <b>morphex weight</b> 40-150`);
  if (mis) {
    if ((player.biological_sex || 'male') === 'female') {
      L.push(`  <b>morphex breast</b> ${CHOICES(BREAST_SIZES)}`);
      L.push(`  <b>morphex ass</b> ${CHOICES(FEMALE_ASS_SIZES)}`);
    } else {
      L.push(`  <b>morphex penis</b> ${MIN_PENIS_CM}-${MAX_PENIS_CM} (cm)`);
      L.push(`  <b>morphex testicle</b> ${CHOICES(TESTICLE_SIZES)}`);
      L.push(`  <b>morphex ass</b> ${CHOICES(MALE_ASS_SIZES)}`);
    }
    L.push(`  <b>morphex sexuality</b> ${CHOICES(SEXUALITIES)}`);
  }
  L.push(`<span class="hint">Type <b>morphex</b> any time to read this back.</span>`);
  return {
    type: 'system',
    message: L.join('<br>'),
    player_update: { credits: player.credits },
  };
}

function buildPanelData(player, toast = null) {
  if (loggedPanelsSync(player)) return renderMorphexText(player, toast);
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
      sexuality:           player.sexuality || 'Male',
      chargen:             !!player._morphexChargen,
      toast,
    },
    player_update: { credits: player.credits },
  };
}

function chargeCheck(player) {
  // A chargen terminal (the prologue's) never charges: the player is being made,
  // has no credits, and this shouldn't burn their real first-free change either.
  if (player._morphexChargen) return { ok: true, cost: 0 };
  if (!player.appearance_free_used) return { ok: true, cost: 0 };
  const cost = 10;
  if ((player.credits || 0) < cost) return { ok: false, cost };
  return { ok: true, cost };
}

async function applyCharge(player, cost) {
  // In chargen mode, don't consume the one-time free change — that belongs to a
  // real terminal later — but still emit so the prologue's alignment gate fires.
  if (!player._morphexChargen) {
    player.appearance_free_used = 1;
    await query('UPDATE players SET appearance_free_used=1 WHERE id=$1', [player.id]);
  }
  if (cost > 0) await adjustCredits(player, -cost, undefined, 'cosmetics:surgery');
  // Past-tense notification: the player reshaped themselves. The prologue listens
  // to gate chargen; harmless elsewhere.
  emit('appearance.changed', { actor: player });
}

async function cmdMorphex(args, raw, player) {
  // If args start with a machine name, strip it
  let remaining = args;
  if (remaining.length && MACHINE_NAMES.some(n => n === remaining.slice(0, n.split(' ').length).join(' '))) {
    remaining = remaining.slice(1);
  }

  if (!await markChargenMode(player)) return null;

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
    // Range is 0.25in (micropenis) up to 15in, stored in cm to one decimal.
    // parseFloat, not parseInt — the bottom of the range is under a centimetre.
    const targetCm = Math.round(parseFloat(rest[0]) * 10) / 10;
    if (isNaN(targetCm) || targetCm < MIN_PENIS_CM || targetCm > MAX_PENIS_CM) {
      return buildPanelData(player, `Enter a target length in cm (${MIN_PENIS_CM}–${MAX_PENIS_CM} — that's 0.25in to 15in).`);
    }
    const appData = player.appearance_data || {};
    const delta = Math.abs(targetCm - (appData.penis_length_cm || 12));
    const totalCost = player._morphexChargen ? 0 : Math.max(5, delta * 5);
    if ((player.credits || 0) < totalCost) return buildPanelData(player, `Costs 5₵/cm — ${totalCost}₵ total. You have ${player.credits || 0}₵.`);
    appData.penis_length_cm = targetCm;
    player.appearance_data = appData;
    if (totalCost > 0) await adjustCredits(player, -totalCost, undefined, 'cosmetics:surgery');
    await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(appData), player.id]);
    return buildPanelData(player, totalCost ? `Adjusted. (-${totalCost}₵)` : 'Adjusted. (free)');
  }

  // testicle size — MIS only
  if (sub === 'testicle' || sub === 'balls') {
    if (!isMisActive(player)) return buildPanelData(player, `That option isn't available.`);
    if (player.biological_sex !== 'male') return buildPanelData(player, 'Not applicable.');
    const targetSize = rest.join(' ').toLowerCase();
    if (!TESTICLE_SIZES.includes(targetSize)) return buildPanelData(player, `Valid sizes: ${TESTICLE_SIZES.join(', ')}`);
    const { ok, cost } = chargeCheck(player);
    if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
    const appData = player.appearance_data || {};
    appData.testicle_size = targetSize;
    player.appearance_data = appData;
    await applyCharge(player, cost);
    await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(appData), player.id]);
    return buildPanelData(player, `Adjusted. ${cost ? `(-${cost}₵)` : '(free)'}`);
  }

  // ass size — MIS only (applies to both sexes)
  if (sub === 'ass' || sub === 'butt') {
    if (!isMisActive(player)) return buildPanelData(player, `That option isn't available.`);
    const sizes = player.biological_sex === 'female' ? FEMALE_ASS_SIZES : MALE_ASS_SIZES;
    const targetSize = rest.join(' ').toLowerCase();
    if (!sizes.includes(targetSize)) return buildPanelData(player, `Valid sizes: ${sizes.join(', ')}`);
    const { ok, cost } = chargeCheck(player);
    if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
    const appData = player.appearance_data || {};
    appData.ass_size = targetSize;
    player.appearance_data = appData;
    await applyCharge(player, cost);
    await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(appData), player.id]);
    return buildPanelData(player, `Adjusted. ${cost ? `(-${cost}₵)` : '(free)'}`);
  }

  // breast — MIS only
  if (sub === 'breast') {
    if (!isMisActive(player)) return buildPanelData(player, `That option isn't available.`);
    if (player.biological_sex !== 'female') return buildPanelData(player, 'Not applicable.');
    const targetSize = rest.join(' ').toLowerCase();
    if (BREAST_MAP[targetSize] === undefined) return buildPanelData(player, `Valid sizes: ${BREAST_SIZES.join(', ')}`);
    const appData = player.appearance_data || {};
    const delta = Math.abs(BREAST_MAP[targetSize] - (BREAST_MAP[appData.breast_size || 'medium'] ?? 2));
    const totalCost = player._morphexChargen ? 0 : Math.max(5, delta * 5);
    if ((player.credits || 0) < totalCost) return buildPanelData(player, `Costs 5₵/tier — ${totalCost}₵ total. You have ${player.credits || 0}₵.`);
    appData.breast_size = targetSize;
    player.appearance_data = appData;
    if (totalCost > 0) await adjustCredits(player, -totalCost, undefined, 'cosmetics:surgery');
    await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(appData), player.id]);
    return buildPanelData(player, totalCost ? `Adjusted. (-${totalCost}₵)` : 'Adjusted. (free)');
  }

  // sexuality — MIS only
  if (sub === 'sexuality') {
    if (!isMisActive(player)) return buildPanelData(player, `That option isn't available.`);
    const val = rest.join(' ');
    const match = SEXUALITIES.find(s => s.toLowerCase() === val.toLowerCase());
    if (!match) return buildPanelData(player, `Valid options: ${SEXUALITIES.join(', ')}`);
    if (player.sexuality === match) return buildPanelData(player, `Already set to ${match}.`);
    const { ok, cost } = chargeCheck(player);
    if (!ok) return buildPanelData(player, `Insufficient funds — 10₵ required.`);
    player.sexuality = match;
    await applyCharge(player, cost);
    await query('UPDATE players SET sexuality=$1 WHERE id=$2', [match, player.id]);
    return buildPanelData(player, `Sexuality preference → ${match}.${cost ? ` (-${cost}₵)` : ' (free)'}`);
  }

  // Unknown sub-command — just open the panel
  return buildPanelData(player);
}

async function openCosmeticMachine(player) {
  if (!await markChargenMode(player))
    return { type: 'error', message: `There's no MORPHEX 9000 terminal here.` };
  return buildPanelData(player);
}

// The engine furniture router (`use <cosmetic_machine furniture>` in
// commands/inventory.js) opens the panel through this Action.
registerAction({
  type: 'cosmetic.open',
  handler: ({ actor }) => openCosmeticMachine(actor),
});

// `use morphex/biosculpt/makeover` — self-gated on the machine names; returns
// undefined otherwise so the verb falls through to the inventory `use` builtin.
export const specializedActions = [{
  verb: 'use',
  // Tag-gated so examining the terminal (flags.cosmetic_machine) advertises
  // `use` via availableActions — the front door into the panel.
  requiredTag: 'cosmetic_machine',
  handler: async (args, raw, player) => {
    const target = args.join(' ').toLowerCase();
    if (!MACHINE_NAMES.some(n => target.includes(n))) return undefined;
    if (!await markChargenMode(player)) {
      return { type: 'error', message: `There's no MORPHEX 9000 terminal here.` };
    }
    return buildPanelData(player);
  },
}];

export const commands = {
  morphex:  (args, raw, player) => cmdMorphex(args, raw, player),
  makeover: (args, raw, player) => cmdMorphex(args, raw, player),
  biosculpt:(args, raw, player) => cmdMorphex(args, raw, player),
};

// Test surface for plugins/cosmetic-machine/regress.js (never used in
// production). The written sheet is otherwise only reachable through a zone that
// actually holds a machine, which the harness's does not — so the one surface a
// player who cannot operate the panel depends on would go untested.
export const _test = { renderMorphexText };

console.log('[cosmetic-machine] Plugin loaded.');
