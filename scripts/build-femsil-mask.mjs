// One-shot asset transform: read the black-on-white femsil silhouette and emit a
// transparent-background mask (RGB=white, alpha = inverted luminance × source alpha)
// so it can be used as a plain CSS alpha mask tinted to the accent colour. The body
// is black on a white background, so alpha = 255 − luma (black body → opaque, white
// background → transparent). Not a build step — run once.
import fs from 'fs';
import zlib from 'zlib';

const SRC = 'client/game/assets/femsil.png';
const OUT = 'client/game/assets/femsil-mask.png';

const b = fs.readFileSync(SRC);
let o = 8, W = 0, H = 0; const idat = [];
while (o < b.length) {
  const len = b.readUInt32BE(o);
  const type = b.toString('ascii', o + 4, o + 8);
  const data = b.slice(o + 8, o + 8 + len);
  if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); }
  else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  o += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = 4, stride = W * bpp;
const cur = Buffer.alloc(H * stride);
let p = 0;
for (let y = 0; y < H; y++) {
  const f = raw[p++];
  for (let x = 0; x < stride; x++) {
    const rv = raw[p++];
    const a = x >= bpp ? cur[y * stride + x - bpp] : 0;
    const up = y > 0 ? cur[(y - 1) * stride + x] : 0;
    const ul = (x >= bpp && y > 0) ? cur[(y - 1) * stride + x - bpp] : 0;
    let v = rv;
    if (f === 1) v = rv + a;
    else if (f === 2) v = rv + up;
    else if (f === 3) v = rv + ((a + up) >> 1);
    else if (f === 4) { const pp = a + up - ul, da = Math.abs(pp - a), db = Math.abs(pp - up), dc = Math.abs(pp - ul); v = rv + (da <= db && da <= dc ? a : db <= dc ? up : ul); }
    cur[y * stride + x] = v & 255;
  }
}

// Build the output: filter byte 0 per row, RGB forced white, A = inverted luminance
// of source (× source alpha, in case the background is already transparent).
const out = Buffer.alloc(H * (1 + stride));
let q = 0;
for (let y = 0; y < H; y++) {
  out[q++] = 0;
  for (let x = 0; x < W; x++) {
    const i = y * stride + x * bpp;
    const r = cur[i], g = cur[i + 1], bl = cur[i + 2], sa = cur[i + 3];
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * bl);
    const alpha = Math.round((255 - luma) * (sa / 255));
    out[q++] = 255; out[q++] = 255; out[q++] = 255; out[q++] = alpha;
  }
}

const table = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = (buf) => { let c = ~0; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(out, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${W}x${H}, ${png.length} bytes)`);
