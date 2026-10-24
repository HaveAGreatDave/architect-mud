// THE LOT: buying, hiring, selling, servicing and listing racers.
//
// The racer bay at the Deadleg (zone_racerbay_deadleg, a room off the truck shed) carries
// `flags.podracer_lot`, the depot standard's "the shop is a room you walk into" (docs/reference/
// depot-shell.md). A racer kept there is `park_zone` = that room, and it comes out through the shed's
// bay door (seat.js `startOf`). A racer left out on the waste is parked on whatever tile it stopped
// on, and is waiting there next time.
//
// Every verb here is what a button on the counter sends (client podracer-depot.js); nothing on the
// counter decides or prices anything. The counter's payload (`racerPanel`) is built from the same
// helpers the log prints from.

import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { allExits } from '../../server/engine/exits.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { noteFreshVehicle } from '../../server/engine/fresh-vehicle.js';
import { boardCheck, noteGone } from '../../server/engine/vehicle-access.js';
import { PODRACER_TYPES, PODRACER_KIT, KIT_TIERS, FIT_LABOUR, PART_EXCHANGE, cleanKit, kitValue, kitWorth, kitQuote, podracerTuned } from '../../client/game/js/panels/podracer-model.js';

export const LOT_FLAG = 'podracer_lot';
// The yard buys a racer back at this share of its price, less the cost of putting it right.
export const RESALE = 0.5;
// What a full service costs per unit of damage, as a share of the price: a racer at zero hull and
// two dead turbines is about a third of a new one, and fuel is charged on top.
export const SERVICE_SHARE = 0.12;
export const FUEL_PER_TANK = 900;
// A hire: one at a time, out of the bay fuelled and sound, back on its own when the time is up.
export const HIRE_MS = 2 * 3600 * 1000;
export const hireFee = (t) => Math.round(t.price * 0.06);

const say = (message) => ({ type: 'output', message });
const dim = (t) => `<span class="text-dim">${t}</span>`;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v ?? 1)));
const money = (n) => `₵${Math.round(n).toLocaleString()}`;

export const isLot = (zone) => !!zone?.flags?.[LOT_FLAG];
// A garage keeps racers without selling them: a lot, or the bay room of any truck depot
// (`flags.truck_depot` with its `yard`, the test trucking's depotAt makes). A racer driven into a
// truck shed's door and parked stays in that room, and comes out of the same door. Buying, hiring,
// selling, servicing, paint and the flatbed stay in the lots.
const isTruckBay = (zone) => { const f = zone?.flags?.truck_depot; return !!(f && typeof f === 'object' && f.yard); };
export const isGarage = (zone) => isLot(zone) || isTruckBay(zone);
export const typeOf = (id) => PODRACER_TYPES[id] || null;
export const rowEng = (row) => { const e = row?.custom_data?.eng; return Array.isArray(e) ? [clamp01(e[0]), clamp01(e[1])] : [1, 1]; };
// The binder holds unless the row says it tore. A torn one stays torn through any number of climbs
// in and out, until the yard welds it (serviceRow).
export const rowBinder = (row) => row?.custom_data?.binder !== false;
// What the yard charges to fetch a racer stranded out on the waste back to the bay.
export const recoverFee = (t) => Math.round(t.price * 0.03);
// ── Paint ──────────────────────────────────────────────────────────────────
// A racer's livery is `custom_data.livery`: { base, trim, finish } in the shape every vehicle's
// renderer takes (liveryPalette in aircraft3d.js), so the mesh's `base` slots (the pod's candy)
// take `base`, its `trim` slots (the stripe, fins, vanes) take `trim`, and the metal stays metal.
// None is the factory paint. A scheme is a named one; any two colours and a finish can be had.
export const PAINT_FINISHES = ['gloss', 'satin', 'metallic', 'pearl', 'candy', 'matte', 'weathered'];
export const PODRACER_SCHEMES = [
  { id: 'factory', label: 'Factory candy', livery: null },
  { id: 'deadleg', label: 'Deadleg rust', livery: { base: '#8e3a14', trim: '#d8b48a', finish: 'weathered' } },
  { id: 'icewater', label: 'Icewater', livery: { base: '#2f7fd1', trim: '#e8edf2', finish: 'pearl' } },
  { id: 'hazard', label: 'Hazard', livery: { base: '#f2b705', trim: '#1c1c1c', finish: 'gloss' } },
  { id: 'nightshade', label: 'Nightshade', livery: { base: '#2b1838', trim: '#9a5cff', finish: 'candy' } },
  { id: 'gunmetal', label: 'Gunmetal', livery: { base: '#3a3f46', trim: '#e8a33a', finish: 'metallic' } },
  { id: 'bone', label: 'Bone', livery: { base: '#e8e2d4', trim: '#b3121a', finish: 'gloss' } },
  { id: 'verdigris', label: 'Verdigris', livery: { base: '#2e6b5c', trim: '#c8a24a', finish: 'metallic' } },
];
// The inside, made to order: the ids interior-podracer.js INSIDE knows. Cheaper than a respray.
export const INSIDE_OPTIONS = {
  leather: ['oxblood', 'tan', 'black', 'cream', 'green', 'blue'],
  strip: ['blue', 'red', 'green', 'amber', 'violet', 'white'],
  dash: ['carbon', 'gunmetal', 'cream', 'billet'],
};
export const insidePrice = (t) => Math.round(t.price * 0.01);
// The factory paint, as colours, for a custom job that only names one of them.
const FACTORY = { base: '#aa1a14', trim: '#eec84c', finish: 'candy' };
export const racerLiveryOf = (row) => { const l = row?.custom_data?.livery; return l && typeof l === 'object' && (l.base || l.inside) ? l : null; };
export const paintPrice = (t) => Math.round(t.price * 0.04);
export function schemeOfLivery(l) {
  if (!l || !l.base) return 'factory';
  const m = PODRACER_SCHEMES.find((s) => s.livery && s.livery.base === l.base && s.livery.trim === l.trim && s.livery.finish === l.finish);
  return m ? m.id : 'custom';
}
const HEX = /^#[0-9a-f]{6}$/;
/**
 * What `podracer paint` was asked for, over the racer's paint as it stands: a scheme's id (the
 * outside), and/or any of base=#rrggbb trim=#rrggbb finish=<finish> (the outside) and leather= strip=
 * dash= (the inside). { livery } (null is factory, inside and out) or { err }.
 */
