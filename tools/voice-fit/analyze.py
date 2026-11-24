"""analyze.py: measure each test word's vowel in Parts 1 and 2.

  <venv python> tools/voice-fit/analyze.py <dir with the wavs> <lines.json> <measures.json>

Formants by Burg LPC, as Praat does it: resample to twice the formant ceiling, pre-
emphasise from 50 Hz, 25 ms Gaussian windows every 5 ms, order 10 (five formants), and
take the roots with a bandwidth under 500 Hz as formants. The ceiling is 5000 Hz for a
voice with a median F0 under 160 Hz and 5500 Hz above.

The vowel is the longest run of voiced frames within 12 dB of the loudest frame in the
test word's span (Whisper's word timing, widened 60 ms each way). In "Say heed aloud"
that's the /i/ between the breath of the h and the closure of the d. F1-F3 are medians
over 15-25%, 45-55% and 75-85% of it; F2 at the first and last two frames is the onset
and offset the locus equations are fitted to.
"""
import json, sys
from pathlib import Path
import numpy as np
from segment import read_wav

HOP = 0.005
VWIN = 0.04       # s; voicing needs three periods of a voice near 80 Hz
fin = lambda a: None if not np.isfinite(a).any() else round(float(np.nanmedian(a)), 0)
WIN = 0.025


def burg(x, order):
    f = x.astype(np.float64).copy(); b = f.copy()
    a = np.array([1.0])
    for _ in range(order):
        ff, bb = f[1:], b[:-1]
        den = (ff @ ff) + (bb @ bb)
        k = -2 * (ff @ bb) / den if den > 0 else 0
        a = np.concatenate([a, [0]]) + k * np.concatenate([a, [0]])[::-1]
        f, b = ff + k * bb, bb + k * ff
    return a


def formants(frame, fs, order=10):
    a = burg(frame, order)
    r = np.roots(a)
    r = r[np.imag(r) > 0]
    fr = np.angle(r) * fs / (2 * np.pi)
    bw = -np.log(np.abs(r)) * fs / np.pi
    keep = (fr > 90) & (fr < fs / 2 - 50) & (bw < 500)
    return np.sort(fr[keep])


def f0_and_voicing(frame, fs):
    x = frame - frame.mean()
    if not x.any():
        return 0, 0
    ac = np.correlate(x, x, 'full')[len(x) - 1:]
    ac /= ac[0]
    lo, hi = int(fs / 300), int(fs / 50)
    k = lo + int(np.argmax(ac[lo:hi]))
    return fs / k, ac[k]


def measure(l, frames, i0, i1, tracks, breathy=False):
    """One line's vowel, frames i0..i1 with their formant tracks, as fit.mjs reads it."""
    T = np.array(tracks, dtype=float)
    m = len(T)
    def med(p0, p1):
        s = T[int(p0 * m):max(int(p0 * m) + 1, int(p1 * m))]
        vals = [np.nanmedian(s[:, k]) if np.isfinite(s[:, k]).any() else np.nan for k in range(3)]
        return [None if np.isnan(v) else round(float(v), 0) for v in vals]
    return {
        'n': l['n'], 'text': l['text'], 'heard': l['heard'],
        'v0': round(frames[i0]['t'] + WIN / 2, 3), 'v1': round(frames[i1 - 1]['t'] + WIN / 2, 3),
        'dur': round((i1 - i0) * HOP + WIN - HOP, 3),
        'f20': med(0.15, 0.25), 'f50': med(0.45, 0.55), 'f80': med(0.75, 0.85),
        'f2on': fin(T[:2, 1]), 'f2off': fin(T[-2:, 1]),
        # a breathy vowel's periodicity is too weak for its F0 to mean anything
        'f0': None if breathy else round(float(np.median([f['f0'] for f in frames[i0:i1]])), 1),
        'breathy': breathy,
    }


