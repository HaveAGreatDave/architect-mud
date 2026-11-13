// FIELD RECORDINGS: the CC0 weather, sea and bird recordings SIREN plays as `sample` layers.
//
//   node scripts/audio/build-field-recordings.mjs --fetch   download the originals (checks each is CC0)
//   node scripts/audio/build-field-recordings.mjs           build content/audio_samples + the table
//
// Every source is a Freesound sound under CC0 1.0. `--fetch` reads each sound's page and refuses one
// whose licence isn't CC0, then saves Freesound's HQ preview MP3 into .cache/field-recordings/ (not in
// git). The build turns each into what the game ships:
//
//   bed    a seamless loop. The steadiest `len` seconds of the recording (lowest swing in its short-term
//          level), crossfaded end into start, then written CYCLICALLY EXTENDED: a little of the loop's
//          end before it and a little of its start after it. An MP3 decoder may add up to ~60 ms of
//          delay at the front, and browsers don't agree on it; with the loop padded on both sides, a
//          shift moves both loop points together and the seam stays seamless whatever the decoder did.
//   calls  the separate calls in a recording, found from its level, each a slice [start, length] of
//          one file with a gap between, so a bird is one fetch and one row, not eight.
//   shot   one sound, trimmed to its level and faded out.
//
// Everything comes out mono, 22,050 Hz, 48 kbps MP3, levelled (beds to an RMS, calls and shots to a
// peak). `snes_bits: 0`, so the sampler plays it as it is. Slices and loop points are measured by
// decoding the MP3 that was written, so they're in the decoded file's own time.
//
// It also writes client/shared/field-recordings.js, the table cues read (id, loop points, slices), so
// nothing has to fetch a row to know how to play one.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kWeight, blocks, lufs, momentaryMax } from './loudness-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(ROOT, '.cache/field-recordings');
const RATE = 22050, KBPS = 48;

