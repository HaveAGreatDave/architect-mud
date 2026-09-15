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
  let tex = null, fbo = null, tw = 0, th = 0;
  let prevVP = null;

  // ⚠ NO DEPTH ATTACHMENT, AND THAT IS A STATED LIMIT. The mass is not re-rendered into this
  // buffer, so there is nothing for a depth test to test against — every sign reaches the water,
  // including one standing behind a tower. Adding the mass would fix it and would also double the
  // largest buffer in the frame for a surface that is already multiplied down to a few per cent.
  // The honest version of that trade is: a puddle can show you a sign the building in front of you
  // is hiding. Fixing it is a second mass draw, not a tweak.
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
    }
    if (w !== tw || h !== th) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
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
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // ⚠ DEPTH TEST OFF, NOT JUST UNWRITTEN. There is no depth attachment, so a test here reads
    // undefined state; the sprite and decal layers both enable it themselves and both are left
    // believing they are testing against the mass.
    gl.disable(gl.DEPTH_TEST);
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
