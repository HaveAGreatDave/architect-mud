"""twin.py: a differentiable twin of ORACLE's worklet (client/shared/oracle-worklet.js).

It reads the same 24 tracks and per-line constants `k` the worklet reads, and makes the
same sound closely enough that a network trained through it plays the real worklet the
same way. What it keeps and what it drops:

  source     the LF pulse, from Rd and the tilt track exactly as cycle() derives it, with
             te, tp, ta, eps and alpha solved per 5 ms frame instead of per period. The
             bisection for alpha runs without gradient and three Newton steps after it
             carry the gradient (the implicit-function trick). No jitter, shimmer, creak
             or growl: they're random per cycle, and a spectral loss can't see them.
  aspiration noise into the tract, pulsed by the glottal phase as the worklet pulses it.
  tract      the cascade (nasal pair, tracheal pairs, F1 to F5), pre-emphasis, the closure
             crossfade to F1 alone, as their analytic frequency responses, applied frame
             by frame by STFT and overlap-add. Source-tract interaction (F1 following the
             glottis inside a period) is left out.
  frication  the doubled band-pass beside the flat high-pass, the one-pole top cut, pulsed
             under voicing.
  presence   the 3 kHz peak synth.mjs puts after the worklet.

All in float32 on whatever device the tensors are on. `render(tracks, k)` takes tracks as
a (frames, 24) tensor and returns a waveform tensor.
"""
import math
import torch

TRACK = ['f0', 'jitA', 'jitB', 'av', 'ah', 'af', 'f1', 'f2', 'f3', 'f4', 'q1', 'q2', 'q3', 'q4',
         'nf', 'nq', 'nzf', 'nzdb', 'tilt', 'closure', 'rd', 'creak', 'fb', 'ff']
IX = {k: i for i, k in enumerate(TRACK)}
TAU = 2 * math.pi
NFFT, HOP = 2048, 240


def lf_from_rd(rd):
    ra = (-1 + 4.8 * rd) / 100
    rk = (22.4 + 11.8 * rd) / 100
    rg = rk / (4 * (0.11 * rd / (0.5 + 1.2 * rk) - ra))
    tp = 1 / (2 * rg)
    return tp * (1 + rk), tp, ra


def lf_solve(te, tp, ta):
    """eps, eD, alpha, wg, E0 per frame (tensors), as lfSolve() in the worklet."""
    D = 1 - te
    eps = 1 / ta
    for _ in range(12):
        e = torch.exp(-eps * D)
        f = eps * ta - 1 + e
        df = ta - D * e
        eps = torch.clamp(eps - f / df, min=1e-3)
    eD = torch.exp(-eps * D)
    ret = -(1 / (eps * ta)) * ((1 - eD) / eps - D * eD)
    wg = math.pi / tp
    swe, cwe = torch.sin(wg * te), torch.cos(wg * te)

    def open_area(a):
        ea = torch.exp(a * te)
        E0 = -1 / (ea * swe)
        return E0 * (ea * (a * swe - wg * cwe) + wg) / (a * a + wg * wg)

    with torch.no_grad():
        lo, hi = torch.full_like(te, -40.0), torch.full_like(te, 120.0)
        for _ in range(40):
            m = (lo + hi) / 2
            up = (open_area(m) + ret) > 0
            lo, hi = torch.where(up, m, lo), torch.where(up, hi, m)
        a0 = (lo + hi) / 2
    alpha = a0
    for _ in range(3):   # Newton with grad: d(open)/d(alpha) by autograd would loop; finite difference is enough
        h = 1e-3
        g = open_area(alpha) + ret
        dg = (open_area(alpha + h) - open_area(alpha - h)) / (2 * h)
        alpha = alpha - g / dg
    E0 = -1 / (torch.exp(alpha * te) * swe)
    return eps, eD, alpha, wg, E0


def lf_at(x, te, ta, eps, eD, alpha, wg, E0):
    xo = torch.minimum(x, te)
    op = E0 * torch.exp(alpha * xo) * torch.sin(wg * xo)
    rt = -(1 / (eps * ta)) * (torch.exp(-eps * torch.clamp(x - te, min=0)) - eD)
    return torch.where(x < te, op, rt)