// key, Freesound user and id, what it becomes. `len` and `pad` are seconds.
export const SOURCES = [
  // weather
  { key: 'rain_light',   user: 'soundrecorder7', id: 167034, title: 'Light Rain', kind: 'bed', len: 18, rms: -24 },
  { key: 'rain_heavy',   user: 'jmbphilmes', id: 200272, title: 'Rain heavy 2 (rural)', kind: 'bed', len: 22, rms: -20 },
  { key: 'rain_indoor',  user: 'samesamesame', id: 242889, title: 'Rain from Indoors - Perfect loop', kind: 'bed', len: 20, rms: -24 },
  { key: 'rain_thunder', user: 'FlatHill', id: 237729, title: 'Rain and Thunder 4', kind: 'bed', len: 30, rms: -21, steady: false },
  { key: 'thunder_a',    user: 'lennyboy', id: 244053, title: 'Thunder.ogg', kind: 'shot', max: 9 },
  { key: 'thunder_b',    user: 'netaj', id: 193170, title: 'thunder', kind: 'shot', max: 6 },
  { key: 'wind',         user: 'nithala', id: 525292, title: 'wind.wav', kind: 'bed', len: 22, rms: -23 },
  { key: 'blizzard',     user: 'cobratronik', id: 117136, title: 'Wind__Artic__Cold.wav', kind: 'bed', len: 24, rms: -21 },
  { key: 'hail',         user: 'MLaudio', id: 521375, title: 'hail_rain.wav', kind: 'bed', len: 14, rms: -22 },
  // wind by strength: a breeze, the gusts, a hard wind and a gale, and the gusts as one-shots
  { key: 'wind_breeze', user: 'FunWithSound', id: 390740, title: 'Wind 2.mp3', kind: 'bed', len: 20, rms: -26 },
  { key: 'leaves', user: 'Anya_Media', id: 523389, title: 'Forest, close up of trees rustling in the wind.wav', kind: 'bed', len: 20, rms: -26 },
  { key: 'wind_gusty', user: 'BudJillett', id: 109485, title: 'Wind-Gusts-late-autumn.wav', kind: 'bed', len: 24, rms: -23, steady: false },
  { key: 'wind_strong', user: 'DBlover', id: 405601, title: 'Howling Wind Ambience', kind: 'bed', len: 24, rms: -21 },
  { key: 'wind_gale', user: 'LanDub', id: 181935, title: 'Gale Wind.wav', kind: 'bed', len: 24, rms: -19, steady: false },
  { key: 'gusts', user: 'SamsterBirdies', id: 565140, title: 'Heavy gusts of wind', kind: 'calls', n: 4, max: 4, gap: 0.4 },
  // more rain
  { key: 'rain_drizzle', user: 'FenrirFangs', id: 231687, title: 'rain 1.wav', kind: 'bed', len: 20, rms: -26 },
  { key: 'rain_street', user: 'BonnyOrbit', id: 380651, title: 'Light rain on street.wav', kind: 'bed', len: 20, rms: -24 },
  { key: 'rain_awning', user: '1888software', id: 554577, title: 'rain-on-canvas-awning.wav', kind: 'bed', len: 18, rms: -24 },
  { key: 'rain_yards', user: 'conleec', id: 149240, title: 'AMB_Ext_Rain_Residential_002.wav', kind: 'bed', len: 22, rms: -22 },
  { key: 'rain_windy', user: 'Syphon64', id: 135162, title: 'Hard Rain Strong Winds', kind: 'bed', len: 24, rms: -20, steady: false },
  { key: 'wet_traffic', user: 'Pfannkuchn', id: 258163, title: 'Passing cars on wet cobblestone street, light rain, city', kind: 'bed', len: 24, rms: -25, steady: false },
  // the streets and the city
  { key: 'street_quiet', user: 'Oper8', id: 241135, title: 'Small quiet street ambience', kind: 'bed', len: 24, rms: -27 },
  { key: 'street_people', user: 'WhiteNoiseSleeper', id: 725605, title: 'People Ambience In The Old Town', kind: 'bed', len: 24, rms: -26 },
  { key: 'city_day', user: 'davidco80', id: 164213, title: 'Morning Ambience city', kind: 'bed', len: 26, rms: -25 },
  { key: 'city_night', user: 'Soundkrampf', id: 237329, title: 'Night city atmosphere', kind: 'bed', len: 26, rms: -27 },
  { key: 'city_roof', user: 'Dr. Macak', id: 252690, title: 'NightCity-1.wav', kind: 'bed', len: 26, rms: -26 },
  // the sea
  { key: 'surf_beach',   user: 'szegvari', id: 530699, title: 'Water wave Beach Field-recording 200815_0036.wav', kind: 'bed', len: 18, rms: -21, steady: false },
  { key: 'surf_rocks',   user: 'amholma', id: 376801, title: 'Crashing Waves into Rocks 2', kind: 'bed', len: 28, rms: -20, steady: false },
  { key: 'harbour_lap',  user: 'DangerLaef', id: 692542, title: 'Water_Lapping_Windy_Day_Gore_Creek_2.wav', kind: 'bed', len: 18, rms: -23 },
  { key: 'ocean',        user: 'Noted451', id: 531015, title: 'Ocean Waves.wav', kind: 'bed', len: 28, rms: -21, steady: false },
  // birds
  { key: 'goose',        user: 'Kinoton', id: 423346, title: 'Canada Geese Honks', kind: 'calls', n: 10, max: 1.6 },
  { key: 'goose_chatter', user: 'qubodup', id: 859152, title: 'Canada Goose Chatter', kind: 'calls', n: 6, max: 2.4 },
  { key: 'gull_single',  user: 'steaq', id: 263786, title: 'Seagull single call', kind: 'calls', n: 1, max: 1.5 },
  { key: 'gull',         user: 'nigelcoop', id: 73497, title: 'Gull.wav', kind: 'calls', n: 6, max: 2.5 },
  { key: 'gull_trill',   user: 'nigelcoop', id: 75195, title: 'Seagull trill and whine.wav', kind: 'calls', n: 3, max: 2 },
  { key: 'gulls',        user: 'Lydmakeren', id: 510917, title: 'Seagulls_short.wav', kind: 'calls', n: 8, max: 2.5 },
  { key: 'pigeon',       user: 'Fsu2001', id: 795558, title: 'Pigeon cooing', kind: 'calls', n: 8, max: 2.6, gap: 0.25 },
  { key: 'sparrow',      user: 'straget', id: 404663, title: 'House sparrow.wav', kind: 'calls', n: 10, max: 2.5, gap: 0.08 },
  { key: 'robin',        user: 'Andrew.soundscape', id: 671058, title: 'robin song', kind: 'calls', n: 8, max: 3.2, gap: 0.3 },
  { key: 'hawk',         user: 'craigsmith', id: 479610, title: 'R30-34-Red Tailed Hawk.wav', kind: 'calls', n: 5, max: 2.6 },
  { key: 'vulture',      user: 'AntumDeluge', id: 188041, title: 'Vulture', kind: 'calls', n: 2, max: 1.2 },
];
export const pageOf = (s) => `https://freesound.org/people/${s.user}/sounds/${s.id}/`;
export const sampleId = (key) => `smp_field_${key}`;

