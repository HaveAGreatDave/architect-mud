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
 * back, null before the first.
 */
export function createFaceAtlasFeed({ half = false, Img = globalThis.Image, onReady = null } = {}) {
  let want = null, loading = null, ready = null, given = null;
  const feed = {
    ink: null,
    poll() {
      if (typeof Img !== 'function') return null;
      const ink = comicOn();
      if (want !== ink) {
        want = ink;
        if (given !== ink && (!loading || loading.ink !== ink)) {
          const img = new Img();
          loading = { ink, img };
          try { img.decoding = 'async'; } catch { /* not every Image has it */ }
          img.onload = () => { if (loading && loading.img === img) { ready = loading; loading = null; try { onReady?.(); } catch { /* the next frame picks it up anyway */ } } };
          img.onerror = () => { if (loading && loading.img === img) loading = null; };
          img.src = urlOf(faceAtlasPath(half, ink));
        }
      }
      // A cached image can be complete before onload has run.
      if (!ready && loading && loading.img.complete && loading.img.naturalWidth > 0) { ready = loading; loading = null; }
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
