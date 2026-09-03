// The three scalars, and the only writer of the `unrest_ledger` world flag.
//
// RAM-authoritative with write-behind. Not a new table: the payload is ~10 cells
// x 4 numbers, which does not justify a schema change, a registry entry, a boot
// load and a read-tier decision. Not pure RAM either — this repo deploys on every
// push to main, and a ledger that resets on every deploy IS a stateless roll with
// extra steps. `plugins/jobboard/index.js` is the precedent for the shape.
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { allBlocks, blockInfo, neighboursOf } from './blocks.js';

export const FLAG = 'unrest_ledger';
export const VERSION = 1;

// ⚠ Version from the start. The cell KEY changes if the districts are ever
// painted and this file starts keying by district, and a v1 blob keyed by block
// must be discarded rather than read as though it meant districts.
export const BASELINE = { grip: 10, heat: 5, pressure: 0 };

// Half-lives, in minutes. "State the period or it isn't designed": heat moves in
// tens of minutes, grip in hours, pressure over days, so a full cycle is legible
// across about a week with a visible swing inside a 1-2 hour session. A cycle
// longer than a play session is invisible.
const HALF_LIFE_MIN = { grip: 180, heat: 20, pressure: 4320 };

const clamp = (n) => Math.max(0, Math.min(100, n));
const nowMs = () => Date.now();

/** RAM state: key -> { grip, heat, pressure, at } */
const cells = new Map();
let loaded = false;
let dirty = false;

const fresh = () => ({ ...BASELINE, lit: false, at: nowMs() });

// ── Decay on READ, never on a tick ───────────────────────────────────────────
// An idle-gated decay tick means you log in to exactly the state you left, and
// `runWhenEmpty` pins Neon compute awake billing for nobody. Lazy decay is the
// `decayRep` pattern and costs nothing when nobody is looking.
//
// ⚠ Monotone toward baseline and never across it: an exponential approach can
// only ever close the gap, so a value above baseline stays above it and one below
// stays below. Regress asserts this, because an overshoot here reads as the sim
// spontaneously producing tension.
function decayed(row) {
  const minutes = (nowMs() - (row.at || 0)) / 60000;
  if (minutes <= 0) return row;
  // ⚠ `lit` is CARRIED, never rebuilt. decayed() returns a new row, so a flag
  // left off here is a burn that ends on the next read that happens to decay it,
  // which is every read, lazily, from anywhere.
  const out = { at: nowMs(), lit: !!row.lit };
  for (const k of ['grip', 'heat', 'pressure']) {
    const base = BASELINE[k];
    const gap = (row[k] ?? base) - base;
    out[k] = clamp(base + gap * Math.pow(0.5, minutes / HALF_LIFE_MIN[k]));
  }
  return out;
}

function rowFor(key) {
  if (!cells.has(key)) cells.set(key, fresh());
  const next = decayed(cells.get(key));
  cells.set(key, next);
  return next;
}

/** Read a cell's live scalars. Sync — safe from any path. */
export function read(key) {
  return { ...rowFor(key) };
}

/** Add to one scalar. Sync; the write reaches the DB on the next flush. */
export function bump(key, scalar, delta) {
  if (!(scalar in BASELINE)) throw new Error(`unrest: unknown scalar "${scalar}"`);
  const row = rowFor(key);
  row[scalar] = clamp(row[scalar] + delta);
  dirty = true;
  return row[scalar];
}

/** Operator override, straight to a value. */
export function force(key, patch) {
  const row = rowFor(key);
  for (const k of ['grip', 'heat', 'pressure']) {
    if (patch[k] != null) row[k] = clamp(Number(patch[k]));
  }
  dirty = true;
  return { ...row };
}

