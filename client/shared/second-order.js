// SECOND-ORDER DYNAMICS: something that follows an input the way a body does, not the way a tween does. After
// t3ssel8r's "Giving Personality to Procedural Animations using Math" (docs/reference/bibliography.md): the follower
// y chases the input x as a mass on a spring with a damper,
//
//     y + k1·y' + k2·y'' = x + k3·x'
//
// set by three numbers a person can feel instead of three coefficients:
//
//   f  frequency, Hz: how fast it answers (and how fast it shakes if it shakes)
//   z  damping ratio ζ: 0 rings forever, under 1 overshoots and settles, 1 just arrives, over 1 lags in
//   r  response: 0 eases off the mark, 1 moves with the input at once, over 1 overshoots it, under 0 winds up the
//      other way first (anticipation)
//
// with k1 = z / (π f), k2 = 1 / (2π f)², k3 = r·z / (2π f). The step is semi-implicit Euler with k2 held above what
// the step size can carry (k2 ≥ T²/2 + T·k1/2 and ≥ T·k1), so a slow frame never blows it up.
//
// Generic THOMAS code: nothing here knows a cat. A scalar, a vector of any length, and an angle (which takes the short
// way round).

function coeffs(f, z, r) {
  const w = 2 * Math.PI * Math.max(1e-3, f);
  return { k1: z / (Math.PI * Math.max(1e-3, f)), k2: 1 / (w * w), k3: (r * z) / w };
}

export class SecondOrder {
  /** `x0`: the starting value, a number or an array. */
  constructor(f, z, r, x0 = 0) {
    this.set(f, z, r);
    this.vec = Array.isArray(x0);
    this.xp = this.vec ? x0.slice() : x0;
    this.y = this.vec ? x0.slice() : x0;
    this.yd = this.vec ? x0.map(() => 0) : 0;
  }
  set(f, z, r) { Object.assign(this, coeffs(f, z, r), { f, z, r }); return this; }
  /** Put it at `x` and still. */
  reset(x) {
    this.xp = this.vec ? x.slice() : x; this.y = this.vec ? x.slice() : x; this.yd = this.vec ? x.map(() => 0) : 0;
    return this.y;
  }
  /** Step `T` seconds toward `x` (its rate `xd`, worked out from the last input if not given). Returns y. */
  update(T, x, xd) {
    if (!(T > 0)) return this.y;
    const k2 = Math.max(this.k2, (T * T) / 2 + (T * this.k1) / 2, T * this.k1);
    if (!this.vec) {
      const v = xd ?? (x - this.xp) / T;
      this.xp = x;
      this.y += T * this.yd;
      this.yd += (T * (x + this.k3 * v - this.y - this.k1 * this.yd)) / k2;
      return this.y;
    }
    for (let i = 0; i < x.length; i++) {
      const v = xd ? xd[i] : (x[i] - this.xp[i]) / T;
      this.xp[i] = x[i];
      this.y[i] += T * this.yd[i];
      this.yd[i] += (T * (x[i] + this.k3 * v - this.y[i] - this.k1 * this.yd[i])) / k2;
    }
    return this.y;
  }
  /** Give it a push: its rate goes up by `v` (a landing's thump, a flinch). */
  kick(v) { if (this.vec) for (let i = 0; i < v.length; i++) this.yd[i] += v[i]; else this.yd += v; }
}

/** An angle, radians: the input is unwrapped next to where it is, so it turns the short way and never spins. */
export class SecondOrderAngle extends SecondOrder {
  update(T, x, xd) {
    const near = this.xp + Math.atan2(Math.sin(x - this.xp), Math.cos(x - this.xp));
    return super.update(T, near, xd);
  }
}