export function parsePaint(tokens, cur, factory = FACTORY) {
  const t = tokens.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (!t.length) return { err: 'Which scheme? ' + PODRACER_SCHEMES.map((s) => s.id).join(', ') + ', or base=#rrggbb trim=#rrggbb finish=' + PAINT_FINISHES.join('|')
    + ', or the inside: leather=' + INSIDE_OPTIONS.leather.join('|') + ' strip=' + INSIDE_OPTIONS.strip.join('|') + ' dash=' + INSIDE_OPTIONS.dash.join('|') + '.' };
  const outside = cur && cur.base ? { base: cur.base, trim: cur.trim, finish: cur.finish } : null;
  let ext = outside, inside = cur?.inside ? { ...cur.inside } : null;
  for (const kv of t) {
    if (!kv.includes('=')) {
      const s = PODRACER_SCHEMES.find((x) => x.id === kv);
      if (!s) return { err: `No scheme called "${kv}".` };
      ext = s.livery ? { ...s.livery } : null;
      continue;
    }
    const [k, v] = kv.split('=');
    if ((k === 'base' || k === 'trim') && HEX.test(v || '')) ext = { ...(ext || factory), [k]: v };
    else if (k === 'finish' && PAINT_FINISHES.includes(v)) ext = { ...(ext || factory), finish: v };
    else if (INSIDE_OPTIONS[k] && INSIDE_OPTIONS[k].includes(v)) inside = { ...(inside || {}), [k]: v };
    else return { err: `"${kv}" is not a colour (#rrggbb) for base or trim, a finish (${PAINT_FINISHES.join(', ')}), or an inside choice (leather=, strip=, dash=).` };
  }
  if (!ext && !inside) return { livery: null };
  return { livery: { ...(ext || {}), ...(inside ? { inside } : {}) } };
}
const sameOutside = (a, b) => (a?.base || null) === (b?.base || null) && (a?.trim || null) === (b?.trim || null) && (a?.finish || null) === (b?.finish || null);
const sameInside = (a, b) => JSON.stringify(a?.inside || {}) === JSON.stringify(b?.inside || {});
const sameLivery = (a, b) => sameOutside(a, b) && sameInside(a, b);
/** Paint `row`: the yard's spray booth. { ok, livery, out }. */
export async function paintRow(player, row, tokens) {
  if (hireOf(row)) return { ok: false, out: say(dim('That one is a hire. The yard does not paint other people\'s racers.')) };
  const cur = racerLiveryOf(row);
  const { livery, err } = parsePaint(tokens, cur, typeOf(row.type_id)?.factory || FACTORY);
  if (err) return { ok: false, out: say(dim(err)) };
  if (sameLivery(cur, livery)) return { ok: false, out: say(dim('It is already that colour.')) };
  const t = typeOf(row.type_id);
  // A respray if the outside changes (half back to factory); the trim shop's price if only the inside does.
  const fee = !t ? 0 : !sameOutside(cur, livery) ? (livery?.base ? paintPrice(t) : Math.round(paintPrice(t) / 2)) : insidePrice(t);
  if ((player.credits ?? 0) < fee) return { ok: false, out: say(`The booth is <span class="text-red">${money(fee)}</span>. ${dim(`You have ${money(player.credits ?? 0)}.`)}`) };
  if (fee && !(await adjustCredits(player, -fee, query, 'podracer paint'))) return { ok: false, out: say(dim('The money does not go through.')) };
  await query(livery
    ? `UPDATE podracers SET custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{livery}', $2::jsonb) WHERE id = $1`
    : `UPDATE podracers SET custom_data = COALESCE(custom_data, '{}'::jsonb) - 'livery' WHERE id = $1`,
  livery ? [row.id, JSON.stringify(livery)] : [row.id]);
  const name = PODRACER_SCHEMES.find((s) => s.id === schemeOfLivery(livery))?.label;
  return { ok: true, livery, out: say((!sameOutside(cur, livery) ? (livery?.base
    ? `The yard masks the turbines off and sprays the pod ${name ? name.toLowerCase() : 'to your colours'}${livery.finish ? ', ' + livery.finish : ''}. `
    : 'The yard strips it back to the factory paint. ') : '')
    + (!sameInside(cur, livery) ? `The trim shop does the inside: ${['leather', 'strip', 'dash'].map((k) => livery?.inside?.[k] ? `${livery.inside[k]} ${k === 'strip' ? 'lights' : k}` : '').filter(Boolean).join(', ') || 'back to the factory\'s'}. ` : '')
    + `<span class="text-green">${money(fee)}</span>.`) };
}