// ── fetch ─────────────────────────────────────────────────────────────────────────────────────
async function fetchAll() {
  mkdirSync(CACHE, { recursive: true });
  for (const s of SOURCES) {
    const out = join(CACHE, s.key + '.mp3');
    if (existsSync(out)) continue;
    const html = await (await fetch(pageOf(s), { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    if (!/creativecommons\.org\/publicdomain\/zero\/1\.0/.test(html)) throw new Error(`${s.key}: ${pageOf(s)} is not CC0, refusing it`);
    const mp3 = /data-mp3="([^"]*)"/.exec(html)?.[1]?.replace('-lq.', '-hq.');
    if (!mp3) throw new Error(`${s.key}: no preview on ${pageOf(s)}`);
    writeFileSync(out, Buffer.from(await (await fetch(mp3)).arrayBuffer()));
    console.log('fetched', s.key);
    await new Promise((r) => setTimeout(r, 800));
  }
}

// ── signal ────────────────────────────────────────────────────────────────────────────────────
// ⚠ A FRESH DECODER EACH TIME: mpg123-decoder's reset() leaves it erroring on every frame after.
async function decode(bytes) {
  const { MPEGDecoder } = await import('mpg123-decoder');
  const dec = new MPEGDecoder();
  await dec.ready;
  const r = dec.decode(new Uint8Array(bytes));
  dec.free();
  const ch = r.channelData, n = r.samplesDecoded;
  const mono = new Float32Array(n);
  for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i] / ch.length;
  return { x: mono, rate: r.sampleRate };
}

// windowed-sinc resample with the cutoff under the lower Nyquist
function resample(x, from, to) {
  if (from === to) return x;
  const ratio = from / to, n = Math.floor(x.length / ratio), out = new Float32Array(n);
  const fc = 0.45 * Math.min(1, to / from), half = 24;
  for (let i = 0; i < n; i++) {
    const c = i * ratio, k0 = Math.floor(c);
    let acc = 0, wsum = 0;
    for (let k = k0 - half + 1; k <= k0 + half; k++) {
      if (k < 0 || k >= x.length) continue;
      const t = k - c;
      const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * t / half) + 0.08 * Math.cos(2 * Math.PI * t / half);
      acc += x[k] * sinc * w; wsum += sinc * w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}

// DC out and a gentle high-pass at ~40 Hz, so handling rumble doesn't eat the level
function highpass(x, rate, f = 40) {
  const a = Math.exp(-2 * Math.PI * f / rate), y = new Float32Array(x.length);
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) { py = a * (py + x[i] - px); px = x[i]; y[i] = py; }
  return y;
}

// short-term level in dB, one value per `hop` seconds
function envelope(x, rate, hop = 0.01) {
  const h = Math.max(1, Math.round(hop * rate)), out = new Float32Array(Math.floor(x.length / h));
  for (let j = 0; j < out.length; j++) {
    let s = 0;
    for (let i = j * h; i < (j + 1) * h; i++) s += x[i] * x[i];
    out[j] = 10 * Math.log10(s / h + 1e-12);
  }
  return out;
}

