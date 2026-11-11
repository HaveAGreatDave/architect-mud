// UNDER VIEW: flying the free camera through the Under (plugins/freelook, `freelook under`).
//
// ⚠ A SECOND SCENE, ON PURPOSE. freelook-view.js is the windshield with the vehicle taken out and
// says there must never be a second scene there, because GLASS draws the city. GLASS draws nothing
// below the street: the Under is 121 tiles at grid_z -1 that only exist as rooms. So this is its own
// small WebGL2 renderer over geometry built from the tile graph (under-scene.js), flown with the
// same freecam.js, sitting in the same pane with the same chips and the same way out.
//
// Controls are freecam's, plus: L the headlamp, G ghost (fly through the walls and see the network
// from outside), O or ✕ close.

import { createFreeCam, freeCamHint, bindFreeCamPointer, bindFreeCamIdle } from './freecam.js';
import { buildUnder, confine, nearestNode, STRIDE, ANNEX_Z } from './under-scene.js';
import { loadCss } from '../../../shared/dom.js';

const UNDER_CSS = await loadCss(new URL('./under-view.css', import.meta.url));

const MAX_L = 24;
const BASE_VFOV = 68 * Math.PI / 180;
const NEAR = 0.003, FAR = 8;

let st = null;
export function isUnderLookActive() { return !!st; }