// ── The fitting shop ───────────────────────────────────────────────────────
// A racer's kit is `custom_data.kit` (podracer-model.js PODRACER_KIT says what each slot does): only
// the slots changed from the factory's. Its tuned row is what the seat steps and the envelope checks.
export const rowKit = (row) => cleanKit(row?.custom_data?.kit);
export const paramsOf = (row) => podracerTuned(row?.type_id, rowKit(row));
// The yard buys a fitted kit back with the racer at this share of what it cost.
export const KIT_RESALE = 0.35;
const kitWord = (k, v) => { const s = PODRACER_KIT[k]; return s.kind === 'tiers' ? KIT_TIERS[v] : s.choices[v]?.label || v; };
/** One slot of the kit as the log prints it: the part and what it is at now. */
export const kitLine = (k, v) => `${PODRACER_KIT[k].label.toLowerCase()} ${kitWord(k, v).toLowerCase()}`;
/**
 * What `podracer fit` was asked for, over the kit as it stands: `slot=value` pairs, a tier as a number
 * or its word (stock, street, race, pro), a choice by its id, or `stock` alone to take everything
 * off. { kit } or { err }.
 */
export function parseKit(tokens, cur) {
  const t = tokens.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (!t.length) return { err: 'Fit what? ' + Object.keys(PODRACER_KIT).map((k) => `${k}=`).join(' ') + ', or stock to take it all off.' };
  let kit = { ...cleanKit(cur) };
  for (const kv of t) {
    if (kv === 'stock' || kv === 'factory') { kit = {}; continue; }
    const [k, v = ''] = kv.split('=');
    const s = PODRACER_KIT[k];
    if (!s) return { err: `The yard does not fit a "${k}". The slots: ${Object.keys(PODRACER_KIT).join(', ')}.` };
    if (s.kind === 'tiers') {
      const n = /^\d$/.test(v) ? +v : KIT_TIERS.findIndex((w) => w.toLowerCase() === v);
      if (!(n >= 0 && n <= 3)) return { err: `${s.label}: 0 to 3, or ${KIT_TIERS.map((w) => w.toLowerCase()).join(', ')}.` };
      kit[k] = n;
    } else {
      if (!s.choices[v]) return { err: `${s.label}: ${Object.keys(s.choices).join(', ')}.` };
      kit[k] = v;
    }
  }
  return { kit: cleanKit(kit) };
}
/** The bill for going from kit `a` to kit `b` on type `t` (podracer-model.js kitQuote, which the counter shows). */
export const fitQuote = (t, a, b) => kitQuote(t?.price || 0, a, b);
/** Fit `row` with what `tokens` ask for: the yard's fitting shop. { ok, kit, params, out }. */
export async function fitRow(player, row, tokens) {
  if (hireOf(row)) return { ok: false, out: say(dim('That one is a hire. The yard does not fit parts to its own hire stock.')) };
  const t = typeOf(row.type_id);
  if (!t) return { ok: false, out: say(dim('The yard has no parts for that.')) };
  const cur = rowKit(row);
  const { kit, err } = parseKit(tokens, cur);
  if (err) return { ok: false, out: say(dim(err)) };
  const q = fitQuote(t, cur, kit);
  if (!q.slots) return { ok: false, out: say(dim('It already has that fitted.')) };
  if (q.total > 0 && (player.credits ?? 0) < q.total) {
    return { ok: false, out: say(`The fitting shop wants <span class="text-red">${money(q.total)}</span> ${dim(`(parts ${money(q.parts)}, labour ${money(q.labour)}${q.back ? `, less ${money(q.back)} for the old parts` : ''}). You have ${money(player.credits ?? 0)}.`)}`) };
  }
  if (q.total && !(await adjustCredits(player, -q.total, query, 'podracer fit'))) return { ok: false, out: say(dim('The money does not go through.')) };
  await query(Object.keys(kit).length
    ? `UPDATE podracers SET custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{kit}', $2::jsonb) WHERE id = $1`
    : `UPDATE podracers SET custom_data = COALESCE(custom_data, '{}'::jsonb) - 'kit' WHERE id = $1`,
  Object.keys(kit).length ? [row.id, JSON.stringify(kit)] : [row.id]);
  const changed = Object.keys(PODRACER_KIT).filter((k) => kitValue(cur, k) !== kitValue(kit, k));
  const p = podracerTuned(row.type_id, kit);
  return { ok: true, kit, params: p, out: say(`The fitting shop has it up on the stands for an hour: ${changed.map((k) => kitLine(k, kitValue(kit, k))).join(', ')}. `
    + (q.total >= 0 ? `<span class="text-green">${money(q.total)}</span>.` : `They give you <span class="text-green">${money(-q.total)}</span> for the old parts.`)
    + `\n${dim(`Flat out ${Math.round(p.topSpeed)} mph launched.`)}`) };
}
/** What the yard gives for a racer: half its price and a share of its kit, less putting it right. */
export function resaleOf(row) {
  const t = typeOf(row.type_id);
  if (!t) return 0;
  return Math.max(0, Math.round(t.price * RESALE + kitWorth(rowKit(row), t.price) * KIT_RESALE - serviceQuote(row).parts));
}
/** The kit as the log reads it: every fitted part, or that it is as it left the factory. */
export function kitLines(row) {
  const k = rowKit(row), on = Object.keys(PODRACER_KIT).filter((s) => k[s] != null);
  return on.length ? on.map((s) => kitLine(s, k[s])).join(', ') : 'factory spec';
}
/** The fitting shop's menu, for the log rung and a bare `podracer fit`. */
export function fitMenu(row) {
  const t = typeOf(row.type_id), k = rowKit(row);
  const lines = Object.entries(PODRACER_KIT).map(([id, s]) => {
    const now = kitValue(k, id);
    const opts = s.kind === 'tiers'
      ? KIT_TIERS.map((w, i) => `${i === now ? '<b>' : ''}${i} ${w.toLowerCase()}${i ? ' ' + money(s.cost[i] * t.price) : ''}${i === now ? '</b>' : ''}`).join(' · ')
      : Object.entries(s.choices).map(([cid, c]) => `${cid === now ? '<b>' : ''}${cid}${c.cost ? ' ' + money(c.cost * t.price) : ''}${cid === now ? '</b>' : ''}`).join(' · ');
    return `  <span class="text-cyan">${id}</span> ${dim(s.label)}: ${opts}`;
  });
  return say(`<span class="text-cyan">THE FITTING SHOP</span> ${dim(`· ${row.name || t.name} · ${kitLines(row)}`)}\n${lines.join('\n')}`
    + `\n${dim(`<b>podracer fit ${row.id} engine=race boost=2 arc=green</b>. A part costs the difference in all; one taken off goes back at ${Math.round(PART_EXCHANGE * 100)}% of what it cost, less ${money(FIT_LABOUR * t.price)} labour a part.`)}`);
}

