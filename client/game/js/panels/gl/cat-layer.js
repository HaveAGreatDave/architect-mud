// GLASS · A CAT IN A ROOM WALKED IN GLASS (one-world, docs/proposals/one-world-interiors.md phase C; docs/proposals/pets.md).
// The Room Stage's cat, drawn in GLASS's own context: the same carves and bones (gl/cat-gpu.js catDrawer hands this
// layer its meshes and each frame its bones, as it hands gl/room.js), the same beast shader skinned on the GPU
// (gl/beast-light.js through cat-gpu.js skinVariant), the same coat of shells with alpha-to-coverage and the same ink a
// little over half the people's line. The cat is posed in the room's own frame (gl/room-beasts.js catsFrame), so `VP` is
// the street's view-projection times the room's matrix; the light is the room's lamps (gl/room-light-uniforms.js).
//
// ⚠ LOADED THE FIRST TIME A CAT IS NEAR, NOT WITH GLASS (gl/context.js roomCats), and never waited on: its programs link
// in the background (programs.js layerProgramAsync), and till they have the cat isn't drawn.
import { BEAST_VS, BEAST_FS } from './beast-light.js';
import { INK_VS, INK_FS } from './ink.js';
import { CAT_STRIDE, CAT_ATTRS, skinVariant } from './cat-gpu.js';
import { layerProgramAsync } from './programs.js';
import { HOUSE } from './house-style.js';
import { LIN, linRgb, applyLinOut } from './colour.js';
import { setRoomLight } from './room-light-uniforms.js';

const CAT_BEAST_VS = skinVariant(BEAST_VS), CAT_INK_VS = skinVariant(INK_VS);

export function createCatLayer(gl) {
  const prog = (vs, fs, label) => { const P = layerProgramAsync(gl, vs, fs, label), u = {}; return { get p() { return P.p; }, ready: () => P.ready(), u: (n) => (u[n] ??= gl.getUniformLocation(P.p, n)) }; };
  const LIT = prog(CAT_BEAST_VS, BEAST_FS, 'glass cat'), INK = prog(CAT_INK_VS, INK_FS, 'glass cat ink');
  // each carve and each part of the eyes uploaded once, as gl/room.js catMesh: { body: { vao, n, indexed }, fur, bufs }
  const meshes = new Set();
  function catMesh(m) {
    const buf = gl.createBuffer(), bufs = [buf], S = CAT_STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, m.data, gl.STATIC_DRAW);
    const vaoOf = (index) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (const [l, n, off] of CAT_ATTRS) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); }
      if (index) {
        const ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
        bufs.push(ib);
      }
      gl.bindVertexArray(null);
      return vao;
    };
    const h = { body: { vao: vaoOf(m.index), n: m.index ? m.index.length : m.verts, indexed: !!m.index }, fur: (m.fur || []).map((f) => ({ vao: vaoOf(f.index), n: f.index.length, layers: f.layers })), bufs };
    meshes.add(h);
    return h;
  }
  function freeCatMesh(h) {
    if (!h || !meshes.has(h)) return;
    meshes.delete(h);
    gl.deleteVertexArray(h.body.vao);
    for (const f of h.fur) gl.deleteVertexArray(f.vao);
    for (const b of h.bufs) gl.deleteBuffer(b);
  }
  // every cat through program P: the body and its parts, and with `fur` the shells, one instance a layer
  function drawCats(P, cats, fur = false) {
    for (const c of cats) {
      gl.uniform4fv(P.u('uCatBone'), c.rows);
      gl.uniform1f(P.u('uCatBreath'), c.breath || 0);
      gl.uniform1f(P.u('uCatShells'), 0);
      for (const h of c.meshes) {
        if (!meshes.has(h) || !h.body.n) continue;
        gl.bindVertexArray(h.body.vao);
        if (h.body.indexed) gl.drawElements(gl.TRIANGLES, h.body.n, gl.UNSIGNED_INT, 0); else gl.drawArrays(gl.TRIANGLES, 0, h.body.n);
      }
      if (!fur) continue;
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true, true, true, false);
      gl.uniform1f(P.u('uFurSoft'), 1);
      for (const h of c.meshes) {
        if (!meshes.has(h)) continue;
        for (const f of h.fur) {
          if (!f.n || !f.layers) continue;
          gl.uniform1f(P.u('uCatShells'), f.layers);
          gl.bindVertexArray(f.vao);
          gl.drawElementsInstanced(gl.TRIANGLES, f.n, gl.UNSIGNED_INT, 0, f.layers);
        }
      }
      gl.uniform1f(P.u('uFurSoft'), 0);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true, true, true, true);
    }
  }
  return {
    catMesh, freeCatMesh,
    get ready() { return LIT.ready(); },
    // `cats` [{ meshes, rows, breath }] (catsFrame's `cats`), `env` the room's light with the eye in its frame
    draw(VP, cats, env) {
      const list = (cats || []).filter((c) => c?.rows && c.meshes?.length);
      if (!list.length || !LIT.ready()) return false;
      const v = gl.getParameter(gl.VIEWPORT), w = v[2], h = v[3];
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(LIT.p); applyLinOut(gl, LIT.p, 0);
      gl.uniformMatrix4fv(LIT.u('uVP'), false, VP);
      setRoomLight(gl, LIT, env, w, h);
      gl.uniform1f(LIT.u('uTime'), performance.now() / 1000);
      gl.uniform3f(LIT.u('uShadeTint'), 0.6, 0.55, 0.8);
      gl.uniform1f(LIT.u('uRimK'), 1);
      gl.uniform1i(LIT.u('uGlowN'), 0);
      drawCats(LIT, list, true);
      // and his line, a little over half the people's, round the outside of the coat (gl/room.js)
      if (INK.ready()) {
        const k = h / 900, s = 0.55;
        gl.useProgram(INK.p); applyLinOut(gl, INK.p, 0);
        gl.uniformMatrix4fv(INK.u('uVP'), false, VP);
        gl.uniform2f(INK.u('uShake'), 0, 0);
        gl.uniform2f(INK.u('uRes'), w, h);
        gl.uniform4f(INK.u('uInk'), 0.01, HOUSE.px[0] * k * s, HOUSE.px[1] * k * s, 0.0004);
        // (no uBack: GLASS's depth isn't the room's, so the line is pushed back by its share of w alone)
        gl.uniform2f(INK.u('uBack'), 0, 0);
        gl.uniform4f(INK.u('uInkEye'), env.eye[0], env.eye[1], env.eye[2], 1);
        gl.uniform3fv(INK.u('uCol'), LIN.out ? linRgb(HOUSE.ink) : HOUSE.ink);
        gl.uniform3f(INK.u('uKey'), 0, 1, 0);
        gl.uniform1f(INK.u('uWeigh'), HOUSE.weigh);
        gl.uniform1f(INK.u('uCatFurInk'), 0.8);
        drawCats(INK, list);
        gl.uniform1f(INK.u('uCatFurInk'), 0);
      }
      gl.bindVertexArray(null);
      return true;
    },
    dispose() { for (const h of [...meshes]) freeCatMesh(h); for (const P of [LIT, INK]) { try { if (P.p) gl.deleteProgram(P.p); } catch { /* the context may be gone */ } } },
  };
}
