/**
 * QOA, the Quite OK Audio format (https://qoaformat.org), encode and decode.
 *
 * A lossy codec at a fixed 3.2 bits per sample, decoded with integer sums and no
 * library, which is why recorded music ships in it: a browser can't decode QOA
 * itself, but this does it in a few milliseconds a minute of audio. Follows the
 * reference qoa.h; a file this writes plays in any QOA player, and the reverse.
 *
 * Attaches `QOA` to globalThis, so it works as a classic <script>, as a lazy load
 * from audio-engine.js and as a side-effect import in Node (scripts/audio/qoa-encode.mjs).
 *   QOA.encode([Float32Array per channel], sampleRate) -> Uint8Array
 *   QOA.decode(Uint8Array) -> { channels, sampleRate, samples, channelData: [Float32Array] }
 */
(function (global) {
  const SLICE_LEN = 20, SLICES_PER_FRAME = 256, FRAME_LEN = SLICE_LEN * SLICES_PER_FRAME;
  const SF = [1, 7, 21, 45, 84, 138, 211, 304, 421, 562, 731, 928, 1157, 1419, 1715, 2048];
  const RECIP = SF.map((s) => Math.floor(((1 << 16) + s - 1) / s));
  const QUANT = [7, 7, 7, 5, 5, 3, 3, 1, 0, 0, 2, 2, 4, 4, 6, 6, 6]; // indexed by residual + 8
  const DQT = [0.75, -0.75, 2.5, -2.5, 4.5, -4.5, 7, -7];
  const roundAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
  const DEQ = SF.map((s) => DQT.map((d) => roundAway(s * d)));

  const clamp16 = (v) => (v < -32768 ? -32768 : v > 32767 ? 32767 : v);
  const predict = (h, w) => (h[0] * w[0] + h[1] * w[1] + h[2] * w[2] + h[3] * w[3]) >> 13;
  function update(h, w, sample, residual) {
    const delta = residual >> 4;
    for (let i = 0; i < 4; i++) w[i] += h[i] < 0 ? -delta : delta;
    h[0] = h[1]; h[1] = h[2]; h[2] = h[3]; h[3] = sample;
  }
  function div(v, s) {
    let n = (v * RECIP[s] + (1 << 15)) >> 16;
    n = n + ((v > 0) - (v < 0)) - ((n > 0) - (n < 0));
    return n;
  }

  // ── encode ──
  function encode(channelData, sampleRate) {
    const ch = channelData.length, total = channelData[0].length;
    const pcm = channelData.map((d) => {
      const o = new Int16Array(total);
      for (let i = 0; i < total; i++) o[i] = clamp16(Math.round(d[i] * 32767));
      return o;
    });
    const frames = Math.ceil(total / FRAME_LEN);
    const slicesTotal = Math.ceil(total / SLICE_LEN);
    const out = new Uint8Array(8 + frames * (8 + ch * 16) + slicesTotal * ch * 8);
    const dv = new DataView(out.buffer);
    let p = 0;
    const u32 = (v) => { dv.setUint32(p, v >>> 0); p += 4; };
    const u16 = (v) => { dv.setUint16(p, v); p += 2; };
    out.set([0x71, 0x6f, 0x61, 0x66], 0); p = 4; u32(total);   // "qoaf"
    const lms = pcm.map(() => ({ h: [0, 0, 0, 0], w: [0, 0, -(1 << 13), 1 << 14] }));
    const prevSf = pcm.map(() => 0);
    for (let f0 = 0; f0 < total; f0 += FRAME_LEN) {
      const flen = Math.min(FRAME_LEN, total - f0), slices = Math.ceil(flen / SLICE_LEN);
      out[p++] = ch; out[p++] = (sampleRate >> 16) & 255; u16(sampleRate & 0xffff);
      u16(flen); u16(8 + ch * 16 + slices * ch * 8);
      for (let c = 0; c < ch; c++) {
        for (const arr of [lms[c].h, lms[c].w]) for (const v of arr) { dv.setInt16(p, clamp16(v)); p += 2; }
      }
      for (let s0 = 0; s0 < flen; s0 += SLICE_LEN) {
        const slen = Math.min(SLICE_LEN, flen - s0);
        for (let c = 0; c < ch; c++) {
          const src = pcm[c];
          let best = Infinity, bestHi = 0, bestLo = 0, bestLms = null, bestSf = 0;
          for (let k = 0; k < 16; k++) {
            const sf = (k + prevSf[c]) & 15;   // start at the last slice's factor, as the reference does
            const h = lms[c].h.slice(), w = lms[c].w.slice();
            let err = 0, hi = sf << 28, lo = 0;   // the 64-bit slice word as two 32-bit halves
            for (let i = 0; i < slen; i++) {
              const sample = src[f0 + s0 + i];
              const pred = predict(h, w);
              const q = QUANT[Math.max(-8, Math.min(8, div(sample - pred, sf))) + 8];
              const deq = DEQ[sf][q];
              const rec = clamp16(pred + deq);
              const wp = ((w[0] * w[0] + w[1] * w[1] + w[2] * w[2] + w[3] * w[3]) >> 18) - 0x8ff;
              const e = sample - rec;
              err += e * e + (wp > 0 ? wp * wp : 0);
              if (err > best) break;
              update(h, w, rec, deq);
              const sh = 57 - i * 3;   // residual i's lowest bit in the word
              if (sh >= 32) hi |= q << (sh - 32);
              else if (sh <= 29) lo |= q << sh;
              else { hi |= q >>> (32 - sh); lo |= q << sh; }
            }
            if (err < best) { best = err; bestHi = hi; bestLo = lo >>> 0; bestLms = { h, w }; bestSf = sf; }
          }
          prevSf[c] = bestSf; lms[c] = bestLms;
          dv.setUint32(p, bestHi >>> 0); dv.setUint32(p + 4, bestLo >>> 0); p += 8;
        }
      }
    }
    return out.subarray(0, p);
  }

  // ── decode ──
  function decode(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0) !== 0x716f6166) throw new Error('not a QOA file');
    const total = dv.getUint32(4);
    let p = 8;
    const ch = bytes[p], sampleRate = (bytes[p + 1] << 16) | dv.getUint16(p + 2);
    const channelData = Array.from({ length: ch }, () => new Float32Array(total));
    let at = 0;
    while (at < total && p < bytes.length) {
      const flen = dv.getUint16(p + 4); p += 8;
      const lms = [];
      for (let c = 0; c < ch; c++) {
        const h = [], w = [];
        for (let i = 0; i < 4; i++) h.push(dv.getInt16(p + i * 2));
        for (let i = 0; i < 4; i++) w.push(dv.getInt16(p + 8 + i * 2));
        lms.push({ h, w }); p += 16;
      }
      for (let s0 = 0; s0 < flen; s0 += SLICE_LEN) {
        const slen = Math.min(SLICE_LEN, flen - s0);
        for (let c = 0; c < ch; c++) {
          const hi = dv.getUint32(p), lo = dv.getUint32(p + 4); p += 8;
          const sf = hi >>> 28, { h, w } = lms[c], o = channelData[c];
          for (let i = 0; i < slen; i++) {
            const sh = 57 - i * 3;   // residual i's lowest bit in the word
            const q = sh >= 32 ? (hi >>> (sh - 32)) & 7 : sh <= 29 ? (lo >>> sh) & 7 : ((hi << (32 - sh)) | (lo >>> sh)) & 7;
            const pred = predict(h, w), deq = DEQ[sf][q];
            const rec = clamp16(pred + deq);
            update(h, w, rec, deq);
            o[at + s0 + i] = rec / 32768;
          }
        }
      }
      at += flen;
    }
    return { channels: ch, sampleRate, samples: total, channelData };
  }

  global.QOA = { encode, decode };
})(typeof globalThis !== 'undefined' ? globalThis : window);