export const rowCables = (row) => { const c = row?.custom_data?.cables; return Array.isArray(c) ? [c[0] !== false, c[1] !== false] : [true, true]; };
export const hireOf = (row) => row?.custom_data?.rental || null;
export const hireLeft = (row) => Math.max(0, (Number(hireOf(row)?.until) || 0) - Date.now());
const fmtLeft = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

export async function myRacers(playerId) {
  const r = await query('SELECT * FROM podracers WHERE owner_id = $1 ORDER BY created_at', [playerId]);
  return r.rows;
}

/**
 * The player's racer parked where they stand, or the one named by `id` if it is parked here.
 * In the racer bay that is the room itself; out on the waste it is the tile.
 */
//
// `{ strangers: true }` (climbing in) also takes somebody else's, left unlocked on an open tile
// (vehicle-access.js boardCheck); yours come first. Every other verb is about your own.
export async function racerHere(player, id = null, { strangers = false } = {}) {
  const r = await query(`SELECT * FROM podracers WHERE park_zone = $1 AND ($2::text IS NULL OR id = $2)
      AND (owner_id = $3 OR $4) ORDER BY (owner_id = $3) DESC, created_at`, [player.current_zone, id, player.id, strangers]);
  return r.rows.find((row) => row.owner_id === player.id
    || boardCheck(player, { ownerId: row.owner_id, cd: row.custom_data, zoneId: row.park_zone }).ok) || null;
}
/** Somebody else's racer locked where you stand, for the refusal. */
export async function lockedRacerHere(player) {
  const r = await query('SELECT * FROM podracers WHERE park_zone = $1 AND owner_id <> $2 LIMIT 1', [player.current_zone, player.id]);
  return r.rows[0] || null;
}
/** The latch from outside: `unlock racer` beside it. Guarded on the owner. */
export async function setRacerLocked(id, ownerId, locked) {
  const r = await query(`UPDATE podracers SET custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{locked}', to_jsonb($3::boolean))
    WHERE id = $1 AND owner_id = $2`, [id, ownerId, !!locked]);
  return r.rowCount > 0;
}