const VS = `#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec2 aUV;
layout(location=3) in float aM; layout(location=4) in float aX;
uniform mat4 uVP;
out vec3 vP; out vec3 vN; out vec2 vUV; flat out int vM; out float vX;
void main(){ vP=aP; vN=aN; vUV=aUV; vM=int(aM+0.5); vX=aX; gl_Position=uVP*vec4(aP,1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec3 vP; in vec3 vN; in vec2 vUV; flat in int vM; in float vX;
uniform vec3 uCam; uniform vec3 uFwd; uniform float uT; uniform float uHead;
uniform int uNL; uniform vec4 uLP[${MAX_L}]; uniform vec4 uLC[${MAX_L}];
uniform float uWater;
out vec4 o;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=0.5, s=0.; for(int i=0;i<4;i++){ s+=a*n2(p); p*=2.03; a*=0.5; } return s; }
float seg(vec2 p, vec2 a, vec2 b, float r){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h)-r; }
// A handprint in a unit cell, centred, palm down.
float hand(vec2 p){
  float d = length((p-vec2(0.,-0.12))*vec2(1.,0.85))-0.2;
  d = min(d, seg(p, vec2(-0.16,0.0), vec2(-0.22,0.22), 0.045));
  d = min(d, seg(p, vec2(-0.07,0.05), vec2(-0.09,0.36), 0.05));
  d = min(d, seg(p, vec2(0.03,0.06), vec2(0.03,0.40), 0.05));
  d = min(d, seg(p, vec2(0.12,0.04), vec2(0.15,0.34), 0.046));
  d = min(d, seg(p, vec2(0.18,-0.16), vec2(0.34,-0.02), 0.05));
  return d;
}
void main(){
  vec3 N = normalize(vN);
  vec3 V = uCam - vP; float dist = length(V); V /= dist;
  if (dot(N,V) < 0.) N = -N;
  vec3 alb = vec3(0.3); float spec = 0.05, gloss = 16.; vec3 emis = vec3(0.); float alpha = 1.;
  float grime = fbm(vP.xy*40.+vP.z*20.);
  if (vM == 0) {   // brick
    vec2 b = vec2(vUV.x/0.034, vUV.y/0.013); b.x += 0.5*mod(floor(b.y),2.);
    vec2 f = fract(b), id = floor(b);
    float mortar = max(step(f.x,0.07)+step(0.93,f.x), step(f.y,0.13)+step(0.9,f.y));
    vec3 bc = vec3(0.36,0.18,0.12)*(0.65+0.55*h21(id)) * (0.8+0.4*grime);
    alb = mix(bc, vec3(0.16,0.15,0.13), clamp(mortar,0.,1.));
    float wet = smoothstep(0.55,0.8, n2(vec2(vUV.x*60., vUV.y*3.)));
    float moss = smoothstep(0.55,0.75, fbm(vUV*25.)) * smoothstep(0.12,0.0,vP.z);
    alb = mix(alb, vec3(0.12,0.2,0.07), moss*0.9);
    alb *= 1.-0.4*wet; spec = 0.08+0.5*wet; gloss = 40.;
    // Handprints, thousands of them, some not human.
    if (vX > 0.) {
      vec2 c = vUV/0.026; vec2 ci = floor(c), cf = fract(c)-0.5;
      float r = h21(ci+7.3);
      if (r < vX) {
        float an = (h21(ci+1.1)-0.5)*1.2; mat2 R = mat2(cos(an),-sin(an),sin(an),cos(an));
        float sc = 0.9 + 0.5*h21(ci+3.); if (h21(ci+9.) < 0.15) sc *= 1.5;
        float d = hand(R*cf*1.4/sc);
        float k = h21(ci+5.);
        vec3 pc = k < 0.55 ? vec3(0.42,0.07,0.04) : k < 0.8 ? vec3(0.75,0.7,0.6) : vec3(0.04);
        float m = (1.-smoothstep(-0.01,0.02,d)) * (0.55+0.45*n2(c*9.));
        alb = mix(alb, pc, m);
      }
    }
  } else if (vM == 1) {   // concrete
    alb = vec3(0.19,0.185,0.17)*(0.6+0.6*grime); spec = 0.06;
    alb = mix(alb, vec3(0.1,0.14,0.06), smoothstep(0.6,0.8,fbm(vP.xy*30.))*0.6);
  } else if (vM == 2) {   // channel: slime
    alb = mix(vec3(0.09,0.11,0.05), vec3(0.2,0.22,0.1), grime); spec = 0.5; gloss = 60.;
  } else if (vM == 3) {   // water
    vec2 q = vP.xy*90.; float t = uT*0.6;
    float hx = n2(q+vec2(t,0.))-n2(q+vec2(t+0.6,0.));
    float hy = n2(q+vec2(0.,t*0.8))-n2(q+vec2(0.,t*0.8+0.6));
    N = normalize(vec3(hx*0.35, hy*0.35, 1.));
    alb = vec3(0.04,0.06,0.035); spec = 1.0; gloss = 120.;
    float fr = pow(1.-max(dot(N,V),0.),3.);
    alpha = 0.78 + 0.2*fr;
  } else if (vM == 4) { alb = vec3(0.32,0.33,0.34)*(0.7+0.4*grime); spec = 0.5; gloss = 50.;
  } else if (vM == 5) { alb = mix(vec3(0.35,0.15,0.06), vec3(0.18,0.1,0.06), grime); spec = 0.1;
  } else if (vM == 6) { emis = vec3(1.2,0.8,0.45); alb = vec3(0.);
  } else if (vM == 7) { alb = vec3(0.22,0.2,0.18)*(0.6+0.6*grime);
  } else if (vM == 8) {   // tile
    vec2 f = fract(vUV/0.02); float g = max(step(f.x,0.06), step(f.y,0.06));
    alb = mix(vec3(0.55,0.58,0.5)*(0.6+0.5*grime), vec3(0.15,0.15,0.12), g); spec = 0.35; gloss = 60.;
    if (vX > 0.) { vec2 c = vUV/0.026; vec2 ci = floor(c), cf = fract(c)-0.5;
      if (h21(ci+7.3) < vX) { float d = hand(cf*1.4); alb = mix(alb, vec3(0.42,0.07,0.04), 1.-smoothstep(-0.01,0.02,d)); } }
  } else if (vM == 9) { float fl = 0.8+0.2*sin(uT*23.+vP.x*400.); emis = vec3(1.6,0.9,0.35)*fl; alb = vec3(0.);
  } else if (vM == 10) { emis = vec3(1.4,1.5,1.7); alb = vec3(0.);
  } else if (vM == 11) { alb = vec3(0.7,0.66,0.55); spec = 0.15;
  } else if (vM == 12) { alb = vec3(0.05); spec = 0.3;
  } else if (vM == 13) {   // wood: planks
    vec2 b = vec2(vUV.x/0.06, vUV.y/0.011); b.x += h21(vec2(floor(b.y),3.))*3.;
    vec2 f = fract(b), id = floor(b);
    float gap = max(step(f.y,0.08), step(f.x,0.015));
    float grain = n2(vec2(vUV.x*400., vUV.y*40.));
    alb = vec3(0.30,0.19,0.10)*(0.7+0.5*h21(id))*(0.8+0.35*grain);
    alb = mix(alb, vec3(0.05,0.03,0.02), gap); spec = 0.12; gloss = 24.;
  } else if (vM == 14) {   // linoleum: worn checks
    vec2 c = floor(vUV/0.018); float k = mod(c.x+c.y,2.);
    alb = mix(vec3(0.42,0.38,0.30), vec3(0.16,0.2,0.17), k)*(0.75+0.35*grime); spec = 0.25; gloss = 30.;
  } else if (vM == 15) {   // board-formed concrete
    float board = fract(vUV.y/0.012);
    alb = vec3(0.24,0.235,0.22)*(0.72+0.4*grime)*(0.9+0.1*n2(vec2(vUV.x*120., floor(vUV.y/0.012)*7.)));
    alb *= 1.-0.25*smoothstep(0.9,1.,board);
    alb *= 1.-0.25*smoothstep(0.6,0.85, n2(vec2(vUV.x*70., vUV.y*4.)));
    spec = 0.05;
  } else if (vM == 16) {   // paper: maps, files, charts
    alb = vec3(0.72,0.66,0.5)*(0.85+0.2*grime);
    float lines = smoothstep(0.47,0.5,abs(fract(n2(vP.xy*180.)*6.)-0.5));
    alb = mix(alb, vec3(0.25,0.2,0.18), lines*0.6); spec = 0.05;
  } else if (vM == 17) {   // a screen
    float scan = 0.75+0.25*sin(vP.z*3000.+uT*8.);
    emis = vec3(0.2,0.95,0.4)*scan*0.9; alb = vec3(0.02);
  } else if (vM == 18) {   // canvas, sandbags, blankets
    alb = vec3(0.26,0.26,0.16)*(0.7+0.5*grime); spec = 0.03; }

  vec3 col = alb * vec3(0.012,0.016,0.012);
  for (int i=0;i<${MAX_L};i++){
    if (i >= uNL) break;
    vec3 lp = uLP[i].xyz; float range = uLP[i].w;
    vec3 L = lp - vP; float d = length(L); if (d > range) continue; L /= d;
    float fl = uLC[i].w;
    float att = pow(1.-d/range, 2.) * fl;
    float dif = max(dot(N,L),0.);
    vec3 H = normalize(L+V);
    col += uLC[i].rgb * att * (alb*dif + spec*pow(max(dot(N,H),0.),gloss));
  }
  if (uHead > 0.) {   // the headlamp
    vec3 L = uCam - vP; float d = length(L); L /= d;
    float cone = 0.15 + 0.85*smoothstep(0.80, 0.96, dot(-L, uFwd));
    float att = cone * uHead * 0.75 / (1. + d*d*70.);
    vec3 H = normalize(L+V);
    col += vec3(0.95,0.95,0.88) * att * (alb*max(dot(N,L),0.) + spec*pow(max(dot(N,H),0.),gloss));
  }
  col += emis;
  // Glow round the lamps, through the damp air.
  vec3 rd = -V;
  for (int i=0;i<${MAX_L};i++){
    if (i >= uNL) break;
    vec3 lp = uLP[i].xyz - uCam; float tt = clamp(dot(lp, rd), 0., dist);
    float pd = length(lp - rd*tt);
    col += uLC[i].rgb * uLC[i].w * min(0.00006 / (pd*pd + 0.00015), 0.25) * exp(-tt*1.5) * smoothstep(0.0, 0.05, tt);
  }
  float fog = exp(-dist*1.5);
  col = mix(vec3(0.006,0.008,0.006), col, fog);
  col = col/(1.+col);   // tone map
  col = pow(col, vec3(1./2.2));
  o = vec4(col, alpha);
}`;

