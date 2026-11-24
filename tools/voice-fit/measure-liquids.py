"""measure-liquids.py: a vowel and the liquid after it, three points each word (Part 2).

  <venv python> tools/voice-fit/measure-liquids.py <wav> <align.json> <pairs.json> <out.json>
  <venv python> tools/voice-fit/measure-liquids.py --trace <render dir> <pairs.json> <out.json>

pairs.json is { id: { key: 'AY|ER', v: k, l: k+1 } }, the indexes of the vowel and the
liquid in the line's phones (fit-liquids.mjs writes it). F1 and F2 are taken with Burg
LPC, as analyze.py does, at 20% and 80% of the vowel and at the middle of the liquid,
each the median over 30 ms around the point. The first form uses align.py's boundaries
on the speaker, the second a render's own trace.

Out: { key: [ { f: [F1, F2], to: [F1, F2], liq: [F1, F2] }, ... ] }
"""
import json, sys
from pathlib import Path
import numpy as np
from segment import read_wav
from analyze import formants

CEIL = 5000
FS = 2 * CEIL


def prep(x, sr):
    X = np.fft.rfft(x)
    X[np.fft.rfftfreq(len(x), 1 / sr) > 0.95 * FS / 2] = 0
    t = np.arange(0, len(x) / sr, 1 / FS)
    y = np.interp(t, np.arange(len(x)) / sr, np.fft.irfft(X, len(x)))
    return np.append(y[0], y[1:] - np.exp(-2 * np.pi * 50 / FS) * y[:-1])


def at(y, t):
    n = int(0.025 * FS)
    win = np.exp(-0.5 * ((np.arange(n) - n / 2) / (n / 6)) ** 2)
    f1s, f2s = [], []
    for dt in (-0.015, -0.0075, 0, 0.0075, 0.015):
        c = int((t + dt) * FS)
        fr = y[c - n // 2:c + n // 2]
        if len(fr) < n:
            continue
        fm = formants(fr * win, FS)
        fm = fm[fm > 200]
        if len(fm) >= 2:
            f1s.append(fm[0]); f2s.append(fm[1])
    if len(f1s) < 3:
        return None
    return [round(float(np.median(f1s))), round(float(np.median(f2s)))]


def measure(y, phones, pr, out):
    v, l = phones[pr['v']], phones[pr['l']]
    vs, ve = v['start'], v['end']
    pts = [at(y, vs + 0.2 * (ve - vs)), at(y, vs + 0.8 * (ve - vs)), at(y, (l['start'] + l['end']) / 2)]
    if all(pts):
        out.setdefault(pr['key'], []).append({'f': pts[0], 'to': pts[1], 'liq': pts[2]})


def main():
    out = {}
    if sys.argv[1] == '--trace':
        rdir, pairs, outp = Path(sys.argv[2]), json.load(open(sys.argv[3])), sys.argv[4]
        traces = json.load(open(rdir / 'trace.json'))
        for sid, pr in pairs.items():
            tr = traces.get(sid)
            if not tr:
                continue
            x, sr = read_wav(rdir / f'{sid}.wav')
            phones = [{'p': tr[k]['p'], 'start': tr[k]['at'], 'end': tr[k + 1]['at']} for k in range(len(tr) - 1)]
            measure(prep(x, sr), phones, pr, out)
    else:
        x, sr = read_wav(sys.argv[1])
        A, pairs, outp = json.load(open(sys.argv[2])), json.load(open(sys.argv[3])), sys.argv[4]
        y = prep(x, sr)
        for sid, pr in pairs.items():
            if sid in A:
                measure(y, A[sid]['phones'], pr, out)
    json.dump(out, open(outp, 'w'), indent=1)
    print(len(out), 'pairs measured')


if __name__ == '__main__':
    main()
