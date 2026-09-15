// THE CITY, UPSIDE DOWN, IN A BUFFER OF ITS OWN.
//
// The road has reflected the city since the wet-tarmac pass shipped, and it has reflected it as a
// SMEAR: each light drawn out along the line between its own ground point and your eye, two
// Gaussians wide. That is the right model for rough wet tarmac and it is genuinely what a damp road
// looks like. It is not what STANDING WATER looks like, and standing water is what the puddle field
// added — a hollow with water sitting in it is a mirror, and a mirror holds an IMAGE. Every
// reference board for this work shows the same thing: the sign, legible, upside down, in the water.
//
// A smear cannot become an image by being tuned. It has no idea what the sign says — it is a colour
// and a radius, and the lettering, the frame, the backing board and the row of bulbs are all in a
// canvas the reflection loop never sees.
//
// So this is that canvas, reflected. One extra render of the two layers that are actually emissive
// — the lights and the signage — through a camera that flips the world about the water's plane,
// into a small texture the ground shader reads back at its own screen position.
//
// ⚠ THE CHEAP PART IS THAT NOTHING IS UPLOADED TWICE. `sprites.js` and `decals.js` already split
// `upload` from `draw`, and a planar reflection is the SAME GEOMETRY through a different matrix. So
// the reflection is a second `draw` over buffers that are going to be filled this frame anyway: no
// new vertex data, no new textures, no second idea of what a sign looks like.
//
// ⚠ AND IT IS A PREPASS, WHICH IS THE ONLY ORDER THAT WORKS. The ground is drawn FOURTH of ten —
// the lights, the Curtain, the signage and the wires are all after it — so at the moment the road
// needs something to reflect, none of it has been drawn. Sampling the frame would return the
// buildings and not one photon of neon. Running before `draw()` also means nothing has to be
// restored afterwards: `draw()` opens by binding the real target and clearing it, exactly as it
// already does after the sun's depth pass and the occlusion pass unbind. Three prepasses now.
//
// ⚠ EIGHT BITS, DELIBERATELY. The float target exists so a bright-pass can tell an emitter from a
// road marking; a reflection is multiplied down by the water level, the Fresnel term and the
// headroom before it reaches the frame, so nothing in here survives to be bloomed and a clamp at
// 1.0 costs the picture nothing. It also means this works on a machine whose driver refused the
// float path, which is the machine most likely to want the resolution dial turned down anyway.

// How much smaller than the canvas the reflection is rendered. Water is not a mirror-smooth surface
// and the ground shader blurs nothing, so the softness a half-resolution buffer brings is the
// softness the surface wants — and it quarters the fill, which is the only cost this pass has.
export const MIRROR_SCALE = 0.5;

