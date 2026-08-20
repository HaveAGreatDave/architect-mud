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
  // The dissolve now runs from 12 tiles out to 26 and FINISHES before the haze band, instead of
  // starting at 20 and never completing.
  lodNear: 12,
  lodFar: 26,
  // The one that matters most, and the clearest case of an aeroplane's number meaning something
  // else on the ground. Any wall taller than this on screen takes the expensive textured blit.
  // 44px is roughly 4% of screen height — properly distant from a driver's seat — and the flat fill
  // is tone-matched to the texture average, so a wall does not change colour as it crosses over.
  wallLodPx: 44,
  // Rooftop signage and ground shadows go BEHIND the building in front of them long before they go
  // small. That is a thing only a ground camera gets to be true about.
  decoFar: 12,
  shadowFar: 12,
});
