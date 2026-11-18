// A CAT, HEARD (docs/proposals/pets.md, "Talking"). What each clip sounds like is on the clip (gl/cat-clips.js `sound`):
// a bed under it while it plays (a purr, the snore, the licking of a groom) and calls at moments in it (a meow while
// he waits for you, the chatter at a bird, a growl when he's had enough). The sounds are CC0 recordings
// (client/shared/field-recordings.js, `cat_*`), played where the cat is, so they come from his side of the room and
// get quieter across it.
//
// Each cat has his own voice (voiceOf): two meows of his own out of the meow recordings (one cat in five squeaks, with
// a kitten's), his own trill, chirp, yowl and hiss, his own purr, and a pitch of his own, lower for a big cat. A clip
// asks for a kind of call; the cat answers in his voice. The cross and grumpy meows stay as the clip asks: everybody's
// sound alike cross.
//
// The mouth (mouth(id)): while a call plays, how loud the recording is at that moment, read off the decoded sound
// (AudioEngine.sampleEnvelope), opens his mouth as far as that kind of call does: wide for a meow or a hiss, a little
// for a chirp, hardly at all for a trill or a growl. gl/room-beasts.js puts it on the cat's motion as `mo.mouth`.
//
// Which call and which slice of it are hashed from the cat, the clip and the loop it's on, so two people in the room
// hear the same meow. Nothing reaches the server.
//
// ⚠ A VIEW'S SOUND: stop() takes every loop with it, or a closed room keeps purring.
import { FIELD, fieldBed, fieldCall, fieldIds } from '../../../shared/field-recordings.js';
import { CAT_CLIPS } from './gl/cat-clips.js';

// how loud, in LUFS: a purr is felt more than heard; a meow is meant for you
const BED_LUFS = -22, CALL_LUFS = -15;
// metres: a cat's voice at its own level a metre and a half off, falling off past it
const REF_M = 1.5, MAX_M = 25;
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return h >>> 0; };
const CAT_KEYS = Object.keys(FIELD).filter((k) => k.startsWith('cat_'));

// the kinds of call a cat makes in his own voice, and every recording of each
const CROSS = new Set(['cat_meow_cross', 'cat_meow_grumpy']);
const FAMILY = (k) => {
  if (CROSS.has(k)) return null;
  if (k.startsWith('cat_mew_')) return 'mew';
  const m = /^cat_(meow|trill|chirp|yowl|hiss|purr)(?:_|$)/.exec(k);
  if (!m) return null;
  if (m[1] === 'purr') return FIELD[k]?.loop ? 'purrBed' : null;
  return m[1];
};
const POOLS = {};
for (const k of CAT_KEYS) { const f = FAMILY(k); if (f) (POOLS[f] ||= []).push(k); }
// how far each kind of call opens the mouth at its loudest
const OPEN = { meow: 1, mew: 1, yowl: 1, hiss: 0.95, chirp: 0.45, chatter: 0.55, sneeze: 0.5, growl: 0.2, trill: 0.12 };
const openOf = (k) => { const m = /^cat_(meow|mew|yowl|hiss|chirp|chatter|sneeze|growl|trill)/.exec(k); return m ? OPEN[m[1]] : 0; };

// n distinct picks out of a pool, from a seed
function pick(pool, n, h) {
  const left = [...(pool || [])], out = [];
  for (let i = 0; i < n && left.length; i++) out.push(left.splice((h >>> (i * 5)) % left.length, 1)[0]);
  return out;
}
const _voices = new Map();
/** A cat's own voice, the same for everybody from his id and his look: { own: { family: [keys] }, rate }. */
export function voiceOf(id, look = {}) {
  let v = _voices.get(id);
  if (v) return v;
  const h = hash('voice:' + id), own = {};
  const squeak = h % 5 === 0;
  own.meow = squeak ? pick(POOLS.mew, 2, h >>> 3) : pick(POOLS.meow, 2, h >>> 3);
  for (const f of ['trill', 'chirp', 'yowl', 'hiss', 'purrBed']) own[f] = pick(POOLS[f], 1, hash(f + ':' + id));
  // a big cat's voice is lower: the breeds run 0.6 to 0.78 of the house scale; then a few per cent either way of his own
  const size = Math.pow(0.66 / (look.scale || 0.66), 0.4);
  v = { own, rate: size * (0.92 + (h % 17) / 100) * (squeak ? 1.06 : 1) };
  _voices.set(id, v);
  if (_voices.size > 64) _voices.delete(_voices.keys().next().value);
  return v;
}
// what this cat says for a key the clip asked for: his own of that kind, or the key itself
function inVoice(v, key, h) {
  let f = FAMILY(key);
  if (f === 'mew') f = 'meow';
  const mine = f && v.own[f];
  return mine?.length ? mine[h % mine.length] : key;
}

