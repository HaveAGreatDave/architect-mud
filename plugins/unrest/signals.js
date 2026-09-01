// Perceivability — the first thing a player can notice.
//
// ⚠ Rule 1, signal before effect: an incident may not stage in a cell unless that
// cell carried a perceivable, ATTRIBUTABLE signal from the same order inside the
// preceding window. Heat rises, the walls and the gossip and the wire say so, and
// only then does the grip response fire. The player who walked past the tag
// yesterday reads today's checkpoint as consequence rather than as spawn noise.
// This file is where that record is kept; hadSignal() is what phase 1c asks.
//
// ⚠ Rule 2 still holds and is the reason none of this is a number. Every output
// here is a sentence in somebody's mouth or on somebody's wall. There is no verb,
// no gauge and no readout, and the moment there is one the sim becomes a
// dashboard to optimise and the flavour dies.
import { emit } from '../../server/engine/events.js';
import { world } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import * as pool from '../gossip/pool.js';
import * as ledger from './ledger.js';
import { blockOf, blockInfo, allBlocks } from './blocks.js';
import { ambientLine, crossingLine, streetLine, wireLine } from './voice.js';

const RANK = { quiet: 0, watchful: 1, tense: 2, flashpoint: 3 };

// How long a signal stays answerable for. A player who saw the walls yesterday
// evening should still read this morning's checkpoint as the reply to it; a week
// later they should not. Six hours of real time is about one long session.
export const SIGNAL_WINDOW_MS = 6 * 60 * 60 * 1000;

// Share of ambient ticks in a non-quiet cell that become an unrest line.
// ⚠ Deliberately low. fireHook keeps the LAST non-undefined result and load order
// is filesystem-alphabetical, so 'unrest' sorts after 'district-ambience' and
// would silently outrank it on every beat it answered. We abstain hard at
// baseline, abstain most of the time above it, and declare 'after' in the
// manifest so the ordering is a decision rather than an accident.
const AMBIENT_CHANCE = { watchful: 0.10, tense: 0.20, flashpoint: 0.35 };

// A player pacing back and forth over a block boundary must not get the beat on
// every step. The beat is about arriving somewhere, not about the boundary.
const CROSSING_COOLDOWN_MS = 4 * 60 * 1000;

/** cell key -> band, as of the last sweep. RAM only; see rule 6. */
const lastBand = new Map();
/** cell|writes -> ms of the last perceivable signal from that order. */
const signals = new Map();
/** player id -> { key, at } */
const seen = new Map();
let primed = false;

// ── The record rule 1 reads ──────────────────────────────────────────────────

/** Record that a cell carried an attributable signal from an order just now. */
export function noteSignal(key, writes, at = Date.now()) {
  if (!key || !writes) return;
  signals.set(`${key}|${writes}`, at);
}

/** Did this cell carry a signal from this order inside the window? */
export function hadSignal(key, writes, windowMs = SIGNAL_WINDOW_MS, now = Date.now()) {
  const at = signals.get(`${key}|${writes}`);
  return !!at && (now - at) <= windowMs;
}

export function lastSignalAt(key, writes) {
  return signals.get(`${key}|${writes}`) ?? null;
}

// ── Which order a cell's mood belongs to ─────────────────────────────────────
// Attribution is the difference between a signal and weather. A cell whose heat
// is what is really moving belongs to the insurgency; one whose grip is moving
// belongs to the authority. Keyed off the authored role's writes, never an org
// id, so a third order that squeezes needs no code here.
export function dominantWrites(key) {
  const row = ledger.read(key);
  const heatAbove = row.heat - ledger.BASELINE.heat;
  const gripAbove = row.grip - ledger.BASELINE.grip;
  return heatAbove >= gripAbove ? 'heat' : 'grip';
}

// An outdoor zone to hang a rumour on, so gossip's proximity weighting has
// somewhere real to measure from. Interiors are in the cell too (they inherit
// their facade's) but a rumour that originates inside a locked shop travels oddly.
export function anchorZone(key) {
  const info = blockInfo(key);
  if (!info?.zones.length) return null;
  for (const id of info.zones) {
    const z = world.zones.get(id);
    if (z && !z.flags?.is_interior && !z.flags?.is_apartment) return id;
  }
  return info.zones[0];
}

// ── The sweep ────────────────────────────────────────────────────────────────

/**
 * Compare every cell's band against the last sweep and speak the crossings.
 * Called from the forcing tick, never from inside an emit — that bus is
 * synchronous and swallows subscriber throws.
 *
 * ⚠ The FIRST call primes and fires nothing. Band memory is RAM only (rule 6:
 * persist the ledger, never the incidents), so after a restart every non-quiet
 * cell looks like a fresh crossing, and a deploy would announce the whole city
 * at once.
 */
