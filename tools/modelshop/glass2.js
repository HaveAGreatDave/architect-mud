// THE VIEWPORT THROUGH GLASS 2: the subject drawn by the game's own frame.
//
// The main viewport paints with the 2-D renderer (renderModelPreview / renderVehiclePreview), which
// is GLASS 1. The game has drawn with GLASS 2 since 2026-09-09, so what the viewport showed was not
// what a player sees: no material table, no sun shadow map, no SSAO, no env reflections, no clear
// coat on a vehicle's paint, no bloom, no lights at night. This draws the same subject, from the same
// orbit, through `paintWindshield` with GLASS 2 installed, exactly as seatShot and __street do.
//
// It is an overlay. The 2-D pass still runs underneath, because the cage, the selection, the pick
// test and the HUD all read its camera; this canvas lies on top of it and takes no pointer events,
// so every click and drag still lands on the 2-D view and does what it always did.
//
// How the subject gets into the frame:
//   a building  a small flat map with the subject on the centre tile. The tile names it, and the
//               name is bound in NAMED_MODELS to the record the editor holds, so an unsaved edit is
//               what GLASS 2 draws. Each edit generation is a new name, so no cache keyed on the
//               name can hand back the last one.
//   a vehicle   the own ship, at the map centre: the path the game draws your own craft by, with
//               its livery, its animation channels and its gear.
// The camera is the renderer's free camera (`freeCam`), placed where the orbit puts the eye.

import { paintWindshield, RENDER_TUNE, ownExtMul, viewFocal } from '/client/game/js/panels/windshield.js';
import { NAMED_MODELS, bldgSlug } from '/client/game/js/panels/glass/model-registry.js';
import { installGL, glLastFrame } from '/client/game/js/panels/gl/install.js';

const ID = '__glass2_view';
const R = 14, N = R * 2 + 1;
let canvas = null, uninstall = null, gen = 0, lastName = null;

// The overlay lies exactly over the viewport canvas and directly after it in the page, so the
// toolbar and the palettes, which come later, stay on top of it. Sized to the viewport rather than
// to the stage: the lens below is solved off this canvas's own width and height.
function ensureCanvas(view) {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = ID;
    canvas.style.cssText = 'position:absolute;pointer-events:none';
  }
  if (canvas.previousElementSibling !== view) view.after(canvas);
  Object.assign(canvas.style, { left: view.offsetLeft + 'px', top: view.offsetTop + 'px', width: view.clientWidth + 'px', height: view.clientHeight + 'px' });
  if (!uninstall) uninstall = installGL(() => document.getElementById(ID));
  return canvas;
}

// Flat open ground round the subject: what the 2-D preview stands it on, with a road behind so the
// ground pass has something to draw besides grass.
function groundMap(centre) {
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    if (x === R && y === R) return centre || { kind: 'land', biome: 'citycore', flr: 0 };
    if (y === R + 2) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ew', flr: 0, pw: 1 };
    return { kind: 'land', biome: 'citycore', flr: 0 };
  }));
}

/** A new binding for the record being edited. Call when the edit changes. */
export function g2Invalidate() { gen++; }

// The orbit, as the free camera. The 2-D preview stands the camera at the origin and the subject
// `dist` tiles out along `heading`; here the subject is at the map centre, so the camera stands
// `dist` back from it. `pitch` tips the 2-D camera down when positive; the free camera's pitch is
// up-positive, in radians.
// ⚠ AND THE PREVIEW'S HORIZON IS NOT MID-FRAME. It puts the horizon at 0.42 of the height plus the
// pan; the game's free camera turns about mid-frame, so the difference is a little more look-down,
// folded into the pitch, in the camera's own vertical scale.
function freeCamOf(o, k = 1) {
  const h = (o.heading || 0) * Math.PI / 180;
  const d = (o.dist || 9) * k;
  const lift = Math.atan(((o.panY || 0) - 0.08 * o.H) / (0.55 * o.H));
  return {
    x: -Math.sin(h) * d, y: Math.cos(h) * d, z: Math.max(0.02, (o.eye ?? 1.4) * k),
    yaw: o.heading || 0, pitch: lift - (o.pitch || 0), roll: 0, fov: o.fov || 1,
  };
}

/**
 * Draw `subject` through GLASS 2 over the 2-D viewport canvas `view2d`. `subject` is { kind: 'building', m, floors, seed,
 * entrance } or { kind: 'vehicle', cls, variant, armed, livery, anim, gearAnim, sizeMul }.
 * `orbit` is the viewport's own state: heading (deg), dist, eye, pitch (rad, down-positive).
 * Returns what the frame drew, for the HUD.
 */
export function g2Draw(view2d, subject, orbit, opts = {}) {
  const cv = ensureCanvas(view2d);
  const w = view2d.width, h = view2d.height;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  cv.hidden = false;
  // The same lens as the 2-D preview: its vertical scale is H·0.55, the game's is viewFocal·fov.
  // In the 2-D canvas's own pixels, which is the backing store both are drawn at.
  orbit = { ...orbit, fov: (h * 0.55) / viewFocal(w, h), H: h, panY: (orbit.panY || 0) };
  const hour = opts.hour ?? (orbit.night > 0.5 ? 23 : 13);
  const weather = opts.weather || 'clear';
  let view;
  if (subject.kind === 'vehicle') {
    // The 2-D preview draws the craft `sizeMul` times its contact size so it fills the frame; the
    // game draws your own craft at ownExtMul. Same picture, so the camera comes in by the ratio.
    const k = ownExtMul(subject.cls) / Math.max(1e-6, subject.sizeMul || 1);
    view = {
      cls: subject.cls, variant: subject.variant || '', armed: !!subject.armed,
      ...(subject.livery ? { livery: subject.livery } : {}),
      anim: subject.anim || null, gearAnim: subject.gearAnim ?? 1,
      ...(subject.extra || {}),
      map: groundMap(), heading: 0,
      external: true, freeCam: freeCamOf(orbit, k),
    };
  } else {
    // A name nobody else uses, new per edit, bound to the record the editor is holding.
    const name = 'modelshop preview ' + gen;
    const slug = bldgSlug(name);
    if (lastName && lastName !== slug) delete NAMED_MODELS[lastName];
    NAMED_MODELS[slug] = subject.m;
    lastName = slug;
    const centre = { kind: 'land', biome: 'citycore', bt: subject.m?.type || 'shop', bn: name,
      ent: subject.entrance || 'south', flr: subject.floors || 4, pw: 1 };
    view = { cls: 'prop', map: groundMap(centre), heading: 0, external: true, hideOwnShip: true, freeCam: freeCamOf(orbit) };
  }
  const keep = { gl: RENDER_TUNE.gl, glFloor: RENDER_TUNE.glFloor, armKeep: RENDER_TUNE.armKeep };
  RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
  // Kept arms replay what was recorded the first time a key was drawn; an edit has to be redrawn.
  RENDER_TUNE.armKeep = 0;
  try {
    paintWindshield(ID, {
      phase: 'cruise', worldBlend: 1, height: 0, speed: 0, hour, weather,
      mapCenter: { x: 0, y: 0 }, mapOffset: { x: 0, y: 0 }, tune: { gl: 1 },
      ...view,
    });
  } finally { Object.assign(RENDER_TUNE, keep); }
  const L = glLastFrame() || {};
  const faces = (L.faces || 0) + (L.ship || 0) + (L.solids || 0);
  return { faces, lights: L.lights || 0, gl: faces > 0 };
}

export function g2Hide() { if (canvas) canvas.hidden = true; }
