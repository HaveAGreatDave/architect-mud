// The street on foot's camera and draw rings, in one place so the street view (freelook-view.js) and the
// Modelshop's on-foot bench route (tools/modelshop/route.js) draw the same city. Plain numbers, no imports.

// A standing eye, 1.6 m against a 3.5 m storey (windshield.js ACTOR_S). It was 0.12, about 2.2 m.
export const FPS_EYE = 0.09;
// A metre in tiles: FPS_EYE is 1.6 m.
export const METRE = FPS_EYE / 1.6;
// On foot the near plane comes in to a third of a metre, so people stay whole as you walk up to them.
export const FOOT_NEAR = 0.3 * METRE;

// ON FOOT IS NOT A VANTAGE. On foot is standing too (freeCam.standing), so it picked up STAND_TUNE and drew
// the telescope's city: full models out to 32 tiles and every ring wider than a cab's, round an eye 1.6 m up
// a street whose own fronts hide most of that. So walking gets rings between the window view's (room-view.js
// TUNE) and a cab's: the near street at full detail, the far city as the governor leaves it. The city past
// 14 tiles is the skyline backdrop (farMax): perf:move --room 0 --gl --lite, turning, 41.7 ms a frame to 35.
export const FOOT_TUNE = { lodNear: 12, decoFar: 12, glowFar: 11, shadowFar: 10, farMax: 14 };
