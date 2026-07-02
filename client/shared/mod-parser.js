// ProTracker .MOD parser — shared by the dev-panel importer (which persists the
// parsed song to the DB library) and the game client's AMP jukebox (which plays
// a locally-chosen file entirely in the browser, no server round-trip).
//
// A .MOD carries note patterns (channels) plus 8-bit signed PCM instrument
// samples — a near-perfect match for the tracker's data model. We parse it with
// no deps, wrap each PCM sample as a 16-bit WAV, and build the song's channels
// from the pattern order. Only 31-sample tagged MODs are supported; channels
// past MAX_CHANNELS are dropped, and effects other than the handled set are
// ignored.
//
// Exposed as window.ModParser so both the dev panel (plain-script globals) and
// the game client (ES module reading the global) can use the one copy.

(function () {
  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const C2_MIDI = 60;      // period 428 → C4 (MIDI 60); relative pitches derive from here
  const C2_RATE = 8287;    // Amiga PAL playback rate at period 428 = 7093789.2 / (428*2)
  const MAX_CHANNELS = 16; // mirrors MAX_CHANNELS in audio-engine.js — the song player caps here
  const AMIGA_PAN = [-0.6, 0.6, 0.6, -0.6]; // Amiga hard-panning: channels alternate L-R-R-L

  function modChannelsForTag(tag) {
    if (['M.K.', 'M!K!', 'FLT4', '4CHN'].includes(tag)) return 4;
    if (tag === '6CHN') return 6;
    if (['8CHN', 'FLT8', 'OKTA', 'CD81'].includes(tag)) return 8;
    let m = /^(\d\d)(?:CH|CN)$/.exec(tag);  // e.g. 16CH, 32CN
    if (m) return parseInt(m[1], 10);
    m = /^(\d)CHN$/.exec(tag);              // e.g. 2CHN
    if (m) return parseInt(m[1], 10);
    return null; // not a recognised 31-sample tagged MOD
  }

  function midiToNoteStr(midi) {
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
  }

  function periodToNote(period) {
    if (!period) return null;
    return midiToNoteStr(C2_MIDI + Math.round(12 * Math.log2(428 / period)));
  }

  // Normalise a MOD cell's effect into the player's compact fx shape (see
  // applySampleFx in audio-engine.js). Volume (Cxx), speed/tempo (Fxx) and the
  // arrangement effects (Bxx/Dxx) are handled separately, so they return null here.
  function cellFx(cell) {
    const p = cell.param;
    switch (cell.effect) {
      case 0x0: return p ? { t: 'arp', x: p >> 4, y: p & 0x0F } : null;
      case 0x1: return { t: 'porta', dir: 1, speed: p };
      case 0x2: return { t: 'porta', dir: -1, speed: p };
      case 0x3: return { t: 'toneporta', speed: p };
      case 0x4: return { t: 'vib', rate: p >> 4, depth: p & 0x0F };
      case 0xA: return { t: 'volslide', up: p >> 4, down: p & 0x0F };
      default: return null;
    }
  }

  function modSanitize(s, fallback) {
    const clean = (s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
    return clean || fallback;
  }

  // Wrap 8-bit signed PCM as a 16-bit mono WAV, base64-encoded (decoded via
  // AudioContext.decodeAudioData, which needs a real container).
  function pcm8ToWavBase64(int8, sampleRate) {
    const n = int8.length;
    const out = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(out);
    let o = 0;
    const wr = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
    wr('RIFF'); dv.setUint32(o, 36 + n * 2, true); o += 4;
    wr('WAVEfmt '); dv.setUint32(o, 16, true); o += 4;
    dv.setUint16(o, 1, true); o += 2;               // PCM
    dv.setUint16(o, 1, true); o += 2;               // mono
    dv.setUint32(o, sampleRate, true); o += 4;
    dv.setUint32(o, sampleRate * 2, true); o += 4;  // byte rate
    dv.setUint16(o, 2, true); o += 2;               // block align
    dv.setUint16(o, 16, true); o += 2;              // bits/sample
    wr('data'); dv.setUint32(o, n * 2, true); o += 4;
    for (let i = 0; i < n; i++) { dv.setInt16(o, int8[i] * 256, true); o += 2; }
    const bytes = new Uint8Array(out);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // Parse a .MOD ArrayBuffer into structured pattern + sample data. Channel step
  // instrument refs are placeholders ("S<n>") the caller remaps to real ids.
  function parseMod(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    const readStr = (off, len) => {
      let s = '';
      for (let i = 0; i < len; i++) { const c = u8[off + i]; if (!c) break; if (c >= 32 && c < 127) s += String.fromCharCode(c); }
      return s.trim();
    };
    if (buf.byteLength < 1084) throw new Error('File too small to be a 31-sample MOD.');
    const tag = readStr(1080, 4);
    const numChannels = modChannelsForTag(tag);
    if (!numChannels) throw new Error(`Unsupported MOD variant (tag "${tag || '—'}"). Only 31-sample tagged .MOD files are supported.`);

    const title = readStr(0, 20);
    const samples = [];
    for (let i = 0; i < 31; i++) {
      const o = 20 + i * 30;
      const ftNibble = u8[o + 24] & 0x0F;            // signed -8..7, ~1/8 semitone steps
      samples.push({
        name: readStr(o, 22),
        len: dv.getUint16(o + 22, false) * 2,        // stored in words
        finetune: ftNibble < 8 ? ftNibble : ftNibble - 16,
        volume: u8[o + 25],                          // 0-64
        repeatStart: dv.getUint16(o + 26, false) * 2,
        repeatLen: dv.getUint16(o + 28, false) * 2,
        pcm: null,
      });
    }

    const songLength = u8[950];
    const order = [];
    for (let i = 0; i < songLength; i++) order.push(u8[952 + i]);
    const numPatterns = Math.max(0, ...order) + 1;

    const patternBase = 1084;
    const patternSize = 64 * numChannels * 4;
    const cellAt = (pat, row, ch) => {
      const o = patternBase + pat * patternSize + (row * numChannels + ch) * 4;
      const b0 = u8[o], b1 = u8[o + 1], b2 = u8[o + 2], b3 = u8[o + 3];
      return { sample: (b0 & 0xF0) | (b2 >> 4), period: ((b0 & 0x0F) << 8) | b1, effect: b2 & 0x0F, param: b3 };
    };

    // Sample PCM (8-bit signed) follows all pattern data.
    let dataOff = patternBase + numPatterns * patternSize;
    for (const s of samples) {
      if (s.len > 0 && dataOff + s.len <= buf.byteLength) s.pcm = new Int8Array(buf, dataOff, s.len);
      dataOff += s.len;
    }

    // Resolve the actually-played row sequence, honouring position-jump (Bxx) and
    // pattern-break (Dxx). Detect the natural loop point (first row we revisit) so the
    // song loops where the module intended rather than at the raw pattern boundary.
    const played = [];
    let loopStartIndex = 0;
    const seen = new Map();
    let pos = 0, row = 0, guard = 0;
    while (pos < order.length && guard++ < 20000) {
      const key = pos + ':' + row;
      if (seen.has(key)) { loopStartIndex = seen.get(key); break; }
      seen.set(key, played.length);
      const pat = order[pos];
      played.push({ pat, row });
      let nextPos = pos, nextRow = row + 1, jump = false;
      for (let ch = 0; ch < numChannels; ch++) {
        const cell = cellAt(pat, row, ch);
        if (cell.effect === 0x0B) { nextPos = cell.param; nextRow = 0; jump = true; }          // position jump
        else if (cell.effect === 0x0D) { nextPos = pos + 1; nextRow = (cell.param >> 4) * 10 + (cell.param & 0x0F); jump = true; } // pattern break (row is BCD)
      }
      if (jump) { pos = nextPos; row = nextRow > 63 ? 0 : nextRow; }
      else if (++row > 63) { row = 0; pos++; }
    }

    // Initial speed / tempo (Fxx). MOD default is speed 6 @ 125 BPM; row duration is
    // speed*2.5/BPM seconds, which our sequencer expresses as tempo = 6*BPM/speed.
    let speed = 6, bpm = 125, gotSpeed = false, gotBpm = false;
    for (const { pat, row: r } of played) {
      for (let ch = 0; ch < numChannels; ch++) {
        const cell = cellAt(pat, r, ch);
        if (cell.effect === 0x0F && cell.param > 0) {
          if (cell.param < 0x20) { if (!gotSpeed) { speed = cell.param; gotSpeed = true; } }
          else if (!gotBpm) { bpm = cell.param; gotBpm = true; }
        }
      }
      if (gotSpeed && gotBpm) break;
    }
    const tempo = Math.max(1, Math.round(6 * bpm / speed));

    // Build channels from the played sequence. A note with sample 0 keeps the channel's
    // previous sample (MOD semantics). Effect-only cells are kept when they carry a
    // continuation effect (porta / tone porta / vibrato / volume slide) so the player
    // can keep modulating the ringing voice. Placeholder instrument refs ("S<n>") are
    // remapped to real instrument ids by the caller.
    const chCount = Math.min(numChannels, MAX_CHANNELS);
    const channels = Array.from({ length: chCount }, () => []);
    const lastSample = new Array(chCount).fill(0);
    for (const { pat, row: r } of played) {
      for (let ch = 0; ch < chCount; ch++) {
        const cell = cellAt(pat, r, ch);
        if (cell.sample) lastSample[ch] = cell.sample;
        const note = periodToNote(cell.period);
        const smpIdx = lastSample[ch];
        const fx = cellFx(cell);
        if (note && smpIdx) {
          const vol = cell.effect === 0x0C ? Math.min(1, cell.param / 64) : (samples[smpIdx - 1]?.volume ?? 48) / 64;
          const st = { note, instrument: `S${smpIdx}`, vol: Math.round(vol * 100) / 100 };
          if (fx) st.fx = fx;
          channels[ch].push(st);
        } else if (fx && fx.t !== 'arp') {
          // Continuation-capable effect with no new note — arpeggio only makes sense on a note.
          channels[ch].push({ note: null, instrument: smpIdx ? `S${smpIdx}` : null, fx });
        } else {
          channels[ch].push(null);
        }
      }
    }

    const channelPan = Array.from({ length: chCount }, (_, i) => AMIGA_PAN[i % 4]);

    return { title, tag, numChannels, channels, samples, tempo, loopStart: loopStartIndex, loopEnd: Math.max(0, played.length - 1), channelPan };
  }

  // Build the sample + instrument def a used MOD sample maps to. Shared by the
  // dev-panel importer (which strips out `data`/`_sampleDef` to POST DB rows) and
  // the local jukebox (which keeps them inline for browser playback). idPrefix
  // namespaces the ids so concurrent local imports never collide in the sample cache.
  function buildSampleInstrument(modSample, idx, base, idPrefix) {
    const looped = modSample.repeatLen > 2;
    const detune = modSample.finetune ? Math.round(modSample.finetune * 12.5) : 0; // ~1/8 semitone per unit
    const sampleId = `${idPrefix}_s${String(idx).padStart(2, '0')}`;
    const instrumentId = `${idPrefix}_i${String(idx).padStart(2, '0')}`;
    const sampleDef = {
      id: sampleId,
      name: `${base}_s${String(idx).padStart(2, '0')}`, category: 'misc', priority: 5,
      data: pcm8ToWavBase64(modSample.pcm, C2_RATE), mime_type: 'audio/wav',
      base_note: C2_MIDI, snes_rate: 16000, snes_bits: 8, echo_mix: 0,
      loop_start: looped ? modSample.repeatStart / C2_RATE : 0,
      loop_end: looped ? (modSample.repeatStart + modSample.repeatLen) / C2_RATE : 0,
      config: { adsr: { a: 0.005, d: 0, s: 1, r: 0.05 }, gain: 1, ...(detune ? { detune } : {}) }, enabled: 1,
    };
    const instrument = {
      id: instrumentId,
      name: `${base}_i${String(idx).padStart(2, '0')}`, category: 'misc',
      waveform: 'sine', sample_id: sampleId, config: {}, enabled: 1,
      _sampleDef: sampleDef,
    };
    return { sampleDef, instrument };
  }

  let _localSeq = 0;

  // Parse a .MOD into a fully self-contained, playable song def — samples inlined
  // as base64 in each instrument's `_sampleDef` so window.AudioEngine.playMusic can
  // render it with no server/DB involvement. Used by the AMP jukebox for a file the
  // player chose off their own machine. Throws on an unsupported/invalid module.
  function parseModToLocalSong(buf, fileName) {
    const mod = parseMod(buf);
    const base = modSanitize(mod.title, modSanitize((fileName || '').replace(/\.mod$/i, ''), 'mod'));
    const idPrefix = `local_${base}_${_localSeq++}`;

    // Which MOD sample indices are actually referenced by a note.
    const usedIdx = new Set();
    for (const ch of mod.channels) for (const st of ch) {
      if (st && typeof st.instrument === 'string' && st.instrument[0] === 'S') usedIdx.add(parseInt(st.instrument.slice(1), 10));
    }

    const instByModIdx = {};
    const instrumentsById = {};
    let sampleFails = 0;
    for (const idx of usedIdx) {
      const s = mod.samples[idx - 1];
      if (!s?.pcm || s.pcm.length === 0) { sampleFails++; continue; }
      const { instrument } = buildSampleInstrument(s, idx, base, idPrefix);
      instByModIdx[idx] = instrument.id;
      instrumentsById[instrument.id] = instrument;
    }

    // Remap placeholder refs ("S<n>") → real instrument ids. Note cells whose sample
    // failed are dropped; effect-only cells (note null) only modulate a live voice.
    const instrumentIds = new Set();
    for (const ch of mod.channels) {
      for (let i = 0; i < ch.length; i++) {
        const st = ch[i];
        if (!st) continue;
        if (st.note == null) {
          if (typeof st.instrument === 'string' && st.instrument[0] === 'S') st.instrument = instByModIdx[parseInt(st.instrument.slice(1), 10)] || null;
          continue;
        }
        const id = instByModIdx[parseInt(st.instrument.slice(1), 10)];
        if (id) { st.instrument = id; instrumentIds.add(id); }
        else ch[i] = null;
      }
    }

    const song = {
      id: idPrefix,
      name: base, category: 'misc', tempo: mod.tempo, priority: 5,
      loop_start: mod.loopStart, loop_end: mod.loopEnd,
      instrument_ids: [...instrumentIds], channels: mod.channels,
      channel_pan: mod.channelPan, enabled: 1,
      _instrumentsById: instrumentsById,
      _local: true,
    };

    return { song, numChannels: mod.numChannels, droppedChannels: Math.max(0, mod.numChannels - MAX_CHANNELS), sampleFails };
  }

  window.ModParser = {
    MAX_CHANNELS, C2_MIDI, C2_RATE,
    modChannelsForTag, midiToNoteStr, periodToNote, cellFx, modSanitize, pcm8ToWavBase64,
    parseMod, buildSampleInstrument, parseModToLocalSong,
  };
})();