export function createCatSound() {
  const eng = () => window.AudioEngine;
  const beds = new Map();     // cat id -> { key, id, pos }
  const heard = new Map();    // cat id + call index -> the last loop it was played on
  const talk = new Map();     // cat id -> the call he's making now: { t0, sample, offset, length, rate, open, env }, and the mouth
  let preloaded = false;
  const now = () => performance.now() / 1000;

  function bed(cat, key, gain) {
    const A = eng(), had = beds.get(cat.id);
    if (had && had.key !== key) { A.stopLoop(had.id); beds.delete(cat.id); }
    if (!key) return;
    const at = { position: cat.pos, rolloff: 1, ref: REF_M, maxDistance: MAX_M, doppler: false };
    if (!beds.has(cat.id)) {
      const v = voiceOf(cat.id, cat.look);
      const layer = fieldBed(inVoice(v, key, 0), BED_LUFS);
      if (!layer) return;
      const id = `cat:${cat.id}:bed`;
      A.loopSound({ id, category: 'ambient', priority: 2, config: { gain: 1, layers: [{ ...layer, rate: v.rate, gain: layer.gain * gain }] } }, { whole: true, gain: 1, ...at });
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
    const v = voiceOf(cat.id, cat.look);
    const key = inVoice(v, spec.keys[h % spec.keys.length], h >>> 11);
    const rate = v.rate * (0.98 + ((h >> 9) % 5) / 100);
    const layer = fieldCall(key, h >> 4, CALL_LUFS, { rate });
    if (!layer) return;
    layer.gain *= spec.gain ?? 1;
    const def = { id: `cat:${key}`, category: 'sfx', priority: 4, config: { duration: layer.length / rate + 0.1, layers: [layer] } };
    // from his head, not his feet
    eng().playSfx(def, 1, { position: [cat.pos[0], cat.pos[1] + 0.22, cat.pos[2]], rolloff: 1, ref: REF_M, maxDistance: MAX_M, doppler: false });
    const open = openOf(key) * Math.min(1, 0.6 + (spec.gain ?? 1) * 0.5);
    const was = talk.get(cat.id);
    if (open > 0) talk.set(cat.id, { t0: now(), sample: layer.sample, offset: layer.offset, length: layer.length, rate, open, env: null, m: was?.m || 0, at: was?.at || now() });
  }

  const HOP = 0.02;
  return {
    /**
     * How open a cat's mouth is now, 0..1, for the call he's making: the recording's loudness at this moment, eased
     * (it opens quicker than it shuts). Once a frame a cat; 0 when he's quiet.
     */
    mouth(id) {
      const c = talk.get(id);
      if (!c) return 0;
      const t = now(), dt = Math.min(0.1, Math.max(0, t - c.at)); c.at = t;
      const u = (t - c.t0) * c.rate;
      let want = 0;
      if (u < c.length) {
        c.env ||= eng()?.sampleEnvelope?.(c.sample, c.offset, c.length, HOP) || null;
        // not decoded yet: open on a meow's shape, up, held, and down
        const e = c.env ? c.env[Math.min(c.env.length - 1, Math.floor(u / HOP))] : Math.sin(Math.PI * Math.min(1, u / c.length));
        want = c.open * Math.pow(Math.max(0, Math.min(1, (e - 0.08) / 0.6)), 0.7);
      }
      c.m += (want - c.m) * (1 - Math.exp(-(want > c.m ? 40 : 14) * dt));
      if (u >= c.length && c.m < 0.01) { talk.delete(id); return 0; }
      return c.m;
    },
    /**
     * Once a frame. `cats` is [{ id, clip, t (seconds into the clip), pos [x, y, z] in the room's world, look }].
     * A clip's calls go once a loop (at `at` seconds into it), or every `every` seconds for one that doesn't loop,
     * only between `from` and `to` seconds into it when it says (the tray's scratching: while he digs, and while he
     * covers, not through the squat).
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
          if (spec.every) {
            if (cat.t < (spec.from ?? 0) || cat.t > (spec.to ?? Infinity)) return;
            loop = Math.floor((cat.t - (spec.from ?? 0)) / spec.every);
          }
          else if (c.len && !c.once) { const n = Math.floor(cat.t / c.len), into = cat.t - n * c.len; loop = into >= (spec.at || 0) ? n : n - 1; }
          else loop = cat.t >= (spec.at || 0) ? 0 : -1;
          if (loop >= 0) call(cat, spec, i, cat.since + ':' + loop);
        });
      }
      for (const [id, b] of beds) if (!here.has(id)) { A.stopLoop(b.id); beds.delete(id); }
      for (const id of talk.keys()) if (!here.has(id)) talk.delete(id);
      if (heard.size > 200) heard.clear();
    },
    stop() {
      for (const b of beds.values()) eng()?.stopLoop?.(b.id);
      beds.clear(); heard.clear(); talk.clear();
    },
  };
}
