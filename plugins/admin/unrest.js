// Unrest from the Admin app and `sysop unrest`. The unrest plugin owns the sim
// (docs/systems-unrest.md); this reads its ledger and calls the same functions the
// devpanel's Unrest routes do, so the two always agree. Staff only, like the rest
// of the app: rule 2 bans a PLAYER readout, and every caller re-checks the role.
//
// The words are the tracker's whole point. grip, heat and pressure are shown as
// Crackdown, Trouble and Grievance, a cell is named by its part of town and its
// biggest building, and every refusal reason from the incident gate is said in a
// sentence, because a staff member who has never read the design doc is who this is for.
import { world } from '../../server/engine/world.js';
import { bearing } from '../../server/engine/map-text.js';
import { logActivity } from '../../server/models/db.js';
import { ensureLoaded } from '../unrest/index.js';
import * as ledger from '../unrest/ledger.js';
import * as signals from '../unrest/signals.js';
import * as incidents from '../unrest/incidents.js';
import { roles, driverNameFor, readClock, nightOpen, nightTarget } from '../unrest/roles.js';
import { allBlocks, blockInfo, blockOf, BLOCK } from '../unrest/blocks.js';
import { cityCentre } from '../unrest/voice.js';

// level is what the tablet's grid and meters colour by: 0 calm to 3 alarming.
export const BANDS = {
  quiet: { label: 'Quiet', icon: '🟢', level: 0 },
  watchful: { label: 'Watchful', icon: '🟡', level: 1 },
  tense: { label: 'Tense', icon: '🟠', level: 2 },
  flashpoint: { label: 'Flashpoint', icon: '🔴', level: 3 },
};
const RANK = ['quiet', 'watchful', 'tense', 'flashpoint'];

export const SCALARS = {
  grip: { label: 'Crackdown', what: 'how hard the authority is squeezing. Fades over about 3 hours.' },
  heat: { label: 'Trouble', what: 'trouble on the street. Fades in about 20 minutes unless something keeps it going.' },
  pressure: { label: 'Grievance', what: 'builds under the crackdown over days. Past boiling point the block kicks off, and that spends it.' },
};

// The gate's refusal codes (roles.js, incidents.js), said plainly.
const WHY = {
  band: 'the block is too calm for it',
  signal: "nobody has seen this order's mark here in the last 6 hours",
  grip: 'the crackdown here is too light for the Null to bother',
  clock: 'the Wildblood only come at night (22:00 to 04:00)',
  elsewhere: 'tonight the Wildblood come up somewhere else',
  withdrawn: 'its order stays out of the fight',
  'no-order': 'its order is missing from content',
  occupied: 'something is already happening here',
  cooldown: 'it happened here recently',
};
export const whyText = (code) => WHY[code] || code;

// ── Naming a cell ────────────────────────────────────────────────────────────

const PART = {
  north: 'North end', south: 'South end', east: 'East side', west: 'West side',
  'north-east': 'North-east', 'north-west': 'North-west', 'south-east': 'South-east', 'south-west': 'South-west',
};

/** A cell's part of town, from the centre of the built city. Stable, unlike voice.js's spoken form. */
export function partOf(key) {
  const b = blockInfo(key);
  const c = cityCentre();
  if (!b || !c) return 'Centre';
  const dx = b.cx - c.cx, dy = b.cy - c.cy;
  if (Math.abs(dx) < BLOCK / 2 && Math.abs(dy) < BLOCK / 2) return 'Centre';
  return PART[bearing(dx, dy)] || 'Centre';
}

