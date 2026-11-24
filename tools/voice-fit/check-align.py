"""check-align.py: score an alignment against what its phones should sound like.

  <venv python> tools/voice-fit/check-align.py <speaker wav> <align.json> [more align.json ...]

No hand labels exist, so each phone is checked against the acoustics it must have:
  sibilant  /s z ʃ ʒ tʃ dʒ/: share of its frames that are hiss (over 40% of the energy in 4-10 kHz)
  stop      /p t k b d g/: share whose span holds a closure (a frame 20 dB under the line's peak)
  vowel     share of its frames that are voiced (40 ms autocorrelation peak over 0.5)
  front/back  the spectral centroid (300-3000 Hz) of front vowels /i ɪ eɪ/ over back ones
            /ɑ ɔ u oʊ/: the class checks can't see which vowel a span holds, and this can
Higher is better on all four. Run it on a warp and on the --linear baseline together.
"""
import json, sys
import numpy as np
from segment import read_wav

SIB = {'S', 'Z', 'SH', 'ZH', 'CH', 'JH'}
STOP = {'P', 'T', 'K', 'B', 'D', 'G'}
FRONT = {'IY', 'IH', 'EY'}
BACK = {'AA', 'AO', 'UW', 'OW'}
VOW = {'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'AH', 'AX', 'EY', 'AY', 'OW', 'OY', 'AW', 'ERR', 'OWR', 'AWC', 'AYC', 'OWC', 'EYC'}


def frames(x, sr):
    h, n, nv = int(0.01 * sr), int(0.025 * sr), int(0.04 * sr)
    out = []
    for s in range(0, len(x) - nv, h):
        f = x[s:s + n] * np.hanning(n)
        S = np.abs(np.fft.rfft(f)) ** 2
        fr = np.fft.rfftfreq(n, 1 / sr)
        hf = S[(fr >= 4000) & (fr <= 10000)].sum() / (S.sum() + 1e-20)
        e = 10 * np.log10((f ** 2).mean() + 1e-12)
        v = x[s:s + nv] - x[s:s + nv].mean()
        ac = np.correlate(v, v, 'full')[nv - 1:]
        ac = ac / (ac[0] + 1e-20)
        lo, hi = int(sr / 300), int(sr / 55)
        band = (fr >= 300) & (fr <= 3000)
        cen = (S[band] * fr[band]).sum() / (S[band].sum() + 1e-20)
        out.append((hf, e, ac[lo:hi].max(), cen))
    return np.array(out)


def main():
    x, sr = read_wav(sys.argv[1])
    F = frames(x, sr)
    for ap in sys.argv[2:]:
        A = json.load(open(ap))
        sib, stop, vow, front, back = [], [], [], [], []
        for line in A.values():
            ph = line['phones']
            lo = min(p['start'] for p in ph)
            hi = max(p['end'] for p in ph)
            peak = F[int(lo / 0.01):int(hi / 0.01), 1].max()
            for p in ph:
                a, b = int(p['start'] / 0.01), int(p['end'] / 0.01)
                if b <= a:
                    continue
                seg = F[a:b]
                if p['p'] in SIB:
                    sib.append((seg[:, 0] > 0.4).mean())
                elif p['p'] in STOP:
                    stop.append(float((seg[:, 1] < peak - 20).any()))
                elif p['p'] in VOW:
                    vow.append((seg[:, 2] > 0.5).mean())
                    if p['p'] in FRONT:
                        front.append(seg[:, 3].mean())
                    elif p['p'] in BACK:
                        back.append(seg[:, 3].mean())
        print(f'{ap}: sibilants hiss {np.mean(sib):.2f} (n {len(sib)}), stops hold a closure {np.mean(stop):.2f} (n {len(stop)}), vowels voiced {np.mean(vow):.2f} (n {len(vow)}), front/back {np.mean(front) / np.mean(back):.3f}')


if __name__ == '__main__':
    main()
