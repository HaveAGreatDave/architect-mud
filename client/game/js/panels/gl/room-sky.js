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
// a sheet of flame. 'uv' is 0..1 across and up, plus 2 on the nearer sheet. Noise rising through the sheet
// is cut by a height that falls as it climbs and sways along the fire, so tongues lick up and break off
vec4 fireAt(vec2 uv) {
  float sheet = floor(uv.x * 0.5), x = fract(uv.x), y = uv.y, t = uT * (1.0 + 0.18 * sheet), s = sheet * 7.3;
  vec2 p = vec2(x * 7.0 + s, y * 2.1 - t * 1.5);
  float n = fbm(p + vec2(0.55 * fbm(p * 1.6 + vec2(s, t * 0.5)) - 0.27, 0.0));
  float tongues = 0.62 + 0.38 * sin(x * 13.0 + s + sin(t * 1.3 + x * 5.0) * 1.4) * sin(x * 5.0 - t * 0.7 + s);
  float heat = (1.0 - y / max(tongues, 0.2)) * 0.9 + (n - 0.42) * 1.5;
  heat *= smoothstep(0.0, 0.07, x) * smoothstep(1.0, 0.93, x);
  float a = smoothstep(0.1, 0.3, heat);
  vec3 c = mix(vec3(0.85, 0.13, 0.02), vec3(1.0, 0.46, 0.05), smoothstep(0.2, 0.55, heat));
  c = mix(c, vec3(1.0, 0.86, 0.46), smoothstep(0.55, 0.95, heat));
  return vec4(c, a * (0.72 + 0.28 * sheet));
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
