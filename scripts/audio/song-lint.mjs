// SONG LINT: read a tracker song the way a composer would and say what's flat about it.
//
//   node scripts/audio/song-lint.mjs                    every synth song under content/audio_songs
//   node scripts/audio/song-lint.mjs neon_rain          one, by name or id
//   node scripts/audio/song-lint.mjs --module scripts/content/build-ambient-loops.mjs
//                                                       the songs a build script would write
//   --json                                              the numbers, for a script
//
// Report only; nothing here fails a build. Sample-backed songs (.MOD imports) are skipped: their
// notes are someone else's.
//
// What it measures, per pitched channel and per song. The numbers and the reasons are in
// docs/reference/game-music-craft.md, from the music-generation evaluation literature (Yang &
// Lerch 2018; MusPy) and tracker practice:
//   scale fit        the largest share of notes inside one major or minor scale (< 0.9: stray notes)
//   pc entropy       pitch-class entropy in bits (> 3.3 near random; < 1.5 a drone)
//   steps            share of melodic moves of two semitones or less (a lead under 0.5 isn't singable)
//   range            lowest to highest note (a lead over 19 semitones sprawls)
//   repeats          a 4-bar block played again unchanged, more than twice in a row
//   velocity         distinct levels in a channel (one level is a drum machine with no hands)
//   groove           how alike consecutive bars' onsets are (1.0 every bar the same)
//   register         bass and lead within an octave of each other
//   pan              a bass off centre
//   gate             every note one row long, nothing held (no `len` anywhere)
//   loop             how long the loop is in seconds (under 20 s wears out in a room you stay in)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PCN = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midiOf = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n || ''); return m && PCN[m[1]] != null ? (+m[2] + 1) * 12 + PCN[m[1]] : null; };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

// A drum channel: every note on an instrument with no oscillator (noise or modes), or one pitch
// played over and over.
function isDrum(notes, inst) {
  const layers = inst?.config?.layers?.length ? inst.config.layers : [inst?.config || {}];
  const noisy = inst?.waveform === 'noise' || layers.every((l) => (l.noiseMix ?? (l.waveform === 'noise' ? 1 : 0)) >= 1 || l.modes);
  const pitches = new Set(notes.map((n) => n.m));
  return noisy || (pitches.size <= 2 && notes.length >= 8);
}

