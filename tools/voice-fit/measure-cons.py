"""measure-cons.py: each fricative's spectral centre of gravity and each voiceless stop's VOT.

  <venv python> tools/voice-fit/measure-cons.py <speaker wav> <align.json> <out.json>
  <venv python> tools/voice-fit/measure-cons.py --trace <render dir> <out.json>

The first form measures the speaker on align.py's boundaries. The second measures a
render on its own trace (render-trace.mjs), where every boundary is exact, so the two
are measured the same way and only the boundaries' accuracy differs.

Centre of gravity: the middle half of the fricative, 10 ms frames, the power spectrum
from 1 to 11 kHz averaged, then its power-weighted mean frequency (Jongman et al. 2000).
VOT, for /p t k/ before a vowel: the burst is the biggest rise in energy over 2 kHz in
the stop's span (1 ms frames), and voicing starts at the first of three 5 ms frames
after it whose autocorrelation peak passes 0.5. Searched to 120 ms past the burst.

Out: { cog: { S: [hz...], ... }, vot: { T: [s...], ... } }
"""
import json, sys
from pathlib import Path
import numpy as np
from segment import read_wav

FRIC = {'S', 'Z', 'SH', 'F', 'TH', 'V', 'DH', 'CH', 'JH'}
STOPS = {'P', 'T', 'K'}
VOW = {'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'AH', 'AX', 'EY', 'AY', 'OW', 'OY', 'AW'}


def cog(x, sr, s, e):
    a, b = s + (e - s) * 0.25, s + (e - s) * 0.75
    seg = x[int(a * sr):int(b * sr)]
    n = int(0.01 * sr)
    if len(seg) < n:
        return None
    fr = np.lib.stride_tricks.sliding_window_view(seg, n)[::n // 2] * np.hamming(n)
    P = (np.abs(np.fft.rfft(fr, axis=1)) ** 2).mean(0)
    f = np.fft.rfftfreq(n, 1 / sr)
    m = (f >= 1000) & (f <= 11000)
    return float((f[m] * P[m]).sum() / (P[m].sum() + 1e-20))


def vot(x, sr, s, e):
    seg = x[int(s * sr):int((e + 0.12) * sr)]
    h = int(0.001 * sr)
    if len(seg) < 20 * h:
        return None
    hp = np.append(seg[0], np.diff(seg))          # a crude tilt to favour the burst
    span = int((e - s) * sr) // h
    en = np.array([10 * np.log10((hp[k * h:(k + 2) * h] ** 2).mean() + 1e-14) for k in range(span)])
    if len(en) < 6:
        return None
    rise = en[3:] - en[:-3]
    b = int(np.argmax(rise)) + 2
    lo, hi = int(sr / 300), int(sr / 55)
    w = int(0.03 * sr)
    run = 0
    for k in range(b, b + 120, 1):
        c = k * h
        v = seg[c:c + w]
        if len(v) < w:
            return None
        v = v - v.mean()
        ac = np.correlate(v, v, 'full')[len(v) - 1:]
        p = ac[lo:hi].max() / (ac[0] + 1e-20)
        run = run + 1 if p > 0.5 else 0
        if run >= 3:
            return (k - 2 - b) / 1000
    return None


def measure(x, sr, phones, out):
    for k, ph in enumerate(phones):
        p, s, e = ph['p'], ph['start'], ph['end']
        if e - s < 0.02:
            continue
        if p in FRIC:
            c = cog(x, sr, s, e)
            if c:
                out['cog'].setdefault(p, []).append(round(c))
        elif p in STOPS and k + 1 < len(phones) and phones[k + 1]['p'] in VOW:
            v = vot(x, sr, s, e)
            if v is not None:
                out['vot'].setdefault(p, []).append(round(v, 4))


def main():
    out = {'cog': {}, 'vot': {}}
    if sys.argv[1] == '--trace':
        rdir, outp = Path(sys.argv[2]), sys.argv[3]
        for sid, tr in json.load(open(rdir / 'trace.json')).items():
            x, sr = read_wav(rdir / f'{sid}.wav')
            phones = [{'p': tr[k]['p'], 'start': tr[k]['at'], 'end': tr[k + 1]['at']} for k in range(len(tr) - 1)]
            measure(x, sr, phones, out)
    else:
        x, sr = read_wav(sys.argv[1])
        outp = sys.argv[3]
        for line in json.load(open(sys.argv[2])).values():
            measure(x, sr, line['phones'], out)
    json.dump(out, open(outp, 'w'))
    med = lambda a: sorted(a)[len(a) // 2]
    print('cog', {p: (med(v), len(v)) for p, v in sorted(out['cog'].items())})
    print('vot', {p: (med(v), len(v)) for p, v in sorted(out['vot'].items())})


if __name__ == '__main__':
    main()
