// THE SEA'S FINE SURFACE: a baked slope texture under the chop.
//
// The chop in sea-glsl.js is three sine trains, and two of them are nearly the same size and
// wavelength crossing at about 60 degrees. Two equal crossing sines make an egg crate, which is
// what read as "blobs". A real sea has dozens of wavelengths and headings at once, and that is what
// breaks the surface into streaks.
//
// This bakes one tileable slope field from a wind-sea spectrum (a few hundred waves on integer wave
// vectors, so it wraps exactly) and the shader reads it twice, at two scales and headings, scrolling
// at two speeds. It's lighting only: it never moves a vertex, so the hull, the helideck, the server
// and scripts/shapes/sea.mjs never see it. That's why it may be a texture when the swell may not.
//
// The CPU raster (glFloor 0) doesn't get it. Foam still keys off seaChop, so the whitecap
// coverage is unchanged.

const N = 256;          // texels a side; power of two so it mipmaps and repeats
const WAVES = 320;
export const SEA_DETAIL_UNIT = 11;   // a texture unit neither floor.js nor water.js uses

// Deterministic, so every client draws the same sea.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Returns RG8 slope (du, dv) per texel, 0.5 = flat. Exported for the gate.
export function bakeSeaDetail() {
  const rnd = rng(0x5ea5eed);
  const cosT = new Float32Array(N);
  for (let i = 0; i < N; i++) cosT[i] = Math.cos(2 * Math.PI * i / N);
  const su = new Float32Array(N * N), sv = new Float32Array(N * N);
  const seen = new Set();
  let placed = 0, tries = 0;
  while (placed < WAVES && tries++ < WAVES * 50) {
    // Log-uniform wavenumber from 3 to 48 cycles per repeat, heading spread round +u (the sea
    // frame's downwind axis) as cos^2, with a fifth of the energy running against it.
    const kmag = 3 * Math.pow(16, rnd());
    let th = (rnd() - 0.5) * Math.PI;
    if (Math.abs(Math.cos(th)) ** 2 < rnd()) continue;
    if (rnd() < 0.2) th += Math.PI;
    const m = Math.round(kmag * Math.cos(th)), n = Math.round(kmag * Math.sin(th));
    if (!m && !n) continue;
    const key = m * 1000 + n;
    if (seen.has(key)) continue;
    seen.add(key);
    // Phillips: height amplitude goes as k^-2, so slope (k times that) goes as k^-1.
    const k = Math.hypot(m, n);
    const a = 1 / k;
    const ph = Math.floor(rnd() * N);
    const mm = ((m % N) + N) % N, nn = ((n % N) + N) % N;
    // d/dx of a*sin(2pi(mx+ny)/N + ph) is a*(2pi m/N)*cos(...); the 2pi/N is a constant the
    // normalisation below removes, so only a*m and a*n are kept.
    const am = a * m, an = a * n;
    for (let y = 0; y < N; y++) {
      const row = y * N, base = (nn * y + ph) % N;
      for (let x = 0; x < N; x++) {
        const c = cosT[(mm * x + base) % N];
        su[row + x] += am * c; sv[row + x] += an * c;
      }
    }
    placed++;
  }
  // Scale so 3 standard deviations fill the byte; the rare peak past that clips.
  let ss = 0;
  for (let i = 0; i < N * N; i++) ss += su[i] * su[i] + sv[i] * sv[i];
  const sd = Math.sqrt(ss / (2 * N * N)) || 1;
  const out = new Uint8Array(N * N * 2);
  const enc = (s) => Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * s / (3 * sd))));
  for (let i = 0; i < N * N; i++) { out[i * 2] = enc(su[i]); out[i * 2 + 1] = enc(sv[i]); }
  return out;
}

const cache = new WeakMap();
export function seaDetailTexture(gl) {
  let t = cache.get(gl);
  if (t) return t;
  t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + SEA_DETAIL_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, N, N, 0, gl.RG, gl.UNSIGNED_BYTE, bakeSeaDetail());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.activeTexture(gl.TEXTURE0);
  cache.set(gl, t);
  return t;
}

// Bind every frame: a uniform keeps its unit, but another pass may have rebound the unit.
export function bindSeaDetail(gl, locTex, locAmt, amt) {
  gl.activeTexture(gl.TEXTURE0 + SEA_DETAIL_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, seaDetailTexture(gl));
  gl.uniform1i(locTex, SEA_DETAIL_UNIT);
  gl.uniform1f(locAmt, amt);
  gl.activeTexture(gl.TEXTURE0);
}

// The slope it adds, in the sea's own frame (sample with the same p seaSlope gets, before
// seaUnframe). Layer A repeats every 3.2 tiles and drifts downwind; layer B repeats every 1.9 tiles
// on a heading turned 37 degrees and runs faster, as shorter waves would if they were longer. The
// rotation is undone on B's slope (grad_p = R^T grad_q), or its streaks light the wrong way.
// 'amt' is in tiles of chop amplitude, so a calm, which shrinks uSeaAmp, calms this too.
export const SEA_DETAIL_GLSL = `
uniform sampler2D uSeaDetail;
uniform float uSeaDetailAmt;
vec2 seaDetail(vec2 p, float t, float amp) {
  if (uSeaDetailAmt <= 0.0) return vec2(0.0);
  vec2 a = texture(uSeaDetail, p * 0.31 + vec2(t * 0.018, t * 0.004)).rg * 2.0 - 1.0;
  vec2 q = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 0.53 + vec2(t * 0.031, -t * 0.009);
  vec2 b = texture(uSeaDetail, q).rg * 2.0 - 1.0;
  b = vec2(0.8 * b.x + 0.6 * b.y, -0.6 * b.x + 0.8 * b.y);
  return (a * 0.31 + b * 0.53 * 0.7) * amp * uSeaDetailAmt;
}
`;

// How strong the fine surface is against the chop; 0 turns it off and gives the old sea back.
// At 20 its slope is about the chop's own: weaker (12) left the lattice showing in the Modelshop sea shot.
export const SEA_DETAIL_AMT = 20;
