// TRACKER SMOKE: a song's held notes, layered instruments and play-once, and KSAB-7 Sports' two
// themes with the opens they play under.
//
//   node scripts/audio/tracker-smoke.mjs
//
// The live player is read on the recording context (stub-context.mjs) with the clock and the
// scheduler's interval driven by hand; renderSong runs on the offline renderer.
//
// WHAT IT GUARDS:
//   • a step without `len` releases where every song before `len` did: 0.9 of a row past its
//     attack and decay
//   • a step's `len` holds the note that many rows from its onset, never short of its attack
//     and decay
//   • every layer of a layered instrument sounds at the step's pitch, moved by its `tune`
//   • a song played `once` schedules each row once, lets go of its player after its tail, and
//     starts again from the top when asked for again; a song without it still loops
//   • renderSong renders a song once through, finite, ending in silence
//   • each theme's files are what its script writes (build-ksab-theme.mjs for Deadball,
//     build-cphl-theme.mjs for Cluster Puck), every step names an instrument it ships, every held
//     note ends inside the song, no instrument modulates at ratio 1 or 0.5, every timeline in
//     the sport's open runs the theme's length, and the sport's row plays the theme under it
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, tally, ROOT } from './stub-context.mjs';

const { check, done } = tally('audio:tracker');
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── the live player, on the recording context ───────────────────────────────
const { A, ctx, nodes, timers } = loadEngine();
let scheduler = null;
globalThis.setInterval = (fn) => { scheduler = fn; return 1; };
globalThis.clearInterval = () => { scheduler = null; };
// The clock only goes forward, a 25 ms interval at a time as the live one does, so no row is
// ever scheduled late. Each song starts at `t0`, the clock when it was asked for.
const run = (seconds) => { const end = ctx.currentTime + seconds; while (ctx.currentTime < end - 1e-9) { ctx.currentTime = +(ctx.currentTime + 0.025).toFixed(6); scheduler?.(); } };
const play = (def, opts) => { const t0 = ctx.currentTime; A.playMusic(def, opts); scheduler?.(); return t0; };

const STEP = 60 / 120 / 4;   // 120 bpm
const plain = { id: 'plain', waveform: 'sawtooth', config: { gain: 0.5, adsr: { a: 0.02, d: 0.1, s: 0.8, r: 0.2 } } };
const layered = { id: 'ens', waveform: 'sawtooth', config: { layers: [
  { waveform: 'sawtooth', gain: 0.3, adsr: { a: 0.02, d: 0.1, s: 0.8, r: 0.2 } },
  { waveform: 'triangle', tune: -12, gain: 0.2, adsr: { a: 0.05, d: 0.2, s: 0.8, r: 0.2 } },
  { waveform: 'sine', tune: 7, gain: 0.1, adsr: { a: 0.01, d: 0.05, s: 0.8, r: 0.2 } },
] } };
const byId = { plain, ens: layered };
const song = (rows) => ({ id: `t${Math.random()}`, name: 'tracker-smoke', tempo: 120, loop_start: 0, loop_end: 0, priority: 9, channels: [rows], _instrumentsById: byId });
// The release a layer's gain envelope was given: the linear ramp to 0 at the end of its log.
const releaseOf = (gain) => {
  const log = gain.log;
  const end = log.findLast((e) => e.type === 'ramp' && e.value === 0);
  const set = end && log.findLast((e) => e.type === 'set' && e.time < end.time);
  return set ? { at: set.time, end: end.time } : null;
};
const oscs = (from) => nodes.slice(from).filter((n) => n.kind === 'osc' && n.frequency?.log?.[0]?.value > 20);
const gainOf = (osc) => osc.out.map((c) => c.dst).find((d) => d.kind === 'gain' && d.gain.log.some((e) => e.type === 'ramp'));