/**
 * Hires that have run out go back, unless one is being driven. Returns the names that went.
 * The lazy clock the boat hire uses: no tick, it is asked whenever somebody looks.
 */
export async function sweepHires(playerId, seatedId = null) {
  const rows = await myRacers(playerId);
  const gone = [];
  for (const b of rows) {
    if (!hireOf(b) || hireLeft(b) > 0 || b.id === seatedId) continue;
    const r = await query("DELETE FROM podracers WHERE id = $1 AND owner_id = $2 AND custom_data->'rental' IS NOT NULL", [b.id, playerId]).catch(() => ({ rowCount: 0 }));
    if (r.rowCount) gone.push(b.name || typeOf(b.type_id)?.name || 'the hire');
  }
  return gone;
}

// What fixing a racer costs: hull, both turbines, any snapped cable and a torn binder, plus the fuel
// it is short.
export function serviceQuote(row) {
  const t = typeOf(row.type_id);
  if (!t) return { total: 0, parts: 0, fuel: 0 };
  const eng = rowEng(row), cables = rowCables(row);
  const wear = (1 - clamp01(row.condition)) + (1 - eng[0]) + (1 - eng[1]) + cables.filter((c) => !c).length * 0.5
    + (rowBinder(row) ? 0 : 1.5);
  const parts = Math.round(wear * t.price * SERVICE_SHARE / 3);
  const fuel = Math.round((1 - clamp01(row.fuel)) * FUEL_PER_TANK);
  return { total: parts + fuel, parts, fuel };
}

export function stockLines() {
  return Object.entries(PODRACER_TYPES).map(([id, t]) =>
    `  <span class="text-cyan">${t.name}</span> <span class="text-dim">(${id})</span>: <span class="text-green">${money(t.price)}</span>, or hire one for ${money(hireFee(t))}`
    + `\n    ${dim(t.blurb)}`).join('\n');
}

const pickType = (arg) => {
  const want = String(arg || '').trim().toLowerCase();
  return Object.entries(PODRACER_TYPES).find(([id, t]) => !want || id === want || t.name.toLowerCase().includes(want)) || null;
};

