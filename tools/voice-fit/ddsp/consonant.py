"""consonant.py: noise measures per obstruent, VCTK against ORACLE's render (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/consonant.py <vctk dir> <source dir> <out dir> [--jobs 4]

Reuses source.py's work: the lines it picked (<source dir>/_idx) and the worklet renders it made
(<source dir>/wav), so nothing is rendered twice. For every fricative and affricate, over the
middle half of the phone, and for every stop, over the last 40% of its span (where the burst and
aspiration sit; MFA puts the release inside the stop), on the speaker and on the render:

  cog    spectral centre of gravity above 500 Hz, log Hz (the noise band's place: engine `nf`)
  spread spectral standard deviation above 500 Hz, log Hz (how wide the band is: engine `nq`)
  lvl    the phone's RMS level against the next or previous vowel's, dB (engine `af`)

Each recording is high-passed at 500 Hz first, so voicing under /z v/ and room rumble don't pull
the centre down. Writes <out dir>/<spk>.pkl: [{ name, id, codes, rdur, acc, spk, syn }], with
spk and syn (phones x 3) NaN where a phone isn't an obstruent or a measure failed.
"""
import json, pickle, sys, time
from pathlib import Path
from multiprocessing import Pool
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import vctk
from phones import VOW

FRIC = {'S', 'Z', 'SH', 'ZH', 'F', 'V', 'TH', 'DH', 'HH', 'CH', 'JH'}
STOP = {'P', 'B', 'T', 'D', 'K', 'G'}
CFG = {}


def spec(x, sr, a, b):
    """(log cog, log spread) of x[a:b] seconds above 500 Hz, or NaNs."""
    i, j = int(a * sr), int(b * sr)
    if j - i < int(0.012 * sr) or i < 0 or j > len(x):
        return np.nan, np.nan
    seg = x[i:j] * np.hanning(j - i)
    P = np.abs(np.fft.rfft(seg, 1 << 13)) ** 2
    hz = np.fft.rfftfreq(1 << 13, 1 / sr)
    m = (hz > 500) & (hz < 11000)
    p, f = P[m], hz[m]
    if p.sum() <= 0:
        return np.nan, np.nan
    cog = (p * f).sum() / p.sum()
    sd = np.sqrt((p * (f - cog) ** 2).sum() / p.sum())
    return np.log(cog), np.log(max(sd, 1.0))


def rms(x, sr, a, b):
    i, j = max(0, int(a * sr)), min(len(x), int(b * sr))
    return np.sqrt(np.mean(x[i:j] ** 2)) + 1e-9 if j > i else np.nan


def phone_measures(x, sr, spans, codes):
    """(phones x 3) for one recording: spans are (start, end) per phone."""
    out = np.full((len(codes), 3), np.nan, np.float32)
    vow = [k for k, c in enumerate(codes) if c in VOW]
    for k, c in enumerate(codes):
        a, b = spans[k]
        if c in FRIC:
            a, b = a + 0.25 * (b - a), b - 0.25 * (b - a)
        elif c in STOP:
            a = a + 0.6 * (b - a)
        else:
            continue
        cog, sd = spec(x, sr, a, b)
        near = min(vow, key=lambda v: abs(v - k), default=None)
        lvl = np.nan
        if near is not None:
            va, vb = spans[near]
            lvl = 20 * np.log10(rms(x, sr, a, b) / rms(x, sr, va + 0.3 * (vb - va), vb - 0.3 * (vb - va)))
        out[k] = (cog, sd, lvl)
    return out


def hp(x, sr):
    return sosfilt(butter(4, 500, 'hp', fs=sr, output='sos'), x)


def speaker(spk):
    vdir, src = CFG['vctk'], CFG['src']
    idx = json.load(open(src / '_idx' / f'{spk}.json'))
    rows = []
    for lid, L in idx.items():
        name = L.get('name') or CFG['names'].get(lid)
        if not name:
            continue
        rp = src / 'wav' / f'{lid}.raw'
        tg = vdir / 'mfa' / 'aligned' / spk / f'{name}.TextGrid'
        if not rp.exists() or not tg.exists():
            continue
        ph, bad = vctk.timing(L['trace'], vctk.textgrid_phones(tg), CFG['table'])
        trace = [t for t in L['trace'] if t['p'] != 'END'][:len(ph or [])]
        if bad or len(trace) != len(ph):
            continue
        codes = [t['p'] for t in trace]
        if not any(c in FRIC or c in STOP for c in codes):
            continue
        x, sr = sf.read(vdir / 'wav48_silence_trimmed' / spk / f'{name}_mic1.flac', dtype='float64')
        x = hp(x.mean(1) if x.ndim > 1 else x, sr)
        y = hp(np.fromfile(rp, dtype=np.float32).astype(np.float64), 48000)
        r = [t['at'] for t in trace] + [L['frames'] * L['frame']]
        S = phone_measures(x, sr, [(p['start'], p['end']) for p in ph], codes)
        Y = phone_measures(y, 48000, list(zip(r[:-1], r[1:])), codes)
        rows.append({'name': name, 'id': lid, 'codes': codes, 'rdur': np.diff(r).astype(np.float32),
                     'acc': [1 if t.get('acc') else 0 for t in trace], 'spk': S, 'syn': Y})
    pickle.dump(rows, open(CFG['out'] / f'{spk}.pkl', 'wb'))
    return spk, len(rows)


def init(cfg):
    CFG.update(cfg)


def main():
    args = sys.argv[1:]
    jobs = 4
    if '--jobs' in args:
        k = args.index('--jobs'); jobs = int(args[k + 1]); del args[k:k + 2]
    vdir, src, out = (Path(a) for a in args[:3])
    out.mkdir(parents=True, exist_ok=True)
    names = {str(l['id']): l['name'] for l in json.load(open(vdir / 'mfa' / 'lines.json'))}
    spks = sorted(p.stem for p in (src / '_idx').glob('*.json'))
    cfg = {'vctk': vdir, 'src': src, 'out': out, 'names': names, 'table': json.load(open(vdir / 'mfa' / 'phone-table.json'))}
    t0, n = time.time(), 0
    with Pool(jobs, initializer=init, initargs=(cfg,)) as pool:
        for spk, k in pool.imap_unordered(speaker, spks):
            n += k
            print(f'{spk}: {k} lines; {n} so far, {time.time() - t0:.0f} s', flush=True)


if __name__ == '__main__':
    main()
