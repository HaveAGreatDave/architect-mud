// Flight — ownership layer: hangars (secure storage), maintenance (repair), the
// wreck-salvage loop (strip a downed craft; rebuild a Carcass into a flyable), and
// deep tuning (the continuous mixture/pitch/boost/CG curves that feed the tick-loop
// hazard math + the HUD via state.effStats). Parts-as-items are a lighter follow-on;
// the tuning curves are the meat of "make it yours."

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { getZone, liveAircraft, persist, out, effStats } from './state.js';
// `tune` also belongs to broadcast (tune a channel); flight wins it and hands
// back when you're not tuning an aircraft. `repair` shadows the engine gear-repair
// builtin — cmdRepair returns undefined out of aircraft context to fall through.
import { commands as broadcastCommands } from '../broadcast/index.js';

const nowSec = () => Math.floor(Date.now() / 1000);
function fieldOf(player) { const z = getZone(player.current_zone); return z?.flags?.airfield_id ? z : null; }

// The aircraft the player is aboard, or their single parked craft here.
async function targetCraft(player) {
  if (player.aircraftId) { const l = liveAircraft.get(player.aircraftId); if (l) return { id: l.row.id, live: l }; }
  const { rows } = await query('SELECT id FROM aircraft WHERE parked_zone_id=$1 AND owner_id=$2 AND is_wreck=0 LIMIT 1', [player.current_zone, player.id]);
  return rows[0] ? { id: rows[0].id, live: liveAircraft.get(rows[0].id) || null } : null;
}

