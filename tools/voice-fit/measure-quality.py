"""measure-quality.py: breathiness, tilt and periodicity of a voice, on its vowels.

  <venv python> tools/voice-fit/measure-quality.py <wav> <align.json>
  <venv python> tools/voice-fit/measure-quality.py --trace <render dir>

Over the middle half of every vowel of 60 ms or more, in 40 ms frames:
  H1-H2   the first harmonic over the second, dB: higher is breathier (Hillenbrand,
          Cleveland and Erickson 1994).
  H1-A3   the first harmonic over the strongest one from 2 to 3.5 kHz, dB: the tilt.
  CPP     cepstral peak prominence, dB: how far the cepstrum's peak in 55-300 Hz stands
          over its regression line (Hillenbrand and Houde 1996). Lower is breathier or
          rougher.
  jitter  local jitter, %: the mean difference of successive glottal periods over the
          mean, from peak picking over the middle 70% of the vowel.
Harmonics are read off a 4x zero-padded spectrum at multiples of F0 from autocorrelation.
Prints the medians as one JSON line.
"""
import json, sys
from pathlib import Path
import numpy as np
from segment import read_wav

VOW = {'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'AH', 'AX', 'EY', 'AY', 'OW', 'OY', 'AW'}


def f0_of(fr, sr):
    v = fr - fr.mean()
    ac = np.correlate(v, v, 'full')[len(v) - 1:]
    lo, hi = int(sr / 300), int(sr / 55)
    k = lo + int(np.argmax(ac[lo:hi]))
    return sr / k, ac[k] / (ac[0] + 1e-20)


def frame_measures(fr, sr):
    f0, p = f0_of(fr, sr)
    if p < 0.5:
        return None
    w = fr * np.hanning(len(fr))
    n = 4 * len(fr)
    S = 20 * np.log10(np.abs(np.fft.rfft(w, n)) + 1e-12)
    f = np.fft.rfftfreq(n, 1 / sr)
    harm = lambda h: S[(f > h * f0 * 0.9) & (f < h * f0 * 1.1)].max()
    h1, h2 = harm(1), harm(2)
    a3 = S[(f >= 2000) & (f <= 3500)].max()
    # cepstrum of the log power spectrum
    C = np.abs(np.fft.irfft(S / 10)) if False else None
    L = np.log(np.abs(np.fft.rfft(w, n)) ** 2 + 1e-20)
    cep = 10 * np.log10(np.abs(np.fft.irfft(L)) ** 2 + 1e-20)
    q = np.arange(len(cep)) / sr
    m = (q >= 1 / 300) & (q <= 1 / 55)
    pk = int(np.argmax(np.where(m, cep, -np.inf)))
    rq = (q >= 0.001) & (q <= 0.025)
    a, b = np.polyfit(q[rq], cep[rq], 1)
    cpp = cep[pk] - (a * q[pk] + b)
    return h1 - h2, h1 - a3, cpp, sr / f0


def jitter(seg, sr):
    """Period-to-period: each glottal period's length from the peak picked one period on
    from the last (within 20% of the autocorrelation's period), over the vowel."""
    f0, p = f0_of(seg[:int(0.04 * sr)], sr) if len(seg) > int(0.04 * sr) else (0, 0)
    if p < 0.5:
        return None
    T = sr / f0
    lp = np.convolve(seg, np.ones(int(sr / 2000)) / int(sr / 2000), 'same')
    k = int(np.argmax(np.abs(lp[:int(T)])))
    sign = np.sign(lp[k]) or 1
    marks = [k]
    while True:
        a, b = int(marks[-1] + 0.8 * T), int(marks[-1] + 1.2 * T)
        if b >= len(lp):
            break
        k = a + int(np.argmax(sign * lp[a:b]))
        T = 0.7 * T + 0.3 * (k - marks[-1])
        marks.append(k)
    per = np.diff(marks)
    return 100 * np.abs(np.diff(per)).mean() / per.mean() if len(per) > 4 else None


def measure(x, sr, phones, rows):
    for ph in phones:
        if ph['p'] not in VOW or ph['end'] - ph['start'] < 0.06:
            continue
        a, b = ph['start'] + 0.25 * (ph['end'] - ph['start']), ph['end'] - 0.25 * (ph['end'] - ph['start'])
        n, h = int(0.04 * sr), int(0.01 * sr)
        for s in range(int(a * sr), int(b * sr) - n + 1, h):
            r = frame_measures(x[s:s + n], sr)
            if r:
                rows['h1h2'].append(r[0]); rows['h1a3'].append(r[1]); rows['cpp'].append(r[2])
        j = jitter(x[int((ph['start'] + 0.15 * (ph['end'] - ph['start'])) * sr):int((ph['end'] - 0.15 * (ph['end'] - ph['start'])) * sr)], sr)
        if j is not None:
            rows['jitter'].append(j)


def main():
    rows = {'h1h2': [], 'h1a3': [], 'cpp': [], 'jitter': []}
    if sys.argv[1] == '--trace':
        rdir = Path(sys.argv[2])
        for sid, tr in json.load(open(rdir / 'trace.json')).items():
            x, sr = read_wav(rdir / f'{sid}.wav')
            measure(x, sr, [{'p': tr[k]['p'], 'start': tr[k]['at'], 'end': tr[k + 1]['at']} for k in range(len(tr) - 1)], rows)
    else:
        x, sr = read_wav(sys.argv[1])
        for line in json.load(open(sys.argv[2])).values():
            measure(x, sr, line['phones'], rows)
    print(json.dumps({k: round(float(np.median(v)), 2) for k, v in rows.items()} | {'frames': len(rows['h1h2'])}))


if __name__ == '__main__':
    main()
