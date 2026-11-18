// THE WEATHER'S SHADOW ON THE CITY (RENDER_TUNE.glCloudShadow).
// The cloud volume (gl/cloudvol.js) bakes a top-down map of how much of the sun gets through the
// deck, marched along the sun from the cloud base with the same density() the clouds are drawn
// with, so a shadow is the shape of the cloud overhead, not of its weather cell. This file is the
// read: the walls (context.js) and the road (ground.js) project a point up the sun to the cloud
// base and look the map up there.
// ⚠ ONE FRAME LATE, AND KEPT IN WORLD TILES. The deck is collected after the world pass, so the
// map the world reads was baked last frame. Its centre is stored in absolute world tiles and turned
// into this frame's window tiles (minus `wc`, the window centre) at the read, so moving between
// frames doesn't slide the shadows.
// ⚠ NOT THE OVERCAST. The bake leaves the stratus sheet out: an overcast day's dim sun is already
// `sunFx.cloud` in windshield.js, and counting it here as well made a grey day black.
// ⚠ THE HOST DECLARES THE UNIFORMS, as propshadow.js's do (glsl-smoke reads each file alone):
//   uniform sampler2D uCloudMap; uniform vec4 uCloudBox; uniform vec2 uCloudSlope;
//   uniform float uCloudBase; uniform float uCloudOn; uniform float uShaftOn;
//
// ── SUN SHAFTS (RENDER_TUNE.glSunShafts) ──────────────────────────────────────────────────────
// The haze in front of a surface is sunlight the air scatters toward you, and air standing in a
// cloud's shadow has less to scatter. airShadow() walks the view ray through the air under the deck
// and says how much of it is shaded, and the host darkens its fog colour by that: beams where the
// air is lit, darker lanes where it isn't. It darkens, never adds, because the fog colour already
// IS the lit air. Strongest looking toward the sun, where the forward scattering is.

// How old a baked map may be before it's ignored: the volume stops when it hands the sky to the
// cards, and a map left from then would hang a shadow over the city that no cloud is casting.
export const CLOUD_SHADOW_STALE_MS = 500;

export const CLOUD_SHADOW_GLSL = `
// How much of the sun the deck stops at a point, 0 to 1, before any strength.
float cloudShadowRaw(vec3 wp) {
  // Up the sun to the cloud base, then into the map. Faded over the map's outer eighth, so the
  // shadowed country ends in a blur rather than a line.
  vec2 q = wp.xy + uCloudSlope * (uCloudBase - wp.z);
  vec2 uv = (q - uCloudBox.xy) * uCloudBox.zw;
  float e = clamp(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * 8.0, 0.0, 1.0);
  return textureLod(uCloudMap, clamp(uv, 0.0, 1.0), 0.0).r * e;
}
float cloudShadow(vec3 wp) {
  float k = cloudShadowRaw(wp) * uCloudOn;
  // Sanitised with a comparison, as sunShadow in context.js is: a NaN here is a black city.
  return k > 0.0 ? min(k, 1.0) : 0.0;
}
// How much darker the haze between 'eye' and 'P' is for the cloud shadow in it, 0 to uShaftOn.
// Eight samples on the part of the ray under the cloud base; the mean is what's shaded.
float airShadow(vec3 eye, vec3 P) {
  vec3 d = P - eye;
  float L = length(d);
  if (L < 1e-3) return 0.0;
  vec3 V = d / L;
  float s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 p = eye + d * ((float(i) + 0.5) / 8.0);
    if (p.z < uCloudBase) { s += cloudShadowRaw(p); n += 1.0; }
  }
  if (n < 0.5) return 0.0;
  float mu = dot(V, normalize(vec3(uCloudSlope, 1.0)));
  float k = (s / n) * mix(0.35, 1.0, smoothstep(0.2, 1.0, mu)) * uShaftOn;
  return k > 0.0 ? min(k, 0.8) : 0.0;
}
`;
export const CLOUD_SHADOW_UNIFORMS = ['uCloudMap', 'uCloudBox', 'uCloudSlope', 'uCloudBase', 'uCloudOn', 'uShaftOn'];

// What a host gets, or null (off, night, no map, or a stale one). `frame` is the volume's
// shadowFrame(); `wc` the window centre in world tiles; `str` RENDER_TUNE.glCloudShadow; `sun` the
// frame's sun (its alpha, 0.4 at most, is as dark as a building's hull gets on the road); `shafts`
// RENDER_TUNE.glSunShafts. Either knob alone is enough to want the map.
export function cloudShadowFor(frame, wc, str, sun, now, shafts = 0) {
  if (!(str > 0 || shafts > 0) || !frame || !frame.tex || !sun || !(sun.alpha > 0)) return null;
  if (now != null && frame.at != null && Math.abs(now - frame.at) > CLOUD_SHADOW_STALE_MS) return null;
  const wx = (wc && wc.x) || 0, wy = (wc && wc.y) || 0, s = 1 / (2 * frame.half);
  const dusk = Math.min(1, sun.alpha / 0.4);
  return {
    tex: frame.tex,
    box: [frame.cx - frame.half - wx, frame.cy - frame.half - wy, s, s],
    slope: frame.slope, base: frame.base,
    // A wall takes it as the sun's own shadow does (it joins shK); the road as a hull's darkness.
    wall: Math.min(1, str || 0) * dusk,
    ground: Math.min(1, str || 0) * Math.min(0.4, sun.alpha),
    // How dark the most shaded haze gets, toward the sun. 0.6 of the fog colour at full: past that a
    // lane of shaded mist reads as smoke.
    shaft: Math.min(1, shafts || 0) * 0.6 * dusk,
  };
}

// Writes the read's uniforms. `which` picks the strength ('wall' or 'ground'). Null is the exact off
// switch, and the sampler is bound either way, to the map or to nothing.
export function bindCloudShadow(gl, loc, unit, C, which) {
  gl.uniform1f(loc.uCloudOn, C ? C[which] : 0);
  gl.uniform1f(loc.uShaftOn, C ? C.shaft : 0);
  if (C) {
    gl.uniform4f(loc.uCloudBox, C.box[0], C.box[1], C.box[2], C.box[3]);
    gl.uniform2f(loc.uCloudSlope, C.slope[0], C.slope[1]);
    gl.uniform1f(loc.uCloudBase, C.base);
  }
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, C ? C.tex : null);
  gl.uniform1i(loc.uCloudMap, unit);
  gl.activeTexture(gl.TEXTURE0);
}