// The band is what everything downstream keys on — never the raw numbers, which
// is rule 2 holding inside the code as well as at the client boundary.
export function bandOf(key) {
  const { grip, heat } = rowFor(key);
  const t = heat + grip * 0.5;
  if (t >= 70) return 'flashpoint';
  if (t >= 45) return 'tense';
  if (t >= 25) return 'watchful';
  return 'quiet';
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function load() {
  if (loaded) return;
  loaded = true;
  let blob = null;
  try { blob = JSON.parse((await getFlag('world', FLAG)) || 'null'); } catch { blob = null; }
  // Absent, unparseable or a version we do not own all rebuild from baselines
  // rather than throwing. A ledger is not worth a failed boot.
  if (!blob || blob.v !== VERSION || typeof blob.cells !== 'object') return;
  for (const [key, v] of Object.entries(blob.cells)) {
    cells.set(key, {
      grip: clamp(Number(v?.g) || 0),
      heat: clamp(Number(v?.h) || 0),
      pressure: clamp(Number(v?.p) || 0),
      lit: !!v?.l,
      at: Number(v?.t) || nowMs(),
    });
  }
}

export async function flush(fromTick = false) {
  if (!dirty) return false;
  dirty = false;
  const out = {};
  for (const [key, row] of cells) out[key] = { g: row.grip, h: row.heat, p: row.pressure, l: row.lit ? 1 : 0, t: row.at };
  await setFlag('world', FLAG, JSON.stringify({ v: VERSION, at: nowMs(), cells: out, fromTick }));
  return true;
}

// ── The forcing tick ─────────────────────────────────────────────────────────
// Role decides which scalar an order writes, and role is authored data on
// `orgs.flags.role` — never a switch statement in code. A symmetric tug-of-war is
// the wrong shape: "the Long Watch controls 60% of the Ashway" is nonsense for a
// resistance, so the authority raises grip and the insurgency raises heat and
// neither is the other's mirror.
const RATE = { authority: 0.60, pressure: 0.02, burn: 34, vent: 0.35 };

// ⚠ THE VENT IS THE ONLY NEGATIVE TERM IN THE LOOP, and without it there is no
// sim at all. grip drives pressure, pressure drives heat, heat drives grip: three
// positive couplings and a single fixed point, so the tick can only ever converge
// to it. It converged at band 10.7 — permanently quiet, in every cell, for ever —
// and no value of any rate changed that. Turning them up slid the fixed point
// straight past every band to a permanently pinned flashpoint with nothing in
// between, because a positive loop has no swing in it at any gain. Unrest venting
// the grievance that produced it is what lets a block come back down on its own.
//
// ⚠ AND THE IGNITION IS WHY IT CAN GO UP. Heat's half-life (20 min) is shorter
// than the tick (30 min), so heat keeps about a third of its gap per step and
// cannot accumulate: it is an algebraic function of whatever drove it that tick,
// never an integrator. Pressure is the only scalar slow enough to build, so the
// threshold has to live on pressure, and the response has to be ignition rather
// than a proportional push — which is what the word "flashpoint" already promised.
//
// Hysteresis, not a bare threshold: it burns until pressure falls well below the
// trigger, not until it falls back under it. A bare threshold self-limits AT the
// trigger and settles there, which is the fixed point again wearing a fuse.
export const IGNITE_HI = 46;
export const IGNITE_LO = 16;

// ⚠ IGNITE_HI must sit below pressure's own ceiling, and the ceiling is lower than
// it looks: pressure approaches `grip * RATE.pressure / (1 - 0.5 ** (30/4320))`,
// but the `grip` in that is a cell's RESTING grip, which is baseline plus what
// baseline heat keeps pushing into it — about 12.75, for a ceiling of 53. Set the
// trigger above that and no cell ever ignites, the entire city is silently dead,
// and every single-step assertion still passes. 46 leaves 13% of headroom, and it
// is thin enough that lowering RATE.authority would eat it. Regress derives the
// ceiling from the rates rather than hardcoding it, so retuning either knob
// re-checks this instead of quietly breaking it.

// Heat at which a sweep starts pushing into the next block. ⚠ Must sit below the
// peak a burn actually reaches (about 57), or this is a branch nothing can enter.
const DRIFT_AT = 45;

// Displacement goes to the adjacent cell with the LOWEST heat, ties broken by the
// order's authored `drift` bearing. One compass direction per order replaces the
// first draft's ordered district list: a single authored knob, and it survives the
// switch to districts unchanged.
const BEARING = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
  northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1],
};