const rmsDb = (x) => { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-12); };
const peakOf = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };
const scale = (x, g) => { for (let i = 0; i < x.length; i++) x[i] *= g; return x; };

// the window of `len` seconds whose 0.5 s level swings least (or, unsteady, just the loudest middle)
function pickWindow(x, rate, len, steady) {
  const L = Math.min(x.length, Math.round(len * rate));
  const env = envelope(x, rate, 0.5), per = Math.round(len / 0.5);
  if (env.length <= per) return [0, L];
  let best = 0, bestScore = Infinity;
  // stay off the first and last half second: fades and handling
  for (let j = 1; j + per < env.length - 1; j++) {
    const w = env.subarray(j, j + per);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
    const score = steady === false ? -mean : sd - mean * 0.05;
    if (score < bestScore) { bestScore = score; best = j; }
  }
  const s = Math.round(best * 0.5 * rate);
  return [s, Math.min(L, x.length - s)];
}

// a loop body of `len` samples taken from x[s ...], its end crossfaded (equal power) into its start
function loopBody(x, s, len, xf) {
  const B = new Float32Array(len);
  for (let i = 0; i < len; i++) B[i] = x[s + xf + i] ?? 0;
  // B continues into x[s+xf+len ...]; fade that continuation over B's head so the end runs into it
  for (let i = 0; i < xf; i++) {
    const t = i / xf, a = Math.sin(t * Math.PI / 2), b = Math.cos(t * Math.PI / 2);
    B[i] = (x[s + xf + i] ?? 0) * a + (x[s + xf + len + i] ?? 0) * b;
  }
  return B;
}

// the calls: runs of level within `floor` dB of the loudest, merged across short gaps
function findCalls(x, rate, { n = 6, max = 2.5, gap = 0.12, floor = 22, min = 0.06 } = {}) {
  const hop = 0.01, env = envelope(x, rate, hop);
  const top = Math.max(...env), on = env.map((v) => v > top - floor);
  const runs = [];
  for (let j = 0; j < on.length; j++) {
    if (!on[j]) continue;
    let k = j; while (k < on.length && on[k]) k++;
    const last = runs[runs.length - 1];
    if (last && (j - last[1]) * hop < gap) last[1] = k; else runs.push([j, k]);
    j = k;
  }
  const calls = runs.map(([a, b]) => {
    let pk = -Infinity; for (let j = a; j < b; j++) pk = Math.max(pk, env[j]);
    return { s: a * hop, d: (b - a) * hop, pk };
  }).filter((c) => c.d >= min && c.d <= max);
  calls.sort((p, q) => q.pk - p.pk);
  return calls.slice(0, n).sort((p, q) => p.s - q.s);
}

function fadeEdges(x, rate, inS = 0.01, outS = 0.04) {
  const a = Math.round(inS * rate), b = Math.round(outS * rate);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}

// trim a one-shot to where its level is within 40 dB of its peak, `max` seconds at most
function trimShot(x, rate, max) {
  const env = envelope(x, rate, 0.01), top = Math.max(...env);
  let a = env.findIndex((v) => v > top - 30), b = env.length - 1;
  while (b > a && env[b] < top - 40) b--;
  const s = Math.max(0, Math.round((a * 0.01 - 0.02) * rate)), e = Math.min(x.length, Math.round(((b + 1) * 0.01) * rate), s + Math.round(max * rate));
  return fadeEdges(x.slice(s, e), rate, 0.005, Math.min(0.6, (e - s) / rate * 0.3));
}

