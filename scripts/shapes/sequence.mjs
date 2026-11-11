// Every set, sequence and show in content/media_graphics, checked and built:
// each sequence against its set (checkSequence), each show against its sequences (checkShow), every
// set's mesh and every piece in SET_PIECES built with no GL, every shot's camera finite and in the
// room, each beat's lines filled from its show's samples with nothing left as a raw token, and a
// .bsm script read into beats. Needs no browser, database or network.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSet, SET_PIECES } from '../../client/game/js/panels/gl/set-mesh.js';
import { autoShot, roleMark as markOfRole, GFX, FRAMES, MOVES, checkSequence, checkShow, shotCamera, timeline, parseCamLabel, sequenceFromBsm, fill, passes, slotFor, tableRows, profileOf, castToken, resolveSet, checkSkin } from '../../client/shared/sequence.js';
import { sampleGame } from '../../plugins/broadcast/sports/sample-game.js';
import { factsAt, momentBeat } from '../../plugins/broadcast/sports/facts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const dir = join(ROOT, 'content', 'media_graphics'), docs = {};
for (const f of readdirSync(dir)) {
  const row = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (row.type === 'set' || row.type === 'sequence' || row.type === 'show') docs[row.id] = JSON.parse(row.content);
}
const bad = [];
// a skin is checked against its template, then everything below sees it resolved, as the game does
const rawSets = Object.fromEntries(Object.entries(docs).filter(([, d]) => d.kind === 'set'));
for (const s of Object.values(rawSets)) {
  bad.push(...checkSkin(s, (id) => rawSets[id]));
  docs[s.id] = resolveSet(s, (id) => rawSets[id]);
  if (s.base && !rawSets[s.base]?.template) bad.push(`${s.id}: built on ${s.base}, which isn't a template`);
  if (s.template && (s.uses?.length || s.broadcasts?.length)) bad.push(`${s.id}: a template stands in for no show; give a skin the uses and broadcasts`);
  for (const b of s.broadcasts || []) { try { readFileSync(join(ROOT, 'content', 'media_broadcasts', b + '.json')); } catch { bad.push(`${s.id}: made for ${b}, which isn't a broadcast`); } }
}
// two skins for one broadcast: only the first would ever be staged
const forBc = {};
for (const s of Object.values(rawSets)) for (const b of s.broadcasts || []) (forBc[b] ||= []).push(s.id);
for (const [b, ids] of Object.entries(forBc)) if (ids.length > 1) bad.push(`${b} has two sets: ${ids.join(', ')}`);
// a part a skin swaps for another piece still has to be a piece
for (const s of Object.values(docs)) if (s.kind === 'set') for (const p of s.pieces || []) if (p.type && !SET_PIECES[p.type]) bad.push(`${s.id}: part ${p.part || p.type} is a ${p.type}, which isn't a piece`);
const all = Object.values(docs), of = (k) => all.filter((d) => d.kind === k);

for (const [k, row] of Object.entries(SET_PIECES)) {
  try {
    const m = buildSet({ id: 'gate', room: { w: 10, d: 8, h: 4 }, pieces: [{ type: k, ...row.make, at: [0, 4] }], marks: {}, cameras: {} });
    if (!m.room.solid.n && !m.room.screen.n) bad.push(`piece ${k} drew nothing`);
  } catch (err) { bad.push(`piece ${k} threw: ${err.message}`); }
}

for (const set of of('set')) {
  try {
    const m = buildSet(set);
    if (!m.lamps.length) bad.push(`${set.id}: no lamps`);
  } catch (err) { bad.push(`${set.id} threw: ${err.message}`); }
  for (const p of set.pieces || []) if (!SET_PIECES[p.type]) bad.push(`${set.id}: no piece called ${p.type}`);
  const hu = set.room.w / 2;
  for (const [id, c] of Object.entries(set.cameras || {})) if (Math.abs(c.at[0]) > hu || c.at[1] < -2 || c.at[1] > set.room.d) bad.push(`${set.id}: camera ${id} is outside the room`);
  for (const [id, m] of Object.entries(set.marks || {})) if (Math.abs(m.at[0]) > hu || m.at[1] < 0 || m.at[1] > set.room.d) bad.push(`${set.id}: mark ${id} is outside the room`);
}