// ── Hangars ───────────────────────────────────────────────────────────────────
async function cmdHangar(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Hangars are at the airfields.' };
  const sub = (args[0] || '').toLowerCase();
  const { rows: mine } = await query('SELECT * FROM hangars WHERE field_zone=$1 AND owner_id=$2', [field.id, player.id]);

  if (!sub) {
    const { rows: stored } = await query('SELECT a.name, t.name tname FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.hangar_id IN (SELECT id FROM hangars WHERE field_zone=$1 AND owner_id=$2)', [field.id, player.id]);
    const head = `<span class="text-cyan">HANGARS — ${field.flags.airfield_name || field.name}:</span>`;
    if (!mine.length) return { type: 'output', message: `${head}\nYou rent no hangar here. <span class="action-link" data-action="cmd" data-cmd="hangar rent">hangar rent</span> — ${200}c/period, and your craft is safe from thieves.` };
    const list = stored.length ? stored.map(s => `· ${s.tname} "${s.name}"`).join('\n') : '· (empty)';
    return { type: 'output', message: `${head}\nYour hangar (${mine[0].name}). Stored:\n${list}\n<span class="action-link" data-action="cmd" data-cmd="hangar store">hangar store</span> · <span class="action-link" data-action="cmd" data-cmd="hangar pull">hangar pull</span>` };
  }

  if (sub === 'rent') {
    if (mine.length) return { type: 'emote', message: 'You already rent a hangar here.' };
    const cost = 200;
    if ((player.credits || 0) < cost) return { type: 'emote', message: `A hangar runs ${cost}c/period — you're short.` };
    player.credits -= cost;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    await query('INSERT INTO hangars (id,field_zone,name,owner_id,rent_paid_until,rent_per_period) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), field.id, `Bay ${Math.floor(Math.random() * 40 + 1)}`, player.id, nowSec() + 7 * 86400, cost]);
    return { type: 'output', message: `<span class="item-grant">Hangar rented. Your aircraft is safe behind a locked door here now — <b>hangar store</b> to put one away.</span>`, player_update: { credits: player.credits } };
  }

  if (sub === 'store' || sub === 'pull') {
    if (!mine.length) return { type: 'emote', message: 'You need to <b>hangar rent</b> a bay here first.' };
    if (sub === 'store') {
      const { rows } = await query('SELECT id, name FROM aircraft WHERE parked_zone_id=$1 AND owner_id=$2 AND is_wreck=0 AND hangar_id IS NULL LIMIT 1', [field.id, player.id]);
      if (!rows.length) return { type: 'emote', message: 'No aircraft of yours parked out on the ramp here to store.' };
      await query('UPDATE aircraft SET hangar_id=$1 WHERE id=$2', [mine[0].id, rows[0].id]);
      return { type: 'emote', message: `You tow "${rows[0].name}" into the hangar and roll the door down. Safe.` };
    }
    const { rows } = await query('SELECT id, name FROM aircraft WHERE hangar_id=$1 LIMIT 1', [mine[0].id]);
    if (!rows.length) return { type: 'emote', message: 'The hangar\'s empty.' };
    await query('UPDATE aircraft SET hangar_id=NULL, parked_zone_id=$1 WHERE id=$2', [field.id, rows[0].id]);
    return { type: 'emote', message: `You roll "${rows[0].name}" out onto the ramp, ready to fly.` };
  }
  return { type: 'emote', message: 'hangar <rent|store|pull>' };
}

// ── Maintenance ───────────────────────────────────────────────────────────────
async function cmdRepair(args, raw, player) {
  // `repair` shadows the engine gear-repair builtin. Only claim it when there's an
  // aircraft to work on; otherwise return undefined so the builtin repairs gear.
  const tgt = await targetCraft(player);
  if (!tgt) return undefined;
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Aircraft repairs happen at a field with tools.' };
  const { rows } = await query('SELECT a.damage, a.type_id, t.name, t.hull_hp FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1', [tgt.id]);
  const ac = rows[0];
  if (ac.damage <= 0.02) return { type: 'emote', message: `The ${ac.name} is already in fine shape.` };
  const cost = Math.ceil(ac.damage * ac.hull_hp * 6);
  if ((player.credits || 0) < cost) return { type: 'emote', message: `A full repair runs ~${cost}c in parts and time — you're short.` };
  const chk = await skillCheck(player, 'fabrication', 5);
  const fixed = chk.success ? ac.damage : ac.damage * 0.5;   // botch it and you only get half back
  player.credits -= cost;
  const newDmg = Math.max(0, ac.damage - fixed);
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query('UPDATE aircraft SET damage=$1 WHERE id=$2', [newDmg, tgt.id]);
  if (tgt.live) tgt.live.row.damage = newDmg;
  await awardSkillUse(player.id, 'fabrication', chk.margin);
  return { type: 'output', message: `<span class="item-grant">You work the ${ac.name} over — hull back to ${Math.round((1 - newDmg) * 100)}% for ${cost}c.</span>`, player_update: { credits: player.credits } };
}

// ── Wreck salvage + Carcass rebuild ───────────────────────────────────────────
async function cmdSalvage(args, raw, player) {
  const { rows } = await query('SELECT a.id, t.name, t.hull_hp, t.price_buy FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.parked_zone_id=$1 AND a.is_wreck=1 LIMIT 1', [player.current_zone]);
  const w = rows[0];
  if (!w) return { type: 'emote', message: "There's no wreck here to strip." };
  const chk = await skillCheck(player, 'scavenging', 5);
  const scrap = Math.ceil((w.price_buy || 400) * 0.05 * (chk.success ? 1.6 : 0.8));
  player.credits = (player.credits || 0) + scrap;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await awardSkillUse(player.id, 'scavenging', chk.margin);
  // Stripping guts the wreck: after it's picked over it can no longer be rebuilt.
  await query("UPDATE aircraft SET custom_data = jsonb_set(COALESCE(custom_data,'{}'), '{stripped}', 'true') WHERE id=$1", [w.id]);
  return { type: 'output', message: `<span class="item-grant">You strip the ${w.name} wreck for parts and scrap — <b>${scrap}c</b> of salvage.</span>`, player_update: { credits: player.credits } };
}

async function cmdRebuild(args, raw, player) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'You can only rebuild a wreck at a field with a hangar.' };
  const { rows } = await query('SELECT a.id, a.custom_data, t.name FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.parked_zone_id=$1 AND a.is_wreck=1 LIMIT 1', [player.current_zone]);
  const w = rows[0];
  if (!w) return { type: 'emote', message: 'No wreck here to rebuild.' };
  if (w.custom_data?.stripped) return { type: 'emote', message: "This wreck's been stripped to the frame — nothing left to rebuild." };
  const cost = 1500;
  if ((player.credits || 0) < cost) return { type: 'emote', message: `A rebuild runs ${cost}c in parts — you're short.` };
  const mech = await skillCheck(player, 'fabrication', 8);
  const chem = await skillCheck(player, 'chemistry', 6);
  if (!mech.success || !chem.success) return { type: 'emote', message: 'You can\'t make it airworthy with what you\'ve got — you need cleaner hands at Fabrication and Chemistry. (Try again.)' };
  // A rebuilt Carcass rolls a random real type.
  const { rows: types } = await query("SELECT id, name FROM aircraft_types WHERE class <> 'wreck' ORDER BY random() LIMIT 1");
  const rolled = types[0];
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query('UPDATE aircraft SET is_wreck=0, damage=0.5, type_id=$1, owner_id=$2, engine_on=0, throttle=0, parked_zone_id=$3 WHERE id=$4',
    [rolled.id, player.id, field.id, w.id]);
  await awardSkillUse(player.id, 'fabrication', mech.margin);
  return { type: 'output', message: `<span class="item-grant">Against the odds, the wreck lives — it rebuilds into a battered but flyable <b>${rolled.name}</b>, now yours (hull 50%). She'll need a real repair before she's safe.</span>`, player_update: { credits: player.credits } };
}