def reson_h(f, bw, w):
    """Klatt resonator response at angular frequencies w (bins), per frame: (F, B) complex."""
    T = 1.0
    r = torch.exp(-math.pi * bw)
    c = -r * r
    b = 2 * r * torch.cos(TAU * f)
    a = 1 - b - c
    z1 = torch.exp(-1j * w)
    return a[:, None] / (1 - b[:, None] * z1 - c[:, None] * z1 * z1)


def biquad_h(b0, b1, b2, a1, a2, w):
    z1 = torch.exp(-1j * w)
    return (b0 + b1 * z1 + b2 * z1 * z1) / (1 + a1 * z1 + a2 * z1 * z1)


def upsample(tr, frame, sr, n):
    """Track values at every sample, linear between frames (the worklet's at())."""
    fx = torch.arange(n, device=tr.device, dtype=tr.dtype) / sr / frame
    i0 = torch.clamp(fx.floor().long(), 0, tr.shape[0] - 1)
    i1 = torch.clamp(i0 + 1, max=tr.shape[0] - 1)
    u = (fx - i0.to(tr.dtype)).clamp(0, 1)[:, None]
    return tr[i0] * (1 - u) + tr[i1] * u


def at_frames(tr, frame, sr, times):
    fx = times / frame
    i0 = torch.clamp(fx.floor().long(), 0, tr.shape[0] - 1)
    i1 = torch.clamp(i0 + 1, max=tr.shape[0] - 1)
    u = (fx - i0.to(tr.dtype)).clamp(0, 1)[:, None]
    return tr[i0] * (1 - u) + tr[i1] * u


def stft(x):
    return torch.stft(x, NFFT, HOP, window=torch.hann_window(NFFT, device=x.device), return_complex=True, center=True)


def istft(X, n):
    return torch.istft(X, NFFT, HOP, window=torch.hann_window(NFFT, device=X.device), length=n, center=True)