for (const seq of of('sequence')) {
  const set = docs[seq.set];
  bad.push(...checkSequence(seq, set));
  if (!set) continue;
  for (const b of seq.beats) for (const k of [0, 0.5, 1]) {
    const c = shotCamera(set, seq, b.shot, k, 1);
    if (![...c.eye, c.yaw, c.pitch, c.fov].every(Number.isFinite)) bad.push(`${seq.id} ${b.id}: a camera that isn't finite at ${k}`);
  }
}

// A show against what it'll really get: a sports entry against simulated games at each of its
// moments, anything else against its own samples. No raw token reaches a line or a graphic, every
// moment has something to say, and every slot plays in some game.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
for (const show of of('show')) {
  bad.push(...checkShow(show, docs));
  const cast = Object.fromEntries(Object.entries(show.cast || {}).map(([r, id]) => [r, { id, name: id }]));
  const row = show.broadcast ? JSON.parse(readFileSync(join(ROOT, 'content', 'media_broadcasts', show.broadcast + '.json'), 'utf8')).sports_pools : null;
  const played = new Set();
  const tryData = (when, data, label) => {
    const slot = slotFor(show, when, data), seq = docs[slot?.sequence];
    if (!seq) { bad.push(`${show.id} ${label}: nothing plays`); return; }
    played.add(slot.id);
    // a role cast as a token ({anchor}) takes its name from the data, as deskSegment does
    const named = Object.fromEntries(Object.entries(cast).map(([r, c]) => [r, castToken(c.id) ? { id: '', name: fill(c.id, data) } : c]));
    const tl = timeline(seq, data, { cast: named, seed: label });
    if (!tl.some((it) => it.spoken)) bad.push(`${show.id} ${label}: no line survives`);
    for (const it of tl) {
      if (/[{}]/.test(it.text)) bad.push(`${show.id} ${label} ${it.beat.id}: a raw token on air: ${it.text}`);
      for (const g of it.beat.gfx || []) {
        if (g.kind === 'table' && passes(g.if, it.data)) { const rows = tableRows(g, it.data); if (!rows.length && g.list && !g.if) bad.push(`${show.id} ${label} ${it.beat.id}: an empty table of ${g.list}`); if (rows.some((r) => /[{}]/.test(r))) bad.push(`${show.id} ${label}: a raw token in a table`); }
        if (g.kind === 'profile' && g.who && !profileOf(g, it.data).name) bad.push(`${show.id} ${label} ${it.beat.id}: a profile of nobody, ${g.who}`);
      }
    }
  };
  if (row) {
    for (const seed of SEEDS) {
      const { sport, game, ctx } = sampleGame(row, seed);
      for (const when of [...new Set((show.slots || []).map((s) => s.when))]) {
        for (const n of when === 'break' ? [0, 1] : [0]) tryData(when, { show: show.name, announcer: row.announcer, analyst: row.analyst, venue: 'the park', ...factsAt(sport, game, momentBeat(sport, game, when, n), ctx) }, `${when} ${n} ${seed}`);
      }
    }
    for (const s of show.slots || []) if (s.sequence && !played.has(s.id)) bad.push(`${show.id}: slot ${s.id} never plays in ${SEEDS.length} games`);
  } else for (const s of show.slots || []) tryData(s.when, { show: show.name, ...Object.values(show.samples || {})[0] }, s.id);
}

