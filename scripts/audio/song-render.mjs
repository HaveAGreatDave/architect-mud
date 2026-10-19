// SONG RENDER: a tracker song rendered offline through the real audio-engine.js, measured, and
// optionally written as a stereo WAV to listen to.
//
//   node scripts/audio/song-render.mjs ksab7_deadball_theme            the numbers
//   node scripts/audio/song-render.mjs ksab7_deadball_theme --wav x.wav  ...and the WAV
//   node scripts/audio/song-render.mjs --module scripts/content/build-ksab-theme.mjs --wav x.wav
//       the song a build script would write, before it's written
//   --rate 16000   a quicker, duller render (default 48000)
//
// The Node renderer (scripts/audio/offline-audio.mjs) is mono and has no reverb, which is what
// the music bus has too: music goes past the room. So each channel is rendered on its own and
// panned here by `channel_pan`, with the StereoPannerNode's equal-power law, which is what a
// browser does with it. The numbers are the mix's.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installAudioGlobals } from './offline-audio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const RATE = +arg('--rate', 48000);
const OUT = arg('--wav', null);
const MODULE = arg('--module', null);
const NAME = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

export async function loadSong({ name, module } = {}) {
  if (module) {
    const m = await import(pathToFileURL(resolve(ROOT, module)).href);
    return { song: m.song, instruments: m.instruments };
  }
  const read = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')));
  const song = read('content/audio_songs').find((s) => s.name === name || s.id === name);
  if (!song) throw new Error(`no song ${name}`);
  const want = new Set(song.instrument_ids || []);
  return { song, instruments: read('content/audio_instruments').filter((r) => want.has(r.id)) };
}

export function loadEngine() {
  installAudioGlobals();
  if (!globalThis.AudioEngine) new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
  return globalThis.AudioEngine;
}

// How long a note of this instrument can sound past its row and its hold: attack, decay,
// release, and an echo's repeats down to -60 dB.
function noteTail(inst) {
  const layers = inst?.config?.layers?.length ? inst.config.layers : [inst?.config || {}];
  let tail = 0.05;
  for (const l of layers) {
    const e = l.adsr || {};
    let t = (e.a ?? 0.01) + (e.d ?? 0.05) + (e.r ?? 0.15);
    if (l.echo?.mix > 0) t += (l.echo.delay ?? 0.18) * Math.log(1000) / -Math.log(Math.max(0.01, Math.min(0.95, l.echo.feedback ?? 0.35)));
    tail = Math.max(tail, t + 0.05);
  }
  return tail;
}

// Every channel on its own, then the stereo mix: { left, right, solos, rate }.
//
// A NOTE AT A TIME. The Node double pulls every node it has ever been given on every sample,
// so a whole song's graph (a few thousand notes' worth) takes hours, where a browser drops a
// note's nodes once it has finished. A synth song is a sum of independent notes (a channel's
// gain and pan are linear, and a pre-scheduled release can't be cut), so each note is rendered
// as a song of its own, as long as it can sound, and added in at its row.
export async function renderStereo(AE, song, instruments, rate = 48000) {
  const byId = Object.fromEntries(instruments.map((r) => [r.id, r]));
  const step = 60 / (song.tempo || 120) / 4;
  const rows = Math.max(...song.channels.map((ch) => ch.length));
  const total = Math.ceil((rows * step + 3) * rate);
  const solos = [];
  for (const ch of song.channels) {
    const out = new Float32Array(total);
    for (let r = 0; r < ch.length; r++) {
      const s = ch[r];
      if (!s || s.note == null) continue;
      const len = s.len > 1 ? s.len : 1;
      const def = { ...song, channels: [[s, ...new Array(len - 1).fill(null)]], channel_pan: [], _instrumentsById: byId };
      const buf = await AE.renderSong(def, { sampleRate: rate, tail: noteTail(byId[s.instrument]) });
      const d = buf.getChannelData(0), at = Math.round(r * step * rate);
      for (let k = 0; k < d.length && at + k < total; k++) out[at + k] += d[k];
    }
    solos.push(out);
  }
  const n = total;
  const left = new Float32Array(n), right = new Float32Array(n);
  solos.forEach((s, i) => {
    const pan = Math.max(-1, Math.min(1, song.channel_pan?.[i] ?? 0));
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    for (let k = 0; k < s.length; k++) { left[k] += s[k] * gl; right[k] += s[k] * gr; }
  });
  return { left, right, solos, rate };
}

// The master limiter's job, for a file: a song's busiest hits can stack past full scale, which
// the game's brickwall (audio-engine.js, about -1 dBFS) holds down and a WAV would clip. Gain
// is the lowest any sample in the next 5 ms needs, and it comes back up over about 120 ms.
export function limit(left, right, rate, ceiling = 0.89) {
  const n = left.length, look = Math.max(1, Math.round(rate * 0.005));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(left[i]), Math.abs(right[i])); need[i] = p > ceiling ? ceiling / p : 1; }
  const rel = 1 - Math.exp(-1 / (0.12 * rate)), atk = 1 - Math.exp(-1 / (0.001 * rate));
  let g = 1, reduced = 0;
  for (let i = 0; i < n; i++) {
    let want = 1;
    for (let k = i; k < Math.min(n, i + look); k++) if (need[k] < want) want = need[k];
    g += (want - g) * (want < g ? atk : rel);
    const h = Math.min(g, need[i]);
    if (h < 0.99) reduced++;   // (more than 0.1 dB: the release only ever approaches 1)
    left[i] *= h; right[i] *= h;
  }
  return reduced / n;
}