def render(tracks, k, sr=48000, presence_db=4.0, noise=None, seed=0):
    tr = tracks
    frame = k['frame']
    n = int(math.ceil(tr.shape[0] * frame * sr))
    nat = k.get('natural', 1.0)
    S = upsample(tr, frame, sr, n)
    col = lambda name: S[:, IX[name]]

    # ── source, per sample with LF shape per sample from interpolated Rd and tilt ──
    f0 = torch.clamp(col('f0'), 40, 900)
    phase = torch.remainder(torch.cumsum(f0 / sr, 0), 1.0)
    ah = col('ah')
    rd = torch.clamp(col('rd') * (1 + k['rdBreath'] * ah * nat), 0.3, 2.7)
    te0, tp0, ra = lf_from_rd(rd)
    ra0 = k['ra0']
    tilt = col('tilt')
    ta0 = torch.clamp(1 / (TAU * torch.clamp(tilt, min=300)), min=1 / sr) * f0
    ta = torch.clamp(ta0 * ra / ra0, max=0.2)
    te = torch.clamp(te0, 0.3, None)
    te = torch.minimum(te, 0.97 - ta)
    tp = te * tp0 / te0
    ta = torch.clamp(ta, min=1e-4)
    # solve per 5 ms frame and hold: the worklet solves per period, which is close to this
    step = max(1, int(round(frame * sr)))
    idx = torch.arange(0, n, step, device=tr.device)
    eps, eD, alpha, wg, E0 = lf_solve(te[idx], tp[idx], ta[idx])
    rep = lambda v: torch.repeat_interleave(v, step)[:n]
    g = lf_at(phase, rep(te[idx]), rep(ta[idx]), rep(eps), rep(eD), rep(alpha), rep(wg), rep(E0))

    av, af = col('av'), col('af')
    if noise is None:
        gen = torch.Generator(device='cpu').manual_seed(seed)
        noise = (torch.rand(n, generator=gen) * 2 - 1).to(tr.device)
        noise = pink(noise)
    tep = rep(te[idx])
    dp = min(1.0, k['aspPulse'] * nat)
    openp = torch.where(phase < tep, torch.ones_like(phase), torch.full_like(phase, 1 - dp)) / torch.sqrt(tep + (1 - tep) * (1 - dp) ** 2)
    x = g * av * k['srcK'] + noise * ah * k['aspK'] * torch.where(av > 0.05, openp, torch.ones_like(openp))
    emph = max(0.0, min(0.97, k.get('emph', 0)))
    w5 = TAU * 500 / sr
    emph_norm = 1 / math.hypot(1 - emph * math.cos(w5), emph * math.sin(w5))
    x = (x - emph * torch.cat([x.new_zeros(1), x[:-1]])) * emph_norm

    fp = min(1.0, k['fricPulse'] * nat)
    fo = torch.where(av > 0.02, torch.where(phase < tep, torch.ones_like(phase), torch.full_like(phase, 1 - fp)) / torch.sqrt(tep + (1 - tep) * (1 - fp) ** 2), torch.ones_like(phase))
    fn = noise * af * fo

    # ── tract responses per STFT frame ──
    X, FN = stft(x), stft(fn)
    nb, nf_ = X.shape
    times = torch.arange(nf_, device=tr.device, dtype=tr.dtype) * HOP / sr
    C = at_frames(tr, frame, sr, times)
    c = lambda name: C[:, IX[name]]
    w = TAU * torch.arange(nb, device=tr.device, dtype=tr.dtype) / NFFT
    T = 1 / sr
    fsh = k.get('fshift', 1.0)
    H1 = None
    Hc = torch.ones(nf_, nb, dtype=torch.complex64, device=tr.device)
    for m in range(4):
        f = torch.clamp(c('f%d' % (m + 1)), 60, sr * 0.45)
        q = torch.clamp(c('q%d' % (m + 1)), min=0.5)
        bw = torch.clamp(f / q, min=30) * k['bwK']
        R = reson_h(f * T, bw * T, w)
        Hc = Hc * R
        if m == 0:
            H1 = R
    Hc = Hc * reson_h(torch.full((nf_,), 4800 * fsh * T, device=tr.device), torch.full((nf_,), 400 * T, device=tr.device), w)
    nzf = torch.clamp(c('nzf'), min=200)
    depth = 10 ** (torch.clamp(c('nzdb'), max=0) / 20)
    Hn = reson_h(nzf * T, torch.full_like(nzf, 300 * T), w) / reson_h(nzf * T, torch.clamp(300 * depth, min=15) * T, w)
    cl = c('closure')[:, None]
    Hv = Hn * (Hc * (1 - cl) + H1 * cl * k['closureK']) * k['cascK']

    nfr = torch.clamp(c('nf'), 200, sr * 0.45)
    nq = torch.clamp(c('nq'), min=0.5)
    wb = TAU * nfr * T
    al = torch.sin(wb) / (2 * nq)
    a0 = 1 + al
    Hb = biquad_h((al / a0)[:, None], 0, (-al / a0)[:, None], (-2 * torch.cos(wb) / a0)[:, None], ((1 - al) / a0)[:, None], w)
    wh = TAU * k.get('flatHz', 2500) * T
    alh = math.sin(wh) / (2 * k.get('flatQ', 0.7))
    a0h = 1 + alh
    cw = math.cos(wh)
    Hh = biquad_h((1 + cw) / 2 / a0h, -(1 + cw) / a0h, (1 + cw) / 2 / a0h, -2 * cw / a0h, (1 - alh) / a0h, w)[None, :]
    lpA = k['lpA']
    Hlp = lpA / (1 - (1 - lpA) * torch.exp(-1j * w))[None, :]
    Hf = (Hb * Hb * c('fb')[:, None] + Hh * c('ff')[:, None]) * k['fricK'] * Hlp

    # presence peak (synth.mjs)
    A0 = 10 ** (presence_db / 40)
    wp = TAU * 3000 / sr
    alp = math.sin(wp) / (2 * 0.9)
    cwp = math.cos(wp)
    a0p = 1 + alp / A0
    Hp = biquad_h((1 + alp * A0) / a0p, -2 * cwp / a0p, (1 - alp * A0) / a0p, -2 * cwp / a0p, (1 - alp / A0) / a0p, w)[:, None]

    Y = (X * Hv.T + FN * Hf.T) * Hp
    return istft(Y, n)


def pink(w):
    """Paul Kellett's pink filter on white noise, as the worklet's Pink (no gradient needed)."""
    import numpy as np
    from scipy.signal import lfilter
    x = w.cpu().numpy().astype(np.float64)
    poles = [0.99886, 0.99332, 0.96900, 0.86650, 0.55000, -0.7616]
    gains = [0.0555179, 0.0750759, 0.1538520, 0.3104856, 0.5329522, -0.0168980]
    y = sum(lfilter([g], [1, -p], x) for p, g in zip(poles, gains)) + x * 0.5362
    y[1:] += x[:-1] * 0.115926
    return torch.tensor(y * 0.16, dtype=w.dtype, device=w.device)