// The building with the most rooms in the cell, as a landmark staff will know, or
// failing a building its commonest street. Staff only: players never hear a cell
// named (systems-unrest.md, Perceivability).
const landmarks = new Map();
export function landmarkOf(key) {
  if (landmarks.has(key)) return landmarks.get(key);
  const top = (pick) => {
    const n = new Map();
    for (const id of blockInfo(key)?.zones || []) {
      const name = pick(world.zones.get(id));
      if (name) n.set(name, (n.get(name) || 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
  };
  const best = top(z => z?.flags?.building_name) || top(z => (z?.map_id === 'map_world' ? z.name : null));
  landmarks.set(key, best);
  return best;
}

export const cellName = (key) => {
  const lm = landmarkOf(key);
  return `${partOf(key)}${lm ? `, by ${lm}` : ''}`;
};

/** Which order an incident belongs to, by its authored role. Never an org id in code. */
function orderOf(def) {
  const clockDriven = driverNameFor(def) === 'incursion';
  const r = roles().find(x => x.writes === def.writes && (x.reads === 'clock') === clockDriven);
  return r ? (world.orgs.get(r.id)?.name || r.id) : null;
}

const orderFor = (writes) => {
  const r = roles().find(x => x.writes === writes && x.reads !== 'clock');
  return r ? (world.orgs.get(r.id)?.name || r.id) : null;
};

const minsLeft = (endsAt) => Math.max(0, Math.round((endsAt - Date.now()) / 60000));
const ago = (at) => {
  if (!at) return 'never';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

// ── Views ────────────────────────────────────────────────────────────────────

/** One cell, everything the tracker shows about it. Sync after ensureLoaded; no query. */
function cellRow(key, here) {
  const r = ledger.read(key);
  const band = ledger.bandOf(key);
  const [bx, by] = key.split(',').map(Number);
  const live = incidents.liveIncidents().filter(i => i.key === key);
  return {
    key, bx, by, band, here: key === here,
    score: Math.round(ledger.scoreOf(key)),
    grip: Math.round(r.grip), heat: Math.round(r.heat), pressure: Math.round(r.pressure),
    lit: !!r.lit, part: partOf(key), landmark: landmarkOf(key), name: cellName(key),
    about: signals.dominantWrites(key), live,
  };
}

/** What a cell is doing now and what it does next, in a sentence. */
function outlook(c) {
  if (c.lit) return `Burning. It keeps going until grievance falls below ${ledger.IGNITE_LO}.`;
  if (c.pressure > ledger.IGNITE_HI) return 'Past boiling point. It kicks off on the next tick.';
  if (c.band !== 'quiet' && c.about === 'grip') return 'Aftermath. The trouble is over and the crackdown is still on the street.';
  if (c.band !== 'quiet') return 'Simmering down. Trouble fades in about 20 minutes once nothing feeds it.';
  if (c.pressure >= ledger.IGNITE_HI * 0.6) return `Building. Grievance is ${c.pressure} of ${ledger.IGNITE_HI}, the boiling point.`;
  return 'Calm. Nothing is building here.';
}

export async function cityView(player) {
  await ensureLoaded();
  const here = blockOf(player?.current_zone);
  const cells = allBlocks().map(k => cellRow(k, here));
  const clock = readClock();
  const open = nightOpen(clock);
  const target = open ? nightTarget(clock) : null;
  const live = incidents.liveIncidents().map(i => ({
    instanceId: i.instanceId, name: i.name, key: i.key, place: cellName(i.key), minsLeft: minsLeft(i.endsAt),
  }));
  const worst = cells.reduce((w, c) => (RANK.indexOf(c.band) > RANK.indexOf(w) ? c.band : w), 'quiet');
  return {
    cells, live, cap: incidents.MAX_LIVE, worst, here,
    wildblood: { open, target, place: target ? cellName(target) : null },
  };
}

export async function cellView(player, key) {
  await ensureLoaded();
  if (!allBlocks().includes(key)) return null;
  const c = cellRow(key, blockOf(player?.current_zone));
  const now = Date.now();
  const clock = readClock();
  const catalogue = incidents.getCatalogue().map(def => {
    const why = incidents.eligible(def, key, now, clock);
    return { id: def.id, name: def.name, order: orderOf(def), why, whyText: why ? whyText(why) : null };
  });
  return {
    ...c,
    outlook: outlook(c),
    signals: { heat: signals.lastSignalAt(key, 'heat'), grip: signals.lastSignalAt(key, 'grip') },
    orders: { grip: orderFor('grip'), heat: orderFor('heat') },
    catalogue,
    zones: blockInfo(key)?.zones.length || 0,
  };
}

export const signalAgo = ago;

// ── Changes ──────────────────────────────────────────────────────────────────
// Each returns { ok, message } or { ok: false, error }, like the other sysop areas.

/** "here", or a cell key like 7,8. */
export function resolveCell(player, arg) {
  const a = String(arg || '').trim().toLowerCase();
  if (a === 'here') return blockOf(player?.current_zone);
  return allBlocks().includes(a) ? a : null;
}

const moodLine = (key) => `It's ${BANDS[ledger.bandOf(key)].label.toLowerCase()} now.`;

export async function setScalar(player, key, scalar, value) {
  await ensureLoaded();
  if (!SCALARS[scalar]) return { ok: false, error: 'Set grip, heat or pressure.' };
  if (!allBlocks().includes(key)) return { ok: false, error: `No block "${key}".` };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'A value from 0 to 100.' };
  ledger.force(key, { [scalar]: n });
  await ledger.flush();
  logActivity('admin_cmd', player.handle, null, `unrest ${key} ${scalar} ${n}`);
  return { ok: true, message: `${SCALARS[scalar].label} in ${cellName(key)} set to ${Math.round(n)}. ${moodLine(key)}` };
}

/** Back to the baseline, with any burn put out. 'all' calms every block. Live incidents keep running. */
export async function calm(player, key) {
  await ensureLoaded();
  const keys = key === 'all' ? allBlocks() : [key];
  if (!keys.every(k => allBlocks().includes(k))) return { ok: false, error: `No block "${key}".` };
  for (const k of keys) ledger.force(k, { ...ledger.BASELINE, lit: false });
  await ledger.flush();
  logActivity('admin_cmd', player.handle, null, `unrest calm ${key}`);
  return { ok: true, message: key === 'all' ? 'Every block is back to its baseline.' : `${cellName(key)} is back to its baseline.` };
}

/** Grievance just past boiling point, so the sim kicks the block off itself on its next tick. */
export async function stir(player, key) {
  await ensureLoaded();
  if (!allBlocks().includes(key)) return { ok: false, error: `No block "${key}".` };
  ledger.force(key, { pressure: Math.max(ledger.read(key).pressure, ledger.IGNITE_HI + 6) });
  await ledger.flush();
  logActivity('admin_cmd', player.handle, null, `unrest stir ${key}`);
  return { ok: true, message: `Grievance in ${cellName(key)} is past boiling point. It kicks off on the next tick, within half an hour, or now if you run one.` };
}

/** One whole tick of the sim, as the 30-minute schedule runs it: the ledger, the voices, then staging. */
export async function runTick(player) {
  await ensureLoaded();
  // Compared here rather than read off sweep(), which reports nothing on its first
  // call after a restart (it primes, so a deploy doesn't announce the whole city).
  const before = new Map(allBlocks().map(k => [k, ledger.bandOf(k)]));
  ledger.step(roles());
  await signals.sweep();
  const staged = await incidents.tick();
  await ledger.flush(true);
  logActivity('admin_cmd', player.handle, null, 'unrest tick');
  const moved = allBlocks().filter(k => before.get(k) !== ledger.bandOf(k)).map(k => {
    const to = ledger.bandOf(k);
    return `${cellName(k)} ${RANK.indexOf(to) > RANK.indexOf(before.get(k)) ? 'rose' : 'fell'} to ${to}`;
  });
  const parts = [moved.length ? `${moved.join('; ')}.` : 'No block changed mood.'];
  if (staged) parts.push(`${staged.name} started in ${cellName(staged.key)}.`);
  return { ok: true, message: `Ran one tick. ${parts.join(' ')}` };
}

/** Start an incident now. An ineligible one is forced, and the message says what it overrode. */
export async function stageIncident(player, key, incidentId) {
  await ensureLoaded();
  if (!allBlocks().includes(key)) return { ok: false, error: `No block "${key}".` };
  const def = incidents.getCatalogue().find(d => d.id === incidentId || d.id === `incident_${incidentId}`);
  if (!def) return { ok: false, error: `No incident "${incidentId}". Options: ${incidents.getCatalogue().map(d => d.id.replace(/^incident_/, '')).join(', ')}.` };
  // Asked directly, not read off the gate: the gate answers its first refusal, so a
  // calm block that is also occupied says 'band', and forcing past that would stack two.
  if (incidents.liveIncidents().some(i => i.key === key)) return { ok: false, error: `Something is already happening in ${cellName(key)}. End it first.` };
  const why = incidents.eligible(def, key);
  await incidents.stage(def, key);
  logActivity('admin_cmd', player.handle, null, `unrest stage ${def.id} ${key}${why ? ` (forced: ${why})` : ''}`);
  return { ok: true, message: `${def.name} started in ${cellName(key)}.${why ? ` Forced: ordinarily it wouldn't, because ${whyText(why)}.` : ''}` };
}

/** End a live incident by its instance id, or whatever is live in a block by the block's key. */
export async function endIncident(player, instanceId) {
  await ensureLoaded();
  const inc = incidents.liveIncidents().find(i => i.instanceId === instanceId || i.key === instanceId);
  if (!inc) return { ok: false, error: 'That incident has already ended.' };
  await incidents.teardown(inc.instanceId);
  logActivity('admin_cmd', player.handle, null, `unrest end ${inc.defId} ${inc.key}`);
  return { ok: true, message: `${inc.name} in ${cellName(inc.key)} is over. Everything it put up has come down.` };
}

// ── The typed form ───────────────────────────────────────────────────────────

export async function unrestText(player, key) {
  if (key) {
    const c = await cellView(player, key);
    if (!c) return `No block "${key}".`;
    return [
      `<b>${c.name}</b> (${c.key}): ${BANDS[c.band].label.toUpperCase()}${c.here ? ' · you are here' : ''}`,
      `Crackdown ${c.grip} · Trouble ${c.heat} · Grievance ${c.pressure}/${ledger.IGNITE_HI}`,
      c.outlook,
      ...c.live.map(i => `Live: ${i.name}, ${minsLeft(i.endsAt)} min left (${i.instanceId})`),
    ].join('<br>');
  }
  const v = await cityView(player);
  const lines = [...v.cells].sort((a, b) => b.score - a.score).map(c =>
    `${BANDS[c.band].icon} <b>${c.key}</b> ${c.name}: ${BANDS[c.band].label}${c.lit ? ', burning' : ''}${c.live.length ? `, ${c.live[0].name}` : ''}${c.here ? ' (you)' : ''}`);
  return [`<b>Unrest</b>: worst is ${v.worst} · ${v.live.length}/${v.cap} incidents live`, ...lines].join('<br>');
}