def main():
    src, lines_p, out_p = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    # Part 1 only: every line there has a break before its test vowel. Part 2's words
    # (war, owl, real) run straight on from "say", and are for the r/l fit later.
    # Part 5 ("Say keen again.") is built the same way, for the split velar locus.
    lines = [l for l in json.loads(lines_p.read_text())
             if l['part'] == 'part1' or (l['part'] == 'part5' and l['text'].startswith('Say '))]
    audio = {p: read_wav(src / f'{p}.wav') for p in sorted({l['part'] for l in lines})}
    # the voice's F0 sets the ceiling
    f0s = []
    for l in lines[::5]:
        x, sr = audio[l['part']]
        seg = x[int(l['t0'] * sr):int(l['t1'] * sr)]
        n = int(WIN * sr)
        for i in range(0, len(seg) - n, n):
            f, v = f0_and_voicing(seg[i:i + n], sr)
            if v > 0.6:
                f0s.append(f)
    f0 = float(np.median(f0s))
    ceil = 5000 if f0 < 160 else 5500
    fs = 2 * ceil
    print(f'median F0 {f0:.0f} Hz, formant ceiling {ceil} Hz')
    res = {}
    out = []
    for l in lines:
        x, sr = audio[l['part']]
        if l['part'] not in res:
            t = np.arange(0, len(x) / sr, 1 / fs)
            # Low-pass at the new Nyquist first, or everything above it (the hiss of /s/
            # and /h/, the breath) folds down into the formant band.
            X = np.fft.rfft(x)
            X[np.fft.rfftfreq(len(x), 1 / sr) > 0.95 * fs / 2] = 0
            y = np.interp(t, np.arange(len(x)) / sr, np.fft.irfft(X, len(x)))
            y = np.append(y[0], y[1:] - np.exp(-2 * np.pi * 50 / fs) * y[:-1])   # pre-emphasis
            res[l['part']] = (y, t)
        y, _ = res[l['part']]
        # The clip is /s/, the vowel of "say", a break (the breath of /h/ or a stop's
        # closure), then the test vowel: the SECOND loud voiced run. Whisper's word times
        # run up to 0.1 s early, so they aren't used here.
        a, b = l['t0'], l['t1']
        n, h = int(WIN * fs), int(HOP * fs)
        win = np.exp(-0.5 * ((np.arange(n) - n / 2) / (n / 6)) ** 2)
        frames = []
        for s in range(int(a * fs), int(b * fs) - n, h):
            fr = y[s:s + n]
            e = 10 * np.log10((fr ** 2).mean() + 1e-12)
            c = int((s + n / 2) / fs * sr)   # voicing over VWIN at the original rate, centred
            f0f, v = f0_and_voicing(x[max(0, c - int(VWIN * sr / 2)):c + int(VWIN * sr / 2)], sr)
            frames.append({'t': s / fs, 'e': e, 'v': v, 'f0': f0f, 'fr': fr * win})
        if not frames:
            continue
        top = max(f['e'] for f in frames)
        son = [f['v'] > 0.5 and f['e'] > top - 20 for f in frames]
        runs, st, gap = [], None, 0
        for i, o in enumerate(son + [False] * 6):
            if o:
                if st is None:
                    st = i
                gap = 0
            elif st is not None:
                gap += 1
                if gap >= 5:                       # 25 ms of break ends a run
                    if i - gap + 1 - st >= 8:      # runs under 40 ms are noise
                        runs.append((st, i - gap + 1))
                    st, gap = None, 0
        if len(runs) < 2:
            continue
        i0, i1 = runs[1]
        # Not the stretch between: after /h/ it's loud but it's the breath, energy high up,
        # and LPC on it reads a vowel's F1 near 1000 Hz that isn't there.
        # The run can carry on through a voiced /d/ into "aloud": the vowel ends where the
        # level first falls 8 dB under its peak for 15 ms (a closure or a nasal), and runs
        # no longer than 0.35 s whatever happens.
        pk = max(range(i0, i1), key=lambda i: frames[i]['e'])
        low = 0
        for i in range(pk, i1):
            low = low + 1 if frames[i]['e'] < frames[pk]['e'] - 8 else 0
            if low >= 3:
                i1 = i - 2
                break
        # and starts where it's within 10 dB of that peak (after a breathy /h/ onset)
        while i0 < pk and frames[i0]['e'] < frames[pk]['e'] - 10:
            i0 += 1
        i1 = min(i1, i0 + int(0.35 / HOP))
        if i1 - i0 < 8:
            continue
        tracks = []
        for f in frames[i0:i1]:
            fm = formants(f['fr'], fs)
            tracks.append(list(fm[:3]) + [np.nan] * (3 - min(3, len(fm))))
        out.append(measure(l, frames, i0, i1, tracks))
    out_p.write_text(json.dumps({'f0': f0, 'ceiling': ceil, 'lines': out}, indent=1))
    print(f'{len(out)} of {len(lines)} lines measured')


if __name__ == '__main__':
    main()