// ── Tuning ────────────────────────────────────────────────────────────────────
const TUNE_PARAMS = {
  mixture: 'lean(+) burns cooler on economy but stall-prone; rich(−) cooler, thirstier, more power',
  pitch:   'coarse(+) faster cruise, sluggish climb; fine(−) better climb/takeoff',
  boost:   'raise(+) the power ceiling for speed at overheat/damage risk',
  cg:      'tail-heavy(+) agile but stall-prone; nose-heavy(−) stable but sluggish',
};

async function cmdTune(args, raw, player, broadcast) {
  // No aircraft of yours in reach → `tune` is a broadcast-channel tune.
  const tgt = await targetCraft(player);
  if (!tgt) return broadcastCommands.tune(args, raw, player, broadcast);
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Tuning needs a hangar\'s tools — do it at a field.' };
  const param = (args[0] || '').toLowerCase();
  if (!param) {
    const { rows } = await query('SELECT custom_data FROM aircraft WHERE id=$1', [tgt.id]);
    const tune = rows[0]?.custom_data?.tune || {};
    const lines = Object.entries(TUNE_PARAMS).map(([k, d]) => `· <b>${k}</b> [${(tune[k] ?? 0) > 0 ? '+' : ''}${tune[k] ?? 0}] — ${d}`);
    return { type: 'output', message: `<span class="text-cyan">TUNING — set −2..+2 (e.g. <b>tune mixture 1</b>):</span>\n${lines.join('\n')}` };
  }
  if (!TUNE_PARAMS[param]) return { type: 'emote', message: `Can't tune "${param}". Options: ${Object.keys(TUNE_PARAMS).join(', ')}.` };
  let val = parseInt(args[1], 10);
  if (Number.isNaN(val)) return { type: 'emote', message: `Set it to what? e.g. <b>tune ${param} 1</b> (−2..+2).` };
  // Mechanics sets how far you can safely push a curve.
  const eff = await effectiveSkill(player, 'fabrication');
  const range = Math.min(2, 1 + Math.floor(eff / 4));
  val = Math.max(-range, Math.min(range, val));
  const { rows } = await query('SELECT custom_data FROM aircraft WHERE id=$1', [tgt.id]);
  const cd = rows[0]?.custom_data || {};
  cd.tune = { ...(cd.tune || {}), [param]: val };
  await query('UPDATE aircraft SET custom_data=$1 WHERE id=$2', [JSON.stringify(cd), tgt.id]);
  if (tgt.live) { tgt.live.row.custom_data = cd; }
  await awardSkillUse(player.id, 'fabrication', 0);
  return { type: 'output', message: `<span class="item-grant">Tuned ${param} to ${val > 0 ? '+' : ''}${val}. ${eff < 4 ? 'Your hands aren\'t steady enough to push it harder yet.' : ''}</span>`.trim() };
}

export const commands = {
  hangar: cmdHangar,
  repair: cmdRepair,
  salvage: cmdSalvage,
  rebuild: cmdRebuild,
  tune: cmdTune,
};
