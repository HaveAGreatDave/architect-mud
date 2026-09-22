// A 2-D context that REMEMBERS WHAT IT WAS ASKED FOR.
//
// The dom-stub's own context is a Proxy that answers everything and records nothing, which is right
// for "did the module load" and useless for "which room did it draw". This is the recording ctx
// `models:diff` uses one idea over: the question is not what the pixels are, it is what the calls
// were. Colours are what separate the three venues, so every colour that lands on `fillStyle` or
// `strokeStyle` and every gradient stop is kept, in order.
//
// ⚠ A GRADIENT'S STOPS ARE THE COLOURS. Almost nothing in these backdrops is a flat fill — the
// water, the sky through the mouth, the deck and the light pools are all gradients — so a recorder
// that only watched `fillStyle` would see a handful of strings and conclude the three rooms were
// identical. `addColorStop` is where the paint actually is.
const GRAD_KEYS = new Set(['createLinearGradient', 'createRadialGradient', 'createConicGradient']);

export function recordingCtx() {
  const ops = [];
  const target = {
    ops,
    canvas: { width: 640, height: 360 },
    measureText: (t) => ({ width: String(t == null ? '' : t).length * 20 }),
  };
  const grad = () => ({ addColorStop: (_p, c) => { ops.push(String(c)); } });
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (GRAD_KEYS.has(k)) return () => grad();
      if (k === 'createPattern') return () => null;
      if (k === 'getImageData' || k === 'createImageData') return (...a) => {
        const [w, h] = a.length >= 4 ? [a[2], a[3]] : [a[0], a[1]];
        const W = Math.max(1, w | 0), H = Math.max(1, h | 0);
        return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
      };
      // ⚠ EVERY OTHER CALL IS RECORDED WITH ITS NUMBERS. A fill colour alone cannot tell a wide
      // mouth from a narrow one — that difference is entirely in the rect — so the op log carries the
      // arguments, rounded, and a backdrop reaching for an API nobody anticipated gets a no-op rather
      // than a TypeError.
      return (...a) => {
        ops.push(k + '(' + a.map((v) => (typeof v === 'number' ? v.toFixed(2) : String(v))).join(',') + ')');
        return undefined;
      };
    },
    set(t, k, v) {
      // ⚠ NUMBERS AND GEOMETRY COUNT TOO. The mouth's width is a rect, not a colour, so a check on
      // "does the open end grow with the traffic" needs the numbers as well as the paint.
      if (k === 'fillStyle' || k === 'strokeStyle') ops.push(String(v));
      else if (typeof v === 'number') ops.push(k + '=' + v.toFixed(3));
      t[k] = v;
      return true;
    },
  });
}