const DRIP_VS = `#version 300 es
layout(location=0) in vec4 aD;   // x y z phase
uniform mat4 uVP; uniform float uT; uniform vec3 uCam;
out float vA;
void main(){
  float f = fract(uT*0.45 + aD.w*7.);
  float fall = f < 0.7 ? 0. : (f-0.7)/0.3;
  vec3 p = vec3(aD.xy, aD.z - fall*fall*0.2);
  gl_Position = uVP*vec4(p,1.);
  float d = length(p-uCam);
  gl_PointSize = clamp(2.5/(d*8.+0.2), 1., 4.);
  vA = exp(-d*2.) * (f < 0.7 ? 0.4 : 0.9);
}`;
const DRIP_FS = `#version 300 es
precision mediump float; in float vA; out vec4 o;
void main(){ vec2 c = gl_PointCoord-0.5; if (dot(c,c) > 0.25) discard; o = vec4(vec3(0.6,0.7,0.65)*vA, vA); }`;

function compile(gl, vs, fs) {
  const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function meshVAO(gl, data) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const B = STRIDE * 4;
  const at = (i, n, off) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, B, off * 4); };
  at(0, 3, 0); at(1, 3, 3); at(2, 2, 6); at(3, 1, 8); at(4, 1, 9);
  gl.bindVertexArray(null);
  return { vao, buf, n: data.length / STRIDE };
}

