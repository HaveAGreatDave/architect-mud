// GLASS 2 · WHICH FACE ATLAS: the plain one, or the comic look's inked one.
//
// Three renderers draw faces off the baked atlas (actor-faces.js): the street figures
// (gl/actors.js), the park's players (gl/ballpark.js) and the rink's skaters (gl/arena-heads.js).
// The comic look (gl/house-style.js) swaps in the inked atlas, the same masks with ink lines in the
// shade channel, so a face changes look without changing whose face it is.
//
// Each renderer keeps its own texture and its own upload rules. This only decides which image it
// should have and fetches it: call `poll()` once a frame, and when it hands back an image, upload
// that over the texture. It hands back each finished image once. A setting changed while an image
// is loading is caught on the next poll, so a quick off-on-off never strands the wrong atlas.
//
// Nothing swaps until the new image has decoded, so the old faces stay up meanwhile rather than
// going blank. `onReady` is called when an image the renderer wants has loaded, outside any frame,
// so a view that only draws on demand can ask for one; never upload from it, poll in the frame.

import { FACE_ATLAS } from '../actor-faces.js';
import { comicOn } from './house-style.js';

const urlOf = (path) => new URL('../../../' + path, import.meta.url).href;

/** The atlas path for a look. `half` is the half-size atlas the phones and the rink use. */
export const faceAtlasPath = (half, ink) => (ink ? (half ? FACE_ATLAS.inkHalf : FACE_ATLAS.ink) : (half ? FACE_ATLAS.half : FACE_ATLAS.src));

/**
 * A feed of face atlases for one texture. `Img` is the Image constructor (the renderer's document's,
 * or the page's); without one, poll() always returns null and the stand-in texel stays.
 * Returns { poll(): Image | null, ink: boolean | null } — `ink` is the look of the last image handed
 * back, null before the first. `ink: true` asks for the inked atlas whatever the setting (the
 * close-up figure, gl/figure-hd.js, is always drawn in the comic manner).
 */
// One decoded image per (Image constructor, path), shared by every feed, so a renderer made after
// the first has its faces on its first frame instead of fetching them again. `preloadFaceAtlases`
// starts them at page load, before anybody is on screen.
const SHARED = new Map();   // Img -> Map(path -> { img, done, failed, waiters })
function sharedImage(Img, path) {
  let byPath = SHARED.get(Img);
  if (!byPath) SHARED.set(Img, byPath = new Map());
  let e = byPath.get(path);
  if (e) return e;
  const img = new Img();
  e = { img, done: false, failed: false, waiters: new Set() };
  try { img.decoding = 'async'; } catch { /* not every Image has it */ }
  const settle = (failed) => {
    if (e.done || e.settling) return;
    e.settling = true; e.failed = failed;
    const run = () => { e.done = true; for (const w of e.waiters) { try { w(); } catch { /* the next poll picks it up */ } } e.waiters.clear(); };
    // decode() so the first upload isn't a stall on the main thread
    if (!failed && typeof img.decode === 'function') img.decode().then(run, run); else run();
  };
  img.onload = () => settle(false);
  img.onerror = () => settle(true);
  img.src = urlOf(path);
  byPath.set(path, e);
  return e;
}

/** Start every face atlas a view might want, on the page's Image. Safe to call more than once. */
export function preloadFaceAtlases(Img = globalThis.Image) {
  if (typeof Img !== 'function') return;
  for (const half of [false, true]) for (const ink of [false, true]) { try { sharedImage(Img, faceAtlasPath(half, ink)); } catch { /* no DOM */ } }
}
if (typeof document !== 'undefined' && typeof globalThis.Image === 'function') preloadFaceAtlases();

/** How long a view holds its people back waiting for faces before it draws them without. */
export const FACE_WAIT_MS = 8000;

export function createFaceAtlasFeed({ half = false, Img = globalThis.Image, onReady = null, ink: always = null } = {}) {
  let want = null, loading = null, ready = null, given = null;
  const born = Date.now();
  const feed = {
    ink: null,
    /** true once this feed has handed an atlas over, or given up waiting: draw people then. */
    get settled() { return given !== null || typeof Img !== 'function' || (loading && loading.e.failed) || Date.now() - born > FACE_WAIT_MS; },
    poll() {
      if (typeof Img !== 'function') return null;
      const ink = always ?? comicOn();
      if (want !== ink) {
        want = ink;
        if (given !== ink && (!loading || loading.ink !== ink)) {
          const e = sharedImage(Img, faceAtlasPath(half, ink));
          const me = { ink, img: e.img, e };
          loading = me;
          const arrive = () => { if (loading === me) { if (!e.failed) ready = me; loading = e.failed ? me : null; try { onReady?.(); } catch { /* the next frame picks it up anyway */ } } };
          if (e.done) arrive(); else e.waiters.add(arrive);
        }
      }
      // A cached image can be complete before onload has run.
      if (!ready && loading && !loading.e.failed && loading.e.done) { ready = loading; loading = null; }
      if (!ready) return null;
      const r = ready;
      ready = null;
      if (r.ink !== want) return null;   // the setting moved on while it loaded; the next poll fetches the right one
      given = r.ink;
      feed.ink = r.ink;
      return r.img;
    },
  };
  return feed;
}