async function encode(x) {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(1, RATE, KBPS);
  const pcm = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)));
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) { const b = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush(); if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

// how far the decoded MP3 runs behind the PCM that went in, in seconds (the encoder's delay)
function delayOf(src, dec, rate) {
  const span = Math.min(src.length, Math.round(rate * 2)), maxLag = Math.round(rate * 0.1);
  let best = 0, bestC = -Infinity;
  for (let lag = 0; lag < maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < span; i += 2) c += src[i] * (dec[i + lag] ?? 0);
    if (c > bestC) { bestC = c; best = lag; }
  }
  return best / rate;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;

// integrated loudness (BS.1770: absolute gate -70, relative gate -10), as loudness-smoke measures a loop
function integrated(x, fs) {
  const z = blocks(kWeight(x, fs), fs).filter((m) => lufs(m) > -70);
  if (!z.length) return -Infinity;
  const rel = lufs(z.reduce((a, b) => a + b, 0) / z.length) - 10;
  const g = z.filter((m) => lufs(m) > rel);
  return lufs(g.reduce((a, b) => a + b, 0) / g.length);
}

async function buildOne(s) {
  const src = join(CACHE, s.key + '.mp3');
  if (!existsSync(src)) throw new Error(`${s.key}: no ${src}; run with --fetch first`);
  const d = await decode(readFileSync(src));
  let x = highpass(resample(d.x, d.rate, RATE), RATE);
  let out, meta = {};
  if (s.kind === 'bed') {
    const xf = Math.round(1.5 * RATE), pad = Math.round(0.25 * RATE);
    const want = Math.round(s.len * RATE);
    const [w0, wl] = pickWindow(x, RATE, s.len + 1.5 + 0.1, s.steady);
    const len = Math.min(want, wl - xf - 4);
    const B = loopBody(x, w0, len, xf);
    scale(B, Math.pow(10, ((s.rms ?? -22) - rmsDb(B)) / 20));
    const pk = peakOf(B); if (pk > 0.89) scale(B, 0.89 / pk);
    out = new Float32Array(pad + len + pad);
    for (let i = 0; i < pad; i++) out[i] = B[len - pad + i];
    out.set(B, pad);
    for (let i = 0; i < pad; i++) out[pad + len + i] = B[i];
    meta = { loop: [pad / RATE, (pad + len) / RATE] };
  } else if (s.kind === 'calls') {
    // a busy recording runs its calls together at a low floor: raise it until they come apart
    let calls = [];
    for (const floor of [22, 16, 12, 8, 5]) { calls = findCalls(x, RATE, { ...s, floor }); if (calls.length >= Math.min(s.n ?? 6, 3)) break; }
    if (!calls.length) throw new Error(`${s.key}: found no calls`);
    const gap = Math.round(0.25 * RATE), lead = 0.03, parts = [], slices = [];
    let at = gap;
    for (const c of calls) {
      const a = Math.max(0, Math.round((c.s - lead) * RATE)), b = Math.min(x.length, Math.round((c.s + c.d + 0.08) * RATE));
      const seg = fadeEdges(x.slice(a, b), RATE, 0.008, 0.06);
      parts.push(seg); slices.push([at / RATE, seg.length / RATE]);
      at += seg.length + gap;
    }
    out = new Float32Array(at);
    let p = gap; for (const seg of parts) { out.set(seg, p); p += seg.length + gap; }
    scale(out, 0.89 / (peakOf(out) || 1));
    meta = { slices };
  } else {
    out = trimShot(x, RATE, s.max ?? 6);
    scale(out, 0.89 / (peakOf(out) || 1));
    meta = { slices: [[0, out.length / RATE]] };
  }
  const mp3 = await encode(out);
  // put the loop points and slices in the decoded file's time
  const back = (await decode(mp3)).x;
  const dly = delayOf(out, back, RATE);
  // and how loud each is, in LUFS as loudness-smoke measures it (a loop integrated, a call its
  // momentary max), so a cue can set a recording's gain from its own target: fieldGain() below
  if (meta.loop) {
    meta.loop = meta.loop.map((t) => r3(t + dly));
    meta.lufs = r1(integrated(back.subarray(Math.round(meta.loop[0] * RATE), Math.round(meta.loop[1] * RATE)), RATE));
  }
  if (meta.slices) meta.slices = meta.slices.map(([a, b]) => {
    const s0 = r3(a + dly);
    return [s0, r3(b), r1(momentaryMax(back.subarray(Math.round(s0 * RATE), Math.round((s0 + b) * RATE)), RATE))];
  });
  // a slice 10 LU under the loudest is a distant bird or the room, and levelled up it's mostly hiss
  if (meta.slices?.length > 1) { const top = Math.max(...meta.slices.map((s) => s[2])); meta.slices = meta.slices.filter((s) => s[2] >= top - 10); }
  return { mp3, meta, dur: r3(back.length / RATE), dly };
}

async function build() {
  const table = {};
  let total = 0;
  for (const s of SOURCES) {
    const { mp3, meta, dur, dly } = await buildOne(s);
    const id = sampleId(s.key);
    const row = {
      base_note: 60,
      category: 'ambient',
      config: { field: { key: s.key, kind: s.kind, ...meta }, gain: 1, source: { licence: 'CC0 1.0', page: pageOf(s), title: s.title, user: s.user } },
      data: mp3.toString('base64'),
      echo_mix: 0,
      enabled: 1,
      id,
      loop_end: 0,
      loop_start: 0,
      mime_type: 'audio/mpeg',
      name: 'field_' + s.key,
      priority: 3,
      snes_bits: 0,
      snes_rate: RATE,
    };
    writeFileSync(join(ROOT, 'content/audio_samples', id + '.json'), JSON.stringify(row, null, 2) + '\n');
    table[s.key] = { id, kind: s.kind, dur, ...meta };
    total += mp3.length;
    console.log(`${s.key.padEnd(14)} ${s.kind.padEnd(5)} ${String(mp3.length >> 10).padStart(4)} KB  ${dur.toFixed(1).padStart(5)} s  delay ${(dly * 1000).toFixed(0)} ms  ${meta.slices ? meta.slices.length + ' slices' : 'loop ' + meta.loop.join('..')}`);
  }
  const js = `// GENERATED by scripts/audio/build-field-recordings.mjs. Don't edit; change the script and re-run it.
//
// The field recordings SIREN plays as \`sample\` layers: CC0 recordings from Freesound, credited in
// docs/reference/bibliography.md. \`loop\` is a bed's loop [start, end] and \`slices\` a recording's
// separate calls as [start, length], both in seconds of the decoded file.

export const FIELD = ${JSON.stringify(table, null, 1).replace(/\n\s+(?=[\d\]])/g, ' ')};

const dbGain = (lu, target) => (Number.isFinite(lu) ? Math.min(4, Math.pow(10, (target - lu) / 20)) : 1);

// A bed as a sample layer, levelled to \`target\` LUFS (integrated), or null for an unknown key.
export function fieldBed(key, target = -20, extra = {}) {
  const f = FIELD[key];
  if (!f?.loop) return null;
  return { sample: f.id, loop: f.loop, gain: +dbGain(f.lufs, target).toFixed(3), adsr: { a: 2, d: 0, s: 1, r: 2 }, ...extra };
}

// One call from a recording as a sample layer, picked by \`seed\` (any integer, so a seeded caller
// gets the same one) and levelled to \`target\` LUFS (momentary max). \`length\` is its length in seconds.
export function fieldCall(key, seed = 0, target = -16, extra = {}) {
  const f = FIELD[key];
  if (!f?.slices?.length) return null;
  const s = f.slices[((Math.floor(seed) % f.slices.length) + f.slices.length) % f.slices.length];
  return { sample: f.id, offset: s[0], length: s[1], gain: +dbGain(s[2], target).toFixed(3), adsr: { a: 0.004, d: 0, s: 1, r: 0.05 }, ...extra };
}

// Every sample id, for AudioEngine.preloadSamples.
export const fieldIds = (keys) => (keys || Object.keys(FIELD)).map((k) => FIELD[k]?.id).filter(Boolean);
`;
  writeFileSync(join(ROOT, 'client/shared/field-recordings.js'), js);
  console.log(`${SOURCES.length} recordings, ${(total / 1024).toFixed(0)} KB of MP3`);
}

// run, not imported (field-smoke and the docs read SOURCES)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--fetch')) await fetchAll();
  else await build();
  process.exit(0);   // the WASM decoder holds the event loop open
}
