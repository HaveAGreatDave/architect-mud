"""align.py: carry ORACLE's phone boundaries onto a recording, by dynamic time warping.

  <venv python> tools/voice-fit/align.py <speaker wav> <segs.json> <render dir> <out.json>

For each line, the render (render-trace.mjs) knows where every phone starts, because ORACLE
put it there. Both the render and the speaker's line are reduced to MFCCs (13 cepstra and
their deltas, 25 ms windows every 10 ms, the mean taken out per line so the two voices'
fixed colouring cancels), trimmed to their sound, and warped onto each other with DTW
(Sakoe and Chiba 1978: symmetric steps, a band of a third of the longer length). Each
phone's start in the render maps to the first speaker frame its frame is matched with.

Out: { id: { t0, phones: [{ p, start, end }] } }, times in seconds in the speaker's file.
Pauses ('_', '__' and the like) are kept as phones, so a silence the speaker left is one.
With --linear, the render is stretched evenly instead: the baseline check-align.py scores
the warp against.
"""
import json, sys
from pathlib import Path
import numpy as np
from segment import read_wav

HOP, WIN, NMEL, NCEP = 0.01, 0.025, 26, 13


def mel_bank(sr, n):
    hz2m = lambda f: 2595 * np.log10(1 + f / 700)
    m2hz = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = m2hz(np.linspace(hz2m(60), hz2m(min(7600, sr / 2)), NMEL + 2))
    bins = np.floor((n + 1) * pts / sr).astype(int)
    fb = np.zeros((NMEL, n // 2 + 1))
    for i in range(NMEL):
        a, b, c = bins[i], bins[i + 1], bins[i + 2]
        fb[i, a:b] = (np.arange(a, b) - a) / max(1, b - a)
        fb[i, b:c] = (c - np.arange(b, c)) / max(1, c - b)
    return fb


def mfcc(x, sr):
    x = np.append(x[0], x[1:] - 0.97 * x[:-1])
    n, h = int(WIN * sr), int(HOP * sr)
    nf = max(1, 1 + (len(x) - n) // h)
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::h][:nf] * np.hamming(n)
    nfft = 1 << (n - 1).bit_length()
    P = np.abs(np.fft.rfft(fr, nfft)) ** 2
    E = np.log(P @ mel_bank(sr, nfft).T + 1e-10)
    k = np.arange(NCEP)[:, None]
    dct = np.cos(np.pi * k * (np.arange(NMEL) + 0.5) / NMEL)
    C = E @ dct.T
    C -= C.mean(0)                                   # per-line mean normalisation
    D = np.gradient(C, axis=0)
    level = 10 * np.log10((fr ** 2).mean(1) + 1e-12)
    if CLASS_W <= 0:
        return np.hstack([C, D]), level
    # Features that mean the same in any voice, where MFCCs differ between the speaker
    # and the synth: the share of energy that's hiss (4-10 kHz), the voicing, and the level
    # under the line's loudest frame. They tell a sibilant, a closure and a vowel apart.
    f = np.fft.rfftfreq(nfft, 1 / sr)
    hf = P[:, (f >= 4000) & (f <= 10000)].sum(1) / (P.sum(1) + 1e-20)
    nv = int(0.04 * sr)
    lo, hi = int(sr / 300), int(sr / 55)
    voi = []
    for k in range(nf):
        c = k * h + n // 2
        v = x[max(0, c - nv // 2):c + nv // 2]
        v = v - v.mean()
        ac = np.correlate(v, v, 'full')[len(v) - 1:]
        voi.append(ac[lo:hi].max() / (ac[0] + 1e-20) if len(ac) > hi else 0)
    lev = np.clip((level - level.max()) / 40 + 1, 0, 1)
    K = np.stack([hf, np.array(voi), lev], 1) * CLASS_W
    return np.hstack([C, D, K]), level


def trim(level):
    on = np.where(level > max(np.percentile(level, 10) + 15, level.max() - 45))[0]
    return (on[0], on[-1] + 1) if len(on) else (0, len(level))


def dtw(A, B):
    n, m = len(A), len(B)
    d = np.sqrt(((A[:, None, :] - B[None, :, :]) ** 2).sum(-1))
    band = max(abs(n - m) + 5, int(max(n, m) / 3))
    C = np.full((n + 1, m + 1), np.inf)
    C[0, 0] = 0
    for i in range(1, n + 1):
        lo, hi = max(1, int(i * m / n) - band), min(m, int(i * m / n) + band)
        for j in range(lo, hi + 1):
            C[i, j] = d[i - 1, j - 1] + min(C[i - 1, j - 1], C[i - 1, j], C[i, j - 1])
    i, j, path = n, m, []
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        k = np.argmin([C[i - 1, j - 1], C[i - 1, j], C[i, j - 1]])
        i, j = (i - 1, j - 1) if k == 0 else (i - 1, j) if k == 1 else (i, j - 1)
    return path[::-1]


LINEAR = '--linear' in sys.argv
REFINE = '--refine' in sys.argv   # off: on Part 3 it made all three checks worse (check-align.py)
# Weight of the voice-independent features against the MFCCs (--class=N to try others).
# On Part 3: 0 gave hiss 0.39, closure 0.71, voiced 0.62; 600 gave 0.53, 0.74, 0.67 and
# kept front vowels apart from back ones; 1500 stopped telling vowels apart.
CLASS_W = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--class=')), '600'))
SNAP = 4          # frames (10 ms) a boundary may move when it's refined


def main():
    wavp, segp, rdir, outp = sys.argv[1], sys.argv[2], Path(sys.argv[3]), sys.argv[4]
    x, sr = read_wav(wavp)
    traces = json.load(open(rdir / 'trace.json'))
    out = {}
    for sg in json.load(open(segp)):
        sid = str(sg['id'])
        if sid not in traces:
            continue
        y, ysr = read_wav(rdir / f'{sid}.wav')
        seg = x[int(sg['t0'] * sr):int(sg['t1'] * sr)]
        A, la = mfcc(y, ysr)
        B, lb = mfcc(seg, sr)
        a0, a1 = trim(la)
        b0, b1 = trim(lb)
        if LINEAR:   # the baseline: the render stretched evenly over the speaker's sound
            n, m = a1 - a0, b1 - b0
            path = [(i, int(i * m / n)) for i in range(n)]
        else:
            path = dtw(A[a0:a1], B[b0:b1])
        first = {}
        for i, j in path:
            first.setdefault(i, j)
        def to_spk(t):
            i = int(round(t / HOP)) - a0
            if i <= 0:
                return sg['t0'] + b0 * HOP
            if i >= a1 - a0:
                return sg['t0'] + b1 * HOP
            return sg['t0'] + (b0 + first[i]) * HOP
        tr = traces[sid]
        # Each boundary in the speaker's frames (the last entry of a trace is END).
        bnd = [to_spk(ph['at']) for ph in tr]
        if REFINE and not LINEAR:
            # Snap each inner boundary, within SNAP, to the frame where the speaker's
            # spectrum changes most: three frames' mean MFCCs before against after. The
            # warp puts a boundary in the right place to within a few frames; real
            # boundaries sit on an edge (hiss starting, a closure, voicing coming on).
            fl = np.linalg.norm(np.array([B[max(0, j - 3):j].mean(0) - B[j:j + 3].mean(0) if 3 <= j <= len(B) - 3 else np.zeros(B.shape[1]) for j in range(len(B))]), axis=1)
            for k in range(1, len(bnd) - 1):
                j = int(round((bnd[k] - sg['t0']) / HOP))
                lo = max(int(round((bnd[k - 1] - sg['t0']) / HOP)) + 1, j - SNAP)
                hi = min(int(round((bnd[k + 1] - sg['t0']) / HOP)) - 1, j + SNAP)
                if hi > lo:
                    bnd[k] = sg['t0'] + (lo + int(np.argmax(fl[lo:hi + 1]))) * HOP
        phones = []
        for k, ph in enumerate(tr[:-1]):
            s, e = bnd[k], bnd[k + 1]
            phones.append({'p': ph['p'], 'start': round(s, 3), 'end': round(max(e, s), 3)})
        out[sid] = {'t0': sg['t0'], 'phones': phones,
                    'cost': round(float(np.mean([np.linalg.norm(A[a0 + i] - B[b0 + j]) for i, j in path])), 2)}
    json.dump(out, open(outp, 'w'), indent=1)
    print(f'{len(out)} lines aligned')


if __name__ == '__main__':
    main()