// legacy timing: no len
{
  const from = nodes.length;
  const t0 = play(song([{ note: 'A3', instrument: 'plain', vol: 1 }, null, null, null]), { owner: 'smoke' });
  const [o] = oscs(from);
  const rel = o && releaseOf(gainOf(o).gain);
  check('a note without len releases 0.9 of a row past its attack and decay', rel && close(rel.at, t0 + 0.02 + 0.1 + 0.9 * STEP, 1e-9), JSON.stringify(rel));
  A.stopMusic();
}
// len holds it, and never cuts the attack and decay short
{
  const from = nodes.length;
  const t0 = play(song([{ note: 'A3', instrument: 'plain', vol: 1, len: 8 }, null, null, null, null, null, null, null, { note: 'B3', instrument: 'plain', vol: 1, len: 1 }, null]), { owner: 'smoke' });
  run(1.2);
  const [o8, o1] = oscs(from);
  const r8 = o8 && releaseOf(gainOf(o8).gain), r1 = o1 && releaseOf(gainOf(o1).gain);
  check('len 8 holds the note eight rows from its onset', r8 && close(r8.at, t0 + 7.9 * STEP, 1e-9), JSON.stringify(r8));
  check('len 1 still waits out the attack and decay', r1 && close(r1.at, t0 + 8 * STEP + 0.02 + 0.1, 1e-9), JSON.stringify(r1));
  A.stopMusic();
}
// every layer at the note, moved by its tune
{
  const from = nodes.length;
  play(song([{ note: 'A3', instrument: 'ens', vol: 0.5, len: 4 }, null, null, null]), { owner: 'smoke' });
  const f = oscs(from).map((o) => o.frequency.log[0].value).sort((a, b) => a - b);
  const want = [110, 220, 220 * Math.pow(2, 7 / 12)];
  check('each layer sounds at the step\'s pitch moved by its tune', f.length === 3 && f.every((v, i) => close(v, want[i], 1e-6)), JSON.stringify(f));
  const gains = oscs(from).map((o) => gainOf(o).gain.log.find((e) => e.type === 'ramp')?.value).sort((a, b) => a - b);
  check('a step\'s vol scales every layer', close(gains[2], 0.15) && close(gains[0], 0.05), JSON.stringify(gains));
  A.stopMusic();
}
// once: each row once, the player let go, the same song again from the top
{
  const rows = [{ note: 'C4', instrument: 'plain', vol: 1 }, null, { note: 'E4', instrument: 'plain', vol: 1 }, null, { note: 'G4', instrument: 'plain', vol: 1, len: 2 }, null, null, null];
  const def = song(rows);
  let from = nodes.length;
  timers.length = 0;
  play(def, { once: true, owner: 'tv', restartIfSame: false });
  run(4);
  check('a song played once schedules each of its notes once', oscs(from).length === 3, `${oscs(from).length} notes`);
  check('and stops scheduling at its end', scheduler === null);
  // its tail: the last note's row and length, and SONG_TAIL (3 s), from the clock at the end
  const letGo = timers.find((t) => t.ms > 2500 && t.ms < 4000);
  check('and lets go of its player after its tail', !!letGo, JSON.stringify(timers.map((t) => t.ms)));
  letGo?.fn();
  from = nodes.length;
  play(def, { once: true, owner: 'tv', restartIfSame: false });
  run(0.2);
  check('the same song asked for again plays from the top', oscs(from).length >= 1);
  A.stopMusic();
  // without once it loops, as every song always has
  from = nodes.length;
  play(def, { owner: 'smoke' });
  run(2.5);
  check('a song without once still loops', oscs(from).length > 3, `${oscs(from).length} notes`);
  A.stopMusic();
}

// ── renderSong, on the offline renderer ─────────────────────────────────────
{
  const { installAudioGlobals } = await import('./offline-audio.mjs');
  installAudioGlobals();
  delete globalThis.AudioEngine;
  new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
  const R = globalThis.AudioEngine;
  const buf = await R.renderSong(song([{ note: 'A3', instrument: 'ens', vol: 0.8, len: 6 }, null, null, null, null, null, { note: 'E4', instrument: 'plain', vol: 0.6 }, null]), { sampleRate: 16000, tail: 1 });
  const d = buf.getChannelData(0);
  let peak = 0, finite = true;
  for (const x of d) { if (!Number.isFinite(x)) finite = false; peak = Math.max(peak, Math.abs(x)); }
  let tail = 0;
  for (let i = d.length - 160; i < d.length; i++) tail = Math.max(tail, Math.abs(d[i]));
  check('renderSong renders once through, the length of the song and its tail', close(d.length / 16000, 8 * STEP + 1, 1 / 16000));
  check('renderSong is finite and sounds', finite && peak > 0.05, `peak ${peak}`);
  check('renderSong ends in silence', tail < 1e-3, `last 10 ms ${tail}`);
}