export function stereoWav(left, right, rate) {
  const n = left.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const s16 = (v) => { const c = Math.max(-1, Math.min(1, v)); return Math.round(c < 0 ? c * 32768 : c * 32767); };
  for (let i = 0; i < n; i++) { buf.writeInt16LE(s16(left[i]), 44 + i * 4); buf.writeInt16LE(s16(right[i]), 46 + i * 4); }
  return buf;
}

const peakOf = (d) => { let p = 0; for (const x of d) { const a = Math.abs(x); if (a > p) p = a; } return p; };
const rmsOf = (d, a = 0, b = d.length) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!NAME && !MODULE) { console.error('usage: song-render.mjs <song name> | --module <build script> [--wav out.wav] [--rate 48000]'); process.exit(2); }
  const t0 = Date.now();
  const AE = loadEngine();
  const { song, instruments } = await loadSong({ name: NAME, module: MODULE });
  const { left, right, solos } = await renderStereo(AE, song, instruments, RATE);
  const ms = Date.now() - t0;
  const finite = [left, right].every((d) => d.every(Number.isFinite));
  const step = 60 / song.tempo / 4, barS = step * 16;
  console.log(`${song.name}: ${(left.length / RATE).toFixed(2)} s at ${RATE} Hz, rendered in ${(ms / 1000).toFixed(1)} s${finite ? '' : ', NON-FINITE SAMPLES'}`);
  console.log(`mix peak L ${peakOf(left).toFixed(3)} R ${peakOf(right).toFixed(3)} (${dB(Math.max(peakOf(left), peakOf(right))).toFixed(1)} dBFS), rms ${dB(rmsOf(left)).toFixed(1)} dBFS`);
  // a channel's level while it's playing: its 50 ms windows within 30 dB of its loudest
  const activeRms = (d) => {
    const w = Math.round(RATE * 0.05), win = [];
    for (let a = 0; a + w <= d.length; a += w) win.push(rmsOf(d, a, a + w));
    const top = Math.max(...win), on = win.filter((v) => v > top * 0.0316);
    return Math.sqrt(on.reduce((s, v) => s + v * v, 0) / Math.max(1, on.length));
  };
  console.log('channel'.padEnd(21), 'pan  ', 'peak  ', 'rms dB', 'playing dB');
  solos.forEach((s, i) => {
    const inst = (song.channels[i].find(Boolean)?.instrument || '').replace('aud_inst_', '');
    console.log(`${String(i).padStart(2)} ${inst.padEnd(18)}`, String(song.channel_pan?.[i] ?? 0).padEnd(5), peakOf(s).toFixed(3), dB(rmsOf(s)).toFixed(1).padStart(6), dB(activeRms(s)).toFixed(1).padStart(8));
  });
  const bars = Math.ceil(left.length / RATE / barS);
  const arc = [];
  for (let b = 0; b < bars; b++) {
    const a = Math.floor(b * barS * RATE), e = Math.min(left.length, Math.floor((b + 1) * barS * RATE));
    const mono = new Float32Array(e - a); for (let i = a; i < e; i++) mono[i - a] = (left[i] + right[i]) / 2;
    arc.push(`${b + 1}:${dB(rmsOf(mono)).toFixed(0)}/${dB(peakOf(mono)).toFixed(0)}`);
  }
  console.log('bar rms/peak dB:', arc.join('  '));
  // where the mix peaks, and who's loudest there
  const hot = [];
  const w = Math.round(RATE * 0.05);
  for (let a = 0; a + w <= left.length; a += w) {
    let p = 0, at = a;
    for (let i = a; i < a + w; i++) { const v = Math.max(Math.abs(left[i]), Math.abs(right[i])); if (v > p) { p = v; at = i; } }
    hot.push({ p, at });
  }
  hot.sort((x, y) => y.p - x.p);
  for (const { p, at } of hot.slice(0, 5)) {
    const who = solos.map((s, i) => [i, Math.abs(s[at])]).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([i, v]) => `${i}:${v.toFixed(2)}`);
    const t = at / RATE, bar = Math.floor(t / barS) + 1, row = Math.floor((t % barS) / step);
    console.log(`peak ${p.toFixed(3)} at ${t.toFixed(2)} s (bar ${bar} row ${row}): ${who.join(' ')}`);
  }
  if (OUT) {
    const share = limit(left, right, RATE);
    writeFileSync(OUT, stereoWav(left, right, RATE));
    console.log(`wrote ${OUT} (limited to -1 dBFS as the game's master is, gain reduced on ${(share * 100).toFixed(2)}% of samples)`);
  }
}
