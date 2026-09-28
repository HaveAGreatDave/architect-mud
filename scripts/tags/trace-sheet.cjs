// Trace an alphabet sheet into three paths per letter:
//   d     the letter body (fill + shading + gloss)
//   line  the body plus the dark pixels hugging it: the hand-drawn keyline, without the drop shadow
//   shade the darker inner shading
// All three share one transform: origin at the body's bbox centre, one unit = median letter height.
// Usage: node trace2.cjs sheet.png ABCDEF,GHIJKL,MNOPQ,RSTUV,WXYZ > glyphs.json
const Jimp = require('jimp');
const potrace = require('potrace');

const SHEET = process.argv[2] || 'sheet.png';
const ORDER = (process.argv[3] || 'ABCDEF,GHIJKL,MNOPQ,RSTUV,WXYZ').split(',');
const KEY_R = 6;     // how far a keyline reaches from its letter, in sheet pixels
const UP = 3;        // upsample for smoother fits

(async () => {
  const im = await Jimp.read(SHEET);
  const { width: W, height: H, data: px } = im.bitmap;
  const cls = new Uint8Array(W * H);   // 0 bg, 1 fill/gloss, 2 shade, 3 dark
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (r > 200 && g > 200 && b > 200) cls[i] = 1;                       // gloss
    else if (r < 110 && g > 185 && b > 185) cls[i] = 1;                  // fill
    else if (r < 110 && g > 105 && b > 160) cls[i] = 2;                  // shade
    else if (r < 100 && g < 100 && b < 120) cls[i] = 3;                  // outline / shadow
  }
  // Components of body (fill ∪ shade).
  const lab = new Int32Array(W * H), comps = [];
  for (let s = 0; s < W * H; s++) {
    if (!(cls[s] === 1 || cls[s] === 2) || lab[s]) continue;
    const id = comps.length + 1, st = [s]; lab[s] = id;
    const c = { id, n: 0, x0: W, y0: H, x1: 0, y1: 0 };
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0; c.n++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (const [qx, qy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        if (lab[q] || !(cls[q] === 1 || cls[q] === 2)) continue;
        lab[q] = id; st.push(q);
      }
    }
    comps.push(c);
  }
  const big = comps.filter((c) => c.n > 60);
  // Rows: sort by centre y and split where the gap between neighbours exceeds 40% of the median
  // letter height — no fixed pixel threshold, so a sheet at another scale splits the same way.
  const hs = big.map((c) => c.y1 - c.y0).sort((a, b) => a - b);
  const medH = hs[hs.length >> 1];
  const byY = [...big].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows = [[byY[0]]];
  for (let i = 1; i < byY.length; i++) {
    const prev = rows[rows.length - 1], last = prev[prev.length - 1];
    const gap = (byY[i].y0 + byY[i].y1) / 2 - (last.y0 + last.y1) / 2;
    if (gap > medH * 0.4) rows.push([byY[i]]); else prev.push(byY[i]);
  }
  if (rows.length !== ORDER.length) throw new Error(`found ${rows.length} rows, expected ${ORDER.length}`);
  // Within a row: left to right, merging small pieces (the i's dot) into the letter they overlap.
  // A small piece goes to the letter it overlaps MOST, once every letter is known. Taking the first
  // one it touched gave the i's dot to the H, which crowds it on the sheet: every H carried a dot
  // and every I was a bare stem.
  const boxes = {};
  const SMALL = medH * medH * 0.15;
  rows.forEach((row, ri) => {
    row.sort((a, b) => a.x0 - b.x0);
    const merged = row.filter((c) => c.n >= SMALL).map((c) => ({ ...c, ids: [c.id] }));
    const overlap = (c, m) => Math.min(c.x1, m.x1) - Math.max(c.x0, m.x0);
    for (const c of row) {
      if (c.n >= SMALL) continue;
      const host = merged.reduce((a, m) => (overlap(c, m) > (a ? overlap(c, a) : 10) ? m : a), null);
      if (host) {
        host.x0 = Math.min(host.x0, c.x0); host.x1 = Math.max(host.x1, c.x1);
        host.y0 = Math.min(host.y0, c.y0); host.y1 = Math.max(host.y1, c.y1); host.ids.push(c.id);
      } else merged.push({ ...c, ids: [c.id] });
    }
    merged.sort((a, b) => a.x0 - b.x0);
    if (merged.length !== ORDER[ri].length) throw new Error(`row ${ri}: ${merged.length} letters, expected ${ORDER[ri]}`);
    merged.forEach((c, i) => { boxes[ORDER[ri][i]] = c; });
  });

  const traceMask = async (bw, bh, on) => {
    const g = new Jimp(bw * UP, bh * UP, 0xffffffff);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!on(x, y)) continue;
      for (let v = 0; v < UP; v++) for (let u = 0; u < UP; u++)
        g.bitmap.data.writeUInt32BE(0x000000ff, ((y * UP + v) * bw * UP + x * UP + u) * 4);
    }
    g.blur(3);
    const buf = await g.getBufferAsync(Jimp.MIME_PNG);
    return new Promise((res, rej) => {
      const p = new potrace.Potrace({ turdSize: 30, optTolerance: 2.5, alphaMax: 1.2, threshold: 128 });
      p.loadImage(buf, (err) => err ? rej(err) : res(/d="([^"]*)"/.exec(p.getPathTag())?.[1] || ''));
    });
  };

  const out = {};
  for (const [ch, c] of Object.entries(boxes)) {
    const pad = KEY_R + 4;
    const ox = c.x0 - pad, oy = c.y0 - pad, bw = c.x1 - c.x0 + 1 + pad * 2, bh = c.y1 - c.y0 + 1 + pad * 2;
    const at = (x, y) => { const X = x + ox, Y = y + oy; return (X < 0 || Y < 0 || X >= W || Y >= H) ? -1 : Y * W + X; };
    const mine = (i) => i >= 0 && c.ids.includes(lab[i]);
    // distance-limited dilation of the body, for the keyline
    const near = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!mine(at(x, y))) continue;
      for (let v = -KEY_R; v <= KEY_R; v++) for (let u = -KEY_R; u <= KEY_R; u++) {
        if (u * u + v * v > KEY_R * KEY_R) continue;
        const X = x + u, Y = y + v;
        if (X >= 0 && Y >= 0 && X < bw && Y < bh) near[Y * bw + X] = 1;
      }
    }
    const d = await traceMask(bw, bh, (x, y) => mine(at(x, y)));
    const line = await traceMask(bw, bh, (x, y) => { const i = at(x, y); return mine(i) || (near[y * bw + x] && i >= 0 && cls[i] === 3); });
    const shade = await traceMask(bw, bh, (x, y) => { const i = at(x, y); return mine(i) && cls[i] === 2; });
    const cx = ((c.x0 + c.x1) / 2 - ox + 0.5) * UP, cy = ((c.y0 + c.y1) / 2 - oy + 0.5) * UP, k = 1 / (medH * UP);
    const norm = (s) => { let n = 0; return s.replace(/-?\d+(?:\.\d+)?/g, (num) => {
      const v = parseFloat(num), isX = (n++ % 2) === 0;
      return (+((isX ? v - cx : v - cy) * k).toFixed(2)).toString();
    }).replace(/,/g, ' ').replace(/\s+/g, ' ').trim(); };
    out[ch] = { w: +((c.x1 - c.x0) / medH).toFixed(3), h: +((c.y1 - c.y0) / medH).toFixed(3), d: norm(d), line: norm(line), shade: norm(shade) };
    process.stderr.write(ch);
  }
  process.stdout.write(JSON.stringify(out));
  process.stderr.write(`\nmedian height ${medH}px, ${JSON.stringify(out).length} bytes\n`);
})().catch((e) => { console.error(e.message); process.exit(1); });