// Camera basis from freecam's view: yaw degrees clockwise from north (-y), pitch and roll radians.
function basis(v) {
  const y = v.yaw * Math.PI / 180, p = v.pitch || 0, r = v.roll || 0;
  const f = [Math.sin(y) * Math.cos(p), -Math.cos(y) * Math.cos(p), Math.sin(p)];
  let rt = [Math.cos(y), Math.sin(y), 0];
  let up = [f[1] * rt[2] - f[2] * rt[1], f[2] * rt[0] - f[0] * rt[2], f[0] * rt[1] - f[1] * rt[0]];
  if (r) { const c = Math.cos(r), s = Math.sin(r); const r2 = rt.map((x, i) => x * c + up[i] * s); up = up.map((x, i) => x * c - rt[i] * s); rt = r2; }
  return { f, rt, up };
}

function viewProj(v, aspect, eyeZ) {
  const { f, rt, up } = basis(v);
  const e = [v.x, v.y, eyeZ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const V = [rt[0], up[0], -f[0], 0, rt[1], up[1], -f[1], 0, rt[2], up[2], -f[2], 0, -dot(rt, e), -dot(up, e), dot(f, e), 1];
  const t = 1 / Math.tan(Math.atan(Math.tan(BASE_VFOV / 2) / (v.fov || 1)));
  const P = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, 2 * FAR * NEAR / (NEAR - FAR), 0];
  const M = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + r] * V[c * 4 + k]; M[c * 4 + r] = s; }
  return { M, f, e };
}