export async function sweep() {
  const crossings = [];
  for (const key of allBlocks()) {
    const band = ledger.bandOf(key);
    const prev = lastBand.get(key);
    lastBand.set(key, band);
    if (prev === undefined || prev === band) continue;
    crossings.push({ key, from: prev, to: band, rising: RANK[band] > RANK[prev] });
  }

  if (!primed) { primed = true; return []; }

  for (const c of crossings) {
    c.writes = dominantWrites(c.key);
    const zone = anchorZone(c.key);
    // ⚠ script-triggers normalises the zone as payload.zone ?? payload.zoneId,
    // so this field must be named one of those or a trigger row's zone_id filter
    // silently never matches.
    emit('unrest.band.changed', { cell: c.key, zone, from: c.from, to: c.to, writes: c.writes });
    // Only a RISE gets a voice. A cell going quiet again is a real event and
    // other systems may want it, but "it has calmed down" is a line nobody in
    // this city would bother saying.
    if (c.rising && c.to !== 'quiet') await speak(c.key, c.to, c.writes, zone);
  }
  return crossings;
}

/** The two voices, said once, about the same thing, disagreeing. */
export async function speak(key, band, writes, zone = anchorZone(key)) {
  const street = streetLine(key, writes);
  if (street && zone) {
    pool.addItem({
      category: 'world', templateKey: 'rumor', vars: { text: street },
      zoneId: zone, heat: band === 'flashpoint' ? 0.9 : 0.75,
      reach: band === 'flashpoint' ? 5 : 3,
      capGroup: 'unrest', coalesceKey: `unrest|${key}|${writes}`,
    });
    noteSignal(key, writes);
  }
  // The wire only bothers above watchful. The Ascendants do not comment on a
  // quiet week, which is itself the tell when they suddenly do.
  if (band !== 'watchful') {
    const wire = wireLine(key, writes);
    // Dispatched BY NAME so this plugin never imports broadcast. A missing action
    // is not an error here: the wire is one of three voices, and a station that
    // is off the air must not take the street's word with it.
    if (wire) await dispatchAction({ type: 'broadcast.newsWire', params: { category: 'unrest', text: wire } });
  }
  return true;
}

// ── The room ─────────────────────────────────────────────────────────────────

/**
 * zone.describeAmbient. ⚠ HARD ABSTENTION AT BASELINE — returns undefined, never
 * null, on every quiet cell and on every zone the sim does not cover, so a city
 * that is not kicking off is exactly the city that shipped before this.
 */
export function describeAmbient(zone) {
  const key = blockOf(zone?.id);
  if (!key) return undefined;
  const band = ledger.bandOf(key);
  if (band === 'quiet') return undefined;
  if (Math.random() > (AMBIENT_CHANCE[band] ?? 0)) return undefined;
  const writes = dominantWrites(key);
  // A live incident speaks over the band's own lines while it stands, which is
  // the difference between "this block is tense" and "there is a checkpoint on
  // this block". Overrides are RAM only and are dropped by teardown.
  const over = ambientOverrides.get(key);
  const line = over?.lines?.length
    ? over.lines[Math.floor(Math.random() * over.lines.length)]
    : ambientLine(band, writes);
  if (!line) return undefined;
  // The player saw it, so it counts for rule 1.
  noteSignal(key, over?.writes || writes);
  return line;
}

// ── Incident ambient overrides ───────────────────────────────────────────────
// Held here rather than in incidents.js so `describeAmbient` stays one function
// with one lookup, and so incidents can depend on signals without signals having
// to depend back on incidents.
const ambientOverrides = new Map();   // cell key -> { lines, writes }

export function setAmbientOverride(key, lines, writes) {
  ambientOverrides.set(key, { lines: [...lines], writes });
}
export function clearAmbientOverride(key) {
  ambientOverrides.delete(key);
}
export function ambientOverrideAt(key) {
  return ambientOverrides.get(key) || null;
}

// ── The crossing beat ────────────────────────────────────────────────────────
// ⚠ HOT PATH. zone.entered fires on every move, so this stays synchronous and
// does two Map lookups. No awaits, no queries, nothing that can grow.

export function onEntered({ actor, zone }) {
  if (!actor?.id) return;
  const key = blockOf(zone);
  const was = seen.get(actor.id);
  if (!key) { if (was) seen.delete(actor.id); return; }
  const now = Date.now();
  if (was?.key === key) return;                              // same block: not a crossing
  seen.set(actor.id, { key, at: now });
  if (was && (now - was.at) < CROSSING_COOLDOWN_MS) return;  // pacing the boundary
  const band = ledger.bandOf(key);
  if (band === 'quiet') return;
  const line = crossingLine(band);
  if (!line) return;
  sendToPlayer(actor.id, { type: 'output', message: `<span class="msg-ambient">${line}</span>` });
  noteSignal(key, dominantWrites(key));
}

/** Test seam — drop everything this file remembers. */
export function _reset() {
  lastBand.clear();
  signals.clear();
  seen.clear();
  ambientOverrides.clear();
  primed = false;
}

export const _test = { RANK, lastBand, signals, seen, AMBIENT_CHANCE, CROSSING_COOLDOWN_MS, isPrimed: () => primed };
