// THE CURTAIN, WITH THE CITY IN FRONT OF IT.
//
// The Curtain is the one piece of world geometry that is neither mass nor a light: a translucent
// energy wall, taller than anything in Coldwater, running for tiles at a time. In the 2-D renderer
// it was queued as an ordinary face and the painter's order buried whatever stood in front of it.
//
// ⚠ THAT ORDER IS GONE. With the city's mass on the GPU it is composited BEFORE the 2-D adornments
// and can never paint over one, so the Curtain drew straight across the skyline. The probe that
// hides every other adornment (`decoHidden`) cannot help here and it is worth being precise about
// why: it answers a PER-SURFACE question — is this whole thing behind something — and the Curtain
// needs a PER-PIXEL one, because a building in front hides its lower half while its crown still
// shows above the rooftops. No amount of probing gets there. A depth buffer answers it exactly.
//
// So the wall goes on the GPU beside the mass, depth-TESTED against it and writing no depth of its
// own — the same contract the lights ride in sprites.js, for the same reason: it is something you
// see THROUGH, so it must never hide what is behind it.
//
// Everything the 2-D pass painted is a function of position along the wall (u) and down it (v),
// which is what makes this a faithful port rather than an impression: the four-stop body gradient,
// the ten scan bands sliding down, the five rain streaks and the hot crown line are all rebuilt
// from the same constants, and the pulse is the same `sin(now / 420)`.
import { viewProjMatrix } from './camera.js';

// pos3, uv2, alpha1
const STRIDE = 6;

const VERT = `#version 300 es
in vec3 aPos;
in vec2 aUV;
in float aAlpha;
uniform mat4 uViewProj;
out vec2 vUV;
out float vAlpha;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUV = aUV;
  vAlpha = aAlpha;
}`;

// ⚠ THE LINE WIDTHS ARE IN PIXELS AND THE SHADER WORKS IN UV, so every one of them is derived
// through fwidth() rather than as a constant in v. A scan band is one pixel tall on a wall a
// thousand pixels high and on one thirty pixels high, exactly as `ctx.lineWidth = 1` was.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
uniform float uTime;
out vec4 outColor;

void main() {
  float u = vUV.x, v = vUV.y;                 // 0..1 along the wall, 0 at the crown to 1 at the ground
  float pulse = 0.5 + 0.5 * sin(uTime / 420.0);
  float dv = max(fwidth(v), 1e-5);
  float du = max(fwidth(u), 1e-5);

  // ── the body, as the four gradient stops it was ───────────────────────────
  vec3 c0 = vec3(215.0, 250.0, 255.0) / 255.0; float a0 = 0.50;
  vec3 c1 = vec3(120.0, 225.0, 255.0) / 255.0; float a1 = 0.24 + 0.10 * pulse;
  vec3 c2 = vec3( 70.0, 150.0, 255.0) / 255.0; float a2 = 0.15 + 0.07 * pulse;
  vec3 c3 = vec3(120.0, 110.0, 255.0) / 255.0; float a3 = 0.09 + 0.05 * pulse;
  vec3 rgb; float a;
  if (v < 0.12) {
    float t = v / 0.12;              rgb = mix(c0, c1, t); a = mix(a0, a1, t);
  } else if (v < 0.55) {
    float t = (v - 0.12) / 0.43;     rgb = mix(c1, c2, t); a = mix(a1, a2, t);
  } else {
    float t = (v - 0.55) / 0.45;     rgb = mix(c2, c3, t); a = mix(a2, a3, t);
  }

  // ── ten scan bands sliding down the field ─────────────────────────────────
  // Brighter low, faint high, exactly as the stroke alpha was.
  float band = 0.0;
  for (int k = 0; k < 10; k++) {
    float t = 1.0 - fract(uTime / 1400.0 + float(k) / 10.0);
    band += (1.0 - smoothstep(0.0, dv, abs(v - t))) * (0.05 + 0.10 * (1.0 - t));
  }

  // ── five vertical rain streaks ────────────────────────────────────────────
  // The 2-D pass placed these across the quad's SCREEN box; in the wall's own frame they sit at
  // the same hash positions along u and slide down v on the same clock.
  float rain = 0.0;
  for (int k = 0; k < 5; k++) {
    float su = fract(sin(float(k) * 12.9898) * 0.5 + 0.5);
    float y0 = fract(uTime / 900.0 + float(k) * 0.37);
    float d = (v - y0) / 0.16;                                  // 0..1 down the streak
    float along = (d > 0.0 && d < 1.0) ? sin(d * 3.14159) : 0.0;   // the gradient's 0 → .22 → 0
    rain += (1.0 - smoothstep(0.0, du * 1.5, abs(u - su))) * along * 0.22;
  }

  // ── the hot crown line along the very top edge ────────────────────────────
  float crown = (1.0 - smoothstep(0.0, dv * 2.0, v)) * (0.5 + 0.3 * pulse);

  vec3 lit = vec3(200.0, 245.0, 255.0) / 255.0;
  vec3 add = rgb * a + lit * band + vec3(190.0, 240.0, 255.0) / 255.0 * rain
           + vec3(225.0, 252.0, 255.0) / 255.0 * crown;
  float outA = (a + band + rain + crown) * vAlpha;
  // ⚠ ADDITIVE, and the alpha rides along. The 2-D pass drew this with 'lighter' straight onto the
  // finished frame; here it lands in a buffer that is BLITTED source-over, so a wall standing
  // against open sky has to carry its own alpha or it would composite onto nothing and vanish.
  // Same compromise the additive lights already make, and for the same reason.
  outColor = vec4(add * vAlpha, clamp(outA, 0.0, 1.0));
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' curtain shader: ' + log);
  }
  return sh;
}

// A segment is `{ ax, ay, bx, by, h, alpha }` — the wall's two ground points in the same
// camera-relative tile frame the lights use, its world-z height, and the fade the world pass
// already computed for it.
export function createCurtainLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('curtain link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    time: gl.getUniformLocation(prog, 'uTime'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  let count = 0;

  function upload(segs) {
    count = segs.length * 6;
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 512));
    let o = 0;
    const put = (x, y, z, u, v, a) => {
      data[o] = x; data[o + 1] = y; data[o + 2] = z;
      data[o + 3] = u; data[o + 4] = v; data[o + 5] = a;
      o += STRIDE;
    };
    for (const s of segs) {
      const a = s.alpha == null ? 1 : s.alpha, h = s.h;
      // top-left, top-right, bottom-right / top-left, bottom-right, bottom-left
      put(s.ax, s.ay, h, 0, 0, a); put(s.bx, s.by, h, 1, 0, a); put(s.bx, s.by, 0, 1, 1, a);
      put(s.ax, s.ay, h, 0, 0, a); put(s.bx, s.by, 0, 1, 1, a); put(s.ax, s.ay, 0, 0, 1, a);
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.pos, 3, 0); bind(loc.uv, 2, 12); bind(loc.alpha, 1, 20);
    gl.bindVertexArray(null);
    return segs.length;
  }

  function draw(cam, H, now) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, H)));
    gl.uniform1f(loc.time, now || 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);          // you see THROUGH it — it must never hide what is behind it
    gl.disable(gl.CULL_FACE);     // the wall is a single plane and is looked at from both sides
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return count / 6;
  }

  return { upload, draw, get segments() { return count / 6; } };
}
