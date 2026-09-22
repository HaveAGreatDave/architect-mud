// THE CITY, IN THE GLASS.
//
// The environment a reflective surface hands back has been TWO FLAT COLOURS since the material pass
// shipped — `uEnvUp` for the sky and `uEnvDn` for the ground, mixed off the reflected ray's
// elevation. That is enough to make a tower reflect the weather, and it is why a glazed building
// here has never reflected the CITY. Every reference photograph of a curtain wall is mostly other
// buildings: the skyline across the middle of it, the street below that, sky only at the top.
//
// ⚠ AND NEITHER OBVIOUS MECHANISM WORKS, WHICH IS WHY THIS ONE IS WORTH THE FILE.
//
//   · A PLANAR MIRROR — what the puddles use — works for water because there is ONE plane. Vertical
//     glass is a different plane per wall, so it is one extra render of the world per building.
//   · SCREEN-SPACE REFLECTION fails exactly where it is needed. For a wall facing you the reflected
//     ray points back over your shoulder, so what a tower reflects is BEHIND THE CAMERA and not in
//     the depth buffer at all. The reference board proves it: that tower is reflecting the street
//     the photographer is standing in.
//
// What is left is an environment PROBE, and this is the cheapest honest one: for each bearing
// around the camera, how high the city stands and what colour it is. One texel per bearing, sampled
// by the reflected ray's azimuth, compared against the ray's own slope. Above the skyline you get
// the sky; below it you get the mass that is actually there, in the direction it is actually in.
//
// ⚠ IT IS A TEXTURE AND NOT A UNIFORM ARRAY, AND THAT IS A BUDGET RATHER THAN A STYLE. The fragment
// shader already wants `3·MAX_LIGHTS + 1 + 2·MAX_MATERIALS + 6` vectors against a WebGL2 floor-spec
// guarantee of 224, and context.js's own note reserves the remaining headroom for raising
// MAX_LIGHTS (48 wants 199, 56 wants 223). A 64-bin strip as vec4s is 64 vectors and would take
// that decision away from whoever wants more lights. 64 texels is 256 bytes.
//
// ⚠ AND IT IS REBUILT EVERY FRAME RATHER THAN WITH THE MASS BUFFER. The bearing to a building
// changes as the camera moves WITHIN a tile, and the mass buffer only rebuilds when the window
// recentres — so keyed to the buffer the reflection would snap a tile at a time. It is a loop over
// the ~30-70 cells in the window; the mass buffer's own rebuild is the expensive one and this is
// not it.

export const SKY_BINS = 64;

// How far a reflected building is dimmed from its own palette. What a mirror hands back is the
// city under the same sky you are under, not a lit render of it — and the mass is mostly in its own
// shadow from any given bearing. Scaled by the flag on top of this.
export const SKY_DIM = 0.62;

// ⚠ A TILE HAS AN ANGULAR WIDTH AND A FAR ONE DOES NOT COVER A WHOLE BIN. A building two tiles away
// spans about 28° and one thirty tiles away spans under 2°, so writing each into a single bin makes
// the near one a spike and the far one the same spike — the skyline comes out as a comb. Each cell
// is spread across every bin its own half-width covers.
const TAU = Math.PI * 2;

// The strip packs a slope into 8 bits, and a slope is unbounded — a building directly overhead is
// infinite. `s / (1 + |s|)` is the standard bounded map and it keeps its resolution where the
// skyline actually lives: ±1 (45°) lands at ±0.5, and everything steeper crowds the ends, which is
// exactly the part of the sky nothing is reflecting toward anyway.
export const packSlope = (s) => 0.5 + 0.5 * (s / (1 + Math.abs(s)));
export const unpackSlope = (a) => { const t = (a - 0.5) * 2; return t / Math.max(1e-3, 1 - Math.abs(t)); };