// ── the themes and their opens ──────────────────────────────────────────────
{
  const opens = await import('../content/build-ksab-opens.mjs');
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  const shipped = new Set(readdirSync(join(ROOT, 'content/audio_instruments')).map((f) => f.replace(/\.json$/, '')));
  const THEMES = [
    { show: 'Deadball', script: 'build-ksab-theme.mjs', rows: (m) => m.instruments, open: opens.DEADBALL_OPEN, seconds: opens.OPEN_SECONDS, cls: 'k7d', card: 'bb_deadball_title', bc: 'bc_1783289744953' },
    { show: 'Cluster Puck', script: 'build-cphl-theme.mjs', rows: (m) => m.band, open: opens.cphlOpen(), seconds: opens.CPHL_OPEN_SECONDS, cls: 'k7h', card: 'cphl_title', bc: 'bc_cluster_puck' },
  ];
  for (const T of THEMES) {
    const theme = await import(`../content/${T.script}`);
    const file = JSON.parse(readFileSync(join(ROOT, `content/audio_songs/${theme.song.id}.json`), 'utf8'));
    const stale = T.rows(theme).filter((r) => !same(JSON.parse(readFileSync(join(ROOT, `content/audio_instruments/${r.id}.json`), 'utf8')), r)).map((r) => r.id);
    check(`${T.show}: the theme's files are what ${T.script} writes`, same(file, theme.song) && !stale.length, `run node scripts/content/${T.script}${stale.length ? ` (${stale.join(', ')})` : ''}`);
    const ids = new Set(file.instrument_ids);
    const rows = Math.max(...file.channels.map((c) => c.length));
    const bad = [];
    file.channels.forEach((ch, c) => ch.forEach((s, r) => {
      if (!s) return;
      if (!ids.has(s.instrument) || !shipped.has(s.instrument)) bad.push(`${c}:${r} ${s.instrument}`);
      if (!/^[A-G][#b]?\d$/.test(s.note)) bad.push(`${c}:${r} note ${s.note}`);
      if (r + (s.len || 1) > rows) bad.push(`${c}:${r} runs past the end`);
    }));
    check(`${T.show}: every step names a shipped instrument, a note, and ends inside the song`, !bad.length, bad.slice(0, 5).join(', '));
    check(`${T.show}: the theme fits the sixteen channels a song plays`, file.channels.length <= 16 && file.channels.every((c) => c.length === rows));
    // SIREN modulates frequency, so a modulator at the carrier (1) or half of it (0.5) is a
    // sideband at 0 Hz: DC that wanders with the index (docs/systems-hockey-sound.md)
    const dc = T.rows(theme).flatMap((r) => (r.config.layers || [r.config]).filter((l) => [1, 0.5].includes(l.fm?.ratio) || [1, 0.5].includes(l.fm?.op2?.ratio)).map(() => r.id));
    check(`${T.show}: no instrument of the theme's modulates at ratio 1 or 0.5`, !dc.length, dc.join(', '));
    // every timeline the open runs is the theme's length, so the picture can't end before the music
    const seconds = rows * 60 / file.tempo / 4;
    const lens = [...T.open.matchAll(new RegExp(`animation: ${T.cls}-[a-z]+ ([\\d.]+)s linear both`, 'g'))].map((m) => +m[1]);
    check(`${T.show}: the open is cut to the theme's length`, lens.length > 3 && lens.every((s) => Math.abs(s - seconds) < 0.01) && Math.abs(T.seconds - seconds) < 1e-9,
      `${[...new Set(lens)].join(', ')} s against ${seconds} s`);
    const card = JSON.parse(readFileSync(join(ROOT, `content/media_graphics/${T.card}.json`), 'utf8'));
    check(`${T.show}: the title row carries the open`, card.content === T.open, 'run node scripts/content/build-ksab-opens.mjs');
    const bc = JSON.parse(readFileSync(join(ROOT, `content/media_broadcasts/${T.bc}.json`), 'utf8'));
    check(`${T.show}: the script plays the theme under its title card`, bc.sports_pools?.theme === theme.SONG_NAME && bc.sports_pools?.title === T.card);
  }

  // The finals' opens (scripts/content/build-final-opens.mjs): played once from a final's first
  // line, under the 3-D view's fly-in, so each is cut to it. Its hit is 1.5 s in, as the venue's name
  // goes up, and its landing chord is on the fly-in's last frame: the Grandstand's (diamond/camera.js
  // APPROACH) and Rinkside's (gl/approach.js FLY). Every step on an instrument a theme ships.
  {
    const fo = await import('../content/build-final-opens.mjs');
    const { APPROACH } = await import('../../client/game/js/panels/diamond/camera.js');
    const { FLY } = await import('../../client/game/js/panels/gl/approach.js');
    for (const [song, bcId, dur] of [[fo.songs[0], 'bc_1783289744953', APPROACH.dur], [fo.songs[1], 'bc_cluster_puck', FLY.dur]]) {
      const file = JSON.parse(readFileSync(join(ROOT, `content/audio_songs/${song.id}.json`), 'utf8'));
      check(`${song.name}: the file is what build-final-opens.mjs writes`, same(file, song), 'run node scripts/content/build-final-opens.mjs');
      const rows = Math.max(...file.channels.map((c) => c.length)), rowS = 60 / file.tempo / 4;
      const bad = [];
      file.channels.forEach((ch, c) => ch.forEach((s, r) => { if (s && (!shipped.has(s.instrument) || r + (s.len || 1) > rows)) bad.push(`${c}:${r} ${s.instrument}`); }));
      check(`${song.name}: every step is on a shipped instrument and ends inside the song, in sixteen channels`, !bad.length && file.channels.length <= 16, bad.slice(0, 4).join(', '));
      // the rows where most channels strike at once are the hit and the landing
      const at = (sec) => file.channels.filter((ch) => ch[Math.round(sec / rowS)]).length;
      check(`${song.name}: the hit lands at 1.5 s and the last chord at the fly-in's ${dur} s`, at(1.5) >= 6 && at(dur) >= 8, `${at(1.5)} and ${at(dur)} channels`);
      const venue = JSON.parse(readFileSync(join(ROOT, `content/media_broadcasts/${bcId}.json`), 'utf8')).sports_pools?.venue;
      check(`${song.name}: its venue opens its final with it, in a key the sting knows`, venue?.finalOpen?.song === song.name && /^[A-G][b#]?$/.test(venue?.finalOpen?.key || ''));
    }
  }
}

done();
