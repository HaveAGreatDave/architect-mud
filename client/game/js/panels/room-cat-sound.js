// A CAT, HEARD (docs/proposals/pets.md, "Talking"). What each clip sounds like is on the clip (gl/cat-clips.js `sound`):
// a bed under it while it plays (a purr, the snore, the licking of a groom) and calls at moments in it (a meow while
// he waits for you, the chatter at a bird, a growl when he's had enough). The sounds are CC0 recordings
// (client/shared/field-recordings.js, `cat_*`), played where the cat is, so they come from his side of the room and
// get quieter across it.
//
// Which call and which slice of it are hashed from the cat, the clip and the loop it's on, so two people in the room
// hear the same meow. Nothing reaches the server.
//
// ⚠ A VIEW'S SOUND: stop() takes every loop with it, or a closed room keeps purring.
import { FIELD, fieldBed, fieldCall, fieldIds } from '../../../shared/field-recordings.js';
import { CAT_CLIPS } from './gl/cat-clips.js';

// how loud, in LUFS: a purr is felt more than heard; a meow is meant for you
const BED_LUFS = -27, CALL_LUFS = -19;
// metres: a cat's voice at its own level a metre and a half off, falling off past it
const REF_M = 1.5, MAX_M = 25;
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const CAT_KEYS = Object.keys(FIELD).filter((k) => k.startsWith('cat_'));

export function createCatSound() {
  const eng = () => window.AudioEngine;
  const beds = new Map();     // cat id -> { key, id, pos }
  const heard = new Map();    // cat id + call index -> the last loop it was played on
  let preloaded = false;

  function bed(cat, key, gain) {
    const A = eng(), had = beds.get(cat.id);
    if (had && had.key !== key) { A.stopLoop(had.id); beds.delete(cat.id); }
    if (!key) return;
    const at = { position: cat.pos, rolloff: 1, ref: REF_M, maxDistance: MAX_M, doppler: false };
    if (!beds.has(cat.id)) {
      const layer = fieldBed(key, BED_LUFS);
      if (!layer) return;
      const id = `cat:${cat.id}:bed`;
      A.loopSound({ id, category: 'ambient', priority: 2, config: { gain: 1, layers: [{ ...layer, gain: layer.gain * gain }] } }, { whole: true, gain: 1, ...at });
      beds.set(cat.id, { key, id, pos: cat.pos.join() });
      return;
    }
    const b = beds.get(cat.id);
    if (cat.pos.join() !== b.pos) { A.moveLoop?.(b.id, cat.pos); b.pos = cat.pos.join(); }
  }

  function call(cat, spec, i, loop) {
    const k = cat.id + ':' + cat.clip + ':' + i;
    if (heard.get(k) === loop) return;
    heard.set(k, loop);
    const h = hash(k + ':' + loop);
    if (spec.p != null && (h % 1000) / 1000 >= spec.p) return;
    const key = spec.keys[h % spec.keys.length];
    const layer = fieldCall(key, h >> 4, CALL_LUFS, { rate: 0.96 + ((h >> 9) % 9) / 100 });
    if (!layer) return;
    layer.gain *= spec.gain ?? 1;
    const def = { id: `cat:${key}`, category: 'sfx', priority: 4, config: { duration: layer.length / (layer.rate || 1) + 0.1, layers: [layer] } };
    // from his head, not his feet
    eng().playSfx(def, 1, { position: [cat.pos[0], cat.pos[1] + 0.22, cat.pos[2]], rolloff: 1, ref: REF_M, maxDistance: MAX_M, doppler: false });
  }

  return {
    /**
     * Once a frame. `cats` is [{ id, clip, t (seconds into the clip), pos [x, y, z] in the room's world }].
     * A clip's calls go once a loop (at `at` seconds into it), or every `every` seconds for one that doesn't loop.
     */
    tick(cats) {
      const A = eng();
      if (!A?.loopSound) return;
      if (!preloaded && cats.length) { preloaded = true; A.preloadSamples?.(fieldIds(CAT_KEYS)); }
      const here = new Set();
      for (const cat of cats) {
        here.add(cat.id);
        const c = CAT_CLIPS[cat.clip], s = c?.sound;
        bed(cat, s?.bed || null, s?.gain ?? 1);
        (s?.calls || []).forEach((spec, i) => {
          let loop;
          if (spec.every) loop = Math.floor(cat.t / spec.every);
          else if (c.len && !c.once) { const n = Math.floor(cat.t / c.len), into = cat.t - n * c.len; loop = into >= (spec.at || 0) ? n : n - 1; }
          else loop = cat.t >= (spec.at || 0) ? 0 : -1;
          if (loop >= 0) call(cat, spec, i, cat.since + ':' + loop);
        });
      }
      for (const [id, b] of beds) if (!here.has(id)) { A.stopLoop(b.id); beds.delete(id); }
      if (heard.size > 200) heard.clear();
    },
    stop() {
      for (const b of beds.values()) eng()?.stopLoop?.(b.id);
      beds.clear(); heard.clear();
    },
  };
}
