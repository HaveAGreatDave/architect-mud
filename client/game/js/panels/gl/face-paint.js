// GLASS 2 · A MAN'S FACE, PAINTED. The sculpted figure's face (gl/figure-hd.js, docs/proposals/sculpted-figure.md)
// for renderers that draw people at a distance, on the broadcast: the same proportions, planes, brows and mouth in
// one function, with no atlas, real eyes or speech. Needs vn3 in the shader it's pasted into. `r` is the point on
// the head in metres (bind space). `facial` is FACIAL_CODE. All the numbers here are the sculpted head's, and
// EYE.man in actor-head.js has to agree with them.

// Which painted facial hair a person has, as a float the shader can take.
export const FACIAL_CODE = { clean: 0, stubble: 1, shadow: 2, moustache: 3, goatee: 4, trimmed: 5 };

export const FACE_PAINT_GLSL = `
float fpSeg(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0)); }
float fpLine(float d, float w) { float aa = max(fwidth(d), 1e-5); return 1.0 - smoothstep(w, w + aa * 1.3, abs(d)); }
float fpTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0), q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0), q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float sg = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), sg * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), sg * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), sg * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void fpShape(float d, float k, inout vec3 c) { float aa = max(fwidth(d), 1e-4); c *= mix(vec3(1.0), vec3(0.74, 0.6, 0.58), k * (1.0 - smoothstep(-aa, aa, d))); }
void fpDeep(float d, float k, inout vec3 c) { float aa = max(fwidth(d), 1e-4); c *= mix(vec3(1.0), vec3(0.6, 0.53, 0.55), k * (1.0 - smoothstep(-aa, aa, d))); }
vec3 paintManFace(vec3 r, vec3 skin, vec3 hair, vec3 iris, float facial, float blink) {
  vec3 c = skin, ink = skin * vec3(0.15, 0.1, 0.1);
  float ax = abs(r.x), front = smoothstep(0.0, 0.04, r.z);
  vec2 q = vec2(ax, r.y);
  // skin as paint: brushwork, then grit that gives out with distance
  c *= 1.0 + 0.2 * (vn3(r * vec3(36.0, 64.0, 36.0)) * 0.6 + vn3(r * 110.0) * 0.4 - 0.5);
  float fade = 1.0 - smoothstep(0.3, 0.7, fwidth(r.x * 1150.0) + fwidth(r.y * 1150.0));
  c *= 1.0 - 0.13 * smoothstep(0.62, 0.7, vn3(r * 1150.0)) * fade;
  // the eye's opening: narrow and level
  float eX = 0.0292, eW = 0.0158, eT = 0.0051, eB = 0.0034, ex = ax - eX, eyeK = max(0.0, 1.0 - pow(ex / eW, 2.0)), eyeT = 1.6398 + 0.02 * ex;
  float top = eyeT + mix(eT, -eB, blink) * eyeK, inEye = (1.0 - smoothstep(-0.0002, 0.0002, max(r.y - top, eyeT - eB * eyeK - r.y))) * step(abs(ex), eW);
  // the socket in depths, the wedge under the cheekbone, the temple
  float sock = 1.0 - inEye;
  fpDeep(length((q - vec2(eX + 0.0033, 1.6478)) / vec2(0.0242, 0.0085)) - 1.0, sock * 0.5, c);
  fpDeep(length((q - vec2(eX + 0.0056, 1.651)) / vec2(0.0225, 0.0036)) - 1.0, sock * 0.45, c);
  fpDeep(fpTri(q, vec2(eX - 0.0205, 1.6515), vec2(eX - 0.0065, 1.651), vec2(eX - 0.0165, 1.6368)) - 0.0012, sock * 0.45, c);
  fpShape(fpTri(q, vec2(0.1, 1.615), vec2(0.047, 1.593), vec2(0.082, 1.54)) - 0.0035, 0.75 * front, c);
  fpShape(fpTri(q, vec2(0.078, 1.69), vec2(0.066, 1.655), vec2(0.078, 1.63)), 0.5, c);
  // warmth over the nose and cheeks
  c *= mix(vec3(1.0), vec3(1.05, 0.93, 0.87), 0.8 * exp(-pow(ax / 0.022, 2.0) - pow((r.y - 1.602) / 0.02, 2.0)) + 0.55 * exp(-pow((ax - 0.05) / 0.02, 2.0) - pow((r.y - 1.602) / 0.02, 2.0)));
  // the nose: its sides, the sliver under it, the nostrils, the tip's light
  fpShape(ax - 0.0026 - 0.0115 * pow(smoothstep(1.648, 1.598, r.y), 1.6), 0.5 * step(1.592, r.y) * step(r.y, 1.648), c);
  fpShape(length((q - vec2(0.0, 1.5855)) / vec2(0.0135, 0.0026)) - 1.0, 0.9, c);
  c = mix(c, skin * 0.3, 1.0 - smoothstep(-0.15, 0.15, length((q - vec2(0.0078, 1.5866)) / vec2(0.0034, 0.0012)) - 1.0));
  c *= 1.0 + 0.14 * (1.0 - smoothstep(0.9, 1.0, length(vec2(r.x / 0.0062, (r.y - 1.6005) / 0.0058))));
  // stubble: a flat tone with a broken edge, and short strokes along it
  vec3 beardC = min(hair, vec3(0.09));
  float bAmt = facial < 0.5 ? 0.0 : facial < 1.5 ? 0.8 : facial < 2.5 ? 1.3 : 0.25;
  float edge = 1.586 + 0.004 * (vn3(r * 260.0) - 0.5) - 0.022 * smoothstep(0.035, 0.068, ax) - 0.03 * smoothstep(0.03, -0.03, r.z);
  float clearM = 1.0 - smoothstep(0.75, 1.1, length(vec2(r.x / 0.03, (r.y - 1.565) / 0.0125)));
  c = mix(c, mix(skin * vec3(0.72, 0.66, 0.66), beardC, 0.3), 0.55 * smoothstep(edge, edge - 0.008, r.y) * (1.0 - clearM) * min(1.0, bAmt * 1.4));
  // the mouth: thin and firm. A line that dips at the middle and thins to nothing at the corners, lips hardly a
  // colour, and the crescent of shadow under the lower lip that does most of the shaping
  float W = 0.0228, t2 = min(1.0, pow(ax / W, 2.0)), kk = 1.0 - t2, inW = step(ax, W), aL = max(fwidth(r.y), 1e-4);
  float yu = 1.5652 - 0.0014 * t2 + 0.00085 * exp(-pow((ax - 0.0105) / 0.0075, 2.0)) - 0.0005 * exp(-pow(ax / 0.0042, 2.0)) + 0.0004 * t2 * sign(r.x);
  float lipT = yu + 0.0033 * pow(kk, 0.7) - 0.0012 * exp(-pow(ax / 0.0042, 2.0)) + 0.0006 * exp(-pow((ax - 0.0075) / 0.005, 2.0)), lipB = yu - 0.0047 * pow(kk, 0.6);
  c = mix(c, skin * vec3(0.6, 0.44, 0.42), inW * smoothstep(lipT + aL, lipT - aL, r.y) * step(yu, r.y));
  c = mix(c, skin * vec3(0.94, 0.78, 0.74), inW * smoothstep(lipB - aL, lipB + aL, r.y) * step(r.y, yu));
  { float cw = W * 0.78, ck = max(0.0, 1.0 - pow(ax / cw, 2.0)); fpDeep(max(r.y - lipB - 0.0002, lipB - 0.0048 * ck - r.y), 0.8 * step(ax, cw), c); }
  c = mix(c, ink, 0.95 * fpLine(r.y - yu, 0.00078 * (1.0 - t2 * t2) + 0.00005) * inW);
  // solid facial hair over all that, clear of the lips
  float dB = 1.0;
  if (facial > 2.5) { float yT = 1.5838 - 14.0 * ax * ax - 0.0022 * exp(-pow(ax / 0.0022, 2.0)), yB = 1.5716 - 12.0 * ax * ax; dB = max(max(yB - r.y, r.y - yT), ax - 0.0318); }
  if (facial > 3.5) { dB = min(dB, (length((q - vec2(0.0, 1.5395)) / vec2(0.0245, 0.0125)) - 1.0) * 0.0125); dB = min(dB, fpSeg(q, vec2(0.0295, 1.5625), vec2(0.0225, 1.541)) - 0.0032); }
  if (facial > 4.5) { float clr = (length(vec2(ax / (W + 0.0045), (r.y - yu) / 0.0105)) - 1.0) * 0.01; dB = min(dB, max(max(r.y - 1.5685 - 0.95 * max(0.0, ax - 0.033), -clr), 0.004 + 0.55 * (1.6 - r.y) - r.z)); }
  float streak = vn3(vec3(r.x * 1100.0, r.y * 260.0, r.z * 1100.0)), lips = inW * step(lipB, r.y) * step(r.y, lipT), aB = max(fwidth(dB), 1e-4);
  fpShape(dB - 0.0014, 0.6 * (1.0 - lips), c);
  c = mix(c, hair * mix(0.8, 1.5, streak), (1.0 - lips) * (1.0 - smoothstep(-aB, aB, dB + 0.0014 * (vn3(r * 420.0) - 0.5) + 0.0011 * (streak - 0.5))));
  // the eye: greyed whites under the lid's shadow, a flat iris
  if (inEye > 0.002) {
    vec2 ec = vec2(sign(r.x) * eX, 1.6398);
    float d = distance(r.xy, ec), aa = max(fwidth(d), 0.0002), R = 0.0066;
    vec3 e = vec3(0.86, 0.82, 0.76) * mix(1.0, 0.62, smoothstep(1.6372, 1.6442, r.y));
    e = mix(e, iris * mix(1.25, 0.72, smoothstep(0.3, 1.0, d / R)), 1.0 - smoothstep(R - aa, R + aa, d));
    e = mix(e, vec3(0.012), 1.0 - smoothstep(0.0029 - aa, 0.0029 + aa, d));
    e = mix(e, vec3(0.85), 1.0 - smoothstep(0.001 - aa, 0.001 + aa, distance(r.xy, ec + vec2(-0.0021, 0.0023))));
    c = mix(c, e, inEye);
  }
  // the heavy lid over it, and the brow right on the eye, low at the nose and angled in
  float lid = top, lw = mix(0.0023, 0.0009, smoothstep(0.0, 0.0152, abs(ex + 0.002))) * smoothstep(0.0, 0.3, eyeK);
  fpDeep(max(r.y - (lid + 0.0034 * eyeK + 0.0006), lid - r.y), 0.45 * step(abs(ex), eW), c);
  c = mix(c, ink, fpLine(r.y - lid + lw * 0.7, lw) * step(abs(ex), eW - 0.0002));
  float bd = min(fpSeg(q, vec2(0.0108, 1.6508), vec2(0.0395, 1.6588)), fpSeg(q, vec2(0.0395, 1.6588), vec2(0.0572, 1.6532)));
  float bw = mix(0.0044, 0.0014, smoothstep(0.012, 0.064, ax)), browS = vn3(vec3(r.x * 240.0, r.y * 1500.0, 3.0)), ab = max(fwidth(bd), 1e-4);
  c = mix(c, hair * mix(0.55, 1.15, browS), 1.0 - smoothstep(bw, bw + ab, bd + 0.0014 * (browS - 0.5)));
  return c;
}`;