export function createMirrorLayer(gl) {
  let tex = null, fbo = null, tw = 0, th = 0, depth = null;
  let prevVP = null;

  // ── AND THE MASS, WHICH IS WHY THERE IS A DEPTH BUFFER NOW ──────────────────
  //
  // This said "NO DEPTH ATTACHMENT, AND THAT IS A STATED LIMIT" and named its own fix: the mass is
  // not re-rendered, so there is nothing for a depth test to test against, every sign reaches the
  // water including one standing behind a tower, and "fixing it is a second mass draw, not a
  // tweak". This is that second mass draw.
  //
  // It was asked for from the other end — a puddle reflecting a white shape rather than a building,
  // because the only things in here were the two EMISSIVE layers and a facade is neither. Both
  // complaints have the same answer, and it turned out to be much cheaper than the note feared:
  //
  // ⚠ THE MESH IS ALREADY UPLOADED AND THE SHADER ALREADY EXISTS. A planar reflection is the same
  // geometry through a different matrix, so this is one more `drawArrays` over a buffer that is
  // filled this frame anyway — no new vertex data, no second idea of what a building looks like.
  // `draw()` takes an `intoTarget` now and skips its own binding and clearing; everything else in
  // its 169 lines is reused exactly, which is the only way the reflection cannot disagree with the
  // city about materials, lighting or fog.
  //
  // ⚠ AND THE WINDING FLIP COSTS NOTHING, which is the part that looked risky. `reflectZ` inverts
  // handedness and `glmirror.mjs` asserts it does — but the mass pass runs with CULL_FACE DISABLED
  // (a building here is not a closed solid: a wall with no back, a soffit, a canopy underside), so
  // there is no front face to get the wrong way round.
  //
  // ⚠ DEPTH16 AND NOT 24. This is a quarter-area buffer read back through water at a few per cent;
  // the ladder that made ground.js need 24 bits is about separating a road from a kerb from a
  // shadow at forty tiles, and none of that is in here. 16 halves the largest new allocation.
  function bind(cw, ch, scale) {
    const s = scale > 0 ? scale : MIRROR_SCALE;
    const w = Math.max(1, Math.round(cw * s)), h = Math.max(1, Math.round(ch * s));
    if (!tex) {
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // ⚠ LINEAR ON BOTH, UNLIKE EVERY OTHER TEXTURE HERE. The wall atlas and the sign canvases
      // magnify with NEAREST because a smoothed near facade reads as unlit — but this one is
      // ALWAYS magnified (it is rendered at half the canvas and read at full) and it is water, so
      // smoothing is the thing being asked for rather than a thing to be defended against.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fbo = gl.createFramebuffer();
      depth = gl.createRenderbuffer();
    }
    if (w !== tw || h !== th) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { tw = th = 0; return false; }
      tw = w; th = h;
    }
    prevVP = gl.getParameter(gl.VIEWPORT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    // ⚠ TRANSPARENT, AND THE GROUND ADDS WHAT IT FINDS. The reflection is the city's LIGHT lying on
    // water, not a second picture of the city composited over it — so an empty pixel has to
    // contribute exactly nothing rather than a sky colour, and the buffer is premultiplied like
    // every other surface here.
    // ── ⚠ AND THE READ-BACK HAS TO LET GO OF THIS TEXTURE FIRST ────────────────────────────────
    //
    // `ground.js` samples this buffer as `uRefl` on unit 1 and LEAVES IT BOUND — which was harmless
    // for as long as nothing drew into the buffer afterwards. The mass pass does, so the sampler and
    // the render target became the same texture and every draw call in here failed with
    // GL_INVALID_OPERATION: "Feedback loop formed between Framebuffer and active Texture". 256 of
    // them in a frame, and a failed draw draws NOTHING — so the reflection quietly emptied.
    //
    // ⚠ IT IS CLEARED HERE RATHER THAN AFTER THE SAMPLE, because this is the function that knows the
    // buffer is about to become a target. Unbinding at the end of `drawGround` would work today and
    // would be one more thing for the next pass that renders in here to remember.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // ⚠ DEPTH TEST ON, AND THE ATTACHMENT IS WHY. This read: no depth attachment, so a test here
    // reads undefined state, and the sprite and decal layers both enable it themselves and are both
    // left believing they are testing against the mass. They are testing against it now — a sign
    // behind a reflected tower is behind it in the water, which was the stated limit of this pass.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  // Hand the context back exactly as it was found: unbound, depth testing on, and the viewport the
  // caller had. `draw()` re-establishes all three a moment later, which is belt and braces rather
  // than a reason to skip it — this layer is also reachable from a bench that does not call `draw`.
  function release() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    if (prevVP) gl.viewport(prevVP[0], prevVP[1], prevVP[2], prevVP[3]);
    prevVP = null;
  }

  // ── WHAT IS ACTUALLY IN IT ──────────────────────────────────────────────────
  //
  // ⚠ AN EMPTY REFLECTION BUFFER AND A DEAD READ-BACK LOOK IDENTICAL FROM THE ROAD, and the whole
  // A/B says so: with nothing in the texture, raising the gain multiplies zero and every row of the
  // sweep comes back the same. That is a feature correctly wired at both ends doing nothing, which
  // is the failure `install.js` keeps a numbered list of — and no gate downstream can see it,
  // because the road still reflects, using the smear.
  //
  // So: read the buffer. `readPixels` stalls the pipeline, which is why it is a probe a bench asks
  // for rather than something the frame reports. Sampled on a grid rather than exhaustively —
  // finding out whether the city is in there at all does not need every pixel.
  function peak(step = 4) {
    if (!tw) return null;
    const px = new Uint8Array(tw * th * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let max = 0, lit = 0, n = 0;
    for (let y = 0; y < th; y += step) {
      for (let x = 0; x < tw; x += step) {
        const i = (y * tw + x) * 4;
        const m = Math.max(px[i], px[i + 1], px[i + 2]);
        if (m > max) max = m;
        if (m >= 4) lit++;
        n++;
      }
    }
    return { max, litPct: n ? +(lit / n * 100).toFixed(2) : 0, w: tw, h: th, sampled: n };
  }

  return {
    bind,
    release,
    peak,
    get texture() { return tw ? tex : null; },
    get size() { return [tw, th]; },
  };
}
