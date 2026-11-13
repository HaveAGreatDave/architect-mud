// CLOSE-UP FIGURES, BUILT OFF THE MAIN THREAD (figure-ahead.js asks; gl/street-hd.js is who's waiting).
//
// A close-up figure is 50 to 180 ms to build and 20 to 40 ms more for its occlusion. On the street that ran
// the frame somebody first came near enough, and again when they dropped to the lite level, so a walk down a
// busy pavement hitched once a passer-by. Here it's built, its occlusion baked, and posted back as data.
// ⚠ COPIED, NOT MOVED. A figure's arrays may share a buffer with something buildFigure keeps for the next one
// (a head, a hand), and moving it would empty that here. The copy is a few megabytes, a fraction of a
// millisecond on the page; the worker's own is let go once it's sent (figureForget).
import { buildFigure, figureForget } from './figure.js';
import { occlusionOf } from './figure-occlusion.js';

self.onmessage = ({ data: { id, key } }) => {
  try {
    const F = buildFigure(key);
    const out = { ...F, AO: F.AO || occlusionOf(F) };
    figureForget(key);
    self.postMessage({ id, F: out });
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err) });
  }
};