export async function buyRacer(player, arg) {
  const here = getZone(player.current_zone);
  if (!isLot(here)) return say(dim('Racers are sold in the racer bay at the Deadleg, out in the Scarletwastes.'));
  const entry = pickType(arg);
  if (!entry) return say(dim(`Nothing in the bay called "${arg}".`));
  const [typeId, t] = entry;
  if ((player.credits ?? 0) < t.price) {
    return say(`<span class="text-red">${money(t.price)}.</span> ${dim(`You have ${money(player.credits ?? 0)}.`)}`);
  }
  if (!(await adjustCredits(player, -t.price, query, 'podracer purchase'))) return say(dim('The money does not go through.'));
  const id = `pod_${player.id}_${Date.now().toString(36)}`;
  await query(
    `INSERT INTO podracers (id, type_id, name, owner_id, park_zone, fuel, condition, custom_data)
     VALUES ($1, $2, $3, $4, $5, 1, 1, '{}'::jsonb)`,
    [id, typeId, t.name, player.id, here.id]);
  noteFreshVehicle(player.id, id);
  return say(`<span class="text-green">Bought.</span> A ${t.name}, both turbines sound, tank full.`
    + `\n${dim(`It is up on the blocks in the bay. <b>podracer</b> climbs in and it comes out through the shed door. ${money(t.price)} gone.`)}`);
}

export async function hireRacer(player, arg) {
  const here = getZone(player.current_zone);
  if (!isLot(here)) return say(dim('Racers are hired out of the racer bay at the Deadleg.'));
  const entry = pickType(arg);
  if (!entry) return say(dim(`Nothing in the bay called "${arg}".`));
  const [typeId, t] = entry;
  const rows = await myRacers(player.id);
  if (rows.some((r) => hireOf(r))) return say(dim('You already have one out on hire. Bring it back first: <b>podracer return</b>.'));
  const fee = hireFee(t);
  if ((player.credits ?? 0) < fee) return say(`<span class="text-red">${money(fee)}.</span> ${dim(`You have ${money(player.credits ?? 0)}.`)}`);
  if (!(await adjustCredits(player, -fee, query, 'podracer hire'))) return say(dim('The money does not go through.'));
  const id = `pod_${player.id}_${Date.now().toString(36)}`;
  await query(
    `INSERT INTO podracers (id, type_id, name, owner_id, park_zone, fuel, condition, custom_data)
     VALUES ($1, $2, $3, $4, $5, 1, 1, jsonb_build_object('rental', jsonb_build_object('until', $6::bigint, 'fee', $7::int)))`,
    [id, typeId, 'Hire ' + t.name, player.id, here.id, Date.now() + HIRE_MS, fee]);
  noteFreshVehicle(player.id, id);
  return say(`<span class="text-green">Hired.</span> A ${t.name} for ${HIRE_MS / 3600000} hours, fuelled and sound.`
    + `\n${dim(`<b>podracer</b> climbs in. Bring it back to the bay with <b>podracer return</b>. ${money(fee)} gone.`)}`);
}

export async function returnRacer(player, id = null) {
  const here = getZone(player.current_zone);
  if (!isLot(here)) return say(dim('A hire goes back to the racer bay at the Deadleg.'));
  const rows = (await myRacers(player.id)).filter((r) => hireOf(r) && r.park_zone === here.id && (!id || r.id === id));
  if (!rows.length) return say(dim('You have no hire racer in the bay to hand back.'));
  await query('DELETE FROM podracers WHERE id = $1 AND owner_id = $2', [rows[0].id, player.id]);
  return say('You hand the hire back. Somebody puts it up on the blocks and starts checking the cables before you are out of the door.');
}

export async function sellRacer(player, id = null) {
  const here = getZone(player.current_zone);
  if (!isLot(here)) return say(dim('The racer bay at the Deadleg is the only place that buys racers.'));
  const row = await racerHere(player, id);
  if (!row) return say(dim('You have no racer in the bay to sell.'));
  if (hireOf(row)) return say(dim('That one is a hire. It goes back with <b>podracer return</b>.'));
  const t = typeOf(row.type_id);
  const offer = resaleOf(row);
  const del = await query('DELETE FROM podracers WHERE id = $1 AND owner_id = $2', [row.id, player.id]);
  if (!del.rowCount) return say(dim('The yard cannot find the paperwork.'));
  await adjustCredits(player, offer, query, 'podracer sale');
  return say(`They give you <span class="text-green">${money(offer)}</span> for the ${row.name || t?.name || 'racer'} and start taking it apart before you have counted it.`);
}

/**
 * Repair the pod, true both turbines, re-splice the cables and fill the tank, in the bay. `row` is
 * the racer, already found by the caller: the one parked in the bay you are standing in, or the one
 * you are sitting in on the bay door (seat.js).
 */