export function openUnderLook(ctx = {}) {
  closeUnderLook();
  const mount = ctx.mount || document.getElementById('area-content');
  if (!mount) return null;
  ensureStyles();

  mount.innerHTML = `<div class="ul-root">`
    + `<canvas class="ul-canvas"></canvas>`
    + `<div class="ul-chips"><span class="ul-chip" data-at></span>`
    + `<button class="ul-chip" type="button" data-lamp title="headlamp (L)">LAMP</button>`
    + `<button class="ul-chip" type="button" data-ghost title="fly through walls (G)">GHOST</button>`
    + `<button class="ul-chip ul-x" type="button" title="close (O)">✕</button></div>`
    + `<div class="ul-hint"></div><div class="ul-err"></div></div>`;
  const root = mount.querySelector('.ul-root');
  const canvas = root.querySelector('canvas');
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { root.querySelector('.ul-err').textContent = 'This view needs WebGL2.'; return null; }

  const scene = buildUnder(ctx.tiles || [], ctx.gx || 0, ctx.gy || 0, ctx.annexes || []);
  let prog, dprog;
  try { prog = compile(gl, VS, FS); dprog = compile(gl, DRIP_VS, DRIP_FS); }
  catch (e) { console.error('[under] shader', e); root.querySelector('.ul-err').textContent = 'Shader failed: ' + e.message; return null; }
  const solid = meshVAO(gl, scene.solid), water = meshVAO(gl, scene.water);
  const dvao = gl.createVertexArray(); gl.bindVertexArray(dvao);
  const dbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, scene.drips, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.bindVertexArray(null);
  const U = {}; for (const n of ['uVP', 'uCam', 'uFwd', 'uT', 'uHead', 'uNL', 'uLP', 'uLC', 'uWater']) U[n] = gl.getUniformLocation(prog, n);
  const DU = {}; for (const n of ['uVP', 'uT', 'uCam']) DU[n] = gl.getUniformLocation(dprog, n);

  const freeCam = createFreeCam();
  const start = ctx.start || { x: 0, y: 0 };
  freeCam.open({ yaw: ctx.yaw || 0, z: start.annex ? ANNEX_Z + 0.08 : 0.08 });
  freeCam.rebase(start.x - (ctx.gx || 0), start.y - (ctx.gy || 0));

  st = { root, mount, gl, freeCam, alive: true, raf: 0, last: performance.now(), head: 1, ghost: false, onExit: ctx.onExit || (() => {}), teardown: [] };
  const lampBtn = root.querySelector('[data-lamp]'), ghostBtn = root.querySelector('[data-ghost]');
  const syncBtns = () => { lampBtn.classList.toggle('on', st.head > 0); ghostBtn.classList.toggle('on', st.ghost); };
  syncBtns();

  const hintEl = root.querySelector('.ul-hint');
  hintEl.textContent = 'THE UNDER · ' + freeCamHint(false).replace('O exit', 'L lamp · G ghost · O close');
  const atEl = root.querySelector('[data-at]');

  const LP = new Float32Array(MAX_L * 4), LC = new Float32Array(MAX_L * 4);
  const lights = scene.lights.filter((l) => l.i > 0);

  function frame(now) {
    if (!st || !st.alive) return;
    const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now;
    try {
      freeCam.step(dt);
      let v = freeCam.view();
      if (!st.ghost && v) {
        const c = confine(scene.graph, v.x, v.y, v.z);
        if (c) {
          if (c.d > 1e-6) freeCam.rebase(c.x - v.x, c.y - v.y);
          freeCam.clampFloor(c.floor);
          if (freeCam.clampCeil) freeCam.clampCeil(c.ceil);
        }
        v = freeCam.view();
      }
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.006, 0.008, 0.006, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!v) { st.raf = requestAnimationFrame(frame); return; }
      const { M, f, e } = viewProj(v, canvas.width / Math.max(1, canvas.height), v.z);
      const t = now / 1000;

      // The nearest lamps, flickering on the CPU so the glow and the light agree.
      const near = lights.map((l) => ({ l, d: Math.hypot(l.x - e[0], l.y - e[1], l.z - e[2]) })).filter((q) => q.d < 3).sort((a, b) => a.d - b.d).slice(0, MAX_L);
      near.forEach(({ l }, i) => {
        const s = l.seed * 100;
        let k = l.i;
        if (l.flick > 0.5 && !l.candle) k *= (Math.sin(t * 13 + s) > -0.85 ? 1 : 0.1) * (Math.sin(t * 2.1 + s * 3) > -0.95 ? 1 : 0);
        else if (l.candle) k *= 0.8 + 0.2 * Math.sin(t * 17 + s) * Math.sin(t * 7.3 + s);
        else k *= 1 - l.flick * 0.5 * (0.5 + 0.5 * Math.sin(t * 9 + s));
        LP.set([l.x, l.y, l.z, l.range], i * 4); LC.set([l.c[0], l.c[1], l.c[2], k], i * 4);
      });

      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.uVP, false, M);
      gl.uniform3fv(U.uCam, e); gl.uniform3fv(U.uFwd, f); gl.uniform1f(U.uT, t); gl.uniform1f(U.uHead, st.head);
      gl.uniform1i(U.uNL, near.length); gl.uniform4fv(U.uLP, LP); gl.uniform4fv(U.uLC, LC);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(solid.vao); gl.drawArrays(gl.TRIANGLES, 0, solid.n);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindVertexArray(water.vao); gl.drawArrays(gl.TRIANGLES, 0, water.n);
      gl.useProgram(dprog);
      gl.uniformMatrix4fv(DU.uVP, false, M); gl.uniform1f(DU.uT, t); gl.uniform3fv(DU.uCam, e);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(dvao); gl.drawArrays(gl.POINTS, 0, scene.drips.length / 4);
      gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);

      const nn = nearestNode(scene.graph, v.x, v.y, v.z);
      if (atEl && nn) atEl.textContent = `${nn.name.toUpperCase()} · ${nn.tx},${nn.ty}`;
    } catch (err) {
      if (!st._errLogged) { console.error('[under] frame error:', err); st._errLogged = true; }
    }
    st.raf = requestAnimationFrame(frame);
  }
  st.raf = requestAnimationFrame(frame);

  const idle = bindFreeCamIdle(freeCam); idle.wake?.();
  const unbindPointer = bindFreeCamPointer(canvas, freeCam);
  function onKey(ev) {
    const k = (ev.key || '').toLowerCase(), down = ev.type === 'keydown';
    if (/^(INPUT|TEXTAREA)$/.test(ev.target?.tagName) || ev.target?.isContentEditable) { if (!down) freeCam.onKey(k, false); return; }
    if (k === 'o' && down && !ev.repeat) { ev.preventDefault(); st.onExit(); return; }
    if (k === 'l' && down && !ev.repeat) { ev.preventDefault(); st.head = st.head > 0 ? 0 : 1; syncBtns(); return; }
    if (k === 'g' && down && !ev.repeat) { ev.preventDefault(); st.ghost = !st.ghost; syncBtns(); return; }
    if (freeCam.onKey(k, down)) ev.preventDefault();
  }
  const onLetGo = () => freeCam.releaseAll();
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', onLetGo);
  lampBtn.addEventListener('click', () => { st.head = st.head > 0 ? 0 : 1; syncBtns(); });
  ghostBtn.addEventListener('click', () => { st.ghost = !st.ghost; syncBtns(); });
  root.querySelector('.ul-x').addEventListener('click', () => st?.onExit());
  st.teardown.push(() => {
    window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', onLetGo);
    try { unbindPointer?.(); } catch { /* */ }
    try { idle.unbind(); } catch { /* */ }
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* */ }
  });
  st.scene = scene;
  return st;
}

export function closeUnderLook() {
  if (!st) return;
  const s = st; st = null; s.alive = false;
  cancelAnimationFrame(s.raf);
  for (const f of s.teardown) { try { f(); } catch { /* keep tearing down */ } }
  try { s.freeCam.close(); } catch { /* */ }
  if (s.mount) s.mount.innerHTML = '';
}

function ensureStyles() {
  const el = document.getElementById('under-view-styles') || document.createElement('style');
  el.id = 'under-view-styles';
  el.textContent = UNDER_CSS;
  if (!el.parentNode) document.head.appendChild(el);
}
