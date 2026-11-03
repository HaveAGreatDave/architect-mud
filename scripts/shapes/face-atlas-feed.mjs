// GATE · THE FACE ATLAS FEED (client/game/js/panels/gl/face-atlas.js).
//
// The street, the park and the rink each poll a feed for their face atlas, and the comic look swaps
// the plain atlas for the inked one. What has to hold: each renderer gets the atlas for the look
// that's on, once; a look flipped while an image loads never leaves the wrong one up; an image that
// finished before anyone polled still arrives; and the paths are the four FACE_ATLAS names.
//
// A fake Image stands in, so nothing loads. No DOM, no GL, no files written.

import { createFaceAtlasFeed, faceAtlasPath } from '../../client/game/js/panels/gl/face-atlas.js';
import { FACE_ATLAS } from '../../client/game/js/panels/actor-faces.js';

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.error('✗ ' + what); } };

const made = [];
class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; made.push(this); }
  set src(v) { this._src = v; }
  get src() { return this._src; }
  load() { this.complete = true; this.naturalWidth = 2048; this.onload?.(); }
}
const isInk = (img) => /actor-faces-ink/.test(img.src);
const look = (on) => { if (on) globalThis.__houseComic = 1; else delete globalThis.__houseComic; };

check(faceAtlasPath(false, false) === FACE_ATLAS.src && faceAtlasPath(true, false) === FACE_ATLAS.half
  && faceAtlasPath(false, true) === FACE_ATLAS.ink && faceAtlasPath(true, true) === FACE_ATLAS.inkHalf, 'faceAtlasPath names the four atlases');

// off: the plain atlas, handed over once, and onReady told
{
  look(false); made.length = 0;
  let readies = 0;
  const f = createFaceAtlasFeed({ Img: FakeImage, onReady: () => readies++ });
  check(f.poll() === null && made.length === 1 && !isInk(made[0]), 'off: starts loading the plain atlas');
  check(f.poll() === null && made.length === 1, 'off: one load, not one a poll');
  made[0].load();
  check(readies === 1, 'onReady is called when the wanted atlas loads');
  const img = f.poll();
  check(img === made[0] && f.ink === false, 'off: hands over the plain atlas');
  check(f.poll() === null, 'off: hands it over once');

  // on: the inked one replaces it
  look(true);
  check(f.poll() === null && made.length === 2 && isInk(made[1]), 'on: starts loading the inked atlas');
  made[1].load();
  check(f.poll() === made[1] && f.ink === true, 'on: hands over the inked atlas');

  // back off while nothing's loading: the plain one again
  look(false);
  f.poll(); made[2].load();
  check(f.poll() === made[2] && f.ink === false && !isInk(made[2]), 'off again: the plain atlas comes back');

  // on, then off before the inked one loads: nothing to upload, the plain one's still up
  look(true); f.poll();
  look(false); check(f.poll() === null && made.length === 4, 'on then off: no third load while the plain one is up');
  made[3].load();
  check(f.poll() === null && f.ink === false, 'on then off: the late inked atlas is dropped');
}

// a flip before the first atlas ever lands: the stale load is ignored
{
  look(false); made.length = 0;
  const f = createFaceAtlasFeed({ Img: FakeImage });
  f.poll(); look(true); f.poll();
  check(made.length === 2 && isInk(made[1]), 'a flip mid-load starts the other atlas');
  made[0].load();
  check(f.poll() === null, 'the superseded plain load is ignored');
  made[1].load();
  check(f.poll() === made[1] && f.ink === true, 'the inked atlas arrives');
}

// an image already complete (from the cache) before its onload has run
{
  look(false); made.length = 0;
  const f = createFaceAtlasFeed({ Img: FakeImage });
  f.poll(); made[0].complete = true; made[0].naturalWidth = 2048;
  check(f.poll() === made[0], 'a cached, complete image is handed over without onload');
}

// the half atlas, and no Image at all
{
  look(true); made.length = 0;
  createFaceAtlasFeed({ half: true, Img: FakeImage }).poll();
  check(made[0].src.endsWith(FACE_ATLAS.inkHalf), 'half: the half-size inked atlas');
  check(createFaceAtlasFeed({ Img: undefined }).poll() === null, 'no Image: the stand-in stays');
}

look(false);
if (fails) { console.error(`face-atlas-feed: ${fails} failed`); process.exit(1); }