// Build the strip. `cells` is the world pass's own list — each entry carries where the tile stands
// (`gx`,`gy`) and its face list, which the mesh memo has already given an average colour and a top.
// `eye` is the camera in the SAME frame as those offsets (see the ⚠ on `eye` in world.js: the
// shifted camera, not the plain one, or every bearing in the city is out by the window offset).
//
// ⚠ IT RETURNS THE SLOPE OF THE TOP, NOT THE HEIGHT. A reflected ray has a slope and no distance,
// so the comparison the shader makes is angular — and a near low shed can stand higher in the
// reflection than a far tower, which is the whole reason this cannot be a heightmap.
// ⚠ THE FACE LIST COMES THROUGH `facesOf`, BECAUSE A CELL DOES NOT CARRY ONE. In world.js the mesh
// is a LOCAL inside the group-build loop, assigned into `groups` and never onto the cell — and that
// loop only runs when the vertex buffer REBUILDS, while this runs every frame. Reading `it.faces`
// therefore finds undefined on every cell, every frame, and the strip comes back all-sky: the
// feature measures 0.00% of the frame with every other part of it correctly wired.
export function buildSkyline(cells, eye, out, facesOf) {
  const slope = out && out.slope && out.slope.length === SKY_BINS ? out.slope : new Float32Array(SKY_BINS);
  const rgb = out && out.rgb && out.rgb.length === SKY_BINS * 3 ? out.rgb : new Float32Array(SKY_BINS * 3);
  slope.fill(-1e3); rgb.fill(0);
  const ex = eye[0], ey = eye[1], ez = eye[2];
  for (const it of cells) {
    const f = facesOf ? facesOf(it) : it.faces;
    if (!f || f.topZ == null || !f.avgRgb) continue;
    const dx = it.gx - ex, dy = it.gy - ey;
    const d = Math.hypot(dx, dy);
    // ⚠ A CELL YOU ARE STANDING IN IS SKIPPED, not clamped. Its bearing is meaningless and its
    // slope is enormous, so one tile would otherwise paint half the strip with the building the
    // camera is inside — which is the one building a reflection can never contain.
    if (!(d > 0.75)) continue;
    const s = (f.topZ - ez) / d;
    if (s < -0.9) continue;                       // below the ground horizon: `uEnvDn` already has it
    const bearing = Math.atan2(dy, dx);
    const half = Math.atan2(0.62, d);             // a tile is ~1.24 across the diagonal
    const b0 = Math.floor(((bearing - half) / TAU + 1) * SKY_BINS);
    const b1 = Math.ceil(((bearing + half) / TAU + 1) * SKY_BINS);
    for (let b = b0; b <= b1; b++) {
      const i = ((b % SKY_BINS) + SKY_BINS) % SKY_BINS;
      if (s > slope[i]) {
        slope[i] = s;
        rgb[i * 3] = f.avgRgb[0]; rgb[i * 3 + 1] = f.avgRgb[1]; rgb[i * 3 + 2] = f.avgRgb[2];
      }
    }
  }
  // An empty bearing is sky all the way down to the ground horizon, which is slope 0 — never the
  // sentinel, or the shader decodes a nonsense angle and paints the city into clear air.
  for (let i = 0; i < SKY_BINS; i++) if (slope[i] < -999) slope[i] = -1;
  return { slope, rgb };
}

// The same thing as the bytes the shader samples.
export function packSkyline(strip, buf) {
  const b = buf && buf.length === SKY_BINS * 4 ? buf : new Uint8Array(SKY_BINS * 4);
  for (let i = 0; i < SKY_BINS; i++) {
    b[i * 4] = Math.max(0, Math.min(255, strip.rgb[i * 3] | 0));
    b[i * 4 + 1] = Math.max(0, Math.min(255, strip.rgb[i * 3 + 1] | 0));
    b[i * 4 + 2] = Math.max(0, Math.min(255, strip.rgb[i * 3 + 2] | 0));
    b[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(packSlope(strip.slope[i]) * 255)));
  }
  return b;
}

export function createSkylineStrip(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // ⚠ LINEAR ACROSS THE BEARING AND WRAPPED, because the strip is a CIRCLE. Clamped, the bin at
  // due-west blends into the bin at due-east-minus-one and there is a seam in the reflection at one
  // fixed compass bearing, which reads as a crack in the glass that does not move when you do.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SKY_BINS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(SKY_BINS * 4));
  let strip = null, bytes = null;
  return {
    tex,
    update(cells, eye, facesOf) {
      strip = buildSkyline(cells, eye, strip, facesOf);
      bytes = packSkyline(strip, bytes);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SKY_BINS, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    },
    dispose() { try { gl.deleteTexture(tex); } catch { /* the context may already be gone */ } },
  };
}