function driftTarget(key, drift) {
  const near = neighboursOf(key);
  if (!near.length) return null;
  let best = null, bestHeat = Infinity;
  for (const k of near) {
    const h = rowFor(k).heat;
    if (h < bestHeat) { best = k; bestHeat = h; continue; }
    if (h === bestHeat && drift && BEARING[drift]) {
      const [bx, by] = key.split(',').map(Number);
      const [dx, dy] = BEARING[drift];
      if (k === `${bx + dx},${by + dy}`) best = k;
    }
  }
  return best;
}

/**
 * One step of the sim. `roles` is [{ id, writes, drift }] gathered from orgs by
 * index.js — this file never reads world state, so the tick is testable with a
 * hand-built roster and no world at all.
 */
export function step(roles = []) {
  const authority = roles.some(r => r.writes === 'grip');
  // ⚠ Insurgency is "writes heat AND reads local state", not merely "writes heat".
  // The Wildblood also write heat and are deliberately NOT part of this loop: they
  // fire off an external clock in a burst and leave no baseline behind, which is a
  // driver INTO the ledger rather than a participant in its cycle (phase 3). The
  // Null write `assets`, not ground, and never appear here at all.
  const insurgency = roles.filter(r => r.writes === 'heat' && r.reads === 'grip');

  for (const key of allBlocks()) {
    const row = rowFor(key);

    // Grievance charges under the squeeze and is VENTED by the unrest it
    // produces. A block that kicks off spends what it had been accumulating,
    // which is what sets both the recovery and the period.
    row.pressure = clamp(
      row.pressure
      + row.grip * RATE.pressure
      - Math.max(0, row.heat - BASELINE.heat) * RATE.vent
    );

    if (insurgency.length) {
      // Ignition, with hysteresis. `lit` is per-cell state and is persisted, so a
      // deploy in the middle of a burn does not quietly put the block out.
      if (!row.lit && row.pressure > IGNITE_HI) row.lit = true;
      else if (row.lit && row.pressure < IGNITE_LO) row.lit = false;

      if (row.lit) {
        row.heat = clamp(row.heat + RATE.burn);
        // A sweep pushes heat OUT of the cell it landed in.
        if (row.heat > DRIFT_AT) {
          const to = driftTarget(key, insurgency[0].drift);
          if (to) { const moved = row.heat * 0.15; row.heat = clamp(row.heat - moved); bump(to, 'heat', moved); }
        }
      }
    } else {
      // Nobody left to carry it. An order removed from content mid-burn puts the
      // block out, rather than leaving a fire with nobody behind it.
      row.lit = false;
    }

    // ⚠ Grip answers the heat THIS tick produced, not last tick's. A crackdown
    // arriving a full half hour late is what leaves a burn with no aftermath, and
    // the aftermath is the only phase in which grip is what a cell is about.
    if (authority) row.grip = clamp(row.grip + row.heat * RATE.authority * 0.1);

    row.at = nowMs();
  }
  dirty = true;
}

/** Everything the dev panel needs. Never reaches client/game — see rule 2. */
export function snapshot() {
  return allBlocks().map((key) => {
    const row = rowFor(key);
    const info = blockInfo(key);
    return {
      key,
      grip: Math.round(row.grip * 10) / 10,
      heat: Math.round(row.heat * 10) / 10,
      pressure: Math.round(row.pressure * 10) / 10,
      band: bandOf(key),
      lit: !!row.lit,
      zones: info?.zones.length ?? 0,
      cx: info?.cx ?? null,
      cy: info?.cy ?? null,
    };
  });
}

/** Test seam — drop RAM state so a suite can assert the load path. */
export function _reset() {
  cells.clear();
  loaded = false;
  dirty = false;
}

export const _test = { BASELINE, HALF_LIFE_MIN, RATE, DRIFT_AT, IGNITE_HI, IGNITE_LO, decayed, driftTarget };