export async function serviceRow(player, row) {
  const q = serviceQuote(row);
  if (!q.total) return { ok: false, out: say(dim('Nothing to do. Both turbines are sound, the cables are whole and the tank is full.')) };
  const welded = !rowBinder(row);
  if ((player.credits ?? 0) < q.total) {
    return { ok: false, out: say(`The yard wants <span class="text-red">${money(q.total)}</span> ${dim(`(parts ${money(q.parts)}, fuel ${money(q.fuel)}). You have ${money(player.credits ?? 0)}.`)}`) };
  }
  if (!(await adjustCredits(player, -q.total, query, 'podracer service'))) return { ok: false, out: say(dim('The money does not go through.')) };
  await query(
    `UPDATE podracers SET condition = 1, fuel = 1,
       custom_data = COALESCE(custom_data, '{}'::jsonb) - 'eng' - 'cables' - 'binder'
     WHERE id = $1`, [row.id]);
  return { ok: true, out: say((welded ? 'The yard welds a new binder in between the turbines and gets it arcing again, then re-splices the cables, trues the turbines and fills it. '
    : 'The yard re-splices the cables, trues the turbines and fills it. ') + `<span class="text-green">${money(q.total)}</span>.`) };
}

/**
 * The yard fetches one of your racers back to this bay from wherever it was left: a torn binder out
 * on the waste is the usual reason. `seatedId` is the racer you are sitting in, which cannot be fetched.
 */
export async function recoverRacer(player, id = null, seatedId = null) {
  const here = getZone(player.current_zone);
  if (!isLot(here)) return say(dim('The racer bay at the Deadleg sends a truck out for stranded racers. Ask there.'));
  const away = (await myRacers(player.id)).filter((r) => r.park_zone !== here.id && r.id !== seatedId && (!id || r.id === id));
  if (!away.length) return say(dim(id ? 'That one is not out anywhere to be fetched.' : 'You have no racer out on the waste to fetch.'));
  // The torn one first: that is the one that cannot come home on its own.
  const row = away.find((r) => !rowBinder(r)) || away[0];
  const t = typeOf(row.type_id);
  const fee = t ? recoverFee(t) : 0;
  if ((player.credits ?? 0) < fee) return say(`The recovery truck is <span class="text-red">${money(fee)}</span>. ${dim(`You have ${money(player.credits ?? 0)}.`)}`);
  if (fee && !(await adjustCredits(player, -fee, query, 'podracer recovery'))) return say(dim('The money does not go through.'));
  const where = getZone(row.park_zone)?.name || 'out on the waste';
  await query(`UPDATE podracers SET park_zone = $2, custom_data = COALESCE(custom_data, '{}'::jsonb) - 'heading' WHERE id = $1`, [row.id, here.id]);
  noteGone('racer', row.id);
  return say(`The yard sends the flatbed out to ${where} and brings the ${row.name || t?.name || 'racer'} back on its back, turbines strapped down either side. It is up on the blocks in the bay. <span class="text-green">${money(fee)}</span>.`
    + (rowBinder(row) ? '' : `\n${dim('The binder is still torn out. <b>podracer service</b> welds it.')}`));
}

export async function listRacers(player) {
  const rows = await myRacers(player.id);
  if (!rows.length) return say(dim('You do not own a racer. The racer bay at the Deadleg sells and hires them.'));
  return say(`<span class="text-cyan">YOUR RACERS</span>\n${rows.map(racerLine).join('\n')}`);
}

// One racer as a line of the log: the prose version of its card.
export function racerLine(r) {
  const z = getZone(r.park_zone);
  const eng = rowEng(r), snapped = rowCables(r).filter((c) => !c).length, torn = !rowBinder(r);
  const hire = hireOf(r) ? `, hired, ${fmtLeft(hireLeft(r))} left` : '';
  return `  <span class="text-cyan">${r.name || typeOf(r.type_id)?.name || 'racer'}</span> <span class="text-dim">(${r.id})</span> at ${z?.name || 'somewhere'}`
    + dim(`  pod ${Math.round(clamp01(r.condition) * 100)}%, turbines ${Math.round(eng[0] * 100)}/${Math.round(eng[1] * 100)}%, fuel ${Math.round(clamp01(r.fuel) * 100)}%`
      + (snapped ? `, ${snapped} cable${snapped > 1 ? 's' : ''} snapped` : '') + (torn ? ', binder torn out' : '') + hire
      + (Object.keys(rowKit(r)).length ? `\n    fitted: ${kitLines(r)}` : ''));
}

