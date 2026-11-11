// GLASS 2 · THE WEATHER ON A ROOM'S GLASS. The view out of a flat is GLASS itself, live, under the room's canvas
// (panels/room-outlook.js), and it draws its own sea, sky, traffic and rain. What's left here belongs to the
// room: the drops running down the panes, and what's falling past the painted street on a phone, which has
// no live view.

// Needs 'compass' declared first (gl/room.js).
export const ROOM_SKY_GLSL = `
uniform float uT;           // seconds, kept small enough for a float
uniform vec4 uFall;         // rain 0..1, snow 0..1, wet glass 0..1, wind 0..1
uniform vec2 uWindV;        // the way the wind is going: east, north
uniform vec3 uTint;         // the colour of what's falling
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
// A gas fire, drawn the way a comic draws one. 'uv' is 0..1 across and up plus 2 per sheet: sheets 0, 1
// and 5 to 8 are flame, 2 the glow on the liner behind, 3 the glass front, 4 the bed of coals under the
// logs, 9 the face of the fire's dial. uFlame is the dial: 0 is the pilot alone, 1 full.
// A flame is flat colours inside one black line, blue at the burner, and it moves twelve drawings a
// second. Its tongues are ridges of noise stretched tall and warped as they climb, so they come to
// points and lick sideways. Six sheets at different depths,
// each its own seed and height, and sparks drift up through two of them.
uniform float uFlame;
// the dial's face: a gunmetal bezel, a ring of 24 segments lit up to the setting, and a knurled knob
// whose lit pointer turns through 270 degrees with it
vec4 dialFace(vec2 uv, float f) {
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p), aa = fwidth(r) + 1e-4;
  if (r > 1.0 + aa) return vec4(0.0);
  float ang = atan(p.x, p.y), sweep = (ang + 2.35619) / 4.71239;
  vec3 c = vec3(0.03, 0.035, 0.04);
  // the bezel, lit from above, and its inked rim
  c = mix(c, vec3(0.16, 0.17, 0.19) + 0.08 * p.y + 0.02 * sin(ang * 30.0), smoothstep(0.9 - aa, 0.9 + aa, r));
  c = mix(c, vec3(0.02), smoothstep(0.96 - aa, 0.96 + aa, r));
  // the segments
  float ring = smoothstep(0.68 - aa, 0.68 + aa, r) * (1.0 - smoothstep(0.86 - aa, 0.86 + aa, r));
  float seg = fract(sweep * 24.0), gap = step(0.14, seg) * step(seg, 0.86) * step(0.0, sweep) * step(sweep, 1.0);
  float on = step(sweep, f) * step(0.015, f);
  vec3 hot = mix(vec3(0.1, 0.35, 1.0), vec3(0.6, 0.95, 1.0), sweep) * (1.3 + 0.25 * sin(uT * 6.0 - sweep * 12.0) * f);
  vec3 segc = mix(vec3(0.07, 0.08, 0.1), hot, on);
  if (f < 0.015 && sweep < 1.0 / 24.0) segc = vec3(0.35, 0.6, 1.0) * (1.1 + 0.3 * sin(uT * 5.0));
  c = mix(c, segc, ring * gap);
  // a faint glow in the gaps under the lit arc
  c += hot * 0.12 * ring * (1.0 - gap) * on;
  // the knob: knurled round its edge, the knurling turning with it, a dished top
  float pa = -2.35619 + 4.71239 * f;
  float kn = 1.0 - smoothstep(0.6 - aa, 0.6 + aa, r);
  float knurl = step(0.5, fract((ang - pa) * 40.0 / 6.28318)) * smoothstep(0.5 - aa, 0.5 + aa, r);
  vec3 kc = vec3(0.1, 0.105, 0.115) + 0.07 * p.y - 0.05 * knurl;
  kc = mix(kc, vec3(0.05, 0.052, 0.058) - 0.03 * p.y + 0.015 * sin(p.x * 80.0 + p.y * 7.0), 1.0 - smoothstep(0.46 - aa, 0.46 + aa, r));
  c = mix(c, kc, kn);
  c = mix(c, vec3(0.01), smoothstep(0.035, 0.0, abs(r - 0.6)) * 0.8);
  // the pointer, lit, with a glow round it
  vec2 dir = vec2(sin(pa), cos(pa));
  float along = dot(p, dir), across = abs(dot(p, vec2(dir.y, -dir.x)));
  float line = step(0.12, along) * step(along, 0.54) * (1.0 - smoothstep(0.035 - aa, 0.035 + aa, across));
  vec3 lc = mix(vec3(0.15, 0.45, 1.0), vec3(0.65, 0.95, 1.0), f);
  c = mix(c, lc * 1.5, line);
  c += lc * 0.35 * exp(-across * 22.0) * step(0.08, along) * step(along, 0.6) * kn;
  // a bead in the middle
  c = mix(c, lc * (1.2 + 0.2 * sin(uT * 4.0)), 1.0 - smoothstep(0.07 - aa, 0.07 + aa, r));
  return vec4(c, 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r));
}
float ridge(vec2 p) { return 1.0 - abs(2.0 * vnoise(p) - 1.0); }
// one sheet of flame; k picks its seed and height
vec4 flameAt(float x, float y, float k, float f, float t) {
  float s = k * 7.31 + 1.7, hk = h21(vec2(k, 3.1));
  float height = mix(0.25, 0.95, f) * mix(0.75, 1.0, hk) * (k > 4.5 ? 0.6 : 1.0);
  float yy = y / height;
  // warped as it climbs: more sway the higher it gets
  vec2 w = vec2(fbm(vec2(x * 3.0 + s, y * 1.5 - t * 1.6)), fbm(vec2(x * 3.0 - s, y * 1.5 - t * 1.3 + 4.0))) - 0.5;
  float xs = x + w.x * 0.12 * yy + 0.03 * yy * sin(t * 2.1 + s);
  // tongues: one to a cell along the burner, each its own height and lean, narrowing to a point as it
  // climbs, and swaying more the higher it gets. A tongue is a teardrop, so the edge is a lick, not a lump
  float cells = 6.0 + 1.5 * mod(k, 3.0), cx = xs * cells, acc = 0.0;
  for (int j = -2; j <= 2; j++) {
    float ci = floor(cx) + float(j), r1 = h21(vec2(ci, s)), r2 = h21(vec2(ci + 7.0, s)), r3 = h21(vec2(ci + 3.0, s + 1.0));
    float life = fract(t * (0.3 + 0.35 * r2) + r1);
    // each its own height, width and point: some blunt and rounded, a few tall and fine
    float th = mix(0.5, 1.1, r1) * (0.75 + 0.25 * sin(life * 6.28318));
    float u = yy / th;
    float bend = sin(t * 2.3 + r1 * 20.0 + yy * 3.0) * 0.22 + sin(t * 4.1 + r2 * 9.0 + yy * 7.0) * 0.08;
    float centre = ci + 0.5 + (r2 - 0.5) * 0.6 + bend * yy * yy;
    float tip = mix(0.3, 0.85, r3 * r3);
    float hw = mix(0.8, 1.3, r2) * pow(max(1.0 - u, 0.0), tip) * (0.75 + 0.25 * smoothstep(0.0, 0.3, u));
    float hh = (1.0 - abs(cx - centre) / max(hw, 1e-3)) * pow(max(1.0 - u, 0.0), 0.3) * 1.3;
    hh = u >= 1.0 ? -2.0 : max(hh, -2.0);
    acc += exp(5.0 * hh);
  }
  // the tongues run into each other where they meet, as flames do
  float heat = log(acc) / 5.0 - 0.08;
  // a body along the burner they all rise out of
  heat = max(heat, (1.0 - yy / 0.32) * 1.1);
  // fine noise only on the edge, stretched tall, rising
  float n = fbm(vec2(xs * 18.0 + s, yy * 3.0 - t * mix(2.0, 3.2, f)) + w * 1.2);
  heat += (n - 0.5) * (0.4 + 0.6 * yy) * smoothstep(-0.3, 0.15, heat);
  heat *= smoothstep(0.0, 0.12, x) * smoothstep(1.0, 0.88, x) * smoothstep(1.0, 0.9, y);
  float px = fwidth(heat) + 0.0005, ink = clamp(px * 2.5, 0.015, 0.1);
  float a = smoothstep(0.1 - px, 0.1 + px, heat);
  vec3 c = vec3(0.78, 0.1, 0.03);
  vec2 dg = fract(mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / 5.0) - 0.5;
  float dots = step(length(dg), 0.4 * smoothstep(0.18, 0.32, heat));
  c = mix(c, vec3(1.0, 0.42, 0.04), max(dots, smoothstep(0.32 - px, 0.32 + px, heat)));
  c = mix(c, vec3(1.0, 0.7, 0.12), smoothstep(0.52 - px, 0.52 + px, heat));
  c = mix(c, vec3(1.0, 0.9, 0.45), smoothstep(0.7 - px, 0.7 + px, heat));
  c = mix(c, vec3(1.0, 0.98, 0.85), smoothstep(0.86 - px, 0.86 + px, heat));
  // shaded like a solid: a smooth ramp from the core out, rounded across the sheet, so the cels read as
  // a body with depth and not a cut-out; the comic bands sit over it at half strength
  float hs = clamp(heat, 0.0, 1.2), bulge = 0.75 + 0.25 * sin(clamp(x, 0.0, 1.0) * 3.14159);
  vec3 soft = mix(vec3(0.7, 0.08, 0.02), vec3(1.0, 0.45, 0.06), smoothstep(0.1, 0.45, hs));
  soft = mix(soft, vec3(1.0, 0.8, 0.3), smoothstep(0.4, 0.75, hs));
  soft = mix(soft, vec3(1.0, 0.97, 0.85), smoothstep(0.7, 1.05, hs));
  c = mix(soft, c, 0.45) * bulge;
  // blue where the gas leaves the burner
  float blue = smoothstep(0.1, 0.0, y) * smoothstep(-0.04, 0.02, y);
  c = mix(c, vec3(0.3, 0.5, 1.0) * 1.3, blue * 0.85);
  c = mix(vec3(0.05, 0.02, 0.02), c, smoothstep(0.1 + ink - px, 0.1 + ink + px, heat));
  c *= 1.15;
  // the deeper sheets are see-through at the edge, so the front ones stand off them
  if (k > 1.5 && k < 4.5) a *= 0.8;
  // sparks drift up through sheets 1 and 3
  if (abs(k - 1.0) < 0.1 || abs(k - 3.0) < 0.1) {
    vec2 g = vec2(x * 12.0, y * 4.0 - t * 1.4), id = floor(g), q = fract(g) - 0.5;
    float rr = h21(id + k * 13.0);
    if (rr < 0.22 * f) {
      q.x += (h21(id + 5.0) - 0.5) * 0.6 + 0.2 * sin(t * 3.0 + rr * 30.0);
      q.y += (h21(id + 8.0) - 0.5) * 0.6;
      float sp = 1.0 - smoothstep(0.03, 0.07, length(q * vec2(1.0, 0.45)));
      sp *= smoothstep(0.3, 0.55, y) * smoothstep(1.0, 0.7, y);
      if (sp > a) return vec4(mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.9, 0.5), rr * 4.0) * 1.5, sp);
    }
  }
  return vec4(c, a);
}
vec4 fireAt(vec2 uv) {
  float sheet = floor(uv.x * 0.5), x = fract(uv.x), y = uv.y, f = clamp(uFlame, 0.0, 1.0);
  float tq = floor(uT * 12.0) / 12.0;
  if (sheet > 8.5) return dialFace(vec2(x, y), f);
  bool flame = sheet < 1.5 || sheet > 4.5;
  if (!flame && sheet > 3.5) {
    // the coals: a bed of blocks, each its own heat, in the fire's flat colours with ink between them
    vec2 g = vec2(x * 16.0, y * 5.0), id = floor(g);
    g.x += (h21(id.yy + 3.0) - 0.5) * 0.8; id = floor(g);
    vec2 q = abs(fract(g) - 0.5);
    float r = h21(id + 9.0), pulse = 0.5 + 0.5 * sin(tq * (1.5 + r * 3.0) + r * 40.0);
    float hot = f * (0.35 + 0.65 * r) * (0.7 + 0.3 * pulse);
    vec3 c = vec3(0.09, 0.06, 0.05);
    c = mix(c, vec3(0.62, 0.1, 0.03), step(0.2, hot));
    c = mix(c, vec3(1.0, 0.45, 0.05), step(0.45, hot));
    c = mix(c, vec3(1.0, 0.8, 0.18), step(0.75, hot));
    return vec4(mix(vec3(0.02), c, step(max(q.x, q.y), 0.4)), 1.0);
  }
  if (!flame && sheet > 2.5) {
    // the glass front: a faint sheen, a diagonal streak, and the fire's light caught in it
    float streak = smoothstep(0.06, 0.0, abs(x - y * 0.35 - 0.55)) * 0.5 + smoothstep(0.03, 0.0, abs(x - y * 0.35 - 0.68)) * 0.3;
    vec3 c = vec3(0.7, 0.75, 0.8) * streak + vec3(1.0, 0.5, 0.2) * f * 0.12 * (1.0 - y);
    return vec4(c, 0.05 + streak * 0.12 + f * 0.04);
  }
  float flick = 0.88 + 0.12 * vnoise(vec2(uT * 3.1, 1.7));
  if (!flame) {
    // the liner lit from in front: warm, brightest low in the middle, breathing with the flame
    float g = f * flick * smoothstep(1.0, 0.05, y) * smoothstep(0.0, 0.35, x) * smoothstep(1.0, 0.65, x);
    g = floor(g * 4.0 + 0.5) / 4.0;
    return vec4(vec3(1.0, 0.42, 0.12) * g * 1.3, g * 0.75);
  }
  float k = sheet < 1.5 ? sheet : sheet - 3.0;
  // the pilot: a small blue bead at the left of the first sheet, always lit
  vec2 pq = (vec2(x, y) - vec2(0.06, 0.035)) * vec2(1.0, 0.45);
  float pilot = (1.0 - smoothstep(0.004, 0.022, length(pq))) * (0.8 + 0.2 * sin(uT * 23.0)) * step(k, 0.5);
  vec4 pc = vec4(vec3(0.35, 0.55, 1.0) * 1.4, pilot * 0.9);
  if (f < 0.015) return pc;
  vec4 fl = flameAt(x, y, k, f, tq * (1.0 + 0.12 * k));
  return fl.a >= pc.a ? fl : pc;
}
// what's falling, in front of everything: in columns round the room, leaning with the wind, three
// sheets at different distances. A column is a place in the world, so the rain doesn't turn with you.
vec3 fallOver(vec3 d, vec3 col) {
  if (uFall.x + uFall.y < 0.004) return col;
  vec2 en = compass(d);
  float az = atan(en.x, en.y), lean = dot(uWindV, vec2(cos(az), -sin(az))) * (0.3 + 1.2 * uFall.w);
  float rain = 0.0, snow = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), s = 26.0 + fi * 34.0;
    if (uFall.x > 0.004) {
      vec2 g = vec2((az + d.y * lean) * s, d.y * s * 0.14 + uT * (2.2 + fi * 0.8));
      vec2 id = floor(g), f = fract(g);
      if (h21(id + fi * 17.0) < uFall.x * 0.85) {
        float x = abs(f.x - 0.5 - (h21(id.yx + 3.0) - 0.5) * 0.7);
        rain += smoothstep(0.0, 0.25, f.y) * smoothstep(1.0, 0.45, f.y) * (1.0 - smoothstep(0.0, 0.05 + 0.03 * fi, x)) * (0.5 - 0.11 * fi);
      }
    }
    if (uFall.y > 0.004) {
      vec2 g = vec2((az + d.y * lean * 0.6) * s * 0.7 + sin(uT * 0.7 + fi * 2.1 + d.y * 9.0) * 0.4, d.y * s * 0.7 + uT * (0.42 + fi * 0.15));
      vec2 id = floor(g), f = fract(g) - 0.5 - (vec2(h21(id), h21(id.yx + 5.0)) - 0.5) * 0.6;
      if (h21(id + fi * 23.0) < uFall.y) snow += (1.0 - smoothstep(0.02, 0.1 + 0.03 * fi, length(f))) * (0.8 - 0.18 * fi);
    }
  }
  vec3 tint = uTint;
  col = mix(col, tint, clamp(rain, 0.0, 1.0) * 0.5);
  return mix(col, tint * 1.25 + 0.1, clamp(snow, 0.0, 1.0) * 0.85);
}

// a drop on the pane at 'uv' (metres on the glass): which way it bends the view, and how much of it
// there is. Runners on a stuttering clock with beads left behind them, and beads that sit.
vec3 runner(vec2 uv, float t, float scale) {
  vec2 aspect = vec2(2.6, 1.0), g = uv * aspect * scale;
  g.y += t * 0.32;
  vec2 id = floor(g), st = fract(g) - 0.5;
  float n = h21(id), tt = t + n * 6.2832;
  if (n > 0.62) return vec3(0.0);
  float x = (n - 0.31) * 0.9, y = -sin(tt + sin(tt + sin(tt) * 0.5)) * 0.42;
  vec2 p = (st - vec2(x, y)) / aspect;
  float drop = 1.0 - smoothstep(0.03, 0.07, length(p));
  vec2 tp = (st - vec2(x, st.y)) / aspect;
  float trail = (1.0 - smoothstep(0.012, 0.03, abs(tp.x))) * smoothstep(y, y + 0.5, st.y) * (1.0 - smoothstep(0.1, 0.5, st.y - y)) * 0.32;
  return vec3(p * 14.0 * drop + tp * 5.0 * trail, max(drop, trail));
}
vec3 beads(vec2 uv, float scale) {
  vec2 g = uv * scale, id = floor(g), f = fract(g) - 0.5 - (vec2(h21(id), h21(id + 7.0)) - 0.5) * 0.7;
  float size = 0.08 + 0.14 * h21(id + 13.0);
  if (h21(id + 3.0) > uFall.z) return vec3(0.0);
  float b = 1.0 - smoothstep(size * 0.6, size, length(f));
  return vec3(f * 5.0 * b, b);
}
vec3 paneDrops(vec2 uv) {
  float t = uT * 0.55;
  vec3 a = runner(uv, t, 2.3), b = runner(uv + 3.7, t * 1.3, 4.1), c = beads(uv, 34.0), e = beads(uv + 1.3, 19.0);
  float on = smoothstep(0.02, 0.2, uFall.x);
  return vec3((a.xy + b.xy) * on + c.xy + e.xy, clamp(max(max(a.z, b.z) * on, max(c.z, e.z)), 0.0, 1.0));
}`;

// The uniforms, from room-window.js's frame (or `null`, for nothing going on outside).
const ZERO4 = [0, 0, 0, 0];
export function setOutsideUniforms(gl, P, o) {
  gl.uniform1f(P.u('uT'), o?.t ?? 0);
  gl.uniform4fv(P.u('uFall'), o?.fall ?? ZERO4);
  gl.uniform2fv(P.u('uWindV'), o?.windV ?? [0, 0]);
  gl.uniform3fv(P.u('uTint'), o?.tint ?? [0.5, 0.5, 0.5]);
}