export function lint(song, instruments = {}) {
  const R = 16, steps = Math.max(0, ...song.channels.map((c) => c.length));
  const bars = Math.ceil(steps / R);
  const loopRows = (song.loop_end > (song.loop_start || 0) ? song.loop_end : steps - 1) - (song.loop_start || 0) + 1;
  const loopSeconds = loopRows * 60 / (song.tempo || 120) / 4;
  const ch = song.channels.map((c, k) => {
    const notes = c.map((s, i) => (s && s.note ? { i, m: midiOf(s.note), vol: s.vol ?? 1, len: s.len || 1, inst: s.instrument } : null)).filter((n) => n && n.m != null);
    const inst = instruments[notes[0]?.inst];
    return { k, notes, drum: notes.length ? isDrum(notes, inst) : false, pan: song.channel_pan?.[k] ?? 0, name: inst?.name || notes[0]?.inst || '' };
  }).filter((c) => c.notes.length);
  const pitched = ch.filter((c) => !c.drum);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  for (const c of pitched) c.median = med(c.notes.map((n) => n.m));
  const bass = pitched.filter((c) => c.median < 52).sort((a, b) => a.median - b.median)[0];
  // the lead: the most melodic upper channel, by how much it moves by step and how much it plays
  // (an arpeggio or an ostinato has the notes but not the steps)
  const stepsOf = (c) => { let st = 0, n = 0; for (let k = 1; k < c.notes.length; k++) { const d = Math.abs(c.notes[k].m - c.notes[k - 1].m); if (d === 0) continue; n++; if (d <= 2) st++; } return n ? st / n : 0; };
  // (a pad holds its notes for bars; a tune doesn't)
  const meanLen = (c) => c.notes.reduce((t, n) => t + n.len, 0) / c.notes.length;
  const lead = pitched.filter((c) => c !== bass && c.notes.length >= 8 && meanLen(c) < 8 && (!bass || c.median >= bass.median + 7))
    .map((c) => [c, (0.25 + stepsOf(c)) * Math.log(1 + c.notes.length) * (c.median >= 60 ? 1.3 : 1)])
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  // whole-song pitch: best major-scale fit (a minor key is a major scale's relative)
  const all = pitched.flatMap((c) => c.notes.map((n) => n.m));
  const hist = new Array(12).fill(0); for (const m of all) hist[((m % 12) + 12) % 12]++;
  let fit = 0, key = 0;
  for (let r = 0; r < 12; r++) { const inside = MAJOR.reduce((s, d) => s + hist[(r + d) % 12], 0); if (inside > fit) { fit = inside; key = r; } }
  const scaleFit = all.length ? fit / all.length : 1;
  const entropy = (h) => { const n = h.reduce((a, b) => a + b, 0); return n ? -h.reduce((s, v) => (v ? s + (v / n) * Math.log2(v / n) : s), 0) : 0; };
  const pcEntropy = entropy(hist);

  // groove: 1 - mean Hamming distance between consecutive bars' onset patterns, all channels
  const onsets = Array.from({ length: bars }, () => new Array(R).fill(0));
  for (const c of ch) for (const n of c.notes) onsets[Math.floor(n.i / R)][n.i % R] = 1;
  let ham = 0, pairs = 0;
  for (let b = 1; b < bars; b++) { let d = 0; for (let r = 0; r < R; r++) d += onsets[b][r] !== onsets[b - 1][r]; ham += d / R; pairs++; }
  const groove = pairs ? 1 - ham / pairs : 1;
  const emptyBars = onsets.filter((b) => !b.some(Boolean)).length;

  const findings = [];
  const say = (level, msg) => findings.push({ level, msg });
  // (a theme that modulates or borrows ♭VI and ♭VII reads 0.85-0.9 on purpose)
  if (scaleFit < 0.9 && all.length > 16) say(scaleFit < 0.85 ? 'warn' : 'info', `scale fit ${scaleFit.toFixed(2)}: ${Math.round((1 - scaleFit) * 100)}% of notes are outside ${NAMES[key]} major / ${NAMES[(key + 9) % 12]} minor${scaleFit >= 0.85 ? ' (fine if it modulates or borrows)' : ''}`);
  if (pcEntropy > 3.3) say('warn', `pitch-class entropy ${pcEntropy.toFixed(2)} bits: close to random`);
  if (pcEntropy < 1.5 && all.length > 16) say('info', `pitch-class entropy ${pcEntropy.toFixed(2)} bits: almost a drone`);
  if (groove >= 0.999 && bars >= 4) say('warn', 'every bar has the same rhythm: nothing moves (aim 0.85-0.95)');
  if (loopSeconds < 20 && !/theme|jingle|open/i.test(song.category + song.name)) say('info', `the loop is ${loopSeconds.toFixed(1)} s; in a place a player stays, under 20 s wears out`);
  const blocks = [];
  for (let b = 0; b + 4 <= bars; b += 4) blocks.push(JSON.stringify(ch.map((c) => c.notes.filter((n) => n.i >= b * R && n.i < (b + 4) * R).map((n) => [n.i - b * R, n.m]))));
  let run = 1, worst = 1;
  for (let k = 1; k < blocks.length; k++) { run = blocks[k] === blocks[k - 1] ? run + 1 : 1; worst = Math.max(worst, run); }
  if (worst > 2) say('warn', `a 4-bar block plays ${worst} times running, unchanged`);
  if (!song.channels.some((c) => c.some((s) => s && s.len > 1))) say('info', 'no note is held (no `len`): every note is a row long, so nothing sustains between attacks');
  if (!(song.swing > 0.5)) {
    const busy = ch.some((c) => c.notes.length >= bars * 6);
    if (busy && bars >= 4) say('info', 'straight sixteenths throughout: a little `swing` (0.53-0.58) loosens a busy part');
  }
  for (const c of ch) {
    const vols = new Set(c.notes.map((n) => n.vol));
    if (vols.size === 1 && c.notes.length >= 16) say('warn', `ch ${c.k} (${c.name}): every note at one velocity`);
  }
  // an orchestra seats its low strings to one side; a band keeps its bass in the middle
  if (bass && Math.abs(bass.pan) > 0.15 && !ch.some((c) => c !== bass && !c.drum && Math.abs(c.pan) <= 0.15 && c.median < 55)) say(ch.length >= 10 ? 'info' : 'warn', `ch ${bass.k} is the bass and it's panned ${bass.pan}; keep the bass centred`);
  if (bass && lead && lead.median - bass.median < 12) say('warn', `bass (ch ${bass.k}) and lead (ch ${lead.k}) sit within an octave of each other`);
  if (lead) {
    const ints = []; for (let k = 1; k < lead.notes.length; k++) ints.push(Math.abs(lead.notes[k].m - lead.notes[k - 1].m));
    const stepRatio = ints.length ? ints.filter((d) => d <= 2).length / ints.length : 1;
    const range = Math.max(...lead.notes.map((n) => n.m)) - Math.min(...lead.notes.map((n) => n.m));
    const distinct = new Set(lead.notes.map((n) => n.m)).size;
    lead.stepRatio = stepRatio; lead.range = range;
    if (ints.length > 8 && stepRatio < 0.5) say('warn', `lead (ch ${lead.k}): ${Math.round(stepRatio * 100)}% steps; a line under half steps is hard to follow`);
    if (range > 19) say('info', `lead (ch ${lead.k}) spans ${range} semitones`);
    if (distinct <= 3 && lead.notes.length >= 16) say('warn', `lead (ch ${lead.k}) uses ${distinct} pitches in ${lead.notes.length} notes`);
    // unrecovered leaps: a leap of a sixth or more not followed by a step back
    let bad = 0; for (let k = 2; k < lead.notes.length; k++) { const a = lead.notes[k - 1].m - lead.notes[k - 2].m, b = lead.notes[k].m - lead.notes[k - 1].m; if (Math.abs(a) >= 8 && !(Math.sign(b) === -Math.sign(a) && Math.abs(b) <= 2)) bad++; }
    if (bad > 2) say('info', `lead (ch ${lead.k}): ${bad} big leaps that don't step back`);
  }
  if (pitched.length < 2 && ch.length < 3) say('info', `${ch.length} channel${ch.length === 1 ? '' : 's'}: thin for a loop`);
  return {
    name: song.name, id: song.id, tempo: song.tempo, bars, loopSeconds: +loopSeconds.toFixed(1), swing: song.swing ?? 0.5,
    channels: ch.length, drums: ch.filter((c) => c.drum).length,
    key: `${NAMES[key]} major / ${NAMES[(key + 9) % 12]} minor`, scaleFit: +scaleFit.toFixed(3), pcEntropy: +pcEntropy.toFixed(2),
    groove: +groove.toFixed(3), emptyBars, lead: lead ? { ch: lead.k, steps: +(lead.stepRatio ?? 0).toFixed(2), range: lead.range } : null,
    bass: bass ? { ch: bass.k, pan: bass.pan } : null, findings,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const read = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')));
  const instruments = Object.fromEntries(read('content/audio_instruments').map((r) => [r.id, r]));
  let songs;
  if (arg('--module')) {
    const m = await import(pathToFileURL(resolve(ROOT, arg('--module'))).href);
    songs = m.songs || [m.song];
    for (const r of m.instruments || []) instruments[r.id] = r;
  } else {
    const names = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--module'));
    songs = read('content/audio_songs').filter((s) => !names.length || names.includes(s.name) || names.includes(s.id));
  }
  songs = songs.filter((s) => !(s.instrument_ids || []).some((id) => instruments[id]?.sample_id));
  const out = songs.map((s) => lint(s, instruments)).filter((r) => r.channels).sort((a, b) => a.name.localeCompare(b.name));
  if (argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); return; }
  for (const r of out) {
    console.log(`\n${r.name}  ${r.tempo} bpm, ${r.bars} bars, loop ${r.loopSeconds} s, ${r.channels} ch (${r.drums} drum), swing ${r.swing}`);
    console.log(`  ${r.key}, scale fit ${r.scaleFit}, pc entropy ${r.pcEntropy}, groove ${r.groove}${r.lead ? `, lead ch ${r.lead.ch}: ${Math.round(r.lead.steps * 100)}% steps over ${r.lead.range} st` : ''}`);
    for (const f of r.findings) console.log(`  ${f.level === 'warn' ? '!' : '·'} ${f.msg}`);
    if (!r.findings.length) console.log('  nothing to say');
  }
  const warns = out.reduce((s, r) => s + r.findings.filter((f) => f.level === 'warn').length, 0);
  console.log(`\n${out.length} songs, ${warns} warnings`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