// ── The counter's payload ───────────────────────────────────────────────────
//
// Built for the room the player is standing in, which must be a lot. Every number in it is one
// `racerLine` and the verbs print, so the screen and the log cannot disagree.
//
// A truck shed that only keeps racers gets the same payload with `sells` false, for the bay overlay
// on the seat: the way in and out, and none of the yard's work.
export async function racerPanel(player, zoneId, { seatedId = null } = {}) {
  const here = getZone(zoneId);
  if (!isGarage(here)) return null;
  const rows = await myRacers(player.id);
  const fleet = rows.map((r) => {
    const t = typeOf(r.type_id);
    const z = getZone(r.park_zone);
    const q = serviceQuote(r);
    return {
      id: r.id, typeId: r.type_id, name: r.name || t?.name || 'racer', typeName: t?.name || r.type_id,
      hull: clamp01(r.condition), eng: rowEng(r), cables: rowCables(r), fuel: clamp01(r.fuel), binder: rowBinder(r),
      recoverFee: t ? recoverFee(t) : 0,
      livery: racerLiveryOf(r), scheme: schemeOfLivery(racerLiveryOf(r)), paintPrice: t ? paintPrice(t) : 0, insidePrice: t ? insidePrice(t) : 0,
      factory: t?.factory || null,
      // The fitting shop's: what is on it, and what the yard would give for it with the racer.
      kit: rowKit(r), kitWorth: t ? kitWorth(rowKit(r), t.price) : 0,
      inYard: r.park_zone === zoneId, aboard: r.id === seatedId,
      where: z?.name || 'somewhere out on the waste',
      rental: hireOf(r) ? { leftText: fmtLeft(hireLeft(r)) } : null,
      quote: q,
      resale: resaleOf(r),
    };
  });
  const credits = Number(player.credits || 0);
  return {
    type: 'podracer_depot', schemes: PODRACER_SCHEMES, finishes: PAINT_FINISHES, inside: INSIDE_OPTIONS,
    name: here.flags?.building_name ? here.flags.building_name + ': racers' : here.name,
    hereName: here.name, credits, fleet, sells: isLot(here),
    stock: Object.entries(PODRACER_TYPES).map(([id, t]) => ({ id, name: t.name, price: t.price, blurb: t.blurb, topSpeed: t.topSpeed })),
    rentStock: Object.entries(PODRACER_TYPES).map(([id, t]) => ({ id, name: t.name, fee: hireFee(t), hours: HIRE_MS / 3600000, afford: credits >= hireFee(t) })),
    hasRental: rows.some((r) => hireOf(r)),
    exits: allExits(here).map(({ dir, target }) => {
      const n = getZone(target)?.name || dir, b = here.flags?.building_name;
      return { dir, name: b && n.startsWith(b + ' — ') ? n.slice(b.length + 3) : n };
    }),
  };
}

// ── Racers in somebody else's shed ──────────────────────────────────────────
//
// The `depot.parked` hook: a truck depot's counter asks what of the player's is standing in its
// tiles that it doesn't keep itself, and deals each one as a card on its hand. Each card says which
// verb seats you, so the truck counter needs to know nothing about racers. `zoneIds` is the depot's
// tiles; a racer is kept in the bay room, which is one of them.
export async function parkedCards(player, zoneIds) {
  if (!player?.id || !zoneIds?.length) return [];
  const r = await query('SELECT * FROM podracers WHERE owner_id = $1 AND park_zone = ANY($2) ORDER BY created_at', [player.id, zoneIds]);
  return r.rows.filter((row) => typeOf(row.type_id)).map((row) => {
    const t = typeOf(row.type_id);
    const eng = rowEng(row), hull = clamp01(row.condition), fuel = clamp01(row.fuel);
    const why = !rowBinder(row) ? 'binder torn out: the racer bay at the Deadleg can fetch it'
      : hull <= 0 || eng.every((e) => e <= 0) ? 'needs the racer bay before it goes anywhere'
      : fuel <= 0 ? 'dry: the racer bay fills it' : null;
    const hire = hireOf(row);
    return {
      id: row.id, kind: 'podracer', name: row.name || t.name, typeName: t.name,
      sub: why || `racer · pod ${Math.round(hull * 100)}% · fuel ${Math.round(fuel * 100)}%`,
      cond: hull, cmd: why ? null : `podracer take ${row.id}`, why, verb: 'Climb in',
      hire: hire ? fmtLeft(hireLeft(row)) : null,
      v: { cls: 'podracer', variant: row.type_id, yaw: 0.7, fit: 2.1, elev: 0.3, ...(racerLiveryOf(row) ? { livery: racerLiveryOf(row) } : {}) },
    };
  });
}
