"""bandnoise.py: harmonics against noise per frequency band, mid-vowel, VCTK against ORACLE (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/bandnoise.py <vctk dir> <source dir> <out dir> [--jobs 2]

A voice sounds buzzy when its harmonics stay clean far up the spectrum; a person's go noisy above
a few kHz, breath filling the gaps between them. This reads, for each vowel at 35, 50 and 65% of
its span (medianed), the spectrum over six periods (at least 40 ms) and in each band of BANDS the power on the harmonics
(the peak within 4% of k*f0) against the power between them (the least within 25% of (k+0.5)*f0),
in dB. Reuses source.py's picked lines and worklet renders (<source dir>/_idx, wav).
Writes <out dir>/<spk>.pkl: [{ name, id, codes, spk, syn }], spk and syn (phones x len(BANDS)).
"""
import json, pickle, sys, time
from pathlib import Path
from multiprocessing import Pool
import numpy as np
import soundfile as sf
import parselmouth
from parselmouth.praat import call
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import vctk
from phones import VOW

BANDS = [(100, 1000), (1000, 2000), (2000, 3000), (3000, 4500), (4500, 6000), (6000, 8000)]
CFG = {}


def bands_at(x, sr, t):
    nan = np.full(len(BANDS), np.nan)
    wide = parselmouth.Sound(x[max(0, int((t - 0.05) * sr)):int((t + 0.05) * sr)], sr)
    f0 = call(wide.to_pitch_ac(0.01, 60, 500), 'Get mean', 0, 0, 'Hertz')
    if not f0 == f0 or f0 <= 0:
        return nan
    # six periods: a fixed 40 ms window blurs a 90 Hz voice's harmonics into their gaps
    half = max(0.02, 3 / f0)
    a, b = int((t - half) * sr), int((t + half) * sr)
    if a < 0 or b > len(x):
        return nan
    n = 1 << 15
    P = np.abs(np.fft.rfft(x[a:b] * np.hanning(b - a), n)) ** 2
    hz = np.fft.rfftfreq(n, 1 / sr)
    out = nan.copy()
    for i, (lo, hi) in enumerate(BANDS):
        hp, gp = 0.0, 0.0
        for k in range(max(1, int(np.ceil(lo / f0))), int(hi / f0) + 1):
            m = (hz > k * f0 * 0.96) & (hz < k * f0 * 1.04)
            g = (hz > (k + 0.5) * f0 - 0.25 * f0) & (hz < (k + 0.5) * f0 + 0.25 * f0)
            if m.any() and g.any():
                hp += P[m].max(); gp += P[g].min() * (m.sum())
        if hp > 0 and gp > 0:
            out[i] = 10 * np.log10(hp / gp)
    return out


def steady(x, sr, a, b):
    m = np.array([bands_at(x, sr, a + u * (b - a)) for u in (0.35, 0.5, 0.65)])
    with np.errstate(all='ignore'):
        return np.nanmedian(m, 0) if np.isfinite(m).any() else m[0]


def speaker(spk):
    vdir, src = CFG['vctk'], CFG['src']
    idx = json.load(open(src / '_idx' / f'{spk}.json'))
    rows = []
    for lid, L in list(idx.items())[:CFG['per']]:
        name = CFG['names'].get(lid)
        rp, tg = src / 'wav' / f'{lid}.raw', vdir / 'mfa' / 'aligned' / spk / f'{name}.TextGrid'
        if not name or not rp.exists() or not tg.exists():
            continue
        ph, bad = vctk.timing(L['trace'], vctk.textgrid_phones(tg), CFG['table'])
        trace = [t for t in L['trace'] if t['p'] != 'END'][:len(ph or [])]
        if bad or len(trace) != len(ph):
            continue
        x, sr = sf.read(vdir / 'wav48_silence_trimmed' / spk / f'{name}_mic1.flac', dtype='float64')
        x = x.mean(1) if x.ndim > 1 else x
        y = np.fromfile(rp, dtype=np.float32).astype(np.float64)
        r = [t['at'] for t in trace] + [L['frames'] * L['frame']]
        S = np.full((len(ph), len(BANDS)), np.nan, np.float32); Y = S.copy()
        for k, t in enumerate(trace):
            if t['p'] not in VOW or ph[k]['end'] - ph[k]['start'] < 0.08 or r[k + 1] - r[k] < 0.08:
                continue
            S[k] = steady(x, sr, ph[k]['start'], ph[k]['end'])
            Y[k] = steady(y, 48000, r[k], r[k + 1])
        rows.append({'name': name, 'id': lid, 'codes': [t['p'] for t in trace], 'spk': S, 'syn': Y})
    pickle.dump(rows, open(CFG['out'] / f'{spk}.pkl', 'wb'))
    return spk, len(rows)


def init(cfg):
    CFG.update(cfg)


def main():
    args = sys.argv[1:]
    jobs, per = 2, 30
    for flag in ('--jobs', '--per'):
        if flag in args:
            k = args.index(flag); v = int(args[k + 1]); del args[k:k + 2]
            jobs, per = (v, per) if flag == '--jobs' else (jobs, v)
    vdir, src, out = (Path(a) for a in args[:3])
    out.mkdir(parents=True, exist_ok=True)
    names = {str(l['id']): l['name'] for l in json.load(open(vdir / 'mfa' / 'lines.json'))}
    spks = sorted(p.stem for p in (src / '_idx').glob('*.json') if not (out / f'{p.stem}.pkl').exists())
    cfg = {'vctk': vdir, 'src': src, 'out': out, 'names': names, 'per': per, 'table': json.load(open(vdir / 'mfa' / 'phone-table.json'))}
    t0, n = time.time(), 0
    with Pool(jobs, initializer=init, initargs=(cfg,)) as pool:
        for spk, k in pool.imap_unordered(speaker, spks):
            n += k
            print(f'{spk}: {k} lines; {n} so far, {time.time() - t0:.0f} s', flush=True)


if __name__ == '__main__':
    main()
