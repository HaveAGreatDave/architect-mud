// GLASS 2 · ROOM · SHUTTERS AND BLINDS over a room's glass (plugins/envcontrol `shutters`). Two coverings:
//   · digital shutters: graphite slats come down inside each pane from its head, and once they're down they
//     light up as one display showing a scene, pixelating in from coarse blocks and back out again. Changing from
//     one lit scene to another puts the new one's colours on the glass at once, blurred, and pixelates it in
//     sharp over that as the blur clears. The scene is
//     worked out by direction from the eye as the view out is, so it stands past the glass like a view and holds
//     still as you walk.
//   · Venetian blinds: horizontal slats hung from a rail on ladder tapes, tilted to let in as much light as they are set to. The
//     window shows between them.
// gl/room.js draws both in its glass pass (mode 3). The scenes come from the server as data (a painter and three
// colours, plugins/envcontrol/scenes.js); this file knows the painters and nothing else.
//
// ⚠ ONLY THE ROOM'S OWN PANES. The glass batch carries the rooms next door's glass too, so a pane is covered
// only inside `box`, the room's own ground plus a hand past its walls.
// ⚠ ONE COVERING AT A TIME. Going from one to the other, the first goes away (the display dark and the slats up,
// or the vanes turned edge on and gone) before the second comes.
// ⚠ A PHONE GETS A STILL PICTURE. Its time is pinned (room-stage.js passes `t`), so nothing in a scene moves.

// the painters, in the order the shader numbers them (`uShut.z`); 'blinds' isn't a scene, it's the vanes
export const SHUTTER_KINDS = ['matte', 'stars', 'water', 'storm', 'dunes', 'aurora', 'blinds'];

// How long each part takes, seconds: the slats coming down the whole height, the display pixelating on, and off
// (before the slats go up, or between two scenes), and the vanes turning from edge on to shut.
const DROP_S = 3.2, ON_S = 1.5, OFF_S = 0.9, VANE_S = 1.6;

