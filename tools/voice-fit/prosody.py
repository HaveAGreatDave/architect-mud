"""prosody.py: timing and pitch of each line, the same way for a speaker and for a render.

  <venv python> tools/voice-fit/prosody.py <wav> <segments.json> <out.json>

segments.json is a list of {"id", "t0", "t1"} (seconds). For each one:
  speech   first to last sound (10 ms frames over floor + 15 dB), s
  pause    silent stretches of 150 ms or more inside that, s
  f0 ...   pitch in semitones over 100 Hz: median, 10th and 90th percentiles, the
           slope of a straight line through the voiced frames (st/s, declination), and
           how far the last fifth of the voiced frames sits under the median (the fall
           at the end of a sentence)

Pitch is autocorrelation over 40 ms (three periods of a voice near 80 Hz), voiced where
the normalised peak is over 0.5. A deep, creaky voice throws octave errors, so every
frame is snapped to within half an octave of its line's median (halved or doubled).
"""
import json, sys
import numpy as np
from segment import read_wav

HOP = 0.01
WIN = 0.04


def f0_frames(x, sr):
    n, h = int(WIN * sr), int(HOP * sr)
    lo, hi = int(sr / 300), int(sr / 55)
    out = []
    for s in range(0, len(x) - n, h):
        f = x[s:s + n] - x[s:s + n].mean()
        e = (f ** 2).mean()
        if e <= 0:
            out.append((0.0, 0.0, -120.0))
            continue
        ac = np.correlate(f, f, 'full')[n - 1:]
        ac /= ac[0]
        k = lo + int(np.argmax(ac[lo:hi]))
        out.append((sr / k, ac[k], 10 * np.log10(e)))
    return np.array(out)


def main():
    wav, segp, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    x, sr = read_wav(wav)
    F = f0_frames(x, sr)
    # Sound is 15 dB over the noise floor, and no lower than 30 dB under the loud frames: a
    # render's floor is digital silence, and its quiet breath between phrases isn't speech.
    floor = max(np.percentile(F[:, 2], 10), np.percentile(F[:, 2], 90) - 45)
    res = []
    for sg in json.load(open(segp)):
        a, b = int(sg['t0'] / HOP), int(sg['t1'] / HOP)
        fr = F[a:b]
        if len(fr) < 10:
            continue
        on = fr[:, 2] > floor + 15
        idx = np.where(on)[0]
        if len(idx) < 5:
            continue
        s0, s1 = idx[0], idx[-1] + 1
        quiet, pause = 0, 0
        for v in on[s0:s1]:
            if not v:
                quiet += 1
            else:
                if quiet * HOP >= 0.15:
                    pause += quiet * HOP
                quiet = 0
        seg = fr[s0:s1]
        voiced = (seg[:, 1] > 0.5) & (seg[:, 2] > floor + 15)
        hz = seg[voiced, 0]
        t = np.arange(len(seg))[voiced] * HOP
        if len(hz) < 8:
            continue
        m = np.median(hz)
        hz = np.where(hz > m * 1.41, hz / 2, np.where(hz < m / 1.41, hz * 2, hz))   # octave snap
        st = 12 * np.log2(hz / 100)
        med = float(np.median(st))
        slope = float(np.polyfit(t, st, 1)[0]) if t[-1] - t[0] > 0.3 else None
        tail = st[int(len(st) * 0.8):]
        res.append({'id': sg['id'], 'speech': round((s1 - s0) * HOP, 3), 'pause': round(pause, 3),
                    'f0med': round(med, 2), 'f0p10': round(float(np.percentile(st, 10)), 2),
                    'f0p90': round(float(np.percentile(st, 90)), 2),
                    'slope': None if slope is None else round(slope, 2),
                    'final': round(float(np.median(tail)) - med, 2)})
    json.dump(res, open(outp, 'w'), indent=1)
    print(f'{len(res)} segments')


if __name__ == '__main__':
    main()