// live coverage: every shot it makes is on a camera the set has, the speaker is in it, nobody gets the
// same camera twice running when there's another, and the announcer gets the whole set
for (const set of of('set')) {
  const marks = Object.keys(set.marks || {}), seq = { roles: Object.fromEntries(marks.map((m) => [m, { mark: m }])) };
  let prev = null, prevRole = '', same = 0;
  for (let n = 0; n < 40; n++) {
    const role = marks[(n * 7 + (n >> 2)) % marks.length], shot = autoShot(set, seq, role, { prev, prevRole, said: n % 5, n });
    if (!set.cameras[shot.cam]) bad.push(`autoShot on ${set.id}: no camera ${shot.cam}`);
    if (!shot.on.includes(role)) bad.push(`autoShot on ${set.id}: ${role} speaks and isn't in the shot`);
    const c = shotCamera(set, seq, shot, 0.5, 0);
    if (![...c.eye, c.yaw, c.pitch, c.fov].every(Number.isFinite)) bad.push(`autoShot on ${set.id}: a camera that isn't finite`);
    if (prev && shot.cam === prev.cam && shot.frame === prev.frame && role === prevRole) same++;
    prev = shot; prevRole = role;
  }
  if (same > 8) bad.push(`autoShot on ${set.id}: the same shot ${same} times running`);
  const wide = autoShot(set, seq, '', {});
  if (wide.frame !== 'full') bad.push(`autoShot on ${set.id}: the announcer isn't the whole set`);
  void markOfRole;
}

// the tables and the .bsm reader
if (!FRAMES.wide || !MOVES.push || !GFX.lower) bad.push('the tables are missing a row');
if (fill('{a.b} {c}', { a: { b: 1 } }) !== '1 ') bad.push('fill: a dotted token, or a missing one');
const D = { n: 3, yes: true, no: false, list: [1], none: [], word: 'x' };
for (const [c, want] of [[{ fact: 'n', op: '>=', value: '3' }, true], [{ fact: 'n', op: '>', value: 3 }, false], [{ fact: 'yes', op: '=', value: 'true' }, true], [{ fact: 'no', op: '=', value: 'true' }, false], [{ fact: 'list', op: 'has' }, true], [{ fact: 'none', op: 'has' }, false], [{ fact: 'gone', op: 'missing' }, true], [{ fact: 'gone', op: '>', value: 0 }, false], [{ fact: 'list', op: '=', value: 1 }, true], [{ fact: 'word', op: '!=', value: 'y' }, true]]) if (passes([c], D) !== want) bad.push(`passes: ${JSON.stringify(c)} should be ${want}`);
if (!passes(undefined, D)) bad.push('passes: no conditions always pass');
const rowsOut = tableRows({ list: 'g', row: '{n}. {p}: {show}', limit: 1 }, { show: 'S', g: [{ n: 1, p: 'A' }, { n: 2, p: 'B' }] });
if (rowsOut.length !== 1 || rowsOut[0] !== '1. A: S') bad.push(`tableRows: ${rowsOut}`);
const cam = parseCamLabel('CAM — 2 — SNAP_TIGHT on Neil McManistan');
if (cam?.cam !== 'cam2' || cam.frame !== 'tight' || cam.on !== 'Neil McManistan') bad.push(`parseCamLabel: ${JSON.stringify(cam)}`);
const fromBsm = sequenceFromBsm({
  meta: { name: 'T' }, broadcastGraph: { _start: 'n0', nodes: {
    n0: { type: 'start', next: 'n1' }, n1: { type: 'camera_cut', label: 'CAM — 1 — WIDE on the counter', next: 'n2' },
    n2: { type: 'npc_anchor', npc_id: 'npc_neil', next: 'n3' }, n3: { type: 'say', text: 'Hello.', style: 'raw', next: 'n4' }, n4: { type: 'wait', duration: 2 },
  } },
}, { id: 'seq_t', set: 's' });
if (fromBsm.beats.length !== 2 || fromBsm.beats[0].say?.role !== 'a' || fromBsm.beats[0].shot.frame !== 'wide' || fromBsm.beats[1].hold !== 2) bad.push(`sequenceFromBsm: ${JSON.stringify(fromBsm.beats)}`);

if (bad.length) { for (const b of bad) console.error(`sequence: ${b}`); process.exit(1); }
console.log(`sequence ok: ${of('set').length} sets, ${of('sequence').length} sequences, ${of('show').length} shows, ${Object.keys(SET_PIECES).length} pieces`);