const hex = (h) => { const n = parseInt(String(h || '#000').slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const same = (a, b) => !!a && !!b && a.kind === b.kind && a.a === b.a && a.b === b.b && a.c === b.c;
const toward = (x, to, step) => (x < to ? Math.min(to, x + step) : Math.max(to, x - step));
const isBlind = (p) => p?.kind === 'blinds';
// the slats come down quickly and settle
const ease = (k) => 1 - Math.pow(1 - k, 2.2);
// how much of each vane's spacing it covers for a light level: at 100% they're edge on, a thin line each; at 0 shut
export const vaneFor = (level) => 0.1 + 0.9 * (1 - Math.max(0, Math.min(100, Number(level) || 0)) / 100);

// Where the coverings are and where they're going. `set` takes what the server sent (`glass` on `room_view` with
// snap, so a room opens as it is; `room_glass` without, so it moves). `frame` steps it and returns what gl/room.js
// draws, or null with the glass clear.
export function createShutters() {
  // `veil` is 1 while a scene change is clearing out of its blur (shutterAt's wash), else 0
  let want = null, drop = 0, on = 0, vane = 0, veil = 0, paint = null, blind = null, last = 0;
  return {
    set(glass, { snap = false } = {}) {
      want = glass ? { down: !!glass.down, lit: glass.lit !== false, paint: glass.paint || null, level: Number.isFinite(glass.level) ? glass.level : 50 } : null;
      if (!snap) return;
      const b = !!want?.down && isBlind(want.paint);
      drop = want?.down && !b ? 1 : 0; on = drop && want.lit ? 1 : 0; vane = b ? vaneFor(want.level) : 0;
      paint = drop ? want.paint : null; blind = b ? want.paint : null; veil = 0;
    },
    // the slats down or on the way: a doorway under them is shut (room-stage.js fences the balcony door). Blinds
    // are cloth, and you can walk through those.
    get shut() { return (!!want?.down && !isBlind(want.paint)) || drop > 0; },
    // every pane covered and lit: nothing past the glass can be seen, so the view out needn't be painted
    get covered() { return drop >= 1 && on >= 1; },
    frame(now) {
      const dt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 0;
      last = now;
      const mode = want?.down ? (isBlind(want.paint) ? 'blinds' : 'screen') : null;
      let dropT = 0, onT = 0, vaneT = 0;
      if (mode === 'screen') {
        // the blinds turn away first; then a new scene goes in once the old one is dark
        if (vane <= 0) {
          let swap = !!want.paint && !same(want.paint, paint);
          // a lit scene changing to another goes straight across: the new one's colours over the glass at once,
          // blurred, and the blur clears as the new scene pixelates in over it
          if (swap && want.lit && drop >= 1 && on > 0) { paint = want.paint; on = 0; veil = 1; swap = false; }
          else if (swap && on <= 0) { paint = want.paint; swap = false; }
          dropT = 1; onT = want.lit && drop >= 1 && !swap ? 1 : 0;
        }
      } else if (mode === 'blinds') {
        // the display off and the slats up first
        if (drop > 0) dropT = on > 0 ? 1 : 0;
        else { blind = want.paint; vaneT = vaneFor(want.level); }
      } else dropT = on > 0 ? 1 : 0;
      drop = toward(drop, dropT, dt / DROP_S);
      on = toward(on, onT, dt / (onT > on ? ON_S : OFF_S));
      vane = toward(vane, vaneT, dt / VANE_S);
      if (on >= 1 || !onT) veil = 0;
      const P = drop > 0 ? paint : vane > 0 ? blind : null;
      if (!P) return null;
      return { drop: drop > 0 ? ease(drop) : 0, on: drop > 0 ? on : 0, veil: drop > 0 ? veil : 0, vane: drop > 0 ? 0 : vane, kind: Math.max(0, SHUTTER_KINDS.indexOf(P.kind)), a: hex(P.a), b: hex(P.b), c: hex(P.c), glow: hex(P.glow).map((v) => v * v) };
    },
  };
}

// The room's box on the ground ([x0, x1, z0, z1] in the frame the light is in) and the glass's foot and head,
// from the room's layout (room-layout.js) and its panes (room-mesh.js drawPane's y0, y1).
export function shutterFrame(L, windows) {
  const hu = L.w / 2 + 0.3, xs = [], zs = [];
  for (const [u, v] of [[-hu, -0.3], [hu, -0.3], [-hu, L.d + 0.3], [hu, L.d + 0.3]]) { const p = L.world(u, v, 0); xs.push(p[0]); zs.push(p[2]); }
  const ys = (windows || []).filter((w) => Number.isFinite(w.y0));
  return { box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], y: ys.length ? [Math.min(...ys.map((w) => w.y0)), Math.max(...ys.map((w) => w.y1))] : [0, L.h] };
}

// The light the glass lets in: the slats stop most of the day and a lit scene glows; blinds stop as much as
// they're turned shut, and what comes through the cloth takes its blue.
export function shutterWinC(winC, sh) {
  if (!sh) return winC;
  const k = (1 - 0.9 * sh.drop) * (1 - 0.8 * sh.vane), g = 1.3 * Math.max(sh.on, sh.veil || 0) * sh.drop, top = Math.max(...sh.glow, 1e-3);
  return winC.map((w, i) => w * k * (1 + sh.vane * 0.6 * (sh.glow[i] / top - 1)) + sh.glow[i] * g);
}

// `sh` is frame()'s answer with shutterFrame's `box` and `y` and the time `t` on it, or null
export function setShutterUniforms(gl, P, sh) {
  gl.uniform4f(P.u('uShut'), sh ? sh.drop : 0, sh ? sh.on : 0, sh ? sh.kind : 0, sh?.t ?? 0);
  gl.uniform1f(P.u('uShutVane'), sh ? sh.vane : 0);
  gl.uniform1f(P.u('uShutVeil'), sh?.veil ?? 0);
  gl.uniform2f(P.u('uShutDoor'), sh?.door?.[0] ?? 0, sh?.door?.[1] ?? 0);
  if (!sh) return;
  gl.uniform4f(P.u('uShutBox'), sh.box[0], sh.box[1], sh.box[2], sh.box[3]);
  gl.uniform2f(P.u('uShutY'), sh.y[0], sh.y[1]);
  gl.uniform3fv(P.u('uShutA'), sh.a); gl.uniform3fv(P.u('uShutB'), sh.b); gl.uniform3fv(P.u('uShutC'), sh.c);
}

// The shader half: `shutterAt` gives the colour of a pane pixel under the slats, or alpha -1 where the pane is
// clear. It wants gl/room.js's varyings, uEye, uFront, uRight and room-light.js's finish/roomShade.
export const SHUTTER_GLSL = `
uniform vec4 uShut;      // x how far down (eased, 0..1), y how lit (0..1), z the painter, w seconds
uniform float uShutVane; // the blinds: how much of its spacing each vane covers, 0 with none
uniform float uShutVeil; // 1 while a new scene clears out of its blur (a change from one lit scene to another)
uniform vec4 uShutBox;   // the room's ground, x0 x1 z0 z1: only its own panes are covered
uniform vec2 uShutY;     // the glass's foot and head, metres (a pane's uv y)
uniform vec3 uShutA; uniform vec3 uShutB; uniform vec3 uShutC;
uniform vec2 uShutDoor;  // the balcony door: how far open (0..1), and half the doorway's width, metres

float shHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float shNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(shHash(i), shHash(i + vec2(1.0, 0.0)), f.x), mix(shHash(i + vec2(0.0, 1.0)), shHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float shFbm(vec2 p) { return 0.5 * shNoise(p) + 0.3 * shNoise(p * 2.03 + 7.1) + 0.2 * shNoise(p * 4.1 + 3.7); }
// a field of stars on (across, up) in radians: a cell each at k per radian, most of them empty
float shStars(vec2 p, float k, float t) {
  vec2 c = floor(p * k), f = fract(p * k) - 0.5;
  float h = shHash(c);
  if (h < 0.88) return 0.0;
  vec2 o = vec2(shHash(c + 3.1), shHash(c + 7.7)) - 0.5;
  float tw = 0.7 + 0.3 * sin(t * (0.8 + h * 3.0) + h * 40.0);
  return smoothstep(0.13, 0.0, length(f - o * 0.6)) * (h - 0.88) * 9.0 * tw;
}

// a bright star with four diffraction spikes, twinkling
float shFlare(vec2 d, float r, float t, float h) {
  float tw = 0.75 + 0.25 * sin(t * (1.1 + h * 2.0) + h * 30.0);
  vec2 a = abs(d);
  float core = exp(-dot(d, d) / (r * r));
  float spike = exp(-a.x / (r * 6.0)) * exp(-a.y * a.y / (r * r * 0.02)) + exp(-a.y / (r * 6.0)) * exp(-a.x * a.x / (r * r * 0.02));
  return (core * 1.6 + spike * 0.5) * tw;
}
// a lit sphere's colour: a cratered grey moon at unit-disc q
vec3 shMoon(vec2 mq, float mr, vec3 L) {
  vec3 mn = vec3(mq, sqrt(1.0 - mr));
  float ml = clamp(dot(mn, L), 0.0, 1.0);
  float crat = 0.72 + 0.28 * shNoise(mq * 5.0 + 2.0) - 0.15 * smoothstep(0.6, 0.8, shNoise(mq * 11.0 + 7.0));
  return mix(vec3(0.62, 0.6, 0.58), uShutC, 0.2) * crat * (0.02 + ml);
}

vec3 shSpace(vec2 p, float t) {
  vec3 col = uShutA;
  vec2 s = vec2(p.x + t * 0.003, p.y);   // the sky turning, slowly
  // the nebula: warped clouds that roil slowly, two colours, with dark dust lanes through them
  vec2 w = s * 2.2 + vec2(shFbm(s * 1.7 + vec2(t * 0.012, 0.0)), shFbm(s * 1.7 + vec2(4.2, -t * 0.009))) * 1.6;
  float n = shFbm(w), n2 = shFbm(w * 1.9 + 3.3 + t * 0.006);
  float band = exp(-pow(s.y - 0.25 * sin(s.x * 0.9 + 0.6), 2.0) * 7.0);
  float dust = smoothstep(0.45, 0.7, shFbm(w * 2.6 - 1.7)) * band;
  vec3 neb = mix(uShutB, mix(uShutB, uShutC, 0.55), smoothstep(0.35, 0.8, n2));
  col += neb * (smoothstep(0.3, 0.9, n) * band * 1.35 + band * 0.1) * (1.0 - 0.75 * dust);
  // knots of new stars glowing in the brightest cloud, breathing
  col += uShutC * pow(smoothstep(0.62, 0.95, n * n2 * 1.6), 2.0) * band * (0.7 + 0.3 * sin(t * 0.3 + n * 9.0)) * 0.6;
  // three star layers drifting at their own speeds, so the near ones slide past the far
  vec3 starC = mix(vec3(1.0), uShutC, 0.3);
  float st = shStars(vec2(p.x + t * 0.0015, p.y), 70.0, t) + shStars(vec2(p.x + t * 0.003, p.y) + 1.7, 150.0, t) * 0.7 + shStars(vec2(p.x + t * 0.0055, p.y) + 5.3, 280.0, t) * 0.45;
  col += st * starC * (1.0 - 0.6 * dust);
  // a handful of bright ones with spikes
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(-1.4 + 2.9 * shHash(vec2(fi, 2.2)), -0.2 + 0.9 * shHash(vec2(fi, 6.1)));
    vec2 d = vec2(mod(s.x - c.x + 3.14159, 6.28318) - 3.14159, s.y - c.y);
    if (abs(d.x) > 0.12 || abs(d.y) > 0.12) continue;
    float h = shHash(vec2(fi, 9.4));
    col += mix(starC, uShutC, h) * shFlare(d, 0.004 + 0.003 * h, t, h);
  }
  // a spiral galaxy, far off, turning
  vec2 g = s - vec2(0.62, 0.42);
  g = vec2(g.x * 0.9 - g.y * 0.44, g.x * 0.44 + g.y * 0.9) * vec2(1.0, 2.6);
  float gr = length(g);
  if (gr < 0.16) {
    float ga = atan(g.y, g.x) - t * 0.01;
    float arms = pow(0.5 + 0.5 * sin(ga * 2.0 + log(gr + 0.004) * 6.0), 3.0);
    float gl = exp(-gr * 32.0) * 1.4 + arms * exp(-gr * 16.0) * 0.55 * (0.6 + 0.4 * shNoise(g * 90.0));
    col += mix(uShutC, vec3(1.0, 0.92, 0.8), exp(-gr * 40.0)) * gl * smoothstep(0.16, 0.1, gr);
  }
  // shooting stars: three lanes, each a streak now and then, fading as it goes
  for (int i = 0; i < 3; i++) {
    float fi = float(i), per = 6.0 + 3.0 * fi, ph = (t + fi * 2.7) / per, slot = floor(ph), k = fract(ph) * per;
    float h = shHash(vec2(slot, fi + 11.0));
    if (h < 0.35 || k > 0.9) continue;
    vec2 a = vec2(-1.2 + 2.4 * shHash(vec2(slot, fi + 3.0)), 0.25 + 0.5 * shHash(vec2(slot, fi + 5.0)));
    vec2 dir = normalize(vec2(h > 0.67 ? -1.0 : 1.0, -0.45 - 0.4 * h));
    vec2 d = p - (a + dir * k * 0.9);
    float along = dot(d, dir), off = dot(d, vec2(-dir.y, dir.x));
    float tail = smoothstep(-0.22, 0.0, along) * step(along, 0.003);
    float life = smoothstep(0.0, 0.08, k) * smoothstep(0.9, 0.5, k);
    col += mix(vec3(1.0), uShutC, 0.4) * tail * exp(-off * off / 0.0000035) * life * (1.0 + 2.0 * smoothstep(-0.02, 0.0, along)) * 1.4;
  }
  // a ship crossing every minute and a half: a dark sliver, its lamps blinking, a blue drive glow behind
  {
    float k = fract(t / 90.0), slot = floor(t / 90.0);
    vec2 c = vec2(-1.6 + 3.2 * k, 0.32 + 0.12 * shHash(vec2(slot, 1.0)) + 0.01 * sin(t * 0.2));
    vec2 d = (p - c) / 0.006;
    if (abs(d.x) < 30.0 && abs(d.y) < 6.0) {
      col = mix(col, uShutA * 0.4, smoothstep(1.0, 0.7, length(d * vec2(0.28, 1.2))));
      col += vec3(0.4, 0.7, 1.0) * exp(-max(0.0, -d.x - 3.0) * 0.18) * exp(-d.y * d.y * 2.0) * step(d.x, -3.0) * 0.9;
      vec2 r = d - vec2(1.5, 0.5), gn = d - vec2(1.5, -0.5), nose = d - vec2(3.4, 0.0);
      col += vec3(1.0, 0.2, 0.15) * exp(-dot(r, r) * 2.0) * step(0.85, fract(t * 0.9)) * 2.0;
      col += vec3(0.2, 1.0, 0.4) * exp(-dot(gn, gn) * 2.0) * step(0.85, fract(t * 0.9 + 0.5)) * 2.0;
      col += vec3(1.0) * exp(-dot(nose, nose) * 3.0) * step(0.93, fract(t * 0.55)) * 2.5;
    }
  }
  // a ringed planet low in the front-left corner, lit from the right, its clouds flowing, a moon going round it
  vec3 L = normalize(vec3(0.75, 0.3, 0.55));
  vec2 q = (p - vec2(-0.62, 0.06)) / 0.22;
  vec2 rq = vec2(q.x * 0.94 + q.y * 0.34, -q.x * 0.34 + q.y * 0.94);
  rq.y *= 4.0;
  float rl = length(rq);
  float ring = smoothstep(1.35, 1.42, rl) * smoothstep(2.15, 2.05, rl) * (0.55 + 0.45 * sin(rl * 38.0)) * (0.8 + 0.2 * sin(rl * 120.0 + atan(rq.y, rq.x) * 2.0 - t * 0.2));
  ring *= 1.0 - 0.9 * smoothstep(0.02, 0.0, abs(rl - 1.75));   // the gap in the ring
  // the moon's orbit is tilted with the ring; it passes in front on the near half
  float ma = t * 0.045;
  vec2 mo = vec2(cos(ma) * 2.6, sin(ma) * 0.65);
  vec2 mq = (q - vec2(mo.x * 0.94 - mo.y * 0.34, mo.x * 0.34 + mo.y * 0.94)) / 0.16;
  float mr = dot(mq, mq), rr = dot(q, q);
  bool moonFront = sin(ma) < 0.0;
  if (!moonFront && mr < 1.0 && rr > 1.0) col = shMoon(mq, mr, L);
  if (rr < 1.0) {
    vec3 nrm = vec3(q, sqrt(1.0 - rr));
    float lit = clamp(dot(nrm, L), 0.0, 1.0);
    // bands that flow round the planet, with a storm spot riding them
    vec2 sp = vec2(atan(nrm.x, nrm.z) + t * 0.03, q.y);
    float flow = shNoise(vec2(sp.y * 8.0 + shNoise(vec2(sp.x * 2.0, sp.y * 6.0)) * 1.8, 0.5));
    float fine = shNoise(vec2(sp.x * 6.0, sp.y * 40.0));
    vec3 pc = mix(uShutB * 0.8, uShutC, flow * 0.7 + fine * 0.15);
    vec2 spot = vec2(mod(sp.x - 0.6 + 3.14159, 6.28318) - 3.14159, sp.y + 0.28) * vec2(1.0, 2.2);
    pc = mix(pc, uShutC * 1.2, smoothstep(0.16, 0.08, length(spot)) * 0.7);
    // the ring's shadow across the disc
    vec2 sq = q - L.xy * 0.25;
    float srl = length(vec2(sq.x * 0.94 + sq.y * 0.34, (-sq.x * 0.34 + sq.y * 0.94) * 4.0));
    float sh = smoothstep(1.35, 1.42, srl) * smoothstep(2.15, 2.05, srl);
    // a thin limb of atmosphere, and lightning on the night side now and then
    float rim = pow(1.0 - nrm.z, 3.0);
    float storm = step(0.97, shHash(vec2(floor(t * 3.0), 4.0))) * smoothstep(0.1, 0.0, lit) * smoothstep(0.25, 0.0, length(q - vec2(-0.35, 0.2)));
    col = pc * (0.03 + lit * 1.05) * (1.0 - 0.55 * sh);
    col += mix(uShutC, vec3(0.6, 0.8, 1.0), 0.5) * rim * (0.15 + 0.85 * smoothstep(-0.1, 0.5, dot(nrm, L))) * 0.8;
    col += vec3(0.7, 0.8, 1.0) * storm * 0.5;
    if (rq.y < 0.0) col = mix(col, uShutC * (0.3 + 0.6 * lit), ring * 0.85);
  } else {
    // the haze just past the limb, on the lit side
    col += mix(uShutC, vec3(0.6, 0.8, 1.0), 0.5) * exp(-(sqrt(rr) - 1.0) * 30.0) * 0.25 * smoothstep(-0.6, 0.6, dot(normalize(q), normalize(L.xy)));
    col = mix(col, uShutC * 0.7, ring * 0.8);
  }
  if (moonFront && mr < 1.0) col = shMoon(mq, mr, L);
  return col;
}

vec3 shWater(vec2 p, float t) {
  float el = p.y;
  vec3 col = mix(uShutA, uShutB, smoothstep(-0.9, 0.75, el));
  col = mix(col, uShutC, smoothstep(0.6, 1.2, el) * 0.55);
  // the light coming down in bands, swaying
  float rays = pow(max(0.0, sin(p.x * 9.0 + sin(p.x * 3.0 + t * 0.21) * 1.6 + t * 0.12)), 6.0) + 0.6 * pow(max(0.0, sin(p.x * 14.0 - t * 0.17 + 1.3)), 10.0);
  col += uShutC * rays * 0.2 * smoothstep(-0.5, 0.6, el);
  // the surface's light moving on the water up top
  float cs = shNoise(vec2(p.x * 12.0 + t * 0.3, el * 12.0 - t * 0.2)) * shNoise(vec2(p.x * 9.0 - t * 0.25, el * 9.0 + t * 0.15));
  col += uShutC * cs * cs * 0.7 * smoothstep(0.25, 0.8, el);
  // fish: four schools of six, each school swimming one way at its own depth, the far ones small and lost in the
  // blue. Each fish is a spindle with a forked tail, a dorsal fin and an eye; its body bends in a wave that grows
  // toward the tail, dark on the back, silver on the belly, with a bright line down its side and a glint that
  // slides along it as it turns
  for (int s = 0; s < 4; s++) {
    float fs = float(s), hs = shHash(vec2(fs, 3.7)), dir = hs > 0.5 ? 1.0 : -1.0;
    float depth = shHash(vec2(fs, 8.3)), scale = mix(1.0, 0.45, depth), sp = (0.018 + 0.03 * hs) * dir * scale;
    vec2 sc = vec2(hs * 6.2832 + t * sp + 0.05 * sin(t * 0.13 + fs * 2.0), -0.3 + 0.6 * shHash(vec2(fs, 9.1)) + 0.05 * sin(t * 0.09 + fs));
    float sx = mod(p.x - sc.x + 3.14159, 6.28318) - 3.14159;
    if (abs(sx) > 0.4 * scale + 0.1 || abs(el - sc.y) > 0.25) continue;
    for (int i = 0; i < 6; i++) {
      float fi = float(i) + fs * 6.0, h1 = shHash(vec2(fi, 1.3)), h2 = shHash(vec2(fi, 4.9));
      // each fish keeps its place in the school, give or take a little drift
      vec2 off = (vec2(h1, h2) - 0.5) * vec2(0.42, 0.2) * scale + 0.012 * scale * vec2(sin(t * 0.6 + fi * 1.7), sin(t * 0.8 + fi * 2.3));
      float sz = (0.022 + 0.014 * shHash(vec2(fi, 7.7))) * scale;
      vec2 q = vec2((sx - off.x) * dir, el - sc.y - off.y) / sz;
      if (q.x < -1.8 || q.x > 1.15 || abs(q.y) > 0.9) continue;
      // the swim: a wave travelling back down the body, small at the head
      float beat = t * (5.0 + 2.0 * h1) + fi * 3.0, bend = 0.5 * (1.0 - q.x);
      q.y -= 0.13 * bend * bend * sin(beat - q.x * 2.6);
      float x = q.x, ay = abs(q.y);
      // the body: deepest a third back from the nose, narrowing to the tail's root
      float th = 0.3 * pow(max(0.0, 1.0 - x * x), 0.55) * (x < 0.0 ? mix(1.0, 0.45, -x) : 1.0);
      float body = (x > -1.0 && x < 1.0) ? smoothstep(th + 0.025, th - 0.015, ay) : 0.0;
      // the forked tail, wider toward its tips, the notch cut out of the middle
      float k = clamp((-0.95 - x) / 0.75, 0.0, 1.0), spread = 0.07 + 0.5 * k;
      float tail = (x < -0.92 && x > -1.72) ? smoothstep(spread, spread - 0.04, ay) * smoothstep(0.55 * spread * k * k - 0.02, 0.55 * spread * k * k + 0.02, ay) : 0.0;
      // the dorsal fin, a sail behind the middle of the back, and a small one under the belly
      float df = q.y > 0.0 && x > -0.35 && x < 0.3 ? smoothstep(0.02, -0.02, q.y - th - 0.16 * (1.0 - abs(x + 0.02) / 0.33) * smoothstep(0.3, -0.1, x)) : 0.0;
      float vf = q.y < 0.0 && x > -0.6 && x < -0.3 ? smoothstep(0.02, -0.02, ay - th - 0.07 * (1.0 - abs(x + 0.45) / 0.15)) : 0.0;
      float fins = max(df, vf) * (1.0 - body);
      float m = max(max(body, tail * 0.85), fins * 0.7);
      if (m <= 0.0) continue;
      // the colours: the back dark, the belly silver under the light from above, the side line bright
      float side = clamp(q.y / max(th, 0.02), -1.0, 1.0);
      vec3 back = uShutA * 0.35 + vec3(0.02, 0.05, 0.07), belly = mix(uShutC, vec3(0.85, 0.9, 0.92), 0.5) * 0.75;
      vec3 fc = mix(belly, back, smoothstep(-0.55, 0.35, side));
      fc += uShutC * 0.25 * smoothstep(0.08, 0.0, abs(side + 0.05)) * body;
      // the glint: a band of light sliding along the flank as the body bends toward and away
      fc += uShutC * 0.55 * pow(max(0.0, sin(beat - x * 2.6 + 1.2)), 6.0) * smoothstep(0.6, -0.2, side) * body;
      // faint bars down the back, and the eye
      fc *= 1.0 - 0.18 * smoothstep(0.2, 0.6, side) * step(0.5, fract(x * 3.5));
      vec3 fin = mix(back, uShutB, 0.4);
      fc = mix(fc, fin, max(fins, tail * (1.0 - body)));
      float eye = length(vec2(x - 0.66, q.y - 0.05));
      fc = mix(fc, vec3(0.02), smoothstep(0.065, 0.045, eye) * body);
      fc += vec3(0.6) * smoothstep(0.02, 0.0, length(vec2(x - 0.675, q.y - 0.065)));
      // the far schools lost in the blue
      fc = mix(fc, col, depth * 0.75);
      col = mix(col, fc, m);
    }
  }
  // bubbles going up
  vec2 bp = vec2(p.x * 30.0, el * 30.0 - t * 1.1), bf = fract(bp) - 0.5;
  float bh = shHash(floor(bp));
  if (bh > 0.94) { float r = length(bf - vec2(sin(t * 2.0 + bh * 30.0) * 0.15, 0.0)); col += uShutC * 0.45 * smoothstep(0.15, 0.11, r) * smoothstep(0.05, 0.1, r); }
  return col;
}

vec3 shStorm(vec2 p, float t) {
  float el = p.y;
  float strike = floor(t * 0.6), flash = step(0.9, shHash(vec2(strike, 1.3))) * exp(-fract(t * 0.6) * 9.0);
  float hz = 0.02 * sin(p.x * 3.0 + t * 0.35) + 0.012 * sin(p.x * 7.0 - t * 0.5);
  vec3 col;
  if (el > hz) {
    float cl = shFbm(vec2(p.x * 2.5 + t * 0.03, el * 5.0 + t * 0.01));
    col = mix(uShutB, uShutA, clamp(smoothstep(0.0, 0.8, el) * 0.7 + cl * 0.45, 0.0, 1.0));
    col = mix(col, uShutB * 1.25, smoothstep(0.25, 0.0, el - hz) * 0.45);
    col += uShutC * flash * 0.55 * smoothstep(hz, 0.7, el) * (0.5 + cl);
    // the bolt: a jagged line down to the sea, while the flash lasts
    float bx = -0.9 + 1.4 * shHash(vec2(strike, 5.0)) + 0.03 * sin(el * 40.0 + strike) + 0.015 * sin(el * 97.0);
    col += uShutC * smoothstep(0.005, 0.0, abs(p.x - bx)) * step(el, 0.55) * flash * 3.0;
  } else {
    // the swell, in perspective: rows of waves closing up toward the horizon
    float dep = hz - el + 0.02, v = 1.0 / dep, u = p.x * v;
    float w = sin(v * 1.6 - t * 1.3 + shNoise(vec2(u * 0.4, v * 0.25)) * 4.0);
    col = mix(uShutA, uShutB * 0.7, 0.35 + 0.35 * w);
    col += uShutC * 0.35 * smoothstep(0.82, 1.0, w) * shNoise(vec2(u * 3.0, v * 2.0 + t)) * smoothstep(0.0, 0.25, dep);
    col += uShutC * flash * 0.25;
  }
  // rain, slanting
  float rx = p.x * 160.0 + el * 45.0, rc = floor(rx);
  float rain = step(0.96, shHash(vec2(rc, floor(el * 10.0 + t * 7.0 + shHash(vec2(rc, 0.0)) * 10.0))));
  col += uShutC * 0.1 * rain * smoothstep(0.5, 0.0, abs(fract(rx) - 0.5));
  return col;
}

vec3 shDunes(vec2 p, float t) {
  float el = p.y + 0.0018 * sin(p.x * 60.0 + t * 3.0) * smoothstep(0.08, 0.0, abs(p.y));   // the air shimmering
  vec2 sun = vec2(-0.3, 0.045);
  vec3 col = mix(uShutB, uShutA, smoothstep(-0.02, 0.65, el));
  float sd = length((vec2(p.x, el) - sun) * vec2(1.0, 2.2));
  col = mix(col, uShutC, exp(-sd * 3.0) * 0.65);
  col = mix(col, uShutC * 1.1, smoothstep(0.052, 0.045, length(vec2(p.x, el) - sun)));
  col = mix(col, uShutB * 1.05, smoothstep(0.55, 0.8, shNoise(vec2(p.x * 3.0 + t * 0.004, el * 30.0))) * smoothstep(0.06, 0.2, el) * 0.45);
  // three ridges of dunes, the far first, each darker
  for (int i = 0; i < 3; i++) {
    float fi = float(i), fr = 2.0 + fi * 1.3, ph = fi * 2.1;
    float h = -0.02 - fi * 0.065 + (0.03 + fi * 0.02) * sin(p.x * fr + ph) + 0.01 * sin(p.x * (7.0 + fi * 3.0) + fi);
    if (el < h) {
      float face = cos(p.x * fr + ph) * sign(p.x - sun.x);
      vec3 sand = mix(uShutB * 0.8, uShutA * 1.1, 0.3 + fi * 0.28);
      col = mix(sand * 1.05, sand * 0.5 + uShutA * 0.15, smoothstep(-0.3, 0.3, face));
      col += uShutC * 0.18 * smoothstep(0.012, 0.0, h - el) * (1.0 - fi * 0.3);
    }
  }
  return col;
}

// the sky with the aurora in it, at (across, up) radians: three curtains at different heights, each a bright
// folded lower edge that wanders and ripples, rays climbing off it, green low and violet to red at the top
vec3 shAuroraSky(vec2 p, float t) {
  float el = p.y;
  vec3 col = mix(uShutA * 2.2 + vec3(0.0, 0.015, 0.02), uShutA * 0.6, smoothstep(0.0, 0.9, el));
  col += vec3(shStars(p, 90.0, t) + shStars(p + 2.3, 210.0, t) * 0.6 + shStars(p + 4.1, 400.0, t) * 0.35) * 0.75;
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i), sp = 0.6 + 0.35 * fi;
    // the curtain's foot: a slow wandering line with fast folds travelling along it
    float base = 0.12 + 0.13 * fi + 0.07 * sin(p.x * (1.3 + fi * 0.4) + t * 0.05 * sp + fi * 2.0) + 0.05 * (shFbm(vec2(p.x * 2.0 + fi * 5.0, t * 0.04)) - 0.5);
    float fold = sin(p.x * (9.0 + fi * 4.0) - t * 0.35 * sp + 3.0 * shNoise(vec2(p.x * 3.0, t * 0.1 + fi)));
    base += 0.012 * fold;
    float h = el - base;
    if (h < -0.05) continue;
    // rays: fine vertical streaks that brighten and fade, and run sideways along the curtain
    float rx = p.x * (60.0 + fi * 25.0) + 2.0 * fold;
    float rays = 0.25 + 0.75 * pow(shNoise(vec2(rx - t * 0.6 * sp, t * 0.5 + fi * 7.0)), 1.6);
    // tall over the folds, short between them: the height breathes
    float tall = (0.22 + 0.12 * fi) * (0.6 + 0.4 * shNoise(vec2(p.x * 4.0 + t * 0.08, fi))) * (0.8 + 0.25 * fold);
    float foot = smoothstep(-0.02, 0.006, h);
    float body = foot * exp(-max(h, 0.0) / tall * 2.2);
    // the bright lime seam along the bottom edge
    float seam = exp(-h * h / 0.00012) * (0.7 + 0.3 * fold);
    // colour by height above the foot: green, to blue-violet, to the faint red of the highest air
    float u = clamp(h / (tall * 1.6), 0.0, 1.0);
    vec3 c = mix(uShutB, uShutC, smoothstep(0.2, 0.75, u));
    c = mix(c, vec3(0.9, 0.18, 0.3), smoothstep(0.7, 1.0, u) * 0.6);
    float pulse = 0.7 + 0.3 * sin(t * (0.4 + fi * 0.17) + p.x * 2.0 + fi * 4.0);
    glow += c * body * rays * pulse * (1.1 - 0.25 * fi) + mix(uShutB, vec3(0.85, 1.0, 0.8), 0.45) * seam * rays * 1.2;
  }
  // a little bloom: the brightest light spills into the sky round it
  return col + glow + uShutB * 0.06 * smoothstep(0.0, 0.4, el) * (1.0 - smoothstep(0.4, 0.9, el));
}

vec3 shAurora(vec2 p, float t) {
  float el = p.y;
  // the far shore: a black line of spruce, each a narrow spire, rising out of a low ridge
  float ridge = 0.008 + 0.022 * shNoise(vec2(p.x * 3.0, 1.0)) + 0.008 * shNoise(vec2(p.x * 11.0, 2.0));
  float tc = p.x * 140.0, ti = floor(tc), tf = fract(tc) - 0.5, th = shHash(vec2(ti, 3.3));
  float tree = ridge + (0.012 + 0.03 * th) * max(0.0, 1.0 - abs(tf) * (2.2 + 0.6 * th)) * step(0.25, th);
  float shore = max(ridge, tree);
  if (el > shore) return shAuroraSky(p, t);
  // the shore and forest black, just picking up a green edge from the sky
  if (el > -0.006) return uShutA * 0.25 + uShutB * 0.04 * smoothstep(shore - 0.01, shore, el);
  // the lake: the sky mirrored, darker, broken by slow ripples, with the forest's reflection hanging below the shore
  float r = shNoise(vec2(p.x * 30.0, el * 260.0 - t * 0.3)) - 0.5;
  vec2 m = vec2(p.x + r * 0.006 * (1.0 + -el * 6.0), -el - 0.012);
  float mshore = ridge;
  vec3 refl = -el - 0.012 < mshore + (tree - ridge) ? uShutA * 0.2 : shAuroraSky(m, t);
  float fres = 0.55 + 0.35 * smoothstep(-0.05, -0.4, el);
  vec3 col = refl * (0.75 - 0.35 * smoothstep(0.0, -0.5, el)) * fres;
  // a line of light along the near ripples
  col += uShutB * 0.05 * smoothstep(0.35, 0.5, r) * smoothstep(-0.5, -0.02, el);
  return col;
}

vec3 shScene(vec2 p, float t) {
  int k = int(uShut.z + 0.5);
  if (k == 1) return shSpace(p, t);
  if (k == 2) return shWater(p, t);
  if (k == 3) return shStorm(p, t);
  if (k == 4) return shDunes(p, t);
  if (k == 5) return shAurora(p, t);
  return mix(uShutB, uShutA, smoothstep(-0.6, 0.6, p.y));
}

// Venetian blinds: horizontal slats 5 cm apart, each covering uShutVane of the spacing, the window between them
vec4 blindAt(vec3 diff, vec3 spec) {
  float y = vUv.y, top = uShutY.y;
  // the headrail across the head
  if (y > top - 0.07) return vec4(finish(roomShade(vec3(0.62, 0.64, 0.66), diff, spec, 4.0)), 1.0);
  // horizontal slats, 5 cm apart, tilted to cover uShutVane of the spacing; the ladder tapes hang down through
  // them every 60 cm
  float c = uShutVane, s = fract(y / 0.05) - 0.5;
  float tape = smoothstep(0.012, 0.008, abs(fract(vUv.x / 0.6) - 0.5) * 0.6);
  if (abs(s) > c * 0.5 + 0.002) return tape > 0.5 ? vec4(finish(pow(uShutB, vec3(2.2)) * 0.7 * (uAmb + diff)), 1.0) : vec4(-1.0);
  float across = s / max(c * 0.5, 0.002);
  // the slat's curve catches the light along its top edge and falls into shade underneath
  float shade = (0.78 + 0.22 * smoothstep(-1.0, 0.8, across)) * mix(0.75, 1.0, smoothstep(1.0, 0.7, abs(across)));
  vec3 slat = pow(uShutB, vec3(2.2)) * shade;
  // the room's lamps on its face, and the day coming over the top of each slat
  vec3 col = slat * (uAmb + diff) + slat * uWinC * 0.35 + pow(uShutC, vec3(2.2)) * uWinC * 0.05 * smoothstep(0.3, 1.0, across);
  col *= mix(1.0, 0.8, tape);
  // the bottom rail, heavier than a slat
  if (y < uShutY.x + 0.03) col = slat * (uAmb + diff) * 0.8;
  return vec4(finish(col) + spec * 0.15, 1.0);
}

vec4 shutterAt(vec3 diff, vec3 spec, float fres) {
  if ((uShut.x <= 0.0 && uShutVane <= 0.0) || vUv.x < 50.0) return vec4(-1.0);
  // the doorway's pane (uv from 300 at its middle) opens from its right-hand jamb as the one leaf slides left
  if (vUv.x > 250.0 && uShutDoor.y > 0.0 && vUv.x - 300.0 > uShutDoor.y * (1.0 - 2.0 * uShutDoor.x)) return vec4(-1.0);
  if (vPos.x < uShutBox.x || vPos.x > uShutBox.y || vPos.z < uShutBox.z || vPos.z > uShutBox.w) return vec4(-1.0);
  if (uShutVane > 0.0) return blindAt(diff, spec);
  // the leading edge: from above the head down to past the foot, so the rail ends under the frame
  float top = uShutY.y + 0.06, bot = uShutY.x - 0.06, edge = top - uShut.x * (top - bot), y = vUv.y;
  if (y < edge) return vec4(-1.0);
  float below = y - edge, down = step(0.999, uShut.x);
  // the slats, 12 cm each; the last few over the edge are still turning shut and show the glass between them
  float s = fract(y / 0.12), open = 0.45 * (1.0 - smoothstep(0.0, 0.5, below)) * (1.0 - down);
  if (s < open) return vec4(-1.0);
  float groove = smoothstep(0.0, 0.05, s - open) * smoothstep(1.0, 0.93, s);
  vec3 slat = vec3(0.07, 0.075, 0.082) * (0.7 + 0.3 * groove) * (0.85 + 0.25 * (s - open));
  vec3 col = finish(roomShade(slat, diff, spec * 0.6, 4.0));
  // the bottom rail, brushed steel
  if (below < 0.035 && down < 0.5) col = finish(roomShade(vec3(0.42, 0.43, 0.45), diff, spec * 1.4, 4.0));
  // the display: it pixelates in, coarse blocks popping up at random and halving in size step by step, the
  // colours few at first; going off it does the same backwards
  if (uShut.y > 0.0 || uShutVeil > 0.0) {
    vec3 d = normalize(vPos - uEye);
    vec2 p = vec2(atan(dot(d, uRight), dot(d, uFront)), asin(clamp(d.y, -1.0, 1.0)));
    float on = uShut.y, whole = step(0.999, on), lv = floor(on * 7.0), blk = 0.2 / exp2(lv);
    vec2 cell = floor(p / blk);
    float shown = max(whole, step(shHash(cell + lv * 7.13), on * 1.3 - 0.05));
    // ⚠ ONE CALL TO shScene, NEVER MORE. Every call is all six scenes and their loops inlined, and with five of
    // them (four more in a bilinear blur for the change of scene) Windows' D3D compiler crashed the GPU process
    // building the room's shader: no room drew, and after a few Chrome turned WebGL off. A cell is either in
    // (the scene, sharp) or not yet, under a change of scene (its colours blurred, sharpening as it comes on),
    // so the one call takes whichever place the cell needs: the blur is a coarse mosaic of the new scene.
    bool veil = uShutVeil > 0.0 && whole < 0.5 && shown < 0.5;
    float br = mix(0.03, 0.4, pow(1.0 - on, 1.5));
    vec3 scene = shScene(veil ? (floor(p / br) + 0.5) * br : mix((cell + 0.5) * blk, p, whole), uShut.w);
    if (veil) col = mix(col, scene * (0.92 + 0.08 * groove), uShutVeil);
    else {
      float q = 3.0 + on * 29.0;
      scene = mix(floor(scene * q + 0.5) / q, scene, whole) * (0.92 + 0.08 * groove);
      col = mix(col, scene, shown);
    }
  }
  // still behind glass: the room's highlights on it
  col += spec * 0.25 + vec3(0.03, 0.035, 0.04) * fres;
  return vec4(col, 1.0);
}
`;
