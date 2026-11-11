// FIELD SMOKE: the field recordings (client/shared/field-recordings.js) and SIREN's `sample` layer.
//
//   node scripts/audio/field-smoke.mjs
//
// WHAT IT GUARDS:
//   • every recording in the table has its audio_samples row, the same id, an MP3, no SNES crush,
//     and a CC0 source page; and every field_ row is in the table
//   • a bed's loop points sit inside the file with the padding either side the build gives them, and
//     the decoded loop has no seam: the step across loopEnd -> loopStart is no bigger than the steps
//     next to it (the build's crossfade and cyclic padding, checked on the MP3 that ships)
//   • every call slice is inside its file and has a level
//   • each species field-audio.js calls with is a species birds.js has, and its recordings exist;
//     each weather and room recording a cue names exists
//   • the engine: a sampled cue plays the recording when it's decoded and NOT the stand-ins, plays the
//     stand-ins when it isn't, and a loop that started on its stand-ins changes over when it arrives
//
// It asserts what was scheduled, never what it sounds like.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tally, ROOT, loadEngine } from './stub-context.mjs';

const { check, done } = tally('audio:field');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { FIELD, fieldBed, fieldCall } = await imp('client/shared/field-recordings.js');

// ── the rows ──────────────────────────────────────────────────────────────────────────────────
const DIR = join(ROOT, 'content/audio_samples');
const rows = new Map();
for (const f of readdirSync(DIR).filter((n) => n.startsWith('smp_field_'))) rows.set(f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const ids = new Set(Object.values(FIELD).map((f) => f.id));
for (const id of rows.keys()) check(`${id} is in the table`, ids.has(id));

let decode = null;
try { const { MPEGDecoder } = await import('mpg123-decoder'); decode = async (b64) => { const d = new MPEGDecoder(); await d.ready; const r = d.decode(new Uint8Array(Buffer.from(b64, 'base64'))); d.free(); return { x: r.channelData[0], rate: r.sampleRate }; }; } catch { /* a checkout without dev deps skips the seam check */ }

for (const [key, f] of Object.entries(FIELD)) {
  const row = rows.get(f.id);
  if (!check(`${key}: its row ${f.id} exists`, !!row)) continue;
  check(`${key}: an MP3`, row.mime_type === 'audio/mpeg' && typeof row.data === 'string' && row.data.length > 1000);
  check(`${key}: played as recorded (snes_bits 0)`, row.snes_bits === 0);
  check(`${key}: a CC0 source`, row.config?.source?.licence === 'CC0 1.0' && /^https:\/\/freesound\.org\/people\/[^/]+\/sounds\/\d+\/$/.test(row.config?.source?.page || ''));
  if (f.loop) {
    const [a, b] = f.loop;
    check(`${key}: the loop sits inside the file with padding either side`, a >= 0.1 && b > a + 5 && b <= f.dur - 0.1, `${a}..${b} of ${f.dur}`);
    check(`${key}: has a level`, Number.isFinite(f.lufs));
    if (decode) {
      const { x, rate } = await decode(row.data);
      const i0 = Math.round(a * rate), i1 = Math.round(b * rate);
      // the step across the seam against the typical step around it
      let typ = 0; for (let i = i1 - 400; i < i1; i++) typ += Math.abs(x[i + 1] - x[i]);
      typ /= 400;
      const jump = Math.abs(x[i0] - x[i1 - 1]);
      check(`${key}: no seam at the loop point`, jump <= Math.max(6 * typ, 0.02), `jump ${jump.toFixed(4)} against ${typ.toFixed(4)}`);
    }
  }
  if (f.slices) {
    check(`${key}: has calls`, f.slices.length > 0);
    for (const [s, l, lu] of f.slices) check(`${key}: a call inside the file with a level`, s >= 0 && l > 0.03 && s + l <= f.dur + 0.01 && Number.isFinite(lu), `${s}+${l} of ${f.dur}`);
  }
}

// ── the callers' keys ─────────────────────────────────────────────────────────────────────────
const { SPECIES } = await imp('client/shared/birds.js');
globalThis.window = globalThis;
const { BIRD_FIELD } = await imp('client/game/js/panels/field-audio.js');
for (const [sp, keys] of Object.entries(BIRD_FIELD)) {
  check(`${sp} is a species birds.js has`, !!SPECIES[sp]);
  for (const k of keys) check(`${sp}: its recording ${k} exists`, !!fieldCall(k, 0));
}
// the outdoor beds (plugins/audio/soundscape.js): every weather bed but snow carries a recording that exists
const { WEATHER_BEDS } = await imp('plugins/audio/soundscape.js');
for (const [kind, d] of Object.entries(WEATHER_BEDS)) {
  const recs = d.config.layers.filter((l) => l.sample);
  if (kind !== 'snow') check(`weather ${kind}: has a recording`, recs.length > 0);
  for (const l of recs) check(`weather ${kind}: its recording ${l.sample} exists`, ids.has(l.sample));
}
const fa = readFileSync(join(ROOT, 'client/game/js/panels/field-audio.js'), 'utf8');
const shore = /const SHORE_FIELD = (\{[^\n]*\});/.exec(fa);
if (check('field-audio.js names its shore recordings', !!shore)) {
  for (const [kind, [key]] of Object.entries(new Function(`return ${shore[1]}`)())) check(`shore ${kind}: its recording ${key} is a bed`, !!fieldBed(key));
}
const { BUILTINS } = await imp('client/shared/room-sfx.js');
for (const d of BUILTINS) check(`${d.id} has its recording`, d.config.layers.some((l) => l.sample && ids.has(l.sample)));

// ── the Room Stage's outside ──────────────────────────────────────────────────────────────────
{
  const { createRoomOutdoors } = await imp('client/game/js/panels/room-outdoors.js');
  const { outsideMix } = await imp('client/shared/room-sfx.js');
  // a 41-tile window: park all round, the sea from four tiles east, the building on the centre tile
  const R = 20, gx = 900, gy = 900;
  const mapOf = (sea) => Array.from({ length: 2 * R + 1 }, (_, y) => Array.from({ length: 2 * R + 1 }, (_, x) =>
    x === R && y === R ? { kind: 'field', biome: 'citycore', bt: 'flat' } : sea && x >= R + 4 ? { kind: 'water', biome: 'water' } : { kind: 'field', biome: 'parkland' }));
  const listen = (o, hour, wx, mins = 30) => {
    let calls = 0, shore = null;
    const t0 = 1.9e12;
    for (let t = 0; t < mins * 60000; t += 250) { const r = o.due(t0 + t, hour, wx, 0.2); calls += r.calls.length; shore = r.shore; }
    return { calls, shore };
  };
  const day = createRoomOutdoors(); day.setPlace({ map: mapOf(true), gx, gy, bearing: 90 });
  const heard = listen(day, 10, 'clear');
  check('a room by a park hears birds by day', heard.calls > 0, `${heard.calls} calls in 30 minutes`);
  check('and the sea four tiles off', heard.shore && heard.shore.level > 0.4 && heard.shore.kind === 'calm', JSON.stringify(heard.shore));
  // the front faces east (bearing 90) and the sea is east, so it's ahead: plan direction (0, -1)
  check('the sea is in front of an east-facing room', heard.shore && Math.abs(heard.shore.dir[0]) < 0.01 && heard.shore.dir[1] < -0.99, JSON.stringify(heard.shore?.dir));
  const night = createRoomOutdoors(); night.setPlace({ map: mapOf(true), gx, gy, bearing: 90 });
  check('no birds at three in the morning', listen(night, 3, 'clear').calls === 0);
  const wet = createRoomOutdoors(); wet.setPlace({ map: mapOf(true), gx, gy, bearing: 90 });
  check('no birds in the rain', listen(wet, 10, 'rain').calls === 0);
  const inland = createRoomOutdoors(); inland.setPlace({ map: mapOf(false), gx, gy, bearing: 0 });
  check('no sea inland', listen(inland, 10, 'clear', 1).shore === null);
  const ear = (o = {}) => ({ near: 6, open: 0, out: false, annex: false, storey: 3, ...o });
  const bath = outsideMix(1, 1, ear({ annex: true })), room = outsideMix(1, 1, ear()), deck = outsideMix(1, 1, ear({ out: true }));
  check('birds and surf: the en-suite is quieter than the room, the room than the balcony', bath.call < room.call && room.call < deck.call && bath.surf < room.surf && room.surf < deck.surf);
  check('higher up, the outside is quieter', outsideMix(1, 1, ear({ storey: 20 })).call < room.call);
}

// ── the engine ────────────────────────────────────────────────────────────────────────────────
{
  const { A, ctx, nodes } = loadEngine();
  ctx.decodeAudioData = async () => ctx.createBuffer(1, 22050 * 20, 22050);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: 'AAAA' }) });
  const alt = { waveform: 'noise', noiseMix: 1, alt: true, adsr: { a: 1, d: 0, s: 1, r: 1 }, gain: 0.3 };
  const bed = fieldBed('rain_light', -20);
  const kinds = (from) => nodes.slice(from).map((n) => n.kind);
  // the recording's source, told from the noise layers' by its buffer (the stub decodes at 22,050 Hz)
  const isRec = (n) => n.kind === 'buffersrc' && n.buffer?.sampleRate === 22050;

  // not decoded yet: the stand-in plays, no buffer source for the recording
  let n0 = nodes.length;
  A.loopSound({ id: 't-loop', category: 'ambient', priority: 1, config: { gain: 1, layers: [alt, bed] } });
  check('before the recording decodes, the stand-in plays', kinds(n0).includes('buffersrc') && !nodes.slice(n0).some(isRec), kinds(n0).join(','));
  const before = nodes.length;
  await A.preloadSamples([bed.sample]);
  await new Promise((r) => setImmediate(r));
  const swap = nodes.slice(before).find(isRec);
  check('a loop changes over to the recording when it arrives', !!swap);
  if (swap) check('the recording loops on its loop points', swap.loopStart === bed.loop[0] && swap.loopEnd === bed.loop[1], `${swap.loopStart}..${swap.loopEnd}`);
  A.stopLoop('t-loop');

  // decoded: only the recording
  check('sampleReady says so', A.sampleReady(bed.sample));
  n0 = nodes.length;
  A.loopSound({ id: 't-loop2', category: 'ambient', priority: 1, config: { gain: 1, layers: [alt, bed] } });
  const srcs = nodes.slice(n0).filter((n) => n.kind === 'buffersrc');
  const recs = srcs.filter(isRec);
  check('once decoded, the recording plays and the stand-in does not', recs.length === 1 && srcs.length === 1 && recs[0].loop, kinds(n0).join(','));
  check('a loop starts inside itself', recs[0] && recs[0].offset >= bed.loop[0] && recs[0].offset <= bed.loop[1]);
  A.stopLoop('t-loop2');

  // a call: plays its slice and stops at its end
  const call = fieldCall('goose', 3, -16);
  await A.preloadSamples([call.sample]);
  n0 = nodes.length;
  A.playSfx({ id: 't-call', category: 'sfx', priority: 5, config: { duration: call.length, layers: [{ ...alt, adsr: { a: 0.01, d: 0, s: 1, r: 0.05 } }, call] } }, 1, { position: [3, 0, 0] });
  const cs = nodes.slice(n0).find(isRec);
  check('a call plays from its slice', cs && Math.abs(cs.offset - call.offset) < 1e-6, cs ? `${cs.offset}` : 'no source');
  check('and stops at its end', cs && cs.stopped != null && cs.stopped <= ctx.currentTime + call.length + 0.05);
  check('a positioned call goes through a panner', nodes.slice(n0).some((n) => n.kind === 'panner3d' || n.kind === 'panner'));
}

done();
process.exit(0);   // the WASM decoder holds the event loop open
