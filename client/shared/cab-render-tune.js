// The truck cab's own load-shedding calibration for the flight sim's renderer.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// `RENDER_TUNE` in windshield.js is ONE calibration, and it was written for an aeroplane. Every
// distance knob in it is expressed in TILES, and the two cameras that read those tiles do not agree
// about what one is worth. From a cockpit a building is small and far away: most of its walls fall
// under `wallLodPx` and flat-fill for free, and the LOD ring sits out in the haze where you could
// not see the handover if you looked for it. From a truck cab the camera is ON THE GROUND in a
// dense city — every wall in frame is hundreds of pixels tall, so the expensive perspective-correct
// column-split textured blit runs for essentially all of them.
//
// ⚠ AND THE RING WAS OUTSIDE THE WORLD. The cab asks the server for a 30-tile window (CAB_RADIUS),
// so the renderer draws out to 29 tiles — while `lodFar` ships at 32, calibrated against an aircraft
// asking for 36. Four tiles past the edge of everything a driver can ever see. No building in the
// cab reached the cheap LOD tier at ANY distance, and the full-detail arm ran for the entire visible
// city, every frame. Nothing looked wrong. It was only slow, which is how it lasted.
//
// It lives in client/shared for the same reason cab-trim.js and skyline-scale.js do: TWO sides read
// it and neither should own it. The renderer needs the numbers; the trucking regress suite needs to
// assert they still fit inside CAB_RADIUS, and it cannot import a client panel to find out. One
// definition, so what ships and what is covered cannot drift apart.
//
// ⚠ ONLY KEYS THAT DECIDE HOW MUCH WORK TO SKIP BELONG HERE — see VIEW_TUNABLE in windshield.js,
// which enforces it. Most of RENDER_TUNE is GEOMETRY (bldgFoot, bldgH, eh, fov), and those same
// values are read again OUTSIDE any frame by the collision helpers and the shape capture. A view
// that overrode one of those would draw a building somewhere the solid world does not have one.
export const CAB_VIEW_TUNE = Object.freeze({
  // The dissolve now runs from 9 tiles out to 20 and FINISHES well before the haze band, instead of
  // starting at 20 and never completing. Pulled in from 12/26 once the frame was actually measured:
  // a ground camera in a dense block was still running 222 full model arms every frame, and a
  // building nine tiles down the street is already mostly hidden behind the two in front of it.
  lodNear: 9,
  lodFar: 20,
  // The one that matters most, and the clearest case of an aeroplane's number meaning something
  // else on the ground. Any wall taller than this on screen takes the expensive textured blit.
  // 44px is roughly 4% of screen height — properly distant from a driver's seat — and the flat fill
  // is tone-matched to the texture average, so a wall does not change colour as it crosses over.
  wallLodPx: 44,
  // ── THE GROUND RASTER'S CEILING, WHICH IS THE WHOLE FRAME ──────────────────
  //
  // `pixel` is the Mode-7 floor's texel size in CSS pixels, and profiling the cab found it is not
  // one cost among several — it IS the frame. At the shipped ceiling of 1 (one texel per CSS pixel,
  // set for "the crispest ground the frame will allow") the ground pass alone measures ~165 ms at
  // 1280×720. Nothing pays that, so it never actually ran: `perfDS` saw the long frames and pinned
  // its load-shed at the cap, +4, every frame of every drive. The driver has been looking at a
  // floor rasterised at DS 5 the entire time — CHUNKIER than the 4 this dial used to ship with —
  // while the renderer carried the bookkeeping of a quality setting it could never reach.
  //
  // The damage is not only that it is slow. A ceiling the frame cannot afford turns the adaptive
  // dial into a saturated one, and a saturated dial has no authority left: make anything else in
  // the frame cheaper and the floor immediately spends the gain, so the frame time never improves
  // and no other optimisation can ever show up. That is why the cab could not be made smooth by
  // trimming buildings.
  //
  // 4 is a ceiling this view can actually reach. It is SHARPER than what a driver sees today
  // (DS 4 rather than the pinned 5), it costs about a sixth of the texels, and it leaves `perfDS`
  // somewhere to go — 4 → 8 under real load — instead of starting at its cap. The chunky Mode-7
  // floor is the intended look here, not a concession.
  pixel: 4,
  // ── THE ROAD SURFACE IS THE SUBJECT HERE, NOT THE BACKDROP ─────────────────
  // The Mode-7 ground raster is sized in CSS pixels; everything else in the frame is drawn into a
  // backing store this view deliberately renders ABOVE 1:1 (superSample: 2). From altitude that
  // mismatch is invisible — the ground is a distant carpet and the detail is all in the sky and the
  // skyline. From a cab it is the thing you are staring at: a metre of lane marking, kerb and tile
  // seam filling the bottom half of the windscreen, painted one texel to a 2x2 block of real pixels
  // while the buildings standing on it got every one. That is where "the terrain looks blurry"
  // comes from, and it is a resolution mismatch rather than a filter.
  //
  // ⚠ AND IT IS OFF, BECAUSE MEASURING IT SHOWED IT HAS NEVER ONCE BEEN ON.
  // The argument above is sound and the arithmetic under it is not. This multiplies the whole DS
  // ladder by 1/dpr, so on a supersampling view it asks for FOUR times the texels of a ceiling that
  // already could not be paid for — and `perfDS` answers by pinning at its cap, which is where the
  // dial has sat every frame since. Toggling it on and off in the profiler moves the frame by less
  // than the noise, in both directions: it is inert, and it is the reason the unshed cost is 190 ms
  // rather than 165.
  // The honest version of what it was reaching for is the `pixel` ceiling above — a number this
  // view can afford, so the shed has room to release it when the frame is cheap. Left here rather
  // than deleted because the key is right and a machine that can pay for it may exist later.
  floorSubpixel: 0,
  // Rooftop signage and ground shadows go BEHIND the building in front of them long before they go
  // small. That is a thing only a ground camera gets to be true about.
  decoFar: 12,
  shadowFar: 12,
});
